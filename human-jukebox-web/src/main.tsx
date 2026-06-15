import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import './index.css'
import './App.css'
import App from './App.tsx'
import { logCrashTelemetry } from './lib/crashTelemetry'
import { AppUpdateNotification } from './components/AppUpdateNotification'

const GLOBAL_RUNTIME_NOTICE_EVENT = 'human-jukebox-runtime-notice'
const GLOBAL_RUNTIME_DIAGNOSTIC_EVENT = 'human-jukebox-runtime-diagnostic'
const CHUNK_RECOVERY_LAST_ATTEMPT_KEY = 'human-jukebox-chunk-recovery-last-attempt'
const CHUNK_RECOVERY_THROTTLE_MS = 15_000
const NON_JSON_RECOVERY_LAST_ATTEMPT_KEY = 'human-jukebox-non-json-recovery-last-attempt'
const NON_JSON_RECOVERY_THROTTLE_MS = 4_000
const NON_JSON_RECOVERY_NOTICE_SHOWN_KEY = 'human-jukebox-non-json-recovery-notice-shown'
const BUILD_UPDATE_RELOAD_LAST_ATTEMPT_KEY = 'human-jukebox-build-update-reload-last-attempt'
const BUILD_UPDATE_RELOAD_THROTTLE_MS = 20_000
const IOS_SW_BYPASS_STORAGE_KEY = 'human-jukebox-ios-sw-cache-bypass'
const MOBILE_ZOOM_UNLOCK_STORAGE_KEY = 'human-jukebox-mobile-zoom-unlock'
const MOBILE_ZOOM_PREF_EVENT = 'human-jukebox-mobile-zoom-preference-changed'
const VIEWPORT_CONTENT_ACCESSIBLE = 'width=device-width, initial-scale=1.0, viewport-fit=cover'

function isLocalPreviewHost() {
  if (typeof window === 'undefined') {
    return false
  }

  const host = window.location.hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1'
}

function isAdminRoute() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.location.pathname.startsWith('/admin')
}

function shouldRenderAnalytics() {
  if (!import.meta.env.PROD || typeof window === 'undefined') {
    return false
  }

  return !isLocalPreviewHost()
}

function emitRuntimeNotice(message: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent<string>(GLOBAL_RUNTIME_NOTICE_EVENT, { detail: message }))
}

function emitRuntimeDiagnostic(source: string, error: unknown) {
  if (typeof window === 'undefined') {
    return
  }

  const message = getErrorMessage(error) || getRejectionMessage(error) || 'Unknown runtime error'
  window.dispatchEvent(new CustomEvent(GLOBAL_RUNTIME_DIAGNOSTIC_EVENT, {
    detail: {
      source,
      message,
      timestamp: Date.now(),
    },
  }))
}

function getRejectionMessage(reason: unknown): string {
  if (typeof reason === 'string') {
    return reason
  }

  if (reason && typeof reason === 'object' && 'message' in reason) {
    const message = (reason as { message?: unknown }).message

    if (typeof message === 'string') {
      return message
    }
  }

  return ''
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') {
      return message
    }
  }

  return ''
}

function isChunkLoadFailure(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase()

  return message.includes('failed to fetch dynamically imported module')
    || message.includes('failed to load module script')
    || message.includes('importing a module script failed')
    || message.includes('chunkloaderror')
    || (message.includes('unexpected token') && message.includes('<'))
}

function isStaticAssetLoadFailureEvent(event: ErrorEvent): boolean {
  if (!import.meta.env.PROD || typeof window === 'undefined') {
    return false
  }

  const target = event.target
  if (!target || !(target instanceof Element)) {
    return false
  }

  if (target instanceof HTMLLinkElement) {
    const href = target.href ?? ''
    return href.includes('/assets/') && href.endsWith('.css')
  }

  if (target instanceof HTMLScriptElement) {
    const src = target.src ?? ''
    return src.includes('/assets/') && src.endsWith('.js')
  }

  return false
}

