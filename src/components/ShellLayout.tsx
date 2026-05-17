import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'
import { demoMode } from '../demo/demoMode'
import { DemoBanner } from '../demo/DemoBanner'
import SideNavigation from './SideNavigation'
import DesktopInstallPrompt from './DesktopInstallPrompt'

const GLOBAL_RUNTIME_NOTICE_EVENT = 'human-jukebox-runtime-notice'
const DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY = 'human-jukebox-desktop-sidebar-collapsed'

const RUNTIME_THEME_PRESETS: Record<string, Record<string, string>> = {
  dark: {
    '--canvas': '#05040b',
    '--canvas-alt': '#0b0715',
    '--panel': '#100a1d',
    '--panel-alt': '#16102a',
    '--panel-border': 'rgba(162, 89, 255, 0.36)',
    '--ink': '#edf3ff',
    '--ink-soft': '#b5b2de',
    '--ink-strong': '#f7f9ff',
  },
  neon: {
    '--canvas': '#140620',
    '--canvas-alt': '#1a0a2e',
    '--panel': '#1f0f36',
    '--panel-alt': '#2a1244',
    '--panel-border': 'rgba(255, 0, 128, 0.42)',
    '--ink': '#fff0fb',
    '--ink-soft': '#efb7df',
    '--ink-strong': '#ffffff',
  },
  pub: {
    '--canvas': '#1f1a16',
    '--canvas-alt': '#2a2420',
    '--panel': '#332a24',
    '--panel-alt': '#3d3128',
    '--panel-border': 'rgba(212, 165, 116, 0.44)',
    '--ink': '#fff5e9',
    '--ink-soft': '#d7c5b2',
    '--ink-strong': '#fffaf3',
  },
  clean: {
    '--canvas': '#f1f6ff',
    '--canvas-alt': '#e7efff',
    '--panel': '#ffffff',
    '--panel-alt': '#f6f9ff',
    '--panel-border': 'rgba(26, 115, 232, 0.24)',
    '--ink': '#17233a',
    '--ink-soft': '#4a5c78',
    '--ink-strong': '#0f1b2f',
  },
  highcontrast: {
    '--canvas': '#000000',
    '--canvas-alt': '#050505',
    '--panel': '#0d0d0d',
    '--panel-alt': '#151515',
    '--panel-border': 'rgba(255, 255, 0, 0.68)',
    '--ink': '#ffffff',
    '--ink-soft': '#f0f0a8',
    '--ink-strong': '#ffffff',
  },
}

function isValidHexColor(value: string | null | undefined) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())
}

function getRuntimeBuildTag() {
  const appVersion = import.meta.env.VITE_APP_VERSION?.trim()
  const commitSha = import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA?.trim() || import.meta.env.VITE_GIT_COMMIT_SHA?.trim()

  if (appVersion && commitSha) {
    return `v${appVersion} (${commitSha.slice(0, 7)})`
  }

  if (appVersion) {
    return `v${appVersion}`
  }

  if (typeof window === 'undefined') {
    return null
  }

  const runtimePath = new URL(import.meta.url, window.location.href).pathname
  const hashedAssetMatch = runtimePath.match(/-([a-z0-9]{8,})\.(?:m?js)$/i)

  if (hashedAssetMatch?.[1]) {
    return hashedAssetMatch[1].slice(0, 10)
  }

  return import.meta.env.DEV ? 'dev' : null
}

