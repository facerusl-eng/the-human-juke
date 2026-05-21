import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AUDIENCE_LOCALE_STORAGE_KEY, normalizeAudienceLocale, type AudienceLocale } from '../lib/audienceIdentity'
import { supabase } from '../lib/supabase'

const LIVE_SYNC_POLL_INTERVAL_MS = 4000

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
  const navigate = useNavigate()
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
  const didAutoNavigateRef = useRef(false)
  const locale = useMemo(() => resolveAudienceLocale(search), [search])

  useEffect(() => {
    void import('./EventPage')
  }, [])

  const copy = useMemo(() => {
    if (locale === 'da') {
      return {
        buttonGoToLounge: 'Gå til Lounge',
        buttonSyncingStatus: 'Synkroniserer live-status...',
        buttonSyncingCountdownPrefix: 'Nedtælling synkroniseres',
        buttonOpenLoungeNow: 'Åbn lounge nu',
        statusGoingLiveIn: 'Går live om',
        statusCountdownComplete: 'Nedtælling færdig. Venter på at værten går live...',
        statusNotFound: 'Event blev ikke fundet. Tryk for at åbne lounge.',
        statusReconnecting: 'Genopretter forbindelse til live-status...',
        ariaGoToAudienceLounge: 'Gå til publikums-lounge',
        emptyState: 'Velkommen! Tryk på knappen ovenfor for at gå i loungen.',
      }
    }

    if (locale === 'is') {
      return {
        buttonGoToLounge: 'Fara i Lounge',
        buttonSyncingStatus: 'Samstilli live-stodu...',
        buttonSyncingCountdownPrefix: 'Samstilltur nidurteljari',
        buttonOpenLoungeNow: 'Opna lounge nuna',
        statusGoingLiveIn: 'Fer i loftid eftir',
        statusCountdownComplete: 'Nidurteljari lokid. Bid eftir ad host fari i live ham...',
        statusNotFound: 'Vidburdur fannst ekki. Smelltu til ad opna lounge.',
        statusReconnecting: 'Endurtengi vid live-stodu...',
        ariaGoToAudienceLounge: 'Fara i ahorfenda lounge',
        emptyState: 'Velkomin! Smelltu a hnappinn ad ofan til ad fara i lounge.',
      }
    }

    return {
      buttonGoToLounge: 'Go to Lounge',
      buttonSyncingStatus: 'Syncing live status...',
      buttonSyncingCountdownPrefix: 'Syncing countdown',
      buttonOpenLoungeNow: 'Open Lounge Now',
      statusGoingLiveIn: 'Going live in',
      statusCountdownComplete: 'Countdown complete. Waiting for host to start live mode...',
      statusNotFound: 'Could not find this event. Tap to open lounge.',
      statusReconnecting: 'Reconnecting to live status...',
      ariaGoToAudienceLounge: 'Go to audience lounge',
      emptyState: 'Welcome! Click the button above to join the lounge.',
    }
  }, [locale])

  const eventId = useMemo(() => {
    const params = new URLSearchParams(search)
    const value = params.get('event')?.trim() || params.get('eventId')?.trim() || ''
    return value || null
  }, [search])
  const isTestPreviewMode = useMemo(() => {
    const params = new URLSearchParams(search)
    return params.get('test') === '1'
  }, [search])

  const customUrl = useMemo(() => {
    const params = new URLSearchParams(search)
    const url = params.get('url')?.trim()
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      return url
    }
    return null
  }, [search])

  const shouldShowVisualContent = useMemo(() => {
    const params = new URLSearchParams(search)
    const rawValue = params.get('visual')?.trim().toLowerCase() || ''
    return rawValue === '1' || rawValue === 'true' || rawValue === 'on'
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
  const countdownRemainingMs = eventStartMs === null ? null : eventStartMs - nowMs
  const waitingForLive = Boolean(eventId) && !eventRoomOpen
  const isCountdownActive = waitingForLive && countdownRemainingMs !== null && countdownRemainingMs > 0
  const countdownText = isCountdownActive ? formatCountdownLabel(countdownRemainingMs) : null
  const syncStatusText = syncStatusReason === 'notFound'
    ? copy.statusNotFound
    : syncStatusReason === 'reconnecting'
    ? copy.statusReconnecting
    : null
  const loungeButtonText = isCountdownActive
    ? `${copy.buttonSyncingCountdownPrefix} ${countdownText}`
    : waitingForLive
    ? syncStatusReason
      ? copy.buttonOpenLoungeNow
      : copy.buttonSyncingStatus
    : copy.buttonGoToLounge
  const shouldDisableLoungeButton = waitingForLive && syncStatusReason === null

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
          setSyncStatusReason('notFound')
          setEventStartMs(countdownTargetMsFromLink)
          setEventRoomOpen(false)
          return
        }

        const startMs = parseEventStartMs(data.gig_date as string | null, data.gig_start_time as string | null)
        setEventStartMs(countdownTargetMsFromLink ?? startMs)
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
  }, [countdownTargetMsFromLink, eventId])

  useEffect(() => {
    if (!eventId || !eventRoomOpen || didAutoNavigateRef.current) {
      return
    }

    didAutoNavigateRef.current = true
    navigate(audienceDestination, { replace: true })
  }, [audienceDestination, eventId, eventRoomOpen, navigate])

  return (
    <section className="qr-landing-shell" aria-label="Audience lounge landing page">
      <div className="qr-landing-button-overlay">
        <button
          type="button"
          className={`qr-landing-button${shouldDisableLoungeButton ? ' qr-landing-button-disabled' : ''}`}
          aria-label={copy.ariaGoToAudienceLounge}
          onClick={() => {
            navigate(audienceDestination)
          }}
          disabled={shouldDisableLoungeButton}
        >
          {loungeButtonText}
        </button>
        {waitingForLive ? (
          <p className="qr-landing-status" role="status" aria-live="polite">
            {syncStatusText ?? (countdownText ? `${copy.statusGoingLiveIn} ${countdownText}` : copy.statusCountdownComplete)}
          </p>
        ) : null}
      </div>

      <div className="qr-landing-container">
        {customUrl && shouldShowVisualContent ? (
          <iframe
            src={customUrl}
            className="qr-landing-iframe"
            title="Audience landing visual content"
            sandbox="allow-same-origin allow-forms allow-scripts allow-popups"
          />
        ) : (
          <div className="qr-landing-empty-state">
            <p>{copy.emptyState}</p>
          </div>
        )}
      </div>
    </section>
  )
}

export default QrLandingPage
