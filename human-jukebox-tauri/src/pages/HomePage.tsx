import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, MessageCircle, Smartphone } from 'lucide-react'
import { resetOGTags } from '../lib/metaTags'
import { PrimaryButton } from '../components/ui'
import { demoMode } from '../demo/demoMode'
import { readCommittedAudienceLocale, commitAudienceLocale } from '../lib/audienceIdentity'
import { openMirrorScreen } from '../lib/openMirrorScreen'
import '../styles/home-landing.css'

type HomeLang = 'en' | 'da'
type GigType = 'afternoon' | 'evening' | 'both'

const INTERNAL_BOOKING_ENDPOINT = '/api/book-show'
const GET_UPDATES_ENDPOINT = '/api/get-updates'
const MIRROR_PREVIEW_BASE_WIDTH = 1440
const COPY = {
  en: {
    eyebrow: 'Trusted by venues that want full rooms',
    h1Line1: 'Your crowd picks the songs.',
    h1Line2: 'Your night becomes',
    h1Accent: 'the one people stay for.',
    subtitle: 'I\'m Harald - a live performer who brings an interactive jukebox show to your pub. Guests request songs, vote the queue, and keep the room engaged longer because the night feels personal, social, and alive.',
    bookCta: 'Book the show',
    demoCta: 'See how it works',
    mirrorPreviewLabel: 'Mirror demo',
    mirrorPreviewTitle: 'Preview the live mirror screen right here',
    mirrorPreviewCopy: 'This is the real mirror view your crowd sees. Use the button to pop it into a separate native window.',
    mirrorPreviewAction: 'Open mirror window',
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
    eyebrow: 'Booket af steder, der vil have fuldt hus',
    h1Line1: 'Dine gæster vælger sangene.',
    h1Line2: 'Din aften bliver',
    h1Accent: 'den, folk bliver hængende til.',
    subtitle: 'Jeg hedder Harald - en live performer, der bringer en interaktiv jukebox til din pub. Gæsterne ønsker sange, stemmer på køen og bliver en aktiv del af showet, så aftenen føles mere social og levende.',
    bookCta: 'Book showet',
    demoCta: 'Se hvordan det virker',
    mirrorPreviewLabel: 'Skærmdemo',
    mirrorPreviewTitle: 'Se live mirror-skærmen her',
    mirrorPreviewCopy: 'Dette er den rigtige mirror-visning til publikum. Brug knappen for at åbne den i et separat native vindue.',
    mirrorPreviewAction: 'Åbn mirror-vinduet',
    stats: [
      { value: '500+', label: 'Sangønsker pr. show' },
      { value: '100%', label: 'Publikumsstyret sætliste' },
      { value: '0', label: 'Apps gæsterne skal installere' },
      { value: '40+', label: 'Spillesteder underholdt' },
    ],
    featuresTitle: 'Sådan virker det',
    features: [
      { icon: 'building', label: 'Du booker showet', copy: 'En besked er alt, der skal til. Jeg møder op fuldt klar til at spille.' },
      { icon: 'phone', label: 'Gæster scanner og deltager', copy: 'Ingen app at installere. Gæster ønsker og stemmer fra enhver telefon.' },
      { icon: 'chat', label: 'Publikum styrer sættet', copy: 'Live ønsker og stemmer flytter køen i realtid hele aftenen.' },
    ],
    socialTitle: 'Betroet af spillesteder, der vil have fulde huse',
    socialProof: [
      { quote: 'Gæsterne blev længere og brugte mere, fordi de følte ejerskab over køen.', name: 'Spillestedsejer, København' },
      { quote: 'Den nemmeste liveaften, vi har afholdt. Opsætningen var smidig, og gæsterne elskede det.', name: 'Barmanager, Reykjavik' },
      { quote: 'Ingen app-friktion. Folk kom i gang med det samme og blev ved med at stemme hele aftenen.', name: 'Eventvært, Aarhus' },
    ],
    ctaEyebrow: 'Klar til at give din pub en aften, de taler om?',
    ctaHeading: 'Book The Human Jukebox til din pubs næste event',
    ctaSub: 'Pubber, barer, restauranter, private fester og festivaler. En besked er nok - jeg klarer resten.',
    ctaBook: 'Book showet',
    ctaDemo: 'Prøv demo først',
    signupLabel: 'Få løbende besked om ledige datoer på e-mail fra værten',
    signupPlaceholder: 'søren@værtshus.dk',
    signupCta: 'Få løbende opdateringer',
  },
}

