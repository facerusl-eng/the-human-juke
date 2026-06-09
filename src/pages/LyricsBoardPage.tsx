import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import KaraokeLyrics from '../components/KaraokeLyrics'
import { createLocalLyricSyncTransport, type LyricSongRef, type LyricWindow } from '../../shared/lyrics'
import { useJamzoneLyricSync } from '../../shared/lyrics/useJamzoneLyricSync'
import { supabase } from '../lib/supabase'
import type { JamzoneSong } from '../lib/jamzoneBridge'
import { useAuthStore } from '../state/authStore'

const LOCAL_LYRIC_SYNC_CHANNEL = 'human-jukebox-live-lyrics'
const JAMZONE_REMOTE_EVENT = 'jamzone-snapshot'
const JAMZONE_REMOTE_CHANNEL_PREFIX = 'jamzone-bridge'

function emptyWindow(): LyricWindow {
  return {
    current: null,
    upcoming: [],
    isBeforeFirstLine: true,
    isAfterLastLine: false,
  }
}

export default function LyricsBoardPage() {
  const location = useLocation()
  const { profile } = useAuthStore()
  const [windowState, setWindowState] = useState<LyricWindow>(emptyWindow)
  const [remoteSong, setRemoteSong] = useState<JamzoneSong | null>(null)
  const [remoteBridgeConnected, setRemoteBridgeConnected] = useState(false)
  const remoteSnapshotRef = useRef<{ currentTimeSeconds: number; updatedAtMs: number }>({
    currentTimeSeconds: 0,
    updatedAtMs: Date.now(),
  })
  const transport = useMemo(() => createLocalLyricSyncTransport(LOCAL_LYRIC_SYNC_CHANNEL), [])
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

  const remoteSongRef = useMemo<LyricSongRef | null>(() => {
    if (!remoteSong) {
      return null
    }

    return {
      songId: remoteSong.id,
      title: remoteSong.title,
      artist: remoteSong.artist,
    }
  }, [remoteSong])

  const { window: remoteLyricWindow } = useJamzoneLyricSync(
    remoteSongRef,
    () => {
      const elapsedSeconds = Math.max(0, (Date.now() - remoteSnapshotRef.current.updatedAtMs) / 1000)
      return remoteSnapshotRef.current.currentTimeSeconds + elapsedSeconds
    },
    { updateIntervalMs: 80 },
  )

  useEffect(() => {
    if (!remoteChannelName) {
      setRemoteBridgeConnected(false)
      return
    }

    const channel = supabase
      .channel(remoteChannelName)
      .on('broadcast', { event: JAMZONE_REMOTE_EVENT }, ({ payload }) => {
        const data = payload as {
          currentTimeSeconds?: number
          currentSong?: JamzoneSong | null
          updatedAtMs?: number
        }

        if (!data || !Number.isFinite(data.currentTimeSeconds)) {
          return
        }

        remoteSnapshotRef.current = {
          currentTimeSeconds: Math.max(0, Number(data.currentTimeSeconds)),
          updatedAtMs: Number.isFinite(data.updatedAtMs) ? Number(data.updatedAtMs) : Date.now(),
        }

        if (data.currentSong && data.currentSong.id && data.currentSong.title && data.currentSong.artist) {
          setRemoteSong(data.currentSong)
        }
      })

    channel.subscribe((status) => {
      setRemoteBridgeConnected(status === 'SUBSCRIBED')
    })

    return () => {
      setRemoteBridgeConnected(false)
      void supabase.removeChannel(channel)
    }
  }, [remoteChannelName])

  useEffect(() => {
    if (syncEventId) {
      return () => undefined
    }

    return transport.subscribe((payload) => {
      setWindowState((prev) => ({
        ...prev,
        current: payload.current,
        next: payload.next,
        upcoming: [payload.next, payload.next2].filter(Boolean) as LyricWindow['upcoming'],
        isBeforeFirstLine: false,
      }))
    })
  }, [syncEventId, transport])

  const activeWindow = syncEventId ? remoteLyricWindow : windowState

  return (
    <main style={{ width: '100vw', height: '100vh', background: '#02030a' }}>
      {syncEventId && !remoteBridgeConnected ? (
        <p style={{ margin: 0, padding: '0.65rem 1rem', color: '#d4dcff', opacity: 0.84 }}>
          Waiting for iPad bridge on event {syncEventId}...
        </p>
      ) : null}
      <KaraokeLyrics
        mode="board"
        current={activeWindow.current}
        previous={activeWindow.previous}
        next={activeWindow.next}
        next2={activeWindow.upcoming[1]}
        isBeforeFirstLine={activeWindow.isBeforeFirstLine}
        isAfterLastLine={activeWindow.isAfterLastLine}
      />
    </main>
  )
}
