import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'

function CreateGigPage() {
  const navigate = useNavigate()
  const { isHost, loading } = useAuthStore()
  const { event, createEvent } = useQueueStore()
  const [gigName, setGigName] = useState('')
  const [venue, setVenue] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  const isAuthLockError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    return /lock broken|steal option|navigatorlockacquiretimeouterror|auth-token|released because another request stole it/i.test(message)
  }

  const isEventsRlsInsertError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    return /row-level security policy.*events/i.test(message)
  }

  const runCreateWithLockRetry = async (name: string, nextVenue: string) => {
    const maxAttempts = 6

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
      try {
        await createEvent(name, nextVenue)
        return
      } catch (error) {
        const isLastAttempt = attemptIndex === maxAttempts - 1

        if (!isAuthLockError(error) || isLastAttempt) {
          throw error
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 450 * (attemptIndex + 1))
        })
      }
    }
  }

  const withSubmitTimeout = <T,>(promise: Promise<T>) => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        window.setTimeout(() => {
          reject(new Error('Create gig is taking longer than expected. Please wait a moment and try again.'))
        }, 35_000)
      }),
    ])
  }

  const onSubmit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault()
    setErrorText(null)

    if (!gigName.trim()) {
      setErrorText('Gig name is required.')
      return
    }

    setBusy(true)

    try {
      await withSubmitTimeout(runCreateWithLockRetry(gigName.trim(), venue.trim()))
      navigate('/admin/gig-control')
    } catch (error) {
      if (isAuthLockError(error)) {
        setErrorText('Session lock is busy. Close duplicate admin tabs, wait 2 seconds, then try Create Gig again.')
        return
      }

      if (isEventsRlsInsertError(error)) {
        setErrorText('Create Gig was blocked by database permissions for this session. Sign out, sign back in with the host account, and try again.')
        return
      }

      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message?: unknown }).message)
            : 'Failed to create gig. Check your connection and try again.'
      setErrorText(errorMessage)
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <section className="create-gig-shell"><section className="queue-panel">Checking host access...</section></section>
  }

  if (!isHost) {
    return (
      <section className="create-gig-shell" aria-label="Create gig">
        <section className="hero-card create-gig-card">
          <p className="eyebrow">Host Required</p>
          <h1>Create a New Gig</h1>
          <p className="subcopy">
            Sign out of this session, then sign back in with the host email to create and manage gigs.
          </p>
          <div className="hero-actions no-margin-bottom">
            <button type="button" className="secondary-button" onClick={() => navigate('/admin')}>
              Back to Dashboard
            </button>
          </div>
        </section>
      </section>
    )
  }

  return (
    <section className="create-gig-shell" aria-label="Create gig">
      <section className="hero-card create-gig-card">
        <p className="eyebrow">Setup</p>
        <h1>Create a New Gig</h1>
        <p className="subcopy">
          Name your gig now, then choose from the dashboard which gig is live for your audience.
        </p>

        {event ? (
          <div className="active-gig-notice">
            <p className="meta-badge">Active gig: {event.name}{event.venue ? ` · ${event.venue}` : ''}</p>
            <p className="subcopy subcopy-top-gap">
              Creating a new gig saves it to your list. You can set any saved gig as the active audience room from the dashboard.
            </p>
          </div>
        ) : null}

        <form className="queue-form create-gig-form" onSubmit={onSubmit}>
          <div className="field-row">
            <label htmlFor="gig-name">Gig name *</label>
            <input
              id="gig-name"
              value={gigName}
              onChange={(e) => setGigName(e.target.value)}
              placeholder="Friday Night at The Anchor"
              autoFocus
            />
          </div>
          <div className="field-row">
            <label htmlFor="venue">Venue (optional)</label>
            <input
              id="venue"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="The Anchor Bar, Main Stage"
            />
          </div>
          {errorText ? <p className="error-text">{errorText}</p> : null}
          <div className="hero-actions">
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Creating…' : 'Create Gig'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate('/admin')}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    </section>
  )
}

export default CreateGigPage
