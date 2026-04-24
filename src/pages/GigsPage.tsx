import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueueStore } from '../state/queueStore'

function formatGigDate(createdAt: string) {
  if (!createdAt) {
    return 'Created recently'
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(createdAt))
}

function GigsPage() {
  const navigate = useNavigate()
  const { event, hostEvents, setActiveEvent, deleteEvent } = useQueueStore()
  const [activatingEventId, setActivatingEventId] = useState<string | null>(null)
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)

  const chooseGig = async (gigId: string, goToControl = true) => {
    setErrorText(null)
    setActivatingEventId(gigId)

    try {
      await setActiveEvent(gigId)

      if (goToControl) {
        navigate('/admin/gig-control')
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to switch gig. Please try again.')
    } finally {
      setActivatingEventId(null)
    }
  }

  const removeGig = async (gigId: string, gigName: string) => {
    const confirmed = window.confirm(`Delete "${gigName}"? This removes its queue, feed posts, and mirror state.`)

    if (!confirmed) {
      return
    }

    setErrorText(null)
    setDeletingEventId(gigId)

    try {
      await deleteEvent(gigId)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to delete gig. Please try again.')
    } finally {
      setDeletingEventId(null)
    }
  }

  return (
    <section className="gigs-shell" aria-label="Gig management">
      <section className="hero-card gigs-hero-card">
        <p className="eyebrow">Gig Manager</p>
        <h1>Your Gigs</h1>
        <p className="subcopy">
          See every gig you have created, choose which one to control, and remove gigs you no longer want.
        </p>
        <div className="hero-actions no-margin-bottom">
          <button type="button" className="primary-button" onClick={() => navigate('/admin/create-gig')}>
            Create Gig
          </button>
          <button type="button" className="secondary-button" onClick={() => navigate('/admin')}>
            Back to Dashboard
          </button>
        </div>
      </section>

      <section className="queue-panel gigs-list-panel" aria-label="Created gigs list">
        <div className="panel-head">
          <h2>Saved Gigs</h2>
          <span className="meta-badge">{hostEvents.length} total</span>
        </div>

        {hostEvents.length === 0 ? (
          <p className="subcopy no-margin-bottom">No gigs yet. Create your first gig to start taking requests.</p>
        ) : (
          <ul className="gig-management-list">
            {hostEvents.map((hostEvent) => {
              const isCurrentGig = event?.id === hostEvent.id
              const isActivating = activatingEventId === hostEvent.id
              const isDeleting = deletingEventId === hostEvent.id
              const isBusy = isActivating || isDeleting

              return (
                <li key={hostEvent.id} className="gig-management-entry">
                  <div className="gig-management-main">
                    <div className="gig-management-title-row">
                      <p className="gig-management-title">{hostEvent.name}</p>
                      {hostEvent.isActive ? <span className="meta-badge">Live for audience</span> : null}
                      {isCurrentGig ? <span className="meta-badge">Open in control panel</span> : null}
                    </div>
                    <p className="gig-management-meta">{hostEvent.venue ?? 'No venue set'}</p>
                    <p className="gig-management-meta">Created {formatGigDate(hostEvent.createdAt)}</p>
                  </div>

                  <div className="gig-management-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={isBusy}
                      onClick={() => {
                        if (isCurrentGig) {
                          navigate('/admin/gig-control')
                          return
                        }

                        void chooseGig(hostEvent.id)
                      }}
                    >
                      {isCurrentGig ? 'Open Control' : isActivating ? 'Choosing…' : 'Choose Gig'}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={hostEvent.isActive || isBusy}
                      onClick={() => {
                        void chooseGig(hostEvent.id, false)
                      }}
                    >
                      {hostEvent.isActive ? 'Live Now' : isActivating ? 'Switching…' : 'Set Live Only'}
                    </button>
                    <button
                      type="button"
                      className="ghost-button danger-button"
                      disabled={isBusy}
                      onClick={() => {
                        void removeGig(hostEvent.id, hostEvent.name)
                      }}
                    >
                      {isDeleting ? 'Deleting…' : 'Delete Gig'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {errorText ? <p className="error-text">{errorText}</p> : null}
      </section>
    </section>
  )
}

export default GigsPage
