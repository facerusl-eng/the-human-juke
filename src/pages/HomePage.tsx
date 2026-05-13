import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, MessageCircle, Smartphone } from 'lucide-react'
import { resetOGTags } from '../lib/metaTags'
import { PrimaryButton } from '../components/ui'
import { demoMode } from '../demo/demoMode'
import { readCommittedAudienceLocale, commitAudienceLocale } from '../lib/audienceIdentity'
import '../styles/home-landing.css'

type HomeLang = 'en' | 'da'

const COPY = {
  en: {
    eyebrow: 'The live music experience pubs love',
    h1Line1: 'Your crowd picks the songs.',
    h1Line2: 'Your pub becomes',
    h1Accent: 'the place to be.',
    subtitle: 'I\'m Harald — a live performer who brings an interactive jukebox show to your pub. Your guests request songs, vote the queue, and sing along in karaoke mode. All on a shared screen your whole bar can see.',
    bookCta: 'Book the show',
    demoCta: 'See how it works',
    stats: [
      { value: '500+', label: 'Song requests per show' },
      { value: '100%', label: 'Crowd-controlled setlist' },
      { value: '0', label: 'Apps for guests to install' },
      { value: '40+', label: 'Venues entertained' },
    ],
    featuresTitle: 'How it works',
    features: [
      { icon: 'building', label: 'You book the show', copy: 'One message is all it takes. I arrive fully set up and ready to perform.' },
      { icon: 'phone', label: 'Guests scan and join', copy: 'No app to install. Guests request and vote from any phone in seconds.' },
      { icon: 'chat', label: 'The room drives the set', copy: 'Live requests and votes reshape the queue in real time all night.' },
    ],
    socialTitle: 'Trusted by venues that want full rooms',
    socialProof: [
      { quote: 'Guests stayed longer and spent more because they were invested in the queue.', name: 'Venue Owner, Copenhagen' },
      { quote: 'The easiest live night we have run. Setup was smooth, and the crowd loved it.', name: 'Bar Manager, Reykjavik' },
      { quote: 'No app friction. People joined instantly and kept voting all evening.', name: 'Event Host, Aarhus' },
    ],
    ctaEyebrow: 'Ready to give your pub a night they\'ll talk about?',
    ctaHeading: "Book The Human Jukebox for your pub's next event",
    ctaSub: 'Pubs, bars, restaurants, private parties and festivals. One message is all it takes — I\'ll handle the rest.',
    ctaBook: 'Book the show',
    ctaDemo: 'Try the demo first',
    signupLabel: 'Get availability updates by email',
    signupPlaceholder: 'you@venue.com',
    signupCta: 'Get updates',
  },
  da: {
    eyebrow: 'Live musikshow til din pub',
    h1Line1: 'Dine gæster vælger sangene.',
    h1Line2: 'Din pub bliver',
    h1Accent: 'stedet alle taler om.',
    subtitle: 'Jeg hedder Harald — en live performer der bringer en interaktiv jukebox til din pub. Dine gæster ønsker sange, stemmer på køen og synger med i karaoke. Alt på en fælles skærm hele baren kan se.',
    bookCta: 'Book showet',
    demoCta: 'Se hvordan det virker',
    stats: [
      { value: '500+', label: 'Sangønsker per show' },
      { value: '100%', label: 'Publikumsstyret sætliste' },
      { value: '0', label: 'Apps gæsterne skal installere' },
      { value: '40+', label: 'Spillesteder underholdt' },
    ],
    featuresTitle: 'Sådan virker det',
    features: [
      { icon: 'building', label: 'Du booker showet', copy: 'Én besked er alt, der skal til. Jeg møder op fuldt klar til at spille.' },
      { icon: 'phone', label: 'Gæster scanner og deltager', copy: 'Ingen app at installere. Gæster ønsker og stemmer fra enhver telefon.' },
      { icon: 'chat', label: 'Publikum styrer sættet', copy: 'Live ønsker og stemmer flytter køen i realtid hele aftenen.' },
    ],
    socialTitle: 'Booket af steder der vil have fuldt hus',
    socialProof: [
      { quote: 'Gæsterne blev længere og brugte mere, fordi de var investeret i køen.', name: 'Pubejer, København' },
      { quote: 'Det nemmeste livekoncept vi har kørt. Opsætning var gnidningsfri.', name: 'Barmanager, Reykjavik' },
      { quote: 'Ingen app-friktion. Folk var i gang med det samme og stemte hele aftenen.', name: 'Eventvært, Aarhus' },
    ],
    ctaEyebrow: 'Klar til at give din pub en aften de taler om?',
    ctaHeading: 'Book The Human Jukebox til din pubs næste event',
    ctaSub: 'Pubber, barer, restauranter, private fester og festivaler. Én besked er nok — jeg klarer resten.',
    ctaBook: 'Book showet',
    ctaDemo: 'Prøv demo først',
    signupLabel: 'Få ledige datoer på email',
    signupPlaceholder: 'dig@spillested.dk',
    signupCta: 'Få updates',
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

  const openLiveExperience = () => {
    if (typeof window !== 'undefined') {
      window.location.assign('/audience')
      return
    }
    navigate('/audience')
  }

  const openAdminLogin = () => {
    if (typeof window !== 'undefined') {
      window.location.assign('/admin')
      return
    }
    navigate('/admin')
  }

  useEffect(() => {
    if (demoMode) {
      navigate('/audience?demo=true', { replace: true })
      return
    }
    resetOGTags()
  }, [navigate])

  const iconMap = {
    building: Building2,
    phone: Smartphone,
    chat: MessageCircle,
  } as const

  return (
    <section className="lp-shell" aria-label="Home page">
      <section className="lp-hero" aria-label="Hero section">
        <div className="lp-hero-inner">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">{copy.eyebrow}</p>
            <h1 className="lp-title">
              {copy.h1Line1}
              <br />
              {copy.h1Line2} <span>{copy.h1Accent}</span>
            </h1>
            <p className="lp-subtitle">{copy.subtitle}</p>
            <div className="lp-lang-toggle" role="group" aria-label="Language">
              <button
                type="button"
                className={`lp-lang-btn${lang === 'en' ? ' lp-lang-btn-active' : ''}`}
                onClick={() => switchLang('en')}
              >
                EN
              </button>
              <button
                type="button"
                className={`lp-lang-btn${lang === 'da' ? ' lp-lang-btn-active' : ''}`}
                onClick={() => switchLang('da')}
              >
                DA
              </button>
            </div>
            <div className="lp-hero-cta" aria-label="Primary actions">
              <PrimaryButton onClick={openLiveExperience}>{copy.bookCta}</PrimaryButton>
              <PrimaryButton variant="secondary" onClick={openAudienceDemo}>{copy.demoCta}</PrimaryButton>
              <button type="button" className="lp-admin-btn" onClick={openAdminLogin}>Admin Login</button>
            </div>
          </div>

          <div className="lp-hero-mirror" aria-label="Mirror screen preview">
            <iframe
              src="/mirror?demo=true&preview=1&mirrorAccess=force&launchFullscreen=1"
              title="Mirror screen preview"
              loading="lazy"
              className="lp-hero-mirror-frame"
              allow="fullscreen"
              allowFullScreen
              sandbox="allow-scripts allow-same-origin"
            />
            <div className="lp-hero-mirror-actions">
              <a
                href="/mirror?demo=true&mirrorAccess=force&launchFullscreen=1"
                target="_blank"
                rel="noopener noreferrer"
                className="lp-mirror-fullscreen-link"
              >
                Open Mirror Fullscreen
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-stats" aria-label="Stats bar">
        {copy.stats.map((stat) => (
          <article key={stat.label} className="lp-stat-card">
            <p className="lp-stat-value">{stat.value}</p>
            <p className="lp-stat-label">{stat.label}</p>
          </article>
        ))}
      </section>

      <section className="lp-section" aria-label="Features section">
        <h2 className="lp-section-title">{copy.featuresTitle}</h2>
        <div className="lp-features-grid" role="list">
          {copy.features.map((feature) => {
            const Icon = iconMap[feature.icon as keyof typeof iconMap]
            return (
              <article key={feature.label} className="lp-feature-card" role="listitem">
                <Icon size={22} strokeWidth={2.1} aria-hidden="true" />
                <h3>{feature.label}</h3>
                <p>{feature.copy}</p>
              </article>
            )
          })}
        </div>
      </section>

      <section className="lp-section" aria-label="Social proof section">
        <h2 className="lp-section-title">{copy.socialTitle}</h2>
        <div className="lp-social-grid" role="list">
          {copy.socialProof.map((item) => (
            <article key={item.name} className="lp-social-card" role="listitem">
              <p className="lp-quote">“{item.quote}”</p>
              <p className="lp-author">{item.name}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-cta" aria-label="CTA section">
        <div className="lp-cta-copy">
          <p className="lp-eyebrow">{copy.ctaEyebrow}</p>
          <h2 className="lp-section-title">{copy.ctaHeading}</h2>
          <p>{copy.ctaSub}</p>
        </div>
        <form className="lp-signup" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="home-signup-email">{copy.signupLabel}</label>
          <div className="lp-signup-row">
            <input
              id="home-signup-email"
              type="email"
              placeholder={copy.signupPlaceholder}
              autoComplete="email"
            />
            <button type="button" className="lp-signup-btn" onClick={openLiveExperience}>
              {copy.signupCta}
            </button>
          </div>
          <div className="lp-cta-actions">
            <PrimaryButton onClick={openLiveExperience}>{copy.ctaBook}</PrimaryButton>
            <PrimaryButton variant="secondary" onClick={openAudienceDemo}>{copy.ctaDemo}</PrimaryButton>
          </div>
        </form>
      </section>
    </section>
  )
}

export default HomePage
