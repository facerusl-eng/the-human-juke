import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { resetOGTags } from '../lib/metaTags'
import { Card, PrimaryButton, SectionHeader } from '../components/ui'
import { demoMode } from '../demo/demoMode'
import { readCommittedAudienceLocale, commitAudienceLocale } from '../lib/audienceIdentity'

type HomeLang = 'en' | 'da'

const COPY = {
  en: {
    eyebrow: '🎵 Live music experience for venues',
    h1Line1: 'Your guests pick the music.',
    h1Line2: 'Your events get',
    h1Accent: 'unforgettable.',
    subtitle: 'The Human Jukebox lets the crowd request songs, sing along in karaoke mode, and vote the queue live — all on a shared screen your whole venue can see.',
    bookCta: '🎤 Book the show',
    demoCta: 'Try the demo',
    stats: [
      { value: '500+', label: 'Song requests per event' },
      { value: '100%', label: 'Crowd-controlled setlist' },
      { value: '0', label: 'Apps to install' },
    ],
    howTitle: 'How it works',
    how: [
      { icon: '📅', label: 'You book the show', copy: 'One message is all it takes. Halli arrives set up and ready — no gear, no stress for your team.' },
      { icon: '📱', label: 'Guests scan & join', copy: 'A QR code on the table or screen. No app to install. Guests request songs and vote in seconds.' },
      { icon: '🎶', label: 'The crowd drives the room', copy: 'Real-time votes reshape the queue all event. The energy builds itself — you just serve the drinks.' },
    ],
    venueTitle: 'Why venues choose The Human Jukebox',
    venue: [
      { icon: '🍺', label: 'Guests stay longer', copy: 'When people are invested in the music, they order another round and stick around.' },
      { icon: '📱', label: 'Zero friction for guests', copy: 'No app download, no sign-up wall. Works on any phone browser the moment they scan.' },
      { icon: '🎤', label: 'Karaoke mode built in', copy: 'Guests can flag songs for karaoke — the host sees it on the queue and the crowd sings along.' },
      { icon: '📺', label: 'Live feed screen for the venue', copy: 'A dedicated display shows the live queue, now-playing track, and crowd activity — great on a bar TV.' },
      { icon: '🔁', label: 'Fresh every single event', copy: 'Every show is shaped by that crowd. No two events feel the same.' },
      { icon: '✅', label: 'Repeat bookings', copy: 'Guests come back specifically to request songs again. It becomes a venue signature.' },
    ],
    guestTitle: 'What your guests experience',
    guest: [
      { icon: '📲', label: 'Scan the QR code', copy: 'Instantly in the app — no download, no account.' },
      { icon: '🎵', label: 'Request a song', copy: 'Search the catalogue and submit in seconds.' },
      { icon: '🗳️', label: 'Vote songs up the queue', copy: 'Live voting reshapes the set as the event evolves.' },
      { icon: '🔥', label: 'Hear their song live', copy: 'The crowd goes wild. They order another round.' },
    ],
    ctaEyebrow: 'Ready to upgrade your venue events?',
    ctaHeading: 'Book The Human Jukebox for your next event',
    ctaSub: 'Pubs, bars, restaurants, private parties and festivals. One message gets things started.',
    ctaBook: '🎤 Book the show',
    ctaDemo: 'Try the demo first',
  },
  da: {
    eyebrow: '🎵 Live musikoplevelse til spillesteder',
    h1Line1: 'Dine gæster vælger musikken.',
    h1Line2: 'Dine events bliver',
    h1Accent: 'uforglemmelige.',
    subtitle: 'The Human Jukebox lader publikum ønske sange, synge med i karaoke og stemme live — alt på en fælles skærm hele stedet kan se.',
    bookCta: '🎤 Book showet',
    demoCta: 'Prøv demo',
    stats: [
      { value: '500+', label: 'Sangønsker per event' },
      { value: '100%', label: 'Publikumsstyret sætliste' },
      { value: '0', label: 'Apps der skal installeres' },
    ],
    howTitle: 'Sådan virker det',
    how: [
      { icon: '📅', label: 'Du booker showet', copy: 'Én besked er alt, der skal til. Halli møder op klar til at spille — intet udstyr, ingen stress for dit personale.' },
      { icon: '📱', label: 'Gæsterne scanner og deltager', copy: 'En QR-kode på bordet eller skærmen. Ingen app at installere. Gæsterne ønsker sange og stemmer på sekunder.' },
      { icon: '🎶', label: 'Publikum styrer stemningen', copy: 'Live-stemmer omrokerer køen løbende. Energien bygger sig selv — du serverer bare drinks.' },
    ],
    venueTitle: 'Derfor vælger spillesteder The Human Jukebox',
    venue: [
      { icon: '🍺', label: 'Gæsterne bliver længere', copy: 'Når folk er investerede i musikken, bestiller de endnu en øl og bliver hængende.' },
      { icon: '📱', label: 'Nul besvær for gæsterne', copy: 'Ingen app, ingen tilmelding. Virker direkte i telefon-browseren, så snart de scanner.' },
      { icon: '🎤', label: 'Karaoke er inkluderet', copy: 'Gæster kan markere sange til karaoke — værten ser det i køen og publikum synger med.' },
      { icon: '📺', label: 'Live-skærm til spillestedet', copy: 'Et dedikeret display viser den live-kø, aktuelle sang og publikumsaktivitet — perfekt på en bar-TV.' },
      { icon: '🔁', label: 'Frisk for hvert eneste event', copy: 'Hvert show formes af netop det publikum. To events føles aldrig ens.' },
      { icon: '✅', label: 'Genbookinger', copy: 'Gæsterne kommer tilbage specifikt for at ønske sange igen. Det bliver stedets varemærke.' },
    ],
    guestTitle: 'Hvad dine gæster oplever',
    guest: [
      { icon: '📲', label: 'Scan QR-koden', copy: 'Direkte ind i appen — ingen download, ingen konto.' },
      { icon: '🎵', label: 'Ønsker en sang', copy: 'Søg i kataloget og indsend på sekunder.' },
      { icon: '🗳️', label: 'Stem sange op i køen', copy: 'Live-stemmer omformer sætlisten, mens eventet udvikler sig.' },
      { icon: '🔥', label: 'Hører deres sang live', copy: 'Publikum jubler. De bestiller endnu en øl.' },
    ],
    ctaEyebrow: 'Klar til at opgradere dine events?',
    ctaHeading: 'Book The Human Jukebox til dit næste event',
    ctaSub: 'Pubber, barer, restauranter, private fester og festivaler. Én besked er nok.',
    ctaBook: '🎤 Book showet',
    ctaDemo: 'Prøv demo først',
  },
}

