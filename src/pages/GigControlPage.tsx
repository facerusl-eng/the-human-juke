import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AddSongTabs from '../components/actions/AddSongTabs'
import { ActionButtonGroup, type ActionButtonConfig } from '../components/actions/ActionButtonGroup'
import SpotifyPlayerWithSDK from '../components/SpotifyPlayerWithSDK.jsx'
import { useClipboardCopy } from '../hooks/useClipboardCopy'
import { useGigActions } from '../hooks/useGigActions'
import { getAudienceUrl } from '../lib/audienceUrl'
import { openMirrorScreen } from '../lib/openMirrorScreen'
import { registerBackgroundSync } from '../lib/backgroundSync'
import {
  captureQueueSnapshot,
  getLatestQueueSnapshot,
  getQueueSnapshots,
  getQueueSnapshotsFromDatabase,
  restoreQueueSnapshotInDatabase,
  saveQueueSnapshotToDatabase,
} from '../lib/queueSnapshots'
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
const MIRROR_PREVIEW_TRANSITION_MS = 4200
const SPACEBAR_ACTION_COOLDOWN_MS = 300
const DEFAULT_BRB_MESSAGE = 'Briefly offstage negotiating with the sound gremlins and a suspiciously warm pint. Remain splendid.'
const BREAK_TRANSITION_ON_MESSAGE = 'Intermission declared. Keep calm, polish your pint, and pretend this is all deliberate.'
const BREAK_TRANSITION_BACK_MESSAGE = 'We have returned from the interval, mostly intact and vaguely professional.'
type SpotifyTransportMode = 'play' | 'pause' | 'toggle'
type EmergencyOverlayPreset = 'tech-issue' | 'scan-qr' | 'closing-soon'
type MirrorPreviewTransitionTone = 'on-break' | 'back-live'

type PersistedGigControlNowPlaying = {
  eventId: string
  currentSongId: string | null
  isNowPlayingStarted: boolean
  quoteIndex: number
  updatedAt: number
}

type PreflightIssueCode = 'offline' | 'session' | 'database' | 'realtime' | 'shareLinks' | 'keepwarm' | 'unknown'

function parseRequesterNames(rawName: string | null | undefined) {
  if (!rawName) {
    return []
  }

  return Array.from(new Set(
    rawName
      .split(/,|&|\band\b/gi)
      .map((name) => name.trim())
      .filter(Boolean),
  ))
}

function classifyPreflightIssue(error: unknown): PreflightIssueCode {
  const message = error instanceof Error ? error.message.toLowerCase() : ''

  if (message.includes('offline') || message.includes('internet')) {
    return 'offline'
  }

  if (message.includes('session') || message.includes('sign in') || message.includes('host session')) {
    return 'session'
  }

  if (message.includes('database')) {
    return 'database'
  }

  if (message.includes('realtime') || message.includes('channel')) {
    return 'realtime'
  }

  if (message.includes('share link') || message.includes('audience share link')) {
    return 'shareLinks'
  }

  if (message.includes('warm-up') || message.includes('warm up') || message.includes('keep-warm')) {
    return 'keepwarm'
  }

  return 'unknown'
}

function resolveGigStartAt(gigDate: string | null | undefined, gigStartTime: string | null | undefined) {
  if (!gigDate || !gigStartTime) {
    return null
  }

  const normalizedTime = gigStartTime.length === 5 ? `${gigStartTime}:00` : gigStartTime
  const startAt = new Date(`${gigDate}T${normalizedTime}`)
  return Number.isNaN(startAt.getTime()) ? null : startAt
}

function getEmergencyOverlayMessage(preset: EmergencyOverlayPreset) {
  if (preset === 'tech-issue') {
    return 'Technical issue on stage. We will be back in about 2 minutes. Thank you for your patience.'
  }

  if (preset === 'scan-qr') {
    return 'Scan the QR now to join the queue and drop your requests.'
  }

  return 'Last song coming up soon. Get your final request in now!'
}

type MirrorSyncHealthBadgeProps = {
  audienceConnectionStatus: string
  lastMirrorSyncAt: number
}

function MirrorSyncHealthBadge({
  audienceConnectionStatus,
  lastMirrorSyncAt,
}: MirrorSyncHealthBadgeProps) {
  const [healthNow, setHealthNow] = useState<number>(() => Date.now())

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setHealthNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [])

  const secondsSinceMirrorSync = Math.max(0, Math.floor((healthNow - lastMirrorSyncAt) / 1000))
  const mirrorHealthState = audienceConnectionStatus === 'connected'
    ? (secondsSinceMirrorSync <= 20 ? 'ok' : 'delayed')
    : (audienceConnectionStatus === 'reconnecting' || audienceConnectionStatus === 'connecting')
      ? 'reconnecting'
      : 'offline'
  const mirrorHealthLabel = mirrorHealthState === 'ok'
    ? `Sync OK · ${secondsSinceMirrorSync}s ago`
    : mirrorHealthState === 'delayed'
      ? `Sync delayed · ${secondsSinceMirrorSync}s`
      : mirrorHealthState === 'reconnecting'
        ? 'Reconnecting mirror sync...'
        : 'Mirror sync offline'

  return <span className={`gig-mirror-health-badge is-${mirrorHealthState}`}>{mirrorHealthLabel}</span>
}

