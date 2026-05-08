import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { resetOGTags } from '../lib/metaTags'
import { Card, PrimaryButton, SectionHeader } from '../components/ui'
import { demoMode } from '../demo/demoMode'
import { readCommittedAudienceLocale, commitAudienceLocale } from '../lib/audienceIdentity'

type HomeLang = 'en' | 'da'

const COPY = {
  en: {
    eyebrow: '🎵 The live music experience pubs love',
    h1Line1: 'Your crowd picks the songs.',
    h1Line2: 'Your pub becomes',
    h1Accent: 'the place to be.',
    subtitle: 'I\'m Harald — a live performer who brings an interactive jukebox show to your pub. Your guests request songs, vote the queue, and sing along in karaoke mode. All on a shared screen your whole bar can see.',
    bookCta: '🎤 Book the show',
    demoCta: 'See how it works',
    stats: [
      { value: '500+', label: 'Song requests per show' },
      { value: '100%', label: 'Crowd-controlled setlist' },
      { value: '0', label: 'Apps for guests to install' },
    ],
    howTitle: 'How it works',
    how: [
      { icon: '📅', label: 'You book the show', copy: 'One message is all it takes. I arrive fully set up and ready to play — no gear for your team to sort, no sound check stress.' },
      { icon: '📱', label: 'Your guests scan & join', copy: 'A QR code goes on tables or the screen. No app to install. Guests request songs and vote in seconds from any phone.' },
      { icon: '🎶', label: 'The crowd drives the room', copy: 'Real-time votes reshape the queue all night. The energy builds itself — you just serve the drinks and watch your bar come alive.' },
    ],
    venueTitle: 'Why pub owners book The Human Jukebox',
    venue: [
      { icon: '🍺', label: 'Guests stay and spend more', copy: 'When people are invested in what\'s playing next, they order another round and stick around until their song comes on.' },
      { icon: '📱', label: 'Zero friction for guests', copy: 'No app download, no sign-up, no barrier. It works instantly in any phone browser the moment they scan the QR code.' },
      { icon: '🎤', label: 'Karaoke built right in', copy: 'Guests can flag songs for karaoke — I see it on my queue and invite them up. The crowd sings along. The room goes wild.' },
      { icon: '📺', label: 'A live screen for your bar', copy: 'A dedicated display shows the live queue, the now-playing track, and crowd activity — great on any bar TV or big screen.' },
      { icon: '🍹', label: 'Promote your drink offers', copy: 'Add a link to your menu or tonight\'s specials. Every guest sees it right inside the app — at exactly the right moment.' },
      { icon: '🏷️', label: 'Your branding on the big screen', copy: 'The mirror screen carries your pub\'s logo all night. It looks like your event — I\'m just powering the stage.' },
      { icon: '🔁', label: 'Different every single night', copy: 'Every show is shaped by that crowd. No two events feel the same — so guests keep coming back.' },
      { icon: '✅', label: 'Regulars become fans', copy: 'Guests come back specifically to request songs again. It becomes your pub\'s signature night.' },
    ],
    mirrorTitle: 'The mirror screen — your brand, all night long',
    mirror: [
      { icon: '🏷️', label: 'Your logo on the big screen', copy: 'Upload your pub\'s logo once. It sits on the mirror screen the whole event — your branding front and centre, not mine.' },
      { icon: '🍹', label: 'Link to your drinks menu', copy: 'Add a URL to your menu or tonight\'s specials. Guests see a tap-able link right inside the audience app — driving orders while the music plays.' },
      { icon: '🎵', label: 'Live queue visible to all', copy: 'The screen shows the current song, the live vote queue, and crowd shout-outs. Everyone at the bar can see what\'s coming up next.' },
      { icon: '✨', label: 'Turns any corner into a stage', copy: 'A dynamic, branded screen behind the performer transforms your pub into a proper live music venue — even on a Tuesday night.' },
    ],
    guestTitle: 'What your guests experience',
    guest: [
      { icon: '📲', label: 'Scan the QR code', copy: 'Straight into the app — no download, no account, no friction.' },
      { icon: '🎵', label: 'Request a song', copy: 'Search the full catalogue and submit in seconds.' },
      { icon: '🗳️', label: 'Vote songs up the queue', copy: 'Live voting shifts the setlist as the night evolves.' },
      { icon: '🔥', label: 'Hear their song live', copy: 'The crowd erupts. They order another round. They\'ll be back next week.' },
    ],
    mirrorPreviewLabel: 'Live mirror screen — demo',
    mirrorPreviewEyebrow: '📺 This runs on your bar TV all night',
    mirrorPreviewHeading: 'See the mirror screen in action',
    mirrorPreviewSub: 'The queue, the current track, crowd shout-outs — all updating live. Runs on any screen or TV in your pub. Your logo, your colours.',
    mirrorPreviewLink: 'Open full screen ↗',
    ctaEyebrow: 'Ready to give your pub a night they\'ll talk about?',
    ctaHeading: "Book The Human Jukebox for your pub's next event",
    ctaSub: 'Pubs, bars, restaurants, private parties and festivals. One message is all it takes — I\'ll handle the rest.',
    ctaBook: '🎤 Book the show',
    ctaDemo: 'Try the demo first',
  },
  da: {
    eyebrow: '🎵 Live musikshow til din pub',
    h1Line1: 'Dine gæster vælger sangene.',
    h1Line2: 'Din pub bliver',
    h1Accent: 'stedet alle taler om.',
    subtitle: 'Jeg hedder Harald — en live performer der bringer en interaktiv jukebox til din pub. Dine gæster ønsker sange, stemmer på køen og synger med i karaoke. Alt på en fælles skærm hele baren kan se.',
    bookCta: '🎤 Book showet',
    demoCta: 'Se hvordan det virker',
    stats: [
      { value: '500+', label: 'Sangønsker per show' },
      { value: '100%', label: 'Publikumsstyret sætliste' },
      { value: '0', label: 'Apps gæsterne skal installere' },
    ],
    howTitle: 'Sådan virker det',
    how: [
      { icon: '📅', label: 'Du booker showet', copy: 'Én besked er alt, der skal til. Jeg møder op fuldt klar til at spille — intet udstyr for dit personale, ingen lydtjek-stress.' },
      { icon: '📱', label: 'Dine gæster scanner og deltager', copy: 'En QR-kode på bordene eller skærmen. Ingen app at installere. Gæsterne ønsker sange og stemmer på sekunder fra enhver telefon.' },
      { icon: '🎶', label: 'Publikum styrer stemningen', copy: 'Live-stemmer omrokerer køen hele natten. Energien bygger sig selv — du serverer bare drinks og ser din bar vågne til live.' },
    ],
    venueTitle: 'Derfor booker pubejere The Human Jukebox',
    venue: [
      { icon: '🍺', label: 'Gæsterne bliver og bruger mere', copy: 'Når folk er investerede i hvad der spiller næst, bestiller de endnu en øl og bliver til deres sang kommer.' },
      { icon: '📱', label: 'Nul besvær for gæsterne', copy: 'Ingen app, ingen tilmelding, ingen barriere. Det virker øjeblikkeligt i enhver telefon-browser, så snart de scanner.' },
      { icon: '🎤', label: 'Karaoke er inkluderet', copy: 'Gæster kan markere sange til karaoke — jeg ser det i min kø og inviterer dem op. Publikum synger med. Stemningen eksploderer.' },
      { icon: '📺', label: 'En live-skærm til din bar', copy: 'Et dedikeret display viser live-køen, den aktuelle sang og publikumsaktivitet — perfekt på ethvert bar-TV eller storskærm.' },
      { icon: '🍹', label: 'Fremhæv dine drinktilbud', copy: 'Tilføj et link til din menu eller aftenens tilbud. Alle gæster ser det direkte i appen — på præcis det rigtige tidspunkt.' },
      { icon: '🏷️', label: 'Din branding på storskærmen', copy: 'Spejlskærmen viser din pubs logo hele natten. Det ser ud som dit event — jeg driver bare scenen.' },
      { icon: '🔁', label: 'Anderledes hver eneste aften', copy: 'Hvert show formes af netop det publikum. To events føles aldrig ens — så gæsterne bliver ved med at komme tilbage.' },
      { icon: '✅', label: 'Stamgæster bliver fans', copy: 'Gæsterne kommer tilbage specifikt for at ønske sange igen. Det bliver din pubs signature-aften.' },
    ],
    mirrorTitle: 'Spejlskærmen — din branding hele natten',
    mirror: [
      { icon: '🏷️', label: 'Dit logo på storskærmen', copy: 'Upload din pubs logo én gang. Det sidder på spejlskærmen hele eventet — din branding i centrum, ikke min.' },
      { icon: '🍹', label: 'Link til din drinksmenu', copy: 'Tilføj et link til din menu eller aftenens tilbud. Gæsterne ser et klikbart link direkte i appen — og bestiller mens musikken spiller.' },
      { icon: '🎵', label: 'Live-kø synlig for alle', copy: 'Skærmen viser den aktuelle sang, live-afstemningskøen og publikums beskeder. Alle ved baren kan se hvad der kommer næst.' },
      { icon: '✨', label: 'Forvandler dit hjørne til en scene', copy: 'En dynamisk, branded skærm bag performeren gør din pub til en rigtig livescene — selv en tirsdagaften.' },
    ],
    guestTitle: 'Hvad dine gæster oplever',
    guest: [
      { icon: '📲', label: 'Scan QR-koden', copy: 'Direkte ind i appen — ingen download, ingen konto, ingen besvær.' },
      { icon: '🎵', label: 'Ønsker en sang', copy: 'Søg i hele kataloget og indsend på sekunder.' },
      { icon: '🗳️', label: 'Stem sange op i køen', copy: 'Live-stemmer ændrer sætlisten mens natten skrider frem.' },
      { icon: '🔥', label: 'Hører deres sang live', copy: 'Publikum eksploderer. De bestiller endnu en øl. De er tilbage næste uge.' },
    ],
    mirrorPreviewLabel: 'Live spejlskærm — demo',
    mirrorPreviewEyebrow: '📺 Det her kører på din bar-TV hele natten',
    mirrorPreviewHeading: 'Se spejlskærmen i aktion',
    mirrorPreviewSub: 'Køen, den aktuelle sang, publikums råb — alt opdaterer live. Kører på enhver skærm eller TV i din pub. Dit logo, dine farver.',
    mirrorPreviewLink: 'Åbn fuld skærm ↗',
    ctaEyebrow: 'Klar til at give din pub en aften de taler om?',
    ctaHeading: 'Book The Human Jukebox til din pubs næste event',
    ctaSub: 'Pubber, barer, restauranter, private fester og festivaler. Én besked er nok — jeg klarer resten.',
    ctaBook: '🎤 Book showet',
    ctaDemo: 'Prøv demo først',
  },
}

