import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AUDIENCE_LOCALE_STORAGE_KEY, normalizeAudienceLocale, type AudienceLocale } from '../lib/audienceIdentity'
import { readSharedPlaybackState } from '../lib/playbackState'
import { supabase } from '../lib/supabase'

const LIVE_SYNC_POLL_INTERVAL_MS = 4000
const LINK_FUNNY_TEXT_DURATION_MS = 9000

const FUNNY_LINK_MESSAGES = [
  'Bold choice. Off you pop - we kept your lounge spot warm.',
  'Quick detour approved. We will pretend this was part of the plan.',
  'Excellent scouting work. Return triumphant when ready.',
  'A brief side quest! Mind the pints and report back.',
]

type SyncStatusReason = 'notFound' | 'reconnecting'

function resolveAudienceLocale(search: string): AudienceLocale {
  const params = new URLSearchParams(search)
  const localeParam = params.get('locale')?.trim() || params.get('lang')?.trim() || params.get('l')?.trim() || ''

  if (localeParam) {
    return normalizeAudienceLocale(localeParam)
  }

  if (typeof window !== 'undefined') {
    const storedLocale = window.localStorage.getItem(AUDIENCE_LOCALE_STORAGE_KEY)

    if (storedLocale?.trim()) {
      return normalizeAudienceLocale(storedLocale)
    }

    const browserLocale = (navigator.language || '').toLowerCase()

    if (browserLocale.startsWith('da')) {
      return 'da'
    }

    if (browserLocale.startsWith('is')) {
      return 'is'
    }
  }

  return 'en'
}

function resolveCountdownTargetMsFromSearch(search: string): number | null {
  const params = new URLSearchParams(search)
  const rawValue = params.get('ct')?.trim() || params.get('countdownTargetMs')?.trim() || ''

  if (!rawValue) {
    return null
  }

  const parsedValue = Number(rawValue)

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null
  }

  return parsedValue
}

function resolveClockOffsetMsFromSearch(search: string): number | null {
  const params = new URLSearchParams(search)
  const rawValue = params.get('co')?.trim() || params.get('clockOffsetMs')?.trim() || ''

  if (!rawValue) {
    return null
  }

  const parsedValue = Number(rawValue)

  if (!Number.isFinite(parsedValue)) {
    return null
  }

  if (Math.abs(parsedValue) > 86_400_000) {
    return null
  }

  return Math.round(parsedValue)
}

function normalizeEventTimeForDate(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return null
  }

  return trimmedValue.length > 5 && trimmedValue[2] === ':' && trimmedValue[5] === ':'
    ? trimmedValue.slice(0, 5)
    : trimmedValue
}

function parseEventStartMs(gigDate: string | null | undefined, gigStartTime: string | null | undefined): number | null {
  const normalizedDate = gigDate?.trim()

  if (!normalizedDate) {
    return null
  }

  const baseTime = normalizeEventTimeForDate(gigStartTime)
  const safeTime = baseTime ? `${baseTime}:00` : '18:00:00'
  const parsedDate = new Date(`${normalizedDate}T${safeTime}`)
  const parsedMs = parsedDate.getTime()

  return Number.isNaN(parsedMs) ? null : parsedMs
}

