import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { resetOGTags } from '../lib/metaTags'
import { Card, PrimaryButton, SectionHeader } from '../components/ui'
import { demoMode } from '../demo/demoMode'

const HOW_IT_WORKS = [
  { icon: '01', label: 'Scan & Join', copy: 'Guests open the audience app and request songs in seconds.' },
  { icon: '02', label: 'Vote Live', copy: 'Crowd votes reorder the queue in real time as energy shifts.' },
  { icon: '03', label: 'Perform', copy: 'Host plays the top tracks and keeps the room moving.' },
]

const WHY_VENUES_LOVE_IT = [
  { icon: '⚡', label: 'Higher engagement' },
  { icon: '🏟', label: 'A stronger event centerpiece' },
  { icon: '🔁', label: 'Repeat bookings with a fresh feel' },
]

const WHY_GUESTS_LOVE_IT = [
  { icon: '🎵', label: 'They shape the soundtrack instantly' },
  { icon: '🗳', label: 'Voting keeps everyone involved' },
  { icon: '🔥', label: 'The room feels collaborative and alive' },
]

function HomePage() {
  const navigate = useNavigate()
  const openAudienceDemo = () => {
    // Demo mode is resolved at app bootstrap, so force a hard navigation.
    if (typeof window !== 'undefined') {
      window.location.assign('/audience?demo=true')
      return
    }

    navigate('/audience?demo=true')
  }

  useEffect(() => {
    // In demo mode, immediately redirect to the audience page so the simulated event is visible.
    if (demoMode) {
      navigate('/audience?demo=true', { replace: true })
      return
    }

    // Reset OG tags to app defaults on home page
    resetOGTags()
  }, [navigate])

  return (
    <section className="home-shell home-shell-v2" aria-label="Home page">
      <section className="hero-card home-hero-card home-stage-hero home-fade-section" aria-label="Hero">
        <SectionHeader
          eyebrow="Live request platform"
          title="The Human Jukebox"
          titleLevel={1}
          subtitle="Live music. Real-time requests. The audience controls the show."
          className="home-hero-header"
        />
        <div className="hero-actions home-hero-actions" aria-label="Primary actions">
          <PrimaryButton onClick={openAudienceDemo}>
            Try the audience app
          </PrimaryButton>
          <PrimaryButton variant="secondary" onClick={() => navigate('/book-show')}>
            Book the show
          </PrimaryButton>
        </div>
      </section>

      <Card className="queue-panel home-section-card home-fade-section" aria-label="What it is">
        <SectionHeader title="What it is" />
        <p>
          The Human Jukebox is a live performance format where guests submit songs in real time,
          vote songs up the queue, and shape the soundtrack of the night.
        </p>
      </Card>

      <Card className="queue-panel home-section-card home-fade-section" aria-label="How it works">
        <SectionHeader title="How it works" />
        <div className="home-visual-card-grid" role="list" aria-label="How it works steps">
          {HOW_IT_WORKS.map((step) => (
            <article key={step.label} className="home-visual-card" role="listitem">
              <p className="home-visual-icon" aria-hidden="true">{step.icon}</p>
              <p className="home-visual-label">{step.label}</p>
              <p className="home-visual-copy">{step.copy}</p>
            </article>
          ))}
        </div>
      </Card>

      <Card className="queue-panel home-section-card home-fade-section" aria-label="Why venues love it">
        <SectionHeader title="Why venues love it" />
        <div className="home-icon-pill-list" role="list" aria-label="Venue benefits">
          {WHY_VENUES_LOVE_IT.map((benefit) => (
            <p key={benefit.label} className="home-icon-pill" role="listitem">
              <span aria-hidden="true">{benefit.icon}</span>
              <span>{benefit.label}</span>
            </p>
          ))}
        </div>
      </Card>

      <Card className="queue-panel home-section-card home-fade-section" aria-label="Why guests love it">
        <SectionHeader title="Why guests love it" />
        <div className="home-icon-pill-list" role="list" aria-label="Guest benefits">
          {WHY_GUESTS_LOVE_IT.map((benefit) => (
            <p key={benefit.label} className="home-icon-pill" role="listitem">
              <span aria-hidden="true">{benefit.icon}</span>
              <span>{benefit.label}</span>
            </p>
          ))}
        </div>
      </Card>

      <Card className="queue-panel home-section-card home-cta-band home-fade-section" aria-label="Call to action">
        <SectionHeader title="Call to action" />
        <p>Bring this live request format to your next venue night, private event, or festival slot.</p>
        <div className="hero-actions home-hero-actions" aria-label="Call to action buttons">
          <PrimaryButton onClick={openAudienceDemo}>
            Try the audience app
          </PrimaryButton>
          <PrimaryButton variant="secondary" onClick={() => navigate('/book-show')}>
            Book the show
          </PrimaryButton>
        </div>
      </Card>
    </section>
  )
}

export default HomePage
