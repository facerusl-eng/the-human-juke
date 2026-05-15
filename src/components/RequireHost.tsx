import { useEffect, useState } from 'react'
import type { PropsWithChildren } from 'react'
import { useAuthStore } from '../state/authStore'

const HOST_GATE_LOADING_TIMEOUT_MS = 2500

function RequireHost({ children }: PropsWithChildren) {
  const {
    user,
    isHost,
    loading,
    authError,
    signInHost,
    registerHostPasskey,
    isPasskeySupported,
  } = useAuthStore()
  const [showLoadingFallback, setShowLoadingFallback] = useState(false)
  const [hostEmail, setHostEmail] = useState('')
  const [hostPassword, setHostPassword] = useState('')
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [passkeyNotice, setPasskeyNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!loading) {
      setShowLoadingFallback(false)
      return
    }

    const timerId = window.setTimeout(() => {
      setShowLoadingFallback(true)
    }, HOST_GATE_LOADING_TIMEOUT_MS)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [loading])

  if (loading) {
    return (
      <section className="queue-panel host-gate" aria-live="polite">
        <h2>Loading access...</h2>
        {!showLoadingFallback ? (
          <p className="subcopy">Checking your admin session.</p>
        ) : (
          <>
            <p className="subcopy">
              Access check is taking longer than expected. You can retry without leaving this page.
            </p>
            {authError ? <p className="error-text">{authError}</p> : null}
            <div className="hero-actions no-margin-bottom">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  window.location.reload()
                }}
              >
                Retry Access Check
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  window.location.assign('/admin')
                }}
              >
                Open Admin Dashboard
              </button>
            </div>
          </>
        )}
      </section>
    )
  }

  if (!user) {
    return (
      <section className="queue-panel host-gate">
        <h2>Admin sign in required</h2>
        <p className="subcopy">Sign in with the host email and password from the top bar.</p>
      </section>
    )
  }

  if (isHost) {
    return <>{children}</>
  }

  const handleHostSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setSignInError(null)
    setPasskeyNotice(null)
    setIsSigningIn(true)

    try {
      await signInHost(hostEmail, hostPassword)
      setHostEmail('')
      setHostPassword('')
    } catch (error) {
      setSignInError(error instanceof Error ? error.message : 'Failed to sign in. Please try again.')
    } finally {
      setIsSigningIn(false)
    }
  }

  const handleEnablePasskey = async () => {
    setSignInError(null)
    setPasskeyNotice(null)
    setIsSigningIn(true)

    try {
      await signInHost(hostEmail, hostPassword)
      await registerHostPasskey('Host Face ID')
      setPasskeyNotice('Face ID is enabled on this iPhone.')
      setHostPassword('')
    } catch (error) {
      setSignInError(error instanceof Error ? error.message : 'Face ID setup failed. Please try again.')
    } finally {
      setIsSigningIn(false)
    }
  }

  return (
    <section className="queue-panel host-gate">
      <h2>Host Account Required</h2>
      <p className="subcopy">
        This account does not have admin access. Sign in below with your host email and password.
      </p>
      
      <form onSubmit={handleHostSignIn} className="admin-mobile-action-grid">
        <div className="form-group">
          <label htmlFor="host-email">Host Email</label>
          <input
            id="host-email"
            type="email"
            value={hostEmail}
            onChange={(e) => setHostEmail(e.target.value)}
            placeholder="your@host.email"
            disabled={isSigningIn}
            required
          />
        </div>
        
        <div className="form-group">
          <label htmlFor="host-password">Password</label>
          <input
            id="host-password"
            type="password"
            value={hostPassword}
            onChange={(e) => setHostPassword(e.target.value)}
            placeholder="••••••••"
            disabled={isSigningIn}
            required
          />
        </div>

        {signInError && (
          <p className="error-text">{signInError}</p>
        )}

        {passkeyNotice && (
          <p className="subcopy">{passkeyNotice}</p>
        )}

        <button
          type="submit"
          className="primary-button"
          disabled={isSigningIn || !hostEmail || !hostPassword}
        >
          {isSigningIn ? 'Signing in...' : 'Sign in as Host'}
        </button>

        {isPasskeySupported ? (
          <button
            type="button"
            className="ghost-button"
            disabled={isSigningIn || !hostEmail || !hostPassword}
            onClick={handleEnablePasskey}
          >
            Enable Face ID on this iPhone
          </button>
        ) : null}
      </form>
    </section>
  )
}

export default RequireHost
