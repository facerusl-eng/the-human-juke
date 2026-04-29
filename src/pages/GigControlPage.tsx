import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AddSongTabs from '../components/actions/AddSongTabs'
import { ActionButtonGroup, type ActionButtonConfig } from '../components/actions/ActionButtonGroup'
import SpotifyPlayerWithSDK from '../components/SpotifyPlayerWithSDK.jsx'
import { useClipboardCopy } from '../hooks/useClipboardCopy'
import { useGigActions } from '../hooks/useGigActions'
import { getAudienceUrl } from '../lib/audienceUrl'
import { registerBackgroundSync } from '../lib/backgroundSync'
import { captureQueueSnapshot, getLatestQueueSnapshot } from '../lib/queueSnapshots'
import { BETWEEN_SONG_QUOTES, readSharedPlaybackState, writeSharedPlaybackState } from '../lib/playbackState'
import { readFromLocalStorage, saveToLocalStorage } from '../lib/saveHandling'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'

const SPOTIFY_ACCESS_TOKEN_STORAGE_KEY = 'human-jukebox-spotify-access-token'
const SPOTIFY_AUTO_TRANSPORT_STORAGE_KEY = 'human-jukebox-spotify-auto-transport'
const GIG_CONTROL_NOW_PLAYING_STORAGE_KEY = 'human-jukebox-gig-control-now-playing'
const GIG_CONTROL_NOW_PLAYING_MAX_AGE_MS = 12 * 60 * 60 * 1000
const BACKGROUND_SYNC_TAG = 'jukebox-sync'
type SpotifyTransportMode = 'play' | 'pause' | 'toggle'

type PersistedGigControlNowPlaying = {
  eventId: string
  currentSongId: string | null
  isNowPlayingStarted: boolean
  quoteIndex: number
  updatedAt: number
}

function GigControlPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const {
    event,
    hostEvents,
    songs,
    performedSongs,
    loading,
    addSong,
    markPlayed,
    removeSong,
    moveSong,
    reorderSong,
    setActiveEvent,
    toggleRoomOpen,
    toggleExplicitFilter,
    setShowInAudienceNoGig,
  } = useQueueStore()

  const [errorText, setErrorText] = useState<string | null>(null)
  const [isNowPlayingStarted, setIsNowPlayingStarted] = useState(false)
  const [spaceActionBusy, setSpaceActionBusy] = useState(false)
  const [songActionBusyId, setSongActionBusyId] = useState<string | null>(null)
  const [draggedSongId, setDraggedSongId] = useState<string | null>(null)
  const [dragOverSongId, setDragOverSongId] = useState<string | null>(null)
  const [isTouchInput, setIsTouchInput] = useState(false)
  const [betweenSongQuoteIndex, setBetweenSongQuoteIndex] = useState(0)
  const [snapshotStatusText, setSnapshotStatusText] = useState<string | null>(null)
  const [spotifyAccessToken, setSpotifyAccessToken] = useState<string | null>(null)
  const [spotifyStatusText, setSpotifyStatusText] = useState<string | null>(null)
  const [spotifyTransportCommand, setSpotifyTransportCommand] = useState<{ mode: SpotifyTransportMode, nonce: number } | null>(null)
  const [spotifyAutoTransportEnabled, setSpotifyAutoTransportEnabled] = useState(true)
  const [workerHeartbeatText, setWorkerHeartbeatText] = useState<string | null>(null)
  const [activeAudienceCount, setActiveAudienceCount] = useState<number | null>(null)
  const {
    copied: copiedAudienceLink,
    copyError,
    setCopyError,
    copyText,
  } = useClipboardCopy({ successDurationMs: 1400 })
  const gigActions = useGigActions({
    setActiveEvent,
    toggleRoomOpen,
    toggleExplicitFilter,
    setErrorText,
    errors: {
      setActiveEvent: 'Failed to switch gig.',
      toggleRoomOpen: 'Failed to toggle room.',
      toggleExplicitFilter: 'Failed to toggle filter.',
    },
  })

  const quoteIndexRef = useRef(0)
  const lastSpaceActionAtRef = useRef(0)
  const nowPlayingRef = useRef<typeof songs[number] | undefined>(undefined)
  const spaceActionBusyRef = useRef(spaceActionBusy)
  const previousSongIdRef = useRef<string | null>(null)
  const previousRoomOpenRef = useRef<boolean | null>(null)
  const playbackActionLockRef = useRef(false)
  const gigWorkerRef = useRef<Worker | null>(null)

  const nowPlaying = songs[0]
  const upNext = isNowPlayingStarted ? songs.slice(1) : songs
  const upNextStartPosition = isNowPlayingStarted ? 2 : 1
  const queuedLibrarySongIds = useMemo(() => (
    new Set(
      songs
        .map((song) => song.library_song_id)
        .filter((songId): songId is string => Boolean(songId)),
    )
  ), [songs])
  const joinUrl = getAudienceUrl(event?.id)
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(joinUrl)}`
  const betweenSongQuote = BETWEEN_SONG_QUOTES[betweenSongQuoteIndex]

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mediaQuery = window.matchMedia('(pointer: coarse)')
    setIsTouchInput(mediaQuery.matches)

    const onChange = (event: MediaQueryListEvent) => {
      setIsTouchInput(event.matches)
    }

    mediaQuery.addEventListener('change', onChange)
    return () => {
      mediaQuery.removeEventListener('change', onChange)
    }
  }, [])

  const handleQueueDrop = useCallback(async (targetSongId: string) => {
    if (!draggedSongId || draggedSongId === targetSongId || songActionBusyId) {
      return
    }

    const sourceIndex = upNext.findIndex((song) => song.id === draggedSongId)
    const targetIndex = upNext.findIndex((song) => song.id === targetSongId)

    if (sourceIndex === -1 || targetIndex === -1) {
      setDraggedSongId(null)
      setDragOverSongId(null)
      return
    }

    setSongActionBusyId(draggedSongId)

    try {
      const queueStartIndex = isNowPlayingStarted ? 1 : 0
      await reorderSong(draggedSongId, targetIndex + queueStartIndex)
      await registerBackgroundSync(BACKGROUND_SYNC_TAG)
    } catch (error) {
      console.warn('GigControlPage: drag reorder failed', error)
      setErrorText(error instanceof Error ? error.message : 'Failed to reorder queue.')
    } finally {
      setSongActionBusyId(null)
      setDraggedSongId(null)
      setDragOverSongId(null)
    }
  }, [draggedSongId, isNowPlayingStarted, reorderSong, songActionBusyId, upNext])

  const sendSpotifyTransportCommand = useCallback((mode: SpotifyTransportMode) => {
    if (!spotifyAutoTransportEnabled) {
      return
    }

    setSpotifyTransportCommand({ mode, nonce: Date.now() })
  }, [spotifyAutoTransportEnabled])

  useEffect(() => {
    const storedToken = window.localStorage.getItem(SPOTIFY_ACCESS_TOKEN_STORAGE_KEY)
    if (storedToken) {
      setSpotifyAccessToken(storedToken)
    }

    const storedAutoTransport = window.localStorage.getItem(SPOTIFY_AUTO_TRANSPORT_STORAGE_KEY)
    if (storedAutoTransport === '0') {
      setSpotifyAutoTransportEnabled(false)
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(
      SPOTIFY_AUTO_TRANSPORT_STORAGE_KEY,
      spotifyAutoTransportEnabled ? '1' : '0',
    )
  }, [spotifyAutoTransportEnabled])

  const refreshSpotifyAccessToken = useCallback(async () => {
    const response = await fetch('/api/spotify/token')
    const payload = await response.json().catch(() => ({}))

    if (!response.ok || typeof payload.access_token !== 'string') {
      throw new Error(payload.error || 'Spotify token refresh failed.')
    }

    window.localStorage.setItem(SPOTIFY_ACCESS_TOKEN_STORAGE_KEY, payload.access_token)
    setSpotifyAccessToken(payload.access_token)
    return payload.access_token as string
  }, [])

  useEffect(() => {
    if (!spotifyAccessToken) {
      return
    }

    let cancelled = false
    const refreshInterval = window.setInterval(() => {
      void (async () => {
        try {
          const token = await refreshSpotifyAccessToken()

          if (!cancelled) {
            setSpotifyStatusText(`Spotify session refreshed at ${new Date().toLocaleTimeString()}.`)
            setSpotifyAccessToken(token)
          }
        } catch (error) {
          if (!cancelled) {
            setSpotifyStatusText(error instanceof Error ? error.message : 'Spotify refresh failed.')
          }
        }
      })()
    }, 50 * 60 * 1000)

    return () => {
      cancelled = true
      window.clearInterval(refreshInterval)
    }
  }, [refreshSpotifyAccessToken, spotifyAccessToken])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      return
    }

    const worker = new Worker(new URL('../workers/gigWorker.js', import.meta.url), { type: 'module' })
    gigWorkerRef.current = worker

    worker.addEventListener('message', (event: MessageEvent<{ type?: string, tickCount?: number, tag?: string }>) => {
      const message = event.data

      if (message?.type === 'tick') {
        if ((message.tickCount ?? 0) % 10 === 0) {
          setWorkerHeartbeatText(`Background worker active (${message.tickCount}s).`)
        }
        return
      }

      if (message?.type === 'sync-hint') {
        registerBackgroundSync(message.tag || BACKGROUND_SYNC_TAG).catch((error) => {
          console.warn('Failed to register background sync from worker hint', error)
        })
      }
    })

    worker.postMessage({ type: 'start' })

    const onVisibilityChange = () => {
      if (document.hidden) {
        worker.postMessage({ type: 'stop' })
        return
      }

      worker.postMessage({ type: 'start' })
      registerBackgroundSync(BACKGROUND_SYNC_TAG).catch((error) => {
        console.warn('Failed to register background sync on visibility change', error)
      })
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      worker.postMessage({ type: 'stop' })
      worker.terminate()
      gigWorkerRef.current = null
    }
  }, [])

  const copyJoinUrl = async () => {
    const copiedSuccessfully = await copyText(
      joinUrl,
      'Copy failed. You can still select and copy the audience link manually.',
    )

    if (copiedSuccessfully) {
      setErrorText(null)
      setCopyError(null)
    }
  }

  const connectSpotify = useCallback(async () => {
    try {
      const token = await refreshSpotifyAccessToken()
      setSpotifyStatusText(`Spotify connected from saved session at ${new Date().toLocaleTimeString()}.`)
      setSpotifyAccessToken(token)
      return
    } catch {
      window.location.assign('/api/spotify/login')
    }
  }, [refreshSpotifyAccessToken])

  const saveQueueSnapshot = () => {
    if (!event) {
      setSnapshotStatusText('No active gig to snapshot.')
      return
    }

    captureQueueSnapshot({
      eventId: event.id,
      eventName: event.name,
      roomOpen: event.roomOpen,
      explicitFilterEnabled: event.explicitFilterEnabled,
      queue: songs,
      performed: performedSongs,
    })

    setSnapshotStatusText(`Snapshot saved at ${new Date().toLocaleTimeString()}.`)
    registerBackgroundSync(BACKGROUND_SYNC_TAG).catch((error) => {
      console.warn('Failed to register background sync after snapshot save', error)
    })
  }

  const downloadLatestSnapshot = () => {
    if (!event) {
      setSnapshotStatusText('No active gig to export.')
      return
    }

    const latestSnapshot = getLatestQueueSnapshot(event.id)

    if (!latestSnapshot) {
      setSnapshotStatusText('No snapshot found yet. Save one first.')
      return
    }

    try {
      const blob = new Blob([JSON.stringify(latestSnapshot, null, 2)], { type: 'application/json' })
      const objectUrl = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `${event.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-queue-snapshot.json`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      window.URL.revokeObjectURL(objectUrl)
      setSnapshotStatusText('Latest snapshot downloaded.')
    } catch (error) {
      console.warn('GigControlPage: snapshot download failed', error)
      setSnapshotStatusText('Snapshot export failed. Try again.')
    }
  }

  useEffect(() => {
    if (copyError) {
      setErrorText(copyError)
    }
  }, [copyError])

  useEffect(() => {
    if (!event) {
      previousRoomOpenRef.current = null
      return
    }

    const previousRoomOpen = previousRoomOpenRef.current
    const hasJustEnded = previousRoomOpen === true && event.roomOpen === false

    previousRoomOpenRef.current = event.roomOpen

    if (!hasJustEnded || !event.showInAudienceNoGig) {
      return
    }

    const shouldHideFromOfflineAudience = window.confirm(
      'This gig has ended. Do you want to remove it from the offline Audience page?',
    )

    if (!shouldHideFromOfflineAudience) {
      return
    }

    void (async () => {
      try {
        await setShowInAudienceNoGig(false)
      } catch (error) {
        console.warn('GigControlPage: failed to update offline audience visibility after gig end', error)
        setErrorText(error instanceof Error ? error.message : 'Could not update offline audience visibility.')
      }
    })()
  }, [event, setShowInAudienceNoGig])

  // Subscribe to audience presence channel to count active audience members
  useEffect(() => {
    const eventId = event?.id

    if (!eventId) {
      setActiveAudienceCount(null)
      return
    }

    const channel = supabase.channel(`audience-presence:${eventId}`)

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      setActiveAudienceCount(Object.keys(state).length)
    })

    channel.subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [event?.id])

  const resolveCoverUrlForSong = useCallback((songId: string | null) => {
    if (!songId) {
      return null
    }

    return songs.find((song) => song.id === songId)?.cover_url ?? null
  }, [songs])

  useEffect(() => {
    const activeEventId = event?.id

    playbackActionLockRef.current = false
    setSpaceActionBusy(false)

    if (!activeEventId) {
      setIsNowPlayingStarted(false)
      previousSongIdRef.current = null
      return
    }

    let isCurrent = true

    const initializePlaybackState = async () => {
      try {
        const sharedPlaybackState = await readSharedPlaybackState(activeEventId)

        if (!isCurrent) return

        if (!nowPlaying?.id) {
          setIsNowPlayingStarted(false)
          previousSongIdRef.current = null

          await writeSharedPlaybackState(activeEventId, {
            currentSongId: null,
            currentSongCoverUrl: null,
            isStarted: false,
            quoteIndex: sharedPlaybackState?.quoteIndex ?? quoteIndexRef.current,
          })
          return
        }

        if (sharedPlaybackState) {
          const normalizedQuoteIndex = sharedPlaybackState.quoteIndex % BETWEEN_SONG_QUOTES.length
          quoteIndexRef.current = normalizedQuoteIndex
          setBetweenSongQuoteIndex(normalizedQuoteIndex)

          if (sharedPlaybackState.currentSongId === nowPlaying.id) {
            setIsNowPlayingStarted(sharedPlaybackState.isStarted)
            previousSongIdRef.current = nowPlaying.id
            return
          }
        }

        setIsNowPlayingStarted(false)
        await writeSharedPlaybackState(activeEventId, {
          currentSongId: nowPlaying.id,
          currentSongCoverUrl: resolveCoverUrlForSong(nowPlaying.id),
          isStarted: false,
          quoteIndex: quoteIndexRef.current,
        })

        previousSongIdRef.current = nowPlaying.id
      } catch (error) {
        console.warn('GigControlPage: playback initialization failed', error)
        if (isCurrent) {
          setErrorText('Playback controls are reconnecting. Please try again.')
        }
      }
    }

    void initializePlaybackState()

    return () => {
      isCurrent = false
    }
  }, [event?.id, nowPlaying?.id, resolveCoverUrlForSong])

  const setQuoteIndex = (nextQuoteIndex: number) => {
    quoteIndexRef.current = nextQuoteIndex
    setBetweenSongQuoteIndex(nextQuoteIndex)
  }

  useEffect(() => {
    if (!event?.id || !nowPlaying?.id) {
      return
    }

    const snapshot = readFromLocalStorage<PersistedGigControlNowPlaying | null>(
      GIG_CONTROL_NOW_PLAYING_STORAGE_KEY,
      null,
    )

    if (!snapshot || snapshot.eventId !== event.id || snapshot.currentSongId !== nowPlaying.id) {
      return
    }

    const snapshotAge = Date.now() - (snapshot.updatedAt ?? 0)
    if (!Number.isFinite(snapshotAge) || snapshotAge > GIG_CONTROL_NOW_PLAYING_MAX_AGE_MS) {
      return
    }

    const normalizedQuoteIndex = Number.isFinite(snapshot.quoteIndex)
      ? snapshot.quoteIndex % BETWEEN_SONG_QUOTES.length
      : 0

    setQuoteIndex(normalizedQuoteIndex)
    setIsNowPlayingStarted(Boolean(snapshot.isNowPlayingStarted))
  }, [event?.id, nowPlaying?.id])

  useEffect(() => {
    if (!event?.id) {
      return
    }

    saveToLocalStorage(GIG_CONTROL_NOW_PLAYING_STORAGE_KEY, {
      eventId: event.id,
      currentSongId: nowPlaying?.id ?? null,
      isNowPlayingStarted,
      quoteIndex: quoteIndexRef.current,
      updatedAt: Date.now(),
    } satisfies PersistedGigControlNowPlaying)
  }, [event?.id, isNowPlayingStarted, nowPlaying?.id])

  const syncStartedState = useCallback(async (nextStarted: boolean, nextSongId?: string | null) => {
    const targetSongId = nextSongId ?? nowPlaying?.id ?? null
    setIsNowPlayingStarted(nextStarted)

    if (!event?.id) {
      return
    }

    try {
      await writeSharedPlaybackState(event.id, {
        currentSongId: targetSongId,
        currentSongCoverUrl: resolveCoverUrlForSong(targetSongId),
        isStarted: nextStarted,
        quoteIndex: quoteIndexRef.current,
      })
    } catch (error) {
      console.warn('GigControlPage: playback sync write failed', error)
      // Do not block local playback controls if cross-screen sync is temporarily unavailable.
    }
  }, [event, nowPlaying?.id, resolveCoverUrlForSong])

  const beginBetweenSongsTransition = useCallback(async () => {
    const previousQuoteIndex = quoteIndexRef.current
    const nextQuoteIndex = (previousQuoteIndex + 1) % BETWEEN_SONG_QUOTES.length

    setQuoteIndex(nextQuoteIndex)
    await syncStartedState(false, songs[1]?.id ?? null)

    return previousQuoteIndex
  }, [songs, syncStartedState])

  const restoreStartedSong = useCallback(async (previousQuoteIndex: number) => {
    setQuoteIndex(previousQuoteIndex)
    await syncStartedState(true, nowPlaying?.id ?? null)
  }, [nowPlaying?.id, syncStartedState])

  const runPlaybackAction = useCallback(async (
    action: () => Promise<void>,
    options?: { includeTransition?: boolean },
  ) => {
    if (playbackActionLockRef.current) {
      return false
    }

    playbackActionLockRef.current = true
    setSpaceActionBusy(true)

    const includeTransition = options?.includeTransition ?? true
    let previousQuoteIndex = quoteIndexRef.current

    try {
      if (includeTransition) {
        previousQuoteIndex = await beginBetweenSongsTransition()
      }

      await action()
      await registerBackgroundSync(BACKGROUND_SYNC_TAG)
      setErrorText(null)
      return true
    } catch (error) {
      if (includeTransition) {
        try {
          await restoreStartedSong(previousQuoteIndex)
        } catch {
          // Keep controls responsive even if playback-state rollback fails.
        }
      }

      throw error
    } finally {
      playbackActionLockRef.current = false
      setSpaceActionBusy(false)
    }
  }, [beginBetweenSongsTransition, restoreStartedSong])

  const startCurrentSong = useCallback(async () => {
    const started = await runPlaybackAction(async () => {
      await syncStartedState(true)
    }, { includeTransition: false })

    if (started) {
      sendSpotifyTransportCommand('pause')
    }
  }, [runPlaybackAction, sendSpotifyTransportCommand, syncStartedState])

  const runQueueTogglePlayShortcut = useCallback(async () => {
    if (!nowPlaying || playbackActionLockRef.current || spaceActionBusy) {
      return
    }

    if (!isNowPlayingStarted) {
      await startCurrentSong()
      return
    }

    const finishedSong = await runPlaybackAction(async () => {
      await markPlayed()
    })

    if (finishedSong) {
      sendSpotifyTransportCommand('play')
    }
  }, [isNowPlayingStarted, markPlayed, nowPlaying, runPlaybackAction, sendSpotifyTransportCommand, spaceActionBusy, startCurrentSong])

  useEffect(() => {
    nowPlayingRef.current = nowPlaying
  }, [nowPlaying])

  useEffect(() => {
    spaceActionBusyRef.current = spaceActionBusy
  }, [spaceActionBusy])

  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      if (!event.isTrusted || event.defaultPrevented) {
        return
      }

      if (event.code !== 'Space') {
        return
      }

      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return
      }

      if (event.repeat) {
        event.preventDefault()
        return
      }

      const target = event.target as HTMLElement | null
      const activeElement = document.activeElement as HTMLElement | null
      const interactiveTarget = target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="button"], [role="textbox"], [data-spacebar-ignore="true"]')
      const isTypingTarget = Boolean(interactiveTarget || activeElement?.isContentEditable)

      const now = Date.now()
      if (now - lastSpaceActionAtRef.current < 500) {
        event.preventDefault()
        return
      }

      if (isTypingTarget || !nowPlayingRef.current || playbackActionLockRef.current || spaceActionBusyRef.current) {
        return
      }

      event.preventDefault()
      lastSpaceActionAtRef.current = now

      try {
        await runQueueTogglePlayShortcut()
      } catch (error) {
        console.warn('GigControlPage: spacebar playback action failed', error)
        setErrorText('Playback control failed. Please try again.')
      }
    }

    window.addEventListener('keydown', onKeyDown as unknown as EventListener)
    return () => window.removeEventListener('keydown', onKeyDown as unknown as EventListener)
  }, [runQueueTogglePlayShortcut])

  const headerActions: ActionButtonConfig[] = [
    {
      id: 'connect-spotify',
      label: spotifyAccessToken ? 'Reconnect Spotify' : 'Connect Spotify',
      onClick: async () => {
        await connectSpotify()
      },
      variant: spotifyAccessToken ? 'ghost' : 'primary',
    },
    {
      id: 'toggle-room-open',
      label: gigActions.roomToggleBusy ? 'Updating...' : event?.roomOpen ? 'Pause Live' : 'Go Live',
      onClick: async () => {
        await gigActions.runToggleRoomOpen()
      },
      disabled: gigActions.quickActionBusy,
      variant: event?.roomOpen ? 'secondary' : 'primary',
    },
    {
      id: 'toggle-explicit-filter',
      label: gigActions.explicitToggleBusy ? 'Updating...' : event?.explicitFilterEnabled ? 'Allow Explicit' : 'Block Explicit',
      onClick: async () => {
        await gigActions.runToggleExplicitFilter()
      },
      disabled: gigActions.quickActionBusy,
    },
    {
      id: 'open-gig-settings',
      label: 'Gig Settings',
      onClick: () => navigate('/admin/gig-settings'),
      variant: 'ghost',
    },
    {
      id: 'open-mirror-screen',
      label: 'Open Mirror Screen',
      onClick: () => {
        const mirrorUrl = `${window.location.origin}/mirror`
        window.open(mirrorUrl, '_blank', 'noopener,noreferrer')
      },
      variant: 'ghost',
    },
    {
      id: 'toggle-play-shortcut',
      label: 'Toggle Spotify Playlist',
      onClick: () => {
        if (!spotifyAccessToken) {
          setErrorText('Connect Spotify first to use the playlist toggle shortcut.')
          return
        }

        setSpotifyTransportCommand({ mode: 'toggle', nonce: Date.now() })
      },
      disabled: !spotifyAccessToken,
      variant: 'ghost',
    },
  ]

  if (loading) {
    return (
      <section className="gig-control-shell" aria-label="Gig control loading">
        <section className="queue-panel gig-control-loading" role="status" aria-live="polite">
          <p className="eyebrow">Live Control</p>
          <div className="loading-skeleton loading-skeleton-title" aria-hidden="true"></div>
          <div className="loading-skeleton loading-skeleton-line" aria-hidden="true"></div>
          <div className="loading-skeleton loading-skeleton-line loading-skeleton-line-short" aria-hidden="true"></div>
        </section>
      </section>
    )
  }

  if (!event) {
    return (
      <section className="gig-control-shell" aria-label="Gig control">
        <section className="hero-card admin-card">
          <p className="eyebrow">No active gig</p>
          <h1>No Gig Running</h1>
          <p className="subcopy">Create a gig first to start accepting requests.</p>
          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={() => navigate('/admin/create-gig')}>
              Create Gig
            </button>
          </div>
        </section>
      </section>
    )
  }

  return (
    <section className="gig-control-shell" aria-label="Gig control panel">
      {/* Gig header */}
      <section className="gig-control-top-grid">
        <article className="gig-control-header gig-control-main-card">
          <div>
            <p className="gig-control-card-label">Live Control</p>
            {hostEvents.length > 1 ? (
              <div className="gig-switcher">
                <label htmlFor="gig-switcher" className="gig-switcher-label">Choose gig</label>
                <select
                  id="gig-switcher"
                  className="gig-switcher-select"
                  value={event.id}
                  disabled={Boolean(gigActions.activatingEventId)}
                  onChange={async (changeEvent) => {
                    const nextGigId = changeEvent.target.value

                    if (!nextGigId || nextGigId === event.id) {
                      return
                    }

                    await gigActions.switchActiveGig(nextGigId)
                  }}
                >
                  {hostEvents.map((hostEvent) => (
                    <option key={hostEvent.id} value={hostEvent.id}>
                      {hostEvent.name}{hostEvent.venue ? ` - ${hostEvent.venue}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <h1>{event.name}</h1>
            {event.venue ? <p className="subcopy no-margin">{event.venue}</p> : null}
            {event.subtitle ? <p className="subcopy gig-event-subtitle">{event.subtitle}</p> : null}
            <p className="gig-audience-count-badge" aria-live="polite">
              <span className="gig-audience-count-dot" aria-hidden="true" />
              {activeAudienceCount === null
                ? 'Audience online: connecting…'
                : activeAudienceCount === 0
                ? 'No audience members online yet'
                : `${activeAudienceCount} audience member${activeAudienceCount === 1 ? '' : 's'} online`}
            </p>
            <p className="subcopy gig-playback-note">
              Admin playback control is driven from this screen. Press Space to start the current song, then press
              Space again to move into the next quote transition. This applies to the full live queue for this gig,
              across every playlist attached to it.
            </p>
          </div>
          <ActionButtonGroup actions={headerActions} layoutClassName="gig-control-actions gig-control-primary-actions" />
        </article>

        <article className="gig-mirror-preview-card" aria-label="Live mirror preview">
          <p className="gig-control-card-label">Live Mirror Preview</p>
          <div className="gig-mirror-preview-frame" role="img" aria-label="Mirror screen preview">
            <div className="gig-mirror-preview-top">
              <span className="gig-mirror-preview-brand">Human Jukebox</span>
              <span className={`gig-mirror-preview-state ${event.roomOpen ? 'is-live' : 'is-paused'}`}>
                {event.roomOpen ? 'Live' : 'Paused'}
              </span>
            </div>
            {nowPlaying && !isNowPlayingStarted ? (
              <p className="gig-mirror-preview-quote">{betweenSongQuote}</p>
            ) : (
              <>
                <p className="gig-mirror-preview-label">Now Playing</p>
                <div className="gig-mirror-preview-now-playing-row">
                  {nowPlaying?.cover_url ? (
                    <img
                      src={nowPlaying.cover_url}
                      alt={`Cover art for ${nowPlaying.title}`}
                      className="gig-mirror-preview-now-playing-cover"
                    />
                  ) : null}
                  <div>
                    <p className="gig-mirror-preview-song">{nowPlaying?.title ?? 'Waiting for requests...'}</p>
                    <p className="gig-mirror-preview-artist">{nowPlaying?.artist ?? 'No song in queue'}</p>
                  </div>
                </div>
              </>
            )}
            <p className="gig-mirror-preview-label">Up Next</p>
            <ul className="gig-mirror-preview-list">
              {upNext.slice(0, 3).map((song) => (
                <li key={song.id}>
                  <div className="gig-mirror-preview-list-main">
                    {song.cover_url ? (
                      <img
                        src={song.cover_url}
                        alt={`Cover art for ${song.title}`}
                        className="gig-mirror-preview-list-cover"
                      />
                    ) : null}
                    <span>{song.title}</span>
                  </div>
                  <span>+{song.votes_count}</span>
                </li>
              ))}
              {upNext.length === 0 ? <li><span>No songs queued</span><span>+0</span></li> : null}
            </ul>
          </div>
        </article>

        <article className="qr-card gig-control-qr-card" aria-label="Audience join tools">
          <p className="gig-control-card-label">Audience Join QR</p>
          <div className="gig-control-qr-frame">
            <img src={qrUrl} alt="QR code for audience join page" className="qr-image" />
          </div>
          <p className="subcopy">Show this on your mirror screen so guests can scan and join.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={async () => {
              await copyJoinUrl()
            }}
          >
            {copiedAudienceLink ? 'Copied!' : 'Copy Audience Link'}
          </button>
          <div className="hero-actions no-margin-bottom">
            <button type="button" className="secondary-button" onClick={saveQueueSnapshot}>
              Save Queue Snapshot
            </button>
            <button type="button" className="ghost-button" onClick={downloadLatestSnapshot}>
              Download Latest Snapshot
            </button>
          </div>
          {snapshotStatusText ? <p className="subcopy no-margin">{snapshotStatusText}</p> : null}
          {workerHeartbeatText ? <p className="subcopy no-margin">{workerHeartbeatText}</p> : null}
        </article>
      </section>

      <section className="queue-panel gig-manual-add-panel" aria-label="Admin add song controls">
        <div className="panel-head">
          <h2>Add Song To Queue</h2>
          <span className="meta-badge">Playlist + Custom</span>
        </div>
        <AddSongTabs
          eventId={event.id}
          userId={user?.id ?? null}
          addSong={addSong}
          queuedLibrarySongIds={queuedLibrarySongIds}
        />
      </section>

      {spotifyAccessToken ? (
        <>
          <section className="queue-panel" aria-label="Spotify automation setting">
            <div className="panel-head">
              <h2>Spotify Automation</h2>
              <span className="meta-badge">{spotifyAutoTransportEnabled ? 'On' : 'Off'}</span>
            </div>
            <label htmlFor="spotify-auto-transport-toggle" className="gig-switcher-label">
              <input
                id="spotify-auto-transport-toggle"
                type="checkbox"
                checked={spotifyAutoTransportEnabled}
                onChange={(changeEvent) => {
                  setSpotifyAutoTransportEnabled(changeEvent.target.checked)
                }}
              />{' '}
              Auto play between-song Spotify on finish, and auto pause on start
            </label>
          </section>

          <SpotifyPlayerWithSDK
            accessToken={spotifyAccessToken}
            onRefreshToken={refreshSpotifyAccessToken}
            transportCommand={spotifyTransportCommand}
          />
        </>
      ) : (
        <section className="queue-panel" aria-label="Spotify login prompt">
          <div className="panel-head">
            <h2>Spotify Web Playback SDK</h2>
            <span className="meta-badge">Disconnected</span>
          </div>
          <p className="subcopy">Connect Spotify to enable play/pause and track skipping from Gig Control.</p>
          <div className="hero-actions no-margin-bottom">
            <button
              type="button"
              className="primary-button"
              onClick={async () => {
                await connectSpotify()
              }}
            >
              Connect Spotify
            </button>
          </div>
        </section>
      )}

      {spotifyStatusText ? <p className="subcopy no-margin">{spotifyStatusText}</p> : null}

      {/* Now Playing */}
      <section className="gig-now-playing">
        <article className="now-playing-card">
          <p className="eyebrow">Now Playing</p>
          {nowPlaying && isNowPlayingStarted ? (
            <>
              <div className="now-playing-media">
                {nowPlaying.cover_url ? (
                  <img src={nowPlaying.cover_url} alt={`Cover art for ${nowPlaying.title}`} className="song-cover song-cover-large" />
                ) : null}
                <div>
                  <h2>{nowPlaying.title}</h2>
                  <p className="artist">{nowPlaying.artist}</p>
                </div>
              </div>
              <div className="hero-actions gig-now-playing-actions gig-control-touch-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={spaceActionBusy || songActionBusyId === nowPlaying.id}
                  onClick={async () => {
                    if (spaceActionBusy || playbackActionLockRef.current || songActionBusyId === nowPlaying.id) {
                      return
                    }

                    setSongActionBusyId(nowPlaying.id)

                    try {
                      const finishedSong = await runPlaybackAction(async () => {
                        await markPlayed()
                      })

                      if (finishedSong) {
                        sendSpotifyTransportCommand('play')
                      }
                    } catch (error) {
                      console.warn('GigControlPage: mark played failed', error)
                      setErrorText('Failed to mark as played.')
                    } finally {
                      setSongActionBusyId(null)
                    }
                  }}
                >
                  ✓ Mark as Played
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={spaceActionBusy || songActionBusyId === nowPlaying.id}
                  onClick={async () => {
                    if (spaceActionBusy || playbackActionLockRef.current || songActionBusyId === nowPlaying.id) {
                      return
                    }

                    setSongActionBusyId(nowPlaying.id)

                    try {
                      await runPlaybackAction(async () => {
                        await removeSong(nowPlaying.id)
                      })
                    } catch (error) {
                      console.warn('GigControlPage: skip song failed', error)
                      setErrorText('Failed to skip song.')
                    } finally {
                      setSongActionBusyId(null)
                    }
                  }}
                >
                  ✕ Skip
                </button>
              </div>
              <p className="subcopy no-margin">
                Playing now. Press Space again to mark as played.
              </p>
            </>
          ) : nowPlaying ? (
            <>
              <div className="gig-between-songs-state">
                <p className="gig-between-songs-quote">{betweenSongQuote}</p>
                <p className="subcopy gig-between-songs-hint">Tap to start, or press Space.</p>
              </div>
              <div className="hero-actions gig-now-playing-actions gig-control-touch-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={spaceActionBusy}
                  onClick={async () => {
                    if (spaceActionBusy || playbackActionLockRef.current) return
                    try {
                      await startCurrentSong()
                    } catch (error) {
                      console.warn('GigControlPage: start song failed', error)
                      setErrorText('Failed to start song. Please try again.')
                    }
                  }}
                >
                  {spaceActionBusy ? 'Starting…' : '▶ Start Song'}
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>Queue is empty</h2>
              <p className="artist">Waiting for requests from the audience.</p>
            </>
          )}
        </article>
      </section>

      {/* Queue */}
      <section className="queue-panel gig-queue-panel">
        <div className="panel-head">
          <h2>Up Next ({upNext.length} tracks)</h2>
          <span className="meta-badge">{event.roomOpen ? 'Queue Open' : 'Queue Paused'}</span>
        </div>
        {upNext.length === 0 ? (
          <p className="subcopy queue-empty-note">No more songs in queue.</p>
        ) : (
          <>
            <p className="subcopy queue-reorder-note">
              {isTouchInput ? 'Use Move Up / Move Down to reorder.' : 'Drag songs to reorder the queue.'}
            </p>
            <ol className="queue-list gig-control-queue">
            {upNext.map((song, index) => (
              <li
                key={song.id}
                className={`gig-control-row${draggedSongId === song.id ? ' is-dragging' : ''}${dragOverSongId === song.id && draggedSongId !== song.id ? ' is-drop-target' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault()
                  if (!songActionBusyId) {
                    setDragOverSongId(song.id)
                  }
                }}
                onDragLeave={() => {
                  if (dragOverSongId === song.id) {
                    setDragOverSongId(null)
                  }
                }}
                onDrop={async (event) => {
                  event.preventDefault()
                  await handleQueueDrop(song.id)
                }}
              >
                <span
                  className="queue-drag-handle"
                  draggable={!songActionBusyId && !isTouchInput}
                  title="Drag to reorder"
                  onDragStart={(event) => {
                    if (songActionBusyId || isTouchInput) {
                      event.preventDefault()
                      return
                    }

                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', song.id)
                    setDraggedSongId(song.id)
                    setDragOverSongId(song.id)
                  }}
                  onDragEnd={() => {
                    setDraggedSongId(null)
                    setDragOverSongId(null)
                  }}
                  aria-label="Drag handle"
                >
                  ⋮⋮
                </span>
                <span className="queue-pos">{index + upNextStartPosition}</span>
                <div className="gig-song-info">
                  {song.cover_url ? (
                    <img src={song.cover_url} alt={`Cover art for ${song.title}`} className="song-cover" />
                  ) : null}
                  <div>
                    <p className="song">{song.title}</p>
                    <p className="artist">
                      {song.artist}
                      {song.audience_sings ? <span className="karaoke-tag"> · Karaoke</span> : null}
                      {song.is_explicit ? <span className="explicit-tag"> · E</span> : null}
                    </p>
                  </div>
                </div>
                <span className="votes">+{song.votes_count}</span>
                <div className="queue-actions gig-control-row-actions">
                  {isTouchInput ? (
                    <>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={songActionBusyId === song.id || index === 0}
                        onClick={async () => {
                          if (songActionBusyId) {
                            return
                          }

                          setSongActionBusyId(song.id)

                          try {
                            await moveSong(song.id, 'up')
                            await registerBackgroundSync(BACKGROUND_SYNC_TAG)
                          } catch (error) {
                            console.warn('GigControlPage: move song up failed', error)
                            setErrorText(error instanceof Error ? error.message : 'Failed to move song.')
                          } finally {
                            setSongActionBusyId(null)
                          }
                        }}
                      >
                        ↑ Move Up
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={songActionBusyId === song.id || index === upNext.length - 1}
                        onClick={async () => {
                          if (songActionBusyId) {
                            return
                          }

                          setSongActionBusyId(song.id)

                          try {
                            await moveSong(song.id, 'down')
                            await registerBackgroundSync(BACKGROUND_SYNC_TAG)
                          } catch (error) {
                            console.warn('GigControlPage: move song down failed', error)
                            setErrorText(error instanceof Error ? error.message : 'Failed to move song.')
                          } finally {
                            setSongActionBusyId(null)
                          }
                        }}
                      >
                        ↓ Move Down
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="vote-button danger-button"
                    disabled={songActionBusyId === song.id}
                    onClick={async () => {
                      if (songActionBusyId === song.id) {
                        return
                      }

                      setSongActionBusyId(song.id)

                      try {
                        await removeSong(song.id)
                        await registerBackgroundSync(BACKGROUND_SYNC_TAG)
                      } catch {
                        setErrorText('Failed to remove.')
                      } finally {
                        setSongActionBusyId(null)
                      }
                    }}
                  >
                    {songActionBusyId === song.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </li>
            ))}
            </ol>
          </>
        )}
      </section>

      <section className="queue-panel gig-performed-panel" aria-label="Performed songs">
        <div className="panel-head">
          <h2>Performed Songs ({performedSongs.length})</h2>
          <span className="meta-badge">Live set history</span>
        </div>
        {performedSongs.length === 0 ? (
          <p className="subcopy queue-empty-note">Played songs will appear here.</p>
        ) : (
          <ol className="queue-list gig-performed-list">
            {performedSongs.map((song, index) => (
              <li key={`${song.id}-${song.performedAt}`}>
                <span className="queue-pos">{index + 1}</span>
                <div className="gig-song-info">
                  {song.cover_url ? (
                    <img src={song.cover_url} alt={`Cover art for ${song.title}`} className="song-cover" />
                  ) : null}
                  <div>
                    <p className="song">{song.title}</p>
                    <p className="artist">{song.artist}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {errorText ? <p className="error-text gig-control-error-text" role="alert">{errorText}</p> : null}
    </section>
  )
}

export default GigControlPage
