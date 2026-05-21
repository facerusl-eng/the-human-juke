import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
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
import { BETWEEN_SONG_QUOTES, LAST_SONG_SOON_OVERLAY_MESSAGE, isLastSongSoonOverlayMessage, readSharedPlaybackState, writeSharedPlaybackState } from '../lib/playbackState'

import { readFromLocalStorage, saveToLocalStorage } from '../lib/saveHandling'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'
import {
  INTRO_AUDIO_LOCK_STORAGE_KEY,
  INTRO_AUDIO_LOCK_TTL_MS,
  SPOTIFY_ACCESS_TOKEN_STORAGE_KEY,
  SPOTIFY_AUTO_TRANSPORT_STORAGE_KEY,
  GIG_CONTROL_AUTO_REDIRECT_SECONDS,
  GIG_CONTROL_LOADING_RECOVERY_MS,
  GIG_CONTROL_NOW_PLAYING_STORAGE_KEY,
  GIG_CONTROL_NOW_PLAYING_MAX_AGE_MS,
  ROOM_STATE_ENSURE_MAX_ATTEMPTS,
  ROOM_STATE_ENSURE_RETRY_DELAY_MS,
  MIRROR_PREVIEW_TRANSITION_MS,
  SPACEBAR_ACTION_COOLDOWN_MS,
  MIRROR_LAUNCH_STATUS_DURATION_MS,
  AUTO_LIVE_RETRY_DELAY_MS,
  BACKGROUND_SYNC_TAG,
} from '../lib/constants'
// ...existing code...
// ...existing code...
const DEFAULT_BRB_MESSAGE = 'I am briefly offstage negotiating with the sound gremlins and a suspiciously warm pint. Stay splendid.'
const BREAK_TRANSITION_BACK_MESSAGE = 'I have returned from the interval, mostly intact and vaguely professional.'
const BRB_MESSAGE_DICE_OPTIONS = [
  'Quick break in progress. Keep your requests coming and I will be right back.',
  'Bar check and sound check in one mission. Stay fabulous, I am back shortly.',
  'Intermission mode: I am refilling my pint and rebooting my dance energy. Back in a minute.',
  'Tiny backstage reset. Queue your songs and I will return before the next dramatic chorus.',
  'I am stretching, hydrating, and pretending to be professional. Right back.',
  'Break time. Scan the QR, claim your anthem, and I will be back before your crisps get lonely.',
]

// ...existing code...
type SpotifyTransportMode = 'play' | 'pause' | 'toggle' | 'next' | 'previous'
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

type IntroAudioPlayLock = {
  eventId: string
  ownerId: string
  expiresAt: number
}

type PrimedIntroAudio = {
  eventId: string
  url: string
  element: HTMLAudioElement
}

function readIntroAudioPlayLock(eventId: string | null): IntroAudioPlayLock | null {
  if (typeof window === 'undefined' || !eventId) {
    return null
  }

  try {
    const raw = window.localStorage.getItem(INTRO_AUDIO_LOCK_STORAGE_KEY)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<IntroAudioPlayLock>
    const hasValidOwner = typeof parsed.ownerId === 'string' && parsed.ownerId.trim().length > 0
    const hasValidExpiry = typeof parsed.expiresAt === 'number' && Number.isFinite(parsed.expiresAt)

    if (parsed.eventId !== eventId || !hasValidOwner || !hasValidExpiry) {
      return null
    }

    if ((parsed.expiresAt as number) <= Date.now()) {
      return null
    }

    return {
      eventId,
      ownerId: parsed.ownerId as string,
      expiresAt: parsed.expiresAt as number,
    }
  } catch {
    return null
  }
}

function acquireIntroAudioPlayLock(eventId: string): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const now = Date.now()
  const ownerId = `${eventId}:${now}:${Math.random().toString(36).slice(2)}`

  try {
    const existingRaw = window.localStorage.getItem(INTRO_AUDIO_LOCK_STORAGE_KEY)

    if (existingRaw) {
      const existingLock = JSON.parse(existingRaw) as Partial<IntroAudioPlayLock>
      const sameEvent = existingLock.eventId === eventId
      const stillValid = typeof existingLock.expiresAt === 'number' && existingLock.expiresAt > now

      if (sameEvent && stillValid) {
        return null
      }
    }

    const nextLock: IntroAudioPlayLock = {
      eventId,
      ownerId,
      expiresAt: now + INTRO_AUDIO_LOCK_TTL_MS,
    }

    window.localStorage.setItem(INTRO_AUDIO_LOCK_STORAGE_KEY, JSON.stringify(nextLock))

    const confirmationRaw = window.localStorage.getItem(INTRO_AUDIO_LOCK_STORAGE_KEY)
    if (!confirmationRaw) {
      return null
    }

    const confirmation = JSON.parse(confirmationRaw) as Partial<IntroAudioPlayLock>
    return confirmation.ownerId === ownerId && confirmation.eventId === eventId ? ownerId : null
  } catch {
    return ownerId
  }
}

function releaseIntroAudioPlayLock(eventId: string, ownerId: string) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const existingRaw = window.localStorage.getItem(INTRO_AUDIO_LOCK_STORAGE_KEY)
    if (!existingRaw) {
      return
    }

    const existingLock = JSON.parse(existingRaw) as Partial<IntroAudioPlayLock>
    if (existingLock.eventId === eventId && existingLock.ownerId === ownerId) {
      window.localStorage.removeItem(INTRO_AUDIO_LOCK_STORAGE_KEY)
    }
  } catch {
    // Best-effort lock release only.
  }
}

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

