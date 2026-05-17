import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const LIVE_SYNC_POLL_INTERVAL_MS = 4000

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

function formatCountdownLabel(remainingMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, remainingMs) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function resolveLoungeDestination(eventId: string | null) {
  if (eventId) {
    return `/lounge-link?event=${encodeURIComponent(eventId)}`
  }

  return '/lounge-link'
}

function QrLandingPage() {
  const navigate = useNavigate()
  const { search } = useLocation()
  const [eventRoomOpen, setEventRoomOpen] = useState(false)
  const [eventStartMs, setEventStartMs] = useState<number | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [syncStatusText, setSyncStatusText] = useState<string | null>(null)
  const didAutoNavigateRef = useRef(false)

  const eventId = useMemo(() => {
    const params = new URLSearchParams(search)
    const value = params.get('event')?.trim() || params.get('eventId')?.trim() || ''
    return value || null
  }, [search])

  const customUrl = useMemo(() => {
    const params = new URLSearchParams(search)
    const url = params.get('url')?.trim()
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      return url
    }
    return null
  }, [search])

  const loungeDestination = useMemo(() => resolveLoungeDestination(eventId), [eventId])
  const countdownRemainingMs = eventStartMs === null ? null : eventStartMs - nowMs
  const waitingForLive = Boolean(eventId) && !eventRoomOpen
  const isCountdownActive = waitingForLive && countdownRemainingMs !== null && countdownRemainingMs > 0
  const countdownText = isCountdownActive ? formatCountdownLabel(countdownRemainingMs) : null
  const loungeButtonText = isCountdownActive
    ? `Syncing countdown ${countdownText}`
    : waitingForLive
    ? 'Syncing live status...'
    : 'Go to Lounge'

  useEffect(() => {
    if (!eventId || eventRoomOpen) {
      return
    }

    const tickTimerId = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(tickTimerId)
    }
  }, [eventId, eventRoomOpen])

  useEffect(() => {
    if (!eventId) {
      setEventRoomOpen(false)
      setEventStartMs(null)
      setSyncStatusText(null)
      didAutoNavigateRef.current = false
      return
    }

    let isCurrent = true
    let timerId: number | null = null

    const syncEventStatus = async () => {
      try {
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
          setSyncStatusText('Could not find this event. Tap to open lounge.')
          setEventStartMs(null)
          setEventRoomOpen(false)
          return
        }

        const startMs = parseEventStartMs(data.gig_date as string | null, data.gig_start_time as string | null)
        setEventStartMs(startMs)
        setEventRoomOpen(Boolean(data.room_open))
        setSyncStatusText(null)
      } catch {
        if (!isCurrent) {
          return
        }

        setSyncStatusText('Reconnecting to live status...')
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
  }, [eventId])

  useEffect(() => {
    if (!eventId || !eventRoomOpen || didAutoNavigateRef.current) {
      return
    }

    didAutoNavigateRef.current = true
    navigate(loungeDestination, { replace: true })
  }, [eventId, eventRoomOpen, loungeDestination, navigate])

  return (
    <section className="qr-landing-shell" aria-label="QR code landing page">
      <div className="qr-landing-button-overlay">
        <button
          type="button"
          className={`qr-landing-button${waitingForLive ? ' qr-landing-button-disabled' : ''}`}
          aria-label="Go to audience lounge"
          onClick={() => {
            navigate(loungeDestination)
          }}
          disabled={waitingForLive}
        >
          {loungeButtonText}
        </button>
        {waitingForLive ? (
          <p className="qr-landing-status" role="status" aria-live="polite">
            {syncStatusText ?? (countdownText ? `Going live in ${countdownText}` : 'Countdown complete. Waiting for host to start live mode...')}
          </p>
        ) : null}
      </div>

      <div className="qr-landing-container">
        {customUrl ? (
          <iframe
            src={customUrl}
            className="qr-landing-iframe"
            title="QR code destination content"
            sandbox="allow-same-origin allow-forms allow-scripts allow-popups"
          />
        ) : (
          <div className="qr-landing-empty-state">
            <p>Welcome! Click the button above to join the lounge.</p>
          </div>
        )}
      </div>
    </section>
  )
}

export default QrLandingPage