function HomePage() {
  const navigate = useNavigate()
  const [lang, setLang] = useState<HomeLang>(() => {
    const stored = readCommittedAudienceLocale()
    return stored === 'da' ? 'da' : 'en'
  })

  const copy = COPY[lang]

  const switchLang = (next: HomeLang) => {
    setLang(next)
    commitAudienceLocale(next)
  }

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
        <div className="home-lang-toggle" role="group" aria-label="Language">
          <button
            type="button"
            className={`home-lang-btn${lang === 'en' ? ' home-lang-btn--active' : ''}`}
            onClick={() => switchLang('en')}
            aria-pressed={lang === 'en'}
          >
            🇬🇧 EN
          </button>
          <button
            type="button"
            className={`home-lang-btn${lang === 'da' ? ' home-lang-btn--active' : ''}`}
            onClick={() => switchLang('da')}
            aria-pressed={lang === 'da'}
          >
            🇩🇰 DA
          </button>
        </div>
        <p className="home-hero-eyebrow">{copy.eyebrow}</p>
        <h1 className="home-hero-h1">
          {copy.h1Line1}<br />
          {copy.h1Line2} <span className="home-hero-accent">{copy.h1Accent}</span>
        </h1>
        <p className="home-hero-subtitle">{copy.subtitle}</p>
        <div className="hero-actions home-hero-actions" aria-label="Primary actions">
          <PrimaryButton onClick={() => navigate('/book-show')}>
            {copy.bookCta}
          </PrimaryButton>
          <PrimaryButton variant="secondary" onClick={openAudienceDemo}>
            {copy.demoCta}
          </PrimaryButton>
        </div>
      </section>

      {/* ── Stats bar ────────────────────────────────────────── */}
      <div className="home-stats-bar home-fade-section" aria-label="Key stats">
        {copy.stats.map((stat) => (
          <div key={stat.label} className="home-stat-item">
            <span className="home-stat-value">{stat.value}</span>
            <span className="home-stat-label">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* ── How it works ─────────────────────────────────────── */}
      <Card className="queue-panel home-section-card home-fade-section" aria-label={copy.howTitle}>
        <SectionHeader title={copy.howTitle} />
        <div className="home-benefit-grid home-benefit-grid--3" role="list">
          {copy.how.map((step) => (
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

      {/* ── Why venues choose ────────────────────────────────── */}
      <Card className="queue-panel home-section-card home-fade-section" aria-label={copy.venueTitle}>
        <SectionHeader title={copy.venueTitle} />
        <div className="home-benefit-grid" role="list">
          {copy.venue.map((b) => (
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

      {/* ── What guests experience ───────────────────────────── */}
      <Card className="queue-panel home-section-card home-fade-section" aria-label={copy.guestTitle}>
        <SectionHeader title={copy.guestTitle} />
        <div className="home-benefit-grid home-benefit-grid--4" role="list">
          {copy.guest.map((step) => (
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

      {/* ── Booking CTA ──────────────────────────────────────── */}
      <Card className="queue-panel home-section-card home-cta-band home-fade-section" aria-label="Book the show">
        <p className="home-cta-eyebrow">{copy.ctaEyebrow}</p>
        <h2 className="home-cta-heading">{copy.ctaHeading}</h2>
        <p className="home-cta-sub">{copy.ctaSub}</p>
        <div className="hero-actions home-hero-actions" aria-label="Booking actions">
          <PrimaryButton onClick={() => navigate('/book-show')}>
            {copy.ctaBook}
          </PrimaryButton>
          <PrimaryButton variant="secondary" onClick={openAudienceDemo}>
            {copy.ctaDemo}
          </PrimaryButton>
        </div>
      </Card>

    </section>
  )
}

export default HomePage

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