async function fetchServerClockOffsetMs(): Promise<number | null> {
  if (typeof window === 'undefined') {
    return null
  }

  const requestStartedAt = Date.now()

  try {
    const response = await fetch(`/api/keepwarm?clock-sync=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
    })

    if (!response.ok) {
      return null
    }

    const requestEndedAt = Date.now()
    const serverDateHeader = response.headers.get('date')

    if (!serverDateHeader) {
      return null
    }

    const serverNowMs = Date.parse(serverDateHeader)

    if (!Number.isFinite(serverNowMs)) {
      return null
    }

    const estimatedClientNowMs = Math.round((requestStartedAt + requestEndedAt) / 2)
    return serverNowMs - estimatedClientNowMs
  } catch {
    return null
  }
}

function formatCountdownLabel(remainingMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, remainingMs) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function resolveAudienceDestination(
  eventId: string | null,
  isTestPreviewMode: boolean,
  locale: AudienceLocale,
  countdownTargetMs: number | null,
  audienceLinkVersion: string | null,
  clockOffsetMs: number,
) {
  const params = new URLSearchParams()

  if (eventId) {
    params.set('event', eventId)
  }

  if (isTestPreviewMode) {
    params.set('test', '1')
  }

  if (countdownTargetMs !== null) {
    params.set('ct', String(countdownTargetMs))
  }

  if (audienceLinkVersion) {
    params.set('v', audienceLinkVersion)
  }

  if (Number.isFinite(clockOffsetMs)) {
    params.set('co', String(Math.round(clockOffsetMs)))
  }

  params.set('locale', locale)

  const queryString = params.toString()
  return queryString ? `/audience?${queryString}` : '/audience'
}

function QrLandingPage() {
  const { search } = useLocation()
  const countdownTargetMsFromLink = useMemo(() => resolveCountdownTargetMsFromSearch(search), [search])
  const clockOffsetMsFromLink = useMemo(() => resolveClockOffsetMsFromSearch(search), [search])
  const [eventRoomOpen, setEventRoomOpen] = useState(false)
  const [eventStartMs, setEventStartMs] = useState<number | null>(() => countdownTargetMsFromLink)
  const [clockOffsetMs, setClockOffsetMs] = useState(() => clockOffsetMsFromLink ?? 0)
  const clockOffsetRef = useRef(clockOffsetMsFromLink ?? 0)
  const getSyncedNowMs = useCallback(() => Date.now() + clockOffsetRef.current, [])
  const [nowMs, setNowMs] = useState(() => Date.now() + (clockOffsetMsFromLink ?? 0))
  const [syncStatusReason, setSyncStatusReason] = useState<SyncStatusReason | null>(null)
  const [activeFunnyMessageIndex, setActiveFunnyMessageIndex] = useState<number | null>(null)
  const didAutoNavigateRef = useRef(false)
  const funnyMessageTimerRef = useRef<number | null>(null)
  const funnyMessageNextIndexRef = useRef(0)
  const locale = useMemo(() => resolveAudienceLocale(search), [search])
  const customDestination = useMemo(() => {
    const params = new URLSearchParams(search)
    const url = params.get('url')?.trim()

    if (!url) {
      return null
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url
    }

    return null
  }, [search])
  const eventId = useMemo(() => {
    const params = new URLSearchParams(search)
    const value = params.get('event')?.trim() || params.get('eventId')?.trim() || ''
    return value || null
  }, [search])
  const isTestPreviewMode = useMemo(() => {
    const params = new URLSearchParams(search)
    return params.get('test') === '1'
  }, [search])
  const audienceLinkVersion = useMemo(() => {
    const params = new URLSearchParams(search)
    const version = params.get('v')?.trim() || ''
    return version || null
  }, [search])
  const audienceDestination = useMemo(
    () => resolveAudienceDestination(
      eventId,
      isTestPreviewMode,
      locale,
      countdownTargetMsFromLink,
      audienceLinkVersion,
      clockOffsetMs,
    ),
    [audienceLinkVersion, clockOffsetMs, countdownTargetMsFromLink, eventId, isTestPreviewMode, locale],
  )
  const hasCustomChoiceLink = Boolean(customDestination)

  useEffect(() => {
    void import('./EventPage')
  }, [])

  const copy = useMemo(() => {
    if (locale === 'da') {
      return {
        buttonGoToLounge: 'Join the Lounge',
        buttonGoToLink: 'Check out the bar',
        buttonSyncingStatus: 'Synkroniserer live-status...',
        buttonSyncingCountdownPrefix: 'Nedtælling synkroniseres',
        statusGoingLiveIn: 'Går live om',
        statusCountdownComplete: 'Nedtælling færdig. Venter på at værten går live...',
        statusNotFound: 'Event blev ikke fundet. Tryk for at åbne lounge.',
        statusReconnecting: 'Genopretter forbindelse til live-status...',
        ariaGoToAudienceLounge: 'Gå til publikums-lounge',
        ariaGoToChoiceLink: 'Åbn ekstra link',
        emptyState: 'Velkommen! Tryk på knappen nedenfor for at gå i loungen.',
        emptyStateChoice: 'Welcome to the show. Pick your route above, and mind the dramatic entrance.',
      }
    }

    if (locale === 'is') {
      return {
        buttonGoToLounge: 'Join the Lounge',
        buttonGoToLink: 'Check out the bar',
        buttonSyncingStatus: 'Samstilli live-stodu...',
        buttonSyncingCountdownPrefix: 'Samstilltur nidurteljari',
        statusGoingLiveIn: 'Fer i loftid eftir',
        statusCountdownComplete: 'Nidurteljari lokid. Bid eftir ad host fari i live ham...',
        statusNotFound: 'Vidburdur fannst ekki. Smelltu til ad opna lounge.',
        statusReconnecting: 'Endurtengi vid live-stodu...',
        ariaGoToAudienceLounge: 'Fara i ahorfenda lounge',
        ariaGoToChoiceLink: 'Opna vidbotar-link',
        emptyState: 'Velkomin! Smelltu a hnappinn ad neðan til ad fara i lounge.',
        emptyStateChoice: 'Welcome to the show. Pick your route above, and mind the dramatic entrance.',
      }
    }

    return {
      buttonGoToLounge: 'Join the Lounge',
      buttonGoToLink: 'Check out the bar',
      buttonSyncingStatus: 'Syncing live status...',
      buttonSyncingCountdownPrefix: 'Syncing countdown',
      statusGoingLiveIn: 'Going live in',
      statusCountdownComplete: 'Countdown complete. Waiting for host to start live mode...',
      statusNotFound: 'Could not find this event. Tap to open lounge.',
      statusReconnecting: 'Reconnecting to live status...',
      ariaGoToAudienceLounge: 'Go to audience lounge',
      ariaGoToChoiceLink: 'Open secondary venue link',
      emptyState: 'Welcome! Click the button below to join the lounge.',
      emptyStateChoice: 'Welcome to the show. Pick your route above: join the lounge or inspect the bar like a proper local.',
    }
  }, [locale])
  const countdownRemainingMs = eventStartMs === null ? null : eventStartMs - nowMs
  const waitingForLive = Boolean(eventId) && !eventRoomOpen
  const isCountdownActive = waitingForLive && countdownRemainingMs !== null && countdownRemainingMs > 0
  const countdownText = isCountdownActive ? formatCountdownLabel(countdownRemainingMs) : null
  const finalCountdownSeconds = isCountdownActive && countdownRemainingMs !== null && countdownRemainingMs <= 10_000
    ? Math.ceil(countdownRemainingMs / 1000)
    : null
  const syncStatusText = syncStatusReason === 'notFound'
    ? copy.statusNotFound
    : syncStatusReason === 'reconnecting'
    ? copy.statusReconnecting
    : null
  const loungeButtonText = copy.buttonGoToLounge
  const linkButtonText = copy.buttonGoToLink
  const shouldDisableLoungeButton = false
  const choiceWelcomeText = activeFunnyMessageIndex === null
    ? copy.emptyStateChoice
    : FUNNY_LINK_MESSAGES[activeFunnyMessageIndex] ?? copy.emptyStateChoice

  useEffect(() => {
    clockOffsetRef.current = clockOffsetMs
  }, [clockOffsetMs])

  useEffect(() => {
    if (clockOffsetMsFromLink === null) {
      return
    }

    clockOffsetRef.current = clockOffsetMsFromLink
    setClockOffsetMs(clockOffsetMsFromLink)
    setNowMs(Date.now() + clockOffsetMsFromLink)
  }, [clockOffsetMsFromLink])

  useEffect(() => {
    let isCurrent = true

    const syncClockOffset = async () => {
      const nextOffsetMs = await fetchServerClockOffsetMs()

      if (!isCurrent || nextOffsetMs === null) {
        return
      }

      clockOffsetRef.current = nextOffsetMs
      setClockOffsetMs(nextOffsetMs)
      setNowMs(Date.now() + nextOffsetMs)
    }

    void syncClockOffset()

    const timerId = window.setInterval(() => {
      void syncClockOffset()
    }, 120_000)

    return () => {
      isCurrent = false
      window.clearInterval(timerId)
    }
  }, [])

  useEffect(() => {
    if (countdownTargetMsFromLink === null) {
      return
    }

    setEventStartMs(countdownTargetMsFromLink)
  }, [countdownTargetMsFromLink])

  useEffect(() => {
    if (!eventId || eventRoomOpen) {
      return
    }

    const tickTimerId = window.setInterval(() => {
      setNowMs(getSyncedNowMs())
    }, 1000)

    return () => {
      window.clearInterval(tickTimerId)
    }
  }, [eventId, eventRoomOpen, getSyncedNowMs])

  useEffect(() => {
    if (!eventId) {
      setEventRoomOpen(false)
      setEventStartMs(null)
      setSyncStatusReason(null)
      didAutoNavigateRef.current = false
      return
    }

    let isCurrent = true
    let timerId: number | null = null

    const syncEventStatus = async () => {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

        if (sessionError) {
          throw sessionError
        }

        if (!sessionData.session) {
          const { error: signInError } = await supabase.auth.signInAnonymously()

          if (signInError) {
            throw signInError
          }
        }

        const { data, error } = await supabase
          .from('events')
          .select('room_open, gig_date, gig_start_time')
          .eq('id', eventId)
          .maybeSingle()

        if (!isCurrent) {
          return
        }

        if (error) {
          throw error
        }

        if (!data) {
          const shouldKeepSyncing = isTestPreviewMode || countdownTargetMsFromLink !== null
          setSyncStatusReason(shouldKeepSyncing ? 'reconnecting' : 'notFound')
          setEventStartMs(countdownTargetMsFromLink)
          setEventRoomOpen(false)
          return
        }

        const startMs = parseEventStartMs(data.gig_date as string | null, data.gig_start_time as string | null)
        const mirroredPlaybackState = await readSharedPlaybackState(eventId)
        const mirroredCountdownTargetMs = mirroredPlaybackState?.countdownTargetMs ?? null
        setEventStartMs(countdownTargetMsFromLink ?? mirroredCountdownTargetMs ?? startMs)
        setEventRoomOpen(Boolean(data.room_open))
        setSyncStatusReason(null)
      } catch {
        if (!isCurrent) {
          return
        }

        setSyncStatusReason('reconnecting')
      }
    }

    void syncEventStatus()

    timerId = window.setInterval(() => {
      if (document.hidden) {
        return
      }

      void syncEventStatus()
    }, LIVE_SYNC_POLL_INTERVAL_MS)

    return () => {
      isCurrent = false

      if (timerId !== null) {
        window.clearInterval(timerId)
      }
    }
  }, [countdownTargetMsFromLink, eventId, isTestPreviewMode])

  useEffect(() => {
    if (!eventId || eventRoomOpen || didAutoNavigateRef.current || hasCustomChoiceLink) {
      return
    }

    if (countdownRemainingMs === null || countdownRemainingMs > 0) {
      return
    }

    didAutoNavigateRef.current = true
    window.location.replace(audienceDestination)
  }, [audienceDestination, countdownRemainingMs, eventId, eventRoomOpen, hasCustomChoiceLink])

  useEffect(() => {
    if (!eventId || !eventRoomOpen || didAutoNavigateRef.current || hasCustomChoiceLink) {
      return
    }

    didAutoNavigateRef.current = true
    window.location.replace(audienceDestination)
  }, [audienceDestination, eventId, eventRoomOpen, hasCustomChoiceLink])

  useEffect(() => {
    return () => {
      if (funnyMessageTimerRef.current !== null) {
        window.clearTimeout(funnyMessageTimerRef.current)
      }
    }
  }, [])

  const handleChoiceLinkClick = useCallback(() => {
    const nextIndex = funnyMessageNextIndexRef.current % FUNNY_LINK_MESSAGES.length
    funnyMessageNextIndexRef.current += 1
    setActiveFunnyMessageIndex(nextIndex)

    if (funnyMessageTimerRef.current !== null) {
      window.clearTimeout(funnyMessageTimerRef.current)
    }

    funnyMessageTimerRef.current = window.setTimeout(() => {
      setActiveFunnyMessageIndex(null)
      funnyMessageTimerRef.current = null
    }, LINK_FUNNY_TEXT_DURATION_MS)
  }, [])

  return (
    <section className="qr-landing-shell" aria-label="Audience lounge landing page">
      <div className="qr-landing-button-overlay">
        <a
          href={audienceDestination}
          className={`qr-landing-button${shouldDisableLoungeButton ? ' qr-landing-button-disabled' : ''}`}
          aria-label={copy.ariaGoToAudienceLounge}
        >
          {loungeButtonText}
        </a>
        {customDestination ? (
          <a
            href={customDestination}
            className="qr-landing-button qr-landing-button-link"
            aria-label={copy.ariaGoToChoiceLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleChoiceLinkClick}
          >
            {linkButtonText}
          </a>
        ) : null}
        {waitingForLive ? (
          <p className="qr-landing-status" role="status" aria-live="polite">
            {syncStatusText ?? (countdownText ? `${copy.statusGoingLiveIn} ${countdownText}` : copy.statusCountdownComplete)}
          </p>
        ) : null}
      </div>

      {waitingForLive && finalCountdownSeconds !== null ? (
        <div className="qr-landing-final-countdown" role="status" aria-live="assertive" aria-label={`${copy.statusGoingLiveIn} ${finalCountdownSeconds}`}>
          <p className="qr-landing-final-countdown-label">{copy.statusGoingLiveIn}</p>
          <p className="qr-landing-final-countdown-number">{finalCountdownSeconds}</p>
          <p className="qr-landing-final-countdown-subtitle">
            {syncStatusText ?? countdownText ?? copy.statusCountdownComplete}
          </p>
        </div>
      ) : null}

      <div className="qr-landing-container">
        <div className={`qr-landing-empty-state${customDestination ? ' qr-landing-empty-state-choice' : ''}`}>
          <p>{customDestination ? choiceWelcomeText : copy.emptyState}</p>
        </div>
      </div>
    </section>
  )
}

export default QrLandingPage