function ShellLayout() {
  const { profile, user, loading, authError } = useAuthStore()
  const { queueOperatingMode, queueHealthMessage } = useQueueStore()
  const location = useLocation()
  const navigate = useNavigate()
  const [runtimeNotice, setRuntimeNotice] = useState<string | null>(null)
  const [dismissedDegradedBanner, setDismissedDegradedBanner] = useState(false)
  const [runtimeBuildTag] = useState(() => getRuntimeBuildTag())
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.matchMedia('(max-width: 1024px)').matches
  })
  const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY, isDesktopSidebarCollapsed ? '1' : '0')
    } catch {
      // non-critical
    }
  }, [isDesktopSidebarCollapsed])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const mediaQuery = window.matchMedia('(max-width: 1024px)')
    const onViewportChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches)
    }

    setIsMobileViewport(mediaQuery.matches)
    mediaQuery.addEventListener('change', onViewportChange)

    return () => {
      mediaQuery.removeEventListener('change', onViewportChange)
    }
  }, [])

  useEffect(() => {
    if (!isMobileViewport) {
      return
    }

    setIsDesktopSidebarCollapsed(true)
  }, [isMobileViewport])

  useEffect(() => {
    const root = document.documentElement
    const presetKey = profile?.theme_preset && RUNTIME_THEME_PRESETS[profile.theme_preset]
      ? profile.theme_preset
      : 'dark'
    const presetVars = RUNTIME_THEME_PRESETS[presetKey]

    root.setAttribute('data-theme-preset', presetKey)

    Object.entries(presetVars).forEach(([token, value]) => {
      root.style.setProperty(token, value)
    })

    const accentColor = isValidHexColor(profile?.accent_color)
      ? profile?.accent_color?.trim() ?? '#5dd7ff'
      : '#5dd7ff'
    root.style.setProperty('--accent', accentColor)
  }, [profile?.accent_color, profile?.theme_preset])

  useEffect(() => {
    const onRuntimeNotice = (event: Event) => {
      const customEvent = event as CustomEvent<string>
      if (typeof customEvent.detail === 'string' && customEvent.detail.trim()) {
        setRuntimeNotice(customEvent.detail)
      }
    }

    window.addEventListener(GLOBAL_RUNTIME_NOTICE_EVENT, onRuntimeNotice as EventListener)

    return () => {
      window.removeEventListener(GLOBAL_RUNTIME_NOTICE_EVENT, onRuntimeNotice as EventListener)
    }
  }, [])

  const currentPath = location.pathname
  const showAdminNavigation = currentPath.startsWith('/admin')

  const authErrorText = authError?.toLowerCase() ?? ''
  const queueHealthText = queueHealthMessage?.toLowerCase() ?? ''
  const hasAuthServiceIssue = authErrorText.includes('temporarily unavailable')
    || authErrorText.includes('timeout')
    || authErrorText.includes('failed to fetch')
    || authErrorText.includes('500')
    || authErrorText.includes('503')
    || authErrorText.includes('504')
  const hasQueueServiceIssue = queueHealthText.includes('disconnected')
    || queueHealthText.includes('timeout')
    || queueHealthText.includes('degraded')
    || queueHealthText.includes('reconnect')

  const degradedServiceMessage = hasAuthServiceIssue
    ? (authError ?? 'Auth service is temporarily unavailable. Admin features may be limited.')
    : hasQueueServiceIssue
      ? (queueHealthMessage ?? 'Live queue service is degraded. Retrying in the background.')
      : queueOperatingMode === 'degraded'
        ? 'Live queue service is degraded. Retrying in the background.'
        : null

  useEffect(() => {
    setDismissedDegradedBanner(false)
  }, [degradedServiceMessage])

  return (
    <main className="min-h-screen">
      {demoMode ? <DemoBanner /> : null}
      <div className="relative flex min-h-screen">
        {showAdminNavigation ? (
          <SideNavigation
            collapsed={isDesktopSidebarCollapsed}
            onToggleCollapsed={() => setIsDesktopSidebarCollapsed((collapsed) => !collapsed)}
            currentPath={currentPath}
            isMobile={isMobileViewport}
          />
        ) : null}

        {showAdminNavigation && isMobileViewport && !isDesktopSidebarCollapsed ? (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/45"
            aria-label="Close navigation"
            onClick={() => setIsDesktopSidebarCollapsed(true)}
          />
        ) : null}

        <section className="app-main-content min-w-0 w-full flex-1 overflow-x-hidden">
          {showAdminNavigation && degradedServiceMessage && !dismissedDegradedBanner ? (
            <section className="queue-panel" role="status" aria-live="polite" aria-label="Service degradation notice">
              <p className="eyebrow">Service Degraded</p>
              <p className="subcopy no-margin">{degradedServiceMessage}</p>
              <div className="hero-actions no-margin-bottom">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    window.location.reload()
                  }}
                >
                  Retry Now
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setDismissedDegradedBanner(true)}
                >
                  Dismiss
                </button>
              </div>
            </section>
          ) : null}

          {runtimeNotice ? (
          <section className="queue-panel" role="status" aria-live="polite">
            <div className="hero-actions no-margin-bottom">
              <p className="subcopy no-margin">{runtimeNotice}</p>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setRuntimeNotice(null)}
              >
                Dismiss
              </button>
            </div>
          </section>
        ) : null}
        <Outlet />
        <footer className="site-legal-footer" aria-label="Copyright notice">
          <p>
            Copyright {new Date().getFullYear()} Haraldur G Asmundsson. All rights reserved. The Human Jukebox name,
            branding, and related content are proprietary. Unauthorized use, reproduction, or distribution is
            prohibited.
          </p>
          {runtimeBuildTag ? <p className="site-build-tag">Build {runtimeBuildTag}</p> : null}
        </footer>
        </section>

        {showAdminNavigation && isMobileViewport && isDesktopSidebarCollapsed ? (
          <button
            type="button"
            className="fixed bottom-4 right-4 z-50 h-11 rounded-full border border-fuchsia-400/35 bg-[#0A0A0A] px-4 text-sm font-semibold text-cyan-200 shadow-[0_0_18px_rgba(255,0,255,0.25)] transition-all duration-200 hover:shadow-[0_0_24px_rgba(255,0,255,0.35)]"
            onClick={() => setIsDesktopSidebarCollapsed(false)}
            aria-label={user || loading ? 'Open navigation menu' : 'Open admin login'}
          >
            {user || loading ? 'Menu' : 'Admin Login'}
          </button>
        ) : null}

        {!showAdminNavigation ? (
          <button
            type="button"
            className="fixed bottom-4 right-4 z-50 h-11 rounded-full border border-fuchsia-400/35 bg-[#0A0A0A] px-4 text-sm font-semibold text-cyan-200 shadow-[0_0_18px_rgba(255,0,255,0.25)] transition-all duration-200 hover:shadow-[0_0_24px_rgba(255,0,255,0.35)]"
            onClick={() => navigate(user || loading ? '/admin/gigs' : '/admin')}
            aria-label={user || loading ? 'Open admin app' : 'Open admin login'}
          >
            {user || loading ? 'Admin' : 'Admin Login'}
          </button>
        ) : null}

        <DesktopInstallPrompt />
      </div>
    </main>
  )
}

export default ShellLayout
