import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getJamzoneBridge, getJamzoneCurrentSong, getJamzoneCurrentTimeSeconds } from '../lib/jamzoneBridge'
import { readSharedPlaybackState } from '../lib/playbackState'
import { useAuthStore } from '../state/authStore'
import './IpadControllerPage.css'

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
  const [manualSongId, setManualSongId] = useState('')
  const [manualSongTitle, setManualSongTitle] = useState('')
  const [manualSongArtist, setManualSongArtist] = useState('')
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
  const [lastPublishAck, setLastPublishAck] = useState('none')
  const isLockedToActiveGig = eventIdSource === 'active-gig'
  const manualSourceActive = manualMode || (autoFallbackEnabled && !hasJamzoneBridge)
  const bridgeStatusLabel = hasJamzoneBridge
    ? 'detected'
    : (manualSourceActive ? 'not detected (manual fallback active)' : 'not detected')
  const publishAckOk = lastPublishAck.toLowerCase().includes('ok')
  const syncHealthLabel = publishAckOk
    ? 'live (publishing to remote bridge)'
    : (channelConnected ? 'connecting (waiting for publish ack)' : 'offline (channel disconnected)')

  const sourceIdRef = useRef(`ipad-${Math.random().toString(36).slice(2)}`)
  const remoteBridgeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const manualLastTickAtRef = useRef(Date.now())
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const lastPublishAtMsRef = useRef<number | null>(null)
  const autoStartTriggeredRef = useRef(false)

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

  useEffect(() => {
    if (!manualSourceActive || !eventId.trim()) {
      return
    }

    let cancelled = false

    const syncFromSharedPlaybackState = async () => {
      const sharedPlayback = await readSharedPlaybackState(eventId.trim())
      if (cancelled || !sharedPlayback?.currentSongId) {
        return
      }

      const { data: librarySong } = await supabase
        .from('library_songs')
        .select('id, artist, title')
        .eq('id', sharedPlayback.currentSongId)
        .maybeSingle()

      if (cancelled || !librarySong) {
        return
      }

      setManualSongId(librarySong.id)
      setManualSongArtist((librarySong.artist ?? '').trim())
      setManualSongTitle((librarySong.title ?? '').trim())

      if (sharedPlayback.isStarted) {
        setManualRunning(true)
      }
    }

    void syncFromSharedPlaybackState()
    const timerId = window.setInterval(() => {
      void syncFromSharedPlaybackState()
    }, 3000)

    return () => {
      cancelled = true
      window.clearInterval(timerId)
    }
  }, [eventId, manualSourceActive])

  useEffect(() => {
    if (!manualSourceActive || !channelConnected || manualRunning || manualTimeSeconds > 0 || autoStartTriggeredRef.current) {
      return
    }

    autoStartTriggeredRef.current = true
    manualLastTickAtRef.current = Date.now()
    setManualPlayPulse((pulse) => pulse + 1)
    setManualRunning(true)
  }, [channelConnected, manualRunning, manualSourceActive, manualTimeSeconds])

  useEffect(() => {
    autoStartTriggeredRef.current = false
  }, [eventId])

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
            id: manualSongId.trim() || 'manual-fallback',
            title: manualSongTitle.trim() || 'Fallback Song',
            artist: manualSongArtist.trim() || 'Fallback Artist',
          }
        : getJamzoneCurrentSong()

      const nextTimeSeconds = useManualSource ? manualTimeSeconds : getJamzoneCurrentTimeSeconds()

      if (!useManualSource && !bridgeAvailable) {
        setPublishStatus('waiting-bridge')
        return
      }

      void (async () => {
        const ack = await remoteBridgeChannelRef.current?.send({
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

        const ackLabel = typeof ack === 'string' ? ack : JSON.stringify(ack ?? 'unknown')
        setLastPublishAck(ackLabel)

        if (ackLabel.toLowerCase().includes('ok')) {
          setChannelConnected(true)
          setPublishStatus('publishing')
          lastPublishAtMsRef.current = Date.now()
          return
        }

        setPublishStatus('waiting-event')
      })()
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
    <main className="ipad-controller-page">
      <section className="ipad-controller-shell">
        <header className="ipad-controller-panel ipad-controller-header">
          <h1 className="ipad-controller-title">iPad Jamzone Controller</h1>
          <p className="ipad-controller-copy">
            This page is part of Human Jukebox and is designed to run on your iPad as the Jamzone timing source.
          </p>
        </header>

        <section className="ipad-controller-panel">
          <label htmlFor="ipad-event-id" className="ipad-controller-label">Event ID for sync</label>
          <input
            id="ipad-event-id"
            value={eventIdDraft}
            onChange={(event) => setEventIdDraft(event.target.value)}
            placeholder="Paste event id"
            disabled={isLockedToActiveGig}
            className={isLockedToActiveGig ? 'ipad-controller-input ipad-controller-input--locked' : 'ipad-controller-input'}
          />
          <button
            type="button"
            onClick={confirmEventId}
            disabled={isLockedToActiveGig}
            className="ipad-controller-button ipad-controller-button--primary"
          >
            Confirm Event ID
          </button>
          {isLockedToActiveGig ? (
            <button
              type="button"
              onClick={enableManualEventOverride}
              className="ipad-controller-button ipad-controller-button--warning"
            >
              Use Manual Event ID Override
            </button>
          ) : null}
          {!isLockedToActiveGig && eventIdSource === 'manual' && activeGigEventId ? (
            <button
              type="button"
              onClick={reenableActiveGigSync}
              className="ipad-controller-button ipad-controller-button--success"
            >
              Re-enable Active Gig Sync
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void copyEventId()
            }}
            className="ipad-controller-button"
          >
            Copy Event ID
          </button>
          {copyFeedback ? <p className="ipad-controller-note">{copyFeedback}</p> : null}
          <p className="ipad-controller-meta">Active event ID: {eventId || 'none'}</p>
          <p className="ipad-controller-meta">
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
          <label className="ipad-controller-label-row">
            <input
              type="checkbox"
              checked={autoFallbackEnabled}
              onChange={(event) => setAutoFallbackEnabled(event.target.checked)}
            />
            Auto fallback to manual source when bridge is missing
          </label>
          <p className="ipad-controller-meta">Bridge: {bridgeStatusLabel}</p>
          <p className={publishAckOk ? 'ipad-controller-meta ipad-controller-meta--accent' : 'ipad-controller-meta ipad-controller-meta--warning'}>Sync health: {syncHealthLabel}</p>
          <p className="ipad-controller-meta">Realtime channel: {channelConnected ? 'connected' : 'disconnected'}</p>
          <p className="ipad-controller-meta">Channel status: {channelStatus}</p>
          <p className="ipad-controller-meta">Channel name: {channelName ?? 'none'}</p>
          <p className="ipad-controller-meta">Publish status: {publishStatus}</p>
          <p className="ipad-controller-meta">Last publish ack: {lastPublishAck}</p>
          <p className="ipad-controller-meta">Last publish: {lastPublishAgoSeconds !== null ? `${lastPublishAgoSeconds.toFixed(1)}s ago` : 'not yet'}</p>
          <button
            type="button"
            onClick={() => setChannelReconnectNonce((value) => value + 1)}
            className="ipad-controller-button ipad-controller-button--secondary"
          >
            Reconnect Bridge Channel
          </button>
          {isAppleMobile ? <p className="ipad-controller-note ipad-controller-note--muted">Apple mobile detected. Keep this page in foreground during performance.</p> : null}
          {wakeLockSupported ? (
            <label className="ipad-controller-label-row">
              <input
                type="checkbox"
                checked={wakeLockEnabled}
                onChange={(event) => setWakeLockEnabled(event.target.checked)}
              />
              Keep screen awake during manual source ({wakeLockActive ? 'active' : 'inactive'})
            </label>
          ) : null}
        </section>

        <section className="ipad-controller-panel ipad-controller-panel--compact">
          <h2 className="ipad-controller-live-title">Emergency Manual Source</h2>
          <label className="ipad-controller-label-row">
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
            <p className="ipad-controller-note ipad-controller-note--muted">
              Auto fallback is active because native bridge is missing. Press Start to run timer.
            </p>
          ) : null}

          {manualSourceActive ? (
            <>
              <input
                value={manualSongTitle}
                onChange={(event) => setManualSongTitle(event.target.value)}
                placeholder="Manual song title"
                className="ipad-controller-input"
              />
              <input
                value={manualSongArtist}
                onChange={(event) => setManualSongArtist(event.target.value)}
                placeholder="Manual artist"
                className="ipad-controller-input"
              />
              <input
                value={manualSongId}
                onChange={(event) => setManualSongId(event.target.value)}
                placeholder="Manual song id"
                className="ipad-controller-input"
              />

              <div className="ipad-controller-grid-three">
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
                  className="ipad-controller-button"
                >
                  {manualRunning ? 'Pause' : 'Start'}
                </button>
                <button
                  type="button"
                  onClick={() => setManualTimeSeconds((seconds) => Math.max(0, seconds - 5))}
                  className="ipad-controller-button"
                >
                  -5s
                </button>
                <button
                  type="button"
                  onClick={() => setManualTimeSeconds((seconds) => seconds + 5)}
                  className="ipad-controller-button"
                >
                  +5s
                </button>
              </div>
              <p className="ipad-controller-note ipad-controller-note--muted">Manual timer: {manualTimeSeconds.toFixed(1)}s</p>
            </>
          ) : null}
        </section>

        <section className="ipad-controller-live-snapshot">
          <h2 className="ipad-controller-live-title">Live Source Snapshot</h2>
          <p className="ipad-controller-live-line">Source: {manualSourceActive ? 'manual fallback' : 'Jamzone bridge'}</p>
          <p className="ipad-controller-live-line">Song: {manualSourceActive
            ? `${manualSongArtist || 'Manual Artist'} - ${manualSongTitle || 'Manual Song'}`
            : (currentSongArtist && currentSongTitle ? `${currentSongArtist} - ${currentSongTitle}` : 'No song metadata yet')}</p>
          <p className="ipad-controller-live-line">Time: {(manualSourceActive ? manualTimeSeconds : currentTimeSeconds).toFixed(2)}s</p>
        </section>

        <section className="ipad-controller-grid-links">
          <a
            href={lyricsUrl}
            className="ipad-controller-link ipad-controller-link--lyrics"
          >
            Open Lyrics View
          </a>
          <a
            href={boardUrl}
            target="_blank"
            rel="noreferrer"
            className="ipad-controller-link ipad-controller-link--board"
          >
            Open Lyrics Board
          </a>
        </section>
      </section>
    </main>
  )
}