async function sendSpotifyWebApiTransportCommand(mode: 'play' | 'pause') {
  if (typeof window === 'undefined') {
    return false
  }

  const accessToken = window.localStorage.getItem(SPOTIFY_ACCESS_TOKEN_STORAGE_KEY)?.trim()
  if (!accessToken) {
    return false
  }

  const endpoint = mode === 'pause'
    ? 'https://api.spotify.com/v1/me/player/pause'
    : 'https://api.spotify.com/v1/me/player/play'

  try {
    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    return response.ok
  } catch {
    return false
  }
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
    unmarkPlayed,
    removeSong,
    moveSong,
    reorderSong,
    setActiveEvent,
    toggleRoomOpen,
    toggleExplicitFilter,
    setShowInAudienceNoGig,
    audienceConnectionStatus,
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
  const [snapshotRestoreBusy, setSnapshotRestoreBusy] = useState(false)
  const [spotifyAccessToken, setSpotifyAccessToken] = useState<string | null>(null)
  const [spotifyStatusText, setSpotifyStatusText] = useState<string | null>(null)
  const [spotifyTransportCommand, setSpotifyTransportCommand] = useState<{ mode: SpotifyTransportMode, nonce: number } | null>(null)
  const [spotifyAutoTransportEnabled, setSpotifyAutoTransportEnabled] = useState(true)
  const [workerHeartbeatText, setWorkerHeartbeatText] = useState<string | null>(null)
  const [activeAudienceCount, setActiveAudienceCount] = useState<number | null>(null)
  const [preflightBusy, setPreflightBusy] = useState(false)
  const [preflightStatusText, setPreflightStatusText] = useState<string | null>(null)
  const [lastReadinessVerdict, setLastReadinessVerdict] = useState<'pass' | 'fail' | 'unknown'>(() => {
    try {
      const raw = window.sessionStorage.getItem('human-jukebox-readiness-verdict')
      if (!raw) return 'unknown'
      const parsed = JSON.parse(raw) as { verdict?: string }
      return parsed.verdict === 'pass' ? 'pass' : parsed.verdict === 'fail' ? 'fail' : 'unknown'
    } catch {
      return 'unknown'
    }
  })
  const [gigSummary, setGigSummary] = useState<{ totalPlayed: number; topSong: string | null; startedAt: number } | null>(null)
  const gigStartedAtRef = useRef<number>(Date.now())
  const [isBrbActive, setIsBrbActive] = useState(false)
  const [brbCustomMessage, setBrbCustomMessage] = useState('')
  const [mirrorOverlayUpdateBusy, setMirrorOverlayUpdateBusy] = useState(false)
  const [mirrorPreviewTransitionMessage, setMirrorPreviewTransitionMessage] = useState<string | null>(null)
  const [mirrorPreviewTransitionTone, setMirrorPreviewTransitionTone] = useState<MirrorPreviewTransitionTone>('on-break')
  const [mirrorReadabilityCheckEnabled, setMirrorReadabilityCheckEnabled] = useState(false)
  const [lastMirrorSyncAt, setLastMirrorSyncAt] = useState<number>(() => Date.now())
  const [restoreConfirmPayload, setRestoreConfirmPayload] = useState<{ snapshotId: string; queueCount: number; snapshotCount: number; reason: string; at: string; source: 'database' | 'local' } | null>(null)
  const [showEndGigHideConfirm, setShowEndGigHideConfirm] = useState(false)
  const [autoLiveCountdown, setAutoLiveCountdown] = useState<string | null>(null)
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
  const isNowPlayingStartedRef = useRef(isNowPlayingStarted)
  const nowPlayingRef = useRef<typeof songs[number] | undefined>(undefined)
  const songsRef = useRef(songs)
  const spaceActionBusyRef = useRef(spaceActionBusy)
  const previousSongIdRef = useRef<string | null>(null)
  const previousRoomOpenRef = useRef<boolean | null>(null)
  const playbackActionLockRef = useRef(false)
  const gigWorkerRef = useRef<Worker | null>(null)
  const liveHealthGuardLastRunAtRef = useRef(0)
  const autoLiveAttemptedEventIdRef = useRef<string | null>(null)
  const autoLiveInFlightRef = useRef(false)
  const mirrorPreviewTransitionTimerRef = useRef<number | null>(null)
  const mirrorOverlayBusyRef = useRef(false)
  // Tracks event IDs whose intro audio has already played this page session.
  // Prevents the intro from replaying if the host pauses and re-opens the room.
  const introAudioPlayedEventIdsRef = useRef<Set<string>>(new Set())

  const nowPlaying = songs[0]
  const upNext = isNowPlayingStarted ? songs.slice(1) : songs
  const upNextStartPosition = isNowPlayingStarted ? 2 : 1
  const nextUpSong = upNext[0] ?? null
  const queueEstMinutes = Math.round(upNext.filter((s) => !s.is_removed).length * 3.5)
  const nowPlayingRequesters = parseRequesterNames(nowPlaying?.createdByName)
  const mirrorStateLabel = isBrbActive
    ? 'Mirror showing BRB screen'
    : event?.roomOpen
    ? isNowPlayingStarted
      ? 'Mirror showing live now playing'
      : 'Mirror showing between-song transition'
    : 'Mirror showing paused waiting screen'
  const liveModeLabel = event?.roomOpen
    ? 'Live'
    : isBrbActive
    ? 'Break'
    : 'Paused'
  const activeHostEvent = hostEvents.find((hostEvent) => hostEvent.id === event?.id) ?? null
  const isCurrentTestGig = activeHostEvent?.isTestGig ?? event?.isTestGig ?? false
  const queuedLibrarySongIds = useMemo(() => (
    new Set(
      songs
        .map((song) => song.library_song_id)
        .filter((songId): songId is string => Boolean(songId)),
    )
  ), [songs])
  const joinUrl = isCurrentTestGig
    ? getAudienceUrl(event?.id, { compact: false, mode: 'test' })
    : getAudienceUrl(event?.id, { compact: true })
  const testJoinUrl = getAudienceUrl(event?.id, { compact: false, mode: 'test' })
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(joinUrl)}`
  const betweenSongQuote = BETWEEN_SONG_QUOTES[betweenSongQuoteIndex]
  const signedInEmail = user?.email?.trim() ?? ''

  const resolveCoverUrlForSong = useCallback((songId: string | null) => {
    if (!songId) {
      return null
    }

    return songs.find((song) => song.id === songId)?.cover_url ?? null
  }, [songs])

  useEffect(() => {
    isNowPlayingStartedRef.current = isNowPlayingStarted
  }, [isNowPlayingStarted])

  useEffect(() => {
    if (audienceConnectionStatus === 'connected') {
      setLastMirrorSyncAt(Date.now())
    }
  }, [audienceConnectionStatus])

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
    if (!event || !draggedSongId || draggedSongId === targetSongId || songActionBusyId) {
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
      captureQueueSnapshot({
        eventId: event.id,
        eventName: event.name,
        reason: 'before-reorder',
        roomOpen: event.roomOpen,
        explicitFilterEnabled: event.explicitFilterEnabled,
        queue: songs,
        performed: performedSongs,
      })
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
  }, [draggedSongId, event, isNowPlayingStarted, performedSongs, reorderSong, songActionBusyId, songs, upNext])

  const sendSpotifyTransportCommand = useCallback((mode: SpotifyTransportMode) => {
    if (!spotifyAutoTransportEnabled) {
      return
    }

    setSpotifyTransportCommand({ mode, nonce: Date.now() })
  }, [spotifyAutoTransportEnabled])

  const playIntroAudioWithSpotifyBridge = useCallback(async (introAudioUrl: string) => {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      return
    }

    const introAudio = new Audio(introAudioUrl)
    introAudio.preload = 'auto'

    // Duck Spotify while the intro stinger runs, then restore when it ends.
    sendSpotifyTransportCommand('pause')
    void sendSpotifyWebApiTransportCommand('pause')

    try {
      await introAudio.play()
    } catch (error) {
      sendSpotifyTransportCommand('play')
      void sendSpotifyWebApiTransportCommand('play')
      throw error
    }

    await new Promise<void>((resolve) => {
      const cleanup = () => {
        introAudio.removeEventListener('ended', onEnded)
        introAudio.removeEventListener('error', onError)
      }

      const onEnded = () => {
        cleanup()
        sendSpotifyTransportCommand('play')
        void sendSpotifyWebApiTransportCommand('play')
        resolve()
      }

      const onError = () => {
        cleanup()
        sendSpotifyTransportCommand('play')
        void sendSpotifyWebApiTransportCommand('play')
        resolve()
      }

      introAudio.addEventListener('ended', onEnded, { once: true })
      introAudio.addEventListener('error', onError, { once: true })
    })
  }, [sendSpotifyTransportCommand])

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
        if ((message.tickCount ?? 0) >= 1) {
          setWorkerHeartbeatText('Background worker active.')
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

  // Re-read readiness verdict from sessionStorage when tab becomes visible
  useEffect(() => {
    const onFocus = () => {
      try {
        const raw = window.sessionStorage.getItem('human-jukebox-readiness-verdict')
        if (!raw) return
        const parsed = JSON.parse(raw) as { verdict?: string }
        setLastReadinessVerdict(
          parsed.verdict === 'pass' ? 'pass' : parsed.verdict === 'fail' ? 'fail' : 'unknown',
        )
      } catch {
        // non-critical
      }
    }
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
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

  const copyTestJoinUrl = async () => {
    const copiedSuccessfully = await copyText(
      testJoinUrl,
      'Copy failed. You can still select and copy the test audience link manually.',
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

  const persistReadinessVerdict = useCallback((verdict: 'pass' | 'fail') => {
    setLastReadinessVerdict(verdict)

    try {
      window.sessionStorage.setItem(
        'human-jukebox-readiness-verdict',
        JSON.stringify({ verdict, at: new Date().toLocaleTimeString() }),
      )
    } catch {
      // non-critical
    }
  }, [])

  const runPreflightChecks = useCallback(async () => {
    if (!event) {
      throw new Error('No active gig selected for preflight.')
    }

    if (!navigator.onLine) {
      throw new Error('Device is offline. Connect to the internet before going live.')
    }

    const keepWarmController = new AbortController()
    const keepWarmTimeoutId = window.setTimeout(() => {
      keepWarmController.abort()
    }, 1800)

    const keepWarmPromise = fetch('/api/keepwarm', {
      method: 'GET',
      cache: 'no-store',
      signal: keepWarmController.signal,
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        window.clearTimeout(keepWarmTimeoutId)
      })

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    if (sessionError) {
      throw new Error(`Session check failed: ${sessionError.message}`)
    }
    if (!sessionData.session?.user) {
      throw new Error('No active host session. Please sign in again before going live.')
    }

    const { error: dbReadError } = await supabase
      .from('events')
      .select('id, room_open')
      .eq('id', event.id)
      .single()

    if (dbReadError) {
      throw new Error(`Database read failed: ${dbReadError.message}`)
    }

    const testChannel = supabase.channel(`go-live-preflight-${Date.now()}`)
    const realtimeStatus = await new Promise<string>((resolve) => {
      const timeoutId = window.setTimeout(() => resolve('TIMED_OUT'), 1800)

      testChannel
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'events',
        }, () => {
          // no-op
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            window.clearTimeout(timeoutId)
            resolve(status)
          }
        })
    })

    void supabase.removeChannel(testChannel)

    if (realtimeStatus !== 'SUBSCRIBED') {
      throw new Error(`Realtime subscription failed (${realtimeStatus}).`)
    }

    const nextJoinUrl = event.isTestGig
      ? getAudienceUrl(event.id, { compact: false, mode: 'test' })
      : getAudienceUrl(event.id, { compact: true })
    if (!nextJoinUrl.startsWith('http')) {
      throw new Error('Audience share link could not be generated.')
    }

    const keepWarmOk = await keepWarmPromise
    if (!keepWarmOk) {
      console.warn('GigControlPage: keepwarm preflight did not return OK, continuing with Go Live.')
    }
  }, [event])

  const attemptAutomaticHealthRepair = useCallback(async (issueCode: PreflightIssueCode) => {
    switch (issueCode) {
      case 'offline':
        return {
          fixed: false,
          detail: 'Auto-fix could not continue because this device is offline. Reconnect Wi-Fi or mobile data and try again.',
        }

      case 'session': {
        const { data, error } = await supabase.auth.refreshSession()
        return {
          fixed: Boolean(data.session) && !error,
          detail: error
            ? `Auto-fix could not refresh the host session: ${error.message}`
            : 'Auto-fix refreshed the host session. Retesting now...',
        }
      }

      case 'database':
      case 'keepwarm':
      case 'unknown': {
        await supabase.auth.refreshSession().catch(() => undefined)
        const keepWarmResponse = await fetch('/api/keepwarm', { method: 'GET', cache: 'no-store' }).catch(() => null)

        return {
          fixed: Boolean(keepWarmResponse?.ok),
          detail: keepWarmResponse?.ok
            ? 'Auto-fix warmed the backend and refreshed auth. Retesting now...'
            : 'Auto-fix could not wake the backend automatically. Check connectivity and deployment health.',
        }
      }

      case 'realtime': {
        await supabase.auth.refreshSession().catch(() => undefined)
        const channels = supabase.getChannels()
        await Promise.allSettled(channels.map((channel) => supabase.removeChannel(channel)))

        return {
          fixed: true,
          detail: 'Auto-fix reset live channels and refreshed the session. Retesting now...',
        }
      }

      case 'shareLinks':
        return {
          fixed: Boolean(event?.id),
          detail: event?.id
            ? 'Auto-fix regenerated the audience share link. Retesting now...'
            : 'Auto-fix could not regenerate the audience link because no gig is selected.',
        }
    }
  }, [event?.id])

  const runGoLivePreflight = useCallback(async () => {
    if (!event) {
      throw new Error('No active gig selected for preflight.')
    }

    setPreflightBusy(true)
    setPreflightStatusText('Running preflight checks...')

    try {
      await runPreflightChecks()
      persistReadinessVerdict('pass')
      setPreflightStatusText(`Preflight passed at ${new Date().toLocaleTimeString()}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Preflight failed.'
      const issueCode = classifyPreflightIssue(error)

      setPreflightStatusText(`${message} Auto-fix is checking what it can repair...`)

      const repairResult = await attemptAutomaticHealthRepair(issueCode)

      if (!repairResult.fixed) {
        persistReadinessVerdict('fail')
        const nextError = new Error(`${message} ${repairResult.detail}`)
        setPreflightStatusText(nextError.message)
        throw nextError
      }

      setPreflightStatusText(repairResult.detail)

      try {
        await runPreflightChecks()
        persistReadinessVerdict('pass')
        setPreflightStatusText(`Auto-fix succeeded. Ready at ${new Date().toLocaleTimeString()}.`)
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : 'Preflight failed after auto-fix.'
        persistReadinessVerdict('fail')
        setPreflightStatusText(`Auto-fix ran, but there is still a blocking issue: ${retryMessage}`)
        throw retryError
      }
    } finally {
      setPreflightBusy(false)
    }
  }, [attemptAutomaticHealthRepair, event, persistReadinessVerdict, runPreflightChecks])

  const toggleLiveState = useCallback(async () => {
    try {
      const isOpeningRoom = Boolean(event && !event.roomOpen)

      if (isOpeningRoom) {
        await runGoLivePreflight()
      }

      const toggled = await gigActions.runToggleRoomOpen()

      if (isOpeningRoom && toggled && event?.introAudioUrl && !introAudioPlayedEventIdsRef.current.has(event.id)) {
        introAudioPlayedEventIdsRef.current.add(event.id)
        try {
          await playIntroAudioWithSpotifyBridge(event.introAudioUrl)
        } catch {
          setErrorText('Go Live opened the room, but intro audio was blocked by browser autoplay settings. Spotify transport was restored.')
        }
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Go Live preflight failed.')
    }
  }, [event, gigActions, playIntroAudioWithSpotifyBridge, runGoLivePreflight])

  const showMirrorPreviewTransition = useCallback((message: string, tone: MirrorPreviewTransitionTone) => {
    if (mirrorPreviewTransitionTimerRef.current !== null) {
      window.clearTimeout(mirrorPreviewTransitionTimerRef.current)
      mirrorPreviewTransitionTimerRef.current = null
    }

    setMirrorPreviewTransitionTone(tone)
    setMirrorPreviewTransitionMessage(message)

    mirrorPreviewTransitionTimerRef.current = window.setTimeout(() => {
      setMirrorPreviewTransitionMessage(null)
      mirrorPreviewTransitionTimerRef.current = null
    }, MIRROR_PREVIEW_TRANSITION_MS)
  }, [])

  const setMirrorOverlayMessage = useCallback(async (message: string | null) => {
    if (!event?.id || mirrorOverlayBusyRef.current) {
      return false
    }

    const nextBrbActive = Boolean(message)
    const previousBrbActive = isBrbActive
    const previousBrbMessage = brbCustomMessage
    const resolvedMessage = nextBrbActive ? (message?.trim() || DEFAULT_BRB_MESSAGE) : null

    mirrorOverlayBusyRef.current = true
    setMirrorOverlayUpdateBusy(true)

    setIsBrbActive(nextBrbActive)

    if (resolvedMessage) {
      setBrbCustomMessage(resolvedMessage)
    }

    try {
      const writeSucceeded = await writeSharedPlaybackState(event.id, {
        currentSongId: nowPlaying?.id ?? null,
        currentSongCoverUrl: resolveCoverUrlForSong(nowPlaying?.id ?? null),
        isStarted: isNowPlayingStarted,
        quoteIndex: quoteIndexRef.current,
        brbActive: nextBrbActive,
        brbMessage: resolvedMessage,
      })

      if (!writeSucceeded) {
        throw new Error('Mirror overlay write did not persist.')
      }

      if (nextBrbActive) {
        showMirrorPreviewTransition(resolvedMessage || BREAK_TRANSITION_ON_MESSAGE, 'on-break')
      } else if (previousBrbActive) {
        showMirrorPreviewTransition(BREAK_TRANSITION_BACK_MESSAGE, 'back-live')
      }

      return true
    } catch (error) {
      setIsBrbActive(previousBrbActive)
      setBrbCustomMessage(previousBrbMessage)
      console.warn('GigControlPage: mirror overlay update failed', error)
      setErrorText('Failed to update mirror overlay.')
      return false
    } finally {
      mirrorOverlayBusyRef.current = false
      setMirrorOverlayUpdateBusy(false)
    }
  }, [
    brbCustomMessage,
    event?.id,
    isBrbActive,
    isNowPlayingStarted,
    nowPlaying?.id,
    resolveCoverUrlForSong,
    showMirrorPreviewTransition,
  ])

  const toggleBrbState = useCallback(async () => {
    const nextBrb = !isBrbActive
    await setMirrorOverlayMessage(nextBrb ? (brbCustomMessage.trim() || DEFAULT_BRB_MESSAGE) : null)
  }, [brbCustomMessage, isBrbActive, setMirrorOverlayMessage])

  const triggerEmergencyOverlay = useCallback(async (preset: EmergencyOverlayPreset) => {
    const message = getEmergencyOverlayMessage(preset)
    await setMirrorOverlayMessage(message)
  }, [setMirrorOverlayMessage])

  useEffect(() => {
    return () => {
      if (mirrorPreviewTransitionTimerRef.current !== null) {
        window.clearTimeout(mirrorPreviewTransitionTimerRef.current)
        mirrorPreviewTransitionTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!event?.roomOpen || preflightBusy || audienceConnectionStatus === 'connected') {
      return
    }

    if (!navigator.onLine) {
      setPreflightStatusText('Live health guard detected offline mode. The app will retry auto-fix when the connection returns.')
      return
    }

    const now = Date.now()
    if (now - liveHealthGuardLastRunAtRef.current < 60_000) {
      return
    }

    const timerId = window.setTimeout(() => {
      liveHealthGuardLastRunAtRef.current = Date.now()
      void runGoLivePreflight().catch((error) => {
        setErrorText(error instanceof Error ? `Live health guard: ${error.message}` : 'Live health guard found an issue that could not be repaired automatically.')
      })
    }, audienceConnectionStatus === 'reconnecting' ? 8_000 : 1_500)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [audienceConnectionStatus, event?.roomOpen, preflightBusy, runGoLivePreflight])

  const saveQueueSnapshot = useCallback((reason = 'manual', silent = false) => {
    if (!event) {
      if (!silent) {
        setSnapshotStatusText('No active gig to snapshot.')
      }
      return false
    }

    const snapshotPayload = {
      eventId: event.id,
      eventName: event.name,
      reason,
      roomOpen: event.roomOpen,
      explicitFilterEnabled: event.explicitFilterEnabled,
      queue: songs,
      performed: performedSongs,
    }

    captureQueueSnapshot(snapshotPayload)
    void saveQueueSnapshotToDatabase(snapshotPayload).catch((error) => {
      console.warn('GigControlPage: database snapshot save failed, using local snapshot fallback', error)
    })

    if (!silent) {
      setSnapshotStatusText(`Snapshot saved at ${new Date().toLocaleTimeString()}.`)
    }

    registerBackgroundSync(BACKGROUND_SYNC_TAG).catch((error) => {
      console.warn('Failed to register background sync after snapshot save', error)
    })

    return true
  }, [event, performedSongs, songs])

  const runWithSafetySnapshot = useCallback(async (reason: string, action: () => Promise<void>) => {
    saveQueueSnapshot(reason, true)
    await action()
  }, [saveQueueSnapshot])

  // Keep a stable ref so the 5-minute auto-interval useEffect below doesn't
  // restart every time the queue changes (which would reset the timer).
  const saveQueueSnapshotRef = useRef(saveQueueSnapshot)
  useEffect(() => {
    saveQueueSnapshotRef.current = saveQueueSnapshot
  }, [saveQueueSnapshot])

  const restoreLatestSnapshot = useCallback(async () => {
    if (!event) {
      setSnapshotStatusText('No active gig to restore.')
      return
    }

    let latestSnapshot = null
    let databaseSnapshotAvailable = false

    try {
      const dbSnapshots = await getQueueSnapshotsFromDatabase(event.id, 1)
      latestSnapshot = dbSnapshots[0] ?? null
      databaseSnapshotAvailable = Boolean(latestSnapshot)
    } catch (error) {
      console.warn('GigControlPage: failed to load database snapshots, falling back to local', error)
    }

    if (!latestSnapshot) {
      latestSnapshot = getLatestQueueSnapshot(event.id)
    }

    if (!latestSnapshot) {
      setSnapshotStatusText('No snapshot found yet. Save one first.')
      return
    }

    const snapshotQueueCount = latestSnapshot.queue.length
    const snapshotsForEvent = databaseSnapshotAvailable
      ? await getQueueSnapshotsFromDatabase(event.id, 20).catch(() => [])
      : getQueueSnapshots(event.id)
    const snapshotIndex = Math.max(1, snapshotsForEvent.findIndex((snapshot) => snapshot.id === latestSnapshot.id) + 1)
    setRestoreConfirmPayload({
      snapshotId: latestSnapshot.id,
      queueCount: snapshotQueueCount,
      snapshotCount: snapshotIndex,
      reason: latestSnapshot.reason,
      at: new Date(latestSnapshot.createdAt).toLocaleString(),
      source: databaseSnapshotAvailable ? 'database' : 'local',
    })
  }, [event])

  const confirmRestoreSnapshot = useCallback(async () => {
    if (!restoreConfirmPayload || !event) return
    setRestoreConfirmPayload(null)
    setSnapshotRestoreBusy(true)

    const databaseSnapshotAvailable = restoreConfirmPayload.source === 'database'

    const latestSnapshot = await (async () => {
      try {
        if (databaseSnapshotAvailable) {
          const dbSnapshots = await getQueueSnapshotsFromDatabase(event.id, 1)
          return dbSnapshots[0] ?? null
        }

        return getLatestQueueSnapshot(event.id)
      } catch {
        return getLatestQueueSnapshot(event.id)
      }
    })()

    if (!latestSnapshot) {
      setSnapshotStatusText('Snapshot not found. It may have expired.')
      setSnapshotRestoreBusy(false)
      return
    }

    try {
      saveQueueSnapshot('pre-restore-backup', true)

      if (databaseSnapshotAvailable) {
        const restored = await restoreQueueSnapshotInDatabase(latestSnapshot.id)
        setSnapshotStatusText(`Snapshot restored transactionally. Queue replaced with ${restored.restoredCount} songs.`)
        setSnapshotRestoreBusy(false)
        return
      }

      const { error: clearError } = await supabase
        .from('queue_songs')
        .update({ is_removed: true })
        .eq('event_id', event.id)
        .eq('is_removed', false)

      if (clearError) {
        throw clearError
      }

      const rows = latestSnapshot.queue.map((song, index) => ({
        event_id: event.id,
        title: song.title,
        artist: song.artist,
        votes_count: song.votes_count,
        is_explicit: song.is_explicit,
        voting_locked: song.voting_locked,
        is_removed: false,
        cover_url: song.cover_url,
        library_song_id: song.library_song_id,
        audience_sings: song.audience_sings,
        requester_name: song.createdByName,
        created_by: user?.id ?? null,
        position: index,
      }))

      if (rows.length > 0) {
        const { error: restoreError } = await supabase
          .from('queue_songs')
          .insert(rows)

        if (restoreError) {
          throw restoreError
        }
      }

      if (event.roomOpen !== latestSnapshot.roomOpen) {
        await gigActions.runToggleRoomOpen()
      }

      if (event.explicitFilterEnabled !== latestSnapshot.explicitFilterEnabled) {
        await gigActions.runToggleExplicitFilter()
      }

      setSnapshotStatusText(`Snapshot restored from local backup. Queue replaced with ${latestSnapshot.queue.length} songs.`)
    } catch (error) {
      console.warn('GigControlPage: snapshot restore failed', error)
      setSnapshotStatusText(error instanceof Error ? error.message : 'Snapshot restore failed. Try again.')
    } finally {
      setSnapshotRestoreBusy(false)
    }
  }, [event, gigActions, restoreConfirmPayload, saveQueueSnapshot, user?.id])

  useEffect(() => {
    if (!event?.id) {
      return
    }

    const timerId = window.setInterval(() => {
      saveQueueSnapshotRef.current('auto-interval', true)
    }, 5 * 60 * 1000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [event?.id])

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
    const hasJustOpened = previousRoomOpen === false && event.roomOpen === true
    const hasJustEnded = previousRoomOpen === true && event.roomOpen === false

    if (hasJustOpened) {
      gigStartedAtRef.current = Date.now()
    }

    previousRoomOpenRef.current = event.roomOpen

    if (hasJustEnded) {
      // Show post-gig summary.
      const topSong = performedSongs.length > 0
        ? [...performedSongs].sort((a, b) => b.votes_count - a.votes_count)[0]?.title ?? null
        : null
      setGigSummary({
        totalPlayed: performedSongs.length,
        topSong,
        startedAt: gigStartedAtRef.current,
      })
    }

    if (!hasJustEnded || !event.showInAudienceNoGig) {
      return
    }

    setShowEndGigHideConfirm(true)
  }, [event, performedSongs, setShowInAudienceNoGig])

  useEffect(() => {
    if (!event?.id) {
      autoLiveAttemptedEventIdRef.current = null
      return
    }

    if (!event.autoLiveEnabled || event.roomOpen) {
      autoLiveAttemptedEventIdRef.current = null
    }
  }, [event?.id, event?.autoLiveEnabled, event?.roomOpen])

  useEffect(() => {
    const runAutoLiveCountdownCheck = async () => {
      if (!event?.id || !event.autoLiveEnabled || event.roomOpen || autoLiveInFlightRef.current) {
        return
      }

      const startAt = resolveGigStartAt(event.gigDate, event.gigStartTime)
      if (!startAt || startAt.getTime() > Date.now()) {
        return
      }

      if (autoLiveAttemptedEventIdRef.current === event.id) {
        return
      }

      autoLiveAttemptedEventIdRef.current = event.id
      autoLiveInFlightRef.current = true

      try {
        await runGoLivePreflight().catch(() => {})
        const opened = await gigActions.runToggleRoomOpen()

        if (opened && event.introAudioUrl && !introAudioPlayedEventIdsRef.current.has(event.id)) {
          introAudioPlayedEventIdsRef.current.add(event.id)
          try {
            await playIntroAudioWithSpotifyBridge(event.introAudioUrl)
          } catch {
            setErrorText('Auto Live intro audio was blocked by browser autoplay settings. Spotify transport was restored.')
          }
        }

        if (opened && nowPlaying?.id && !isNowPlayingStarted) {
          await writeSharedPlaybackState(event.id, {
            currentSongId: nowPlaying.id,
            currentSongCoverUrl: nowPlaying.cover_url ?? null,
            isStarted: true,
            quoteIndex: quoteIndexRef.current,
          })
          setIsNowPlayingStarted(true)
          sendSpotifyTransportCommand('pause')
        }

        if (opened) {
          setPreflightStatusText('Auto Live triggered from scheduled countdown.')
        }
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : 'Auto Live failed when countdown ended. Please use Go Live manually.')
      } finally {
        autoLiveInFlightRef.current = false
      }
    }

    void runAutoLiveCountdownCheck()

    const timerId = window.setInterval(() => {
      void runAutoLiveCountdownCheck()
    }, 5000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [
    event?.id,
    event?.autoLiveEnabled,
    event?.roomOpen,
    event?.gigDate,
    event?.gigStartTime,
    event?.introAudioUrl,
    gigActions,
    isNowPlayingStarted,
    nowPlaying?.cover_url,
    nowPlaying?.id,
    playIntroAudioWithSpotifyBridge,
    runGoLivePreflight,
    sendSpotifyTransportCommand,
  ])

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

  // Auto Live countdown display
  useEffect(() => {
    if (!event?.autoLiveEnabled || event.roomOpen) {
      setAutoLiveCountdown(null)
      return
    }

    const startAt = resolveGigStartAt(event.gigDate, event.gigStartTime)
    if (!startAt) {
      setAutoLiveCountdown(null)
      return
    }

    const tick = () => {
      const diffMs = startAt.getTime() - Date.now()
      if (diffMs <= 0) {
        setAutoLiveCountdown('Auto Live triggering...')
        return
      }

      const totalSec = Math.floor(diffMs / 1000)
      const h = Math.floor(totalSec / 3600)
      const m = Math.floor((totalSec % 3600) / 60)
      const s = totalSec % 60
      const parts = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`
      setAutoLiveCountdown(`Auto Live in ${parts}`)
    }

    tick()
    const timerId = window.setInterval(tick, 1000)
    return () => window.clearInterval(timerId)
  }, [event?.autoLiveEnabled, event?.gigDate, event?.gigStartTime, event?.roomOpen])

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
          setIsBrbActive(Boolean(sharedPlaybackState.brbActive))

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
    const nextSongId = songsRef.current[1]?.id ?? null

    setQuoteIndex(nextQuoteIndex)
    await syncStartedState(false, nextSongId)

    return previousQuoteIndex
  }, [syncStartedState])

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
    const currentNowPlaying = nowPlayingRef.current
    const currentlyStarted = isNowPlayingStartedRef.current

    // Rely on the ref-based lock only — spaceActionBusy state can lag by one render
    if (!currentNowPlaying || playbackActionLockRef.current) {
      return
    }

    if (!currentlyStarted) {
      await startCurrentSong()
      return
    }

    const finishedSong = await runPlaybackAction(async () => {
      await runWithSafetySnapshot('before-mark-played', async () => {
        await markPlayed()
      })
    })

    if (finishedSong) {
      sendSpotifyTransportCommand('play')
    }
  }, [markPlayed, runPlaybackAction, runWithSafetySnapshot, sendSpotifyTransportCommand, startCurrentSong])

  useEffect(() => {
    nowPlayingRef.current = nowPlaying
  }, [nowPlaying])

  useEffect(() => {
    songsRef.current = songs
  }, [songs])

  useEffect(() => {
    spaceActionBusyRef.current = spaceActionBusy
  }, [spaceActionBusy])

  // Stable ref to the shortcut so the keydown listener never needs re-registering
  const runQueueTogglePlayShortcutRef = useRef(runQueueTogglePlayShortcut)
  useEffect(() => {
    runQueueTogglePlayShortcutRef.current = runQueueTogglePlayShortcut
  }, [runQueueTogglePlayShortcut])

  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      if (!event.isTrusted || event.defaultPrevented) {
        return
      }

      const isSpaceKey = event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar'
      if (!isSpaceKey) {
        return
      }

      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return
      }

      if (event.repeat) {
        event.preventDefault()
        return
      }

      // Block if a playback action is already running (use ref — always current, no stale closure)
      if (playbackActionLockRef.current || spaceActionBusyRef.current) {
        event.preventDefault()
        return
      }

      const target = event.target as HTMLElement | null
      const activeElement = document.activeElement as HTMLElement | null
      const interactiveTarget = target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [aria-multiline="true"], [data-spacebar-ignore="true"]')
      const isTypingTarget = Boolean(interactiveTarget || activeElement?.isContentEditable)

      if (isTypingTarget) {
        return
      }

      if (!nowPlayingRef.current) {
        return
      }

      const now = Date.now()
      if (now - lastSpaceActionAtRef.current < SPACEBAR_ACTION_COOLDOWN_MS) {
        event.preventDefault()
        return
      }

      event.preventDefault()
      lastSpaceActionAtRef.current = now

      try {
        await runQueueTogglePlayShortcutRef.current()
      } catch (error) {
        console.warn('GigControlPage: spacebar playback action failed', error)
        setErrorText('Playback control failed. Please try again.')
      }
    }

    // Registered once — never torn down and re-added, eliminating the brief gap
    window.addEventListener('keydown', onKeyDown as unknown as EventListener)
    return () => window.removeEventListener('keydown', onKeyDown as unknown as EventListener)
  }, [])

  const headerActions: ActionButtonConfig[] = [
    {
      id: 'connect-spotify',
      label: spotifyAccessToken ? 'Reconnect Spotify' : 'Connect Spotify',
      title: spotifyAccessToken ? 'Reconnect your Spotify account for playback control' : 'Connect Spotify to enable play/pause and track controls',
      onClick: async () => {
        await connectSpotify()
      },
      variant: spotifyAccessToken ? 'ghost' : 'primary',
    },
    {
      id: 'toggle-room-open',
      label: gigActions.roomToggleBusy
        ? 'Updating...'
        : event?.roomOpen
        ? 'Pause Live'
        : lastReadinessVerdict === 'fail'
        ? 'Go Live + Auto Fix'
        : 'Go Live',
      onClick: toggleLiveState,
      title: event?.roomOpen ? 'Pause the live event — the audience will see a waiting screen' : 'Run health checks and open the room so the audience can join',
      disabled: gigActions.quickActionBusy || preflightBusy,
      variant: event?.roomOpen ? 'secondary' : lastReadinessVerdict === 'fail' ? 'secondary' : 'primary',
    },
    {
      id: 'run-warmup',
      label: preflightBusy ? 'Warming up...' : 'Warm Up Now',
      title: 'Run a pre-gig health check and warm up realtime connections before going live',
      onClick: async () => {
        try {
          await runGoLivePreflight()
          setErrorText(null)
        } catch (error) {
          setErrorText(error instanceof Error ? error.message : 'Warm-up check failed.')
        }
      },
      disabled: preflightBusy,
      variant: 'ghost',
    },
    {
      id: 'toggle-explicit-filter',
      label: gigActions.explicitToggleBusy ? 'Updating...' : event?.explicitFilterEnabled ? 'Allow Explicit' : 'Block Explicit',
      title: event?.explicitFilterEnabled ? 'Currently blocking explicit songs — click to allow them' : 'Currently allowing explicit songs — click to block them',
      onClick: async () => {
        await gigActions.runToggleExplicitFilter()
      },
      disabled: gigActions.quickActionBusy,
    },
    {
      id: 'host-readiness',
      label: 'Readiness Check',
      title: 'Open the pre-gig health check page to verify all systems are working',
      onClick: () => navigate('/admin/readiness'),
      variant: 'ghost',
    },
    {
      id: 'brb-toggle',
      label: isBrbActive ? 'Cancel BRB' : 'BRB Screen',
      title: isBrbActive ? 'Cancel BRB — return to the normal live screen' : 'Show a "Be Right Back" screen to the audience while you take a break',
      onClick: toggleBrbState,
      disabled: mirrorOverlayUpdateBusy,
      variant: 'ghost' as const,
    },
    {
      id: 'open-gig-settings',
      label: 'Gig Settings',
      title: 'Edit gig details, playlists, tip links, social links and more',
      onClick: () => navigate('/admin/gig-settings'),
      variant: 'ghost',
    },
    {
      id: 'open-mirror-screen',
      label: 'Open Mirror Screen',
      title: 'Open the audience-facing mirror display in a new window — show this on a TV or projector',
      onClick: () => openMirrorScreen(),
      variant: 'ghost',
    },
    {
      id: 'toggle-play-shortcut',
      label: 'Toggle Spotify Playlist',
      title: 'Play or pause the Spotify between-song playlist',
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
          <p className="subcopy">
            {hostEvents.length === 0
              ? 'No gigs were found for the currently signed-in host account.'
              : 'Could not load a live gig for this account right now.'}
          </p>
          {signedInEmail ? (
            <p className="meta-badge" aria-live="polite">Signed in as {signedInEmail}</p>
          ) : null}
          <p className="subcopy">
            If this is the wrong account, sign out and sign in with the host account that created your gigs.
          </p>
          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={() => navigate('/admin/create-gig')}>
              Create Gig
            </button>
            <button type="button" className="secondary-button" onClick={() => navigate('/admin')}>
              Go to Admin Sign In
            </button>
          </div>
        </section>
      </section>
    )
  }

  return (
    <section className="gig-control-shell" aria-label="Gig control panel">
      {/* Gig header */}
      {showEndGigHideConfirm ? (
        <section className="queue-panel admin-inline-confirm-banner" role="alertdialog" aria-label="Gig ended">
          <p className="subcopy">Gig ended. Remove this gig from the offline Audience page so visitors aren't confused?</p>
          <div className="hero-actions no-margin-bottom">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                void setShowInAudienceNoGig(false).catch((error: unknown) => {
                  setErrorText(error instanceof Error ? error.message : 'Could not update visibility.')
                })
                setShowEndGigHideConfirm(false)
              }}
            >
              Yes, Hide It
            </button>
            <button type="button" className="ghost-button" onClick={() => setShowEndGigHideConfirm(false)}>
              Keep Visible
            </button>
          </div>
        </section>
      ) : null}

      <section className="queue-panel gig-performer-cockpit" aria-label="Performer live cockpit">
        <div className="gig-performer-cockpit-top">
          <p className="gig-control-card-label no-margin-bottom">Performer Live Cockpit</p>
          <div className="gig-performer-status-row" role="status" aria-live="polite">
            <span className={`gig-performer-status-pill ${event.roomOpen ? 'is-live' : 'is-paused'}`}>{liveModeLabel}</span>
            <span className="gig-performer-status-pill is-neutral">{mirrorStateLabel}</span>
            <span className="gig-performer-status-pill is-neutral">Audience {activeAudienceCount ?? 0}</span>
          </div>
        </div>
        <div className="gig-performer-controls">
          <button
            type="button"
            className="primary-button"
            disabled={gigActions.quickActionBusy || preflightBusy}
            onClick={async () => {
              await toggleLiveState()
            }}
          >
            {event.roomOpen ? 'Stop Live Concert' : 'Set Live'}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={mirrorOverlayUpdateBusy}
            onClick={async () => {
              await toggleBrbState()
            }}
          >
            {isBrbActive ? 'Resume From Break' : 'Go on Break'}
          </button>
          <button type="button" className="ghost-button" onClick={() => openMirrorScreen()}>
            Mirror Screen
          </button>
          <button type="button" className="ghost-button" onClick={() => navigate('/admin/gig-settings')}>
            Gig Settings
          </button>
        </div>
      </section>

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
                      {hostEvent.isTestGig ? '[TEST] ' : ''}
                      {hostEvent.name}{hostEvent.venue ? ` - ${hostEvent.venue}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <h1>{event.name}</h1>
            {isCurrentTestGig ? <p className="meta-badge">Test Gig (Private)</p> : null}
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
            {preflightStatusText ? (
              <p className="meta-badge" aria-live="polite">{preflightStatusText}</p>
            ) : null}
            {autoLiveCountdown ? (
              <p className="meta-badge gig-auto-live-countdown" aria-live="polite">⏱ {autoLiveCountdown}</p>
            ) : null}
            {nextUpSong ? (
              <p className="subcopy gig-next-up-hint" aria-live="polite">
                Next up: <strong>{nextUpSong.title}</strong> — {nextUpSong.artist}
                {nextUpSong.createdByName ? ` · requested by ${nextUpSong.createdByName}` : ''}
                {queueEstMinutes > 0 ? ` · ~${queueEstMinutes} min queue` : ''}
              </p>
            ) : null}
            <p className="subcopy gig-playback-note">
              Playback is controlled from this screen. Press Space to start the current song, then Space again to
              move to the quote transition before the next request.
            </p>
          </div>
          <ActionButtonGroup actions={headerActions} layoutClassName="gig-control-actions gig-control-primary-actions" />
          <div className="gig-brb-input-block">
            <label htmlFor="gig-brb-message" className="gig-switcher-label">BRB message (shown on mirror while paused)</label>
            <input
              id="gig-brb-message"
              className="gig-switcher-select"
              value={brbCustomMessage}
              onChange={(changeEvent) => {
                setBrbCustomMessage(changeEvent.target.value)
              }}
              placeholder={DEFAULT_BRB_MESSAGE}
            />
          </div>
        </article>

        <article className="gig-mirror-preview-card" aria-label="Live mirror preview">
          <p className="gig-control-card-label">Live Mirror Preview</p>
          <div className="gig-mirror-preview-toolbar" role="status" aria-live="polite">
            <MirrorSyncHealthBadge
              audienceConnectionStatus={audienceConnectionStatus}
              lastMirrorSyncAt={lastMirrorSyncAt}
            />
            <button
              type="button"
              className={`ghost-button gig-mirror-readability-toggle ${mirrorReadabilityCheckEnabled ? 'is-active' : ''}`}
              onClick={() => {
                setMirrorReadabilityCheckEnabled((currentValue) => !currentValue)
              }}
            >
              {mirrorReadabilityCheckEnabled ? 'Readability Check: On' : 'Readability Check'}
            </button>
          </div>
          <div className="gig-mirror-preview-emergency-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={mirrorOverlayUpdateBusy}
              onClick={() => {
                void triggerEmergencyOverlay('tech-issue')
              }}
            >
              Tech Issue (2m)
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={mirrorOverlayUpdateBusy}
              onClick={() => {
                void triggerEmergencyOverlay('scan-qr')
              }}
            >
              Scan QR Now
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={mirrorOverlayUpdateBusy}
              onClick={() => {
                void triggerEmergencyOverlay('closing-soon')
              }}
            >
              Last Song Soon
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={!isBrbActive || mirrorOverlayUpdateBusy}
              onClick={() => {
                void setMirrorOverlayMessage(null)
              }}
            >
              Clear Overlay
            </button>
          </div>
          <div className="gig-mirror-preview-frame" role="img" aria-label="Mirror screen preview">
            <div className="gig-mirror-preview-scale-shell">
              <div className={`gig-mirror-preview-scale-canvas ${mirrorReadabilityCheckEnabled ? 'is-readability-check' : ''}`}>
                {isBrbActive ? (
                  <div className="gig-mirror-preview-brb-overlay" aria-live="polite" role="status">
                    <p className="gig-mirror-preview-brb-icon" aria-hidden="true">🍺</p>
                    <p className="gig-mirror-preview-brb-heading">On Break</p>
                    <p className="gig-mirror-preview-brb-message">{brbCustomMessage.trim() || DEFAULT_BRB_MESSAGE}</p>
                  </div>
                ) : null}
                {mirrorPreviewTransitionMessage ? (
                  <div className={`gig-mirror-preview-transition-toast is-${mirrorPreviewTransitionTone}`} aria-live="polite" role="status">
                    <p>{mirrorPreviewTransitionMessage}</p>
                  </div>
                ) : null}
                <div className="gig-mirror-preview-top">
                  <div className="gig-mirror-preview-brand-shell">
                    {event.venueLogoUrl ? (
                      <img
                        src={event.venueLogoUrl}
                        alt={`${event.venue || 'Venue'} logo`}
                        className="gig-mirror-preview-venue-logo"
                        onError={(errorEvent) => {
                          errorEvent.currentTarget.style.display = 'none'
                        }}
                      />
                    ) : null}
                    <span className="gig-mirror-preview-brand">Human Jukebox</span>
                  </div>
                  <span className={`gig-mirror-preview-state ${event.roomOpen ? 'is-live' : 'is-paused'}`}>
                    {event.roomOpen ? 'Live' : 'Paused'}
                  </span>
                </div>
                <p className="gig-mirror-preview-label">Now Playing</p>
                <div className="gig-mirror-preview-now-playing-stage">
                  {!isNowPlayingStarted ? (
                    <div className="gig-mirror-preview-quote-shell">
                      <p className="gig-mirror-preview-quote">{betweenSongQuote}</p>
                    </div>
                  ) : (
                    <div className="gig-mirror-preview-now-playing-row">
                      {nowPlaying?.cover_url ? (
                        <img
                          src={nowPlaying.cover_url}
                          alt={`Cover art for ${nowPlaying.title}`}
                          className="gig-mirror-preview-now-playing-cover"
                        />
                      ) : null}
                      <div>
                        <p className="gig-mirror-preview-song">{nowPlaying?.title ?? 'Waiting for requests from brave volunteers...'}</p>
                        <p className="gig-mirror-preview-artist">{nowPlaying?.artist ?? 'Queue currently calm, suspiciously so'}</p>
                        {nowPlaying?.audience_sings ? (
                          <div className="gig-mirror-preview-karafun-block">
                            <span className="gig-mirror-preview-karafun-title">KaraFun Request</span>
                            <span className="gig-mirror-preview-karafun-meta">
                              {nowPlaying?.createdByName ? `Chosen by ${nowPlaying.createdByName}` : 'Chosen from karaoke list'}
                            </span>
                          </div>
                        ) : null}
                        {nowPlaying?.createdByName ? (
                          <span className="gig-mirror-preview-requested-by">
                            <span className="gig-mirror-preview-requested-by-label">Wished by:</span> {nowPlaying.createdByName}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
                <p className="gig-mirror-preview-label">Up Next</p>
                <ul className="gig-mirror-preview-list">
                  {upNext.slice(0, 3).map((song) => {
                    const chosenBy = song.createdByName?.trim() ?? ''

                    return (
                    <li key={song.id}>
                      <div className="gig-mirror-preview-list-main">
                        {song.cover_url ? (
                          <img
                            src={song.cover_url}
                            alt={`Cover art for ${song.title}`}
                            className="gig-mirror-preview-list-cover"
                          />
                        ) : null}
                        <div className="gig-mirror-preview-list-copy">
                          <span className="gig-mirror-preview-list-song">{song.title}</span>
                          <span className="gig-mirror-preview-list-artist">{song.artist || 'Unknown Artist'}</span>
                          {song.audience_sings ? (
                            <div className="gig-mirror-preview-list-karafun-block">
                              <span className="gig-mirror-preview-list-karafun-title">KaraFun Request</span>
                              <span className="gig-mirror-preview-list-karafun-meta">
                                {chosenBy ? `Chosen by ${chosenBy}` : 'Chosen from karaoke list'}
                              </span>
                            </div>
                          ) : null}
                          {chosenBy ? (
                            <span className="gig-mirror-preview-list-chosen-by">
                              <span className="gig-mirror-preview-list-chosen-by-label">Wished by:</span> {chosenBy}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <span>+{song.votes_count}</span>
                    </li>
                    )
                  })}
                  {upNext.length === 0 ? <li><span>No songs queued</span><span>+0</span></li> : null}
                </ul>
              </div>
            </div>
          </div>
        </article>

        <article className="qr-card gig-control-qr-card" aria-label="Audience join tools">
          <p className="gig-control-card-label">{isCurrentTestGig ? 'Test Audience QR' : 'Audience Join QR'}</p>
          <div className="gig-control-qr-frame">
            <img src={qrUrl} alt={isCurrentTestGig ? 'QR code for test audience page' : 'QR code for audience join page'} className="qr-image" />
          </div>
          <p className="subcopy">
            {isCurrentTestGig
              ? 'Private test mode: use this Test Audience page while signed in as host.'
              : 'Show this on your mirror screen so guests can scan and join.'}
          </p>
          <button
            type="button"
            className="secondary-button"
            title={isCurrentTestGig ? 'Copy the test audience link for host preview' : 'Copy the audience join link to share with your guests'}
            onClick={async () => {
              await copyJoinUrl()
            }}
          >
            {copiedAudienceLink ? 'Copied!' : isCurrentTestGig ? 'Copy Test Audience Link' : 'Copy Audience Link'}
          </button>
          <button
            type="button"
            className="ghost-button"
            title="Open the host-only Test Audience page for this gig"
            onClick={() => {
              window.open(testJoinUrl, '_blank', 'noopener,noreferrer')
            }}
          >
            Open Test Audience Page
          </button>
          {!isCurrentTestGig ? (
            <button
              type="button"
              className="ghost-button"
              title="Copy the host-only Test Audience link"
              onClick={async () => {
                await copyTestJoinUrl()
              }}
            >
              Copy Test Audience Link
            </button>
          ) : null}
          <div className="hero-actions no-margin-bottom">
            <button
              type="button"
              className="secondary-button"
              title="Save a backup of the current queue to local storage"
              onClick={() => {
                saveQueueSnapshot()
              }}
            >
              Save Queue Snapshot
            </button>
            <button
              type="button"
              className="primary-button gig-snapshot-restore-button"
              title="Restore the most recent snapshot with a confirmation preview"
              onClick={() => {
                void restoreLatestSnapshot()
              }}
              disabled={snapshotRestoreBusy}
            >
              {snapshotRestoreBusy ? 'Restoring…' : 'Restore Latest Snapshot'}
            </button>
            <button type="button" className="ghost-button" title="Download the last saved queue snapshot as a JSON file" onClick={downloadLatestSnapshot}>
              Download Latest Snapshot
            </button>
          </div>
          {snapshotStatusText ? <p className="subcopy no-margin">{snapshotStatusText}</p> : null}
          {workerHeartbeatText ? <p className="subcopy no-margin">{workerHeartbeatText}</p> : null}
          {restoreConfirmPayload ? (
            <div className="admin-inline-confirm" role="alertdialog" aria-label="Confirm snapshot restore">
              <p className="subcopy">
                Restore snapshot #{restoreConfirmPayload.snapshotCount} from {restoreConfirmPayload.at}?
                {' '}This replaces the current queue ({restoreConfirmPayload.queueCount} songs).
                {restoreConfirmPayload.reason ? ` Reason: ${restoreConfirmPayload.reason}.` : ''}
                {' '}Source: {restoreConfirmPayload.source === 'database' ? 'Database (transactional)' : 'Local backup'}.
              </p>
              <div className="hero-actions no-margin-bottom">
                <button type="button" className="primary-button" onClick={() => { void confirmRestoreSnapshot() }}>
                  Confirm Restore
                </button>
                <button type="button" className="ghost-button" onClick={() => setRestoreConfirmPayload(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </article>
      </section>

      <section className="queue-panel gig-shortcuts-panel" aria-label="Keyboard shortcuts">
        <details>
          <summary className="gig-shortcuts-summary">
            <span>⌨ Keyboard Shortcuts</span>
            <span className="meta-badge">Host cheatsheet</span>
          </summary>
          <ul className="gig-shortcuts-list">
            <li><kbd>Space</kbd> Start song / mark as played</li>
            <li><kbd>←</kbd> Move top song up in queue</li>
            <li><kbd>→</kbd> Move top song down in queue</li>
          </ul>
        </details>
      </section>

      <section className="queue-panel gig-manual-add-panel" aria-label="Admin add song controls">
        <div className="panel-head">
          <h2>Add Song to Queue</h2>
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
            <label htmlFor="spotify-auto-transport-toggle" className="gig-switcher-label gig-spotify-status-label">
              <span className="admin-spotify-status-dot admin-spotify-connected" aria-label="Spotify Connected" />
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
            <span className="meta-badge gig-spotify-status-label">
              <span className="admin-spotify-status-dot admin-spotify-disconnected" aria-hidden="true" />
              Disconnected
            </span>
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
        <article className={`now-playing-card ${isNowPlayingStarted ? 'gig-now-playing-active' : ''}`}>
          <p className="eyebrow">Now Playing</p>
          {queueEstMinutes > 0 ? <p className="subcopy no-margin">~{queueEstMinutes} min queue ahead</p> : null}
          {nowPlaying && isNowPlayingStarted ? (
            <>
              <div className="now-playing-media">
                {nowPlaying.cover_url ? (
                  <img src={nowPlaying.cover_url} alt={`Cover art for ${nowPlaying.title}`} className="song-cover song-cover-large" />
                ) : null}
                <div>
                  <h2>{nowPlaying.title}</h2>
                  <p className="artist">{nowPlaying.artist}</p>
                  <div className="gig-song-flag-row">
                    {nowPlaying.audience_sings ? <span className="karaoke-tag">Karaoke</span> : <span className="gig-live-mode-tag">Live Request</span>}
                    {nowPlaying.is_explicit ? <span className="explicit-tag">E</span> : null}
                  </div>
                  {nowPlayingRequesters.length > 0 ? (
                    <div className="gig-requester-chip-row" aria-label="Song requesters">
                      <span className="gig-requester-label">Wished by</span>
                      {nowPlayingRequesters.map((requesterName) => (
                        <span key={requesterName} className="gig-requester-chip">{requesterName}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="hero-actions gig-now-playing-actions gig-control-touch-actions">
                <button
                  type="button"
                  className="primary-button"
                  title="Mark this song as played and move to the next one (Space)"
                  disabled={spaceActionBusy || songActionBusyId === nowPlaying.id}
                  onClick={async () => {
                    if (spaceActionBusy || playbackActionLockRef.current || songActionBusyId === nowPlaying.id) {
                      return
                    }

                    setSongActionBusyId(nowPlaying.id)

                    try {
                      const finishedSong = await runPlaybackAction(async () => {
                        await runWithSafetySnapshot('before-mark-played', async () => {
                          await markPlayed()
                        })
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
                  title="Remove this song from the queue without marking it as played"
                  disabled={spaceActionBusy || songActionBusyId === nowPlaying.id}
                  onClick={async () => {
                    if (spaceActionBusy || playbackActionLockRef.current || songActionBusyId === nowPlaying.id) {
                      return
                    }

                    setSongActionBusyId(nowPlaying.id)

                    try {
                      await runPlaybackAction(async () => {
                        await runWithSafetySnapshot('before-remove-song', async () => {
                          await removeSong(nowPlaying.id)
                        })
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
                  title="Mark this song as started — it will show as now playing on the mirror screen (Space)"
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
              <p className="artist">Waiting for requests from the audience, ideally with excellent taste and mild chaos.</p>
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
                    <p className="artist">{song.artist}</p>
                    <div className="gig-song-flag-row">
                      {song.audience_sings ? <span className="karaoke-tag">Karaoke Wish</span> : <span className="gig-live-mode-tag">Live Request</span>}
                      {song.is_explicit ? <span className="explicit-tag">E</span> : null}
                    </div>
                    {song.createdByName ? (
                      <div className="gig-requester-chip-row">
                        <span className="gig-requester-label">Wished by</span>
                        {parseRequesterNames(song.createdByName).map((requesterName) => (
                          <span key={`${song.id}-${requesterName}`} className="gig-requester-chip">{requesterName}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <span className="votes">+{song.votes_count}</span>
                <div className="queue-actions gig-control-row-actions">
                  {isTouchInput ? (
                    <>
                      <button
                        type="button"
                        className="secondary-button"
                        title="Move this song up in the queue"
                        disabled={songActionBusyId === song.id || index === 0}
                        onClick={async () => {
                          if (songActionBusyId) {
                            return
                          }

                          setSongActionBusyId(song.id)

                          try {
                            await runWithSafetySnapshot('before-move-song-up', async () => {
                              await moveSong(song.id, 'up')
                            })
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
                        title="Move this song down in the queue"
                        disabled={songActionBusyId === song.id || index === upNext.length - 1}
                        onClick={async () => {
                          if (songActionBusyId) {
                            return
                          }

                          setSongActionBusyId(song.id)

                          try {
                            await runWithSafetySnapshot('before-move-song-down', async () => {
                              await moveSong(song.id, 'down')
                            })
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
                    title="Remove this song from the queue"
                    disabled={songActionBusyId === song.id}
                    onClick={async () => {
                      if (songActionBusyId === song.id) {
                        return
                      }

                      setSongActionBusyId(song.id)

                      try {
                        await runWithSafetySnapshot('before-remove-song', async () => {
                          await removeSong(song.id)
                        })
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
                <button
                  type="button"
                  className="ghost-button gig-undo-played-button"
                  title="Undo — move back to queue"
                  aria-label={`Undo mark played for ${song.title}`}
                  disabled={Boolean(songActionBusyId)}
                  onClick={async () => {
                    if (songActionBusyId) return
                    setSongActionBusyId(song.id)
                    try {
                      await unmarkPlayed(song.id)
                    } catch (err) {
                      console.warn('GigControlPage: unmark played failed', err)
                      setErrorText('Failed to undo mark played.')
                    } finally {
                      setSongActionBusyId(null)
                    }
                  }}
                >
                  ↩ Undo
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      {errorText ? <p className="error-text gig-control-error-text" role="alert">{errorText}</p> : null}

      {gigSummary ? (
        <div className="gig-summary-modal-overlay" role="dialog" aria-modal="true" aria-label="Gig summary">
          <div className="gig-summary-modal">
            <h2 className="gig-summary-title">🎤 Gig Wrapped</h2>
            <p className="gig-summary-stat">
              <span className="gig-summary-label">Songs played</span>
              <span className="gig-summary-value">{gigSummary.totalPlayed}</span>
            </p>
            {gigSummary.topSong ? (
              <p className="gig-summary-stat">
                <span className="gig-summary-label">Top requested</span>
                <span className="gig-summary-value">{gigSummary.topSong}</span>
              </p>
            ) : null}
            <p className="gig-summary-stat">
              <span className="gig-summary-label">Gig duration</span>
              <span className="gig-summary-value">
                {(() => {
                  const mins = Math.round((Date.now() - gigSummary.startedAt) / 60_000)
                  return mins >= 60
                    ? `${Math.floor(mins / 60)}h ${mins % 60}m`
                    : `${mins} min`
                })()}
              </span>
            </p>
            <button
              type="button"
              className="primary-button gig-summary-close"
              onClick={() => setGigSummary(null)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default GigControlPage
