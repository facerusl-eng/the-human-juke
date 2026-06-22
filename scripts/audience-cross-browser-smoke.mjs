import { spawn } from 'node:child_process'
import process from 'node:process'

import { chromium, firefox, webkit } from 'playwright'

const ENGINE_FACTORIES = {
  chromium,
  firefox,
  webkit,
}

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1366, height: 768 },
]

const DEFAULT_ROUTES = ['/', '/audience', '/audience?test=1', '/mirror']
const DEFAULT_ENGINES = ['chromium', 'firefox', 'webkit']
const SERVER_TIMEOUT_MS = 90_000
const NAV_TIMEOUT_MS = 45_000
const READABLE_BODY_TIMEOUT_MS = 10_000

function parseCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function toAbsoluteUrl(baseUrl, route) {
  if (/^https?:\/\//i.test(route)) {
    return route
  }

  return new URL(route, baseUrl).toString()
}

function normalizeError(error) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function isServerReachable(baseUrl) {
  try {
    const response = await fetch(baseUrl, {
      method: 'GET',
      redirect: 'manual',
    })

    return response.status < 500
  } catch {
    return false
  }
}

async function waitForServer(baseUrl, timeoutMs) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerReachable(baseUrl)) {
      return
    }

    await delay(1000)
  }

  throw new Error(`Timed out waiting for ${baseUrl} after ${Math.round(timeoutMs / 1000)}s`)
}

function isIgnorableRequestFailure(url, errorText) {
  if (/\/api\//i.test(url)) {
    return true
  }

  if (/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//i.test(url)) {
    return true
  }

  if (errorText.includes('ERR_ABORTED') && /\/(src|node_modules|@id|@fs|@vite)\//i.test(url)) {
    return true
  }

  if (errorText.includes('ERR_ABORTED') && /(wikipedia\.org|mzstatic\.com|itunes\.apple\.com)/i.test(url)) {
    return true
  }

  return false
}

function isIgnorablePageError(message) {
  if (/\/api\//i.test(message) && /(access control checks|cors|failed to fetch|networkerror)/i.test(message)) {
    return true
  }

  return false
}

function minimumBodyLengthForRoute(route) {
  if (/\/audience(\?|$)/i.test(route) && !(/[?&]test=1(?:&|$)/i.test(route))) {
    return 5
  }

  return 20
}

function startDevServer({ host, port }) {
  const command = `npm run dev:web -- --host ${host} --port ${String(port)}`

  return spawn(command, {
    stdio: 'inherit',
    shell: true,
    windowsHide: true,
    env: process.env,
  })
}

async function stopDevServer(childProcess) {
  if (!childProcess || childProcess.exitCode !== null) {
    return
  }

  await new Promise((resolve) => {
    const hardKillTimer = setTimeout(() => {
      if (childProcess.exitCode === null) {
        childProcess.kill('SIGKILL')
      }
    }, 5000)

    childProcess.once('exit', () => {
      clearTimeout(hardKillTimer)
      resolve()
    })

    childProcess.kill('SIGTERM')
  })
}

function buildRouteMetrics(result) {
  return {
    engine: result.engine,
    viewport: result.viewport,
    route: result.route,
    status: result.status,
    pageErrors: result.pageErrors.length,
    requestFailures: result.requestFailures.length,
    horizontalOverflow: result.hasHorizontalOverflow,
    title: result.title,
    bodyTextLength: result.bodyTextLength,
  }
}

async function waitForReadableBody(page, minimumLength = 20, timeoutMs = READABLE_BODY_TIMEOUT_MS) {
  try {
    await page.waitForFunction(
      (targetLength) => (document.body?.innerText ?? '').trim().length >= targetLength,
      minimumLength,
      { timeout: timeoutMs },
    )
    return true
  } catch {
    return false
  }
}

