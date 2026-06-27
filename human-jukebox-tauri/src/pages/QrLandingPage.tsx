import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AUDIENCE_LOCALE_STORAGE_KEY, normalizeAudienceLocale, type AudienceLocale } from '../lib/audienceIdentity'
import { ensureAnonymousAudienceSession } from '../lib/audienceAuth'
import { getSharedPlaybackTransitionState, readSharedPlaybackState } from '../lib/playbackState'
import { supabase } from '../lib/supabase'

const LIVE_SYNC_POLL_INTERVAL_MS = 4000
const LINK_FUNNY_TEXT_DURATION_MS = 9000

const UPCOMING_CHOICE_MESSAGES = [
  'Upcoming live shows are open. Check the dates, then use Back to Countdown when you are ready.',
  'You are viewing upcoming live shows. Pick your next night out, then return to countdown.',
  'Upcoming schedule loaded. Explore freely and return to countdown anytime.',
]

const BAR_CHOICE_MESSAGES = [
  'Bar menu opened. Use Back to Countdown when you want to return.',
  'You are in the bar menu route. Return to countdown at any time.',
  'Bar menu selected. Countdown is still running in the background.',
]

const RETURN_TO_COUNTDOWN_MESSAGES = [
  'Back on countdown. We go live very soon.',
  'Countdown resumed. Keep this page open for the live handoff.',
  'Welcome back to countdown. You are ready for go-live.',
]

type ChoiceAction = 'upcoming' | 'bar'

type SyncStatusReason = 'notFound' | 'reconnecting'
type QrChoiceContext = 'countdown' | 'break'