function recoverFromChunkLoadFailure(error: unknown, source: string): boolean {
  if (typeof window === 'undefined' || !isChunkLoadFailure(error)) {
    return false
  }

  const now = Date.now()
  const previousAttempt = Number(window.sessionStorage.getItem(CHUNK_RECOVERY_LAST_ATTEMPT_KEY) ?? '0')

  if (Number.isFinite(previousAttempt) && now - previousAttempt < CHUNK_RECOVERY_THROTTLE_MS) {
    return false
  }

  window.sessionStorage.setItem(CHUNK_RECOVERY_LAST_ATTEMPT_KEY, `${now}`)

  logCrashTelemetry({
    route: window.location.pathname,
    error,
    extra: {
      source,
      recovery: 'chunk-reload',
    },
  })

  emitRuntimeNotice('A new app build was detected. Reloading to recover...')
  window.setTimeout(() => {
    const hardRefreshUrl = new URL(window.location.href)
    hardRefreshUrl.searchParams.set('build-refresh', Date.now().toString(36))
    window.location.replace(hardRefreshUrl.toString())
  }, 60)

  return true
}

function isAbortLikeRejection(reason: unknown): boolean {
  if (reason && typeof reason === 'object' && 'name' in reason) {
    const name = (reason as { name?: unknown }).name

    if (name === 'AbortError') {
      return true
    }
  }

  const message = getRejectionMessage(reason).toLowerCase()

  return message.includes('aborted') || message.includes('aborterror') || message.includes('canceled')
}

function isHtmlInsteadOfJsonError(candidate: unknown): boolean {
  const message = (getErrorMessage(candidate) || getRejectionMessage(candidate)).toLowerCase()

  if (!message) {
    return false
  }

  return message.includes("unexpected token '<'")
    || (message.includes('unexpected token') && message.includes('<'))
    || (message.includes('failed to execute') && message.includes('json.parse') && message.includes('<'))
    || (message.includes('is not valid json') && message.includes('<'))
}

function recoverFromNonJsonRuntimeError(error: unknown, source: string): boolean {
  if (typeof window === 'undefined' || !isHtmlInsteadOfJsonError(error)) {
    return false
  }

  const now = Date.now()
  const previousAttempt = Number(window.sessionStorage.getItem(NON_JSON_RECOVERY_LAST_ATTEMPT_KEY) ?? '0')

  if (Number.isFinite(previousAttempt) && now - previousAttempt < NON_JSON_RECOVERY_THROTTLE_MS) {
    logCrashTelemetry({
      route: window.location.pathname,
      error,
      extra: {
        source,
        recovery: 'non-json-reload-throttled',
        elapsedMsSinceLastAttempt: now - previousAttempt,
      },
    })

    if (window.sessionStorage.getItem(NON_JSON_RECOVERY_NOTICE_SHOWN_KEY) !== '1') {
      window.sessionStorage.setItem(NON_JSON_RECOVERY_NOTICE_SHOWN_KEY, '1')
    }

    return true
  }

  window.sessionStorage.setItem(NON_JSON_RECOVERY_LAST_ATTEMPT_KEY, `${now}`)
  window.sessionStorage.removeItem(NON_JSON_RECOVERY_NOTICE_SHOWN_KEY)

  logCrashTelemetry({
    route: window.location.pathname,
    error,
    extra: {
      source,
      recovery: 'non-json-hard-refresh',
    },
  })

  emitRuntimeDiagnostic(source, error)
  emitRuntimeNotice('A server response was invalid. Reloading to recover...')
  window.setTimeout(() => {
    try {
      window.location.reload()
    } catch {
      const hardRefreshUrl = new URL(window.location.href)
      hardRefreshUrl.searchParams.set('build-refresh', Date.now().toString(36))
      hardRefreshUrl.searchParams.set('non-json-recovery', '1')
      window.location.replace(hardRefreshUrl.toString())
    }
  }, 60)

  return true
}

function isIOSLikeDevice() {
  if (typeof navigator === 'undefined') {
    return false
  }

  const userAgent = navigator.userAgent || ''
  const platform = navigator.platform || ''

  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    return true
  }

  // iPadOS can report itself as Mac; detect via touch support.
  return platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

