import { useEffect, useState } from 'react'
import type { PropsWithChildren } from 'react'
import { useAuthStore } from '../state/authStore'
import { supabase } from '../lib/supabase'

const HOST_GATE_LOADING_TIMEOUT_MS = 2500
const HOST_SIGN_IN_UI_TIMEOUT_MS = 30_000

function withHostSignInUiTimeout<T>(promise: Promise<T>) {
  let timeoutId: number | null = null

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error('Sign-in is taking too long. Please try again.'))
    }, HOST_SIGN_IN_UI_TIMEOUT_MS)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
    }
  }) as Promise<T>
}

function RequireHost({ children }: PropsWithChildren) {
  const {
    user,
    isHost,
    loading,
    authError,
    signInHost,
  } = useAuthStore()
  const [showLoadingFallback, setShowLoadingFallback] = useState(false)
  const [hostEmail, setHostEmail] = useState('')
  const [hostPassword, setHostPassword] = useState('')
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [showForgot, setShowForgot] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetStatus, setResetStatus] = useState<string | null>(null)
  const [resetBusy, setResetBusy] = useState(false)

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
        {authError ? <p className="error-text">{authError}</p> : null}
        <div className="hero-actions no-margin-bottom">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              window.location.reload()
            }}
          >
            Retry
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              window.location.assign('/audience')
            }}
          >
            Open Audience
          </button>
        </div>
      </section>
    )
  }

  if (isHost) {
    return <>{children}</>
  }

  const handleHostSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setSignInError(null)
    setIsSigningIn(true)

    try {
      await withHostSignInUiTimeout(signInHost(hostEmail, hostPassword))
      setHostEmail('')
      setHostPassword('')
    } catch (error) {
      setSignInError(error instanceof Error ? error.message : 'Failed to sign in. Please try again.')
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
      {showForgot ? (
        <form
          className="admin-mobile-action-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            setResetStatus(null);
            setResetBusy(true);
            try {
              const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim())
              if (error) {
                setResetStatus(error.message || 'Failed to send reset email.');
              } else {
                setResetStatus('If this email is registered, a reset link has been sent.');
              }
            } catch {
              setResetStatus('Failed to send reset email.');
            } finally {
              setResetBusy(false);
            }
          }}
        >
          <div className="form-group">
            <label htmlFor="reset-email">Email address</label>
            <input
              id="reset-email"
              type="email"
              value={resetEmail}
              onChange={e => setResetEmail(e.target.value)}
              placeholder="your@host.email"
              required
              disabled={resetBusy}
            />
          </div>
          {resetStatus && <p className="error-text">{resetStatus}</p>}
          <button type="submit" className="primary-button" disabled={resetBusy || !resetEmail}>
            {resetBusy ? 'Sending...' : 'Send reset link'}
          </button>
          <button type="button" className="ghost-button" onClick={() => setShowForgot(false)} disabled={resetBusy}>
            Back to sign in
          </button>
        </form>
      ) : (
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
          <button
            type="button"
            className="ghost-button"
            style={{ marginBottom: 8, textAlign: 'left' }}
            onClick={() => setShowForgot(true)}
            disabled={isSigningIn}
          >
            Forgot password?
          </button>
          {signInError && (
            <p className="error-text">{signInError}</p>
          )}
          <button
            type="submit"
            className="primary-button"
            disabled={isSigningIn || !hostEmail || !hostPassword}
          >
            {isSigningIn ? 'Signing in...' : 'Sign in as Host'}
          </button>
        </form>
      )}
    </section>
  )
}

export default RequireHost
