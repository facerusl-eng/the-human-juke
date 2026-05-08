import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AUDIENCE_NAME_COMMITTED_EVENT, readCommittedAudienceName } from '../lib/audienceIdentity'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'
import { demoMode } from '../demo/demoMode'
import { DemoBanner } from '../demo/DemoBanner'
import { AiManagerPanel } from './AiManagerPanel'

const GLOBAL_RUNTIME_NOTICE_EVENT = 'human-jukebox-runtime-notice'
const SPOTIFY_ACCESS_TOKEN_STORAGE_KEY = 'human-jukebox-spotify-access-token'

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
  const location = useLocation()
  const navigate = useNavigate()
  const { user, profile, isHost, loading, signInHost, signOut } = useAuthStore()
  const { event } = useQueueStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [runtimeNotice, setRuntimeNotice] = useState<string | null>(null)
  const [networkOnline, setNetworkOnline] = useState(() => navigator.onLine)
  const [authActionBusy, setAuthActionBusy] = useState<null | 'sign-in' | 'sign-out'>(null)
  const [hasAudienceAccess, setHasAudienceAccess] = useState(() => Boolean(readCommittedAudienceName()))
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const [isGigMenuOpen, setIsGigMenuOpen] = useState(false)
  const [isGigMenuForceClosed, setIsGigMenuForceClosed] = useState(false)
  const mobileNavToggleRef = useRef<HTMLButtonElement | null>(null)
  const gigMenuRef = useRef<HTMLDivElement | null>(null)
  const gigMenuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const isAudienceSongListMode = location.pathname.startsWith('/audience/song-list')
  const isAudienceMode = location.pathname.startsWith('/audience') || location.pathname.startsWith('/feed')
  const isAdminMode = location.pathname.startsWith('/admin')
  const isGigNavActive = /^\/admin\/(gigs|create-gig|gig-control|gig-settings|venue-outreach)/.test(location.pathname)
  const showMobileMenu = !isAudienceMode
  const hasLiveGig = Boolean(event?.roomOpen)
  const canOpenFeed = isHost || (hasAudienceAccess && hasLiveGig)
  const shellClassName = isAudienceSongListMode
    ? 'app-shell app-shell-audience-fullscreen'
    : location.pathname.startsWith('/admin/setlist-library')
    ? 'app-shell app-shell-wide'
    : isAudienceMode
    ? 'app-shell app-shell-audience'
    : 'app-shell'
  const topbarClassName = isAdminMode ? 'topbar topbar-admin' : 'topbar'
  const siteNavClassName = [
    'site-nav',
    isAdminMode ? 'site-nav-admin' : '',
    showMobileMenu ? 'site-nav-collapsible' : '',
    isMobileNavOpen ? 'site-nav-open' : '',
  ].filter(Boolean).join(' ')

  const closeGigMenuAfterNavigation = () => {
    setIsGigMenuOpen(false)
    setIsGigMenuForceClosed(true)

    // Prevent :focus-within from keeping the dropdown expanded after click navigation.
    window.requestAnimationFrame(() => {
      const activeElement = document.activeElement

      if (activeElement instanceof HTMLElement) {
        activeElement.blur()
      }
    })
  }

  const closeGigMenu = (focusTrigger = false) => {
    setIsGigMenuOpen(false)
    setIsGigMenuForceClosed(true)

    if (focusTrigger) {
      window.requestAnimationFrame(() => {
        gigMenuTriggerRef.current?.focus()
      })
    }
  }

  useEffect(() => {
    const syncAudienceAccess = () => {
      setHasAudienceAccess(Boolean(readCommittedAudienceName()))
    }

    syncAudienceAccess()
    window.addEventListener('storage', syncAudienceAccess)
    window.addEventListener(AUDIENCE_NAME_COMMITTED_EVENT, syncAudienceAccess)

    return () => {
      window.removeEventListener('storage', syncAudienceAccess)
      window.removeEventListener(AUDIENCE_NAME_COMMITTED_EVENT, syncAudienceAccess)
    }
  }, [])

  useEffect(() => {
    setIsMobileNavOpen(false)
    setIsGigMenuOpen(false)
    setIsGigMenuForceClosed(false)
  }, [location.pathname])

  useEffect(() => {
    if (!isMobileNavOpen && !isGigMenuOpen) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      if (isGigMenuOpen) {
        event.preventDefault()
        closeGigMenu(true)
        return
      }

      if (isMobileNavOpen) {
        event.preventDefault()
        setIsMobileNavOpen(false)
        window.requestAnimationFrame(() => {
          mobileNavToggleRef.current?.focus()
        })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isGigMenuOpen, isMobileNavOpen])

  useEffect(() => {
    if (!authActionBusy) {
      return
    }

    const busyTimeoutId = window.setTimeout(() => {
      setAuthActionBusy(null)
      setErrorText('Auth request timed out. Please try again.')
    }, 30000)

    return () => {
      window.clearTimeout(busyTimeoutId)
    }
  }, [authActionBusy])

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

  useEffect(() => {
    const onOnline = () => setNetworkOnline(true)
    const onOffline = () => setNetworkOnline(false)

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    if (location.pathname === '/callback') {
      return
    }

    const searchParams = new URLSearchParams(location.search)
    const spotifyCode = searchParams.get('code')
    const spotifyAuthError = searchParams.get('error')

    if (!spotifyCode && !spotifyAuthError) {
      return
    }

    if (spotifyAuthError) {
      setRuntimeNotice('Spotify authorization was cancelled or denied.')
      return
    }

    let cancelled = false

    setRuntimeNotice('Finishing Spotify login...')

    void (async () => {
      try {
        const response = await fetch(`/api/spotify/callback?code=${encodeURIComponent(spotifyCode as string)}`)
        const payload = await response.json().catch(() => ({}))

        if (!response.ok || typeof payload.access_token !== 'string') {
          throw new Error(payload.error || 'Spotify login failed.')
        }

        window.localStorage.setItem(SPOTIFY_ACCESS_TOKEN_STORAGE_KEY, payload.access_token)

        if (!cancelled) {
          setRuntimeNotice('Spotify connected. Redirecting to Gig Control...')
          navigate('/admin/gig-control', { replace: true })
        }
      } catch (error) {
        if (cancelled) {
          return
        }

        setRuntimeNotice(error instanceof Error ? error.message : 'Spotify callback failed.')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [location.pathname, location.search, navigate])

  return (
    <main className={[shellClassName, demoMode ? 'app-shell-demo' : ''].filter(Boolean).join(' ')}>
      {demoMode ? <DemoBanner /> : null}
      {!isAudienceMode ? <header className={topbarClassName}>
        <NavLink to="/" className="brand" aria-label="Go to Home page">
          <img src="/the-human-jukebox-logo.svg" alt="The Human Jukebox" className="brand-logo" />
        </NavLink>
        <span className={`meta-badge connection-badge ${networkOnline ? 'connection-online' : 'connection-offline'}`}>
          {networkOnline ? 'Online' : 'Offline'}
        </span>
        {showMobileMenu ? (
          <button
            type="button"
            ref={mobileNavToggleRef}
            className="mobile-nav-toggle"
            aria-controls="primary-site-nav"
            aria-label={isMobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            onClick={() => setIsMobileNavOpen((open) => !open)}
          >
            {isMobileNavOpen ? 'Close menu' : 'Menu'}
          </button>
        ) : null}
        <nav
          id="primary-site-nav"
          className={siteNavClassName}
          aria-label="Primary navigation"
          onClick={(event) => {
            const clickTarget = event.target as HTMLElement

            if (showMobileMenu && isMobileNavOpen && clickTarget.closest('a')) {
              setIsMobileNavOpen(false)
            }
          }}
        >
          {isAudienceMode ? (
            <>
              <NavLink to="/audience">Audience</NavLink>
              {canOpenFeed ? <NavLink to="/feed">Feed</NavLink> : null}
              {isHost ? <NavLink to="/admin/gig-control">Back to Admin</NavLink> : null}
            </>
          ) : (
            <>
              <NavLink to="/" end>Home</NavLink>
              {isHost ? <NavLink to="/admin/received-bookings">Received Bookings</NavLink> : <NavLink to="/book-show">Book Show</NavLink>}
              <NavLink to="/audience">Audience</NavLink>
              {canOpenFeed ? <NavLink to="/feed">Feed</NavLink> : null}
              {isHost ? (
                <>
                  <NavLink to="/admin" end>Dashboard</NavLink>
                  <div
                    ref={gigMenuRef}
                    className={[
                      'nav-dropdown',
                      'gigs-nav-dropdown',
                      isGigMenuOpen ? 'nav-dropdown-open' : '',
                      isGigMenuForceClosed ? 'nav-dropdown-force-closed' : '',
                    ].filter(Boolean).join(' ')}
                    onMouseEnter={() => {
                      if (isGigMenuForceClosed) {
                        return
                      }

                      setIsGigMenuOpen(true)
                    }}
                    onMouseLeave={() => {
                      setIsGigMenuOpen(false)
                      setIsGigMenuForceClosed(false)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') {
                        return
                      }

                      event.preventDefault()
                      closeGigMenu(true)
                    }}
                  >
                    <button
                      type="button"
                      ref={gigMenuTriggerRef}
                      className={`nav-dropdown-trigger ${isGigNavActive ? 'active' : ''}`.trim()}
                      aria-label="Open gig navigation"
                      aria-haspopup="true"
                      aria-controls="gig-nav-menu"
                      onKeyDown={(event) => {
                        if (event.key !== 'ArrowDown') {
                          return
                        }

                        event.preventDefault()
                        setIsGigMenuForceClosed(false)
                        setIsGigMenuOpen(true)

                        window.requestAnimationFrame(() => {
                          const firstMenuLink = gigMenuRef.current?.querySelector<HTMLAnchorElement>('.nav-dropdown-menu a')
                          firstMenuLink?.focus()
                        })
                      }}
                      onClick={() => {
                        setIsGigMenuForceClosed(false)
                        setIsGigMenuOpen((open) => !open)
                      }}
                    >
                      Gigs
                    </button>
                    <div id="gig-nav-menu" className="nav-dropdown-menu" aria-label="Gig navigation menu">
                      <NavLink to="/admin/gigs" onClick={closeGigMenuAfterNavigation}>All Gigs</NavLink>
                      <NavLink to="/admin/create-gig" onClick={closeGigMenuAfterNavigation}>New Gig</NavLink>
                      <NavLink to="/admin/gig-control" onClick={closeGigMenuAfterNavigation}>Gig Control</NavLink>
                      <NavLink to="/admin/gig-settings" onClick={closeGigMenuAfterNavigation}>Gig Settings</NavLink>
                      <NavLink to="/admin/venue-outreach" onClick={closeGigMenuAfterNavigation}>Venue Outreach</NavLink>
                    </div>
                  </div>
                  <NavLink to="/admin/health-check">Health Check</NavLink>
                  <NavLink to="/admin/setlist-library">Setlist</NavLink>
                  <NavLink to="/admin/settings">Settings</NavLink>
                </>
              ) : (
                !demoMode ? <NavLink to="/admin">Admin</NavLink> : null
              )}
            </>
          )}
        </nav>

        {!isAudienceMode ? (
        <div className="auth-strip">
          {loading ? (
            <span className="meta-badge">Checking session...</span>
          ) : null}

          {!loading && !isHost && !demoMode ? (
            <form
              className="inline-auth-form"
              onSubmit={async (event) => {
                event.preventDefault()
                setErrorText(null)

                if (!email.trim() || !password.trim()) {
                  setErrorText('Email and password are required.')
                  return
                }

                if (authActionBusy) {
                  return
                }

                setAuthActionBusy('sign-in')

                try {
                  await signInHost(email.trim(), password.trim())
                } catch (error) {
                  console.warn('ShellLayout: host sign-in failed', error)
                  if (error instanceof Error) {
                    setErrorText(error.message)
                    return
                  }

                  setErrorText('Admin sign-in failed.')
                } finally {
                  setAuthActionBusy(null)
                }
              }}
            >
              <input
                type="email"
                placeholder="halligunnar@icloud.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                maxLength={120}
                required
                aria-required="true"
                disabled={Boolean(authActionBusy)}
              />
              <input
                type="password"
                placeholder="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                maxLength={128}
                required
                aria-required="true"
                disabled={Boolean(authActionBusy)}
              />
              <button type="submit" className="primary-button" disabled={Boolean(authActionBusy)}>
                {authActionBusy === 'sign-in' ? 'Signing in...' : 'Admin Sign In'}
              </button>
            </form>
          ) : null}

          {!loading && user ? (
            <>
              <span className="meta-badge">Session: {isHost ? 'Admin' : 'User'}</span>
              <button
                type="button"
                className="ghost-button"
                disabled={Boolean(authActionBusy)}
                onClick={async () => {
                  if (authActionBusy) {
                    return
                  }

                  setErrorText(null)
                  setAuthActionBusy('sign-out')

                  try {
                    await signOut()
                  } catch (error) {
                    console.warn('ShellLayout: sign-out failed', error)
                    setErrorText('Sign out failed.')
                  } finally {
                    setAuthActionBusy(null)
                  }
                }}
              >
                {authActionBusy === 'sign-out' ? 'Signing out...' : 'Sign Out'}
              </button>
            </>
          ) : null}

          {errorText ? <p className="error-text">{errorText}</p> : null}
        </div>
        ) : null}
      </header> : null}
      {runtimeNotice && !isAudienceSongListMode ? (
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
      {isHost && isAdminMode ? <AiManagerPanel /> : null}
      {!isAudienceSongListMode ? <footer className="site-legal-footer" aria-label="Copyright notice">
        <p>
          © {new Date().getFullYear()} Haraldur G Asmundsson. All rights reserved. The Human Jukebox name,
          branding, and related content are proprietary. Unauthorized use, reproduction, or distribution is
          prohibited.
        </p>
      </footer> : null}
    </main>
  )
}

export default ShellLayout
