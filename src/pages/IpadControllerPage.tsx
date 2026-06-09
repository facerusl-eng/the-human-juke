import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getJamzoneBridge, getJamzoneCurrentSong, getJamzoneCurrentTimeSeconds } from '../lib/jamzoneBridge'
import { useAuthStore } from '../state/authStore'

const JAMZONE_REMOTE_EVENT = 'jamzone-snapshot'
const JAMZONE_REMOTE_CHANNEL_PREFIX = 'jamzone-bridge'
const IPAD_EVENT_STORAGE_KEY = 'human-jukebox:ipad-controller:event-id'

type PublishStatus = 'idle' | 'publishing' | 'waiting-bridge' | 'waiting-event'

export default function IpadControllerPage() {
  const location = useLocation()
  const { profile } = useAuthStore()
  const activeGigEventId = (profile?.active_event_id ?? '').trim()

  const [eventIdDraft, setEventIdDraft] = useState('')
  const [eventId, setEventId] = useState('')
  const [hasJamzoneBridge, setHasJamzoneBridge] = useState(false)
  const [currentSongTitle, setCurrentSongTitle] = useState('')
  const [currentSongArtist, setCurrentSongArtist] = useState('')
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0)
  const [channelConnected, setChannelConnected] = useState(false)
  const [publishStatus, setPublishStatus] = useState<PublishStatus>('idle')
  const [copyFeedback, setCopyFeedback] = useState('')
  const [autoFallbackEnabled, setAutoFallbackEnabled] = useState(true)

  const [manualMode, setManualMode] = useState(false)
  const [manualSongId, setManualSongId] = useState('manual-song')
  const [manualSongTitle, setManualSongTitle] = useState('Manual Song')
  const [manualSongArtist, setManualSongArtist] = useState('Manual Artist')
  const [manualTimeSeconds, setManualTimeSeconds] = useState(0)
  const [manualRunning, setManualRunning] = useState(false)
  const [manualPlayPulse, setManualPlayPulse] = useState(0)
  const [eventIdSource, setEventIdSource] = useState<'url' | 'active-gig' | 'local' | 'manual' | 'none'>('none')
  const [isAppleMobile, setIsAppleMobile] = useState(false)
  const [wakeLockSupported, setWakeLockSupported] = useState(false)
  const [wakeLockEnabled, setWakeLockEnabled] = useState(true)
  const [wakeLockActive, setWakeLockActive] = useState(false)
  const [lastPublishAgoSeconds, setLastPublishAgoSeconds] = useState<number | null>(null)
  const [channelStatus, setChannelStatus] = useState('idle')
  const [channelReconnectNonce, setChannelReconnectNonce] = useState(0)
  const isLockedToActiveGig = eventIdSource === 'active-gig'
  const manualSourceActive = manualMode || (autoFallbackEnabled && !hasJamzoneBridge)
  const bridgeStatusLabel = hasJamzoneBridge
    ? 'detected'
    : (manualSourceActive ? 'not detected (manual fallback active)' : 'not detected')

  const sourceIdRef = useRef(`ipad-${Math.random().toString(36).slice(2)}`)
  const remoteBridgeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const manualLastTickAtRef = useRef(Date.now())
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const lastPublishAtMsRef = useRef<number | null>(null)

  const requestWakeLock = async () => {
    if (!wakeLockEnabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return
    }

    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen')
      setWakeLockActive(true)
      wakeLockRef.current.addEventListener('release', () => {
        setWakeLockActive(false)
      })
    } catch {
      setWakeLockActive(false)
    }
  }

  const releaseWakeLock = async () => {
    if (!wakeLockRef.current) {
      return
    }

    try {
      await wakeLockRef.current.release()
    } catch {
      // no-op: release can fail when the browser already released it
    } finally {
      wakeLockRef.current = null
      setWakeLockActive(false)
    }
  }

  useEffect(() => {
    if (typeof navigator === 'undefined') {
      return
    }

    const ua = navigator.userAgent || ''
    const appleMobile = /iPhone|iPad|iPod/i.test(ua)
    setIsAppleMobile(appleMobile)
    setWakeLockSupported('wakeLock' in navigator)
  }, [])

  useEffect(() => {
    if (!wakeLockEnabled || !manualSourceActive || !manualRunning) {
      void releaseWakeLock()
      return
    }

    void requestWakeLock()

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && manualRunning && manualSourceActive) {
        manualLastTickAtRef.current = Date.now()
        setManualPlayPulse((pulse) => pulse + 1)
        void requestWakeLock()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void releaseWakeLock()
    }
  }, [manualRunning, manualSourceActive, wakeLockEnabled])

  useEffect(() => {
    const timerId = window.setInterval(() => {
      const lastPublish = lastPublishAtMsRef.current
      if (!lastPublish) {
        setLastPublishAgoSeconds(null)
        return
      }

      setLastPublishAgoSeconds(Math.max(0, (Date.now() - lastPublish) / 1000))
    }, 500)

    return () => {
      window.clearInterval(timerId)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const fromUrl = (params.get('event') ?? params.get('eventId') ?? '').trim()
    const fromProfile = activeGigEventId
    const fromStorage = typeof window !== 'undefined'
      ? (window.localStorage.getItem(IPAD_EVENT_STORAGE_KEY) ?? '').trim()
      : ''

    // Prefer explicit URL, then active gig, then local storage fallback.
    const initialEventId = fromUrl || fromProfile || fromStorage
    setEventId(initialEventId)
    setEventIdDraft(initialEventId)

    if (fromUrl) {
      setEventIdSource('url')
    } else if (fromProfile) {
      setEventIdSource('active-gig')
    } else if (fromStorage) {
      setEventIdSource('local')
    } else {
      setEventIdSource('none')
    }
  }, [location.search, activeGigEventId])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const fromUrl = (params.get('event') ?? params.get('eventId') ?? '').trim()
    const fromProfile = activeGigEventId

    // Keep event id synced to active gig unless URL explicitly pins a different event.
    if (!fromUrl && fromProfile && eventIdSource !== 'manual' && eventId !== fromProfile) {
      setEventId(fromProfile)
      setEventIdDraft(fromProfile)
      setEventIdSource('active-gig')
    }
  }, [location.search, activeGigEventId, eventId, eventIdSource])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(IPAD_EVENT_STORAGE_KEY, eventId.trim())
  }, [eventId])

  useEffect(() => {
    const updateBridgeState = () => {
      const hasBridge = Boolean(getJamzoneBridge())
      const song = getJamzoneCurrentSong()

      setHasJamzoneBridge(hasBridge)
      setCurrentTimeSeconds(getJamzoneCurrentTimeSeconds())
      setCurrentSongTitle(song?.title ?? '')
      setCurrentSongArtist(song?.artist ?? '')
    }

    updateBridgeState()
    const timerId = window.setInterval(updateBridgeState, 220)

    return () => {
      window.clearInterval(timerId)
    }
  }, [])

  useEffect(() => {
    if (!manualSourceActive || !manualRunning) {
      return
    }

    manualLastTickAtRef.current = Date.now()

    const timerId = window.setInterval(() => {
      const now = Date.now()
      const elapsedSeconds = (now - manualLastTickAtRef.current) / 1000
      manualLastTickAtRef.current = now
      setManualTimeSeconds((seconds) => Math.max(0, seconds + elapsedSeconds))
    }, 180)

    return () => {
      window.clearInterval(timerId)
    }
  }, [manualMode, manualRunning, autoFallbackEnabled, hasJamzoneBridge])

  const channelName = useMemo(() => {
    const normalizedEventId = eventId.trim()
    if (!normalizedEventId) {
      return null
    }

    return `${JAMZONE_REMOTE_CHANNEL_PREFIX}:${normalizedEventId}`
  }, [eventId])

  useEffect(() => {
    if (!channelName) {
      setChannelConnected(false)
      setChannelStatus('waiting-event')
      setPublishStatus('waiting-event')
      return
    }

    const channel = supabase.channel(channelName)
    remoteBridgeChannelRef.current = channel

    channel.subscribe((status) => {
      setChannelStatus(status)
      setChannelConnected(status === 'SUBSCRIBED')
    })

    return () => {
      remoteBridgeChannelRef.current = null
      setChannelConnected(false)
      setChannelStatus('disconnected')
      void supabase.removeChannel(channel)
    }
  }, [channelName, channelReconnectNonce])

  useEffect(() => {
    const shouldRetry = channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT' || channelStatus === 'CLOSED' || channelStatus === 'disconnected'
    if (!channelName || channelConnected || !shouldRetry) {
      return
    }

    const retryTimer = window.setTimeout(() => {
      setChannelReconnectNonce((value) => value + 1)
    }, 4500)

    return () => {
      window.clearTimeout(retryTimer)
    }
  }, [channelConnected, channelName, channelReconnectNonce, channelStatus])

  useEffect(() => {
    if (!remoteBridgeChannelRef.current) {
      return
    }

    if (!eventId.trim()) {
      setPublishStatus('waiting-event')
      return
    }

    const publishTick = () => {
      const bridgeAvailable = Boolean(getJamzoneBridge())
      const useManualSource = manualMode || (autoFallbackEnabled && !bridgeAvailable)

      const currentSong = useManualSource
        ? {
            id: manualSongId.trim() || 'manual-song',
            title: manualSongTitle.trim() || 'Manual Song',
            artist: manualSongArtist.trim() || 'Manual Artist',
          }
        : getJamzoneCurrentSong()

      const nextTimeSeconds = useManualSource ? manualTimeSeconds : getJamzoneCurrentTimeSeconds()

      if (!useManualSource && !bridgeAvailable) {
        setPublishStatus('waiting-bridge')
        return
      }

      void remoteBridgeChannelRef.current?.send({
        type: 'broadcast',
        event: JAMZONE_REMOTE_EVENT,
        payload: {
          sourceId: sourceIdRef.current,
          currentTimeSeconds: nextTimeSeconds,
          currentSong,
          playPulse: manualPlayPulse,
          updatedAtMs: Date.now(),
        },
      })

      setPublishStatus('publishing')
      lastPublishAtMsRef.current = Date.now()
    }

    publishTick()
    const timerId = window.setInterval(publishTick, 180)

    return () => {
      window.clearInterval(timerId)
    }
  }, [eventId, manualMode, manualSongArtist, manualSongId, manualSongTitle, manualTimeSeconds, autoFallbackEnabled, manualPlayPulse, manualRunning])

  const lyricsUrl = useMemo(() => {
    if (!eventId.trim()) {
      return '/lyrics'
    }

    return `/lyrics?event=${encodeURIComponent(eventId.trim())}`
  }, [eventId])

  const boardUrl = useMemo(() => {
    if (!eventId.trim()) {
      return '/lyrics-board'
    }

    return `/lyrics-board?event=${encodeURIComponent(eventId.trim())}`
  }, [eventId])

  const copyEventId = async () => {
    const normalizedEventId = eventId.trim()

    if (!normalizedEventId) {
      setCopyFeedback('Add an event ID first, then copy.')
      return
    }

    try {
      await navigator.clipboard.writeText(normalizedEventId)
      setCopyFeedback('Event ID copied to clipboard.')
    } catch {
      setCopyFeedback('Clipboard failed. Select the Event ID field and copy manually.')
    }
  }

  const confirmEventId = () => {
    const normalizedEventId = eventIdDraft.trim()
    setEventId(normalizedEventId)
    setEventIdSource(normalizedEventId ? 'manual' : 'none')
    setCopyFeedback(normalizedEventId ? 'Event ID confirmed.' : 'Event ID cleared.')
  }

  const enableManualEventOverride = () => {
    setEventIdSource('manual')
    setCopyFeedback('Manual Event ID override enabled.')
  }

  const reenableActiveGigSync = () => {
    if (!activeGigEventId) {
      return
    }

    setEventId(activeGigEventId)
    setEventIdDraft(activeGigEventId)
    setEventIdSource('active-gig')
    setCopyFeedback('Active gig sync restored.')
  }

  return (
    <main style={{ minHeight: '100vh', background: '#050711', color: '#d5dcff', padding: '1rem' }}>
      <section style={{ maxWidth: '860px', margin: '0 auto', display: 'grid', gap: '0.9rem' }}>
        <header style={{ padding: '1rem', border: '1px solid #2b345f', borderRadius: '14px', background: '#0b1020' }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>iPad Jamzone Controller</h1>
          <p style={{ marginTop: '0.45rem', marginBottom: 0, opacity: 0.86 }}>
            This page is part of Human Jukebox and is designed to run on your iPad as the Jamzone timing source.
          </p>
        </header>

        <section style={{ padding: '1rem', border: '1px solid #2b345f', borderRadius: '14px', background: '#0b1020', display: 'grid', gap: '0.8rem' }}>
          <label htmlFor="ipad-event-id" style={{ fontWeight: 600 }}>Event ID for sync</label>
          <input
            id="ipad-event-id"
            value={eventIdDraft}
            onChange={(event) => setEventIdDraft(event.target.value)}
            placeholder="Paste event id"
            disabled={isLockedToActiveGig}
            style={{
              minHeight: '52px',
              padding: '0.75rem 0.9rem',
              fontSize: '1rem',
              borderRadius: '10px',
              border: '1px solid #3d4a86',
              background: isLockedToActiveGig ? '#0d142b' : '#101832',
              color: '#e5ebff',
              opacity: isLockedToActiveGig ? 0.8 : 1,
            }}
          />
          <button
            type="button"
            onClick={confirmEventId}
            disabled={isLockedToActiveGig}
            style={{
              minHeight: '52px',
              borderRadius: '10px',
              border: '1px solid #44d6a2',
              background: isLockedToActiveGig ? '#26433d' : '#123f35',
              color: '#defff4',
              fontWeight: 700,
              opacity: isLockedToActiveGig ? 0.75 : 1,
              cursor: isLockedToActiveGig ? 'not-allowed' : 'pointer',
            }}
          >
            Confirm Event ID
          </button>
          {isLockedToActiveGig ? (
            <button
              type="button"
              onClick={enableManualEventOverride}
              style={{
                minHeight: '52px',
                borderRadius: '10px',
                border: '1px solid #efb956',
                background: '#33260f',
                color: '#fff3dd',
                fontWeight: 700,
              }}
            >
              Use Manual Event ID Override
            </button>
          ) : null}
          {!isLockedToActiveGig && eventIdSource === 'manual' && activeGigEventId ? (
            <button
              type="button"
              onClick={reenableActiveGigSync}
              style={{
                minHeight: '52px',
                borderRadius: '10px',
                border: '1px solid #55d9aa',
                background: '#123f35',
                color: '#defff4',
                fontWeight: 700,
              }}
            >
              Re-enable Active Gig Sync
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void copyEventId()
            }}
            style={{
              minHeight: '52px',
              borderRadius: '10px',
              border: '1px solid #4b66ce',
              background: '#182a5e',
              color: '#e7eeff',
              fontWeight: 700,
            }}
          >
            Copy Event ID
          </button>
          {copyFeedback ? <p style={{ margin: 0, opacity: 0.85 }}>{copyFeedback}</p> : null}
          <p style={{ margin: 0, opacity: 0.8 }}>Active event ID: {eventId || 'none'}</p>
          <p style={{ margin: 0, opacity: 0.8 }}>
            Event source: {
              eventIdSource === 'active-gig'
                ? 'active gig (auto)'
                : eventIdSource === 'url'
                  ? 'url parameter'
                  : eventIdSource === 'local'
                    ? 'saved local value'
                    : eventIdSource === 'manual'
                      ? 'manual override'
                      : 'none'
            }
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <input
              type="checkbox"
              checked={autoFallbackEnabled}
              onChange={(event) => setAutoFallbackEnabled(event.target.checked)}
            />
            Auto fallback to manual source when bridge is missing
          </label>
          <p style={{ margin: 0, opacity: 0.8 }}>Bridge: {bridgeStatusLabel}</p>
          <p style={{ margin: 0, opacity: 0.8 }}>Realtime channel: {channelConnected ? 'connected' : 'disconnected'}</p>
          <p style={{ margin: 0, opacity: 0.8 }}>Channel status: {channelStatus}</p>
          <p style={{ margin: 0, opacity: 0.8 }}>Publish status: {publishStatus}</p>
          <p style={{ margin: 0, opacity: 0.8 }}>Last publish: {lastPublishAgoSeconds !== null ? `${lastPublishAgoSeconds.toFixed(1)}s ago` : 'not yet'}</p>
          <button
            type="button"
            onClick={() => setChannelReconnectNonce((value) => value + 1)}
            style={{
              minHeight: '44px',
              borderRadius: '10px',
              border: '1px solid #4b66ce',
              background: '#182a5e',
              color: '#e7eeff',
              fontWeight: 700,
            }}
          >
            Reconnect Bridge Channel
          </button>
          {isAppleMobile ? <p style={{ margin: 0, opacity: 0.82 }}>Apple mobile detected. Keep this page in foreground during performance.</p> : null}
          {wakeLockSupported ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
              <input
                type="checkbox"
                checked={wakeLockEnabled}
                onChange={(event) => setWakeLockEnabled(event.target.checked)}
              />
              Keep screen awake during manual source ({wakeLockActive ? 'active' : 'inactive'})
            </label>
          ) : null}
        </section>

        <section style={{ padding: '1rem', border: '1px solid #2b345f', borderRadius: '14px', background: '#0b1020', display: 'grid', gap: '0.7rem' }}>
          <h2 style={{ marginTop: 0 }}>Emergency Manual Source</h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <input
              type="checkbox"
              checked={manualMode}
              onChange={(event) => {
                setManualMode(event.target.checked)
                if (!event.target.checked) {
                  setManualRunning(false)
                }
              }}
            />
            Force manual source (even if native bridge appears)
          </label>
          {!manualMode && manualSourceActive ? (
            <p style={{ margin: 0, opacity: 0.82 }}>
              Auto fallback is active because native bridge is missing. Press Start to run timer.
            </p>
          ) : null}

          {manualSourceActive ? (
            <>
              <input
                value={manualSongTitle}
                onChange={(event) => setManualSongTitle(event.target.value)}
                placeholder="Manual song title"
                style={{ minHeight: '48px', borderRadius: '10px', border: '1px solid #3d4a86', background: '#101832', color: '#e5ebff', padding: '0.6rem 0.8rem' }}
              />
              <input
                value={manualSongArtist}
                onChange={(event) => setManualSongArtist(event.target.value)}
                placeholder="Manual artist"
                style={{ minHeight: '48px', borderRadius: '10px', border: '1px solid #3d4a86', background: '#101832', color: '#e5ebff', padding: '0.6rem 0.8rem' }}
              />
              <input
                value={manualSongId}
                onChange={(event) => setManualSongId(event.target.value)}
                placeholder="Manual song id"
                style={{ minHeight: '48px', borderRadius: '10px', border: '1px solid #3d4a86', background: '#101832', color: '#e5ebff', padding: '0.6rem 0.8rem' }}
              />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px, 1fr))', gap: '0.6rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    setManualRunning((running) => {
                      const nextRunning = !running
                      if (nextRunning) {
                        setManualPlayPulse((pulse) => pulse + 1)
                        if (manualTimeSeconds <= 0) {
                          setManualTimeSeconds(0.02)
                        }
                      }
                      return nextRunning
                    })
                    manualLastTickAtRef.current = Date.now()
                  }}
                  style={{ minHeight: '48px', borderRadius: '10px', border: '1px solid #4b66ce', background: '#182a5e', color: '#e7eeff', fontWeight: 700 }}
                >
                  {manualRunning ? 'Pause' : 'Start'}
                </button>
                <button
                  type="button"
                  onClick={() => setManualTimeSeconds((seconds) => Math.max(0, seconds - 5))}
                  style={{ minHeight: '48px', borderRadius: '10px', border: '1px solid #4b66ce', background: '#182a5e', color: '#e7eeff', fontWeight: 700 }}
                >
                  -5s
                </button>
                <button
                  type="button"
                  onClick={() => setManualTimeSeconds((seconds) => seconds + 5)}
                  style={{ minHeight: '48px', borderRadius: '10px', border: '1px solid #4b66ce', background: '#182a5e', color: '#e7eeff', fontWeight: 700 }}
                >
                  +5s
                </button>
              </div>
              <p style={{ margin: 0, opacity: 0.82 }}>Manual timer: {manualTimeSeconds.toFixed(1)}s</p>
            </>
          ) : null}
        </section>

        <section style={{ padding: '1rem', border: '1px solid #2b345f', borderRadius: '14px', background: '#0b1020' }}>
          <h2 style={{ marginTop: 0 }}>Live Source Snapshot</h2>
          <p style={{ margin: '0.2rem 0' }}>Source: {manualSourceActive ? 'manual fallback' : 'Jamzone bridge'}</p>
          <p style={{ margin: '0.2rem 0' }}>Song: {manualSourceActive
            ? `${manualSongArtist || 'Manual Artist'} - ${manualSongTitle || 'Manual Song'}`
            : (currentSongArtist && currentSongTitle ? `${currentSongArtist} - ${currentSongTitle}` : 'No song metadata yet')}</p>
          <p style={{ margin: '0.2rem 0' }}>Time: {(manualSourceActive ? manualTimeSeconds : currentTimeSeconds).toFixed(2)}s</p>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.7rem' }}>
          <a
            href={lyricsUrl}
            style={{
              textAlign: 'center',
              textDecoration: 'none',
              minHeight: '56px',
              borderRadius: '12px',
              border: '1px solid #30b1ff',
              background: '#092338',
              color: '#ddf4ff',
              display: 'grid',
              alignItems: 'center',
              fontWeight: 700,
            }}
          >
            Open Lyrics View
          </a>
          <a
            href={boardUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              textAlign: 'center',
              textDecoration: 'none',
              minHeight: '56px',
              borderRadius: '12px',
              border: '1px solid #45dfb8',
              background: '#092e2a',
              color: '#dcfff2',
              display: 'grid',
              alignItems: 'center',
              fontWeight: 700,
            }}
          >
            Open Lyrics Board
          </a>
        </section>
      </section>
    </main>
  )
}
