import { chromium } from 'playwright'

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:5173'

const viewports = [
  { name: 'iphone-14-pro', width: 393, height: 852 },
  { name: 'pixel-7', width: 412, height: 915 },
  { name: 'ipad-10-portrait', width: 820, height: 1180 },
  { name: 'ipad-10-landscape', width: 1180, height: 820 },
  { name: 'desktop-1366', width: 1366, height: 768 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
]

const routes = ['/', '/admin', '/admin/venue-outreach', '/audience']

function normalizeError(error) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

async function checkPage(page, route, viewportName) {
  const start = Date.now()
  await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle', timeout: 45000 })

  const metrics = await page.evaluate(() => {
    const doc = document.documentElement
    const body = document.body
    return {
      docScrollWidth: doc?.scrollWidth ?? 0,
      bodyScrollWidth: body?.scrollWidth ?? 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      hasHorizontalOverflow: (doc?.scrollWidth ?? 0) - window.innerWidth > 1 || (body?.scrollWidth ?? 0) - window.innerWidth > 1,
    }
  })

  return {
    route,
    viewportName,
    elapsedMs: Date.now() - start,
    ...metrics,
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const results = []
  const failures = []

  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
      const page = await context.newPage()

      for (const route of routes) {
        try {
          const result = await checkPage(page, route, viewport.name)
          results.push(result)

          if (result.hasHorizontalOverflow) {
            failures.push(
              `${viewport.name} ${route}: horizontal overflow (doc=${result.docScrollWidth}, body=${result.bodyScrollWidth}, viewport=${result.viewportWidth})`,
            )
          }
        } catch (error) {
          failures.push(`${viewport.name} ${route}: ${normalizeError(error)}`)
        }
      }

      await page.close()
      await context.close()
    }
  } finally {
    await browser.close()
  }

  console.log('\nResponsive smoke report\n')
  console.table(
    results.map((item) => ({
      viewport: item.viewportName,
      route: item.route,
      overflow: item.hasHorizontalOverflow,
      elapsedMs: item.elapsedMs,
      width: `${item.docScrollWidth}/${item.viewportWidth}`,
    })),
  )

  if (failures.length > 0) {
    console.error('\nResponsive smoke failures:')
    failures.forEach((failure) => console.error(`- ${failure}`))
    process.exitCode = 1
    return
  }

  console.log('\nResponsive smoke passed with no horizontal overflow detected.')
}

main().catch((error) => {
  console.error('Responsive smoke test failed to run:', normalizeError(error))
  console.error('If Chromium is missing, run: npx playwright install chromium')
  process.exitCode = 1
})
