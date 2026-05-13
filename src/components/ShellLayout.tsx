import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../state/authStore'
import { demoMode } from '../demo/demoMode'
import { DemoBanner } from '../demo/DemoBanner'
import SideNavigation from './SideNavigation'

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

function ShellLayout() {
  const { profile, user, loading } = useAuthStore()
  const location = useLocation()
  const [runtimeNotice, setRuntimeNotice] = useState<string | null>(null)
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
      </div>
    </main>
  )
}

export default ShellLayout
