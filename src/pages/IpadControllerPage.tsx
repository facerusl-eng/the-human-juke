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

  const [eventId, setEventId] = useState('')
  const [hasJamzoneBridge, setHasJamzoneBridge] = useState(false)
  const [currentSongTitle, setCurrentSongTitle] = useState('')
  const [currentSongArtist, setCurrentSongArtist] = useState('')
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0)
  const [channelConnected, setChannelConnected] = useState(false)
  const [publishStatus, setPublishStatus] = useState<PublishStatus>('idle')
  const [copyFeedback, setCopyFeedback] = useState('')

  const sourceIdRef = useRef(`ipad-${Math.random().toString(36).slice(2)}`)
  const remoteBridgeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const fromUrl = (params.get('event') ?? params.get('eventId') ?? '').trim()
    const fromStorage = typeof window !== 'undefined'
      ? (window.localStorage.getItem(IPAD_EVENT_STORAGE_KEY) ?? '').trim()
      : ''
    const fromProfile = (profile?.active_event_id ?? '').trim()

    setEventId(fromUrl || fromStorage || fromProfile)
  }, [location.search, profile?.active_event_id])

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
      setPublishStatus('waiting-event')
      return
    }

    const channel = supabase.channel(channelName)
    remoteBridgeChannelRef.current = channel

    channel.subscribe((status) => {
      setChannelConnected(status === 'SUBSCRIBED')
    })

    return () => {
      remoteBridgeChannelRef.current = null
      setChannelConnected(false)
      void supabase.removeChannel(channel)
    }
  }, [channelName])

  useEffect(() => {
    if (!remoteBridgeChannelRef.current) {
      return
    }

    if (!eventId.trim()) {
      setPublishStatus('waiting-event')
      return
    }

    const publishTick = () => {
      if (!getJamzoneBridge()) {
        setPublishStatus('waiting-bridge')
        return
      }

      const currentSong = getJamzoneCurrentSong()

      void remoteBridgeChannelRef.current?.send({
        type: 'broadcast',
        event: JAMZONE_REMOTE_EVENT,
        payload: {
          sourceId: sourceIdRef.current,
          currentTimeSeconds: getJamzoneCurrentTimeSeconds(),
          currentSong,
          updatedAtMs: Date.now(),
        },
      })

      setPublishStatus('publishing')
    }

    publishTick()
    const timerId = window.setInterval(publishTick, 180)

    return () => {
      window.clearInterval(timerId)
    }
  }, [eventId])

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
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            placeholder="Paste event id"
            style={{
              minHeight: '52px',
              padding: '0.75rem 0.9rem',
              fontSize: '1rem',
              borderRadius: '10px',
              border: '1px solid #3d4a86',
              background: '#101832',
              color: '#e5ebff',
            }}
          />
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
          <p style={{ margin: 0, opacity: 0.8 }}>Bridge: {hasJamzoneBridge ? 'detected' : 'not detected'}</p>
          <p style={{ margin: 0, opacity: 0.8 }}>Realtime channel: {channelConnected ? 'connected' : 'disconnected'}</p>
          <p style={{ margin: 0, opacity: 0.8 }}>Publish status: {publishStatus}</p>
        </section>

        <section style={{ padding: '1rem', border: '1px solid #2b345f', borderRadius: '14px', background: '#0b1020' }}>
          <h2 style={{ marginTop: 0 }}>Live Jamzone Snapshot</h2>
          <p style={{ margin: '0.2rem 0' }}>Song: {currentSongArtist && currentSongTitle ? `${currentSongArtist} - ${currentSongTitle}` : 'No song metadata yet'}</p>
          <p style={{ margin: '0.2rem 0' }}>Time: {currentTimeSeconds.toFixed(2)}s</p>
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
