import { useEffect, useState } from 'react'

const GLOBAL_RUNTIME_NOTICE_EVENT = 'human-jukebox-runtime-notice'

/**
 * App update notification component
 * Listens for runtime notices and displays a persistent banner when a new update is available
 */
export function AppUpdateNotification() {
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleRuntimeNotice = (event: Event) => {
      const customEvent = event as Event & { detail?: unknown }
      const message = typeof customEvent.detail === 'string' ? customEvent.detail : ''
      const normalizedMessage = message.toLowerCase()

      // Detect update-related messages
      if (
        normalizedMessage.includes('new app update')
        || normalizedMessage.includes('new app build was detected')
      ) {
        setUpdateAvailable(true)
      }
    }

    window.addEventListener(GLOBAL_RUNTIME_NOTICE_EVENT, handleRuntimeNotice)

    return () => {
      window.removeEventListener(GLOBAL_RUNTIME_NOTICE_EVENT, handleRuntimeNotice)
    }
  }, [])

  if (!updateAvailable) {
    return null
  }

  return (
    <div
      className="app-update-banner"
      role="alert"
      aria-live="assertive"
    >
      <div className="app-update-banner-content">
        <div className="app-update-banner-text">
          <p className="app-update-banner-title">✨ New Update Available</p>
          <p className="app-update-banner-message">
            A new version of the app is ready. Refresh to apply it.
          </p>
        </div>
        <button
          type="button"
          className="app-update-banner-button primary-button"
          onClick={() => {
            window.location.reload()
          }}
        >
          Refresh Now
        </button>
      </div>
    </div>
  )
}