function resolveReturnMessageIndex(search: string): number | null {
  const params = new URLSearchParams(search)
  const marker = params.get('rm')?.trim().toLowerCase() ?? ''

  if (marker !== 'countdown') {
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
  const totalSeconds = Math.floor(Math.max(0, remainingMs) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  let label = '';
  if (days > 0) {
    label += `${days}d `;
  }
  if (days > 0 || hours > 0) {
    label += `${String(hours).padStart(2, '0')}h `;
  }
  label += `${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  return label.trim();
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

function buildChoiceBridgeUrl(backPath: string, options: { to?: string | null; url?: string | null; mode?: 'lounge' | 'bar' | 'upcoming' | null }) {
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
  const upcomingMessageNextIndexRef = useRef(0)
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
  // Always route lounge button to audience app, never to a lounge override link
  const audienceDestination = useMemo(
    () => resolveAudienceDestination(
      eventId,
      isTestPreviewMode,
      locale,
      countdownTargetMsFromLink,
      audienceLinkVersion,
      clockOffsetMs,
      null, // loungeDestinationOverrideFromSearch forcibly disabled
    ),
    [audienceLinkVersion, clockOffsetMs, countdownTargetMsFromLink, eventId, isTestPreviewMode, locale],
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
  const upcomingChoiceBridgeUrl = useMemo(
    () => buildChoiceBridgeUrl(choiceBackPath, { to: '/coming-gigs', mode: 'upcoming' }),
    [choiceBackPath],
  )
  const returnMessageIndex = useMemo(() => resolveReturnMessageIndex(search), [search])

  useEffect(() => {
    void import('./EventPage')
  }, [])

  const copy = useMemo(() => {
    if (locale === 'da') {
      return {
        buttonGoToLounge: 'A) Gå til barmenuen',
        buttonGoToLink: 'B) Se kommende live shows',
        buttonFallbackToLounge: 'Gå til publikumsloungen',
        buttonSyncingStatus: 'Synkroniserer live-status...',
        buttonSyncingCountdownPrefix: 'Nedtælling synkroniseres',
        statusGoingLiveIn: 'Går live om',
        statusCountdownComplete: 'Nedtælling færdig. Venter på at værten går live...',
        statusNotFound: 'Event blev ikke fundet. Nedtællingen genopretter forbindelsen...',
        statusReconnecting: 'Genopretter forbindelse til live-status...',
        ariaGoToAudienceLounge: 'Gå til barmenuen',
        ariaGoToChoiceLink: 'Se kommende live shows',
        ariaGoToFallbackLounge: 'Gå til publikumsloungen',
        emptyState: 'Velkommen. Showet starter snart. Dette er den officielle nedtælling.',
        emptyStateChoice: 'Velkommen til nedtællingen. Vælg A) barmenuen eller B) kommende live shows. Du kan altid gå tilbage til nedtællingen.',
      }
    }

    if (locale === 'is') {
      return {
        buttonGoToLounge: 'A) Enter the Bar Menu',
        buttonGoToLink: 'B) See Upcoming Live Shows',
        buttonFallbackToLounge: 'Join the Audience Lounge',
        buttonSyncingStatus: 'Samstilli live-stodu...',
        buttonSyncingCountdownPrefix: 'Samstilltur nidurteljari',
        statusGoingLiveIn: 'Fer i loftid eftir',
        statusCountdownComplete: 'Nidurteljari lokid. Bid eftir ad host fari i live ham...',
        statusNotFound: 'Event not found. Countdown sync is reconnecting...',
        statusReconnecting: 'Endurtengi vid live-stodu...',
        ariaGoToAudienceLounge: 'Enter the bar menu',
        ariaGoToChoiceLink: 'See upcoming live shows',
        ariaGoToFallbackLounge: 'Go to audience lounge',
        emptyState: 'Welcome. The show starts soon. This is the official countdown screen.',
        emptyStateChoice: 'Welcome to countdown mode. Choose A) bar menu or B) upcoming live shows. You can always return to countdown.',
      }
    }

    return {
      buttonGoToLounge: 'A) Enter the Bar Menu',
      buttonGoToLink: 'B) See Upcoming Live Shows',
      buttonFallbackToLounge: 'Join Audience Lounge',
      buttonSyncingStatus: 'Syncing live status...',
      buttonSyncingCountdownPrefix: 'Syncing countdown',
      statusGoingLiveIn: 'Going live in',
      statusCountdownComplete: 'Countdown complete. Waiting for host to start live mode...',
      statusNotFound: 'Could not find this event. Countdown sync is reconnecting...',
      statusReconnecting: 'Reconnecting to live status...',
      ariaGoToAudienceLounge: 'Enter the bar menu',
      ariaGoToChoiceLink: 'See upcoming live shows',
      ariaGoToFallbackLounge: 'Go to audience lounge',
      emptyState: 'Welcome. The show starts soon. This is the official countdown screen.',
      emptyStateChoice: 'Welcome to countdown mode. Choose A) bar menu or B) upcoming live shows. You can always return to countdown.',
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
  const loungeButtonText = hasCustomChoiceLink
    ? copy.buttonGoToLounge
    : copy.buttonFallbackToLounge
  const linkButtonText = copy.buttonGoToLink
  const primaryChoiceHref = barChoiceBridgeUrl ?? loungeChoiceBridgeUrl
  const primaryChoiceAriaLabel = hasCustomChoiceLink
    ? copy.ariaGoToAudienceLounge
    : copy.ariaGoToFallbackLounge
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
          await ensureAnonymousAudienceSession()
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
        const mirroredTransitionState = getSharedPlaybackTransitionState(mirroredPlaybackState)
        const shouldPreferScheduledCountdown = !data.room_open && mirroredTransitionState?.phase !== 'countdown'
        setEventStartMs(
          shouldPreferScheduledCountdown
            ? (startMs ?? countdownTargetMsFromLink ?? mirroredCountdownTargetMs)
            : (countdownTargetMsFromLink ?? mirroredCountdownTargetMs ?? startMs),
        )
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

    const message = RETURN_TO_COUNTDOWN_MESSAGES[returnMessageIndex % RETURN_TO_COUNTDOWN_MESSAGES.length] ?? copy.emptyStateChoice
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
    const sourceMessages = action === 'upcoming' ? UPCOMING_CHOICE_MESSAGES : BAR_CHOICE_MESSAGES
    const sourceIndexRef = action === 'upcoming' ? upcomingMessageNextIndexRef : barFunnyMessageNextIndexRef
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
    <section className="qr-landing-shell" aria-label="Audience countdown landing page">
      <div className="qr-landing-button-overlay">
        <a
          href={primaryChoiceHref}
          className="qr-landing-button qr-landing-button-link"
          aria-label={primaryChoiceAriaLabel}
          onClick={hasCustomChoiceLink ? () => handleChoiceActionClick('bar') : undefined}
        >
          {loungeButtonText}
        </a>
        <a
          href={upcomingChoiceBridgeUrl}
          className="qr-landing-button"
          aria-label={copy.ariaGoToChoiceLink}
          onClick={() => handleChoiceActionClick('upcoming')}
        >
          {linkButtonText}
        </a>
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
          <p className={waitingForLive && qrChoiceContext === 'countdown' ? 'qr-landing-flash-text' : undefined}>{customDestination ? choiceWelcomeText : copy.emptyState}</p>
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
