import type { PropsWithChildren } from 'react'
import { useAuthStore } from '../state/authStore'

function RequireHost({ children }: PropsWithChildren) {
  const { user, isHost, loading } = useAuthStore()

  if (loading) {
    return <section className="queue-panel host-gate">Loading access...</section>
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
