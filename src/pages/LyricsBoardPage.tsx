import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import KaraokeLyrics from '../components/KaraokeLyrics'
import { createLocalLyricSyncTransport, type LyricSongRef, type LyricWindow } from '../../shared/lyrics'
import { useJamzoneLyricSync } from '../../shared/lyrics/useJamzoneLyricSync'
import { supabase } from '../lib/supabase'
import { getJamzoneClockDisplayTimeSeconds, useJamzoneClockState } from '../lib/jamzoneClock'
import { getJamzoneCurrentTimeSeconds, type JamzoneSong } from '../lib/jamzoneBridge'
import { useAuthStore } from '../state/authStore'
import './liveLyricsPages.css'

const LOCAL_LYRIC_SYNC_CHANNEL = 'human-jukebox-live-lyrics'
const JAMZONE_REMOTE_EVENT = 'jamzone-snapshot'
const JAMZONE_REMOTE_CHANNEL_PREFIX = 'jamzone-bridge'
const STAGE_MODE_STORAGE_KEY = 'human-jukebox:lyrics-stage-mode'

function buildSongIdFallback(title: string, artist: string) {
  return `clock:${artist.toLowerCase().replace(/\s+/g, '-')}::${title.toLowerCase().replace(/\s+/g, '-')}`
}

function isPlaceholderSong(song: JamzoneSong | null | undefined) {
  if (!song) {
    return false
  }

  const title = song.title.trim().toLowerCase()
  const artist = song.artist.trim().toLowerCase()
  const id = song.id.trim().toLowerCase()

  return title === 'fallback song'
    || artist === 'fallback artist'
    || id === 'manual-fallback'
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
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(false)
  const [performerModeEnabled, setPerformerModeEnabled] = useState(false)
  const [windowState, setWindowState] = useState<LyricWindow>(emptyWindow)
  const [remoteSong, setRemoteSong] = useState<JamzoneSong | null>(null)
  const [remoteBridgeConnected, setRemoteBridgeConnected] = useState(false)
  const remoteSnapshotRef = useRef<{ currentTimeSeconds: number; updatedAtMs: number }>({
    currentTimeSeconds: 0,
    updatedAtMs: Date.now(),
  })
  const lastPlayPulseRef = useRef(0)
  const transport = useMemo(() => createLocalLyricSyncTransport(LOCAL_LYRIC_SYNC_CHANNEL), [])
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

  const stageModeFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const stageValue = (params.get('stage') ?? '').trim().toLowerCase()
    return stageValue === '1' || stageValue === 'true' || stageValue === 'yes'
  }, [location.search])

  useEffect(() => {
    if (stageModeFromUrl) {
      setPerformerModeEnabled(true)
      return
    }

    const storedValue = window.localStorage.getItem(STAGE_MODE_STORAGE_KEY)
    if (!storedValue) {
      return
    }

    setPerformerModeEnabled(storedValue === '1')
  }, [stageModeFromUrl])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STAGE_MODE_STORAGE_KEY || event.newValue === null) {
        return
      }

      setPerformerModeEnabled(event.newValue === '1')
    }

    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STAGE_MODE_STORAGE_KEY, performerModeEnabled ? '1' : '0')
  }, [performerModeEnabled])

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
  const useRemoteSnapshot = Boolean(syncEventId && !useDurableClock && remoteBridgeConnected && remoteSong)

  const remoteSongRef = useMemo<LyricSongRef | null>(() => {
    const sourceSong = useDurableClock ? durableClockSong : remoteSong
    const activeSong = sourceSong && !isPlaceholderSong(sourceSong)
      ? sourceSong
      : urlSong
    if (!activeSong) {
      return null
    }

    return {
      songId: activeSong.id,
      title: activeSong.title,
      artist: activeSong.artist,
    }
  }, [durableClockSong, remoteSong, urlSong, useDurableClock])

  const { window: remoteLyricWindow, loadError: remoteLyricLoadError, songDurationSeconds } = useJamzoneLyricSync(
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
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tagName = target?.tagName?.toUpperCase()
      if (target?.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
        return
      }

      if (event.key === 'Enter' && !event.repeat) {
        setAutoScrollEnabled((value) => !value)
        return
      }

      if ((event.key === 'f' || event.key === 'F') && !event.repeat) {
        setPerformerModeEnabled((value) => !value)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

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

    const sourceSong = useDurableClock ? durableClockSong : remoteSong
    const activeSong = sourceSong && !isPlaceholderSong(sourceSong)
      ? sourceSong
      : urlSong

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
    <main className="live-lyrics-page live-lyrics-page--board">
      {!performerModeEnabled && syncEventId && !useDurableClock && !remoteBridgeConnected ? (
        <p className="live-lyrics-status live-lyrics-status--pad-lg">
          Waiting for legacy iPad bridge fallback on event {syncEventId}...
        </p>
      ) : null}
      {!performerModeEnabled && syncEventId && useDurableClock ? (
        <p className="live-lyrics-status live-lyrics-status--pad-lg">
          Durable clock active ({durableClockStatus}{durableClockConnected ? ', connected' : ''})
        </p>
      ) : null}
      {!performerModeEnabled && syncEventId && remoteLyricLoadError ? (
        <p className="live-lyrics-warning-text live-lyrics-status--pad-sm">
          LRC file missing for current song. Showing live fallback.
        </p>
      ) : null}
      {!performerModeEnabled ? <p className="live-lyrics-status live-lyrics-status--pad-sm">
        Auto scroll: {autoScrollEnabled ? 'on' : 'off'}{songDurationSeconds ? `, song length ${songDurationSeconds.toFixed(1)}s` : ''}. Press Enter to toggle.
      </p> : null}
      <KaraokeLyrics
        mode="board"
        current={activeWindow.current}
        previous={activeWindow.previous}
        next={activeWindow.next}
        next2={activeWindow.upcoming[1]}
        allLines={activeWindow.allLines}
        currentIndex={activeWindow.currentIndex}
        isBeforeFirstLine={activeWindow.isBeforeFirstLine}
        isAfterLastLine={activeWindow.isAfterLastLine}
        autoScrollEnabled={autoScrollEnabled}
        autoScrollCurrentTimeSeconds={useDurableClock && durableClockSnapshot
          ? getJamzoneClockDisplayTimeSeconds(durableClockSnapshot)
          : (useRemoteSnapshot
            ? remoteSnapshotRef.current.currentTimeSeconds + Math.max(0, (Date.now() - remoteSnapshotRef.current.updatedAtMs) / 1000)
            : getJamzoneCurrentTimeSeconds())}
        autoScrollDurationSeconds={songDurationSeconds}
      />
    </main>
  )
}
