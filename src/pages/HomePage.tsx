import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, MessageCircle, Smartphone } from 'lucide-react'
import { resetOGTags } from '../lib/metaTags'
import { PrimaryButton } from '../components/ui'
import { demoMode } from '../demo/demoMode'
import { readCommittedAudienceLocale, commitAudienceLocale } from '../lib/audienceIdentity'
import '../styles/home-landing.css'

type HomeLang = 'en' | 'da'

const BOOKING_MANAGER_URL = import.meta.env.VITE_BOOKING_URL?.trim() || 'https://book-jukebox.base44.app/'
const INTERNAL_BOOKING_ENDPOINT = '/api/book-show'
const EXTERNAL_BOOKING_WEBHOOK_URL = 'https://preview--book-jukebox.base44.app/api/webhook/receiveExternalBooking'
const EXTERNAL_BOOKING_PAYLOAD = {
  venue_name: 'The Blue Note',
  date: '2026-05-20',
  gig_type: 'evening',
  requested_fee: 1500,
  contact_email: 'manager@bluenoote.dk',
  notes: 'Special requests here',
}

const COPY = {
  en: {
    eyebrow: 'The live music experience pubs love',
    h1Line1: 'Your crowd picks the songs.',
    h1Line2: 'Your pub becomes',
    h1Accent: 'the place to be.',
    subtitle: 'I\'m Harald - a live performer who brings an interactive jukebox show to your pub. Your guests request songs, vote the queue, and sing along in karaoke mode. All on a shared screen your whole bar can see.',
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
    ctaSub: 'Pubs, bars, restaurants, private parties and festivals. One message is all it takes - I\'ll handle the rest.',
    ctaBook: 'Book the show',
    ctaDemo: 'Try the demo first',
    signupLabel: 'Get availability updates by email',
    signupPlaceholder: 'you@venue.com',
    signupCta: 'Get updates',
  },
  da: {
    eyebrow: 'Live musikshow til din pub',
    h1Line1: 'Dine gaester vaelger sangene.',
    h1Line2: 'Din pub bliver',
    h1Accent: 'stedet alle taler om.',
    subtitle: 'Jeg hedder Harald - en live performer der bringer en interaktiv jukebox til din pub. Dine gaester onsker sange, stemmer pa koen og synger med i karaoke. Alt pa en faelles skaerm hele baren kan se.',
    bookCta: 'Book showet',
    demoCta: 'Se hvordan det virker',
    stats: [
      { value: '500+', label: 'Sangonsker per show' },
      { value: '100%', label: 'Publikumsstyret saetliste' },
      { value: '0', label: 'Apps gaesterne skal installere' },
      { value: '40+', label: 'Spillesteder underholdt' },
    ],
    featuresTitle: 'Sadan virker det',
    features: [
      { icon: 'building', label: 'Du booker showet', copy: 'En besked er alt, der skal til. Jeg moder op fuldt klar til at spille.' },
      { icon: 'phone', label: 'Gaester scanner og deltager', copy: 'Ingen app at installere. Gaester onsker og stemmer fra enhver telefon.' },
      { icon: 'chat', label: 'Publikum styrer saettet', copy: 'Live onsker og stemmer flytter koen i realtid hele aftenen.' },
    ],
    socialTitle: 'Booket af steder der vil have fuldt hus',
    socialProof: [
      { quote: 'Gaesterne blev laengere og brugte mere, fordi de var investeret i koen.', name: 'Pubejer, Kobenhavn' },
      { quote: 'Det nemmeste livekoncept vi har kort. Opsaetning var gnidningsfri.', name: 'Barmanager, Reykjavik' },
      { quote: 'Ingen app-friktion. Folk var i gang med det samme og stemte hele aftenen.', name: 'Eventvaert, Aarhus' },
    ],
    ctaEyebrow: 'Klar til at give din pub en aften de taler om?',
    ctaHeading: 'Book The Human Jukebox til din pubs naeste event',
    ctaSub: 'Pubber, barer, restauranter, private fester og festivaler. En besked er nok - jeg klarer resten.',
    ctaBook: 'Book showet',
    ctaDemo: 'Prov demo forst',
    signupLabel: 'Fa ledige datoer pa email',
    signupPlaceholder: 'dig@spillested.dk',
    signupCta: 'Fa updates',
  },
}

