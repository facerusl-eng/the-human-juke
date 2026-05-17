import { useEffect, useMemo, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
}

const INSTALL_DISMISS_STORAGE_KEY = 'human-jukebox-install-dismissed-at'
const INSTALL_DISMISS_TTL_MS = 3 * 24 * 60 * 60 * 1000

function isStandaloneDisplayMode() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: window-controls-overlay)').matches
}

function readInstallDismissed() {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const raw = window.localStorage.getItem(INSTALL_DISMISS_STORAGE_KEY)
    const dismissedAt = Number(raw ?? '0')

    if (!Number.isFinite(dismissedAt) || dismissedAt <= 0) {
      return false
    }

    return Date.now() - dismissedAt < INSTALL_DISMISS_TTL_MS
  } catch {
    return false
  }
}

function persistInstallDismissed() {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(INSTALL_DISMISS_STORAGE_KEY, String(Date.now()))
  } catch {
    // Non-critical best effort only.
  }
}

function DesktopInstallPrompt() {
  const [deferredPromptEvent, setDeferredPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(() => isStandaloneDisplayMode())
  const [isDismissed, setIsDismissed] = useState(() => readInstallDismissed())
  const [installHint, setInstallHint] = useState<string | null>(null)

  const canShowDesktopPrompt = useMemo(() => {
    if (typeof window === 'undefined') {
      return false
    }

    if (window.matchMedia('(max-width: 900px)').matches) {
      return false
    }

    const userAgent = window.navigator.userAgent
    return /Edg|Chrome|Chromium|Brave|OPR/i.test(userAgent)
  }, [])

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setDeferredPromptEvent(event as BeforeInstallPromptEvent)
      setInstallHint(null)
    }

    const onInstalled = () => {
      setIsInstalled(true)
      setDeferredPromptEvent(null)
      setInstallHint('Installed. You can launch it from Start menu like a desktop app.')
    }

    const onVisibilityOrFocus = () => {
      setIsInstalled(isStandaloneDisplayMode())
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    window.addEventListener('focus', onVisibilityOrFocus)
    window.addEventListener('pageshow', onVisibilityOrFocus)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      window.removeEventListener('focus', onVisibilityOrFocus)
      window.removeEventListener('pageshow', onVisibilityOrFocus)
    }
  }, [])

  if (isInstalled || isDismissed || !canShowDesktopPrompt) {
    return null
  }

  const triggerInstall = async () => {
    if (!deferredPromptEvent) {
      setInstallHint('In Edge or Chrome on PC: click the browser menu (three dots) and choose Install app.')
      return
    }

    setInstallHint(null)

    try {
      await deferredPromptEvent.prompt()
      const result = await deferredPromptEvent.userChoice

      if (result.outcome === 'accepted') {
        setInstallHint('Installing app...')
        return
      }

      setInstallHint('Install canceled. You can try again anytime.')
    } catch {
      setInstallHint('Install prompt failed. Use browser menu -> Install app.')
    } finally {
      setDeferredPromptEvent(null)
    }
  }

  return (
    <section
      className="fixed bottom-4 left-4 z-50 max-w-sm rounded-2xl border border-cyan-300/25 bg-[#0B0A14]/95 p-3 shadow-[0_0_22px_rgba(0,194,255,0.22)] backdrop-blur"
      aria-label="Desktop install"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            void triggerInstall()
          }}
        >
          {deferredPromptEvent ? 'Install Desktop App' : 'How to Install App'}
        </button>
        <button
          type="button"
          className="ghost-button"
          aria-label="Dismiss install prompt"
          onClick={() => {
            persistInstallDismissed()
            setIsDismissed(true)
          }}
        >
          Dismiss
        </button>
      </div>
      <p className="subcopy no-margin mt-2 text-xs">
        Runs in its own window after install, like a desktop app.
      </p>
      {installHint ? <p className="subcopy no-margin mt-1 text-xs">{installHint}</p> : null}
    </section>
  )
}

export default DesktopInstallPrompt
