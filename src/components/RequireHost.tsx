import { useEffect, useState } from 'react'
import type { PropsWithChildren } from 'react'
import { useAuthStore } from '../state/authStore'

const HOST_GATE_LOADING_TIMEOUT_MS = 7000

function RequireHost({ children }: PropsWithChildren) {
  const { user, isHost, loading, authError } = useAuthStore()
  const [showLoadingFallback, setShowLoadingFallback] = useState(false)

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

  return (
    <section className="queue-panel host-gate">
      <h2>Host Account Required</h2>
      <p className="subcopy">
        This account does not have admin access. Sign out and sign in with the host
        email/password to access admin controls.
      </p>
    </section>
  )
}

export default RequireHost
