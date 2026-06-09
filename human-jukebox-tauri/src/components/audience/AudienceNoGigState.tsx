import { useState, useEffect, useMemo } from 'react'
import type { AudienceLocale } from '../../lib/audienceIdentity'
import AddToCalendarButton from '../AddToCalendarButton'

type AudienceUpcomingEvent = {
  id: string
  name: string
  venue: string | null
  gigDate: string | null
  gigStartTime: string | null
  gigEndTime: string | null
  coverImageUrl: string | null
  eventType: 'halli-live' | 'karaoke'
  eventTheme: 'harald-live' | 'human-jukebox' | 'karaoke'
  karafunUrl: string | null
}

const NO_GIG_MESSAGES: Record<AudienceLocale, string[]> = {
  en: [
    'No live show right now, but something awesome is coming soon.',
    'Grab a drink, stretch your vocal cords, and check out what\'s coming up.',
    'The stage is quiet for now. Upcoming events are listed below.',
  ],
  da: [
    'Ingen livekoncert lige nu, men noget fantastisk er på vej.',
    'Snup en drink, varm stemmebåndene op, og se hvad der sker snart.',
    'Scenen er stille lige nu. Kommende shows er listet herunder.',
  ],
  is: [
    'Engin live-syning i gangi nuna, en eitthvad geggjad er a leidinni.',
    'Griptu drykk, hitadu upp roddina og skodadu hvad er fram undan.',
    'Svidid er rolegt i bili. Komandi vidburdir eru listadir her fyrir nedan.',
  ],
}

const COUNTDOWN_SUPPORT_QUOTES: Record<AudienceLocale, string[]> = {
  en: [
    'You are early. The legends usually are.',
    'Warm-up mode: smile, hydrate, and pretend this was your plan all along.',
    'The stage is stretching. So are the vibes.',
    'Countdown in progress. Glamour loading at high speed.',
  ],
  da: [
    'Du er tidligt ude. Det er typisk for legender.',
    'Opvarmning: smil, drik vand og lad som om det hele er planlagt.',
    'Scenen strækker ud. Stemningen gør det samme.',
    'Nedtællingen kører. Glimmeret er på vej.',
  ],
  is: [
    'Thu maettir snemma. Hetjur gera thad.',
    'Upphitun: brostu, drekktu vatn og vertu svalur.',
    'Svidid er ad hita upp. Stemningin lika.',
    'Nidurteljari i gangi. Showid er ad byrja.',
  ],
}

function toIntlLocale(locale: AudienceLocale) {
  if (locale === 'da') {
    return 'da-DK'
  }

  if (locale === 'is') {
    return 'is-IS'
  }

  return 'en-US'
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

function formatCountdownStartLabel(gigDate: string | null, gigStartTime: string | null, locale: AudienceLocale): string | null {
  const countdownStartDate = parseEventDate(gigDate, gigStartTime)

  if (!countdownStartDate) {
    return null
  }

  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).format(countdownStartDate)
}