async function disableServiceWorkerCachingOnIOS() {
  if (!import.meta.env.PROD || typeof window === 'undefined' || !('serviceWorker' in navigator) || !isIOSLikeDevice()) {
    return
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations()

    if (registrations.length === 0 && !('caches' in window)) {
      return
    }

    await Promise.all(
      registrations.map(async (registration) => {
        try {
          await registration.unregister()
        } catch {
          // Ignore unregister failures and continue with remaining registrations.
        }
      }),
    )

    if ('caches' in window) {
      try {
        const cacheKeys = await caches.keys()
        await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)))
      } catch {
        // Ignore cache cleanup failures.
      }
    }

    if (navigator.serviceWorker.controller) {
      window.location.reload()
    }
  } catch {
    emitRuntimeNotice('iPhone cache cleanup hit an issue. The app will continue and retry later.')
  }
}

function shouldBypassServiceWorkerCachingOnIOS() {
  if (typeof window === 'undefined') {
    return false
  }

  const searchParams = new URLSearchParams(window.location.search)

  if (searchParams.get('iosSwBypass') === '1') {
    return true
  }

  try {
    return window.localStorage.getItem(IOS_SW_BYPASS_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function applyViewportZoomPreference() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  const viewportMeta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null
  if (!viewportMeta) {
    return
  }

  viewportMeta.setAttribute('content', VIEWPORT_CONTENT_ACCESSIBLE)
}

function installViewportZoomPreferenceSync() {
  if (typeof window === 'undefined') {
    return
  }

  applyViewportZoomPreference()

  window.addEventListener(MOBILE_ZOOM_PREF_EVENT, () => {
    applyViewportZoomPreference()
  })

  window.addEventListener('storage', (event) => {
    if (event.key === MOBILE_ZOOM_UNLOCK_STORAGE_KEY) {
      applyViewportZoomPreference()
    }
  })
}

async function cleanupLegacyServiceWorkers() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations()

    if (registrations.length === 0) {
      return
    }

    let unregisteredAny = false

    await Promise.all(
      registrations.map(async (registration) => {
        const scriptUrl = registration.active?.scriptURL
          ?? registration.waiting?.scriptURL
          ?? registration.installing?.scriptURL
          ?? ''

        if (scriptUrl.includes('/pwa-worker.js')) {
          return
        }

        try {
          const unregistered = await registration.unregister()

          if (unregistered) {
            unregisteredAny = true
          }
        } catch {
          // Ignore unregister failures and continue with remaining registrations.
        }
      }),
    )

    if (unregisteredAny && 'caches' in window) {
      try {
        const cacheKeys = await caches.keys()
        await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)))
      } catch {
        // Ignore cache cleanup failures.
      }
    }

    if (unregisteredAny && navigator.serviceWorker.controller) {
      window.location.reload()
    }
  } catch {
    emitRuntimeNotice('Background cleanup had issues. The app will keep running and retry later.')
    // Ignore service worker access failures in restricted browsers.
  }
}

async function registerProductionServiceWorker() {
  if (!import.meta.env.PROD || typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  // Disable SW caching globally for now to avoid stale app-shell rollouts.
  // This keeps admin and audience updates in sync with latest deploys.
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)))

    if ('caches' in window) {
      const cacheKeys = await caches.keys()
      await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)))
    }
  } catch {
    // Ignore cleanup errors; app continues without service worker support.
  }

  return

  if (isAdminRoute()) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)))

      if ('caches' in window) {
        const cacheKeys = await caches.keys()
        await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)))
      }
    } catch {
      // Ignore cleanup errors; admin pages continue without service worker caching.
    }

    return
  }

  if (isLocalPreviewHost()) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)))

      if ('caches' in window) {
        const cacheKeys = await caches.keys()
        await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)))
      }
    } catch {
      // Ignore localhost cleanup failures; local preview can continue without PWA support.
    }

    return
  }

  try {
    // pwa-worker.js is generated by vite-plugin-pwa (Workbox) and includes
    // a precache manifest of all Vite build artifacts for instant resume.
    const registration = await navigator.serviceWorker.register('/pwa-worker.js')
    console.info('Service worker registered', registration.scope)

    // Eagerly check for a new SW version right after registration so mobile
    // PWA users don't have to navigate away and back to trigger an update check.
    void registration.update().catch(() => {
      // Ignore update-check failures (offline, etc.).
    })

    // When skipWaiting causes a new SW to take control, reload so the new
    // code is actually executed. Without this, clients keep running the old
    // JS bundle even though the new SW is serving new assets.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload()
    })
  } catch (error) {
    console.error('Service worker registration failed', error)
  }
}