function HomePage() {
  const navigate = useNavigate()
  const [signupEmail, setSignupEmail] = useState('')
  const [signupError, setSignupError] = useState<string | null>(null)
  const [bookingBusy, setBookingBusy] = useState(false)
  const [bookingNotice, setBookingNotice] = useState<string | null>(null)
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

  const openBookingFlow = () => {
    if (bookingBusy) {
      return
    }

    setBookingBusy(true)
    setBookingNotice(null)

    void (async () => {
      try {
        let response = await fetch(INTERNAL_BOOKING_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          response = await fetch(EXTERNAL_BOOKING_WEBHOOK_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(EXTERNAL_BOOKING_PAYLOAD),
          })
        }

        if (!response.ok) {
          throw new Error(`Webhook failed with status ${response.status}`)
        }

        setBookingNotice(lang === 'da' ? 'Booking sendt. Vi kontakter dig snart.' : 'Booking sent. We will contact you shortly.')
      } catch (error) {
        console.warn('HomePage: failed to send booking webhook', error)
        setBookingNotice(lang === 'da' ? 'Booking kunne ikke sendes. Prov igen.' : 'Booking could not be sent. Please try again.')
      } finally {
        setBookingBusy(false)
      }
    })()
  }

  const openAdminLogin = () => {
    if (typeof window !== 'undefined') {
      window.location.assign('/admin')
      return
    }
    navigate('/admin')
  }

  const submitAvailabilitySignup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const normalizedEmail = signupEmail.trim()
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (!emailPattern.test(normalizedEmail)) {
      setSignupError(lang === 'da' ? 'Indtast en gyldig email.' : 'Enter a valid email address.')
      return
    }

    setSignupError(null)

    if (typeof window !== 'undefined') {
      const bookingUrl = new URL(BOOKING_MANAGER_URL)
      bookingUrl.searchParams.set('email', normalizedEmail)
      bookingUrl.searchParams.set('intent', 'availability-updates')
      bookingUrl.searchParams.set('source', 'home-signup')
      window.location.assign(bookingUrl.toString())
      return
    }

    navigate('/audience')
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
              <PrimaryButton onClick={openBookingFlow} disabled={bookingBusy}>
                {bookingBusy ? (lang === 'da' ? 'Sender...' : 'Sending...') : copy.bookCta}
              </PrimaryButton>
              <PrimaryButton variant="secondary" onClick={openAudienceDemo}>
                {copy.demoCta}
              </PrimaryButton>
            </div>
            {bookingNotice ? <p className="lp-booking-notice">{bookingNotice}</p> : null}
          </div>
          <aside className="lp-hero-card" aria-label="Live mirror preview">
            <iframe
              title="Human Jukebox mirror preview"
              src="/mirror?demo=true&mirrorAccess=force"
              loading="lazy"
              className="lp-preview-frame"
            />
          </aside>
        </div>
      </section>

      <section className="lp-features" aria-label={copy.featuresTitle}>
        <h2>{copy.featuresTitle}</h2>
        <div className="lp-feature-grid">
          {copy.features.map((feature) => {
            const Icon = iconMap[feature.icon as keyof typeof iconMap]

            return (
              <article key={feature.label} className="lp-feature-card">
                <Icon size={22} aria-hidden="true" />
                <h3>{feature.label}</h3>
                <p>{feature.copy}</p>
              </article>
            )
          })}
        </div>
      </section>

      <section className="lp-social" aria-label={copy.socialTitle}>
        <h2>{copy.socialTitle}</h2>
        <div className="lp-social-grid">
          {copy.socialProof.map((item) => (
            <blockquote key={item.name} className="lp-quote-card">
              <p>"{item.quote}"</p>
              <cite>{item.name}</cite>
            </blockquote>
          ))}
        </div>
      </section>

      <section className="lp-cta-band" aria-label="Book now">
        <p>{copy.ctaEyebrow}</p>
        <h2>{copy.ctaHeading}</h2>
        <p className="lp-cta-sub">{copy.ctaSub}</p>
        <div className="lp-hero-cta">
          <PrimaryButton onClick={openBookingFlow} disabled={bookingBusy}>
            {bookingBusy ? (lang === 'da' ? 'Sender...' : 'Sending...') : copy.ctaBook}
          </PrimaryButton>
          <PrimaryButton variant="secondary" onClick={openAudienceDemo}>
            {copy.ctaDemo}
          </PrimaryButton>
        </div>
        <form className="lp-signup" onSubmit={submitAvailabilitySignup}>
          <label htmlFor="lp-signup-email">{copy.signupLabel}</label>
          <div className="lp-signup-row">
            <input
              id="lp-signup-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={copy.signupPlaceholder}
              value={signupEmail}
              onChange={(event) => setSignupEmail(event.target.value)}
            />
            <PrimaryButton type="submit">
              {copy.signupCta}
            </PrimaryButton>
          </div>
          {signupError ? <p className="lp-signup-error">{signupError}</p> : null}
        </form>
        <button type="button" className="lp-admin-link" onClick={openAdminLogin}>
          Admin login
        </button>
      </section>
    </section>
  )
}

export default HomePage
