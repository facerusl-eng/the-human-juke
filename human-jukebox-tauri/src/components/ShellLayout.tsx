import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'
import { demoMode } from '../demo/demoMode'
import { DemoBanner } from '../demo/DemoBanner'
import SideNavigation from './SideNavigation'

const GLOBAL_RUNTIME_NOTICE_EVENT = 'human-jukebox-runtime-notice'
const GLOBAL_RUNTIME_DIAGNOSTIC_EVENT = 'human-jukebox-runtime-diagnostic'
const DESKTOP_SIDEBAR_COLLAPSED_STORAGE_KEY = 'human-jukebox-desktop-sidebar-collapsed-v2'

type RuntimeDiagnosticDetail = {
  source: string
  message: string
  timestamp: number
}

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
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnosticDetail[]>([])
  const [runtimeDiagnosticCopied, setRuntimeDiagnosticCopied] = useState(false)
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

    const onRuntimeDiagnostic = (event: Event) => {
      const customEvent = event as CustomEvent<RuntimeDiagnosticDetail>
      const payload = customEvent.detail

      if (!payload || typeof payload !== 'object') {
        return
      }

      if (typeof payload.source !== 'string' || typeof payload.message !== 'string' || typeof payload.timestamp !== 'number') {
        return
      }

      setRuntimeDiagnostics((current) => [payload, ...current].slice(0, 8))
    }

    window.addEventListener(GLOBAL_RUNTIME_NOTICE_EVENT, onRuntimeNotice as EventListener)
    window.addEventListener(GLOBAL_RUNTIME_DIAGNOSTIC_EVENT, onRuntimeDiagnostic as EventListener)

    return () => {
      window.removeEventListener(GLOBAL_RUNTIME_NOTICE_EVENT, onRuntimeNotice as EventListener)
      window.removeEventListener(GLOBAL_RUNTIME_DIAGNOSTIC_EVENT, onRuntimeDiagnostic as EventListener)
    }
  }, [])

  const currentPath = location.pathname
  const searchParams = new URLSearchParams(location.search)
  const isAdminRoute = currentPath.startsWith('/admin')
  const isFocusedGigControlView = currentPath.startsWith('/admin/gig-control') && searchParams.get('view') === 'focus'
  const showAdminNavigation = isAdminRoute && !isFocusedGigControlView
  const latestRuntimeDiagnostic = runtimeDiagnostics[0] ?? null
  const hasRuntimeDiagnostics = runtimeDiagnostics.length > 0

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

  const copyRuntimeDiagnostic = async () => {
    if (!latestRuntimeDiagnostic) {
      return
    }

    const payload = JSON.stringify(runtimeDiagnostics.length === 1 ? latestRuntimeDiagnostic : runtimeDiagnostics, null, 2)

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(payload)
      } else {
        const input = document.createElement('textarea')
        input.value = payload
        input.setAttribute('readonly', 'true')
        input.style.position = 'fixed'
        input.style.left = '-9999px'
        document.body.appendChild(input)
        input.select()
        document.execCommand('copy')
        document.body.removeChild(input)
      }

      setRuntimeDiagnosticCopied(true)
      window.setTimeout(() => setRuntimeDiagnosticCopied(false), 1500)
    } catch {
      setRuntimeDiagnosticCopied(false)
    }
  }

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

        <section className={`app-main-content min-w-0 w-full flex-1 overflow-x-hidden${isFocusedGigControlView ? ' app-main-content-focus' : ''}`}>
          {isFocusedGigControlView && runtimeBuildTag ? (
            <p className="site-build-tag site-build-tag-overlay" aria-label={`App build ${runtimeBuildTag}`}>
              Build {runtimeBuildTag}
            </p>
          ) : null}
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

          {(runtimeNotice || hasRuntimeDiagnostics) && !isFocusedGigControlView ? (
            <section className="queue-panel" role="status" aria-live="polite">
              <div className="hero-actions no-margin-bottom">
                <div className="w-full min-w-0">
                  <p className="eyebrow">{runtimeNotice ? 'Runtime notice' : 'Runtime diagnostics'}</p>
                  {runtimeNotice ? <p className="subcopy no-margin">{runtimeNotice}</p> : null}
                  {hasRuntimeDiagnostics ? (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="subcopy mb-2">Recent error feed</p>
                      <ul className="max-h-56 space-y-2 overflow-y-auto pr-1">
                        {runtimeDiagnostics.map((diagnostic) => (
                          <li
                            key={`${diagnostic.timestamp}-${diagnostic.source}-${diagnostic.message}`}
                            className="rounded-xl border border-white/5 bg-white/5 p-3"
                          >
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                              {diagnostic.source}
                            </p>
                            <p className="mt-1 break-words text-sm text-white">
                              {diagnostic.message}
                            </p>
                            <p className="mt-1 text-[11px] text-white/45">
                              {new Date(diagnostic.timestamp).toLocaleTimeString()}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {hasRuntimeDiagnostics ? (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        void copyRuntimeDiagnostic()
                      }}
                    >
                      {runtimeDiagnosticCopied ? 'Copied' : runtimeDiagnostics.length > 1 ? 'Copy Feed' : 'Copy Diagnostic'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setRuntimeNotice(null)
                      setRuntimeDiagnostics([])
                      setRuntimeDiagnosticCopied(false)
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        <Outlet />
        {!isFocusedGigControlView ? (
          <footer className="site-legal-footer" aria-label="Copyright notice">
            <p>
              Copyright {new Date().getFullYear()} Haraldur G Asmundsson. All rights reserved. The Human Jukebox name,
              branding, and related content are proprietary. Unauthorized use, reproduction, or distribution is
              prohibited.
            </p>
            {runtimeBuildTag ? <p className="site-build-tag">Build {runtimeBuildTag}</p> : null}
          </footer>
        ) : null}
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

        {!isAdminRoute ? (
          <button
            type="button"
            className="fixed bottom-4 right-4 z-50 h-11 rounded-full border border-fuchsia-400/35 bg-[#0A0A0A] px-4 text-sm font-semibold text-cyan-200 shadow-[0_0_18px_rgba(255,0,255,0.25)] transition-all duration-200 hover:shadow-[0_0_24px_rgba(255,0,255,0.35)]"
            onClick={() => navigate(user || loading ? '/admin/gigs' : '/admin')}
            aria-label={user || loading ? 'Open admin app' : 'Open admin login'}
          >
            {user || loading ? 'Admin' : 'Admin Login'}
          </button>
        ) : null}
      </div>
    </main>
  )
}

export default ShellLayout