function setupBuildUpdateRefresh() {
  if (!import.meta.env.PROD || typeof window === 'undefined') {
    return
  }

  const currentEntryPath = new URL(import.meta.url, window.location.href).pathname
  const currentStylesheetHref = document
    .querySelector('link[rel="stylesheet"][href*="/assets/"]')
    ?.getAttribute('href')
  const currentStylesheetPath = currentStylesheetHref
    ? new URL(currentStylesheetHref, window.location.origin).pathname
    : ''
  let checking = false
  let hasNotifiedBuildUpdate = false
  let hasTriggeredBuildReload = false

  const reloadIntoLatestBuild = async () => {
    if (hasTriggeredBuildReload) {
      return
    }

    const now = Date.now()
    const previousAttempt = Number(window.sessionStorage.getItem(BUILD_UPDATE_RELOAD_LAST_ATTEMPT_KEY) ?? '0')

    if (Number.isFinite(previousAttempt) && now - previousAttempt < BUILD_UPDATE_RELOAD_THROTTLE_MS) {
      return
    }

    window.sessionStorage.setItem(BUILD_UPDATE_RELOAD_LAST_ATTEMPT_KEY, `${now}`)

    hasTriggeredBuildReload = true
    emitRuntimeNotice('A new app update was found. Reloading into the latest version...')

    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map((registration) => registration.update().catch(() => undefined)))
      } catch {
        // Ignore SW update failures and continue with a normal reload.
      }
    }

    if ('caches' in window) {
      try {
        const cacheKeys = await caches.keys()
        await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)))
      } catch {
        // Ignore cache cleanup failures and continue with a forced navigation.
      }
    }

    window.setTimeout(() => {
      const hardRefreshUrl = new URL(window.location.href)
      hardRefreshUrl.searchParams.set('build-refresh', Date.now().toString(36))
      window.location.replace(hardRefreshUrl.toString())
    }, 120)
  }

  const checkForUpdatedBuild = async () => {
    if (checking) {
      return
    }

    checking = true

    try {
      const response = await fetch(`/index.html?build-check=${Date.now()}`, {
        cache: 'no-store',
      })

      if (!response.ok) {
        return
      }

      const html = await response.text()
      const scriptMatch = html.match(/<script[^>]+src=["']([^"']*\/assets\/index-[^"']+\.js)["']/i)
      const stylesheetMatch = html.match(/<link[^>]+href=["']([^"']*\/assets\/index-[^"']+\.css)["']/i)

      if (!scriptMatch?.[1]) {
        return
      }

      const deployedEntryPath = new URL(scriptMatch[1], window.location.origin).pathname
      const deployedStylesheetPath = stylesheetMatch?.[1]
        ? new URL(stylesheetMatch[1], window.location.origin).pathname
        : ''

      const hasStylesheetChanged = Boolean(currentStylesheetPath)
        && Boolean(deployedStylesheetPath)
        && deployedStylesheetPath !== currentStylesheetPath
      const hasBuildChanged = deployedEntryPath !== currentEntryPath || hasStylesheetChanged

      if (hasBuildChanged) {
        if (!hasNotifiedBuildUpdate) {
          hasNotifiedBuildUpdate = true
        }

        await reloadIntoLatestBuild()
      }
    } catch {
      emitRuntimeNotice('Network sync is temporarily unavailable. Retrying in the background.')
      // Ignore transient network failures and try again on the next trigger.
    } finally {
      checking = false
    }
  }

  window.addEventListener('online', () => {
    void checkForUpdatedBuild()
  })

  window.setInterval(() => {
    if (!document.hidden) {
      void checkForUpdatedBuild()
    }
  }, 300_000)

  void checkForUpdatedBuild()
}

function installGlobalRuntimeHooks() {
  if (typeof window === 'undefined') {
    return
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
  })

  window.addEventListener('error', (event) => {
    if (isStaticAssetLoadFailureEvent(event)) {
      if (recoverFromChunkLoadFailure('failed to load module script', 'global-error-static-asset-load')) {
        return
      }
    }

    if (recoverFromChunkLoadFailure(event.error ?? event.message, 'global-error-chunk-load')) {
      return
    }

    if (recoverFromNonJsonRuntimeError(event.error ?? event.message, 'global-error-non-json-response-reload')) {
      return
    }

    if (isHtmlInsteadOfJsonError(event.error ?? event.message)) {
      emitRuntimeNotice('A server response was invalid. Reloading to recover...')
      return
    }

    logCrashTelemetry({
      route: typeof window === 'undefined' ? undefined : window.location.pathname,
      error: event.error ?? event.message,
      extra: {
        source: 'global-error',
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      },
    })

    if (event.error) {
      console.warn('Global runtime error captured', event.error)
    }
    emitRuntimeDiagnostic('global-error', event.error ?? event.message)
    emitRuntimeNotice('A runtime issue was detected. The app is trying to recover automatically.')
  })

  window.addEventListener('unhandledrejection', (event) => {
    if (isAbortLikeRejection(event.reason)) {
      event.preventDefault()
      return
    }

    if (recoverFromChunkLoadFailure(event.reason, 'global-unhandledrejection-chunk-load')) {
      event.preventDefault()
      return
    }

    if (recoverFromNonJsonRuntimeError(event.reason, 'global-unhandledrejection-non-json-response-reload')) {
      event.preventDefault()
      return
    }

    if (isHtmlInsteadOfJsonError(event.reason)) {
      event.preventDefault()
      emitRuntimeNotice('A server response was invalid. Reloading to recover...')
      return
    }

    logCrashTelemetry({
      route: typeof window === 'undefined' ? undefined : window.location.pathname,
      error: event.reason,
      extra: {
        source: 'global-unhandledrejection',
      },
    })

    event.preventDefault()
    console.warn('Unhandled promise rejection captured', event.reason)

    emitRuntimeDiagnostic('global-unhandledrejection', event.reason)
    emitRuntimeNotice('A background request failed. The app will retry without reloading.')
  })

  window.addEventListener('vite:preloadError', (event) => {
    const preloadErrorEvent = event as Event & {
      payload?: unknown
      error?: unknown
      preventDefault: () => void
    }

    const candidateError = preloadErrorEvent.payload ?? preloadErrorEvent.error ?? event

    if (recoverFromChunkLoadFailure(candidateError, 'vite-preload-error')) {
      preloadErrorEvent.preventDefault()
    }
  })
}

