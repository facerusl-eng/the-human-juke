import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueueStore } from '../state/queueStore'

function AdminPage() {
  const navigate = useNavigate()
  const { event, hostEvents, songs, setActiveEvent, toggleRoomOpen, toggleExplicitFilter } = useQueueStore()
  const [activatingEventId, setActivatingEventId] = useState<string | null>(null)
  const [activeSwitchError, setActiveSwitchError] = useState<string | null>(null)
  const totalVotes = songs.reduce((sum, song) => sum + song.votes_count, 0)

  return (
    <section className="admin-shell" aria-label="Admin dashboard">
      {/* Hub header */}
      <section className="hero-card admin-card">
        <p className="eyebrow">Host Dashboard</p>
        <h1>Human Jukebox</h1>
        <p className="subcopy">
          Create and run live song request boards for your audience. Pick a gig to get started.
        </p>

        {event ? (
          <ul className="stats" aria-label="Active gig stats">
            <li>
              <strong>{event.name}</strong>
              <span>Active Gig</span>
            </li>
            <li>
              <strong>{event.roomOpen ? 'Open' : 'Paused'}</strong>
              <span>Queue Status</span>
            </li>
            <li>
              <strong>{songs.length}</strong>
              <span>Queued Tracks</span>
            </li>
            <li>
              <strong>{totalVotes}</strong>
              <span>Total Votes</span>
            </li>
            <li>
              <strong>{event.explicitFilterEnabled ? 'On' : 'Off'}</strong>
              <span>Explicit Filter</span>
            </li>
          </ul>
        ) : (
          <p className="subcopy no-margin-bottom">No active gig. Create one to start accepting requests.</p>
        )}
      </section>

      {/* Action cards */}
      <div className="admin-hub-grid">
        <button
          type="button"
          className="admin-hub-card"
          onClick={() => navigate('/admin/gigs')}
        >
          <span className="hub-icon">🗂</span>
          <strong>Gigs</strong>
          <p>See every gig you have created, choose one to run, or delete old gigs.</p>
        </button>

        <button
          type="button"
          className="admin-hub-card"
          onClick={() => navigate('/admin/create-gig')}
        >
          <span className="hub-icon">＋</span>
          <strong>Create Gig</strong>
          <p>Set up a new event and open the stage for requests.</p>
        </button>

        <button
          type="button"
          className="admin-hub-card"
          onClick={() => navigate('/admin/gig-control')}
          disabled={!event}
        >
          <span className="hub-icon">🎚</span>
          <strong>Gig Control</strong>
          <p>Mark songs as played, skip tracks, and manage the live queue.</p>
        </button>

        <button
          type="button"
          className="admin-hub-card"
          onClick={() => navigate('/admin/gig-settings')}
          disabled={!event}
        >
          <span className="hub-icon">🛠</span>
          <strong>Gig Settings</strong>
          <p>Edit the active show details, audience access, and live room rules.</p>
        </button>

        <button
          type="button"
          className="admin-hub-card"
          onClick={() => window.open('/mirror', '_blank')}
          disabled={!event}
        >
          <span className="hub-icon">📺</span>
          <strong>Mirror Screen</strong>
          <p>Open a full-screen display for your venue TV or second monitor.</p>
        </button>

        <button
          type="button"
          className="admin-hub-card"
          onClick={() => navigate('/audience')}
        >
          <span className="hub-icon">🎵</span>
          <strong>Audience View</strong>
          <p>See what the crowd sees — live queue and request form.</p>
        </button>

        <button
          type="button"
          className="admin-hub-card"
          onClick={() => navigate('/admin/settings')}
        >
          <span className="hub-icon">⚙️</span>
          <strong>Settings</strong>
          <p>Edit your profile, social links, tip jar, and event defaults.</p>
        </button>

        <button
          type="button"
          className="admin-hub-card"
          onClick={() => navigate('/admin/setlist-library')}
        >
          <span className="hub-icon">📚</span>
          <strong>Setlist Library</strong>
          <p>Browse your core repertoire, search songs, and manage the main playlist.</p>
        </button>
      </div>

      <section className="queue-panel admin-quick-controls" aria-label="Gig switcher">
        <div className="panel-head">
          <h2>Audience Active Gig</h2>
        </div>

        {hostEvents.length === 0 ? (
          <p className="subcopy no-margin-bottom">No gigs yet. Create your first gig to get started.</p>
        ) : (
          <ul className="queue-list">
            {hostEvents.map((hostEvent) => {
              const isBusy = activatingEventId === hostEvent.id

              return (
                <li key={hostEvent.id}>
                  <div>
                    <p className="song">{hostEvent.name}</p>
                    <p className="artist">{hostEvent.venue ?? 'No venue set'}</p>
                    <p className="artist">
                      {hostEvent.isActive ? 'Live for audience' : 'Not live for audience'}
                      {event?.id === hostEvent.id ? ' · Open in your control panel' : ''}
                    </p>
                  </div>
                  <div className="queue-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={hostEvent.isActive || isBusy}
                      onClick={async () => {
                        setActiveSwitchError(null)
                        setActivatingEventId(hostEvent.id)

                        try {
                          await setActiveEvent(hostEvent.id)
                        } catch (error) {
                          if (error instanceof Error) {
                            setActiveSwitchError(error.message)
                          } else {
                            setActiveSwitchError('Failed to change active gig. Please try again.')
                          }
                        } finally {
                          setActivatingEventId(null)
                        }
                      }}
                    >
                      {hostEvent.isActive ? 'Live Now' : isBusy ? 'Switching…' : 'Set Live for Audience'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {activeSwitchError ? <p className="error-text">{activeSwitchError}</p> : null}
      </section>

      {/* Quick controls for active gig */}
      {event ? (
        <section className="queue-panel admin-quick-controls">
          <div className="panel-head">
            <h2>Quick Controls</h2>
            <span className="meta-badge">{event.name}</span>
          </div>
          <div className="hero-actions">
            <button
              type="button"
              className={event.roomOpen ? 'secondary-button' : 'primary-button'}
              onClick={async () => { await toggleRoomOpen() }}
            >
              {event.roomOpen ? 'Pause Queue' : 'Open Queue'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={async () => { await toggleExplicitFilter() }}
            >
              {event.explicitFilterEnabled ? 'Allow Explicit' : 'Block Explicit'}
            </button>
          </div>
        </section>
      ) : null}
    </section>
  )
}

export default AdminPage

