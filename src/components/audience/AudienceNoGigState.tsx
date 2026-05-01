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

function formatUpcomingEventDate(gigDate: string | null, gigStartTime: string | null, locale: AudienceLocale) {
  if (!gigDate) {
    return null
  }

  const safeTime = gigStartTime ? `${gigStartTime}:00` : '18:00:00'
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
  const copy = locale === 'da'
    ? {
        eyebrow: 'Publikumsapp',
        title: 'Intet live show lige nu',
        loading: 'Indlæser kommende events...',
        upcomingEvents: 'Kommende Events',
        upcomingCount: 'kommende',
        venueFallback: 'Sted annonceres senere',
        openEvent: 'Åbn eventside',
      }
    : {
        eyebrow: 'Audience App',
        title: 'No live show right now',
        loading: 'Loading upcoming gigs...',
        upcomingEvents: 'Upcoming Events',
        upcomingCount: 'upcoming',
        venueFallback: 'Venue to be announced',
        openEvent: 'Open event page',
      }

  return (
    <section className="audience-entry-shell audience-no-gig-shell" aria-label="Audience app no live gig state">
      <article className="queue-panel audience-entry-card audience-no-gig-card">
        <div className="audience-no-gig-motion" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <p className="eyebrow audience-entry-eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
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