function scheduleNonCriticalStartupTasks() {
  if (typeof window === 'undefined') {
    return
  }

  // Start build freshness checks immediately so stale startup tabs self-heal fast.
  setupBuildUpdateRefresh()

  const run = () => {
    if (isIOSLikeDevice() && !shouldBypassServiceWorkerCachingOnIOS()) {
      void disableServiceWorkerCachingOnIOS()
      return
    }

    void cleanupLegacyServiceWorkers()
    void registerProductionServiceWorker()
  }

  if ('requestIdleCallback' in window) {
    ;(window as Window & {
      requestIdleCallback: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
    }).requestIdleCallback(() => {
      run()
    }, { timeout: 3000 })
    return
  }

  globalThis.setTimeout(run, 1200)
}

installGlobalRuntimeHooks()
scheduleNonCriticalStartupTasks()
installViewportZoomPreferenceSync()

function dismissSplash() {
  const splash = document.getElementById('app-splash')
  if (!splash) return
  splash.classList.add('splash-hidden')
  // Remove from DOM after the CSS transition finishes (350ms).
  splash.addEventListener('transitionend', () => splash.remove(), { once: true })
}

const rootElement = document.getElementById('root')

if (!rootElement) {
  const message = 'App root container is missing. Please refresh the page.'
  logCrashTelemetry({
    route: '/',
    error: new Error(message),
    extra: {
      source: 'bootstrap-root-missing',
    },
  })
  console.error(message)
  emitRuntimeNotice(message)
  dismissSplash()
} else {
  createRoot(rootElement).render(
    <>
      <App />
      {shouldRenderAnalytics() ? <Analytics /> : null}
      <AppUpdateNotification />
    </>,
  )
  // Dismiss once the browser has painted the first React frame.
  requestAnimationFrame(() => requestAnimationFrame(dismissSplash))
}
