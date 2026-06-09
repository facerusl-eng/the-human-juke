import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import KaraokeLyrics from '../components/KaraokeLyrics'
import { useJamzoneLyricSync } from '../../shared/lyrics/useJamzoneLyricSync'
import { createLocalLyricSyncTransport, type LyricSongRef, type LyricWindow } from '../../shared/lyrics'
import { supabase } from '../lib/supabase'
import { getJamzoneClockDisplayTimeSeconds, useJamzoneClockState } from '../lib/jamzoneClock'
import {
  getJamzoneBridge,
  getJamzoneCurrentSong,
  getJamzoneCurrentTimeSeconds,
  type JamzoneSong,
} from '../lib/jamzoneBridge'
import { useAuthStore } from '../state/authStore'

const JAMZONE_REMOTE_EVENT = 'jamzone-snapshot'
const JAMZONE_REMOTE_CHANNEL_PREFIX = 'jamzone-bridge'

const LOCAL_LYRIC_SYNC_CHANNEL = 'human-jukebox-live-lyrics'

function buildSongIdFallback(title: string, artist: string) {
  return `clock:${artist.toLowerCase().replace(/\s+/g, '-')}::${title.toLowerCase().replace(/\s+/g, '-')}`
}

function buildMissingLyricsFallbackWindow(song: JamzoneSong, currentTimeSeconds: number): LyricWindow {
  return {
    current: {
      timeSeconds: currentTimeSeconds,
      text: `${song.artist} - ${song.title}`,
      sourceLineNumber: 0,
    },
    previous: {
      timeSeconds: Math.max(0, currentTimeSeconds - 0.01),
      text: 'Live sync active',
      sourceLineNumber: 0,
    },
    next: {
      timeSeconds: currentTimeSeconds + 0.01,
      text: `No LRC match yet (t=${currentTimeSeconds.toFixed(1)}s)`,
      sourceLineNumber: 0,
    },
    upcoming: [
      {
        timeSeconds: currentTimeSeconds + 0.02,
        text: 'Set manual song/artist to a file that exists in /lyrics',
        sourceLineNumber: 0,
      },
    ],
    isBeforeFirstLine: false,
    isAfterLastLine: false,
  }
}

