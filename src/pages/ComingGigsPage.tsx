import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarDays, Mic2, Users } from 'lucide-react'
import { PrimaryButton } from '../components/ui'
import '../styles/coming-gigs.css'

const UPCOMING_GIGS = [
  { date: 'June 21, 2026', venue: 'The Groove Lounge, Copenhagen', status: 'Open Requests Night' },
  { date: 'June 28, 2026', venue: 'Nordic Taproom, Aarhus', status: 'Audience Picks Setlist' },
  { date: 'July 05, 2026', venue: 'Harbor Bar, Reykjavik', status: 'Karaoke + Live Queue' },
]

function ComingGigsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const email = (searchParams.get('email') || '').trim()
  const note = useMemo(() => {
    if (!email) {
      return null
    }

    return `Updates requested for ${email}. Use booking below to lock in your preferred date.`
  }, [email])

  const openBooking = () => {
    navigate('/?booking=1')
  }

  const openDemo = () => {
    navigate('/audience?demo=true')
  }

  return (
    <section className="cg-shell" aria-label="Coming gigs and concept">
      <section className="cg-hero">
        <p className="cg-eyebrow">Coming gigs and how the concept works</p>
        <h1>What venues book, and why guests stay engaged all night</h1>
        <p>
          The Human Jukebox is a live performer plus a crowd-driven queue system. Guests scan once, request songs from any phone,
          and vote in real time while your full room follows one shared live screen.
        </p>
        <p>
          Every request creates anticipation, every vote creates momentum, and the set evolves with your crowd. It feels live,
          social, and easy to join.
        </p>
        {note ? <p className="cg-note">{note}</p> : null}
        <div className="cg-actions">
          <PrimaryButton onClick={openBooking}>Book the show</PrimaryButton>
          <PrimaryButton variant="secondary" onClick={openDemo}>See audience demo</PrimaryButton>
        </div>
      </section>

      <section className="cg-grid" aria-label="Concept details">
        <article className="cg-card">
          <Users size={20} aria-hidden="true" />
          <h2>Crowd-powered setlist</h2>
          <p>Guests do not need an app. They join quickly, request tracks, and shape the order live.</p>
        </article>
        <article className="cg-card">
          <Mic2 size={20} aria-hidden="true" />
          <h2>Live performer, not a playlist</h2>
          <p>Harald performs live while balancing requests, karaoke moments, and the room\'s energy.</p>
        </article>
        <article className="cg-card">
          <CalendarDays size={20} aria-hidden="true" />
          <h2>Built for recurring nights</h2>
          <p>Works for pubs, bars, private events, and launch weeks where return visits matter.</p>
        </article>
      </section>

      <section className="cg-upcoming" aria-label="Upcoming gigs">
        <h2>Upcoming gigs</h2>
        <div className="cg-upcoming-list">
          {UPCOMING_GIGS.map((gig) => (
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