import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AUDIENCE_LOCALE_STORAGE_KEY, normalizeAudienceLocale, type AudienceLocale } from '../lib/audienceIdentity'
import { readSharedPlaybackState } from '../lib/playbackState'
import { supabase } from '../lib/supabase'

const LIVE_SYNC_POLL_INTERVAL_MS = 4000
const LINK_FUNNY_TEXT_DURATION_MS = 9000

const FUNNY_LOUNGE_MESSAGES = [
  'Splendid decision. The lounge is where legends are made, playlists are debated, and someone always claims they knew the chorus first. Drift back here anytime if you miss the dramatic lighting.',
  'Right then, into the lounge you go. Keep your charm polished, your requests tasteful, and your dance moves legally distinct from chaos. We will still be here pretending to be very professional.',
  'A classic move. You have chosen the lounge route: equal parts music, mischief, and mild emotional support from strangers who also love this song. Return for more nonsense whenever you like.',
]

const FUNNY_BAR_MESSAGES = [
  'Excellent scouting mission to the bar. Conduct your noble research with dignity, avoid tactical overconfidence, and report back with stories that improve slightly each time they are told.',
  'Bold and thirsty. Take a graceful detour, inspect the local refreshments like a seasoned critic, and return when ready for more tunes, more chaos, and fewer responsible life choices.',
  'Very brave. Off to the bar with purpose, posture, and probably a queue. We shall hold the musical fort while you negotiate beverages and pretend this was all part of the master plan.',
]

const FUNNY_RETURN_MESSAGES = [
  'Back already? Splendid timing. Your side quest has been logged, your legend has grown, and your seat in the nonsense remains fully reserved.',
  'Welcome back, brave explorer. You inspected the outside world, found it acceptable, and returned to the superior chaos with remarkable professionalism.',
  'And we have a triumphant return! The crowd imagines dramatic music, polite applause, and at least one person whispering, "absolute icon."',
]

type ChoiceAction = 'lounge' | 'bar'

type SyncStatusReason = 'notFound' | 'reconnecting'
type QrChoiceContext = 'countdown' | 'break'

function resolveReturnMessageIndex(search: string): number | null {
  const params = new URLSearchParams(search)
  const marker = params.get('rm')?.trim().toLowerCase() ?? ''

  if (marker !== 'bar') {
    return null
  }

  const index = Number(params.get('ri'))

  if (!Number.isFinite(index) || index < 0) {
    return 0
  }

  return Math.floor(index)
}

function normalizeCustomDestination(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim()

  if (!trimmedValue) {
    return null
  }

  if (trimmedValue.startsWith('http://') || trimmedValue.startsWith('https://')) {
    return trimmedValue
  }

  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(trimmedValue)) {
    return `https://${trimmedValue}`
  }

  return null
}