export default function JamzoneLyricsPage() {
  const location = useLocation()
  const { profile } = useAuthStore()
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(false)
  const [hasJamzoneBridge, setHasJamzoneBridge] = useState(false)
  const [bridgeSong, setBridgeSong] = useState<JamzoneSong | null>(null)
  const [remoteSong, setRemoteSong] = useState<JamzoneSong | null>(null)
  const [remoteBridgeConnected, setRemoteBridgeConnected] = useState(false)
  const [remoteChannelStatus, setRemoteChannelStatus] = useState('idle')
  const [remoteReconnectNonce, setRemoteReconnectNonce] = useState(0)
  const remoteBridgeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const sourceIdRef = useRef(`lyrics-${Math.random().toString(36).slice(2)}`)
  const remoteSnapshotRef = useRef<{ currentTimeSeconds: number; updatedAtMs: number }>({
    currentTimeSeconds: 0,
    updatedAtMs: Date.now(),
  })
  const lastPlayPulseRef = useRef(0)

  const localSyncTransport = useMemo(() => createLocalLyricSyncTransport(LOCAL_LYRIC_SYNC_CHANNEL), [])
  const urlSong = useMemo<JamzoneSong | null>(() => {
    const params = new URLSearchParams(location.search)
    const title = (params.get('title') ?? '').trim()
    const artist = (params.get('artist') ?? '').trim()

    if (!title || !artist) {
      return null
    }

    return {
      id: (params.get('songId') ?? '').trim() || buildSongIdFallback(title, artist),
      title,
      artist,
    }
  }, [location.search])

  const syncEventId = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const fromUrl = params.get('event') ?? params.get('eventId')

    if (fromUrl && fromUrl.trim().length > 0) {
      return fromUrl.trim()
    }

    const profileEvent = profile?.active_event_id
    return profileEvent && profileEvent.trim().length > 0 ? profileEvent : null
  }, [location.search, profile?.active_event_id])

  const remoteChannelName = useMemo(() => {
    if (!syncEventId) {
      return null
    }

    return `${JAMZONE_REMOTE_CHANNEL_PREFIX}:${syncEventId}`
  }, [syncEventId])
  const {
    snapshot: durableClockSnapshot,
    status: durableClockStatus,
    isConnected: durableClockConnected,
  } = useJamzoneClockState(syncEventId)

  const durableClockSong = useMemo<JamzoneSong | null>(() => {
    if (!durableClockSnapshot?.currentSongTitle || !durableClockSnapshot.currentSongArtist) {
      return null
    }

    return {
      id: durableClockSnapshot.currentSongId
        ?? buildSongIdFallback(durableClockSnapshot.currentSongTitle, durableClockSnapshot.currentSongArtist),
      title: durableClockSnapshot.currentSongTitle,
      artist: durableClockSnapshot.currentSongArtist,
    }
  }, [durableClockSnapshot])

  const boardHref = useMemo(() => {
    if (!syncEventId) {
      return '/lyrics-board'
    }

    return `/lyrics-board?event=${encodeURIComponent(syncEventId)}`
  }, [syncEventId])

  useEffect(() => {
    const updateFromBridge = () => {
      const bridge = getJamzoneBridge()
      setHasJamzoneBridge(Boolean(bridge))
      setBridgeSong(getJamzoneCurrentSong())
    }

    updateFromBridge()
    const timerId = window.setInterval(updateFromBridge, 350)

    return () => {
      window.clearInterval(timerId)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat) {
        return
      }

      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toUpperCase()
      if (target?.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
        return
      }

      setAutoScrollEnabled((value) => !value)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    if (!remoteChannelName) {
      setRemoteBridgeConnected(false)
      setRemoteChannelStatus('waiting-event')
      return
    }

    if (durableClockSnapshot) {
      setRemoteBridgeConnected(false)
      setRemoteChannelStatus('standby-durable')
      return
    }

    const channel = supabase
      .channel(remoteChannelName)
      .on('broadcast', { event: JAMZONE_REMOTE_EVENT }, ({ payload }) => {
        const data = payload as {
          sourceId?: string
          currentTimeSeconds?: number
          currentSong?: JamzoneSong | null
          playPulse?: number
          updatedAtMs?: number
        }

        if (!data || data.sourceId === sourceIdRef.current) {
          return
        }

        if (Number.isFinite(data.currentTimeSeconds)) {
          remoteSnapshotRef.current = {
            currentTimeSeconds: Math.max(0, Number(data.currentTimeSeconds)),
            updatedAtMs: Number.isFinite(data.updatedAtMs) ? Number(data.updatedAtMs) : Date.now(),
          }
        }

        if (Number.isFinite(data.playPulse) && Number(data.playPulse) > lastPlayPulseRef.current) {
          lastPlayPulseRef.current = Number(data.playPulse)
          // Force a minimal positive tick so lyrics can transition immediately on Play.
          remoteSnapshotRef.current = {
            currentTimeSeconds: Math.max(0.02, remoteSnapshotRef.current.currentTimeSeconds),
            updatedAtMs: Date.now(),
          }
        }

        if (data.currentSong?.id && data.currentSong?.title && data.currentSong?.artist) {
          setRemoteSong(data.currentSong)
        }

        setRemoteBridgeConnected(true)
      })

    remoteBridgeChannelRef.current = channel
    channel.subscribe((status) => {
      setRemoteChannelStatus(status)
      setRemoteBridgeConnected(status === 'SUBSCRIBED')
    })

    return () => {
      remoteBridgeChannelRef.current = null
      setRemoteBridgeConnected(false)
      setRemoteChannelStatus('disconnected')
      void supabase.removeChannel(channel)
    }
  }, [durableClockSnapshot, remoteChannelName, remoteReconnectNonce])

  useEffect(() => {
    const shouldRetry = remoteChannelStatus === 'CHANNEL_ERROR' || remoteChannelStatus === 'TIMED_OUT' || remoteChannelStatus === 'CLOSED' || remoteChannelStatus === 'disconnected'
    if (!remoteChannelName || remoteBridgeConnected || !shouldRetry) {
      return
    }

    const retryTimer = window.setTimeout(() => {
      setRemoteReconnectNonce((value) => value + 1)
    }, 4500)

    return () => {
      window.clearTimeout(retryTimer)
    }
  }, [remoteBridgeConnected, remoteChannelName, remoteReconnectNonce, remoteChannelStatus])

  useEffect(() => {
    if (!hasJamzoneBridge || !remoteBridgeChannelRef.current) {
      return
    }

    const publishTimer = window.setInterval(() => {
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
    }, 180)

    return () => {
      window.clearInterval(publishTimer)
    }
  }, [hasJamzoneBridge])

  const useDurableClock = Boolean(syncEventId && durableClockSnapshot)
  const useRemoteSnapshot = Boolean(syncEventId && !useDurableClock && remoteBridgeConnected && remoteSong)
  const activeSong = (useDurableClock ? durableClockSong : (useRemoteSnapshot ? remoteSong : bridgeSong)) ?? urlSong
  const bridgeStatusLabel = hasJamzoneBridge
    ? 'detected'
    : (useRemoteSnapshot ? 'not detected (using iPad remote source)' : 'not detected')

  const songRef = useMemo<LyricSongRef | null>(() => {
    if (!activeSong) {
      return null
    }

    return {
      songId: activeSong.id,
      artist: activeSong.artist,
      title: activeSong.title,
    }
  }, [activeSong])

  const { window: lyricWindow, isLoading, loadError, songDurationSeconds } = useJamzoneLyricSync(
    songRef,
    () => {
      if (useDurableClock && durableClockSnapshot) {
        return getJamzoneClockDisplayTimeSeconds(durableClockSnapshot)
      }

      if (!useRemoteSnapshot) {
        return getJamzoneCurrentTimeSeconds()
      }

      const elapsedSeconds = Math.max(0, (Date.now() - remoteSnapshotRef.current.updatedAtMs) / 1000)
      return remoteSnapshotRef.current.currentTimeSeconds + elapsedSeconds
    },
    { updateIntervalMs: 80 },
  )

  const activeTimeSeconds = useMemo(() => {
    if (useRemoteSnapshot) {
      const elapsedSeconds = Math.max(0, (Date.now() - remoteSnapshotRef.current.updatedAtMs) / 1000)
      return remoteSnapshotRef.current.currentTimeSeconds + elapsedSeconds
    }

    if (useDurableClock && durableClockSnapshot) {
      return getJamzoneClockDisplayTimeSeconds(durableClockSnapshot)
    }

    return getJamzoneCurrentTimeSeconds()
  }, [durableClockSnapshot, lyricWindow.current, lyricWindow.next, useDurableClock, useRemoteSnapshot])

  const displayWindow = useMemo(() => {
    if (!activeSong || !loadError) {
      return lyricWindow
    }

    return buildMissingLyricsFallbackWindow(activeSong, activeTimeSeconds)
  }, [activeSong, activeTimeSeconds, loadError, lyricWindow])

  useEffect(() => {
    if (!activeSong) {
      return
    }

    const payload = {
      songId: activeSong.id,
      jamzoneTimeSeconds: useDurableClock && durableClockSnapshot
        ? getJamzoneClockDisplayTimeSeconds(durableClockSnapshot)
        : (useRemoteSnapshot
          ? remoteSnapshotRef.current.currentTimeSeconds
          : getJamzoneCurrentTimeSeconds()),
      current: lyricWindow.current,
      next: lyricWindow.next,
      next2: lyricWindow.upcoming[1],
      updatedAtMs: Date.now(),
    }

    localSyncTransport.publish(payload)

    void supabase.channel('lyrics-sync').send({
      type: 'broadcast',
      event: 'lyrics-frame',
      payload,
    })
  }, [activeSong, durableClockSnapshot, localSyncTransport, lyricWindow.current, lyricWindow.next, lyricWindow.upcoming, useDurableClock, useRemoteSnapshot])

  return (
    <main style={{ minHeight: '100vh', background: '#02030a', padding: '1rem' }}>
      <section style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gap: '1rem' }}>
        <header style={{ color: '#d5dcff' }}>
          <h1 style={{ marginBottom: '0.4rem' }}>Jamzone Synced Karaoke</h1>
          <p style={{ margin: 0, opacity: 0.85 }}>
            This view reads Jamzone playback time only. Lyrics advance automatically without manual stepping.
          </p>
          {activeSong ? <p style={{ marginTop: '0.55rem' }}>Now playing: {activeSong.artist} - {activeSong.title}</p> : null}
          {!activeSong ? <p style={{ marginTop: '0.55rem', opacity: 0.85 }}>Waiting for song metadata from the active clock source...</p> : null}
          {!hasJamzoneBridge && !useRemoteSnapshot ? <p style={{ marginTop: '0.35rem', opacity: 0.75 }}>Jamzone bridge is not registered yet.</p> : null}
          {syncEventId ? <p style={{ marginTop: '0.35rem', opacity: 0.75 }}>Sync event: {syncEventId}</p> : null}
          {!syncEventId ? <p style={{ marginTop: '0.35rem', opacity: 0.75 }}>Tip: add ?event=YOUR_EVENT_ID to sync with your iPad controller.</p> : null}
          {syncEventId ? <p style={{ marginTop: '0.35rem', opacity: 0.85 }}>Durable clock status: {durableClockStatus}</p> : null}
          {syncEventId && durableClockConnected ? <p style={{ marginTop: '0.35rem', opacity: 0.85 }}>Durable clock: active</p> : null}
          {syncEventId && !useDurableClock && remoteBridgeConnected ? <p style={{ marginTop: '0.35rem', opacity: 0.85 }}>Legacy remote bridge: active</p> : null}
          {syncEventId ? <p style={{ marginTop: '0.35rem', opacity: 0.85 }}>Remote channel status: {remoteChannelStatus}</p> : null}
          <p style={{ marginTop: '0.35rem', opacity: 0.85 }}>
            Auto scroll: {autoScrollEnabled ? 'on' : 'off'}{songDurationSeconds ? `, song length ${songDurationSeconds.toFixed(1)}s` : ''}
          </p>
          <p style={{ marginTop: '0.2rem', opacity: 0.7 }}>Press Enter to toggle auto scroll.</p>
          {syncEventId ? (
            <button
              type="button"
              onClick={() => setRemoteReconnectNonce((value) => value + 1)}
              style={{
                marginTop: '0.35rem',
                minHeight: '40px',
                borderRadius: '10px',
                border: '1px solid #4b66ce',
                background: '#182a5e',
                color: '#e7eeff',
                fontWeight: 700,
                padding: '0 0.9rem',
              }}
            >
              Reconnect Remote Bridge
            </button>
          ) : null}
          <p style={{ marginTop: '0.35rem', opacity: 0.85 }}>Native bridge: {bridgeStatusLabel}</p>
          {useDurableClock ? <p style={{ marginTop: '0.35rem', opacity: 0.85 }}>Lyric source: durable Jamzone clock</p> : null}
          {useRemoteSnapshot ? <p style={{ marginTop: '0.35rem', opacity: 0.85 }}>Lyric source: legacy iPad snapshot fallback</p> : null}
          <p style={{ marginTop: '0.35rem' }}>
            Fullscreen board: <a href={boardHref} target="_blank" rel="noreferrer">open lyrics board</a>
          </p>
        </header>

        <section style={{ height: '72vh' }}>
          <KaraokeLyrics
            mode="main"
            current={displayWindow.current}
            previous={displayWindow.previous}
            next={displayWindow.next}
            next2={displayWindow.upcoming[1]}
            isBeforeFirstLine={displayWindow.isBeforeFirstLine}
            isAfterLastLine={displayWindow.isAfterLastLine}
            autoScrollEnabled={autoScrollEnabled}
            autoScrollCurrentTimeSeconds={activeTimeSeconds}
            autoScrollDurationSeconds={songDurationSeconds}
          />
        </section>

        {isLoading ? <p style={{ color: '#8bd8ff' }}>Loading LRC file...</p> : null}
        {loadError ? <p style={{ color: '#ffd58a' }}>Lyric file missing, fallback mode active: {loadError}</p> : null}
      </section>
    </main>
  )
}
