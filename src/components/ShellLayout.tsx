import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AUDIENCE_NAME_COMMITTED_EVENT, readCommittedAudienceName } from '../lib/audienceIdentity'
import { useAuthStore } from '../state/authStore'

const GLOBAL_RUNTIME_NOTICE_EVENT = 'human-jukebox-runtime-notice'

function ShellLayout() {
  const location = useLocation()
  const { user, isHost, loading, signInHost, signOut } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [runtimeNotice, setRuntimeNotice] = useState<string | null>(null)
  const [authActionBusy, setAuthActionBusy] = useState<null | 'sign-in' | 'sign-out'>(null)
  const [hasAudienceAccess, setHasAudienceAccess] = useState(() => Boolean(readCommittedAudienceName()))
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const isAudienceSongListMode = location.pathname.startsWith('/audience/song-list')
  const isAudienceMode = location.pathname.startsWith('/audience') || location.pathname.startsWith('/feed')
  const isAdminMode = location.pathname.startsWith('/admin')
  const showMobileMenu = !isAudienceMode
  const shellClassName = isAudienceSongListMode
    ? 'app-shell app-shell-audience-fullscreen'
    : location.pathname.startsWith('/admin/setlist-library')
    ? 'app-shell app-shell-wide'
    : 'app-shell'
  const topbarClassName = isAdminMode ? 'topbar topbar-admin' : 'topbar'
  const siteNavClassName = [
    'site-nav',
    isAdminMode ? 'site-nav-admin' : '',
    showMobileMenu ? 'site-nav-collapsible' : '',
    isMobileNavOpen ? 'site-nav-open' : '',
  ].filter(Boolean).join(' ')

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
  }, [location.pathname])

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

  return (
    <main className={shellClassName}>
      {!isAudienceSongListMode ? <header className={topbarClassName}>
        <p className="brand" aria-label="The Human Jukebox">
          <img src="/the-human-jukebox-logo.svg" alt="The Human Jukebox" className="brand-logo" />
        </p>
        {showMobileMenu ? (
          <button
            type="button"
            className="mobile-nav-toggle"
            aria-controls="primary-site-nav"
            aria-expanded={isMobileNavOpen}
            aria-label={isMobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            onClick={() => setIsMobileNavOpen((open) => !open)}
          >
            {isMobileNavOpen ? 'Close menu' : 'Menu'}
          </button>
        ) : null}
        <nav id="primary-site-nav" className={siteNavClassName} aria-label="Primary navigation">
          {isAudienceMode ? (
            <>
              <NavLink to="/audience">Audience</NavLink>
              {hasAudienceAccess ? <NavLink to="/feed">Feed</NavLink> : null}
              {isHost ? <NavLink to="/admin/gig-control">Back to Admin</NavLink> : null}
            </>
          ) : (
            <>
              <NavLink to="/" end>Home</NavLink>
              <NavLink to="/audience">Audience</NavLink>
              <NavLink to="/feed">Feed</NavLink>
              {isHost ? (
                <>
                  <NavLink to="/admin" end>Dashboard</NavLink>
                  <NavLink to="/admin/gigs">Gigs</NavLink>
                  <NavLink to="/admin/create-gig">New Gig</NavLink>
                  <NavLink to="/admin/gig-control">Gig Control</NavLink>
                  <NavLink to="/admin/gig-settings">Gig Settings</NavLink>
                  <NavLink to="/admin/setlist-library">Setlist</NavLink>
                  <NavLink to="/admin/settings">Settings</NavLink>
                </>
              ) : (
                <NavLink to="/admin">Admin</NavLink>
              )}
            </>
          )}
        </nav>

        {!isAudienceMode ? (
        <div className="auth-strip">
          {loading ? (
            <span className="meta-badge">Checking session...</span>
          ) : null}

          {!loading && !isHost ? (
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