const HOME_UI_COPY = {
  en: {
    bookingToggleClosed: 'Request Booking',
    bookingToggleOpen: 'Close booking form',
    bookingFormTitle: 'Request Booking',
    bookingFormHelp: 'Fill in your details and press Book the show to send your request.',
    venueNamePlaceholder: 'Venue name *',
    venueNameAria: 'Venue name',
    venueIdPlaceholder: 'Venue ID (optional)',
    venueIdAria: 'Venue ID optional',
    dateAria: 'Date',
    openCalendar: 'Open calendar',
    gigTypeAria: 'Gig type',
    gigTypeAfternoon: 'afternoon',
    gigTypeEvening: 'evening',
    gigTypeBoth: 'both',
    feePlaceholder: 'Fee',
    feeAria: 'Fee',
    notesPlaceholder: 'Notes',
    notesAria: 'Notes',
    contactEmailPlaceholder: 'External contact email *',
    contactEmailAria: 'External contact email',
    bookingSubmitIdle: 'Book the show',
    bookingSubmitBusy: 'Sending...',
    venueNameRequired: 'Venue name is required.',
    dateFormatError: 'Date must use YYYY-MM-DD format.',
    contactEmailError: 'External contact email is required and must be valid.',
    feeNumberError: 'Fee must be a number.',
    bookingNoticeFallback: 'Booking received',
    bookingErrorFallback: 'Booking could not be sent. Please try again.',
    signupErrorFallback: 'Could not send update email. Please try again.',
    heroCards: [
      {
        label: 'Live screen',
        title: 'The room sees every request',
        copy: 'Guests join, vote, and watch the queue change on the shared TV in real time.',
      },
      {
        label: 'What it feels like',
        title: 'Big, clear, and easy to follow',
        copy: 'Now playing, live feed, queue, and QR stay readable from across the venue.',
      },
      {
        label: 'Why it works',
        title: 'More energy, longer stays',
        copy: 'It turns the crowd into the show without adding friction or extra apps.',
      },
    ],
    adminLogin: 'Admin login',
  },
  da: {
    bookingToggleClosed: 'Send bookingforespørgsel',
    bookingToggleOpen: 'Luk bookingformular',
    bookingFormTitle: 'Bookingforespørgsel',
    bookingFormHelp: 'Udfyld dine oplysninger og tryk på Book showet for at sende din forespørgsel.',
    venueNamePlaceholder: 'Navn på spillested *',
    venueNameAria: 'Navn på spillested',
    venueIdPlaceholder: 'Spillested-ID (valgfrit)',
    venueIdAria: 'Spillested-ID valgfrit',
    dateAria: 'Dato',
    openCalendar: 'Åbn kalender',
    gigTypeAria: 'Type af gig',
    gigTypeAfternoon: 'eftermiddag',
    gigTypeEvening: 'aften',
    gigTypeBoth: 'begge',
    feePlaceholder: 'Honorar',
    feeAria: 'Honorar',
    notesPlaceholder: 'Noter',
    notesAria: 'Noter',
    contactEmailPlaceholder: 'Kontakt-e-mail *',
    contactEmailAria: 'Kontakt-e-mail',
    bookingSubmitIdle: 'Book showet',
    bookingSubmitBusy: 'Sender...',
    venueNameRequired: 'Navn på spillested er påkrævet.',
    dateFormatError: 'Dato skal være i formatet ÅÅÅÅ-MM-DD.',
    contactEmailError: 'Kontakt-e-mail er påkrævet og skal være gyldig.',
    feeNumberError: 'Honorar skal være et tal.',
    bookingNoticeFallback: 'Booking modtaget',
    bookingErrorFallback: 'Booking kunne ikke sendes. Prøv igen.',
    signupErrorFallback: 'Kunne ikke sende opdateringsmail. Prøv igen.',
    heroCards: [
      {
        label: 'Live-skærm',
        title: 'Rummet ser hvert eneste ønske',
        copy: 'Gæster logger på, stemmer og ser køen ændre sig i realtid på fællesskærmen.',
      },
      {
        label: 'Sådan føles det',
        title: 'Stort, tydeligt og let at følge',
        copy: 'Spiller nu, livefeed, kø og QR er læsbart i hele lokalet.',
      },
      {
        label: 'Derfor virker det',
        title: 'Mere energi, længere ophold',
        copy: 'Publikum bliver en aktiv del af showet uden ekstra apps eller friktion.',
      },
    ],
    adminLogin: 'Admin-login',
  },
} as const

