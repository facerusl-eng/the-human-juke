import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarDays, Mic2, Users } from 'lucide-react'
import { PrimaryButton } from '../components/ui'
import { readCommittedAudienceLocale, commitAudienceLocale } from '../lib/audienceIdentity'
import '../styles/coming-gigs.css'

const UPCOMING_GIGS = [
  { date: 'June 21, 2026', venue: 'The Groove Lounge, Copenhagen', status: 'Open Requests Night' },
  { date: 'June 28, 2026', venue: 'Nordic Taproom, Aarhus', status: 'Audience Picks Setlist' },
  { date: 'July 05, 2026', venue: 'Harbor Bar, Reykjavik', status: 'Karaoke + Live Queue' },
]

const UPCOMING_GIGS_DA = [
  { date: '21. juni 2026', venue: 'The Groove Lounge, København', status: 'Åbent anmodningsaften' },
  { date: '28. juni 2026', venue: 'Nordic Taproom, Aarhus', status: 'Publikum vælger setlisten' },
  { date: '5. juli 2026', venue: 'Harbor Bar, Reykjavik', status: 'Karaoke + Live kø' },
]

type ComingGigsLang = 'en' | 'da'

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
  },
}

function ComingGigsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [lang, setLang] = useState<ComingGigsLang>(() => {
    const stored = readCommittedAudienceLocale()
    return stored === 'da' ? 'da' : 'en'
  })

  const email = (searchParams.get('email') || '').trim()
  const copy = COPY[lang]
  const gigs = lang === 'da' ? UPCOMING_GIGS_DA : UPCOMING_GIGS

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
          {gigs.map((gig) => (
            <article key={`${gig.date}-${gig.venue}`} className="cg-upcoming-card">
              <p className="cg-upcoming-date">{gig.date}</p>
              <h3>{gig.venue}</h3>
              <p>{gig.status}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  )
}

export default ComingGigsPage