function formatCountdownStartLabelFromTargetMs(targetMs: number | null | undefined, locale: AudienceLocale): string | null {
  if (!Number.isFinite(targetMs)) {
    return null
  }

  const targetDate = new Date(targetMs as number)

  if (Number.isNaN(targetDate.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).format(targetDate)
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

  const dateLabel = new Intl.DateTimeFormat(toIntlLocale(locale), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parsedDate)

  if (!gigStartTime) {
    return dateLabel
  }

  const timeLabel = new Intl.DateTimeFormat(toIntlLocale(locale), {
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsedDate)

  return `${dateLabel} · ${timeLabel}`
}

function useCountdownToEvent(upcomingEvents: AudienceUpcomingEvent[], nowOffsetMs = 0) {
  const [now, setNow] = useState(() => Date.now() + nowOffsetMs)

  const target = upcomingEvents
    .map((e) => ({ event: e, date: parseEventDate(e.gigDate, e.gigStartTime) }))
    .filter((x): x is { event: AudienceUpcomingEvent; date: Date } => x.date !== null && x.date.getTime() > now)
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0] ?? null

  const targetEventId = target?.event.id ?? null

  useEffect(() => {
    const syncNow = () => {
      setNow(Date.now() + nowOffsetMs)
    }

    if (!targetEventId) return

    syncNow()
    const id = setInterval(syncNow, 1000)
    return () => clearInterval(id)
  }, [targetEventId, nowOffsetMs])

  useEffect(() => {
    setNow(Date.now() + nowOffsetMs)
  }, [nowOffsetMs])

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

    return new Intl.DateTimeFormat(toIntlLocale(locale), {
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

function resolveUpcomingEventCoverUrl(event: AudienceUpcomingEvent): string {
  void event
  return '/images/Human%20jukebox%20Live%20playlist.png'
}



function AudienceNoGigState({
  upcomingEvents,
  countdownFallbackEvent = null,
  countdownTargetMsFromLink = null,
  countdownTargetEventId = null,
  nowOffsetMs = 0,
  loadingUpcomingEvents = false,
  upcomingEventsNotice = null,
  getEventHref,
  locale = 'en',
}: {
  upcomingEvents: AudienceUpcomingEvent[]
  countdownFallbackEvent?: AudienceUpcomingEvent | null
  countdownTargetMsFromLink?: number | null
  countdownTargetEventId?: string | null
  nowOffsetMs?: number
  loadingUpcomingEvents?: boolean
  upcomingEventsNotice?: string | null
  getEventHref?: (eventId: string) => string
  locale?: AudienceLocale
}) {
  const [showHowJukeboxWorks, setShowHowJukeboxWorks] = useState(false)
  const [showHowKaraokeWorks, setShowHowKaraokeWorks] = useState(false)
  const [countdownQuoteIndex, setCountdownQuoteIndex] = useState(0)
  const [linkCountdownNowMs, setLinkCountdownNowMs] = useState(() => Date.now() + nowOffsetMs)
  const countdownFallbackEventName = locale === 'da'
    ? 'Næste live-show'
    : locale === 'is'
    ? 'Naesta live-show'
    : 'Next Live Show'
  const linkFallbackEvent = useMemo(() => {
    if (!Number.isFinite(countdownTargetMsFromLink) || (countdownTargetMsFromLink as number) <= 0) {
      return null
    }

    const countdownTargetDate = new Date(countdownTargetMsFromLink as number)

    if (Number.isNaN(countdownTargetDate.getTime())) {
      return null
    }

    const year = String(countdownTargetDate.getFullYear())
    const month = String(countdownTargetDate.getMonth() + 1).padStart(2, '0')
    const day = String(countdownTargetDate.getDate()).padStart(2, '0')
    const hours = String(countdownTargetDate.getHours()).padStart(2, '0')
    const minutes = String(countdownTargetDate.getMinutes()).padStart(2, '0')

    return {
      id: countdownTargetEventId?.trim() || `countdown-link-${year}${month}${day}${hours}${minutes}`,
      name: countdownFallbackEventName,
      venue: null,
      gigDate: `${year}-${month}-${day}`,
      gigStartTime: `${hours}:${minutes}`,
      gigEndTime: null,
      coverImageUrl: null,
      eventType: 'halli-live' as const,
      eventTheme: 'human-jukebox' as const,
      karafunUrl: null,
    }
  }, [countdownFallbackEventName, countdownTargetEventId, countdownTargetMsFromLink])
  const immediateFallbackEvent = upcomingEvents.length === 0
    ? (linkFallbackEvent ?? countdownFallbackEvent)
    : null
  const visibleUpcomingEvents = immediateFallbackEvent ? [immediateFallbackEvent] : upcomingEvents
  const countdownCandidates = immediateFallbackEvent
    && !upcomingEvents.some((eventRow) => eventRow.id === immediateFallbackEvent.id)
    ? [immediateFallbackEvent, ...upcomingEvents]
    : upcomingEvents
  const countdownFromEvents = useCountdownToEvent(countdownCandidates, nowOffsetMs)
  const linkCountdownRemainingMs = countdownTargetMsFromLink === null
    ? null
    : countdownTargetMsFromLink - linkCountdownNowMs
  const countdown = linkCountdownRemainingMs !== null && linkCountdownRemainingMs > 0
    ? {
        event: linkFallbackEvent ?? countdownFromEvents?.event ?? immediateFallbackEvent,
        remainingMs: linkCountdownRemainingMs,
      }
    : countdownFromEvents
  const countdownEvent = countdown?.event ?? null
  const countdownEventId = countdownEvent?.id ?? null
  const countdownStartLabel = linkCountdownRemainingMs !== null && linkCountdownRemainingMs > 0
    ? formatCountdownStartLabelFromTargetMs(countdownTargetMsFromLink, locale)
    : countdownEvent
    ? formatCountdownStartLabel(countdownEvent.gigDate, countdownEvent.gigStartTime, locale)
    : null

  useEffect(() => {
    if (countdownTargetMsFromLink === null) {
      return
    }

    const syncLinkNow = () => {
      setLinkCountdownNowMs(Date.now() + nowOffsetMs)
    }

    syncLinkNow()
    const timerId = window.setInterval(syncLinkNow, 1000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [countdownTargetMsFromLink, nowOffsetMs])

  useEffect(() => {
    setLinkCountdownNowMs(Date.now() + nowOffsetMs)
  }, [nowOffsetMs])

  useEffect(() => {
    if (!countdownEventId) {
      setCountdownQuoteIndex(0)
      return
    }

    const quoteRotateTimerId = window.setInterval(() => {
      setCountdownQuoteIndex((currentIndex) => currentIndex + 1)
    }, 7000)

    return () => {
      window.clearInterval(quoteRotateTimerId)
    }
  }, [countdownEventId])

  const countdownQuotes = COUNTDOWN_SUPPORT_QUOTES[locale]
  const activeCountdownQuote = countdownQuotes[countdownQuoteIndex % countdownQuotes.length] ?? countdownQuotes[0]

  const copy = locale === 'da'
    ? {
        eyebrow: 'Publikumsapp',
        title: 'Ingen livekoncert lige nu',
        home: 'Tilbage til start',
        loading: 'Indlæser kommende events...',
        upcomingEvents: 'Kommende shows',
        upcomingCount: 'kommende',
        venueFallback: 'Sted annonceres senere',
        openEvent: 'Åbn eventside',
        karaokeBadge: 'Karaoke-event',
        halliBadge: 'Live-musik',
        openKarafun: 'Åbn KaraFun-playliste',
        addToCalendar: 'Tilføj til kalender',
        confirmAddToCalendar: 'Er du sikker på, at du vil tilføje "{event}" til din kalender?',
        countdownLabel: 'Næste show starter om',
        countdownSupportLabel: 'Hold ud - vi varmer op bag scenen.',
        countdownScheduledLabel: 'Planlagt start',
        countdownScheduledFallback: 'Lige om lidt',
        countdownFor: 'til',
        howItWorks: 'Sådan virker Human Jukebox',
        hideHowItWorks: 'Skjul guide',
        howItWorksTitle: '🎸 Sådan virker Human Jukebox',
        howItWorksSteps: [
          'Tryk på Sangliste, og vælg Human Jukebox.',
          'Søg efter en sang og tilføj den til køen.',
          'Stem i livekøen for at skubbe dine favoritter op.',
          'Artisten spiller - du vælger sangene.',
        ],
        howKaraokeWorks: 'Sådan virker Karaoke',
        hideHowKaraokeWorks: 'Skjul karaoke-guide',
        howKaraokeWorksTitle: '🎤 Sådan virker Karaoke',
        howKaraokeWorksSteps: [
          'Karaoke køres i KaraFun.',
          'Find en sang i KaraFun-playlisten, og book den.',
          'Vent på, at dit navn bliver kaldt op.',
          'Tag mikrofonen og syng den selv.',
        ],
        karafunNote: 'Karaoke køres via KaraFun.',
      }
    : locale === 'is'
    ? {
        eyebrow: 'Ahorfenda app',
        title: 'Engin live-syning i gangi nuna',
        home: 'Aftur heim',
        loading: 'Hled komandi vidburdi...',
        upcomingEvents: 'Komandi vidburdir',
        upcomingCount: 'komandi',
        venueFallback: 'Stadur kemur sidar',
        openEvent: 'Opna vidburdasidu',
        karaokeBadge: 'Karaoke vidburdur',
        halliBadge: 'Live tonlist',
        openKarafun: 'Opna KaraFun lista',
        addToCalendar: 'Bæta við dagatal',
        confirmAddToCalendar: 'Ertu viss um að þú viljir bæta "{event}" við dagatalið?',
        countdownLabel: 'Naesta show hefst eftir',
        countdownSupportLabel: 'Haldu ut - vid erum ad hita upp bak vid tjoldin.',
        countdownScheduledLabel: 'Aetlud byrjun',
        countdownScheduledFallback: 'Alveg ad byrja',
        countdownFor: 'fyrir',
        howItWorks: 'Svona virkar Human Jukebox',
        hideHowItWorks: 'Fela leidbeiningar',
        howItWorksTitle: '🎸 Svona virkar Human Jukebox',
        howItWorksSteps: [
          'Smelltu a Lagalista og veldu Human Jukebox.',
          'Leitadu ad lagi og baettu thvi i ko.',
          'Kjostu i Live ko til ad hlyta uppahaldslagin.',
          'Listamadurinn spilar - thu velur hvad.',
        ],
        howKaraokeWorks: 'Svona virkar Karaoke',
        hideHowKaraokeWorks: 'Fela karaoke-leidbeiningar',
        howKaraokeWorksTitle: '🎤 Svona virkar Karaoke',
        howKaraokeWorksSteps: [
          'Karaoke keyrir i KaraFun.',
          'Findu lag i KaraFun listanum og bokadu timann thinn.',
          'Biddu eftir ad nafnid thitt verdi kallad upp.',
          'Taktu mic-inn og syngdu sjaelf/ur.',
        ],
        karafunNote: 'Karaoke er keyrt i gegnum KaraFun.',
      }
    : {
        eyebrow: 'Audience App',
        title: 'No live show right now',
        home: 'Back to Home Page',
        loading: 'Loading upcoming gigs...',
        upcomingEvents: 'Upcoming Events',
        upcomingCount: 'upcoming',
        venueFallback: 'Venue to be announced',
        openEvent: 'Open event page',
        karaokeBadge: 'Karaoke Event',
      halliBadge: 'Live Music',
        openKarafun: 'Open KaraFun playlist',
        addToCalendar: 'Add to Calendar',
        confirmAddToCalendar: 'Are you sure you want to add "{event}" to your calendar?',
        countdownLabel: 'Next show starts in',
      countdownSupportLabel: 'Hold tight - we\'re warming up backstage.',
        countdownScheduledLabel: 'Scheduled start',
        countdownScheduledFallback: 'Very soon',
        countdownFor: 'for',
        howItWorks: 'How Human Jukebox Works',
        hideHowItWorks: 'Hide guide',
        howItWorksTitle: '🎸 How Human Jukebox Works',
        howItWorksSteps: [
          'Tap Song List and choose Human Jukebox.',
          'Search for a song and add it to the queue.',
          'Vote in Live Queue to push your favorites up.',
          'The artist plays - you choose what.',
        ],
        howKaraokeWorks: 'How Karaoke Works',
        hideHowKaraokeWorks: 'Hide karaoke guide',
        howKaraokeWorksTitle: '🎤 How Karaoke Works',
        howKaraokeWorksSteps: [
          'Karaoke runs on KaraFun.',
          'Find a song in the KaraFun playlist and book your slot.',
          'Wait for your name to be called up.',
          'Grab the mic and sing it yourself.',
        ],
        karafunNote: 'Karaoke is powered by KaraFun.',
      }

  return (
    <section className="audience-entry-shell audience-no-gig-shell audience-karafun" aria-label="Audience app no live gig state">
      <article className="queue-panel audience-entry-card audience-no-gig-card">
        <div className="audience-no-gig-motion" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <p className="eyebrow audience-entry-eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        {countdown ? (
          <div className="audience-no-gig-countdown">
            <p className="audience-no-gig-countdown-label">{copy.countdownLabel}</p>
            <p className="audience-no-gig-countdown-value">{formatCountdownLabel(countdown.remainingMs)}</p>
            <p className="audience-no-gig-countdown-meta">{copy.countdownScheduledLabel}: {countdownStartLabel ?? copy.countdownScheduledFallback}</p>
            <p className="audience-no-gig-countdown-event">
              {countdown.event?.name?.trim() || countdownFallbackEventName}
              {countdown.event?.venue?.trim() ? ` · ${countdown.event.venue}` : ''}
            </p>
            <p className="audience-no-gig-countdown-support">{copy.countdownSupportLabel}</p>
            <p className="audience-no-gig-countdown-quote" aria-live="polite">{activeCountdownQuote}</p>
          </div>
        ) : null}

        <div className="audience-no-gig-copy">
          {NO_GIG_MESSAGES[locale].map((message) => (
            <p key={message} className="subcopy audience-entry-copy">
              {message}
            </p>
          ))}
        </div>

        <div className="audience-no-gig-guide-actions">
          <a href="/" className="secondary-button">
            🏠 {copy.home}
          </a>
          <button
            type="button"
            className="secondary-button"
            aria-controls="audience-no-gig-how-karaoke-works"
            onClick={() => setShowHowKaraokeWorks((current) => !current)}
          >
            {showHowKaraokeWorks ? copy.hideHowKaraokeWorks : copy.howKaraokeWorks}
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-controls="audience-no-gig-how-it-works"
            onClick={() => setShowHowJukeboxWorks((current) => !current)}
          >
            {showHowJukeboxWorks ? copy.hideHowItWorks : copy.howItWorks}
          </button>
        </div>

        {showHowJukeboxWorks ? (
          <section id="audience-no-gig-how-it-works" className="audience-no-gig-how-it-works" aria-label={copy.howItWorksTitle}>
            <h2>{copy.howItWorksTitle}</h2>
            <ol>
              {copy.howItWorksSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
        ) : null}

        {showHowKaraokeWorks ? (
          <section id="audience-no-gig-how-karaoke-works" className="audience-no-gig-how-it-works" aria-label={copy.howKaraokeWorksTitle}>
            <h2>{copy.howKaraokeWorksTitle}</h2>
            <p className="subcopy audience-no-gig-how-it-works-note">{copy.karafunNote}</p>
            <ol>
              {copy.howKaraokeWorksSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
        ) : null}

        {loadingUpcomingEvents && !upcomingEventsNotice ? (
          <p className="meta-badge" role="status" aria-live="polite">{copy.loading}</p>
        ) : null}

        {upcomingEventsNotice ? (
          <p className="subcopy" role="status" aria-live="polite">{upcomingEventsNotice}</p>
        ) : null}

        {visibleUpcomingEvents.length > 0 ? (
          <section className="audience-no-gig-events" aria-label="Upcoming events">
            <div className="panel-head audience-no-gig-events-head">
              <h2>{copy.upcomingEvents}</h2>
              <span className="meta-badge">{visibleUpcomingEvents.length} {copy.upcomingCount}</span>
            </div>
            <div className="audience-no-gig-event-list">
              {visibleUpcomingEvents.map((upcomingEvent) => {
                const dateLabel = formatUpcomingEventDate(upcomingEvent.gigDate, upcomingEvent.gigStartTime, locale)
                const timeRangeLabel = formatUpcomingEventTimeRange(upcomingEvent.gigStartTime, upcomingEvent.gigEndTime, locale)
                const eventHref = getEventHref ? getEventHref(upcomingEvent.id) : null
                const hasDate = Boolean(upcomingEvent.gigDate)
                const eventCoverImageUrl = resolveUpcomingEventCoverUrl(upcomingEvent)

                return (
                  <article key={upcomingEvent.id} className="audience-no-gig-event-card">
                    <div className="audience-no-gig-event-art" aria-hidden="true">
                      <img src={eventCoverImageUrl} alt="" loading="lazy" />
                    </div>
                    <div className="audience-no-gig-event-body">
                      <p className="audience-no-gig-event-title">{upcomingEvent.name}</p>
                      <p className="audience-no-gig-event-meta">
                        <span className="meta-badge">
                          {upcomingEvent.eventType === 'karaoke' ? copy.karaokeBadge : copy.halliBadge}
                        </span>
                      </p>
                      {dateLabel ? <p className="audience-no-gig-event-meta">{dateLabel}</p> : null}
                      {timeRangeLabel ? <p className="audience-no-gig-event-meta">{timeRangeLabel}</p> : null}
                      <p className="audience-no-gig-event-meta">
                        {upcomingEvent.venue?.trim() ? upcomingEvent.venue : copy.venueFallback}
                      </p>
                      {upcomingEvent.eventType === 'karaoke' && upcomingEvent.karafunUrl ? (
                        <p className="audience-no-gig-event-meta">
                          <a href={upcomingEvent.karafunUrl} target="_blank" rel="noreferrer">{copy.openKarafun}</a>
                        </p>
                      ) : null}
                      {eventHref ? (
                        <p className="audience-no-gig-event-meta">
                          <a href={eventHref}>{copy.openEvent}</a>
                        </p>
                      ) : null}
                      {hasDate ? (
                        <p className="audience-no-gig-event-meta audience-no-gig-event-cal-links">
                          <AddToCalendarButton
                            event={upcomingEvent}
                            label={`📅 ${copy.addToCalendar}`}
                            successLabel={locale === 'da' ? '✓ Tilføjet!' : locale === 'is' ? '✓ Bætt við!' : '✓ Added!'}
                          />
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