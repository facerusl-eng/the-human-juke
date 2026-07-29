import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useLocation } from 'react-router-dom'
import { LyricMachineView } from '../../../shared/lyric-display'
import { PLAYBACK_STATE_BROADCAST_CHANNEL, PLAYBACK_STATE_EVENT, PLAYBACK_STATE_STORAGE_KEY, readSharedPlaybackState, type SharedPlaybackState } from '../lib/playbackState'
import { isTauriDesktopRuntime } from '../lib/routePath'
import { supabase } from '../lib/supabase'
import { useQueueStore } from '../state/queueStore'

function normalizeSongId(title: string, artist: string) {
  return `${artist.toLowerCase().replace(/\s+/g, '-')}:${title.toLowerCase().replace(/\s+/g, '-')}`
}

export default function LyricMachinePage() {
  const location = useLocation()
  const { event, songs } = useQueueStore()
  const [playbackState, setPlaybackState] = useState<SharedPlaybackState | null>(null)
  const [hasPlaybackStateResolved, setHasPlaybackStateResolved] = useState(false)

  const playbackEventId = useMemo(() => {
    const explicitEventId = event?.id?.trim()
    if (explicitEventId) {
      return explicitEventId
    }

    const params = new URLSearchParams(location.search)
    return (params.get('event') ?? params.get('eventId') ?? '').trim() || null
  }, [event?.id, location.search])

  useEffect(() => {
    if (!isTauriDesktopRuntime()) {
      return
    }

    const tauriWindow = getCurrentWebviewWindow()
    void tauriWindow.setDecorations(true).catch(() => {
      // Ignore decoration sync failures and keep the window usable.
    })

    return () => {
      void tauriWindow.setDecorations(true).catch(() => {
        // Ignore cleanup failures during window teardown.
      })
    }
  }, [])

  const querySong = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const title = (params.get('title') ?? '').trim()
    const artist = (params.get('artist') ?? '').trim()

    if (!title || !artist) {
      return null
    }

    return {
      id: (params.get('songId') ?? '').trim() || normalizeSongId(title, artist),
      title,
      artist,
      album: (params.get('album') ?? '').trim() || null,
      duration: Number(params.get('duration')) || null,
      librarySongId: (params.get('librarySongId') ?? params.get('songId') ?? '').trim() || null,
    }
  }, [location.search])

  const lyricRefreshNonce = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return (params.get('lyricRefresh') ?? '').trim() || null
  }, [location.search])

  useEffect(() => {
    let isCurrent = true
    let syncInFlight = false
    setHasPlaybackStateResolved(false)
    const resolveTimeoutId = window.setTimeout(() => {
      if (isCurrent) {
        setHasPlaybackStateResolved(true)
      }
    }, 2500)

    const syncPlaybackState = async () => {
      if (!playbackEventId) {
        if (isCurrent) {
          setPlaybackState(null)
          setHasPlaybackStateResolved(true)
        }
        return
      }

      if (syncInFlight) {
        return
      }

      syncInFlight = true
      try {
        const nextPlaybackState = await readSharedPlaybackState(playbackEventId)
        if (isCurrent) {
          setPlaybackState(nextPlaybackState)
          setHasPlaybackStateResolved(true)
        }
      } finally {
        syncInFlight = false
      }
    }

    void syncPlaybackState()
    const pollIntervalId = window.setInterval(() => {
      void syncPlaybackState()
    }, 1500)

    const onPlaybackStateEvent = (nextEvent: Event) => {
      const detail = (nextEvent as CustomEvent<{ eventId: string; state: SharedPlaybackState }>).detail
      if (detail?.eventId === playbackEventId) {
        setPlaybackState(detail.state)
        setHasPlaybackStateResolved(true)
      }
    }

    const onStoragePlaybackState = (nextEvent: StorageEvent) => {
      if (nextEvent.key !== PLAYBACK_STATE_STORAGE_KEY || !nextEvent.newValue) {
        return
      }

      try {
        const detail = JSON.parse(nextEvent.newValue) as { eventId?: string; state?: SharedPlaybackState }
        if (detail.eventId === playbackEventId && detail.state) {
          setPlaybackState(detail.state)
          setHasPlaybackStateResolved(true)
        }
      } catch {
        // Ignore malformed cross-tab payloads.
      }
    }

    const playbackBroadcastChannel = typeof window !== 'undefined' && 'BroadcastChannel' in window
      ? new BroadcastChannel(PLAYBACK_STATE_BROADCAST_CHANNEL)
      : null

    if (playbackBroadcastChannel) {
      playbackBroadcastChannel.onmessage = (messageEvent: MessageEvent<{ eventId?: string; state?: SharedPlaybackState }>) => {
        const detail = messageEvent.data
        if (detail?.eventId === playbackEventId && detail.state) {
          setPlaybackState(detail.state)
          setHasPlaybackStateResolved(true)
        }
      }
    }

    window.addEventListener(PLAYBACK_STATE_EVENT, onPlaybackStateEvent as EventListener)
    window.addEventListener('storage', onStoragePlaybackState)

    return () => {
      isCurrent = false
      window.clearTimeout(resolveTimeoutId)
      window.clearInterval(pollIntervalId)
      window.removeEventListener(PLAYBACK_STATE_EVENT, onPlaybackStateEvent as EventListener)
      window.removeEventListener('storage', onStoragePlaybackState)
      playbackBroadcastChannel?.close()
    }
  }, [playbackEventId])

  const nowPlayingSong = useMemo(() => {
    const playbackSongId = playbackState?.currentSongId?.trim() ?? ''
    const playbackSong = playbackSongId
      ? songs.find((song) => song.id === playbackSongId) ?? null
      : null
    const nowPlaying = playbackSong ?? songs[0]

    if (!nowPlaying?.title) {
      return null
    }

    const songMeta = nowPlaying as { album?: string | null; duration?: number | null } | null | undefined
    const artist = (nowPlaying.artist ?? '').trim()
    return {
      id: nowPlaying.library_song_id?.trim() || nowPlaying.id,
      title: nowPlaying.title,
      artist,
      album: songMeta?.album?.trim() || null,
      duration: typeof songMeta?.duration === 'number' && Number.isFinite(songMeta.duration) ? songMeta.duration : null,
      librarySongId: nowPlaying.library_song_id?.trim() || null,
      createdByName: nowPlaying.createdByName,
      audience_sings: nowPlaying.audience_sings,
    }
  }, [playbackState?.currentSongId, songs])

  const shouldHoldForPlaybackSync = Boolean(playbackEventId) && !hasPlaybackStateResolved
  const isQuoteModeActive = playbackState?.isStarted === false
  const hasEventContext = Boolean(playbackEventId)
  const shouldUseQueryFallback = hasEventContext && !nowPlayingSong && !playbackState?.currentSongId
  const activeSong = shouldHoldForPlaybackSync || isQuoteModeActive
    ? null
    : nowPlayingSong ?? (shouldUseQueryFallback || !hasEventContext ? querySong : null)

  const openExternalUrl = async (url: string) => {
    if (!url.trim()) {
      return false
    }

    try {
      await invoke('open_external_url', { url })
      return true
    } catch {
      return false
    }
  }

  return (
    <LyricMachineView
      supabase={supabase}
      activeSong={activeSong}
      eventId={playbackEventId}
      lyricRefreshNonce={lyricRefreshNonce}
      showLogoScreen={shouldHoldForPlaybackSync || isQuoteModeActive || !activeSong}
      returnToPath={location.pathname + location.search}
      onOpenExternalUrl={openExternalUrl}
    />
  )
}
