import { useState, useEffect } from 'react'
import type { AudienceLocale } from '../../lib/audienceIdentity'

type AudienceUpcomingEvent = {
  id: string
  name: string
  venue: string | null
  gigDate: string | null
  gigStartTime: string | null
  gigEndTime: string | null
  coverImageUrl: string | null
}

const NO_GIG_MESSAGES: Record<AudienceLocale, string[]> = {
  en: [
    'No live show right now - but something awesome is coming soon!',
    'Grab a drink, stretch your vocal cords, and check out what\'s coming up.',
    'The stage is quiet... for now. Upcoming events below!',
  ],
  da: [
    'Der er ikke et live show lige nu, men noget fedt er på vej!',
    'Snup en drink, varm stemmebåndene op, og se hvad der kommer.',
    'Scenen er stille... lige nu. Kommende events er herunder!',
  ],
}

/** Strip seconds from Postgres 'HH:MM:SS' so appending ':00' doesn't corrupt the datetime string */
function normalizeTimeForDate(t: string | null): string | null {
  if (!t) return null
  const s = t.trim()
  return s.length > 5 && s[2] === ':' && s[5] === ':' ? s.slice(0, 5) : s
}

function parseEventDate(gigDate: string | null, gigStartTime: string | null, fallbackHour = '18'): Date | null {
  if (!gigDate) return null
  const base = normalizeTimeForDate(gigStartTime)
  const safeTime = base ? `${base}:00` : `${fallbackHour}:00:00`
  const d = new Date(`${gigDate}T${safeTime}`)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatCountdownLabel(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatUpcomingEventDate(gigDate: string | null, gigStartTime: string | null, locale: AudienceLocale) {
  if (!gigDate) {
    return null
  }

  const base = normalizeTimeForDate(gigStartTime)
  const safeTime = base ? `${base}:00` : '18:00:00'
  const parsedDate = new Date(`${gigDate}T${safeTime}`)

  if (Number.isNaN(parsedDate.getTime())) {
    return gigDate
  }

  const dateLabel = new Intl.DateTimeFormat(locale === 'da' ? 'da-DK' : 'en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parsedDate)

  if (!gigStartTime) {
    return dateLabel
  }

  const timeLabel = new Intl.DateTimeFormat(locale === 'da' ? 'da-DK' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsedDate)

  return `${dateLabel} · ${timeLabel}`
}

function useCountdownToEvent(upcomingEvents: AudienceUpcomingEvent[]) {
  const [now, setNow] = useState(() => Date.now())

  const target = upcomingEvents
    .map((e) => ({ event: e, date: parseEventDate(e.gigDate, e.gigStartTime) }))
    .filter((x): x is { event: AudienceUpcomingEvent; date: Date } => x.date !== null && x.date.getTime() > Date.now())
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0] ?? null

  useEffect(() => {
    if (!target) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [target?.event.id])

  if (!target) return null
  const remainingMs = target.date.getTime() - now
  if (remainingMs <= 0) return null
  return { event: target.event, remainingMs }
}

function formatUpcomingEventTimeRange(gigStartTime: string | null, gigEndTime: string | null, locale: AudienceLocale) {
  if (!gigStartTime && !gigEndTime) {
    return null
  }

  const formatClockTime = (clockTime: string) => {
    const parsedDate = new Date(`2000-01-01T${clockTime}:00`)

    if (Number.isNaN(parsedDate.getTime())) {
      return clockTime
    }

    return new Intl.DateTimeFormat(locale === 'da' ? 'da-DK' : 'en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(parsedDate)
  }

  if (gigStartTime && gigEndTime) {
    return `${formatClockTime(gigStartTime)} - ${formatClockTime(gigEndTime)}`
  }

  if (gigStartTime) {
    return locale === 'da' ? `Starter ${formatClockTime(gigStartTime)}` : `Starts ${formatClockTime(gigStartTime)}`
  }

  return locale === 'da' ? `Slutter ${formatClockTime(gigEndTime as string)}` : `Ends ${formatClockTime(gigEndTime as string)}`
}

function AudienceNoGigState({
  upcomingEvents,
  loadingUpcomingEvents = false,
  upcomingEventsNotice = null,
  getEventHref,
  locale = 'en',
}: {
  upcomingEvents: AudienceUpcomingEvent[]
  loadingUpcomingEvents?: boolean
  upcomingEventsNotice?: string | null
  getEventHref?: (eventId: string) => string
  locale?: AudienceLocale
}) {
  const countdown = useCountdownToEvent(upcomingEvents)

  const copy = locale === 'da'
    ? {
        eyebrow: 'Publikumsapp',
        title: 'Intet live show lige nu',
        loading: 'Indlæser kommende events...',
        upcomingEvents: 'Kommende Events',
        upcomingCount: 'kommende',
        venueFallback: 'Sted annonceres senere',
        openEvent: 'Åbn eventside',
        countdownLabel: 'Næste show starter om',
        countdownFor: 'til',
      }
    : {
        eyebrow: 'Audience App',
        title: 'No live show right now',
        loading: 'Loading upcoming gigs...',
        upcomingEvents: 'Upcoming Events',
        upcomingCount: 'upcoming',
        venueFallback: 'Venue to be announced',
        openEvent: 'Open event page',
        countdownLabel: 'Next show starts in',
        countdownFor: 'for',
          <span></span>
        </div>
        <p className="eyebrow audience-entry-eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        {countdown ? (
          <div className="audience-no-gig-countdown">
            <p className="audience-no-gig-countdown-label">{copy.countdownLabel}</p>
            <p className="audience-no-gig-countdown-value">{formatCountdownLabel(countdown.remainingMs)}</p>
            <p className="audience-no-gig-countdown-event">{countdown.event.name}{countdown.event.venue ? ` · ${countdown.event.venue}` : ''}</p>
          </div>
        ) : null}

        <div className="audience-no-gig-copy">
          {NO_GIG_MESSAGES[locale].map((message) => (
            <p key={message} className="subcopy audience-entry-copy">
              {message}
            </p>
          ))}
        </div>

        {loadingUpcomingEvents ? (
          <p className="meta-badge" role="status" aria-live="polite">{copy.loading}</p>
        ) : null}

        {upcomingEventsNotice ? (
          <p className="subcopy" role="status" aria-live="polite">{upcomingEventsNotice}</p>
        ) : null}

        {upcomingEvents.length > 0 ? (
          <section className="audience-no-gig-events" aria-label="Upcoming events">
            <div className="panel-head audience-no-gig-events-head">
              <h2>{copy.upcomingEvents}</h2>
              <span className="meta-badge">{upcomingEvents.length} {copy.upcomingCount}</span>
            </div>
            <div className="audience-no-gig-event-list">
              {upcomingEvents.map((upcomingEvent) => {
                const dateLabel = formatUpcomingEventDate(upcomingEvent.gigDate, upcomingEvent.gigStartTime, locale)
                const timeRangeLabel = formatUpcomingEventTimeRange(upcomingEvent.gigStartTime, upcomingEvent.gigEndTime, locale)
                const eventHref = getEventHref ? getEventHref(upcomingEvent.id) : null

                return (
                  <article key={upcomingEvent.id} className="audience-no-gig-event-card">
                    <div className="audience-no-gig-event-art" aria-hidden="true">
                      {upcomingEvent.coverImageUrl ? (
                        <img src={upcomingEvent.coverImageUrl} alt="" loading="lazy" />
                      ) : (
                        <span>♪</span>
                      )}
                    </div>
                    <div className="audience-no-gig-event-body">
                      <p className="audience-no-gig-event-title">{upcomingEvent.name}</p>
                      {dateLabel ? <p className="audience-no-gig-event-meta">{dateLabel}</p> : null}
                      {timeRangeLabel ? <p className="audience-no-gig-event-meta">{timeRangeLabel}</p> : null}
                      <p className="audience-no-gig-event-meta">
                        {upcomingEvent.venue?.trim() ? upcomingEvent.venue : copy.venueFallback}
                      </p>
                      {eventHref ? (
                        <p className="audience-no-gig-event-meta">
                          <a href={eventHref}>{copy.openEvent}</a>
                        </p>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ) : null}
      </article>
    </section>
  )
}

export type { AudienceUpcomingEvent }
export default AudienceNoGigState