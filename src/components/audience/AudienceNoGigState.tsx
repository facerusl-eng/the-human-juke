type AudienceUpcomingEvent = {
  id: string
  name: string
  venue: string | null
  gigDate: string | null
  gigStartTime: string | null
  coverImageUrl: string | null
}

const NO_GIG_MESSAGES = [
  'No live show right now - but something awesome is coming soon!',
  'Grab a drink, stretch your vocal cords, and check out what\'s coming up.',
  'The stage is quiet... for now. Upcoming events below!',
]

function formatUpcomingEventDate(gigDate: string | null, gigStartTime: string | null) {
  if (!gigDate) {
    return null
  }

  const safeTime = gigStartTime ? `${gigStartTime}:00` : '18:00:00'
  const parsedDate = new Date(`${gigDate}T${safeTime}`)

  if (Number.isNaN(parsedDate.getTime())) {
    return gigDate
  }

  const dateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parsedDate)

  if (!gigStartTime) {
    return dateLabel
  }

  const timeLabel = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsedDate)

  return `${dateLabel} · ${timeLabel}`
}

function AudienceNoGigState({ upcomingEvents }: { upcomingEvents: AudienceUpcomingEvent[] }) {
  return (
    <section className="audience-entry-shell audience-no-gig-shell" aria-label="Audience app no live gig state">
      <article className="queue-panel audience-entry-card audience-no-gig-card">
        <div className="audience-no-gig-motion" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <p className="eyebrow audience-entry-eyebrow">Audience App</p>
        <h1>No live show right now</h1>
        <div className="audience-no-gig-copy">
          {NO_GIG_MESSAGES.map((message) => (
            <p key={message} className="subcopy audience-entry-copy">
              {message}
            </p>
          ))}
        </div>

        {upcomingEvents.length > 0 ? (
          <section className="audience-no-gig-events" aria-label="Upcoming events">
            <div className="panel-head audience-no-gig-events-head">
              <h2>Upcoming Events</h2>
              <span className="meta-badge">{upcomingEvents.length} upcoming</span>
            </div>
            <div className="audience-no-gig-event-list">
              {upcomingEvents.map((upcomingEvent) => {
                const dateLabel = formatUpcomingEventDate(upcomingEvent.gigDate, upcomingEvent.gigStartTime)

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
                      <p className="audience-no-gig-event-meta">
                        {upcomingEvent.venue?.trim() ? upcomingEvent.venue : 'Venue to be announced'}
                      </p>
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