function resolveQrChoiceContext(search: string): QrChoiceContext | null {
  const params = new URLSearchParams(search)
  const rawContext = params.get('qc')?.trim().toLowerCase() ?? ''

  if (rawContext === 'c' || rawContext === 'countdown') {
    return 'countdown'
  }

  if (rawContext === 'b' || rawContext === 'break') {
    return 'break'
  }

  return null
}

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
  loungeOverrideUrl: string | null,
) {
  if (loungeOverrideUrl) {
    return loungeOverrideUrl
  }

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

function buildChoiceBridgeUrl(backPath: string, options: { to?: string | null; url?: string | null; mode?: 'lounge' | 'bar' | null }) {
  const params = new URLSearchParams()
  params.set('back', backPath)

  if (options.to) {
    params.set('to', options.to)
  }

  if (options.url) {
    params.set('url', options.url)
  }

  if (options.mode) {
    params.set('mode', options.mode)
  }

  return `/lounge-link?${params.toString()}`
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
  const [activeFunnyMessage, setActiveFunnyMessage] = useState<string | null>(null)
  const [eventCustomDestination, setEventCustomDestination] = useState<string | null>(null)
  const [customDestinationLookupComplete, setCustomDestinationLookupComplete] = useState(false)
  const didAutoNavigateRef = useRef(false)
  const funnyMessageTimerRef = useRef<number | null>(null)
  const loungeFunnyMessageNextIndexRef = useRef(0)
  const barFunnyMessageNextIndexRef = useRef(0)
  const locale = useMemo(() => resolveAudienceLocale(search), [search])
  const customDestinationFromSearch = useMemo(() => {
    const params = new URLSearchParams(search)
    return normalizeCustomDestination(params.get('url'))
  }, [search])
  const qrChoiceContext = useMemo(() => resolveQrChoiceContext(search), [search])
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
  const loungeDestinationOverrideFromSearch = useMemo(() => {
    const params = new URLSearchParams(search)
    return normalizeCustomDestination(params.get('lounge'))
  }, [search])
  const audienceDestination = useMemo(
    () => resolveAudienceDestination(
      eventId,
      isTestPreviewMode,
      locale,
      countdownTargetMsFromLink,
      audienceLinkVersion,
      clockOffsetMs,
      loungeDestinationOverrideFromSearch,
    ),
    [audienceLinkVersion, clockOffsetMs, countdownTargetMsFromLink, eventId, isTestPreviewMode, locale, loungeDestinationOverrideFromSearch],
  )
  const customDestination = customDestinationFromSearch ?? eventCustomDestination
  const hasCustomChoiceLink = Boolean(customDestination)
  const requiresEventCustomLookup = Boolean(eventId && qrChoiceContext && !customDestinationFromSearch)
  const choiceBackPath = useMemo(() => `/qr-landing${search}`, [search])
  const barChoiceBridgeUrl = useMemo(
    () => (customDestination ? buildChoiceBridgeUrl(choiceBackPath, { url: customDestination, mode: 'bar' }) : null),
    [choiceBackPath, customDestination],
  )
  const loungeChoiceBridgeUrl = useMemo(() => {
    const isExternalDestination = /^https?:\/\//i.test(audienceDestination)

    return buildChoiceBridgeUrl(
      choiceBackPath,
      isExternalDestination
        ? { url: audienceDestination, mode: 'lounge' }
        : { to: audienceDestination, mode: 'lounge' },
    )
  }, [audienceDestination, choiceBackPath])
  const returnMessageIndex = useMemo(() => resolveReturnMessageIndex(search), [search])

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
        emptyStateChoice: 'Welcome to the show, you magnificent troublemaker. Pick your route above, make questionable but memorable decisions, and return here whenever you fancy another dramatic entrance.',
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
        emptyStateChoice: 'Welcome to the show, you magnificent troublemaker. Pick your route above, make questionable but memorable decisions, and return here whenever you fancy another dramatic entrance.',
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
      emptyStateChoice: 'Welcome to the show, you magnificent troublemaker. Pick your route above: lounge for glorious vibes, or bar for vital field research. Either way, return here when you crave more ceremony.',
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
    : null
  const loungeButtonText = copy.buttonGoToLounge
  const linkButtonText = copy.buttonGoToLink
  const shouldDisableLoungeButton = false
  const choiceWelcomeText = activeFunnyMessage === null
    ? copy.emptyStateChoice
    : activeFunnyMessage

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
      setEventCustomDestination(null)
      setCustomDestinationLookupComplete(true)
      didAutoNavigateRef.current = false
      return
    }

    let isCurrent = true
    let timerId: number | null = null

    const syncEventStatus = async () => {
      try {
        if (requiresEventCustomLookup) {
          setCustomDestinationLookupComplete(false)
        }

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
          .select('room_open, gig_date, gig_start_time, mirror_countdown_qr_custom_url, mirror_break_qr_custom_url')
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
          setEventCustomDestination(null)
          setCustomDestinationLookupComplete(true)
          return
        }

        if (qrChoiceContext && !customDestinationFromSearch) {
          const rawDestination = qrChoiceContext === 'break'
            ? (data as Record<string, unknown>).mirror_break_qr_custom_url
            : (data as Record<string, unknown>).mirror_countdown_qr_custom_url

          const normalizedDestination = typeof rawDestination === 'string'
            ? normalizeCustomDestination(rawDestination)
            : null

          setEventCustomDestination(normalizedDestination)
          setCustomDestinationLookupComplete(true)
        } else if (!customDestinationFromSearch) {
          setEventCustomDestination(null)
          setCustomDestinationLookupComplete(true)
        } else {
          setCustomDestinationLookupComplete(true)
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
        setCustomDestinationLookupComplete(true)
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
  }, [countdownTargetMsFromLink, customDestinationFromSearch, eventId, isTestPreviewMode, qrChoiceContext, requiresEventCustomLookup])

  useEffect(() => {
    if (customDestinationFromSearch) {
      setEventCustomDestination(null)
      setCustomDestinationLookupComplete(true)
    }
  }, [customDestinationFromSearch])

  useEffect(() => {
    if (returnMessageIndex === null) {
      return
    }

    const message = FUNNY_RETURN_MESSAGES[returnMessageIndex % FUNNY_RETURN_MESSAGES.length] ?? copy.emptyStateChoice
    setActiveFunnyMessage(message)

    if (funnyMessageTimerRef.current !== null) {
      window.clearTimeout(funnyMessageTimerRef.current)
    }

    funnyMessageTimerRef.current = window.setTimeout(() => {
      setActiveFunnyMessage(null)
      funnyMessageTimerRef.current = null
    }, LINK_FUNNY_TEXT_DURATION_MS)
  }, [copy.emptyStateChoice, returnMessageIndex])

  useEffect(() => {
    if (!eventId || eventRoomOpen || didAutoNavigateRef.current) {
      return
    }

    if (requiresEventCustomLookup && !customDestinationLookupComplete) {
      return
    }

    if (countdownRemainingMs === null || countdownRemainingMs > 0) {
      return
    }

    didAutoNavigateRef.current = true
    window.location.replace(audienceDestination)
  }, [audienceDestination, countdownRemainingMs, customDestinationLookupComplete, eventId, eventRoomOpen, requiresEventCustomLookup])

  useEffect(() => {
    if (!eventId || !eventRoomOpen || didAutoNavigateRef.current) {
      return
    }

    if (requiresEventCustomLookup && !customDestinationLookupComplete) {
      return
    }

    didAutoNavigateRef.current = true
    window.location.replace(audienceDestination)
  }, [audienceDestination, customDestinationLookupComplete, eventId, eventRoomOpen, requiresEventCustomLookup])

  useEffect(() => {
    return () => {
      if (funnyMessageTimerRef.current !== null) {
        window.clearTimeout(funnyMessageTimerRef.current)
      }
    }
  }, [])

  const handleChoiceActionClick = useCallback((action: ChoiceAction) => {
    const sourceMessages = action === 'lounge' ? FUNNY_LOUNGE_MESSAGES : FUNNY_BAR_MESSAGES
    const sourceIndexRef = action === 'lounge' ? loungeFunnyMessageNextIndexRef : barFunnyMessageNextIndexRef
    const nextIndex = sourceIndexRef.current % sourceMessages.length
    sourceIndexRef.current += 1
    setActiveFunnyMessage(sourceMessages[nextIndex] ?? copy.emptyStateChoice)

    if (funnyMessageTimerRef.current !== null) {
      window.clearTimeout(funnyMessageTimerRef.current)
    }

    funnyMessageTimerRef.current = window.setTimeout(() => {
      setActiveFunnyMessage(null)
      funnyMessageTimerRef.current = null
    }, LINK_FUNNY_TEXT_DURATION_MS)
  }, [copy.emptyStateChoice])

  return (
    <section className="qr-landing-shell" aria-label="Audience lounge landing page">
      <div className="qr-landing-button-overlay">
        <a
          href={loungeChoiceBridgeUrl}
          className={`qr-landing-button${shouldDisableLoungeButton ? ' qr-landing-button-disabled' : ''}`}
          aria-label={copy.ariaGoToAudienceLounge}
          onClick={hasCustomChoiceLink ? () => handleChoiceActionClick('lounge') : undefined}
        >
          {loungeButtonText}
        </a>
        {customDestination ? (
          <a
            href={barChoiceBridgeUrl ?? customDestination}
            className="qr-landing-button qr-landing-button-link"
            aria-label={copy.ariaGoToChoiceLink}
            onClick={() => handleChoiceActionClick('bar')}
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
          <p className={customDestination ? 'qr-landing-flash-text' : undefined}>{customDestination ? choiceWelcomeText : copy.emptyState}</p>
        </div>
        <img
          src="/the-human-jukebox-logo.svg"
          alt="The Human Jukebox"
          className="qr-landing-logo"
        />
      </div>
    </section>
  )
}

export default QrLandingPage
