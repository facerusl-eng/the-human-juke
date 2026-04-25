import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AUDIENCE_NAME_COMMITTED_EVENT, readCommittedAudienceName } from '../lib/audienceIdentity'
import { useAuthStore } from '../state/authStore'

function ShellLayout() {
  const location = useLocation()
  const { user, isHost, loading, signInHost, signOut } = useAuthStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [hasAudienceAccess, setHasAudienceAccess] = useState(() => Boolean(readCommittedAudienceName()))
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const isAudienceMode = location.pathname.startsWith('/audience') || location.pathname.startsWith('/feed')
  const isAdminMode = location.pathname.startsWith('/admin')
  const showAdminMobileMenu = isAdminMode && !isAudienceMode
  const showPhotoNavActions = location.pathname === '/'
  const shellClassName = location.pathname.startsWith('/admin/setlist-library')
    ? 'app-shell app-shell-wide'
    : 'app-shell'
  const topbarClassName = isAdminMode ? 'topbar topbar-admin' : 'topbar'
  const siteNavClassName = [
    'site-nav',
    isAdminMode ? 'site-nav-admin' : '',
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

  return (
    <main className={shellClassName}>
      <header className={topbarClassName}>
        <p className="brand" aria-label="The Human Jukebox">
          <img src="/the-human-jukebox-logo.svg" alt="The Human Jukebox" className="brand-logo" />
        </p>
        {showAdminMobileMenu ? (
          <button
            type="button"
            className="mobile-nav-toggle"
            aria-expanded={isMobileNavOpen ? 'true' : 'false'}
            aria-controls="primary-site-nav"
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
              {showPhotoNavActions ? (
                <NavLink
                  to="/audience"
                  className="top-nav-logo-link top-nav-logo-link-audience"
                  aria-label="Audience"
                  title="Open the live queue and request songs"
                >
                  <img src="/the-human-jukebox-logo.svg" alt="" className="top-nav-logo-image" aria-hidden="true" />
                </NavLink>
              ) : (
                <NavLink to="/audience">Audience</NavLink>
              )}
              <NavLink to="/feed">Feed</NavLink>
              {isHost ? (
                <>
                  {showPhotoNavActions ? (
                    <NavLink
                      to="/admin"
                      end
                      className="top-nav-logo-link top-nav-logo-link-admin"
                      aria-label="Dashboard"
                      title="Open host tools and event controls"
                    >
                      <img src="/the-human-jukebox-logo.svg" alt="" className="top-nav-logo-image" aria-hidden="true" />
                    </NavLink>
                  ) : (
                    <NavLink to="/admin" end>Dashboard</NavLink>
                  )}
                  <NavLink to="/admin/gigs">Gigs</NavLink>
                  <NavLink to="/admin/create-gig">New Gig</NavLink>
                  <NavLink to="/admin/gig-control">Gig Control</NavLink>
                  <NavLink to="/admin/gig-settings">Gig Settings</NavLink>
                  <NavLink to="/admin/setlist-library">Setlist</NavLink>
                  <NavLink to="/admin/settings">Settings</NavLink>
                </>
              ) : (
                showPhotoNavActions ? (
                  <NavLink
                    to="/admin"
                    className="top-nav-logo-link top-nav-logo-link-admin"
                    aria-label="Admin"
                    title="Sign in and manage your event"
                  >
                    <img src="/the-human-jukebox-logo.svg" alt="" className="top-nav-logo-image" aria-hidden="true" />
                  </NavLink>
                ) : (
                  <NavLink to="/admin">Admin</NavLink>
                )
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

                try {
                  await signInHost(email.trim(), password.trim())
                } catch (error) {
                  if (error instanceof Error) {
                    setErrorText(error.message)
                    return
                  }

                  setErrorText('Admin sign-in failed.')
                }
              }}
            >
              <input
                type="email"
                placeholder="halligunnar@icloud.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <input
                type="password"
                placeholder="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button type="submit" className="primary-button">
                Admin Sign In
              </button>
            </form>
          ) : null}

          {!loading && user ? (
            <>
              <span className="meta-badge">Session: {isHost ? 'Admin' : 'User'}</span>
              <button
                type="button"
                className="ghost-button"
                onClick={async () => {
                  setErrorText(null)
                  try {
                    await signOut()
                  } catch {
                    setErrorText('Sign out failed.')
                  }
                }}
              >
                Sign Out
              </button>
            </>
          ) : null}

          {errorText ? <p className="error-text">{errorText}</p> : null}
        </div>
        ) : null}
      </header>
      <Outlet />
      <footer className="site-legal-footer" aria-label="Copyright notice">
        <p>
          © {new Date().getFullYear()} Haraldur G Asmundsson. All rights reserved. The Human Jukebox name,
          branding, and related content are proprietary. Unauthorized use, reproduction, or distribution is
          prohibited.
        </p>
      </footer>
    </main>
  )
}

export default ShellLayout
