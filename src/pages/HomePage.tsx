import { useEffect, useRef, useState } from 'react'
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

const INTERNAL_BOOKING_ENDPOINT = '/api/book-show'
const GET_UPDATES_ENDPOINT = '/api/get-updates'

const COPY = {
  en: {
    eyebrow: 'Trusted by venues that want full rooms',
    h1Line1: 'Your crowd picks the songs.',
    h1Line2: 'Your night becomes',
    h1Accent: 'the one people stay for.',
    subtitle: 'I\'m Harald - a live performer who brings an interactive jukebox show to your pub. Guests request songs, vote the queue, and keep the room engaged longer because the night feels personal, social, and alive.',
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
    socialTitle: 'What you can use today',
    socialProof: [
      { quote: 'Fast start: guests scan one QR and begin requesting songs in under a minute.', name: 'Immediate win' },
      { quote: 'Simple operation: one live screen shows queue, now playing, and crowd momentum all night.', name: 'Operational clarity' },
      { quote: 'Direct booking path: explain the concept, show upcoming gigs, and book in one flow.', name: 'Ready to run now' },
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
    eyebrow: 'Booket af steder der vil have fuldt hus',
    h1Line1: 'Dine gaester vaelger sangene.',
    h1Line2: 'Din aften bliver',
    h1Accent: 'den folk bliver laengere til.',
    subtitle: 'Jeg hedder Harald - en live performer der bringer en interaktiv jukebox til din pub. Gaesterne onsker sange, stemmer pa koen og bliver hvirvlet ind i noget, der gor aftenen mere social og mere levende.',
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
    socialTitle: 'Betroet af spillesteder, der vil have fulde huse',
    socialProof: [
      { quote: 'Gaesterne blev laengere og brugte mere, fordi de folte ejerskab over koen.', name: 'Spillestedsejer, Kobenhavn' },
      { quote: 'Den nemmeste liveaften vi har afholdt. Opsaetningen var smidig, og gaesterne elskede det.', name: 'Barmanager, Reykjavik' },
      { quote: 'Ingen app-friktion. Folk kom i gang med det samme og blev ved med at stemme hele aftenen.', name: 'Eventvaert, Aarhus' },
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
  const bookingFormRef = useRef<HTMLFormElement | null>(null)
  const [signupEmail, setSignupEmail] = useState('')
  const [signupError, setSignupError] = useState<string | null>(null)
  const [signupNotice, setSignupNotice] = useState<string | null>(null)
  const [bookingBusy, setBookingBusy] = useState(false)
  const [bookingNotice, setBookingNotice] = useState<string | null>(null)
  const [bookingError, setBookingError] = useState<string | null>(null)
  const [bookingFormOpen, setBookingFormOpen] = useState(false)
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

  const scrollToBookingForm = () => {
    if (typeof window === 'undefined') {
      return
    }

    window.requestAnimationFrame(() => {
      bookingFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const openBookingFlow = () => {
    setBookingFormOpen(true)
    setBookingNotice(null)
    setBookingError(null)
    scrollToBookingForm()
  }

  const toggleBookingFlow = () => {
    setBookingFormOpen((current) => {
      const next = !current
      if (next) {
        scrollToBookingForm()
      }
      return next
    })
    setBookingNotice(null)
    setBookingError(null)
  }

  const submitBookingRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
            venue_name: bookingVenueName.trim(),
            date: bookingDate.trim(),
            gig_type: bookingGigType,
            requested_fee: bookingFee.trim() ? Number(bookingFee) : undefined,
            contact_email: bookingContactEmail.trim(),
            notes: bookingNotes.trim() || undefined,
          }),
        })

        const body = await response.json().catch(() => null)

        if (!response.ok || !body?.success) {
          const detailSummary = Array.isArray(body?.details)
            ? body.details
              .map((detail: { target?: string; status?: number; details?: string }) => {
                const target = detail?.target || 'unknown target'
                const status = detail?.status ?? 'unknown status'
                return `${target} (${status})`
              })
              .join(', ')
            : typeof body?.details === 'string'
              ? body.details
              : ''

          const baseMessage = body?.message || `Booking failed with status ${response.status}`
          throw new Error(detailSummary ? `${baseMessage}: ${detailSummary}` : baseMessage)
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
    setSignupNotice(null)

    void (async () => {
      try {
        const response = await fetch(GET_UPDATES_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: normalizedEmail,
            intent: 'availability-updates',
            source: 'home-signup',
          }),
        })

        const body = await response.json().catch(() => null)
        if (!response.ok || !body?.success) {
          throw new Error(body?.message || `Signup failed with status ${response.status}`)
        }

        setSignupNotice(lang === 'da' ? 'Tak for din interesse. Din email kommer snart.' : 'Thank you for your interest. Your email will arrive soon.')
        setSignupEmail('')
      } catch (error) {
        setSignupError(error instanceof Error ? error.message : 'Could not send update email. Please try again.')
      }
    })()
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

    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.get('booking') !== '1') {
      return
    }

    setBookingFormOpen(true)
    setBookingNotice(null)
    setBookingError(null)
    scrollToBookingForm()
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
            <div className="lp-copy-block lp-copy-block-lead">
              <p className="lp-eyebrow">{copy.eyebrow}</p>
              <h1 className="lp-title">
                {copy.h1Line1}
                <br />
                {copy.h1Line2} <span>{copy.h1Accent}</span>
              </h1>
              <p className="lp-subtitle">{copy.subtitle}</p>
            </div>

            <div className="lp-copy-block lp-copy-block-actions">
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
                <PrimaryButton onClick={toggleBookingFlow} disabled={bookingBusy}>
                  {bookingFormOpen ? 'Close booking form' : 'Request Booking'}
                </PrimaryButton>
                <PrimaryButton variant="secondary" onClick={openAudienceDemo}>
                  {copy.demoCta}
                </PrimaryButton>
              </div>
            </div>

            {bookingFormOpen ? (
              <form ref={bookingFormRef} className="lp-booking-form lp-copy-block" onSubmit={submitBookingRequest}>
                <p className="lp-booking-form-title">Request Booking</p>
                <p className="lp-booking-form-help">Fill in your details and press Book the show to send your request.</p>
                <input
                  type="text"
                  placeholder="Venue name *"
                  aria-label="Venue name"
                  value={bookingVenueName}
                  onChange={(event) => setBookingVenueName(event.target.value)}
                  required
                />
                <input
                  type="text"
                  placeholder="Venue ID (optional)"
                  aria-label="Venue ID optional"
                  value={bookingVenueId}
                  onChange={(event) => setBookingVenueId(event.target.value)}
                />
                <input
                  type="date"
                  aria-label="Date"
                  value={bookingDate}
                  onChange={(event) => setBookingDate(event.target.value)}
                  required
                />
                <select aria-label="Gig type" value={bookingGigType} onChange={(event) => setBookingGigType(event.target.value as GigType)}>
                  <option value="afternoon">afternoon</option>
                  <option value="evening">evening</option>
                  <option value="both">both</option>
                </select>
                <input
                  type="number"
                  placeholder="Fee"
                  aria-label="Fee"
                  value={bookingFee}
                  onChange={(event) => setBookingFee(event.target.value)}
                />
                <textarea
                  placeholder="Notes"
                  aria-label="Notes"
                  value={bookingNotes}
                  onChange={(event) => setBookingNotes(event.target.value)}
                  rows={3}
                />
                <input
                  type="email"
                  placeholder="External contact email *"
                  aria-label="External contact email"
                  value={bookingContactEmail}
                  onChange={(event) => setBookingContactEmail(event.target.value)}
                  required
                />
                <div className="lp-booking-actions">
                  <PrimaryButton type="submit" disabled={bookingBusy}>
                    {bookingBusy ? 'Sending...' : 'Book the show'}
                  </PrimaryButton>
                </div>
              </form>
            ) : null}
            {bookingNotice ? <p className="lp-booking-notice">{bookingNotice}</p> : null}
            {bookingError ? <p className="lp-booking-error">{bookingError}</p> : null}
          </div>

          <div className="lp-hero-blocks" aria-label="Show highlights">
            <article className="lp-hero-block-card">
              <p className="lp-hero-block-label">Live screen</p>
              <h2>The room sees every request</h2>
              <p>Guests join, vote, and watch the queue change on the shared TV in real time.</p>
            </article>
            <article className="lp-hero-block-card">
              <p className="lp-hero-block-label">What it feels like</p>
              <h2>Big, clear, and easy to follow</h2>
              <p>Now playing, live feed, queue, and QR stay readable from across the venue.</p>
            </article>
            <article className="lp-hero-block-card">
              <p className="lp-hero-block-label">Why it works</p>
              <h2>More energy, longer stays</h2>
              <p>It turns the crowd into the show without adding friction or extra apps.</p>
            </article>
          </div>
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
          {signupNotice ? <p className="lp-signup-notice">{signupNotice}</p> : null}
        </form>
        <button type="button" className="lp-admin-link" onClick={openAdminLogin}>
          Admin login
        </button>
      </section>
    </section>
  )
}

export default HomePage
