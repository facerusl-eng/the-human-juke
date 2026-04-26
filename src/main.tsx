import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import router from './App.tsx'

const GLOBAL_RUNTIME_NOTICE_EVENT = 'human-jukebox-runtime-notice'

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

  window.addEventListener('error', () => {
    emitRuntimeNotice('A runtime issue was detected. The app is trying to recover automatically.')
  })

  window.addEventListener('unhandledrejection', (event) => {
    if (isAbortLikeRejection(event.reason)) {
      return
    }

    emitRuntimeNotice('A background request failed. The app will retry without reloading.')
  })
}

setupBuildUpdateRefresh()
installGlobalRuntimeHooks()
void cleanupLegacyServiceWorkers()

createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />,
)