function resolveSignupErrorMessage(body: unknown, status: number, lang: HomeLang) {
  const fallbackMessage = lang === 'da'
    ? 'Kunne ikke sende update-mail lige nu. Prøv igen om lidt.'
    : 'Could not send update email right now. Please try again shortly.'

  if (!body || typeof body !== 'object') {
    return fallbackMessage
  }

  const normalizedBody = body as { code?: unknown; message?: unknown }
  const code = typeof normalizedBody.code === 'string' ? normalizedBody.code : ''
  const message = typeof normalizedBody.message === 'string' ? normalizedBody.message : ''
  const normalizedMessage = message.toLowerCase()

  const serviceUnavailable = code === 'updates_service_unavailable'
    || status === 503
    || normalizedMessage.includes('api key is invalid')
    || normalizedMessage.includes('email service is not configured')

  if (serviceUnavailable) {
    return lang === 'da'
      ? 'Update-mail er midlertidigt utilgængelig. Brug bookingformularen, så kontakter vi dig.'
      : 'Updates email is temporarily unavailable. Please use the booking form and we will contact you.'
  }

  if (message.trim()) {
    return message
  }

  return fallbackMessage
}

function HomePage() {
  const navigate = useNavigate()
  const bookingFormRef = useRef<HTMLFormElement | null>(null)
  const bookingDateInputRef = useRef<HTMLInputElement | null>(null)
  const mirrorPreviewViewportRef = useRef<HTMLDivElement | null>(null)
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
  const homeUiCopy = HOME_UI_COPY[lang]

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

  const openMirrorDemo = () => {
    void openMirrorScreen({ demo: true })
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
      setBookingError(homeUiCopy.venueNameRequired)
      return
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate.trim())) {
      setBookingError(homeUiCopy.dateFormatError)
      return
    }

    if (!emailPattern.test(bookingContactEmail.trim())) {
      setBookingError(homeUiCopy.contactEmailError)
      return
    }

    if (bookingFee.trim() && Number.isNaN(Number(bookingFee))) {
      setBookingError(homeUiCopy.feeNumberError)
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

        setBookingNotice(body?.message || homeUiCopy.bookingNoticeFallback)
        setBookingFormOpen(false)
      } catch (error) {
        console.warn('HomePage: failed to send booking request', error)
        setBookingError(error instanceof Error ? error.message : homeUiCopy.bookingErrorFallback)
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
      setSignupError(lang === 'da' ? 'Indtast en gyldig emailadresse.' : 'Enter a valid email address.')
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
            lang,
            intent: 'availability-updates',
            source: 'home-signup',
          }),
        })

        const body = await response.json().catch(() => null)
        if (!response.ok || !body?.success) {
          throw new Error(resolveSignupErrorMessage(body, response.status, lang))
        }

        const usedFallbackDelivery = body?.delivery === 'fallback' || body?.fallback_routed === true
        if (usedFallbackDelivery) {
          setSignupNotice(
            lang === 'da'
              ? 'Tak. Din forespørgsel er modtaget. Vi kontakter dig snart med mere info.'
              : 'Thanks. Your request was received, and we will contact you shortly with details.',
          )
        } else {
          setSignupNotice(
            lang === 'da'
              ? 'Tak for din interesse. Opdateringsmailen er sendt.'
              : 'Thank you for your interest. Your update email has been sent.',
          )
        }
        setSignupEmail('')
      } catch (error) {
        setSignupError(error instanceof Error ? error.message : homeUiCopy.signupErrorFallback)
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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const viewport = mirrorPreviewViewportRef.current
    if (!viewport) {
      return
    }

    const updateScale = () => {
      const viewportWidth = viewport.clientWidth
      if (!viewportWidth) {
        return
      }

      const nextScale = Math.min(1, Math.max(0.2, viewportWidth / MIRROR_PREVIEW_BASE_WIDTH))
      viewport.style.setProperty('--lp-mirror-scale', nextScale.toString())
    }

    updateScale()
    const observer = new ResizeObserver(updateScale)
    observer.observe(viewport)

    return () => {
      observer.disconnect()
    }
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

            <div className="lp-copy-block-actions">
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
                  {bookingFormOpen ? homeUiCopy.bookingToggleOpen : homeUiCopy.bookingToggleClosed}
                </PrimaryButton>
                <PrimaryButton variant="secondary" onClick={openAudienceDemo}>
                  {copy.demoCta}
                </PrimaryButton>
              </div>
            </div>

            {bookingFormOpen ? (
              <form ref={bookingFormRef} className="lp-booking-form lp-copy-block" onSubmit={submitBookingRequest}>
                <p className="lp-booking-form-title">{homeUiCopy.bookingFormTitle}</p>
                <p className="lp-booking-form-help">{homeUiCopy.bookingFormHelp}</p>
                <input
                  type="text"
                  placeholder={homeUiCopy.venueNamePlaceholder}
                  aria-label={homeUiCopy.venueNameAria}
                  value={bookingVenueName}
                  onChange={(event) => setBookingVenueName(event.target.value)}
                  required
                />
                <input
                  type="text"
                  placeholder={homeUiCopy.venueIdPlaceholder}
                  aria-label={homeUiCopy.venueIdAria}
                  value={bookingVenueId}
                  onChange={(event) => setBookingVenueId(event.target.value)}
                />
                <div className="lp-booking-date-row">
                  <input
                    ref={bookingDateInputRef}
                    type="date"
                    aria-label={homeUiCopy.dateAria}
                    value={bookingDate}
                    onChange={(event) => setBookingDate(event.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="lp-booking-date-picker-button"
                    onClick={() => {
                      const dateInput = bookingDateInputRef.current
                      dateInput?.showPicker?.()
                      dateInput?.focus()
                    }}
                  >
                    {homeUiCopy.openCalendar}
                  </button>
                </div>
                <select aria-label={homeUiCopy.gigTypeAria} value={bookingGigType} onChange={(event) => setBookingGigType(event.target.value as GigType)}>
                  <option value="afternoon">{homeUiCopy.gigTypeAfternoon}</option>
                  <option value="evening">{homeUiCopy.gigTypeEvening}</option>
                  <option value="both">{homeUiCopy.gigTypeBoth}</option>
                </select>
                <input
                  type="number"
                  placeholder={homeUiCopy.feePlaceholder}
                  aria-label={homeUiCopy.feeAria}
                  value={bookingFee}
                  onChange={(event) => setBookingFee(event.target.value)}
                />
                <textarea
                  placeholder={homeUiCopy.notesPlaceholder}
                  aria-label={homeUiCopy.notesAria}
                  value={bookingNotes}
                  onChange={(event) => setBookingNotes(event.target.value)}
                  rows={3}
                />
                <input
                  type="email"
                  placeholder={homeUiCopy.contactEmailPlaceholder}
                  aria-label={homeUiCopy.contactEmailAria}
                  value={bookingContactEmail}
                  onChange={(event) => setBookingContactEmail(event.target.value)}
                  required
                />
                <div className="lp-booking-actions">
                  <PrimaryButton type="submit" disabled={bookingBusy}>
                    {bookingBusy ? homeUiCopy.bookingSubmitBusy : homeUiCopy.bookingSubmitIdle}
                  </PrimaryButton>
                </div>
              </form>
            ) : null}
            {bookingNotice ? <p className="lp-booking-notice">{bookingNotice}</p> : null}
            {bookingError ? <p className="lp-booking-error">{bookingError}</p> : null}
          </div>

          <div className="lp-hero-blocks" aria-label="Show highlights">
            {homeUiCopy.heroCards.map((card) => (
              <article key={card.title} className="lp-hero-block-card">
                <p className="lp-hero-block-label">{card.label}</p>
                <h2>{card.title}</h2>
                <p>{card.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-mirror-preview" aria-label="Mirror demo preview">
        <div className="lp-mirror-preview-copy">
          <p className="lp-mirror-preview-label">{copy.mirrorPreviewLabel}</p>
          <h2>{copy.mirrorPreviewTitle}</h2>
          <p>{copy.mirrorPreviewCopy}</p>
          <PrimaryButton variant="secondary" className="lp-mirror-preview-desktop-action" onClick={openMirrorDemo}>
            {copy.mirrorPreviewAction}
          </PrimaryButton>
        </div>
        <div className="lp-mirror-preview-frame-shell" role="img" aria-label="Mirror screen preview">
          <div ref={mirrorPreviewViewportRef} className="lp-mirror-preview-frame-viewport">
            <iframe
              className="lp-mirror-preview-frame"
              src="/mirror?demo=true&safeMargins=1&density=medium&cast=1"
              title="Human Jukebox mirror preview"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
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
          {homeUiCopy.adminLogin}
        </button>
      </section>
    </section>
  )
}

export default HomePage
