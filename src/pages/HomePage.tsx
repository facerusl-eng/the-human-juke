import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { resetOGTags } from '../lib/metaTags'
import { Card, PrimaryButton, SectionHeader } from '../components/ui'
import { demoMode } from '../demo/demoMode'

const HOW_IT_WORKS = [
  {
    num: '01',
    label: 'You book the show',
    copy: 'One message is all it takes. Halli arrives set up and ready — no gear, no stress for your team.',
    icon: '📅',
  },
  {
    num: '02',
    label: 'Guests scan & join',
    copy: 'A QR code on the table or screen. No app to install. Guests request songs and vote in seconds.',
    icon: '📱',
  },
  {
    num: '03',
    label: 'The crowd drives the room',
    copy: 'Real-time votes reshape the queue all night. The energy builds itself — you just serve the drinks.',
    icon: '🎶',
  },
]

const VENUE_BENEFITS = [
  {
    icon: '🍺',
    label: 'Guests stay longer',
    copy: 'When people are invested in the music, they order another round and stick around.',
  },
  {
    icon: '📱',
    label: 'Zero friction for guests',
    copy: 'No app download, no sign-up wall. Works on any phone browser the moment they scan.',
  },
  {
    icon: '🎤',
    label: 'Karaoke mode built in',
    copy: 'Guests can flag songs for karaoke — the host sees it on the queue and the crowd sings along.',
  },
  {
    icon: '📺',
    label: 'Live feed screen for the venue',
    copy: 'A dedicated display shows the live queue, now-playing track, and crowd activity — great on a bar TV.',
  },
  {
    icon: '🔁',
    label: 'Fresh every single event',
    copy: 'Every show is shaped by that crowd. No two events feel the same.',
  },
  {
    icon: '✅',
    label: 'Repeat bookings',
    copy: 'Guests come back specifically to request songs again. It becomes a venue signature.',
  },
]

const GUEST_STATS = [
  { value: '500+', label: 'Song requests per night' },
  { value: '100%', label: 'Crowd-controlled setlist' },
  { value: '0', label: 'Apps to install' },
]

function HomePage() {
  const navigate = useNavigate()
  const openAudienceDemo = () => {
    if (typeof window !== 'undefined') {
      window.location.assign('/audience?demo=true')
      return
    }
    navigate('/audience?demo=true')
  }

  useEffect(() => {
    if (demoMode) {
      navigate('/audience?demo=true', { replace: true })
      return
    }
    resetOGTags()
  }, [navigate])

  return (
    <section className="home-shell home-shell-v2" aria-label="Home page">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="hero-card home-hero-card home-stage-hero home-fade-section" aria-label="Hero">
        <p className="home-hero-eyebrow">🎵 Live music experience for venues</p>
        <h1 className="home-hero-h1">
          Your guests pick the music.<br />
          Your events get <span className="home-hero-accent">unforgettable.</span>
        </h1>
        <p className="home-hero-subtitle">
          The Human Jukebox lets the crowd request songs, sing along in karaoke mode,
          and vote the queue live — all on a shared screen your whole venue can see.
        </p>
        <div className="hero-actions home-hero-actions" aria-label="Primary actions">
          <PrimaryButton onClick={() => navigate('/book-show')}>
            🎤 Book the show
          </PrimaryButton>
          <PrimaryButton variant="secondary" onClick={openAudienceDemo}>
            Try the demo
          </PrimaryButton>
        </div>
      </section>

      {/* ── Stats bar ────────────────────────────────────────── */}
      <div className="home-stats-bar home-fade-section" aria-label="Key stats">
        {GUEST_STATS.map((stat) => (
          <div key={stat.label} className="home-stat-item">
            <span className="home-stat-value">{stat.value}</span>
            <span className="home-stat-label">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* ── How it works ─────────────────────────────────────── */}
      <Card className="queue-panel home-section-card home-fade-section" aria-label="How it works">
        <SectionHeader title="How it works" />
        <div className="home-benefit-grid home-benefit-grid--3" role="list" aria-label="How it works steps">
          {HOW_IT_WORKS.map((step) => (
            <article key={step.label} className="home-benefit-card" role="listitem">
              <span className="home-benefit-icon" aria-hidden="true">{step.icon}</span>
              <div>
                <p className="home-benefit-label">{step.label}</p>
                <p className="home-benefit-copy">{step.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </Card>

      {/* ── Why venues love it ───────────────────────────────── */}
      <Card className="queue-panel home-section-card home-fade-section" aria-label="Why venues choose The Human Jukebox">
        <SectionHeader title="Why venues choose The Human Jukebox" />
        <div className="home-benefit-grid" role="list" aria-label="Venue benefits">
          {VENUE_BENEFITS.map((b) => (
            <article key={b.label} className="home-benefit-card" role="listitem">
              <span className="home-benefit-icon" aria-hidden="true">{b.icon}</span>
              <div>
                <p className="home-benefit-label">{b.label}</p>
                <p className="home-benefit-copy">{b.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </Card>

      {/* ── What your guests experience ─────────────────────── */}
      <Card className="queue-panel home-section-card home-fade-section" aria-label="What guests experience">
        <SectionHeader title="What your guests experience" />
        <div className="home-benefit-grid home-benefit-grid--4" role="list">
          <article className="home-benefit-card" role="listitem">
            <span className="home-benefit-icon" aria-hidden="true">📲</span>
            <div>
              <p className="home-benefit-label">Scan the QR code</p>
              <p className="home-benefit-copy">Instantly in the app — no download, no account.</p>
            </div>
          </article>
          <article className="home-benefit-card" role="listitem">
            <span className="home-benefit-icon" aria-hidden="true">🎵</span>
            <div>
              <p className="home-benefit-label">Request a song</p>
              <p className="home-benefit-copy">Search the catalogue and submit in seconds.</p>
            </div>
          </article>
          <article className="home-benefit-card" role="listitem">
            <span className="home-benefit-icon" aria-hidden="true">🗳️</span>
            <div>
              <p className="home-benefit-label">Vote songs up the queue</p>
              <p className="home-benefit-copy">Live voting reshapes the set as the event evolves.</p>
            </div>
          </article>
          <article className="home-benefit-card" role="listitem">
            <span className="home-benefit-icon" aria-hidden="true">🔥</span>
            <div>
              <p className="home-benefit-label">Hear their song live</p>
              <p className="home-benefit-copy">The crowd goes wild. They order another round.</p>
            </div>
          </article>
      {/* ── Booking CTA ──────────────────────────────────────── */}
      <Card className="queue-panel home-section-card home-cta-band home-fade-section" aria-label="Book the show">
        <p className="home-cta-eyebrow">Ready to upgrade your venue events?</p>
        <h2 className="home-cta-heading">Book The Human Jukebox for your next event</h2>
        <p className="home-cta-sub">
          Pubs, bars, restaurants, private parties and festivals. One message gets things started.
        </p>
        <div className="hero-actions home-hero-actions" aria-label="Booking actions">
          <PrimaryButton onClick={() => navigate('/book-show')}>
            🎤 Book the show
          </PrimaryButton>
          <PrimaryButton variant="secondary" onClick={openAudienceDemo}>
            Try the demo first
          </PrimaryButton>
        </div>
      </Card>

    </section>
  )
}

export default HomePage
