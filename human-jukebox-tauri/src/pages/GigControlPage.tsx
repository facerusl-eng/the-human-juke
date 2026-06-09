
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AddSongTabs from '../components/actions/AddSongTabs';
import { ActionButtonGroup, type ActionButtonConfig } from '../components/actions/ActionButtonGroup';
import SpotifyPlayerWithSDK from '../components/SpotifyPlayerWithSDK.jsx';
import { useClipboardCopy } from '../hooks/useClipboardCopy';
import { useGigActions } from '../hooks/useGigActions';
import { getAudienceUrl } from '../lib/audienceUrl';
import { openMirrorScreen } from '../lib/openMirrorScreen';
import { registerBackgroundSync } from '../lib/backgroundSync';
import {
  captureQueueSnapshot,
  getLatestQueueSnapshot,
  getQueueSnapshots,
  getQueueSnapshotsFromDatabase,
  restoreQueueSnapshotInDatabase,
  saveQueueSnapshotToDatabase,
} from '../lib/queueSnapshots';
import {
  BETWEEN_SONG_QUOTES,
  LAST_SONG_SOON_OVERLAY_MESSAGE,
  PLAYBACK_STATE_BROADCAST_CHANNEL,
  PLAYBACK_STATE_EVENT,
  PLAYBACK_STATE_STORAGE_KEY,
  createSharedPlaybackTransitionMessage,
  getCountdownTargetRemainingMs,
  getSharedPlaybackTransitionState,
  isLastSongSoonOverlayMessage,
  normalizeCountdownTargetMs,
  type SharedPlaybackState,
  readSharedPlaybackState,
  writeSharedPlaybackState,
} from '../lib/playbackState';
import { readFromLocalStorage, saveToLocalStorage } from '../lib/saveHandling';
import { supabase } from '../lib/supabase';
import { prefetchAndCacheLyrics } from '../lib/lyricsPrefetch'
import {
  INTRO_AUDIO_LOCK_STORAGE_KEY,
  INTRO_AUDIO_LOCK_TTL_MS,
  INTRO_AUDIO_PLAYBACK_VOLUME,
  SPOTIFY_ACCESS_TOKEN_STORAGE_KEY,
  SPOTIFY_AUTO_TRANSPORT_STORAGE_KEY,
  GIG_CONTROL_AUTO_REDIRECT_SECONDS,
  GIG_CONTROL_LOADING_RECOVERY_MS,
  GIG_CONTROL_NOW_PLAYING_STORAGE_KEY,
  GIG_CONTROL_NOW_PLAYING_MAX_AGE_MS,
  ROOM_STATE_ENSURE_MAX_ATTEMPTS,
  ROOM_STATE_ENSURE_RETRY_DELAY_MS,
  MIRROR_PREVIEW_TRANSITION_MS,
  MIRROR_LAUNCH_STATUS_DURATION_MS,
  AUTO_LIVE_RETRY_DELAY_MS,
  BACKGROUND_SYNC_TAG,
} from '../lib/constants';
import { useAuthStore } from '../state/authStore';
import { useQueueStore } from '../state/queueStore';
// ...existing code...
const DEFAULT_BRB_MESSAGE = 'I am briefly offstage negotiating with the sound gremlins and a suspiciously warm pint. Stay splendid.'
const BREAK_TRANSITION_BACK_MESSAGE = 'I have returned from the interval, mostly intact and vaguely professional.'
const AUTO_LIVE_WELCOME_MESSAGE = 'Welcome to The Human Jukebox! We are live - get your requests in and enjoy the show.'
const GO_LIVE_COUNTDOWN_LOCK_MESSAGE = 'Go Live is countdown-only: manual start is disabled until the timer reaches zero.'
const SONG_START_COUNTDOWN_MS = 10_000
const SPACEBAR_START_COUNTDOWN_MS = 250
const INTRO_TRANSITION_LOCK_MAX_MS = 45_000
const PLAYBACK_TRANSITION_RECOVERY_GRACE_MS = 8_000
const PLAYBACK_ACTION_LOCK_MAX_MS = 20_000
const PLAYBACK_SYNC_POLL_INTERVAL_MS = 2_500
const BRB_MESSAGE_DICE_OPTIONS = [
  'Quick break in progress. Keep your requests coming and I will be right back.',
  'Bar check and sound check in one mission. Stay fabulous, I am back shortly.',
  'Intermission mode: I am refilling my pint and rebooting my dance energy. Back in a minute.',
  'Tiny backstage reset. Queue your songs and I will return before the next dramatic chorus.',
  'I am stretching, hydrating, and pretending to be professional. Right back.',
  'Break time. Scan the QR, claim your anthem, and I will be back before your crisps get lonely.',
]
type SpotifyTransportMode = 'play' | 'pause' | 'toggle' | 'next' | 'previous'
type NowPlayingType = 'spotify' | 'queue' | 'none'
type EmergencyOverlayPreset = 'tech-issue' | 'scan-qr' | 'closing-soon'
type MirrorPreviewTransitionTone = 'on-break' | 'back-live'
type SpotifyPlaylistMeta = {
  name?: string
  uri?: string
  ownerName?: string
} | null

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

