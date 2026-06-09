import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import KaraokeLyrics from '../components/KaraokeLyrics'
import { useJamzoneLyricSync } from '../../shared/lyrics/useJamzoneLyricSync'
import { createLocalLyricSyncTransport, type LyricSongRef } from '../../shared/lyrics'
import { supabase } from '../lib/supabase'
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

export default function JamzoneLyricsPage() {
  const location = useLocation()
  const { profile } = useAuthStore()
  const [hasJamzoneBridge, setHasJamzoneBridge] = useState(false)
  const [bridgeSong, setBridgeSong] = useState<JamzoneSong | null>(null)
  const [remoteSong, setRemoteSong] = useState<JamzoneSong | null>(null)
  const [remoteBridgeConnected, setRemoteBridgeConnected] = useState(false)
  const remoteBridgeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const sourceIdRef = useRef(`lyrics-${Math.random().toString(36).slice(2)}`)
  const remoteSnapshotRef = useRef<{ currentTimeSeconds: number; updatedAtMs: number }>({
    currentTimeSeconds: 0,
    updatedAtMs: Date.now(),
  })
  const lastPlayPulseRef = useRef(0)

  const localSyncTransport = useMemo(() => createLocalLyricSyncTransport(LOCAL_LYRIC_SYNC_CHANNEL), [])
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
    if (!remoteChannelName) {
      setRemoteBridgeConnected(false)
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
      setRemoteBridgeConnected(status === 'SUBSCRIBED')
    })

    return () => {
      remoteBridgeChannelRef.current = null
      setRemoteBridgeConnected(false)
      void supabase.removeChannel(channel)
    }
  }, [remoteChannelName])

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

  const useRemoteSnapshot = Boolean(syncEventId && remoteBridgeConnected && remoteSong)
  const activeSong = useRemoteSnapshot ? remoteSong : bridgeSong
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

  const { window: lyricWindow, isLoading, loadError } = useJamzoneLyricSync(
    songRef,
    () => {
      if (!useRemoteSnapshot) {
        return getJamzoneCurrentTimeSeconds()
      }

      const elapsedSeconds = Math.max(0, (Date.now() - remoteSnapshotRef.current.updatedAtMs) / 1000)
      return remoteSnapshotRef.current.currentTimeSeconds + elapsedSeconds
    },
    { updateIntervalMs: 80 },
  )

  useEffect(() => {
    if (!activeSong) {
      return
    }

    const payload = {
      songId: activeSong.id,
      jamzoneTimeSeconds: useRemoteSnapshot
        ? remoteSnapshotRef.current.currentTimeSeconds
        : getJamzoneCurrentTimeSeconds(),
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
  }, [activeSong, localSyncTransport, lyricWindow.current, lyricWindow.next, lyricWindow.upcoming, useRemoteSnapshot])

  return (
    <main style={{ minHeight: '100vh', background: '#02030a', padding: '1rem' }}>
      <section style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gap: '1rem' }}>
        <header style={{ color: '#d5dcff' }}>
          <h1 style={{ marginBottom: '0.4rem' }}>Jamzone Synced Karaoke</h1>
          <p style={{ margin: 0, opacity: 0.85 }}>
            This view reads Jamzone playback time only. Lyrics advance automatically without manual stepping.
          </p>
          {activeSong ? <p style={{ marginTop: '0.55rem' }}>Now playing: {activeSong.artist} - {activeSong.title}</p> : null}
          {!activeSong ? <p style={{ marginTop: '0.55rem', opacity: 0.85 }}>Waiting for Jamzone song metadata...</p> : null}
          {!hasJamzoneBridge && !useRemoteSnapshot ? <p style={{ marginTop: '0.35rem', opacity: 0.75 }}>Jamzone bridge is not registered yet.</p> : null}
          {syncEventId ? <p style={{ marginTop: '0.35rem', opacity: 0.75 }}>Sync event: {syncEventId}</p> : null}
          {!syncEventId ? <p style={{ marginTop: '0.35rem', opacity: 0.75 }}>Tip: add ?event=YOUR_EVENT_ID to sync with your iPad controller.</p> : null}
          {syncEventId && remoteBridgeConnected ? <p style={{ marginTop: '0.35rem', opacity: 0.85 }}>Remote bridge: active</p> : null}
          <p style={{ marginTop: '0.35rem', opacity: 0.85 }}>Native bridge: {bridgeStatusLabel}</p>
          {useRemoteSnapshot ? <p style={{ marginTop: '0.35rem', opacity: 0.85 }}>Lyric source: iPad remote snapshot</p> : null}
          <p style={{ marginTop: '0.35rem' }}>
            Fullscreen board: <a href={boardHref} target="_blank" rel="noreferrer">open lyrics board</a>
          </p>
        </header>

        <section style={{ height: '72vh' }}>
          <KaraokeLyrics
            mode="main"
            current={lyricWindow.current}
            previous={lyricWindow.previous}
            next={lyricWindow.next}
            next2={lyricWindow.upcoming[1]}
            isBeforeFirstLine={lyricWindow.isBeforeFirstLine}
            isAfterLastLine={lyricWindow.isAfterLastLine}
          />
        </section>

        {isLoading ? <p style={{ color: '#8bd8ff' }}>Loading LRC file...</p> : null}
        {loadError ? <p style={{ color: '#ff98c7' }}>Lyric error: {loadError}</p> : null}
      </section>
    </main>
  )
}
