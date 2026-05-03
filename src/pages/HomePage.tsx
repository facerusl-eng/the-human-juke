import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueueStore } from '../state/queueStore'
import { resetOGTags } from '../lib/metaTags'

function HomePage() {
  const navigate = useNavigate()
  const { songs, event } = useQueueStore()
  const topSongs = songs.slice(0, 3)

  useEffect(() => {
    // Reset OG tags to app defaults on home page
    resetOGTags()
  }, [])

  return (
    <section className="home-shell home-shell-v2" aria-label="Home page">
      <section className="hero-card home-hero-card home-stage-hero" aria-label="Hero">
        <p className="eyebrow">Live request platform</p>
        <h1>The Human Jukebox</h1>
        <p className="subcopy home-hero-subtitle">Live music. Real-time requests. The audience controls the show.</p>
        <div className="hero-actions home-hero-actions" aria-label="Primary actions">
          <button type="button" className="primary-button" onClick={() => navigate('/audience')}>
            Try the audience app
          </button>
          <button type="button" className="secondary-button" onClick={() => navigate('/admin')}>
            Book the show
          </button>
        </div>
      </section>

      <section className="queue-panel home-section-card" aria-label="What it is">
        <h2>What it is</h2>
        <p>
          The Human Jukebox is a live performance format where guests submit songs in real time,
          vote songs up the queue, and shape the soundtrack of the night.
        </p>
      </section>

      <section className="queue-panel home-section-card" aria-label="How it works">
        <h2>How it works</h2>
        <ol className="home-flow-list">
          <li>Guests open the audience app and send requests.</li>
          <li>The queue updates live with votes and priorities.</li>
          <li>The host performs the top tracks and keeps momentum high.</li>
        </ol>
      </section>

      <section className="queue-panel home-section-card" aria-label="Why venues love it">
        <h2>Why venues love it</h2>
        <ul className="home-benefits-list">
          <li>Higher engagement and longer audience dwell time.</li>
          <li>Clear visual centerpiece for events and branded nights.</li>
          <li>A repeatable format that feels fresh every show.</li>
        </ul>
      </section>

      <section className="queue-panel home-section-card" aria-label="Why guests love it">
        <h2>Why guests love it</h2>
        <ul className="home-benefits-list">
          <li>They influence the music instantly from their phone.</li>
          <li>Voting makes every table part of the performance.</li>
          <li>The room energy feels collaborative and alive.</li>
        </ul>
      </section>

      <section className="queue-panel home-queue-panel home-section-card" aria-label="Live queue preview">
        <div className="panel-head">
          <h2>Live queue preview</h2>
          <span className="live-dot">{event?.roomOpen ? 'Live' : 'Paused'}</span>
        </div>
        <ol className="queue-list">
          {topSongs.length > 0 ? topSongs.map((song) => (
            <li key={song.id}>
              <div>
                <p className="song">{song.title}</p>
                <p className="artist">{song.artist}</p>
              </div>
              <span className="votes">+{song.votes_count}</span>
            </li>
          )) : <li className="subcopy">No requests yet. Be the first to add one.</li>}
        </ol>
      </section>

      <section className="queue-panel home-section-card home-cta-band" aria-label="Call to action">
        <h2>Call to action</h2>
        <p>Bring this live request format to your next venue night, private event, or festival slot.</p>
        <div className="hero-actions home-hero-actions" aria-label="Call to action buttons">
          <button type="button" className="primary-button" onClick={() => navigate('/audience')}>
            Try the audience app
          </button>
          <button type="button" className="secondary-button" onClick={() => navigate('/admin')}>
            Book the show
          </button>
        </div>
      </section>
    </section>
  )
}

export default HomePage
