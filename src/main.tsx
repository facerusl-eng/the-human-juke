import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import router from './App.tsx'
import { logCrashTelemetry } from './lib/crashTelemetry'

const GLOBAL_RUNTIME_NOTICE_EVENT = 'human-jukebox-runtime-notice'
const CHUNK_RECOVERY_LAST_ATTEMPT_KEY = 'human-jukebox-chunk-recovery-last-attempt'
const CHUNK_RECOVERY_THROTTLE_MS = 15_000

function emitRuntimeNotice(message: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent<string>(GLOBAL_RUNTIME_NOTICE_EVENT, { detail: message }))
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

function recoverFromChunkLoadFailure(error: unknown, source: string): boolean {
  if (!import.meta.env.PROD || typeof window === 'undefined' || !isChunkLoadFailure(error)) {
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
    window.location.reload()
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

    if ('caches' in window) {
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

function setupBuildUpdateRefresh() {
  if (!import.meta.env.PROD || typeof window === 'undefined') {
    return
  }

  const currentEntryPath = new URL(import.meta.url, window.location.href).pathname
  let checking = false
  let hasNotifiedBuildUpdate = false

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
      const match = html.match(/<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/i)

      if (!match?.[1]) {
        return
      }

      const deployedEntryPath = new URL(match[1], window.location.origin).pathname

      if (deployedEntryPath !== currentEntryPath) {
        if (!hasNotifiedBuildUpdate) {
          hasNotifiedBuildUpdate = true
          emitRuntimeNotice('A new app update is available. Refresh when convenient to apply it.')
        }
      }
    } catch {
      emitRuntimeNotice('Network sync is temporarily unavailable. Retrying in the background.')
      // Ignore transient network failures and try again on the next trigger.
    } finally {
      checking = false
    }
  }

  const onVisibilityChange = () => {
    if (!document.hidden) {
      void checkForUpdatedBuild()
    }
  }

  window.addEventListener('focus', () => {
    void checkForUpdatedBuild()
  })
  window.addEventListener('online', () => {
    void checkForUpdatedBuild()
  })
  window.addEventListener('pageshow', () => {
    void checkForUpdatedBuild()
  })
  document.addEventListener('visibilitychange', onVisibilityChange)

  window.setInterval(() => {
    if (!document.hidden) {
      void checkForUpdatedBuild()
    }
  }, 60_000)
}

function installGlobalRuntimeHooks() {
  if (typeof window === 'undefined') {
    return
  }

  window.addEventListener('error', (event) => {
    if (recoverFromChunkLoadFailure(event.error ?? event.message, 'global-error-chunk-load')) {
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

    logCrashTelemetry({
      route: typeof window === 'undefined' ? undefined : window.location.pathname,
      error: event.reason,
      extra: {
        source: 'global-unhandledrejection',
      },
    })

    event.preventDefault()
    console.warn('Unhandled promise rejection captured', event.reason)

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

setupBuildUpdateRefresh()
installGlobalRuntimeHooks()
void cleanupLegacyServiceWorkers()

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
} else {
  createRoot(rootElement).render(
    <RouterProvider router={router} />,
  )
}
