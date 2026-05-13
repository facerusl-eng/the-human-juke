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
type GigType = 'afternoon' | 'evening' | 'both'

const BOOKING_MANAGER_URL = import.meta.env.VITE_BOOKING_URL?.trim() || 'https://book-jukebox.base44.app/'
const INTERNAL_BOOKING_ENDPOINT = '/api/book-show'
const BOOKING_WEBHOOK_STORAGE_KEY = 'human-jukebox-booking-webhook-url'
const DEFAULT_BOOKING_WEBHOOK_URL = import.meta.env.VITE_EXTERNAL_BOOKING_WEBHOOK_URL?.trim() || ''

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
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [bookingFormOpen, setBookingFormOpen] = useState(false)
  const [bookingWebhookUrl, setBookingWebhookUrl] = useState('')
  const [bookingVenueName, setBookingVenueName] = useState('')
  const [bookingVenueId, setBookingVenueId] = useState('')
  const [bookingDate, setBookingDate] = useState('')
  const [bookingGigType, setBookingGigType] = useState<GigType>('evening')
  const [bookingFee, setBookingFee] = useState('')
  const [bookingNotes, setBookingNotes] = useState('')
  const [bookingContactEmail, setBookingContactEmail] = useState('')
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
    setBookingFormOpen((current) => !current)
    setBookingNotice(null)
    setBookingError(null)
  }

  const submitBookingRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (!bookingWebhookUrl.trim()) {
      setBookingError('Paste your External Bookings webhook URL from dashboard settings.')
      return
    }

    if (!bookingVenueName.trim()) {
      setBookingError('Venue name is required.')
      return
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate.trim())) {
      setBookingError('Date must use YYYY-MM-DD format.')
      return
    }

    if (!emailPattern.test(bookingContactEmail.trim())) {
      setBookingError('External contact email is required and must be valid.')
      return
    }

    if (bookingFee.trim() && Number.isNaN(Number(bookingFee))) {
      setBookingError('Fee must be a number.')
      return
    }

    setBookingBusy(true)
    setBookingError(null)
    setBookingNotice(null)

    void (async () => {
      try {
        const response = await fetch(INTERNAL_BOOKING_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            webhookUrl: bookingWebhookUrl.trim(),
            booking: {
              venue_name: bookingVenueName.trim(),
              venue_id: bookingVenueId.trim() || undefined,
              date: bookingDate.trim(),
              gig_type: bookingGigType,
              fee: bookingFee.trim() ? Number(bookingFee) : undefined,
              notes: bookingNotes.trim() || undefined,
              external_contact_email: bookingContactEmail.trim(),
            },
          }),
        })

        const body = await response.json().catch(() => null)

        if (!response.ok || !body?.success) {
          throw new Error(body?.message || `Booking failed with status ${response.status}`)
        }

        if (typeof window !== 'undefined') {
          window.localStorage.setItem(BOOKING_WEBHOOK_STORAGE_KEY, bookingWebhookUrl.trim())
        }

        setBookingNotice(body?.message || 'Booking received')
        setBookingFormOpen(false)
      } catch (error) {
        console.warn('HomePage: failed to send booking request', error)
        setBookingError(error instanceof Error ? error.message : 'Booking could not be sent. Please try again.')
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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const storedWebhookUrl = window.localStorage.getItem(BOOKING_WEBHOOK_STORAGE_KEY)?.trim() || ''
    setBookingWebhookUrl(storedWebhookUrl || DEFAULT_BOOKING_WEBHOOK_URL)
  }, [])

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
                {bookingFormOpen ? 'Close booking form' : 'Request Booking'}
              </PrimaryButton>
              <PrimaryButton variant="secondary" onClick={openAudienceDemo}>
                {copy.demoCta}
              </PrimaryButton>
            </div>
            {bookingFormOpen ? (
              <form className="lp-booking-form" onSubmit={submitBookingRequest}>
                <p className="lp-booking-form-title">Request Booking</p>
                <p className="lp-booking-form-help">Paste your webhook URL from Settings -&gt; External Bookings in your dashboard.</p>
                <input
                  type="url"
                  placeholder="Webhook URL"
                  value={bookingWebhookUrl}
                  onChange={(event) => setBookingWebhookUrl(event.target.value)}
                  required
                />
                <input
                  type="text"
                  placeholder="Venue name *"
                  value={bookingVenueName}
                  onChange={(event) => setBookingVenueName(event.target.value)}
                  required
                />
                <input
                  type="text"
                  placeholder="Venue ID (optional)"
                  value={bookingVenueId}
                  onChange={(event) => setBookingVenueId(event.target.value)}
                />
                <input
                  type="date"
                  value={bookingDate}
                  onChange={(event) => setBookingDate(event.target.value)}
                  required
                />
                <select value={bookingGigType} onChange={(event) => setBookingGigType(event.target.value as GigType)}>
                  <option value="afternoon">afternoon</option>
                  <option value="evening">evening</option>
                  <option value="both">both</option>
                </select>
                <input
                  type="number"
                  placeholder="Fee"
                  value={bookingFee}
                  onChange={(event) => setBookingFee(event.target.value)}
                />
                <textarea
                  placeholder="Notes"
                  value={bookingNotes}
                  onChange={(event) => setBookingNotes(event.target.value)}
                  rows={3}
                />
                <input
                  type="email"
                  placeholder="External contact email *"
                  value={bookingContactEmail}
                  onChange={(event) => setBookingContactEmail(event.target.value)}
                  required
                />
                <div className="lp-booking-actions">
                  <PrimaryButton type="submit" disabled={bookingBusy}>
                    {bookingBusy ? 'Sending...' : 'Send booking request'}
                  </PrimaryButton>
                </div>
              </form>
            ) : null}
            {bookingNotice ? <p className="lp-booking-notice">{bookingNotice}</p> : null}
            {bookingError ? <p className="lp-booking-error">{bookingError}</p> : null}
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
