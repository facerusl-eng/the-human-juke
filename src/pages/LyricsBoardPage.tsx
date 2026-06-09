import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import KaraokeLyrics from '../components/KaraokeLyrics'
import { createLocalLyricSyncTransport, type LyricSongRef, type LyricWindow } from '../../shared/lyrics'
import { useJamzoneLyricSync } from '../../shared/lyrics/useJamzoneLyricSync'
import { supabase } from '../lib/supabase'
import { getJamzoneClockDisplayTimeSeconds, useJamzoneClockState } from '../lib/jamzoneClock'
import type { JamzoneSong } from '../lib/jamzoneBridge'
import { useAuthStore } from '../state/authStore'

const LOCAL_LYRIC_SYNC_CHANNEL = 'human-jukebox-live-lyrics'
const JAMZONE_REMOTE_EVENT = 'jamzone-snapshot'
const JAMZONE_REMOTE_CHANNEL_PREFIX = 'jamzone-bridge'

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
  const lastPlayPulseRef = useRef(0)
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

  const useDurableClock = Boolean(syncEventId && durableClockSnapshot)

  const remoteSongRef = useMemo<LyricSongRef | null>(() => {
    const activeSong = useDurableClock ? durableClockSong : remoteSong
    if (!activeSong) {
      return null
    }

    return {
      songId: activeSong.id,
      title: activeSong.title,
      artist: activeSong.artist,
    }
  }, [durableClockSong, remoteSong, useDurableClock])

  const { window: remoteLyricWindow, loadError: remoteLyricLoadError } = useJamzoneLyricSync(
    remoteSongRef,
    () => {
      if (useDurableClock && durableClockSnapshot) {
        return getJamzoneClockDisplayTimeSeconds(durableClockSnapshot)
      }

      const elapsedSeconds = Math.max(0, (Date.now() - remoteSnapshotRef.current.updatedAtMs) / 1000)
      return remoteSnapshotRef.current.currentTimeSeconds + elapsedSeconds
    },
    { updateIntervalMs: 80 },
  )

  useEffect(() => {
    if (!remoteChannelName || useDurableClock) {
      setRemoteBridgeConnected(false)
      return
    }

    const channel = supabase
      .channel(remoteChannelName)
      .on('broadcast', { event: JAMZONE_REMOTE_EVENT }, ({ payload }) => {
        const data = payload as {
          currentTimeSeconds?: number
          currentSong?: JamzoneSong | null
          playPulse?: number
          updatedAtMs?: number
        }

        if (!data || !Number.isFinite(data.currentTimeSeconds)) {
          return
        }

        remoteSnapshotRef.current = {
          currentTimeSeconds: Math.max(0, Number(data.currentTimeSeconds)),
          updatedAtMs: Number.isFinite(data.updatedAtMs) ? Number(data.updatedAtMs) : Date.now(),
        }

        if (Number.isFinite(data.playPulse) && Number(data.playPulse) > lastPlayPulseRef.current) {
          lastPlayPulseRef.current = Number(data.playPulse)
          // Ensure lyrics can move instantly after iPad Play is pressed.
          remoteSnapshotRef.current = {
            currentTimeSeconds: Math.max(0.02, remoteSnapshotRef.current.currentTimeSeconds),
            updatedAtMs: Date.now(),
          }
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
  }, [remoteChannelName, useDurableClock])

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

  const activeWindow = useMemo(() => {
    if (!syncEventId) {
      return windowState
    }

    const activeSong = useDurableClock ? durableClockSong : remoteSong

    if (activeSong && remoteLyricLoadError) {
      if (useDurableClock && durableClockSnapshot) {
        const currentTimeSeconds = getJamzoneClockDisplayTimeSeconds(durableClockSnapshot)
        return buildMissingLyricsFallbackWindow(activeSong, currentTimeSeconds)
      }

      const elapsedSeconds = Math.max(0, (Date.now() - remoteSnapshotRef.current.updatedAtMs) / 1000)
      const currentTimeSeconds = remoteSnapshotRef.current.currentTimeSeconds + elapsedSeconds
      return buildMissingLyricsFallbackWindow(activeSong, currentTimeSeconds)
    }

    return remoteLyricWindow
  }, [durableClockSnapshot, durableClockSong, remoteLyricLoadError, remoteLyricWindow, remoteSong, syncEventId, useDurableClock, windowState])

  return (
    <main style={{ width: '100vw', height: '100vh', background: '#02030a' }}>
      {syncEventId && !useDurableClock && !remoteBridgeConnected ? (
        <p style={{ margin: 0, padding: '0.65rem 1rem', color: '#d4dcff', opacity: 0.84 }}>
          Waiting for legacy iPad bridge fallback on event {syncEventId}...
        </p>
      ) : null}
      {syncEventId && useDurableClock ? (
        <p style={{ margin: 0, padding: '0.65rem 1rem', color: '#d4dcff', opacity: 0.84 }}>
          Durable clock active ({durableClockStatus}{durableClockConnected ? ', connected' : ''})
        </p>
      ) : null}
      {syncEventId && remoteLyricLoadError ? (
        <p style={{ margin: 0, padding: '0.45rem 1rem', color: '#ffd58a', opacity: 0.9 }}>
          LRC file missing for current song. Showing live fallback.
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
