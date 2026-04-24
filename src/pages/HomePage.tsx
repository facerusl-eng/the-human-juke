import { useNavigate } from 'react-router-dom'
import { useQueueStore } from '../state/queueStore'

function HomePage() {
  const navigate = useNavigate()
  const { songs, event } = useQueueStore()
  const topSongs = songs.slice(0, 3)

  return (
    <section className="home-shell" aria-label="Home page">
      <section className="hero-card home-hero-card">
        <p className="eyebrow">Live song requests for events</p>
        <h1>The crowd picks. The music flows.</h1>
        <p className="subcopy">
          Run a live request board where guests queue songs, vote priorities,
          and keep the room in sync with the vibe.
        </p>

        <div className="hero-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => navigate('/admin')}
          >
            Create Event
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => navigate('/audience')}
          >
            Join Queue
          </button>
        </div>

        <ul className="stats" aria-label="Platform stats">
          <li>
            <strong>1.2K</strong>
            <span>Events Hosted</span>
          </li>
          <li>
            <strong>48K</strong>
            <span>Songs Played</span>
          </li>
          <li>
            <strong>92%</strong>
            <span>Repeat Bookings</span>
          </li>
        </ul>
      </section>

      <section className="queue-panel home-queue-panel" aria-label="Sample queue preview">
        <div className="panel-head">
          <h2>Tonight&apos;s Queue</h2>
          <span className="live-dot">{event?.roomOpen ? 'Live' : 'Paused'}</span>
        </div>

        <ol className="queue-list">
          {topSongs.map((song) => (
            <li key={song.id}>
              <div>
                <p className="song">{song.title}</p>
                <p className="artist">{song.artist}</p>
              </div>
              <span className="votes">+{song.votes_count}</span>
            </li>
          ))}
        </ol>
      </section>
    </section>
  )
}

export default HomePage
