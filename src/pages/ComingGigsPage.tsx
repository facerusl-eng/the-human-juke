import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarDays, Mic2, Users } from 'lucide-react'
import { PrimaryButton } from '../components/ui'
import { readCommittedAudienceLocale, commitAudienceLocale } from '../lib/audienceIdentity'
import '../styles/coming-gigs.css'

type ComingGigsLang = 'en' | 'da'

type UpcomingGig = {
  id: string
  name: string
  venue: string | null
  gigDate: string | null
  gigStartTime: string | null
  eventType: 'halli-live' | 'karaoke'
}

function toIntlLocale(lang: ComingGigsLang) {
  return lang === 'da' ? 'da-DK' : 'en-US'
}

function normalizeTimeForDate(value: string | null): string | null {
  if (!value) {
    return null
  }

  const trimmedValue = value.trim()

  if (trimmedValue.length > 5 && trimmedValue[2] === ':' && trimmedValue[5] === ':') {
    return trimmedValue.slice(0, 5)
  }

  return trimmedValue
}

function formatGigDateLabel(gig: UpcomingGig, lang: ComingGigsLang, fallback: string): string {
  if (!gig.gigDate) {
    return fallback
  }

  const normalizedTime = normalizeTimeForDate(gig.gigStartTime)
  const safeTime = normalizedTime ? `${normalizedTime}:00` : '18:00:00'
  const parsedDate = new Date(`${gig.gigDate}T${safeTime}`)

  if (Number.isNaN(parsedDate.getTime())) {
    return gig.gigDate
  }

  return new Intl.DateTimeFormat(toIntlLocale(lang), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(normalizedTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(parsedDate)
}

function normalizeUpcomingGigs(rawRows: unknown): UpcomingGig[] {
  if (!Array.isArray(rawRows)) {
    return []
  }

  return rawRows
    .map((rawRow) => {
      if (!rawRow || typeof rawRow !== 'object') {
        return null
      }

      const row = rawRow as Record<string, unknown>
      const id = String(row.id ?? '').trim()
      const name = typeof row.name === 'string' ? row.name.trim() : ''

      if (!id || !name) {
        return null
      }

      const venue = typeof row.venue === 'string' ? row.venue.trim() : ''
      const gigDate = typeof row.gig_date === 'string' ? row.gig_date.trim() : ''
      const gigStartTime = typeof row.gig_start_time === 'string' ? row.gig_start_time.trim() : ''

      return {
        id,
        name,
        venue: venue || null,
        gigDate: gigDate || null,
        gigStartTime: gigStartTime || null,
        eventType: row.event_type === 'karaoke' ? 'karaoke' : 'halli-live',
      } satisfies UpcomingGig
    })
    .filter((gig): gig is UpcomingGig => gig !== null)
}

const COPY: Record<ComingGigsLang, {
  eyebrow: string
  h1: string
  description: string
  description2: string
  updatesNote: string
  bookBtn: string
  demoBtn: string
  cardTitles: [string, string, string]
  cardDescriptions: [string, string, string]
  upcomingTitle: string
  loadingUpcoming: string
  upcomingEmpty: string
  upcomingError: string
  venueFallback: string
  dateFallback: string
  liveStatus: string
  karaokeStatus: string
}> = {
  en: {
    eyebrow: 'Coming gigs and how the concept works',
    h1: 'What venues book, and why guests stay engaged all night',
    description: 'The Human Jukebox is a live performer plus a crowd-driven queue system. Guests scan once, request songs from any phone, and vote in real time while your full room follows one shared live screen.',
    description2: 'Every request creates anticipation, every vote creates momentum, and the set evolves with your crowd. It feels live, social, and easy to join.',
    updatesNote: 'Updates requested for {{email}}. Use booking below to lock in your preferred date.',
    bookBtn: 'Book the show',
    demoBtn: 'See audience demo',
    cardTitles: [
      'Crowd-powered setlist',
      'Live performer, not a playlist',
      'Built for recurring nights',
    ],
    cardDescriptions: [
      'Guests do not need an app. They join quickly, request tracks, and shape the order live.',
      'Harald performs live while balancing requests, karaoke moments, and the room\'s energy.',
      'Works for pubs, bars, private events, and launch weeks where return visits matter.',
    ],
    upcomingTitle: 'Upcoming gigs',
    loadingUpcoming: 'Loading upcoming gigs...',
    upcomingEmpty: 'No upcoming gigs are posted yet.',
    upcomingError: 'Could not load upcoming gigs right now. Please try again soon.',
    venueFallback: 'Venue to be announced',
    dateFallback: 'Date to be announced',
    liveStatus: 'Open Request Night',
    karaokeStatus: 'Karaoke + Live Queue',
  },
  da: {
    eyebrow: 'Kommende arrangementer og hvordan konceptet virker',
    h1: 'Hvad spillesteder booker, og hvorfor gæster bliver hele aftenen',
    description: 'The Human Jukebox er en live performer plus et publikumsstyret kø-system. Gæster scanner en gang, anmoder om sange fra enhver telefon, og stemmer live mens hele rummet følger en delt live-skærm.',
    description2: 'Hver anmodning skaber forventning, hver stemme skaber momentum, og setlisten udvikler sig med dit publikum. Det føles live, socialt og nemt at deltage i.',
    updatesNote: 'Opdateringer anmodet for {{email}}. Brug booking nedenfor for at låse din foretrukne dato.',
    bookBtn: 'Book showet',
    demoBtn: 'Se publikums-demo',
    cardTitles: [
      'Publikumsstyret setliste',
      'Live performer, ikke en spilleliste',
      'Bygget til tilbagevendende aftener',
    ],
    cardDescriptions: [
      'Gæster har ikke brug for en app. De deltager hurtigt, anmoder om numre og former køen live.',
      'Harald optræder live mens han balancerer anmodninger, karaoke-øjeblikke og rumlets energi.',
      'Virker til pubber, barer, private arrangementer og lanceringsuge hvor gentagne besøg betyder noget.',
    ],
    upcomingTitle: 'Kommende arrangementer',
    loadingUpcoming: 'Indlæser kommende arrangementer...',
    upcomingEmpty: 'Der er ingen kommende arrangementer endnu.',
    upcomingError: 'Kunne ikke hente kommende arrangementer lige nu. Prøv igen om lidt.',
    venueFallback: 'Sted annonceres senere',
    dateFallback: 'Dato annonceres senere',
    liveStatus: 'Åben ønskeliste-aften',
    karaokeStatus: 'Karaoke + live kø',
  },
}

function ComingGigsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [lang, setLang] = useState<ComingGigsLang>(() => {
    const stored = readCommittedAudienceLocale()
    return stored === 'da' ? 'da' : 'en'
  })
  const [upcomingGigs, setUpcomingGigs] = useState<UpcomingGig[]>([])
  const [isLoadingUpcoming, setIsLoadingUpcoming] = useState(true)
  const [hasUpcomingLoadError, setHasUpcomingLoadError] = useState(false)

  const email = (searchParams.get('email') || '').trim()
  const copy = COPY[lang]

  useEffect(() => {
    const controller = new AbortController()

    const loadUpcomingGigs = async () => {
      setIsLoadingUpcoming(true)
      setHasUpcomingLoadError(false)

      try {
        const todayIso = new Date().toISOString().slice(0, 10)
        const response = await fetch(`/api/upcoming-events?today=${encodeURIComponent(todayIso)}`, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          cache: 'no-store',
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Failed to load upcoming gigs (${response.status})`)
        }

        const payload = await response.json().catch(() => null) as { rows?: unknown } | null
        const normalizedRows = normalizeUpcomingGigs(payload?.rows).slice(0, 12)

        setUpcomingGigs(normalizedRows)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        console.warn('ComingGigsPage: failed to load upcoming gigs', error)
        setUpcomingGigs([])
        setHasUpcomingLoadError(true)
      } finally {
        setIsLoadingUpcoming(false)
      }
    }

    void loadUpcomingGigs()

    return () => {
      controller.abort()
    }
  }, [])

  const switchLang = (next: ComingGigsLang) => {
    setLang(next)
    commitAudienceLocale(next)
  }

  const note = useMemo(() => {
    if (!email) {
      return null
    }
    return copy.updatesNote.replace('{{email}}', email)
  }, [email, copy])

  const openBooking = () => {
    navigate('/?booking=1')
  }

  const openDemo = () => {
    navigate('/audience?demo=true')
  }

  return (
    <section className="cg-shell" aria-label="Coming gigs and concept">
      <section className="cg-hero">
        <div className="cg-lang-switcher">
          <button
            onClick={() => switchLang('en')}
            className={lang === 'en' ? 'cg-lang-active' : ''}
            aria-label="Switch to English"
          >
            EN
          </button>
          <button
            onClick={() => switchLang('da')}
            className={lang === 'da' ? 'cg-lang-active' : ''}
            aria-label="Skift til dansk"
          >
            DA
          </button>
        </div>
        <p className="cg-eyebrow">{copy.eyebrow}</p>
        <h1>{copy.h1}</h1>
        <p>{copy.description}</p>
        <p>{copy.description2}</p>
        {note ? <p className="cg-note">{note}</p> : null}
        <div className="cg-actions">
          <PrimaryButton onClick={openBooking}>{copy.bookBtn}</PrimaryButton>
          <PrimaryButton variant="secondary" onClick={openDemo}>{copy.demoBtn}</PrimaryButton>
        </div>
      </section>

      <section className="cg-grid" aria-label="Concept details">
        <article className="cg-card">
          <Users size={20} aria-hidden="true" />
          <h2>{copy.cardTitles[0]}</h2>
          <p>{copy.cardDescriptions[0]}</p>
        </article>
        <article className="cg-card">
          <Mic2 size={20} aria-hidden="true" />
          <h2>{copy.cardTitles[1]}</h2>
          <p>{copy.cardDescriptions[1]}</p>
        </article>
        <article className="cg-card">
          <CalendarDays size={20} aria-hidden="true" />
          <h2>{copy.cardTitles[2]}</h2>
          <p>{copy.cardDescriptions[2]}</p>
        </article>
      </section>

      <section className="cg-upcoming" aria-label="Upcoming gigs">
        <h2>{copy.upcomingTitle}</h2>
        <div className="cg-upcoming-list">
          {isLoadingUpcoming ? <p className="cg-upcoming-state">{copy.loadingUpcoming}</p> : null}
          {!isLoadingUpcoming && hasUpcomingLoadError ? <p className="cg-upcoming-state">{copy.upcomingError}</p> : null}
          {!isLoadingUpcoming && !hasUpcomingLoadError && upcomingGigs.length === 0 ? (
            <p className="cg-upcoming-state">{copy.upcomingEmpty}</p>
          ) : null}
          {!isLoadingUpcoming && !hasUpcomingLoadError
            ? upcomingGigs.map((gig) => (
              <article key={gig.id} className="cg-upcoming-card">
                <p className="cg-upcoming-date">{formatGigDateLabel(gig, lang, copy.dateFallback)}</p>
                <h3>{gig.name}</h3>
                <p className="cg-upcoming-venue">{gig.venue ?? copy.venueFallback}</p>
                <p className="cg-upcoming-status">{gig.eventType === 'karaoke' ? copy.karaokeStatus : copy.liveStatus}</p>
              </article>
            ))
            : null}
        </div>
      </section>
    </section>
  )
}

export default ComingGigsPage