function HomePage() {
  const navigate = useNavigate()
  const tvWrapperRef = useRef<HTMLDivElement>(null)
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

  // Render the mirror at desktop width and scale to fit with a small safety margin.
  useEffect(() => {
    const el = tvWrapperRef.current
    if (!el) return
    const update = () => {
      const safeWidth = Math.max(0, el.clientWidth - 16)
      const scale = Math.min(1, safeWidth / 1440)
      el.style.setProperty('--tv-scale', `${scale}`)
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    update()
    return () => ro.disconnect()
  }, [])

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
        <div className="home-hero-inner">
          <div className="home-hero-body">
            <p className="home-hero-eyebrow">{copy.eyebrow}</p>
            <h1 className="home-hero-h1">
              {copy.h1Line1}<br />
              {copy.h1Line2} <span className="home-hero-accent">{copy.h1Accent}</span>
            </h1>
            <p className="home-hero-subtitle">{copy.subtitle}</p>
          </div>
          <div className="home-hero-aside">
            <div className="home-lang-toggle" role="group" aria-label="Language">
              <button
                type="button"
                className={`home-lang-btn${lang === 'en' ? ' home-lang-btn--active' : ''}`}
                onClick={() => switchLang('en')}
              >
                🇬🇧 EN
              </button>
              <button
                type="button"
                className={`home-lang-btn${lang === 'da' ? ' home-lang-btn--active' : ''}`}
                onClick={() => switchLang('da')}
              >
                🇩🇰 DA
              </button>
            </div>
            <div className="hero-actions home-hero-actions" aria-label="Primary actions">
              <PrimaryButton onClick={() => navigate('/book-show')}>
                {copy.bookCta}
              </PrimaryButton>
              <PrimaryButton variant="secondary" onClick={openAudienceDemo}>
                {copy.demoCta}
              </PrimaryButton>
            </div>
            <div className="home-hero-aside-stats">
              {copy.stats.map((stat) => (
                <div key={stat.label} className="home-hero-aside-stat">
                  <span className="home-stat-value">{stat.value}</span>
                  <span className="home-stat-label">{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

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

      {/* ── Mirror screen preview ─────────────────────────────── */}
      <Card className="queue-panel home-section-card home-mirror-preview-card home-fade-section" aria-label={copy.mirrorPreviewLabel}>
        <p className="home-hero-eyebrow">{copy.mirrorPreviewEyebrow}</p>
        <h2 className="home-cta-heading home-mirror-preview-heading">{copy.mirrorPreviewHeading}</h2>
        <p className="home-benefit-copy home-mirror-preview-sub">{copy.mirrorPreviewSub}</p>
        <div className="home-tv-frame">
          <div className="home-tv-bezel">
            <div className="home-tv-screen-wrapper" ref={tvWrapperRef}>
              <iframe
                src="/mirror?demo=true&preview=1&mirrorAccess=force"
                className="home-tv-screen"
                title={copy.mirrorPreviewLabel}
                loading="lazy"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
          </div>
          <div className="home-tv-stand">
            <div className="home-tv-stand-neck" />
            <div className="home-tv-stand-base" />
          </div>
        </div>
        <div className="home-mirror-preview-footer">
          <a
            href="/mirror?demo=true"
            target="_blank"
            rel="noopener noreferrer"
            className="home-mirror-preview-link"
          >
            {copy.mirrorPreviewLink}
          </a>
        </div>
      </Card>

      {/* ── Mirror screen benefits ───────────────────────────── */}
      <Card className="queue-panel home-section-card home-fade-section" aria-label={copy.mirrorTitle}>
        <SectionHeader title={copy.mirrorTitle} />
        <div className="home-benefit-grid home-benefit-grid--4" role="list">
          {copy.mirror.map((b) => (
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

      {/* ── Booking CTA ──────────────────────────────────────── */}
      <Card className="queue-panel home-section-card home-cta-band home-fade-section" aria-label="Book the show">
        <div className="home-cta-inner">
          <div>
            <p className="home-cta-eyebrow">{copy.ctaEyebrow}</p>
            <h2 className="home-cta-heading">{copy.ctaHeading}</h2>
            <p className="home-cta-sub">{copy.ctaSub}</p>
          </div>
          <div className="home-cta-actions">
            <PrimaryButton onClick={() => navigate('/book-show')}>
              {copy.ctaBook}
            </PrimaryButton>
            <PrimaryButton variant="secondary" onClick={openAudienceDemo}>
              {copy.ctaDemo}
            </PrimaryButton>
          </div>
        </div>
      </Card>

    </section>
  )
}

export default HomePage