function getSetlistBucketLabel(songTitle: string) {
  const firstChar = songTitle.trim().charAt(0).toUpperCase()

  if (!firstChar) {
    return 'A-E'
  }

  if (/[0-9]/.test(firstChar)) {
    return '0-9'
  }

  if (firstChar >= 'A' && firstChar <= 'E') {
    return 'A-E'
  }

  if (firstChar >= 'F' && firstChar <= 'J') {
    return 'F-J'
  }

  if (firstChar >= 'K' && firstChar <= 'O') {
    return 'K-O'
  }

  if (firstChar >= 'P' && firstChar <= 'T') {
    return 'P-T'
  }

  return 'U-Z'
}

function classifyPreflightIssue(): PreflightIssueCode {
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

async function fetchServerClockOffsetMs(): Promise<number | null> {
  if (typeof window === 'undefined') {
    return null
  }

  const requestStartedAt = Date.now()

  try {
    const response = await fetch(`/api/keepwarm?clock-sync=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
    })

    if (!response.ok) {
      return null
    }

    const requestEndedAt = Date.now()
    const serverDateHeader = response.headers.get('date')

    if (!serverDateHeader) {
      return null
    }

    const serverNowMs = Date.parse(serverDateHeader)

    if (!Number.isFinite(serverNowMs)) {
      return null
    }

    const estimatedClientNowMs = Math.round((requestStartedAt + requestEndedAt) / 2)
    return serverNowMs - estimatedClientNowMs
  } catch {
    return null
  }
}

function getEmergencyOverlayMessage(preset: EmergencyOverlayPreset) {
  if (preset === 'tech-issue') {
    return 'Technical issue on stage. We will be back in about 2 minutes. Thank you for your patience.'
  }

  if (preset === 'scan-qr') {
    return 'Scan the QR now to join the queue and drop your requests.'
  }

  return LAST_SONG_SOON_OVERLAY_MESSAGE
}

function pickRandomBreakMessage(previousMessage: string | null | undefined) {
  const normalizedPrevious = previousMessage?.trim().toLowerCase() || ''
  const candidates = BRB_MESSAGE_DICE_OPTIONS.filter((message) => message.trim().toLowerCase() !== normalizedPrevious)
  const pool = candidates.length > 0 ? candidates : BRB_MESSAGE_DICE_OPTIONS
  return pool[Math.floor(Math.random() * pool.length)] ?? DEFAULT_BRB_MESSAGE
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
  const location = useLocation()
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
    setRoomOpen,
    toggleRoomOpen,
    toggleExplicitFilter,
    deleteEvent,
    forceFallbackMode,
    audienceConnectionStatus,
    queueOperatingMode,
    queueHealthMessage,
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
  const [isFinalSongSoonActive, setIsFinalSongSoonActive] = useState(false)
  const [brbCustomMessage, setBrbCustomMessage] = useState('')
  const [mirrorOverlayUpdateBusy, setMirrorOverlayUpdateBusy] = useState(false)
  const [mirrorPreviewTransitionMessage, setMirrorPreviewTransitionMessage] = useState<string | null>(null)
  const [mirrorPreviewTransitionTone, setMirrorPreviewTransitionTone] = useState<MirrorPreviewTransitionTone>('on-break')
  const [mirrorReadabilityCheckEnabled, setMirrorReadabilityCheckEnabled] = useState(false)
  const [lastMirrorSyncAt, setLastMirrorSyncAt] = useState<number>(() => Date.now())
  const [mirrorLaunchStatusText, setMirrorLaunchStatusText] = useState<string | null>(null)
  const [restoreConfirmPayload, setRestoreConfirmPayload] = useState<{ snapshotId: string; queueCount: number; snapshotCount: number; reason: string; at: string; source: 'database' | 'local' } | null>(null)
  const [endGigPromptEvent, setEndGigPromptEvent] = useState<{ id: string; name: string } | null>(null)
  const [endGigDecisionBusy, setEndGigDecisionBusy] = useState<'keep-offline' | 'delete' | null>(null)
  const [autoLiveCountdown, setAutoLiveCountdown] = useState<string | null>(null)
  const [autoLiveLastError, setAutoLiveLastError] = useState<string | null>(null)
  const [autoLiveLockBadgeText, setAutoLiveLockBadgeText] = useState<string | null>(null)
  const [hostClockOffsetMs, setHostClockOffsetMs] = useState(0)
  const [showLoadingRecovery, setShowLoadingRecovery] = useState(false)
  const [autoRedirectCountdown, setAutoRedirectCountdown] = useState<number | null>(null)
  const [autoRedirectCancelled, setAutoRedirectCancelled] = useState(false)
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
  const autoLiveNextRetryAtRef = useRef(0)
  const autoLiveInFlightRef = useRef(false)
  const hostClockOffsetRef = useRef(0)
  const introAudioLockOwnerRef = useRef<string | null>(null)
  const primedIntroAudioRef = useRef<PrimedIntroAudio | null>(null)
  const mirrorPreviewTransitionTimerRef = useRef<number | null>(null)
  const mirrorLaunchStatusTimerRef = useRef<number | null>(null)
  const mirrorOverlayBusyRef = useRef(false)
  const eventRef = useRef(event)
    const getHostNowMs = useCallback(() => Date.now() + hostClockOffsetRef.current, [])

    useEffect(() => {
      hostClockOffsetRef.current = hostClockOffsetMs
    }, [hostClockOffsetMs])

    useEffect(() => {
      let isCurrent = true

      const syncClockOffset = async () => {
        const nextOffsetMs = await fetchServerClockOffsetMs()

        if (!isCurrent || nextOffsetMs === null) {
          return
        }

        hostClockOffsetRef.current = nextOffsetMs
        setHostClockOffsetMs(nextOffsetMs)
      }

      void syncClockOffset()

      const timerId = window.setInterval(() => {
        void syncClockOffset()
      }, 120_000)

      return () => {
        isCurrent = false
        window.clearInterval(timerId)
      }
    }, [])

  // Tracks event IDs whose intro audio has already played this page session.
  // Prevents the intro from replaying if the host pauses and re-opens the room.
  const introAudioPlayedEventIdsRef = useRef<Set<string>>(new Set())

  const nowPlaying = songs[0]
  const nowPlayingSetlistBucket = useMemo(() => {
    if (!nowPlaying?.title) {
      return 'A-E'
    }

    return getSetlistBucketLabel(nowPlaying.title)
  }, [nowPlaying?.title])
  const setlistBucketHintText = useMemo(() => {
    if (!nowPlaying?.title) {
      return 'Setlist bucket: waiting for queue-head song.'
    }

    const normalizedTitle = nowPlaying.title.trim() || nowPlaying.title
    return `Setlist bucket: ${nowPlayingSetlistBucket} - ${normalizedTitle}`
  }, [nowPlaying?.title, nowPlayingSetlistBucket])
  const upNext = isNowPlayingStarted ? songs.slice(1) : songs
  const upNextStartPosition = isNowPlayingStarted ? 2 : 1
  const mirrorPreviewUpNext = useMemo(() => {
    const candidateSongs = songs.slice(1)

    return [...candidateSongs].sort((songA, songB) => {
      if (songB.votes_count !== songA.votes_count) {
        return songB.votes_count - songA.votes_count
      }

      const positionA = typeof songA.position === 'number' ? songA.position : Number.MAX_SAFE_INTEGER
      const positionB = typeof songB.position === 'number' ? songB.position : Number.MAX_SAFE_INTEGER
      return positionA - positionB
    })
  }, [songs])
  const nextUpSong = upNext[0] ?? null
  const queueEstMinutes = Math.round(upNext.filter((s) => !s.is_removed).length * 3.5)
  const queueAheadMinutesHintText = useMemo(() => {
    if (queueEstMinutes <= 0) {
      return 'Queue ahead: 0 min'
    }

    return `Queue ahead: ~${queueEstMinutes} min`
  }, [queueEstMinutes])
  const nowPlayingRequesters = parseRequesterNames(nowPlaying?.createdByName)
  const gigStartAt = resolveGigStartAt(event?.gigDate ?? null, event?.gigStartTime ?? null)
  const isBeforeScheduledStart = Boolean(!event?.roomOpen && gigStartAt && gigStartAt.getTime() > getHostNowMs())
  const mirrorStateLabel = isBrbActive
    ? 'Mirror showing BRB screen'
    : event?.roomOpen
    ? isNowPlayingStarted
      ? 'Mirror showing live now playing'
      : 'Mirror showing between-song transition'
    : isBeforeScheduledStart
    ? 'Mirror showing pre-show waiting screen'
    : 'Mirror showing paused waiting screen'
  const liveModeLabel = event?.roomOpen
    ? 'Live'
    : isBrbActive
    ? 'Break'
    : isBeforeScheduledStart
    ? 'Starting Soon'
    : 'Paused'
  const queueModeLabel = event?.roomOpen
    ? 'Queue Open'
    : isBeforeScheduledStart
    ? 'Queue Opens Soon'
    : 'Queue Paused'
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
  const isGigLoadFailureState = queueOperatingMode === 'degraded' || Boolean(queueHealthMessage)
  const isFocusedGigControlWindow = useMemo(() => {
    const searchParams = new URLSearchParams(location.search)
    return searchParams.get('view') === 'focus'
  }, [location.search])
  const shouldAutoEnterFullscreenInFocusWindow = useMemo(() => {
    const searchParams = new URLSearchParams(location.search)
    return searchParams.get('fullscreen') === '1'
  }, [location.search])
  const shouldShowErrorText = useMemo(() => {
    if (!errorText) {
      return false
    }

    if (isFocusedGigControlWindow) {
      return false
    }

    return true
  }, [errorText, isFocusedGigControlWindow])
  const focusCriticalErrorText = useMemo(() => {
    if (!isFocusedGigControlWindow || !errorText) {
      return null
    }

    const normalizedError = errorText.toLowerCase()
    if (normalizedError.includes('fullscreen')) {
      return null
    }

    const isCriticalError = /(failed|offline|timeout|degraded|reconnect|unavailable|issue|error|health guard|blocked)/i.test(normalizedError)
    return isCriticalError ? errorText : null
  }, [errorText, isFocusedGigControlWindow])

  useEffect(() => {
    if (!isFocusedGigControlWindow || !shouldAutoEnterFullscreenInFocusWindow) {
      return
    }

    if (typeof document === 'undefined' || !document.documentElement.requestFullscreen) {
      return
    }

    if (document.fullscreenElement) {
      return
    }

    const timerId = window.setTimeout(() => {
      void document.documentElement.requestFullscreen().catch(() => {
        // Ignore blocked auto-fullscreen attempts in focus mode.
      })
    }, 120)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [isFocusedGigControlWindow, shouldAutoEnterFullscreenInFocusWindow])

  useEffect(() => {
    if (typeof window === 'undefined' || !event?.id) {
      setAutoLiveLockBadgeText(null)
      introAudioLockOwnerRef.current = null
      return
    }

    const refreshAutoLiveLockBadge = () => {
      const lock = readIntroAudioPlayLock(event.id)

      if (!lock) {
        setAutoLiveLockBadgeText(null)
        return
      }

      const remainingSeconds = Math.max(1, Math.ceil((lock.expiresAt - Date.now()) / 1000))
      const isOwnedByCurrentTab = introAudioLockOwnerRef.current === lock.ownerId

      setAutoLiveLockBadgeText(
        isOwnedByCurrentTab
          ? `Auto Live lock: this tab (${remainingSeconds}s)`
          : `Auto Live lock active in another host tab (${remainingSeconds}s)`,
      )
    }

    refreshAutoLiveLockBadge()

    const timerId = window.setInterval(refreshAutoLiveLockBadge, 1000)
    const onStorageUpdate = (storageEvent: StorageEvent) => {
      if (storageEvent.key === INTRO_AUDIO_LOCK_STORAGE_KEY) {
        refreshAutoLiveLockBadge()
      }
    }

    window.addEventListener('storage', onStorageUpdate)

    return () => {
      window.clearInterval(timerId)
      window.removeEventListener('storage', onStorageUpdate)
    }
  }, [event?.id])

  useEffect(() => {
    const shouldAutoRedirect = !loading && !event && isGigLoadFailureState && !autoRedirectCancelled

    if (!shouldAutoRedirect) {
      setAutoRedirectCountdown(null)
      return
    }

    setAutoRedirectCountdown(GIG_CONTROL_AUTO_REDIRECT_SECONDS)

    const intervalId = window.setInterval(() => {
      setAutoRedirectCountdown((currentCount) => {
        if (currentCount === null) {
          return currentCount
        }

        if (currentCount <= 1) {
          window.clearInterval(intervalId)
          navigate('/admin/gigs')
          return 0
        }

        return currentCount - 1
      })
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [autoRedirectCancelled, event, isGigLoadFailureState, loading, navigate])

  useEffect(() => {
    if (!loading && !event && isGigLoadFailureState) {
      return
    }

    setAutoRedirectCancelled(false)
  }, [event, isGigLoadFailureState, loading])

  useEffect(() => {
    if (!loading) {
      setShowLoadingRecovery(false)
      return
    }

    const timerId = window.setTimeout(() => {
      setShowLoadingRecovery(true)
    }, GIG_CONTROL_LOADING_RECOVERY_MS)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [loading])

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

  const sendManualSpotifyTransportCommand = useCallback((mode: SpotifyTransportMode) => {
    if (!spotifyAccessToken) {
      setErrorText('Connect Spotify first to use Spotify transport controls.')
      return
    }

    if (mode === 'play') {
      setSpotifyStatusText('Sending Spotify play command...')
    } else if (mode === 'next') {
      setSpotifyStatusText('Sending Spotify next command...')
    } else if (mode === 'previous') {
      setSpotifyStatusText('Sending Spotify previous command...')
    }

    setSpotifyTransportCommand({ mode, nonce: Date.now() })
  }, [spotifyAccessToken])

  const primeIntroAudioPlayback = useCallback((eventId: string, introAudioUrl: string) => {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      return
    }

    const existingPrimedIntro = primedIntroAudioRef.current
    if (existingPrimedIntro && existingPrimedIntro.eventId === eventId && existingPrimedIntro.url === introAudioUrl) {
      return
    }

    const primedElement = new Audio(introAudioUrl)
    primedElement.preload = 'auto'
    primedElement.muted = true

    // Prime playback inside the user gesture so later play() can succeed
    // even after async preflight and network operations complete.
    void primedElement.play()
      .then(() => {
        primedElement.pause()
        primedElement.currentTime = 0
      })
      .catch(() => {
        // Best-effort priming only.
      })

    primedIntroAudioRef.current = {
      eventId,
      url: introAudioUrl,
      element: primedElement,
    }
  }, [])

  const playIntroAudioWithSpotifyBridge = useCallback(async (introAudioUrl: string, primedAudioElement?: HTMLAudioElement | null) => {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      return
    }

    const introAudio = primedAudioElement ?? new Audio(introAudioUrl)
    introAudio.muted = false
    introAudio.volume = 1
    introAudio.currentTime = 0
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
      const issueCode = classifyPreflightIssue()

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

  const ensureRoomOpenState = useCallback(async (targetRoomOpen: boolean) => {
    const wait = (ms: number) => new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms)
    })

    for (let attempt = 1; attempt <= ROOM_STATE_ENSURE_MAX_ATTEMPTS; attempt += 1) {
      const currentEvent = eventRef.current
      if (!currentEvent?.id) {
        throw new Error('No active gig selected.')
      }

      if (currentEvent.roomOpen === targetRoomOpen) {
        return true
      }

      await setRoomOpen(targetRoomOpen)
      await wait(220)

      const latestEvent = eventRef.current
      if (latestEvent?.id === currentEvent.id && latestEvent.roomOpen === targetRoomOpen) {
        return true
      }

      if (attempt < ROOM_STATE_ENSURE_MAX_ATTEMPTS) {
        await wait(ROOM_STATE_ENSURE_RETRY_DELAY_MS * attempt)
      }
    }

    throw new Error(
      targetRoomOpen
        ? 'Could not open room after multiple retries. Please check connection and try again.'
        : 'Could not end gig after multiple retries. Please check connection and try again.',
    )
  }, [setRoomOpen])

  const playIntroAudioOnceSafely = useCallback(async (
    eventId: string,
    introAudioUrl: string,
    autoplayBlockedMessage: string,
    primedAudioElement?: HTMLAudioElement | null,
  ) => {
    if (introAudioPlayedEventIdsRef.current.has(eventId)) {
      return
    }

    const introAudioLockOwner = acquireIntroAudioPlayLock(eventId)
    if (!introAudioLockOwner) {
      return
    }

    introAudioLockOwnerRef.current = introAudioLockOwner

    try {
      await playIntroAudioWithSpotifyBridge(introAudioUrl, primedAudioElement)
      introAudioPlayedEventIdsRef.current.add(eventId)
    } catch {
      setErrorText(autoplayBlockedMessage)
    } finally {
      releaseIntroAudioPlayLock(eventId, introAudioLockOwner)
      if (introAudioLockOwnerRef.current === introAudioLockOwner) {
        introAudioLockOwnerRef.current = null
      }
    }
  }, [playIntroAudioWithSpotifyBridge])

  const toggleLiveState = useCallback(async () => {
    const currentEvent = eventRef.current
    if (!currentEvent?.id) {
      setErrorText('No active gig selected.')
      return
    }

    const isOpeningRoom = !currentEvent.roomOpen

    try {
      if (isOpeningRoom) {
        if (currentEvent.introAudioUrl) {
          primeIntroAudioPlayback(currentEvent.id, currentEvent.introAudioUrl)
        }

        setAutoLiveLastError(null)
        await runGoLivePreflight()
      } else {
        setEndGigPromptEvent({
          id: currentEvent.id,
          name: currentEvent.name,
        })
        return
      }

      await ensureRoomOpenState(isOpeningRoom)
      setAutoLiveLastError(null)

      const latestEvent = eventRef.current
      if (!isOpeningRoom || !latestEvent?.id || latestEvent.id !== currentEvent.id) {
        return
      }

      if (latestEvent.introAudioUrl) {
        const primedIntroAudio = primedIntroAudioRef.current
        const primedElement =
          primedIntroAudio
          && primedIntroAudio.eventId === latestEvent.id
          && primedIntroAudio.url === latestEvent.introAudioUrl
            ? primedIntroAudio.element
            : null

        await playIntroAudioOnceSafely(
          latestEvent.id,
          latestEvent.introAudioUrl,
          'Go Live opened the room, but intro audio was blocked by browser autoplay settings. Spotify transport was restored.',
          primedElement,
        )
      }
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? error.message
          : isOpeningRoom
          ? 'Go Live preflight failed.'
          : 'Could not end gig. Please try again.',
      )
    }
  }, [ensureRoomOpenState, playIntroAudioOnceSafely, primeIntroAudioPlayback, runGoLivePreflight])

  const runEndGigDecision = useCallback(async (decision: 'keep-offline' | 'delete') => {
    const targetEvent = endGigPromptEvent ?? eventRef.current

    if (!targetEvent?.id) {
      setErrorText('No active gig selected.')
      setEndGigPromptEvent(null)
      return
    }

    setErrorText(null)
    setEndGigDecisionBusy(decision)

    try {
      await ensureRoomOpenState(false)

      if (decision === 'delete') {
        await deleteEvent(targetEvent.id)
      }

      setAutoLiveLastError(null)
      setEndGigPromptEvent(null)
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? error.message
          : decision === 'delete'
          ? 'Could not delete gig. Please try again.'
          : 'Could not end gig. Please try again.',
      )
    } finally {
      setEndGigDecisionBusy(null)
    }
  }, [deleteEvent, endGigPromptEvent, ensureRoomOpenState])

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

    const normalizedMessage = message?.trim() ?? ''
    const nextFinalSongSoonActive = isLastSongSoonOverlayMessage(normalizedMessage)
    const nextBrbActive = Boolean(normalizedMessage) && !nextFinalSongSoonActive
    const previousBrbActive = isBrbActive
    const previousFinalSongSoonActive = isFinalSongSoonActive
    const previousBrbMessage = brbCustomMessage
    const resolvedMessage = normalizedMessage || null

    mirrorOverlayBusyRef.current = true
    setMirrorOverlayUpdateBusy(true)

    setIsBrbActive(nextBrbActive)
    setIsFinalSongSoonActive(nextFinalSongSoonActive)

    if (resolvedMessage && nextBrbActive) {
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

      if (!nextBrbActive && previousBrbActive) {
        showMirrorPreviewTransition(BREAK_TRANSITION_BACK_MESSAGE, 'back-live')
      }

      return true
    } catch (error) {
      setIsBrbActive(previousBrbActive)
      setIsFinalSongSoonActive(previousFinalSongSoonActive)
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
    isFinalSongSoonActive,
    isNowPlayingStarted,
    nowPlaying?.id,
    resolveCoverUrlForSong,
    showMirrorPreviewTransition,
  ])

  const toggleLastSongSoonState = useCallback(async () => {
    await setMirrorOverlayMessage(isFinalSongSoonActive ? null : LAST_SONG_SOON_OVERLAY_MESSAGE)
  }, [isFinalSongSoonActive, setMirrorOverlayMessage])

  const toggleBrbState = useCallback(async () => {
    const nextBrb = !isBrbActive
    await setMirrorOverlayMessage(nextBrb ? (brbCustomMessage.trim() || DEFAULT_BRB_MESSAGE) : null)
  }, [brbCustomMessage, isBrbActive, setMirrorOverlayMessage])

  const rollBreakMessage = useCallback(async () => {
    const nextMessage = pickRandomBreakMessage(brbCustomMessage)
    setBrbCustomMessage(nextMessage)

    if (isBrbActive) {
      await setMirrorOverlayMessage(nextMessage)
    }
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
        await setRoomOpen(latestSnapshot.roomOpen)
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
  }, [event, gigActions, restoreConfirmPayload, saveQueueSnapshot, setRoomOpen, user?.id])

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
    eventRef.current = event
  }, [event])

  useEffect(() => {
    return () => {
      if (mirrorLaunchStatusTimerRef.current) {
        window.clearTimeout(mirrorLaunchStatusTimerRef.current)
      }
    }
  }, [])

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
      introAudioPlayedEventIdsRef.current.delete(event.id)
      if (primedIntroAudioRef.current?.eventId === event.id) {
        primedIntroAudioRef.current = null
      }

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
  }, [event, performedSongs])

  useEffect(() => {
    if (!event?.id || !event.autoLiveEnabled) {
      autoLiveAttemptedEventIdRef.current = null
      autoLiveNextRetryAtRef.current = 0
      setAutoLiveLastError(null)
      return
    }
  }, [event?.id, event?.autoLiveEnabled])

  useEffect(() => {
    if (!event?.id || !event.autoLiveEnabled || !event.roomOpen) {
      return
    }

    const startAt = resolveGigStartAt(event.gigDate, event.gigStartTime)
    if (!startAt || startAt.getTime() > getHostNowMs()) {
      return
    }

    const scheduleKey = `${event.id}|${event.gigDate ?? ''}|${event.gigStartTime ?? ''}`
    autoLiveAttemptedEventIdRef.current = scheduleKey
    autoLiveNextRetryAtRef.current = 0
    setAutoLiveLastError(null)
  }, [event?.id, event?.autoLiveEnabled, event?.gigDate, event?.gigStartTime, event?.roomOpen, getHostNowMs])

  useEffect(() => {
    const runAutoLiveCountdownCheck = async () => {
      if (!event?.id || !event.autoLiveEnabled || event.roomOpen || autoLiveInFlightRef.current) {
        return
      }

      const nowMs = getHostNowMs()

      if (autoLiveNextRetryAtRef.current > nowMs) {
        return
      }

      const startAt = resolveGigStartAt(event.gigDate, event.gigStartTime)
      if (!startAt || startAt.getTime() > nowMs) {
        return
      }

      const scheduleKey = `${event.id}|${event.gigDate ?? ''}|${event.gigStartTime ?? ''}`
      if (autoLiveAttemptedEventIdRef.current === scheduleKey) {
        return
      }

      autoLiveInFlightRef.current = true

      try {
        await runGoLivePreflight().catch(() => {})
        await ensureRoomOpenState(true)

        const latestEvent = eventRef.current
        if (!latestEvent?.id || latestEvent.id !== event.id) {
          return
        }

        if (!latestEvent.roomOpen) {
          throw new Error('Auto Live could not confirm that the room opened. Retrying shortly.')
        }

        autoLiveAttemptedEventIdRef.current = scheduleKey
        autoLiveNextRetryAtRef.current = 0
        setAutoLiveLastError(null)

        if (latestEvent.introAudioUrl) {
          await playIntroAudioOnceSafely(
            latestEvent.id,
            latestEvent.introAudioUrl,
            'Auto Live intro audio was blocked by browser autoplay settings. Spotify transport was restored.',
          )
        }

        if (nowPlaying?.id && !isNowPlayingStarted) {
          await writeSharedPlaybackState(event.id, {
            currentSongId: nowPlaying.id,
            currentSongCoverUrl: nowPlaying.cover_url ?? null,
            isStarted: true,
            quoteIndex: quoteIndexRef.current,
          })
          setIsNowPlayingStarted(true)
          sendSpotifyTransportCommand('pause')
        }

        setPreflightStatusText('Auto Live triggered from scheduled countdown.')
      } catch (error) {
        autoLiveNextRetryAtRef.current = getHostNowMs() + AUTO_LIVE_RETRY_DELAY_MS
        const message = error instanceof Error ? error.message : 'Auto Live failed when countdown ended. Please use Go Live manually.'
        setAutoLiveLastError(message)
        setErrorText(message)
      } finally {
        autoLiveInFlightRef.current = false
      }
    }

    void runAutoLiveCountdownCheck()

    const timerId = window.setInterval(() => {
      void runAutoLiveCountdownCheck()
    }, 1000)

    const onHostWindowResume = () => {
      if (!document.hidden) {
        void runAutoLiveCountdownCheck()
      }
    }

    document.addEventListener('visibilitychange', onHostWindowResume)
    window.addEventListener('focus', onHostWindowResume)

    return () => {
      window.clearInterval(timerId)
      document.removeEventListener('visibilitychange', onHostWindowResume)
      window.removeEventListener('focus', onHostWindowResume)
    }
  }, [
    event?.id,
    event?.autoLiveEnabled,
    event?.roomOpen,
    event?.gigDate,
    event?.gigStartTime,
    event?.introAudioUrl,
    ensureRoomOpenState,
    getHostNowMs,
    isNowPlayingStarted,
    nowPlaying?.cover_url,
    nowPlaying?.id,
    playIntroAudioOnceSafely,
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

    const scheduleKey = `${event.id ?? ''}|${event.gigDate ?? ''}|${event.gigStartTime ?? ''}`
    if (autoLiveAttemptedEventIdRef.current === scheduleKey) {
      setAutoLiveCountdown(null)
      return
    }

    const startAt = resolveGigStartAt(event.gigDate, event.gigStartTime)
    if (!startAt) {
      setAutoLiveCountdown(null)
      return
    }

    let rafId: number | null = null
    const tick = () => {
      const nowMs = getHostNowMs()
      const diffMs = startAt.getTime() - nowMs
      if (diffMs <= 0) {
        if (autoLiveInFlightRef.current) {
          setAutoLiveCountdown('Auto Live triggering...')
          return
        }
        if (autoLiveNextRetryAtRef.current > nowMs) {
          const retryInSeconds = Math.max(1, Math.ceil((autoLiveNextRetryAtRef.current - nowMs) / 1000))
          setAutoLiveCountdown(`Auto Live retry in ${retryInSeconds}s`)
          return
        }
        setAutoLiveCountdown('Auto Live triggering...')
        return
      }
      const totalSec = Math.floor(diffMs / 1000)
      const h = Math.floor(totalSec / 3600)
      const m = Math.floor((totalSec % 3600) / 60)
      const s = totalSec % 60
      const parts = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`
      setAutoLiveCountdown(`Auto Live in ${parts}`)
      rafId = window.requestAnimationFrame(tick)
    }
    tick()
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId)
    }
  }, [event?.id, event?.autoLiveEnabled, event?.gigDate, event?.gigStartTime, event?.roomOpen, getHostNowMs])

  useEffect(() => {
    const activeEventId = event?.id

    playbackActionLockRef.current = false
    setSpaceActionBusy(false)

    if (!activeEventId) {
      setIsNowPlayingStarted(false)
      setIsFinalSongSoonActive(false)
      previousSongIdRef.current = null
      return
    }

    let isCurrent = true

    const initializePlaybackState = async () => {
      try {
        const sharedPlaybackState = await readSharedPlaybackState(activeEventId)

        if (!isCurrent) return

        if (!nowPlaying?.id) {
          setIsBrbActive(Boolean(sharedPlaybackState?.brbActive))
          setIsFinalSongSoonActive(isLastSongSoonOverlayMessage(sharedPlaybackState?.brbMessage))

          if (sharedPlaybackState?.brbActive && typeof sharedPlaybackState.brbMessage === 'string') {
            setBrbCustomMessage(sharedPlaybackState.brbMessage)
          }

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
          setIsFinalSongSoonActive(isLastSongSoonOverlayMessage(sharedPlaybackState.brbMessage))

          if (sharedPlaybackState.brbActive && typeof sharedPlaybackState.brbMessage === 'string') {
            setBrbCustomMessage(sharedPlaybackState.brbMessage)
          }

          if (sharedPlaybackState.currentSongId === nowPlaying.id) {
            setIsNowPlayingStarted(sharedPlaybackState.isStarted)
            previousSongIdRef.current = nowPlaying.id
            return
          }
        } else {
          setIsBrbActive(false)
          setIsFinalSongSoonActive(false)
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

  const openMirrorFromGigControl = useCallback(() => {
    const { openedInNewTabWindow } = openMirrorScreen()

    if (mirrorLaunchStatusTimerRef.current) {
      window.clearTimeout(mirrorLaunchStatusTimerRef.current)
    }

    const statusMessage = openedInNewTabWindow
      ? 'Mirror opened in a new browser tab. In Edge, use the three-dot menu and select Cast media to device.'
      : 'Browser blocked opening Mirror. Allow new tabs for this site and try again.'

    setMirrorLaunchStatusText(statusMessage)
    mirrorLaunchStatusTimerRef.current = window.setTimeout(() => {
      setMirrorLaunchStatusText(null)
      mirrorLaunchStatusTimerRef.current = null
    }, MIRROR_LAUNCH_STATUS_DURATION_MS)
  }, [])

  const openFocusedGigControlWindow = useCallback(() => {
    const searchParams = new URLSearchParams()
    searchParams.set('view', 'focus')
    searchParams.set('fullscreen', '1')

    if (event?.id) {
      searchParams.set('event', event.id)
    }

    const focusedWindow = window.open(`/admin/gig-control?${searchParams.toString()}`, '_blank', 'noopener,noreferrer')

    if (!focusedWindow) {
      setErrorText('Browser blocked opening Focus Gig Control. Allow popups for this site and try again.')
      return
    }

    focusedWindow.focus()
    setErrorText(null)
  }, [event?.id])

  const handleGoBackToGigControl = useCallback(() => {
    navigate('/admin/gig-control')
  }, [navigate])

  const handleEnterFocusFullscreen = useCallback(() => {
    if (typeof document === 'undefined' || !document.documentElement.requestFullscreen) {
      setErrorText('Fullscreen is not available in this browser window.')
      return
    }

    void document.documentElement.requestFullscreen().catch(() => {
      setErrorText('Could not enter fullscreen. Try browser fullscreen (F11).')
    })
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
      disabled: gigActions.quickActionBusy || preflightBusy || endGigDecisionBusy !== null,
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
      id: 'force-fallback-mode',
      label: queueOperatingMode === 'degraded' ? 'Fallback Enabled' : 'Force Fallback Mode',
      title: 'Keep Gig Control usable with a local fallback shell while live queue data retries in the background',
      onClick: async () => {
        try {
          await forceFallbackMode()
          setErrorText(null)
        } catch (error) {
          setErrorText(error instanceof Error ? error.message : 'Failed to enable fallback mode.')
        }
      },
      disabled: queueOperatingMode === 'degraded',
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
      title: 'Open the audience-facing mirror display in a new browser tab, then cast from Edge menu',
      onClick: openMirrorFromGigControl,
      variant: 'ghost',
    },
    {
      id: 'play-spotify-shortcut',
      label: 'Play Spotify Playlist',
      title: 'Start or resume the Spotify between-song playlist without pausing it',
      onClick: () => {
        sendManualSpotifyTransportCommand('play')
      },
      disabled: !spotifyAccessToken,
      variant: 'ghost',
    },
  ]
  const focusActionIds = new Set([
    'connect-spotify',
    'toggle-room-open',
    'toggle-explicit-filter',
    'brb-toggle',
    'open-gig-settings',
    'open-mirror-screen',
    'play-spotify-shortcut',
  ])
  const visibleHeaderActions = isFocusedGigControlWindow
    ? headerActions.filter((action) => focusActionIds.has(action.id))
    : headerActions

  if (loading) {
    if (showLoadingRecovery) {
      return (
        <section className="gig-control-shell" aria-label="Gig control recovery">
          <section className="queue-panel" role="status" aria-live="polite">
            <p className="eyebrow">Live Control</p>
            <h1>Reconnecting live controls...</h1>
            <p className="subcopy">
              {queueHealthMessage
                ?? 'The live queue is taking longer than expected to load. We are still retrying in the background.'}
            </p>
            {signedInEmail ? (
              <p className="meta-badge" aria-live="polite">Signed in as {signedInEmail}</p>
            ) : null}
            <p className="subcopy">
              Mode: {queueOperatingMode === 'degraded' ? 'Degraded (fallback retries active)' : 'Normal'}
            </p>
            <div className="hero-actions no-margin-bottom">
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  window.location.reload()
                }}
              >
                Retry Now
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  navigate('/admin/gigs')
                }}
              >
                Open Gig List
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  navigate('/audience')
                }}
              >
                Open Audience
              </button>
            </div>
          </section>
        </section>
      )
    }

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
          <p className="eyebrow">{isGigLoadFailureState ? 'Live Control Recovery' : 'No active gig'}</p>
          <h1>{isGigLoadFailureState ? 'Could Not Load Gig Control' : 'No Gig Running'}</h1>
          <p className="subcopy">
            {isGigLoadFailureState
              ? (queueHealthMessage ?? 'Live data is temporarily unavailable. Retry now or open Gig List while the service recovers.')
              : hostEvents.length === 0
              ? 'No gigs were found for the currently signed-in host account.'
              : 'Could not load a live gig for this account right now.'}
          </p>
          {signedInEmail ? (
            <p className="meta-badge" aria-live="polite">Signed in as {signedInEmail}</p>
          ) : null}
          <p className="subcopy">
            If this is the wrong account, sign out and sign in with the host account that created your gigs.
          </p>
          {!autoRedirectCancelled && autoRedirectCountdown !== null ? (
            <p className="subcopy">
              Opening Gig List automatically in {autoRedirectCountdown}s so you can continue operating.
            </p>
          ) : null}
          <div className="hero-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                window.location.reload()
              }}
            >
              Retry Now
            </button>
            <button type="button" className="secondary-button" onClick={() => navigate('/admin/gigs')}>
              Open Gig List
            </button>
            {hostEvents.length > 0 ? (
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  void forceFallbackMode().catch((error) => {
                    setErrorText(error instanceof Error ? error.message : 'Failed to enable fallback mode.')
                  })
                }}
              >
                Force Fallback Mode
              </button>
            ) : null}
            {!autoRedirectCancelled && autoRedirectCountdown !== null ? (
              <button type="button" className="ghost-button" onClick={() => setAutoRedirectCancelled(true)}>
                Stay Here
              </button>
            ) : null}
            <button type="button" className="ghost-button" onClick={() => navigate('/admin/create-gig')}>
              Create Gig
            </button>
            <button type="button" className="ghost-button" onClick={() => navigate('/admin')}>
              Go to Admin Sign In
            </button>
          </div>
        </section>
      </section>
    )
  }

  return (
    <section className={`gig-control-shell${isFocusedGigControlWindow ? ' gig-control-shell-focus' : ''}`} aria-label="Gig control panel">
      {/* Professional Lounge Header */}
      <header className="gig-lounge-header">
        <div className="gig-lounge-header-main">
          <h1 className="gig-lounge-title">Gig Control Lounge</h1>
          <div className="gig-lounge-meta">
            <span className="gig-lounge-event-name">{event.name}</span>
            {event.venue ? <span className="gig-lounge-event-venue">@ {event.venue}</span> : null}
            {isCurrentTestGig ? <span className="meta-badge">Test Gig</span> : null}
          </div>
        </div>
        <div className="gig-lounge-header-actions">
          <button type="button" className="secondary-button" onClick={() => navigate('/admin/gigs')}>Gig List</button>
          <button type="button" className="ghost-button" onClick={() => navigate('/admin/gig-settings')}>Settings</button>
          <button type="button" className="ghost-button" onClick={openMirrorFromGigControl}>Mirror</button>
        </div>
      </header>

      {/* Main Control Row */}
      <div className="gig-lounge-main-row">
        <section className="gig-performer-cockpit gig-lounge-panel" aria-label="Performer live cockpit">
          <div className="gig-performer-cockpit-top">
            <p className="gig-control-card-label no-margin-bottom">Performer Cockpit</p>
            <div className="gig-performer-status-row" role="status" aria-live="polite">
              <span className={`gig-performer-status-pill ${event.roomOpen ? 'is-live' : 'is-paused'}`}>{liveModeLabel}</span>
              <span className="gig-performer-status-pill is-neutral">{mirrorStateLabel}</span>
              <span className="gig-performer-status-pill is-neutral">Audience {activeAudienceCount ?? 0}</span>
            </div>
          </div>
          <div className="gig-performer-controls gig-lounge-actions">
            <button
              type="button"
              className="primary-button"
              disabled={gigActions.quickActionBusy || preflightBusy || endGigDecisionBusy !== null}
              onClick={async () => { await toggleLiveState() }}
            >
              {event.roomOpen ? 'Stop Live' : 'Go Live'}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={mirrorOverlayUpdateBusy}
              onClick={async () => { await toggleBrbState() }}
            >
              {isBrbActive ? 'Resume' : 'Break'}
            </button>
            <button type="button" className="ghost-button" onClick={openFocusedGigControlWindow}>Fullscreen</button>
          </div>
        </section>

        <section className="gig-mirror-preview-card gig-lounge-panel" aria-label="Live mirror preview">
          <p className="gig-control-card-label">Mirror Preview</p>
          {/* ...mirror preview content unchanged... */}
        </section>

        <section className="gig-control-qr-card gig-lounge-panel" aria-label="Audience join tools">
          <p className="gig-control-card-label">Audience QR</p>
          {/* ...QR code and actions unchanged... */}
        </section>
      </div>

      {/* Queue and Performed Songs Row */}
      <div className="gig-lounge-queue-row">
        <section className="queue-panel gig-queue-panel gig-lounge-panel">
          {/* ...queue list content unchanged... */}
        </section>
        <section className="queue-panel gig-performed-panel gig-lounge-panel">
          {/* ...performed songs content unchanged... */}
        </section>
      </div>

      {/* Add Song, Shortcuts, and Spotify Controls */}
      <div className="gig-lounge-bottom-row">
        <section className="queue-panel gig-manual-add-panel gig-lounge-panel">
          {/* ...add song controls unchanged... */}
        </section>
        <section className="queue-panel gig-shortcuts-panel gig-lounge-panel">
          {/* ...shortcuts content unchanged... */}
        </section>
        <section className="queue-panel gig-lounge-panel">
          {/* ...Spotify controls unchanged... */}
        </section>
      </div>

      {/* Error and Summary Modals */}
      {shouldShowErrorText ? <p className="error-text gig-control-error-text" role="alert">{errorText}</p> : null}
      {focusCriticalErrorText ? <p className="gig-focus-error-toast" role="alert">{focusCriticalErrorText}</p> : null}
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