function getPreservedOverlayMessage(state: SharedPlaybackState | null | undefined) {
  const currentBrbMessage = state?.brbMessage ?? null
  const hasActiveTransitionMessage = Boolean(getSharedPlaybackTransitionState(state))

  return Boolean(state?.brbActive)
    || isLastSongSoonOverlayMessage(currentBrbMessage)
    || hasActiveTransitionMessage
    ? currentBrbMessage
    : null
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

function classifyPreflightIssue(error?: unknown): PreflightIssueCode {
  void error
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

function formatGigSwitcherDate(gigDate: string | null | undefined, gigStartTime: string | null | undefined) {
  const startAt = resolveGigStartAt(gigDate, gigStartTime)

  if (!startAt) {
    return gigDate ?? 'No date set'
  }

  const dateLabel = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(startAt)

  const timeLabel = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(startAt)

  return `${dateLabel} at ${timeLabel}`
}

function isGoLiveCountdownLocked(
  roomOpen: boolean,
  mirrorCountdownEnabled: boolean | null | undefined,
  gigDate: string | null | undefined,
  gigStartTime: string | null | undefined,
  hostNowMs: number,
) {
  if (roomOpen) {
    return false
  }

  if (!mirrorCountdownEnabled) {
    return false
  }

  const gigStartAt = resolveGigStartAt(gigDate, gigStartTime)
  if (!gigStartAt) {
    return false
  }

  return gigStartAt.getTime() > hostNowMs
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

const SHARED_CLOCK_OFFSET_CACHE_KEY = 'human-jukebox-clock-offset-cache-v1'
const SHARED_CLOCK_OFFSET_CACHE_MAX_AGE_MS = 1000 * 60 * 15

function readSharedClockOffsetCache(): number | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawCache = window.localStorage.getItem(SHARED_CLOCK_OFFSET_CACHE_KEY)

    if (!rawCache) {
      return null
    }

    const parsedCache = JSON.parse(rawCache) as { updatedAt?: unknown; offsetMs?: unknown }
    const updatedAt = typeof parsedCache?.updatedAt === 'number' ? parsedCache.updatedAt : 0
    const offsetMs = typeof parsedCache?.offsetMs === 'number' ? parsedCache.offsetMs : null

    if (offsetMs === null || !Number.isFinite(offsetMs)) {
      return null
    }

    if (!updatedAt || Date.now() - updatedAt > SHARED_CLOCK_OFFSET_CACHE_MAX_AGE_MS) {
      return null
    }

    return Math.round(offsetMs)
  } catch {
    return null
  }
}

function saveSharedClockOffsetCache(offsetMs: number) {
  if (typeof window === 'undefined' || !Number.isFinite(offsetMs)) {
    return
  }

  try {
    window.localStorage.setItem(SHARED_CLOCK_OFFSET_CACHE_KEY, JSON.stringify({
      updatedAt: Date.now(),
      offsetMs: Math.round(offsetMs),
    }))
  } catch {
    // Ignore localStorage write failures.
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
  const [syncedPlaybackState, setSyncedPlaybackState] = useState<SharedPlaybackState | null>(null)
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
  const [selectedSpotifyPlaylistMeta, setSelectedSpotifyPlaylistMeta] = useState<SpotifyPlaylistMeta>(null)
  const [spotifyTransportCommand, setSpotifyTransportCommand] = useState<{ mode: SpotifyTransportMode, nonce: number } | null>(null)
  const [isEndingOrDeletingGig, setIsEndingOrDeletingGig] = useState(false)
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
  const [mirrorMonitorRefreshNonce, setMirrorMonitorRefreshNonce] = useState(0)
  const [lastMirrorSyncAt, setLastMirrorSyncAt] = useState<number>(() => Date.now())
  const [mirrorLaunchStatusText, setMirrorLaunchStatusText] = useState<string | null>(null)
  const [restoreConfirmPayload, setRestoreConfirmPayload] = useState<{ snapshotId: string; queueCount: number; snapshotCount: number; reason: string; at: string; source: 'database' | 'local' } | null>(null)
  const [endGigPromptEvent, setEndGigPromptEvent] = useState<{ id: string; name: string } | null>(null)
  const [endGigDecisionBusy, setEndGigDecisionBusy] = useState<'keep-offline' | 'delete' | null>(null)
  const [autoLiveCountdown, setAutoLiveCountdown] = useState<string | null>(null)
  const [autoLiveLastError, setAutoLiveLastError] = useState<string | null>(null)
  const [autoLiveLockBadgeText, setAutoLiveLockBadgeText] = useState<string | null>(null)
  const [hostClockOffsetMs, setHostClockOffsetMs] = useState(() => readSharedClockOffsetCache() ?? 0)
  const [playbackTransitionNowMs, setPlaybackTransitionNowMs] = useState(() => Date.now())
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
    toggleRoomOpen: async () => {
      try {
        // If stopping gig, also disable autoLiveEnabled
        if (event && event.roomOpen) {
          await toggleRoomOpen();
        } else if (event && !event.roomOpen) {
          // Stopping gig: set roomOpen false and autoLiveEnabled false
          await setRoomOpen(false);
          await supabase
            .from('events')
            .update({ auto_live_enabled: false })
            .eq('id', event.id);
        }
        setErrorText(null);
      } catch (err) {
        let msg = 'Failed to toggle room.';
        if (err && typeof err === 'object' && 'message' in err) {
          msg += ` ${(err as any).message}`;
        }
        setErrorText(msg);
        // Log to console for debugging
        // eslint-disable-next-line no-console
        console.error('toggleRoomOpen error:', err);
      }
    },
    toggleExplicitFilter,
    setErrorText,
    errors: {
      setActiveEvent: 'Failed to switch gig.',
      toggleRoomOpen: 'Failed to toggle room.',
      toggleExplicitFilter: 'Failed to toggle filter.',
    },
  })

  // Show error message if present
  useEffect(() => {
    if (errorText) {
      // Optionally, show a toast or alert here
      // eslint-disable-next-line no-console
      console.warn('GigControlPage error:', errorText);
    }
  }, [errorText]);

  const quoteIndexRef = useRef(0)
  const isNowPlayingStartedRef = useRef(isNowPlayingStarted)
  const nowPlayingRef = useRef<typeof songs[number] | undefined>(undefined)
  const songsRef = useRef(songs)
  const spaceActionBusyRef = useRef(spaceActionBusy)
  const previousSongIdRef = useRef<string | null>(null)
  const previousRoomOpenRef = useRef<boolean | null>(null)
  const playbackActionLockRef = useRef(false)
  const playbackActionLockStartedAtRef = useRef(0)
  const playbackTransitionLockedRef = useRef(false)
  const playbackTransitionControllerIdRef = useRef(
    typeof window !== 'undefined' && typeof window.crypto?.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `gig-control-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  const playbackTransitionExecutionIdRef = useRef<string | null>(null)
  const playbackTransitionRecoveryTransitionIdRef = useRef<string | null>(null)
  const previousNowPlayingStartedRef = useRef(isNowPlayingStarted)
  const gigWorkerRef = useRef<Worker | null>(null)
  const liveHealthGuardLastRunAtRef = useRef(0)
  const autoLiveAttemptedEventIdRef = useRef<string | null>(null)
  const autoLiveNextRetryAtRef = useRef(0)
  const autoLiveInFlightRef = useRef(false)
  const hostClockOffsetRef = useRef(0)
  const introAudioLockOwnerRef = useRef<string | null>(null)
  const primedIntroAudioRef = useRef<PrimedIntroAudio | null>(null)
  const spotifyTransportNonceRef = useRef(0)
  const mirrorPreviewTransitionTimerRef = useRef<number | null>(null)
  const mirrorLaunchStatusTimerRef = useRef<number | null>(null)
  const mirrorOverlayBusyRef = useRef(false)
  const eventRef = useRef(event)
    const getHostNowMs = useCallback(() => Date.now() + hostClockOffsetRef.current, [])

    useEffect(() => {
      hostClockOffsetRef.current = hostClockOffsetMs
    }, [hostClockOffsetMs])

    useEffect(() => {
      saveSharedClockOffsetCache(hostClockOffsetMs)
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
  const nowPlayingType = useMemo<NowPlayingType>(() => {
    if (!nowPlaying) {
      return 'none'
    }

    return isNowPlayingStarted ? 'queue' : 'spotify'
  }, [isNowPlayingStarted, nowPlaying])
  const spotifyToggle = nowPlayingType === 'spotify'
  const globalActionCheckEnabled = event?.globalActionCheckEnabled ?? true
  const globalActionCheckBlockedText = 'Global Action Check is OFF. Enable it in Gig Settings before using Gig Control actions.'
  const ensureGlobalActionCheckEnabled = useCallback((actionLabel: string) => {
    if (globalActionCheckEnabled) {
      return true
    }

    setErrorText(`Global Action Check is OFF. Enable it in Gig Settings before ${actionLabel}.`)
    return false
  }, [globalActionCheckEnabled])
  const playbackTransitionState = useMemo(
    () => getSharedPlaybackTransitionState(syncedPlaybackState),
    [syncedPlaybackState],
  )
  const playbackTransitionRemainingMs = useMemo(() => {
    if (playbackTransitionState?.phase !== 'countdown') {
      return null
    }

    return getCountdownTargetRemainingMs(
      playbackTransitionState.countdownTargetMs,
      playbackTransitionNowMs + hostClockOffsetRef.current,
    )
  }, [playbackTransitionNowMs, playbackTransitionState])
  const playbackTransitionCountdownSeconds = playbackTransitionState?.phase === 'countdown'
    && playbackTransitionRemainingMs !== null
    ? Math.max(1, Math.ceil(playbackTransitionRemainingMs / 1000))
    : null
  const playbackTransitionIntroRemainingMs = useMemo(() => {
    if (playbackTransitionState?.phase !== 'intro') {
      return null
    }

    if (typeof playbackTransitionState.introStartedAtMs !== 'number') {
      return null
    }

    const elapsedMs = (playbackTransitionNowMs + hostClockOffsetRef.current) - playbackTransitionState.introStartedAtMs
    return Math.max(0, INTRO_TRANSITION_LOCK_MAX_MS - elapsedMs)
  }, [playbackTransitionNowMs, playbackTransitionState])
  const isPlaybackTransitionLocked = playbackTransitionState?.phase === 'countdown'
    ? playbackTransitionRemainingMs !== null && playbackTransitionRemainingMs > 0
    : playbackTransitionState?.phase === 'intro'
    ? playbackTransitionIntroRemainingMs !== null && playbackTransitionIntroRemainingMs > 0
    : false
  const playbackTransitionStatusText = playbackTransitionState?.phase === 'countdown'
    ? playbackTransitionCountdownSeconds !== null
      ? `Global start in ${playbackTransitionCountdownSeconds}`
      : 'Global start is syncing...'
    : playbackTransitionState?.phase === 'intro'
    ? isPlaybackTransitionLocked
      ? 'Intro MP3 playing...'
      : null
    : null
  const mirroredCountdownTargetMs = useMemo(() => {
    const target = resolveGigStartAt(event?.gigDate, event?.gigStartTime)
    return target ? target.getTime() : null
  }, [event?.gigDate, event?.gigStartTime])
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
    return songs.slice(1)
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
  const isManualGoLiveLocked = Boolean(event) && isGoLiveCountdownLocked(
    Boolean(event?.roomOpen),
    event?.mirrorCountdownEnabled,
    event?.gigDate,
    event?.gigStartTime,
    getHostNowMs(),
  )
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
  const sortedHostEvents = useMemo(() => {
    const toCreatedTimestamp = (createdAt: string) => {
      const createdTimestamp = new Date(createdAt).getTime()
      return Number.isNaN(createdTimestamp) ? 0 : createdTimestamp
    }

    return [...hostEvents].sort((leftGig, rightGig) => {
      const leftStartAt = resolveGigStartAt(leftGig.gigDate, leftGig.gigStartTime)?.getTime() ?? Number.POSITIVE_INFINITY
      const rightStartAt = resolveGigStartAt(rightGig.gigDate, rightGig.gigStartTime)?.getTime() ?? Number.POSITIVE_INFINITY

      if (leftStartAt !== rightStartAt) {
        return leftStartAt - rightStartAt
      }

      return toCreatedTimestamp(rightGig.createdAt) - toCreatedTimestamp(leftGig.createdAt)
    })
  }, [hostEvents])
  const activeHostEvent = hostEvents.find((hostEvent) => hostEvent.id === event?.id) ?? null
  const isCurrentTestGig = activeHostEvent?.isTestGig ?? event?.isTestGig ?? false
  const qrTargetEventId = event?.id
  const isQrTargetTestGig = isCurrentTestGig
  const queuedLibrarySongIds = useMemo(() => (
    new Set(
      songs
        .map((song) => song.library_song_id)
        .filter((songId): songId is string => Boolean(songId)),
    )
  ), [songs])
  const joinUrl = getAudienceUrl(qrTargetEventId, {
    compact: true,
    includeVersion: true,
    mode: isQrTargetTestGig ? 'test' : 'public',
  })
  const testJoinUrl = getAudienceUrl(qrTargetEventId, {
    compact: true,
    includeVersion: true,
    mode: 'test',
  })
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(joinUrl)}`
  const mirrorMonitorUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return '/mirror?preview=1&safeMargins=1&density=medium&cast=1'
    }

    const mirrorUrl = new URL('/mirror', window.location.origin)
    mirrorUrl.searchParams.set('preview', '1')
    mirrorUrl.searchParams.set('safeMargins', '1')
    mirrorUrl.searchParams.set('density', 'medium')
    mirrorUrl.searchParams.set('cast', '1')

    if (event?.id) {
      mirrorUrl.searchParams.set('event', event.id)
    }

    if (mirrorMonitorRefreshNonce > 0) {
      mirrorUrl.searchParams.set('monitorRefresh', String(mirrorMonitorRefreshNonce))
    }

    return mirrorUrl.toString()
  }, [event?.id, mirrorMonitorRefreshNonce])
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
  const releaseFullscreenFocus = useCallback(() => {
    if (typeof document === 'undefined') {
      return
    }

    const activeElement = document.activeElement as HTMLElement | null
    if (activeElement && activeElement !== document.body) {
      activeElement.blur()
    }

    if (document.documentElement.hasAttribute('tabindex')) {
      document.documentElement.removeAttribute('tabindex')
    }

    if (!document.body.hasAttribute('tabindex')) {
      document.body.setAttribute('tabindex', '-1')
    }

    document.body.focus({ preventScroll: true })
  }, [])
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
      void document.documentElement.requestFullscreen()
        .then(() => {
          releaseFullscreenFocus()
        })
        .catch(() => {
          // Ignore blocked auto-fullscreen attempts in focus mode.
        })
    }, 120)

    const onFullscreenChange = () => {
      if (document.fullscreenElement) {
        releaseFullscreenFocus()
      }
    }

    document.addEventListener('fullscreenchange', onFullscreenChange, true)

    return () => {
      window.clearTimeout(timerId)
      document.removeEventListener('fullscreenchange', onFullscreenChange, true)
    }
  }, [isFocusedGigControlWindow, releaseFullscreenFocus, shouldAutoEnterFullscreenInFocusWindow])

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
    playbackTransitionLockedRef.current = isPlaybackTransitionLocked
  }, [isPlaybackTransitionLocked])

  useEffect(() => {
    if (playbackTransitionState?.phase !== 'countdown') {
      return
    }

    let rafId: number | null = null

    const tick = () => {
      setPlaybackTransitionNowMs(Date.now())
      rafId = window.requestAnimationFrame(tick)
    }

    tick()

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
    }
  }, [playbackTransitionState?.countdownTargetMs, playbackTransitionState?.phase])

  useEffect(() => {
    if (audienceConnectionStatus !== 'connected') {
      return
    }

    // Keep the mirror sync badge fresh while realtime stays connected.
    setLastMirrorSyncAt(Date.now())

    const heartbeatTimerId = window.setInterval(() => {
      setLastMirrorSyncAt(Date.now())
    }, 5000)

    return () => {
      window.clearInterval(heartbeatTimerId)
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

  const sendSpotifyTransportCommand = useCallback((
    mode: SpotifyTransportMode,
    options?: { force?: boolean },
  ) => {
    if (isEndingOrDeletingGig) return

    if (!spotifyAccessToken) {
      setSpotifyStatusText('Spotify is disconnected. Click Connect Spotify to enable auto play/pause transport.')
      return
    }

    if (!options?.force && !spotifyAutoTransportEnabled) {
      return
    }

    spotifyTransportNonceRef.current += 1
    setSpotifyTransportCommand({ mode, nonce: spotifyTransportNonceRef.current })
  }, [spotifyAccessToken, spotifyAutoTransportEnabled, isEndingOrDeletingGig])

  useEffect(() => {
    const wasNowPlayingStarted = previousNowPlayingStartedRef.current
    previousNowPlayingStartedRef.current = isNowPlayingStarted

    if (!wasNowPlayingStarted || isNowPlayingStarted) {
      return
    }

    if (!event?.roomOpen || !spotifyAccessToken) {
      return
    }

    sendSpotifyTransportCommand('play', { force: true })

    const retryTimer = window.setTimeout(() => {
      if (!isNowPlayingStartedRef.current) {
        sendSpotifyTransportCommand('play', { force: true })
      }
    }, 350)

    return () => {
      window.clearTimeout(retryTimer)
    }
  }, [event?.roomOpen, isNowPlayingStarted, sendSpotifyTransportCommand, spotifyAccessToken])

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

    spotifyTransportNonceRef.current += 1
    setSpotifyTransportCommand({ mode, nonce: spotifyTransportNonceRef.current })
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

// Prevent overlapping intro MP3 playback (module scope)
let introAudioLock = false

const playIntroAudioWithSpotifyBridge = async (introAudioUrl: string, primedAudioElement?: HTMLAudioElement | null) => {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    return
  }
  if (introAudioLock) return
  introAudioLock = true
  try {
    const introAudio = primedAudioElement ?? new Audio(introAudioUrl)
    introAudio.muted = false
    introAudio.volume = INTRO_AUDIO_PLAYBACK_VOLUME
    introAudio.currentTime = 0
    introAudio.preload = 'auto'

    // Duck Spotify before and after intro
    await sendSpotifyTransportCommand('pause', { force: true })
    await sendSpotifyWebApiTransportCommand('pause')

    const completionPromise = new Promise((resolve) => {
      const cleanup = () => {
        introAudio.removeEventListener('ended', onEnded)
        introAudio.removeEventListener('error', onError)
      }
      const onEnded = () => { cleanup(); resolve(undefined) }
      const onError = () => { cleanup(); resolve(undefined) }
      introAudio.addEventListener('ended', onEnded, { once: true })
      introAudio.addEventListener('error', onError, { once: true })
    })

    try {
      await introAudio.play()
    } catch {
      // Fallback: browsers often allow muted autoplay even when audible play() is blocked.
      introAudio.muted = true
      introAudio.volume = 0
      await introAudio.play()
      introAudio.currentTime = Math.max(0, introAudio.currentTime)
      introAudio.volume = INTRO_AUDIO_PLAYBACK_VOLUME
      introAudio.muted = false
    }

    await completionPromise
    // Resume Spotify after intro so between-song playlist comes back automatically.
    await sendSpotifyTransportCommand('play', { force: true })
    await sendSpotifyWebApiTransportCommand('play')
  } finally {
    introAudioLock = false
  }
}

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
      const isLocalHttpDev = (
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        && window.location.protocol === 'http:'
      )
      const loginUrl = isLocalHttpDev
        ? 'https://www.the-human-jukebox.org/api/spotify/login'
        : '/api/spotify/login'

      window.location.assign(loginUrl)
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
    if (!ensureGlobalActionCheckEnabled('changing live state')) {
      return;
    }

    const currentEvent = eventRef.current;
    if (!currentEvent?.id) {
      setErrorText('No active gig selected.');
      return;
    }

    if (isGoLiveCountdownLocked(
      currentEvent.roomOpen,
      currentEvent.mirrorCountdownEnabled,
      currentEvent.gigDate,
      currentEvent.gigStartTime,
      getHostNowMs(),
    )) {
      setErrorText(GO_LIVE_COUNTDOWN_LOCK_MESSAGE)
      return;
    }

    const isOpeningRoom = !currentEvent.roomOpen;

    try {
      if (isOpeningRoom) {
        if (currentEvent.introAudioUrl) {
          primeIntroAudioPlayback(currentEvent.id, currentEvent.introAudioUrl);
        }

        setAutoLiveLastError(null);
        await runGoLivePreflight();
      } else {
        setEndGigPromptEvent({
          id: currentEvent.id,
          name: currentEvent.name,
        });
        return;
      }

      await ensureRoomOpenState(isOpeningRoom);
      setAutoLiveLastError(null);

      const latestEvent = eventRef.current;
      if (!isOpeningRoom || !latestEvent?.id || latestEvent.id !== currentEvent.id) {
        return;
      }

      if (latestEvent.introAudioUrl) {
        const primedIntroAudio = primedIntroAudioRef.current;
        const primedElement =
          primedIntroAudio &&
          primedIntroAudio.eventId === latestEvent.id &&
          primedIntroAudio.url === latestEvent.introAudioUrl
            ? primedIntroAudio.element
            : null;

        await playIntroAudioOnceSafely(
          latestEvent.id,
          latestEvent.introAudioUrl,
          'Go Live opened the room, but intro audio was blocked by browser autoplay settings. Spotify transport stayed paused.',
          primedElement,
        );
      }

      await writeSharedPlaybackState(latestEvent.id, {
        currentSongId: nowPlaying?.id ?? null,
        currentSongCoverUrl: resolveCoverUrlForSong(nowPlaying?.id ?? null),
        isStarted: true,
        quoteIndex: quoteIndexRef.current,
        countdownTargetMs: mirroredCountdownTargetMs,
        brbActive: false,
        brbMessage: AUTO_LIVE_WELCOME_MESSAGE,
      });

      setIsNowPlayingStarted(false);
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? error.message
          : isOpeningRoom
          ? 'Go Live preflight failed.'
          : 'Could not end gig. Please try again.',
      );
    }
  }, [
    ensureGlobalActionCheckEnabled,
    ensureRoomOpenState,
    mirroredCountdownTargetMs,
    nowPlaying?.id,
    playIntroAudioOnceSafely,
    primeIntroAudioPlayback,
    resolveCoverUrlForSong,
    runGoLivePreflight,
    getHostNowMs,
  ]);

  const runEndGigDecision = useCallback(async (decision: 'keep-offline' | 'delete') => {
    setIsEndingOrDeletingGig(true)
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
      setIsEndingOrDeletingGig(false)
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
        countdownTargetMs: mirroredCountdownTargetMs,
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
    mirroredCountdownTargetMs,
    nowPlaying?.id,
    resolveCoverUrlForSong,
    showMirrorPreviewTransition,
  ])

  const toggleLastSongSoonState = useCallback(async () => {
    if (!ensureGlobalActionCheckEnabled('updating mirror overlays')) {
      return
    }

    await setMirrorOverlayMessage(isFinalSongSoonActive ? null : LAST_SONG_SOON_OVERLAY_MESSAGE)
  }, [ensureGlobalActionCheckEnabled, isFinalSongSoonActive, setMirrorOverlayMessage])

  const toggleBrbState = useCallback(async () => {
    if (!ensureGlobalActionCheckEnabled('updating break mode')) {
      return
    }

    const nextBrb = !isBrbActive
    await setMirrorOverlayMessage(nextBrb ? (brbCustomMessage.trim() || DEFAULT_BRB_MESSAGE) : null)
  }, [brbCustomMessage, ensureGlobalActionCheckEnabled, isBrbActive, setMirrorOverlayMessage])

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

      if (event.introAudioUrl) {
        primeIntroAudioPlayback(event.id, event.introAudioUrl)
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
            'Auto Live intro audio was blocked by browser autoplay settings. Spotify transport stayed paused.',
            primedElement,
          )
        }

        await writeSharedPlaybackState(event.id, {
          currentSongId: nowPlaying?.id ?? null,
          currentSongCoverUrl: nowPlaying?.cover_url ?? null,
          isStarted: false,
          quoteIndex: quoteIndexRef.current,
          countdownTargetMs: startAt.getTime(),
          brbActive: false,
          brbMessage: AUTO_LIVE_WELCOME_MESSAGE,
        })

        setIsNowPlayingStarted(false)

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
    nowPlaying?.cover_url,
    nowPlaying?.id,
    primeIntroAudioPlayback,
    playIntroAudioOnceSafely,
    runGoLivePreflight,
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
        setSyncedPlaybackState(sharedPlaybackState)
        const preservedCountdownTargetMs = sharedPlaybackState?.countdownTargetMs ?? mirroredCountdownTargetMs
        const preservedBrbActive = Boolean(sharedPlaybackState?.brbActive)
        const preservedBrbMessage = getPreservedOverlayMessage(sharedPlaybackState)

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
            countdownTargetMs: preservedCountdownTargetMs,
            brbActive: preservedBrbActive,
            brbMessage: preservedBrbMessage,
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
          countdownTargetMs: preservedCountdownTargetMs,
          brbActive: preservedBrbActive,
          brbMessage: preservedBrbMessage,
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
  }, [event?.id, mirroredCountdownTargetMs, nowPlaying?.id, resolveCoverUrlForSong])

  const applyIncomingPlaybackState = useCallback((nextState: SharedPlaybackState | null) => {
    setSyncedPlaybackState(nextState)

    const normalizedQuoteIndex = Number.isFinite(nextState?.quoteIndex)
      ? Math.abs(Math.trunc(nextState?.quoteIndex ?? 0)) % BETWEEN_SONG_QUOTES.length
      : 0

    setQuoteIndex(normalizedQuoteIndex)
    setIsBrbActive(Boolean(nextState?.brbActive))
    setIsFinalSongSoonActive(isLastSongSoonOverlayMessage(nextState?.brbMessage))

    if (nextState?.brbActive && typeof nextState.brbMessage === 'string') {
      setBrbCustomMessage(nextState.brbMessage)
    }

    if (!nowPlaying?.id) {
      setIsNowPlayingStarted(false)
      return
    }

    setIsNowPlayingStarted(Boolean(nextState?.isStarted) && nextState?.currentSongId === nowPlaying.id)
  }, [nowPlaying?.id])

  useEffect(() => {
    const eventId = event?.id

    if (!eventId) {
      setSyncedPlaybackState(null)
      return
    }

    let isCurrent = true
    let subscription: ReturnType<typeof supabase.channel> | null = null
    let syncTimerId: number | null = null
    let playbackBroadcastChannel: BroadcastChannel | null = null

    const syncPlaybackState = async () => {
      try {
        const nextState = await readSharedPlaybackState(eventId)

        if (!isCurrent) {
          return
        }

        applyIncomingPlaybackState(nextState)
      } catch (error) {
        console.warn('GigControlPage: playback sync failed', error)
      }
    }

    subscription = supabase
      .channel(`playback_state:${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'playback_state',
          filter: `event_id=eq.${eventId}`,
        },
        (payload: {
          eventType?: 'INSERT' | 'UPDATE' | 'DELETE'
          new?: {
            current_song_id?: string | null
            current_song_cover_url?: string | null
            is_started?: boolean | null
            quote_index?: number | null
            countdown_target_ms?: number | string | null
            brb_active?: boolean | null
            brb_message?: string | null
          } | null
        }) => {
          if (payload?.eventType === 'DELETE' || !payload?.new) {
            void syncPlaybackState()
            return
          }

          applyIncomingPlaybackState({
            currentSongId: payload.new.current_song_id ?? null,
            currentSongCoverUrl: payload.new.current_song_cover_url ?? null,
            isStarted: Boolean(payload.new.is_started),
            quoteIndex: Number.isFinite(payload.new.quote_index)
              ? (payload.new.quote_index as number)
              : 0,
            countdownTargetMs: normalizeCountdownTargetMs(payload.new.countdown_target_ms),
            brbActive: Boolean(payload.new.brb_active),
            brbMessage: typeof payload.new.brb_message === 'string' ? payload.new.brb_message : null,
          })
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void syncPlaybackState()
          return
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          void syncPlaybackState()
        }
      })

    const onPlaybackStateEvent = (nextEvent: Event) => {
      const detail = (nextEvent as CustomEvent<{ eventId: string; state: SharedPlaybackState }>).detail

      if (detail?.eventId === eventId) {
        applyIncomingPlaybackState(detail.state ?? null)
      }
    }

    const onStoragePlaybackState = (nextEvent: StorageEvent) => {
      if (nextEvent.key !== PLAYBACK_STATE_STORAGE_KEY || !nextEvent.newValue) {
        return
      }

      try {
        const detail = JSON.parse(nextEvent.newValue) as { eventId?: string; state?: SharedPlaybackState }

        if (detail.eventId !== eventId || !detail.state) {
          return
        }

        applyIncomingPlaybackState(detail.state)
      } catch {
        // Ignore malformed cross-tab sync payloads.
      }
    }

    void syncPlaybackState()
    syncTimerId = window.setInterval(() => {
      if (document.hidden) {
        return
      }

      void syncPlaybackState()
    }, PLAYBACK_SYNC_POLL_INTERVAL_MS)

    window.addEventListener(PLAYBACK_STATE_EVENT, onPlaybackStateEvent as EventListener)
    window.addEventListener('storage', onStoragePlaybackState)

    if ('BroadcastChannel' in window) {
      playbackBroadcastChannel = new BroadcastChannel(PLAYBACK_STATE_BROADCAST_CHANNEL)
      playbackBroadcastChannel.onmessage = (messageEvent: MessageEvent<{ eventId?: string; state?: SharedPlaybackState }>) => {
        const detail = messageEvent.data

        if (detail?.eventId !== eventId || !detail.state) {
          return
        }

        applyIncomingPlaybackState(detail.state)
      }
    }

    return () => {
      isCurrent = false

      if (subscription) {
        void supabase.removeChannel(subscription)
      }

      if (syncTimerId !== null) {
        window.clearInterval(syncTimerId)
      }

      window.removeEventListener(PLAYBACK_STATE_EVENT, onPlaybackStateEvent as EventListener)
      window.removeEventListener('storage', onStoragePlaybackState)
      playbackBroadcastChannel?.close()
    }
  }, [applyIncomingPlaybackState, event?.id])

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

    const nextBrbMessage = getPreservedOverlayMessage(syncedPlaybackState)

    try {
      await writeSharedPlaybackState(event.id, {
        currentSongId: targetSongId,
        currentSongCoverUrl: resolveCoverUrlForSong(targetSongId),
        isStarted: nextStarted,
        quoteIndex: quoteIndexRef.current,
        countdownTargetMs: event.roomOpen ? null : mirroredCountdownTargetMs,
        brbActive: syncedPlaybackState?.brbActive ?? false,
        brbMessage: nextBrbMessage,
      })
    } catch (error) {
      console.warn('GigControlPage: playback sync write failed', error)
      // Do not block local playback controls if cross-screen sync is temporarily unavailable.
    }
  }, [event, mirroredCountdownTargetMs, nowPlaying?.id, resolveCoverUrlForSong, syncedPlaybackState])

  const executeSharedSongStartTransition = useCallback(async (transitionId: string) => {
    if (playbackTransitionExecutionIdRef.current === transitionId) {
      return
    }

    playbackTransitionExecutionIdRef.current = transitionId

    try {
      const currentEvent = eventRef.current
      const currentSong = nowPlayingRef.current

      if (!currentEvent?.id || !currentSong?.id) {
        return
      }

      const transitionState = getSharedPlaybackTransitionState(syncedPlaybackState)
      if (!transitionState || transitionState.transitionId !== transitionId) {
        return
      }

      const transitionIntroAudioUrl = transitionState.introAudioUrl

      if (transitionIntroAudioUrl) {
        const introStartedAtMs = getHostNowMs()
        const introPrimedAudio = primedIntroAudioRef.current
        const primedElement = introPrimedAudio
          && introPrimedAudio.eventId === currentEvent.id
          && introPrimedAudio.url === transitionIntroAudioUrl
            ? introPrimedAudio.element
            : null

        await writeSharedPlaybackState(currentEvent.id, {
          currentSongId: currentSong.id,
          currentSongCoverUrl: resolveCoverUrlForSong(currentSong.id),
          isStarted: false,
          quoteIndex: quoteIndexRef.current,
          countdownTargetMs: transitionState.countdownTargetMs,
          brbActive: false,
          brbMessage: createSharedPlaybackTransitionMessage({
            transitionId,
            controllerId: playbackTransitionControllerIdRef.current,
            songId: currentSong.id,
            phase: 'intro',
            countdownTargetMs: transitionState.countdownTargetMs,
            introStartedAtMs,
            introAudioUrl: transitionIntroAudioUrl,
          }),
        })

        try {
          await playIntroAudioWithSpotifyBridge(transitionIntroAudioUrl, primedElement)
        } catch (error) {
          console.warn('GigControlPage: intro audio playback failed during song start transition', error)
          setErrorText('Countdown finished, but intro MP3 was blocked. Starting the song now.')
        }
      }

      await writeSharedPlaybackState(currentEvent.id, {
        currentSongId: currentSong.id,
        currentSongCoverUrl: resolveCoverUrlForSong(currentSong.id),
        isStarted: true,
        quoteIndex: quoteIndexRef.current,
        countdownTargetMs: null,
        brbActive: false,
        brbMessage: null,
      })

      setIsNowPlayingStarted(true)
      sendSpotifyTransportCommand('pause', { force: true })
    } finally {
      playbackTransitionExecutionIdRef.current = null
    }
  }, [getHostNowMs, playIntroAudioWithSpotifyBridge, resolveCoverUrlForSong, sendSpotifyTransportCommand, syncedPlaybackState])

  useEffect(() => {
    const countdownRemainingMs = playbackTransitionState?.phase === 'countdown'
      ? getCountdownTargetRemainingMs(
        playbackTransitionState.countdownTargetMs,
        getHostNowMs(),
      )
      : null
    const isStaleCountdownTransition = countdownRemainingMs !== null
      && countdownRemainingMs < -PLAYBACK_TRANSITION_RECOVERY_GRACE_MS

    if (
      playbackTransitionState?.phase !== 'countdown'
      || playbackTransitionExecutionIdRef.current === playbackTransitionState.transitionId
      || (
        playbackTransitionState.controllerId !== playbackTransitionControllerIdRef.current
        && !isStaleCountdownTransition
      )
    ) {
      return
    }

    let rafId: number | null = null

    const tick = () => {
      const remainingMs = getCountdownTargetRemainingMs(
        playbackTransitionState.countdownTargetMs,
        getHostNowMs(),
      )

      if (remainingMs !== null && remainingMs > 0) {
        rafId = window.requestAnimationFrame(tick)
        return
      }

      void executeSharedSongStartTransition(playbackTransitionState.transitionId)
    }

    tick()

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
    }
  }, [executeSharedSongStartTransition, getHostNowMs, playbackTransitionState])

  useEffect(() => {
    if (
      playbackTransitionState?.phase !== 'intro'
      || playbackTransitionIntroRemainingMs === null
      || playbackTransitionIntroRemainingMs > 0
      || playbackTransitionRecoveryTransitionIdRef.current === playbackTransitionState.transitionId
    ) {
      return
    }

    const currentEvent = eventRef.current
    const currentSong = nowPlayingRef.current

    if (!currentEvent?.id || !currentSong?.id) {
      return
    }

    playbackTransitionRecoveryTransitionIdRef.current = playbackTransitionState.transitionId

    void writeSharedPlaybackState(currentEvent.id, {
      currentSongId: currentSong.id,
      currentSongCoverUrl: resolveCoverUrlForSong(currentSong.id),
      isStarted: true,
      quoteIndex: quoteIndexRef.current,
      countdownTargetMs: null,
      brbActive: false,
      brbMessage: null,
    }).then(() => {
      setIsNowPlayingStarted(true)
    }).catch((error) => {
      console.warn('GigControlPage: failed to auto-finalize stale intro transition', error)
      playbackTransitionRecoveryTransitionIdRef.current = null
    })
  }, [playbackTransitionIntroRemainingMs, playbackTransitionState, resolveCoverUrlForSong])

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
    playbackActionLockStartedAtRef.current = Date.now()
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
      playbackActionLockStartedAtRef.current = 0
      setSpaceActionBusy(false)
    }
  }, [beginBetweenSongsTransition, restoreStartedSong])

  const startCurrentSong = useCallback(async (options?: { skipIntroAudio?: boolean; countdownMs?: number }) => {
    const currentEvent = eventRef.current
    const currentSong = nowPlayingRef.current
    const shouldSkipIntroAudio = options?.skipIntroAudio === true
    const transitionIntroAudioUrl = shouldSkipIntroAudio ? null : (currentEvent?.introAudioUrl ?? null)
    const countdownMs = Number.isFinite(options?.countdownMs)
      ? Math.max(250, Number(options?.countdownMs))
      : SONG_START_COUNTDOWN_MS

    if (!currentEvent?.id || !currentSong?.id || playbackTransitionLockedRef.current) {
      return
    }

    if (transitionIntroAudioUrl) {
      primeIntroAudioPlayback(currentEvent.id, transitionIntroAudioUrl)
    }

    const transitionId = `${currentSong.id}:${Date.now()}`
    const countdownTargetMs = getHostNowMs() + countdownMs

    await runPlaybackAction(async () => {
      await writeSharedPlaybackState(currentEvent.id, {
        currentSongId: currentSong.id,
        currentSongCoverUrl: resolveCoverUrlForSong(currentSong.id),
        isStarted: false,
        quoteIndex: quoteIndexRef.current,
        countdownTargetMs,
        brbActive: false,
        brbMessage: createSharedPlaybackTransitionMessage({
          transitionId,
          controllerId: playbackTransitionControllerIdRef.current,
          songId: currentSong.id,
          phase: 'countdown',
          countdownTargetMs,
          introStartedAtMs: null,
          introAudioUrl: transitionIntroAudioUrl,
        }),
      })
    }, { includeTransition: false })
  }, [getHostNowMs, primeIntroAudioPlayback, resolveCoverUrlForSong, runPlaybackAction])

  const runQueueTogglePlayShortcut = useCallback(async (options?: { skipIntroAudio?: boolean; countdownMs?: number }) => {
    if (!ensureGlobalActionCheckEnabled('changing playback state')) {
      return
    }

    const currentNowPlaying = nowPlayingRef.current
    const currentlyStarted = isNowPlayingStartedRef.current

    // Rely on the ref-based lock only — spaceActionBusy state can lag by one render
    if (!currentNowPlaying || playbackActionLockRef.current || playbackTransitionLockedRef.current) {
      return
    }

    if (!currentlyStarted) {
      await startCurrentSong({
        skipIntroAudio: options?.skipIntroAudio === true,
        countdownMs: options?.countdownMs,
      })
      return
    }

    await runPlaybackAction(async () => {
      await runWithSafetySnapshot('before-mark-played', async () => {
        await markPlayed()
      })
    })

    // When Space advances the queue, the mirror enters quote mode.
    // Trigger between-song Spotify playback for that quote segment.
    sendSpotifyTransportCommand('play', { force: true })
  }, [ensureGlobalActionCheckEnabled, markPlayed, runPlaybackAction, runWithSafetySnapshot, sendSpotifyTransportCommand, startCurrentSong])

  useEffect(() => {
    nowPlayingRef.current = nowPlaying
  }, [nowPlaying])

  useEffect(() => {
    songsRef.current = songs
  }, [songs])

  useEffect(() => {
    spaceActionBusyRef.current = spaceActionBusy
  }, [spaceActionBusy])

  const nowPlayingTypeRef = useRef<NowPlayingType>(nowPlayingType)
  useEffect(() => {
    nowPlayingTypeRef.current = nowPlayingType
  }, [nowPlayingType])

  // Stable ref to the shortcut so the keydown listener never needs re-registering
  const runQueueTogglePlayShortcutRef = useRef(runQueueTogglePlayShortcut)
  useEffect(() => {
    runQueueTogglePlayShortcutRef.current = runQueueTogglePlayShortcut
  }, [runQueueTogglePlayShortcut])

  const toggleSpotifyPlayPause = useCallback(async () => {
    if (!event?.roomOpen) {
      setErrorText('Spacebar playback is disabled until the gig is live.')
      return
    }

    if (!spotifyAccessToken) {
      setErrorText('Connect Spotify first to use Spotify transport controls.')
      return
    }

    sendManualSpotifyTransportCommand('toggle')
    setErrorText(null)
  }, [event?.roomOpen, sendManualSpotifyTransportCommand, spotifyAccessToken])

  const toggleQueuePlayPause = useCallback(async () => {
    if (!event?.roomOpen) {
      setErrorText('Spacebar playback is disabled until the gig is live.')
      return
    }

    const currentSong = nowPlayingRef.current
    if (!currentSong) {
      return
    }

    const now = Date.now()
    if (
      playbackActionLockRef.current
      && playbackActionLockStartedAtRef.current > 0
      && now - playbackActionLockStartedAtRef.current > PLAYBACK_ACTION_LOCK_MAX_MS
    ) {
      playbackActionLockRef.current = false
      playbackActionLockStartedAtRef.current = 0
      spaceActionBusyRef.current = false
      setSpaceActionBusy(false)
    }

    if (playbackActionLockRef.current || spaceActionBusyRef.current || playbackTransitionLockedRef.current) {
      return
    }

    try {
      const nextStarted = !isNowPlayingStartedRef.current
      await syncStartedState(nextStarted, currentSong.id)
      await registerBackgroundSync(BACKGROUND_SYNC_TAG)

      if (spotifyAccessToken) {
        sendSpotifyTransportCommand('pause', { force: true })
      }

      setErrorText(null)
    } catch (error) {
      console.warn('GigControlPage: queue play/pause toggle failed', error)
      setErrorText('Playback toggle failed. Please try again.')
    }
  }, [event?.roomOpen, sendSpotifyTransportCommand, spotifyAccessToken, syncStartedState])

  const handleSpacebarAction = useCallback(async () => {
    if (!nowPlayingRef.current) {
      setErrorText('No song in queue yet. Add a song, then press Space.')
      return
    }

    if (nowPlayingTypeRef.current === 'spotify') {
      await toggleSpotifyPlayPause()
      return
    }

    if (nowPlayingTypeRef.current === 'queue') {
      await toggleQueuePlayPause()
    }
  }, [toggleQueuePlayPause, toggleSpotifyPlayPause])


  /**
   * GLOBAL MODE SWITCH: QUOTE ↔ NOW PLAYING
   * One call = instant state flip broadcast to all clients.
   * Spotify follows: NOW PLAYING → pause, QUOTE → play.
   * No countdown, no transition lock, no queue advancement.
   */
  const runGlobalToggleQuoteNowPlaying = useCallback(async () => {
    if (!globalActionCheckEnabled) {
      setErrorText(globalActionCheckBlockedText);
      return;
    }

    const currentEvent = eventRef.current;
    const currentSong = nowPlayingRef.current;
    if (!currentEvent?.id || !currentSong?.id) {
      return;
    }

    if (
      !isNowPlayingStartedRef.current
      && isGoLiveCountdownLocked(
        currentEvent.roomOpen,
        currentEvent.mirrorCountdownEnabled,
        currentEvent.gigDate,
        currentEvent.gigStartTime,
        getHostNowMs(),
      )
    ) {
      setErrorText(GO_LIVE_COUNTDOWN_LOCK_MESSAGE)
      return;
    }

    const currentlyStarted = isNowPlayingStartedRef.current;

    if (!currentlyStarted) {
      // QUOTE → NOW PLAYING: instant switch
      setIsNowPlayingStarted(true);
      isNowPlayingStartedRef.current = true;

      try {
        await writeSharedPlaybackState(currentEvent.id, {
          currentSongId: currentSong.id,
          currentSongCoverUrl: resolveCoverUrlForSong(currentSong.id),
          isStarted: true,
          quoteIndex: quoteIndexRef.current,
          countdownTargetMs: null,
          brbActive: syncedPlaybackState?.brbActive ?? false,
          brbMessage: null,
        });
        await registerBackgroundSync(BACKGROUND_SYNC_TAG);
        // Spotify pauses only after state is confirmed
        if (isNowPlayingStartedRef.current) {
          sendSpotifyTransportCommand('pause', { force: true });
        }
        setErrorText(null);
      } catch (error) {
        // Roll back local state on failure
        setIsNowPlayingStarted(false);
        isNowPlayingStartedRef.current = false;
        console.warn('GigControlPage: go live via spacebar failed', error);
        setErrorText('Playback toggle failed. Please try again.');
      }
    } else {
      // NOW PLAYING → QUOTE: instant switch without queue advancement
      setIsNowPlayingStarted(false);
      isNowPlayingStartedRef.current = false;

      try {
        await writeSharedPlaybackState(currentEvent.id, {
          currentSongId: currentSong.id,
          currentSongCoverUrl: resolveCoverUrlForSong(currentSong.id),
          isStarted: false,
          quoteIndex: quoteIndexRef.current,
          countdownTargetMs: null,
          brbActive: syncedPlaybackState?.brbActive ?? false,
          brbMessage: null,
        });

        await registerBackgroundSync(BACKGROUND_SYNC_TAG);
        sendSpotifyTransportCommand('play', { force: true });
        setErrorText(null);
      } catch (error) {
        // Roll back local state on failure
        setIsNowPlayingStarted(true);
        isNowPlayingStartedRef.current = true;
        console.warn('GigControlPage: quote toggle via spacebar failed', error);
        setErrorText('Playback toggle failed. Please try again.');
      }
    }
  }, [globalActionCheckEnabled, globalActionCheckBlockedText, resolveCoverUrlForSong, sendSpotifyTransportCommand, syncedPlaybackState?.brbActive, getHostNowMs]);

  const runGlobalToggleQuoteNowPlayingRef = useRef(runGlobalToggleQuoteNowPlaying)
  useEffect(() => {
    runGlobalToggleQuoteNowPlayingRef.current = runGlobalToggleQuoteNowPlaying
  }, [runGlobalToggleQuoteNowPlaying])

  const handleGlobalSpacebarKeyDown = useCallback(async (event: KeyboardEvent) => {
    const normalizedKey = typeof event.key === 'string' ? event.key.trim().toLowerCase() : ''
    const isSpaceKey = event.code === 'Space'
      || event.key === ' '
      || event.key === 'Space'
      || event.key === 'Spacebar'
      || normalizedKey === 'space'
      || (event as unknown as { keyCode?: number; which?: number }).keyCode === 32
      || (event as unknown as { keyCode?: number; which?: number }).which === 32
    if (!isSpaceKey) {
      return
    }

    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return
    }

    const target = event.target as HTMLElement | null
    const activeElement = document.activeElement as HTMLElement | null
    const interactiveSelector = 'input, textarea, select, [contenteditable], [role="textbox"], [aria-multiline="true"], [data-spacebar-ignore="true"]'
    const interactiveTarget = target?.closest(interactiveSelector)
    const interactiveActiveElement = activeElement?.closest(interactiveSelector)
    const isTypingTarget = Boolean(
      interactiveTarget
      || interactiveActiveElement
      || activeElement?.isContentEditable,
    )

    if (isTypingTarget) {
      return
    }

    // Always block browser/page scroll on handled spacebar presses.
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    if (event.repeat) {
      return
    }

    try {
      await handleSpacebarAction()
    } catch (error) {
      console.warn('GigControlPage: spacebar playback action failed', error)
      setErrorText('Playback toggle failed. Please try again.')
    }
  }, [handleSpacebarAction])

  useEffect(() => {
    document.addEventListener('keydown', handleGlobalSpacebarKeyDown as unknown as EventListener, true)
    return () => {
      document.removeEventListener('keydown', handleGlobalSpacebarKeyDown as unknown as EventListener, true)
    }
  }, [handleGlobalSpacebarKeyDown])

  useEffect(() => {
    if (!isFocusedGigControlWindow) {
      return
    }

    const reclaimFocus = () => {
      const activeElement = document.activeElement as HTMLElement | null
      const interactiveSelector = 'input, textarea, select, [contenteditable], [role="textbox"], [aria-multiline="true"], [data-spacebar-ignore="true"]'
      const isTypingTarget = Boolean(activeElement?.closest(interactiveSelector) || activeElement?.isContentEditable)

      if (isTypingTarget) {
        return
      }

      if (activeElement && activeElement !== document.body) {
        activeElement.blur()
      }

      if (!document.body.hasAttribute('tabindex')) {
        document.body.setAttribute('tabindex', '-1')
      }

      document.body.focus({ preventScroll: true })
    }

    reclaimFocus()

    const timerId = window.setInterval(() => {
      if (document.fullscreenElement) {
        reclaimFocus()
      }
    }, 600)

    const onFullscreenChange = () => {
      if (document.fullscreenElement) {
        reclaimFocus()
      }
    }

    document.addEventListener('fullscreenchange', onFullscreenChange, true)

    return () => {
      window.clearInterval(timerId)
      document.removeEventListener('fullscreenchange', onFullscreenChange, true)
    }
  }, [isFocusedGigControlWindow])

  const openMirrorFromGigControl = useCallback(() => {
    const { openedInNewTabWindow, blockedByPopup } = openMirrorScreen({ eventId: event?.id ?? null })

    if (mirrorLaunchStatusTimerRef.current) {
      window.clearTimeout(mirrorLaunchStatusTimerRef.current)
    }

    const statusMessage = openedInNewTabWindow
      ? 'Mirror opened in fullscreen launch mode in a new tab. Gig Control stays open here.'
      : blockedByPopup
      ? 'Mirror was blocked by pop-up settings. Gig Control stays open here. Allow pop-ups and try again.'
      : 'Could not open Mirror. Please try again.'

    setMirrorLaunchStatusText(statusMessage)
    mirrorLaunchStatusTimerRef.current = window.setTimeout(() => {
      setMirrorLaunchStatusText(null)
      mirrorLaunchStatusTimerRef.current = null
    }, MIRROR_LAUNCH_STATUS_DURATION_MS)
  }, [event?.id])

  const openFocusedGigControlWindow = useCallback(() => {
    const searchParams = new URLSearchParams()
    searchParams.set('view', 'focus')
    searchParams.set('fullscreen', '1')

    if (event?.id) {
      searchParams.set('event', event.id)
    }

    navigate(`/admin/gig-control?${searchParams.toString()}`)
    setErrorText(null)
  }, [event?.id, navigate])

  const handleGoBackToGigControl = useCallback(() => {
    navigate('/admin/gig-control')
  }, [navigate])

  const openNowPlayingLyrics = useCallback(() => {
    if (!nowPlaying?.title) {
      setErrorText('No now-playing song is available for lyrics yet.')
      return
    }

    const artist = nowPlaying.artist ?? ''
    prefetchAndCacheLyrics(nowPlaying.title, artist)

    const searchParams = new URLSearchParams({
      title: nowPlaying.title,
      artist,
      locale: 'en',
      stage: '1',
      returnTo: `${location.pathname}${location.search}`,
    })

    if (nowPlaying.library_song_id) {
      searchParams.set('songId', nowPlaying.library_song_id)
    }

    navigate(`/lyrics?${searchParams.toString()}`, {
      state: {
        title: nowPlaying.title,
        artist,
        audienceLocale: 'en',
        librarySongId: nowPlaying.library_song_id,
        returnTo: `${location.pathname}${location.search}`,
      },
    })
  }, [location.pathname, location.search, navigate, nowPlaying])

  const handleEnterFocusFullscreen = useCallback(() => {
    if (typeof document === 'undefined' || !document.documentElement.requestFullscreen) {
      setErrorText('Fullscreen is not available in this browser window.')
      return
    }

    void document.documentElement.requestFullscreen()
      .then(() => {
        releaseFullscreenFocus()
      })
      .catch(() => {
        setErrorText('Could not enter fullscreen. Try browser fullscreen (F11).')
      })
  }, [releaseFullscreenFocus])

  const handleSpotifyPlaylistMetaChange = useCallback((playlistMeta: SpotifyPlaylistMeta) => {
    setSelectedSpotifyPlaylistMeta(playlistMeta)
  }, [])

  const selectedSpotifyPlaylistLabel = selectedSpotifyPlaylistMeta?.name?.trim() || 'Not selected yet'
  const selectedSpotifyPlaylistOwnerText = selectedSpotifyPlaylistMeta?.ownerName?.trim()

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
      onClick: async () => {
        if (isManualGoLiveLocked) {
          setErrorText(GO_LIVE_COUNTDOWN_LOCK_MESSAGE)
          return;
        }
        await toggleLiveState();
      },
      title:
        event?.roomOpen
          ? 'Pause the live event — the audience will see a waiting screen'
          : isManualGoLiveLocked
          ? GO_LIVE_COUNTDOWN_LOCK_MESSAGE
          : 'Run health checks and open the room so the audience can join',
      disabled:
        !!globalActionCheckEnabled === false ||
        !!gigActions.quickActionBusy ||
        !!preflightBusy ||
        endGigDecisionBusy !== null ||
        isManualGoLiveLocked,
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
      disabled: !globalActionCheckEnabled || gigActions.quickActionBusy,
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
      disabled: !globalActionCheckEnabled || mirrorOverlayUpdateBusy,
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
      title: selectedSpotifyPlaylistMeta?.name
        ? `Start or resume "${selectedSpotifyPlaylistMeta.name}" without pausing it`
        : 'Start or resume the Spotify between-song playlist without pausing it',
      onClick: () => {
        sendManualSpotifyTransportCommand('play')
      },
      disabled: !globalActionCheckEnabled || !spotifyAccessToken,
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
      {/* Gig header */}
      {endGigPromptEvent ? (
        <section className="queue-panel admin-inline-confirm-banner" role="alertdialog" aria-label="End gig options">
          <p className="subcopy">End "{endGigPromptEvent.name}" now. Keep it offline, or delete it entirely from the app and Gig Control?</p>
          <div className="hero-actions no-margin-bottom">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                void runEndGigDecision('keep-offline')
              }}
              disabled={endGigDecisionBusy !== null}
            >
              {endGigDecisionBusy === 'keep-offline' ? 'Ending Gig...' : 'Keep Offline'}
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void runEndGigDecision('delete')
              }}
              disabled={endGigDecisionBusy !== null}
            >
              {endGigDecisionBusy === 'delete' ? 'Deleting Gig...' : 'Delete Gig'}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setEndGigPromptEvent(null)}
              disabled={endGigDecisionBusy !== null}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {isFocusedGigControlWindow ? (
        <section className="queue-panel gig-control-focus-toolbar" aria-label="Focus window actions">
          <div className="gig-focus-toolbar-sides">
            <div className="hero-actions no-margin-bottom gig-focus-toolbar-nav-actions">
              <button type="button" className="secondary-button" onClick={handleGoBackToGigControl}>
                Go Back to Gig Control
              </button>
              <button type="button" className="ghost-button" onClick={handleEnterFocusFullscreen}>
                Enter Fullscreen
              </button>
            </div>
            <div className="gig-focus-toolbar-spotify-stack">
              <div className="hero-actions no-margin-bottom gig-focus-spotify-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    sendManualSpotifyTransportCommand('previous')
                  }}
                  disabled={!spotifyAccessToken}
                >
                  Spotify Previous
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    sendManualSpotifyTransportCommand('play')
                  }}
                  disabled={!spotifyAccessToken}
                >
                  Spotify Play
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    sendManualSpotifyTransportCommand('next')
                  }}
                  disabled={!spotifyAccessToken}
                >
                  Spotify Next
                </button>
              </div>
              <p className="subcopy no-margin">
                Spotify Toggle: <strong>{spotifyToggle ? 'On (Now Playing = Spotify)' : 'Off (Now Playing = Queue)'}</strong>
              </p>
              <p className="subcopy no-margin">
                Selected Spotify playlist: <strong>{selectedSpotifyPlaylistLabel}</strong>
                {selectedSpotifyPlaylistOwnerText ? ` by ${selectedSpotifyPlaylistOwnerText}` : ''}
              </p>
              {spotifyStatusText ? <p className="meta-badge gig-focus-spotify-status" role="status" aria-live="polite">{spotifyStatusText}</p> : null}
            </div>
          </div>
        </section>
      ) : null}

      {isFocusedGigControlWindow && spotifyAccessToken ? (
        <section className="gig-focus-spotify-driver" aria-hidden="true">
          <SpotifyPlayerWithSDK
            accessToken={spotifyAccessToken}
            onRefreshToken={refreshSpotifyAccessToken}
            transportCommand={spotifyTransportCommand}
            onStatusTextChange={setSpotifyStatusText}
            onPlaylistMetaChange={handleSpotifyPlaylistMetaChange}
          />
        </section>
      ) : null}

      <section className="queue-panel gig-performer-cockpit" aria-label="Performer live cockpit">
        <div className="gig-performer-cockpit-top">
          <p className="gig-control-card-label no-margin-bottom">Performer Live Cockpit</p>
          <div className="gig-performer-status-row" role="status" aria-live="polite">
            <span className={`gig-performer-status-pill ${event.roomOpen ? 'is-live' : 'is-paused'}`}>{liveModeLabel}</span>
            <span className="gig-performer-status-pill is-neutral">{mirrorStateLabel}</span>
            <span className="gig-performer-status-pill is-neutral">Audience {activeAudienceCount ?? 0}</span>
            <span className={`gig-performer-status-pill ${globalActionCheckEnabled ? 'is-live' : 'is-paused'}`}>
              {globalActionCheckEnabled ? 'Global Actions On' : 'Global Actions Off'}
            </span>
          </div>
        </div>
        <div className="gig-performer-controls">
          <button
            type="button"
            className="primary-button"
            disabled={!globalActionCheckEnabled || gigActions.quickActionBusy || preflightBusy || endGigDecisionBusy !== null}
            onClick={async () => {
              await toggleLiveState()
            }}
          >
            {event.roomOpen ? 'Stop Live Concert' : 'Set Live'}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!globalActionCheckEnabled || mirrorOverlayUpdateBusy}
            onClick={async () => {
              await toggleBrbState()
            }}
          >
            {isBrbActive ? 'Resume From Break' : 'Go on Break'}
          </button>
          <button type="button" className="ghost-button" onClick={openMirrorFromGigControl}>
            Open Mirror
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={openNowPlayingLyrics}
            disabled={!nowPlaying?.title}
            title={nowPlaying?.title ? 'Open lyrics for the now-playing song on a stage-friendly screen' : 'Start a song to enable lyrics screen'}
          >
            🎤 Open Lyrics Screen
          </button>
          {!isFocusedGigControlWindow ? (
            <button type="button" className="ghost-button" onClick={openFocusedGigControlWindow}>
              Open Fullscreen Control Board (Same Window)
            </button>
          ) : null}
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
                  {sortedHostEvents.map((hostEvent) => (
                    <option
                      key={hostEvent.id}
                      value={hostEvent.id}
                      title={`${hostEvent.isTestGig ? '[TEST] ' : ''}${formatGigSwitcherDate(hostEvent.gigDate, hostEvent.gigStartTime)} - ${hostEvent.name}${hostEvent.venue ? ` - ${hostEvent.venue}` : ''}`}
                    >
                      {`${hostEvent.isTestGig ? '[TEST] ' : ''}${formatGigSwitcherDate(hostEvent.gigDate, hostEvent.gigStartTime)} · ${hostEvent.name}${hostEvent.venue ? ` · ${hostEvent.venue}` : ''}`}
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
            {!isFocusedGigControlWindow && preflightStatusText ? (
              <p className="meta-badge" aria-live="polite">{preflightStatusText}</p>
            ) : null}
            {!isFocusedGigControlWindow && mirrorLaunchStatusText ? (
              <p className="meta-badge" aria-live="polite">{mirrorLaunchStatusText}</p>
            ) : null}
            {autoLiveCountdown ? (
              <p className="meta-badge gig-auto-live-countdown" aria-live="polite">⏱ {autoLiveCountdown}</p>
            ) : null}
            {!isFocusedGigControlWindow && autoLiveLockBadgeText ? (
              <p className="meta-badge" aria-live="polite">{autoLiveLockBadgeText}</p>
            ) : null}
            {!isFocusedGigControlWindow && autoLiveLastError ? (
              <p className="meta-badge" aria-live="polite">Auto Live issue: {autoLiveLastError}</p>
            ) : null}
            {nextUpSong ? (
              <p className="subcopy gig-next-up-hint" aria-live="polite">
                <span className="gig-next-up-label">Next up</span>
                <span className="gig-next-up-song"><strong>{nextUpSong.title}</strong> — {nextUpSong.artist}</span>
                {nextUpSong.createdByName ? (
                  <span className="gig-next-up-requester">Requested by <strong>{nextUpSong.createdByName}</strong></span>
                ) : null}
                {queueEstMinutes > 0 ? <span className="gig-next-up-queue">~{queueEstMinutes} min queue</span> : null}
              </p>
            ) : null}
            <p className="subcopy gig-playback-note">
              Playback is controlled from this screen. Press Space to start the current song, then Space again to
              move to the quote transition before the next request.
            </p>
          </div>
          <ActionButtonGroup actions={visibleHeaderActions} layoutClassName="gig-control-actions gig-control-primary-actions" />
          {!isFocusedGigControlWindow ? (
            <div className="gig-brb-input-block">
              <div className="gig-brb-input-head">
                <label htmlFor="gig-brb-message" className="gig-switcher-label">BRB message (shown on mirror while paused)</label>
                <button
                  type="button"
                  className="ghost-button gig-brb-roll-button"
                  onClick={() => {
                    void rollBreakMessage()
                  }}
                  disabled={mirrorOverlayUpdateBusy}
                >
                  🎲 Roll Message
                </button>
              </div>
              <input
                id="gig-brb-message"
                className="gig-switcher-select"
                value={brbCustomMessage}
                onChange={(changeEvent) => {
                  setBrbCustomMessage(changeEvent.target.value)
                }}
                placeholder={DEFAULT_BRB_MESSAGE}
              />
              <p className="field-hint">Tip: click Roll Message for a random break line before you go on break.</p>
            </div>
          ) : null}
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
              className="ghost-button gig-mirror-readability-toggle"
              onClick={() => {
                setMirrorMonitorRefreshNonce((currentValue) => currentValue + 1)
              }}
            >
              Reload Monitor
            </button>
          </div>
          <p className="meta-badge" role="status" aria-live="polite">{setlistBucketHintText}</p>
          <p className="meta-badge" role="status" aria-live="polite">{queueAheadMinutesHintText}</p>
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
              className={isFinalSongSoonActive ? 'secondary-button' : 'ghost-button'}
              disabled={mirrorOverlayUpdateBusy}
              onClick={() => {
                void toggleLastSongSoonState()
              }}
            >
              {isFinalSongSoonActive ? 'Stop New Requests: On (Allow Requests)' : 'Stop New Requests: Off (Stop Requests)'}
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
            <iframe
              key={mirrorMonitorUrl}
              title="Live mirror monitor"
              src={mirrorMonitorUrl}
              className="gig-mirror-live-embed"
              loading="lazy"
              allow="fullscreen"
              tabIndex={-1}
              onMouseDown={(event) => {
                // Keep keyboard focus on Gig Control so Spacebar shortcuts remain reliable.
                event.preventDefault()
              }}
            />
          </div>
          <p className="subcopy no-margin">This monitor now renders the exact mirror route in real time, including countdown and live now-playing states.</p>
        </article>

        {!isFocusedGigControlWindow ? (
          <article className="qr-card gig-control-qr-card" aria-label="Audience join tools">
            <p className="gig-control-card-label">{isQrTargetTestGig ? 'Test Audience QR' : 'Audience Join QR'}</p>
            {hostEvents.length > 1 ? (
              <p className="subcopy">QR target follows the active mirror gig automatically.</p>
            ) : null}
            <div className="gig-control-qr-frame">
              <img src={qrUrl} alt={isQrTargetTestGig ? 'QR code for test audience page' : 'QR code for audience join page'} className="qr-image" />
            </div>
            <p className="subcopy">
              {isQrTargetTestGig
                ? 'Private test mode: use this Test Audience page while signed in as host.'
                : 'Show this on your mirror screen so guests can scan and join.'}
            </p>
            <button
              type="button"
              className="secondary-button"
              title={isQrTargetTestGig ? 'Copy the test audience link for host preview' : 'Copy the audience join link to share with your guests'}
              onClick={async () => {
                await copyJoinUrl()
              }}
            >
              {copiedAudienceLink ? 'Copied!' : isQrTargetTestGig ? 'Copy Test Audience Link' : 'Copy Audience Link'}
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
            {!isQrTargetTestGig ? (
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
        ) : null}
      </section>

      {!isFocusedGigControlWindow ? (
        <>

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
            <p className="subcopy no-margin">
              Spotify Toggle: <strong>{spotifyToggle ? 'On (Now Playing = Spotify)' : 'Off (Now Playing = Queue)'}</strong>
            </p>
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
            <p className="subcopy no-margin">
              Selected Spotify playlist: <strong>{selectedSpotifyPlaylistLabel}</strong>
              {selectedSpotifyPlaylistOwnerText ? ` by ${selectedSpotifyPlaylistOwnerText}` : ''}
            </p>
          </section>

          <SpotifyPlayerWithSDK
            accessToken={spotifyAccessToken}
            onRefreshToken={refreshSpotifyAccessToken}
            transportCommand={spotifyTransportCommand}
            onStatusTextChange={setSpotifyStatusText}
            onPlaylistMetaChange={handleSpotifyPlaylistMetaChange}
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
                  className="ghost-button"
                  title="Open a stage-friendly lyrics screen for the current song"
                  onClick={openNowPlayingLyrics}
                >
                  🎤 Open Lyrics Screen
                </button>
                <button
                  type="button"
                  className="primary-button"
                  title="Switch back to Quote / between-songs mode (Space)"
                  onClick={async () => {
                    try {
                      await runGlobalToggleQuoteNowPlaying()
                    } catch (error) {
                      console.warn('GigControlPage: toggle playback failed', error)
                      setErrorText('Playback toggle failed. Please try again.')
                    }
                  }}
                >
                  ◀ Show Quote
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  title="Mark this song as played and move to the next one"
                  disabled={spaceActionBusy || songActionBusyId === nowPlaying.id || isPlaybackTransitionLocked}
                  onClick={async () => {
                    try {
                      await runQueueTogglePlayShortcut()
                      sendSpotifyTransportCommand('play', { force: true })
                    } catch (error) {
                      console.warn('GigControlPage: toggle playback failed', error)
                      setErrorText('Playback control failed. Please try again.')
                    }
                  }}
                >
                  ✓ Mark as Played
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  title="Remove this song from the queue without marking it as played"
                  disabled={spaceActionBusy || songActionBusyId === nowPlaying.id || isPlaybackTransitionLocked}
                  onClick={async () => {
                    if (spaceActionBusy || playbackActionLockRef.current || songActionBusyId === nowPlaying.id || isPlaybackTransitionLocked) {
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
                Playing now. {event?.roomOpen ? 'Press Space to toggle queue play/pause for this song.' : 'Spacebar is disabled until gig is live.'}
              </p>
            </>
          ) : nowPlaying ? (
            <>
              <div className="gig-between-songs-state">
                <p className="gig-between-songs-quote">{betweenSongQuote}</p>
                <p className="subcopy gig-between-songs-hint">
                  {'Tap Go Live or '}
                  {event?.roomOpen ? 'press Space to play/pause Spotify only.' : 'Spacebar is disabled until gig is live.'}
                </p>
              </div>
              <div className="hero-actions gig-now-playing-actions gig-control-touch-actions">
                <button
                  type="button"
                  className="ghost-button"
                  title="Open a stage-friendly lyrics screen for the current song"
                  onClick={openNowPlayingLyrics}
                >
                  🎤 Open Lyrics Screen
                </button>
                <button
                  type="button"
                  className="primary-button"
                  title="Switch to Now Playing mode — broadcasts instantly to all screens (Space)"
                  onClick={async () => {
                    try {
                      await runGlobalToggleQuoteNowPlaying()
                    } catch (error) {
                      console.warn('GigControlPage: toggle playback failed', error)
                      setErrorText('Playback toggle failed. Please try again.')
                    }
                  }}
                >
                  ▶ Go Live
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
          <span className="meta-badge">{queueModeLabel}</span>
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
                  <button
                    type="button"
                    className="secondary-button"
                    title="Set this song as the last song (encore)"
                    disabled={songActionBusyId === song.id || upNext.length < 1}
                    onClick={async () => {
                      if (songActionBusyId === song.id) return;
                      setSongActionBusyId(song.id);
                      try {
                        // Move song to end and activate last-song mode
                        await reorderSong(song.id, songs.length - 1);
                        if (!isFinalSongSoonActive) await toggleLastSongSoonState();
                      } catch {
                        setErrorText('Failed to set as last song.');
                      } finally {
                        setSongActionBusyId(null);
                      }
                    }}
                  >
                    🎵 Set as Last Song
                  </button>
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

        </>
      ) : null}

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