async function run() {
  const smokeHost = process.env.SMOKE_HOST ?? '127.0.0.1'
  const smokePort = Number.parseInt(process.env.SMOKE_PORT ?? '5174', 10)
  const baseUrl = process.env.BASE_URL ?? `http://${smokeHost}:${smokePort}`
  const routes = parseCsv(process.env.SMOKE_ROUTES).length > 0
    ? parseCsv(process.env.SMOKE_ROUTES)
    : DEFAULT_ROUTES
  const requestedEngines = parseCsv(process.env.SMOKE_ENGINES).length > 0
    ? parseCsv(process.env.SMOKE_ENGINES)
    : DEFAULT_ENGINES
  const shouldStartServer = process.env.SMOKE_START_SERVER !== '0'

  const engines = requestedEngines.filter((engineName) => engineName in ENGINE_FACTORIES)
  const unknownEngines = requestedEngines.filter((engineName) => !(engineName in ENGINE_FACTORIES))
  if (unknownEngines.length > 0) {
    console.warn(`Ignoring unsupported engines: ${unknownEngines.join(', ')}`)
  }

  if (engines.length === 0) {
    throw new Error('No valid browser engines selected. Use chromium, firefox, and/or webkit.')
  }

  let devServerProcess = null
  let startedDevServer = false

  try {
    if (shouldStartServer) {
      const serverIsAlreadyRunning = await isServerReachable(baseUrl)

      if (!serverIsAlreadyRunning) {
        console.log(`Starting local dev server on ${baseUrl} ...`)
        devServerProcess = startDevServer({ host: smokeHost, port: smokePort })
        startedDevServer = true
      } else {
        console.log(`Using existing server at ${baseUrl}`)
      }

      await waitForServer(baseUrl, SERVER_TIMEOUT_MS)
    }

    const failures = []
    const warnings = []
    const results = []

    for (const engineName of engines) {
      const launch = ENGINE_FACTORIES[engineName]
      let browser

      try {
        browser = await launch.launch({ headless: true })
      } catch (error) {
        failures.push({
          engine: engineName,
          viewport: '-',
          route: '-',
          reason: `Failed to launch ${engineName}: ${normalizeError(error)}`,
        })
        continue
      }

      try {
        for (const viewport of VIEWPORTS) {
          const context = await browser.newContext({
            viewport: {
              width: viewport.width,
              height: viewport.height,
            },
          })

          for (const route of routes) {
            const page = await context.newPage()
            const targetUrl = toAbsoluteUrl(baseUrl, route)
            const minBodyLength = minimumBodyLengthForRoute(route)
            const pageErrors = []
            const requestFailures = []
            let status = null
            let navigationError = null

            const onPageError = (error) => {
              pageErrors.push(normalizeError(error))
            }

            const onRequestFailed = (request) => {
              const url = request.url()
              const errorText = request.failure()?.errorText ?? 'unknown request failure'

              if (isIgnorableRequestFailure(url, errorText)) {
                return
              }

              requestFailures.push(`${url} :: ${errorText}`)
            }

            page.on('pageerror', onPageError)
            page.on('requestfailed', onRequestFailed)

            try {
              const response = await page.goto(targetUrl, {
                // /audience uses polling and realtime; commit is more stable than waiting for load milestones.
                waitUntil: 'commit',
                timeout: NAV_TIMEOUT_MS,
              })

              status = response?.status() ?? null
            } catch (error) {
              navigationError = normalizeError(error)
            }

            if (!navigationError) {
              await waitForReadableBody(page, minBodyLength)
            }

            await page.waitForTimeout(500)

            const actionablePageErrors = pageErrors.filter((message) => !isIgnorablePageError(message))

            const pageSnapshot = await page.evaluate(() => {
              const doc = document.documentElement
              const body = document.body
              const bodyText = (document.body?.innerText ?? '').trim()

              return {
                title: document.title,
                bodyTextLength: bodyText.length,
                hasHorizontalOverflow:
                  (doc?.scrollWidth ?? 0) - window.innerWidth > 1
                  || (body?.scrollWidth ?? 0) - window.innerWidth > 1,
              }
            })

            const result = {
              engine: engineName,
              viewport: viewport.name,
              route,
              status,
              title: pageSnapshot.title,
              bodyTextLength: pageSnapshot.bodyTextLength,
              hasHorizontalOverflow: pageSnapshot.hasHorizontalOverflow,
              pageErrors: actionablePageErrors,
              requestFailures,
              navigationError,
            }

            results.push(result)

            if (result.hasHorizontalOverflow) {
              warnings.push({
                engine: engineName,
                viewport: viewport.name,
                route,
                reason: 'Detected horizontal overflow',
              })
            }

            const hasHardFailure = Boolean(
              navigationError
              || (typeof status === 'number' && status >= 500)
              || actionablePageErrors.length > 0
              || requestFailures.length > 0
              || pageSnapshot.bodyTextLength < minBodyLength,
            )

            if (hasHardFailure) {
              failures.push({
                engine: engineName,
                viewport: viewport.name,
                route,
                reason: navigationError
                  || (typeof status === 'number' && status >= 500
                    ? `HTTP ${status}`
                    : actionablePageErrors[0]
                    || requestFailures[0]
                    || 'Rendered content too short'),
              })
            }

            page.off('pageerror', onPageError)
            page.off('requestfailed', onRequestFailed)
            await page.close()
          }

          await context.close()
        }
      } finally {
        await browser.close()
      }
    }

    console.log('\nAudience cross-browser smoke report\n')
    console.table(results.map(buildRouteMetrics))

    if (warnings.length > 0) {
      console.warn('\nWarnings:')
      for (const warning of warnings) {
        console.warn(`- ${warning.engine} ${warning.viewport} ${warning.route}: ${warning.reason}`)
      }
    }

    if (failures.length > 0) {
      console.error('\nFailures:')
      for (const failure of failures) {
        console.error(`- ${failure.engine} ${failure.viewport} ${failure.route}: ${failure.reason}`)
      }
      process.exitCode = 1
      return
    }

    console.log('\nAudience cross-browser smoke passed.')
  } finally {
    if (startedDevServer) {
      await stopDevServer(devServerProcess)
    }
  }
}

run().catch((error) => {
  console.error(`Audience cross-browser smoke failed to run: ${normalizeError(error)}`)
  console.error('If browser binaries are missing, run: npx playwright install chromium firefox webkit')
  process.exitCode = 1
})
