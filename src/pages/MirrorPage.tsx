import { useEffect, useMemo, useRef, useState } from 'react'
import LiveFeedPanel from '../components/LiveFeedPanel'
import { getAudienceUrl } from '../lib/audienceUrl'
import {
  BETWEEN_SONG_QUOTES,
  PLAYBACK_STATE_EVENT,
  readSharedPlaybackState,
  type SharedPlaybackState,
} from '../lib/playbackState'
import { supabase } from '../lib/supabase'
import { useQueueStore } from '../state/queueStore'
import { useAuthStore } from '../state/authStore'
import { setGigOGTags, resetOGTags } from '../lib/metaTags'
import { readTextFromLocalStorage, saveTextToLocalStorage } from '../lib/saveHandling'

type FeedImageSpotlight = {
  id: string
  eventId: string
  imageDataUrl: string
  authorName: string
  caption: string
}

const SPOTLIGHT_CAPTION_BUILDERS = [
  (authorName: string) => `${authorName}, you just lit up the room!`,
  (authorName: string) => `${authorName} brought the party to the big screen!`,
  (authorName: string) => `${authorName} just served a main character moment!`,
  (authorName: string) => `${authorName}'s crowd cam drop is pure gold!`,
  (authorName: string) => `Big cheers for ${authorName} and this dance-floor classic!`,
  (authorName: string) => `${authorName} just gave tonight another highlight reel!`,
]

const SPOTLIGHT_DURATION_MS = 7000
const SPOTLIGHT_POLL_INTERVAL_MS = 2000
const MIRROR_HIGH_CONTRAST_STORAGE_KEY = 'human-jukebox-mirror-high-contrast'
const MIRROR_PLAYBACK_STORAGE_KEY = 'human-jukebox-playback-state'
const MIRROR_PLAYBACK_BROADCAST_CHANNEL = 'human-jukebox-playback-state'
const MIRROR_SAFE_MARGINS_STORAGE_KEY = 'human-jukebox-mirror-safe-margins'
const MIRROR_VENUE_MODE_STORAGE_KEY = 'human-jukebox-mirror-venue-mode'

type MirrorDensityMode = 'medium' | 'cinema'
type MirrorVenueMode = 'club' | 'lounge' | 'festival'

function resolveMirrorVenueMode(value: string | null | undefined): MirrorVenueMode | null {
  if (!value) {
    return null
  }

  const normalizedValue = value.trim().toLowerCase()

  if (normalizedValue === 'club' || normalizedValue === 'tight') {
    return 'club'
  }

  if (normalizedValue === 'festival' || normalizedValue === 'big-stage' || normalizedValue === 'arena') {
    return 'festival'
  }

  if (normalizedValue === 'lounge' || normalizedValue === 'balanced') {
    return 'lounge'
  }

  return null
}

function normalizeMirrorText(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmedValue = value.trim()
  return trimmedValue || fallback
}

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

function getActiveFullscreenElement() {
  const fullscreenDocument = document as FullscreenDocument
  return document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null
}

async function requestFullscreenSafe(targetElement: HTMLElement) {
  const fullscreenTarget = targetElement as FullscreenElement

  if (typeof fullscreenTarget.requestFullscreen === 'function') {
    await fullscreenTarget.requestFullscreen()
    return
  }

  if (typeof fullscreenTarget.webkitRequestFullscreen === 'function') {
    await fullscreenTarget.webkitRequestFullscreen()
    return
  }

  throw new Error('Fullscreen API is unavailable in this browser.')
}

async function exitFullscreenSafe() {
  const fullscreenDocument = document as FullscreenDocument

  if (typeof document.exitFullscreen === 'function') {
    await document.exitFullscreen()
    return
  }

  if (typeof fullscreenDocument.webkitExitFullscreen === 'function') {
    await fullscreenDocument.webkitExitFullscreen()
    return
  }

  throw new Error('Exiting fullscreen is unavailable in this browser.')
}

type SpotlightQueueItem = {
  id: string
  eventId: string
  imageDataUrl: string
  authorName: string
}

function pickSpotlightCaption(authorName: string) {
  const captionBuilder = SPOTLIGHT_CAPTION_BUILDERS[Math.floor(Math.random() * SPOTLIGHT_CAPTION_BUILDERS.length)]
  return captionBuilder(authorName)
}

function playShutterSound() {
  try {
    const audioContext = new window.AudioContext()

    if (audioContext.state === 'suspended') {
      void audioContext.close()
      return false
    }

    const gainNode = audioContext.createGain()
    const oscillator = audioContext.createOscillator()

    oscillator.type = 'square'
    oscillator.frequency.setValueAtTime(1560, audioContext.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(720, audioContext.currentTime + 0.06)

    gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.065, audioContext.currentTime + 0.012)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.09)

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.1)

    window.setTimeout(() => {
      void audioContext.close()
    }, 160)

    return true
  } catch {
    // Some browsers block autoplay audio; visual flash still runs.
    return false
  }
}

function MirrorPage() {
  const { event, songs, loading } = useQueueStore()
  const { isHost } = useAuthStore()
  const [spotlight, setSpotlight] = useState<FeedImageSpotlight | null>(null)
  const [flashActive, setFlashActive] = useState(false)
  const [queuedSpotlightCount, setQueuedSpotlightCount] = useState(0)
  const [playbackState, setPlaybackState] = useState<SharedPlaybackState | null>(null)
  const [mirrorWarning, setMirrorWarning] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [highContrastMode, setHighContrastMode] = useState(false)
  const [densityMode, setDensityMode] = useState<MirrorDensityMode>('medium')
  const [venueMode, setVenueMode] = useState<MirrorVenueMode>('lounge')
  const [showSafeMargins, setShowSafeMargins] = useState(false)
  const [_storageError, _setStorageError] = useState<string | null>(null)
  const [hideControlsForAudience, setHideControlsForAudience] = useState(false)
  const [fallbackBetweenSongs, setFallbackBetweenSongs] = useState(false)
  const [fallbackQuoteIndex, setFallbackQuoteIndex] = useState(0)
  const [showShutterFallbackPulse, setShowShutterFallbackPulse] = useState(false)
  const [failedCoverUrls, setFailedCoverUrls] = useState<Record<string, true>>({})
  const spotlightTimerRef = useRef<number | null>(null)
  const fallbackBetweenSongsTimerRef = useRef<number | null>(null)
  const shutterFallbackPulseTimerRef = useRef<number | null>(null)
  const previousSongIdRef = useRef<string | null>(null)
  const spotlightQueueRef = useRef<SpotlightQueueItem[]>([])
  const spotlightBusyRef = useRef(false)
  const seenSpotlightPostIdsRef = useRef<Set<string>>(new Set())

  const safeSongs = useMemo(() => songs.filter((song) => (
    song
    && typeof song.id === 'string'
    && typeof song.title === 'string'
    && typeof song.artist === 'string'
  )), [songs])
  const nowPlaying = safeSongs[0]
  const isLive = event?.roomOpen ?? false
  const isEmbeddedPreview =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1'
  const eventId = event?.id ?? null
  const audienceUrlResolver = getAudienceUrl as (...args: unknown[]) => string
  const audienceUrl = audienceUrlResolver(eventId, { compact: true })
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encodeURIComponent(audienceUrl)}`
  const playbackSong = playbackState?.currentSongId
    ? safeSongs.find((song) => song.id === playbackState.currentSongId) ?? null
    : null
  const activeSong = playbackSong ?? nowPlaying
  const isNowPlayingStarted = Boolean(playbackState?.isStarted && playbackState.currentSongId)
  const hasPlaybackBetweenSongsState = Boolean(playbackState && !playbackState.isStarted && safeSongs.length > 0)
  const isBetweenSongs = hasPlaybackBetweenSongsState || fallbackBetweenSongs
  const shouldCompactQueue = safeSongs.length > 6
  const upNext = isNowPlayingStarted
    ? safeSongs.filter((song) => song.id !== (playbackSong?.id ?? nowPlaying?.id)).slice(0, 4)
    : safeSongs.slice(0, 4)
  const hiddenQueueCount = Math.max(0, safeSongs.length - (isNowPlayingStarted ? 1 : 0) - upNext.length)
  const betweenSongQuoteIndex = hasPlaybackBetweenSongsState
    ? (playbackState?.quoteIndex ?? 0)
    : fallbackQuoteIndex
  const betweenSongQuote = BETWEEN_SONG_QUOTES[betweenSongQuoteIndex % BETWEEN_SONG_QUOTES.length]

  const showSpotlight = (event?.mirrorPhotoSpotlightEnabled ?? true) && !isEmbeddedPreview
  const shouldShowEditorControls = isHost && !hideControlsForAudience && !isEmbeddedPreview
  const shouldShowAdminElements = isHost

  const onCoverLoadError = (coverUrl: string | null | undefined) => {
    if (!coverUrl) {
      return
    }

    setFailedCoverUrls((currentUrls) => {
      if (currentUrls[coverUrl]) {
        return currentUrls
      }

      return { ...currentUrls, [coverUrl]: true }
    })
  }

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(getActiveFullscreenElement()))
    }

    syncFullscreenState()
    window.addEventListener('fullscreenchange', syncFullscreenState)
    window.addEventListener('webkitfullscreenchange', syncFullscreenState)

    return () => {
      window.removeEventListener('fullscreenchange', syncFullscreenState)
      window.removeEventListener('webkitfullscreenchange', syncFullscreenState)
    }
  }, [])

  useEffect(() => {
    const syncPresentationState = () => {
      const fullscreenActive = Boolean(getActiveFullscreenElement())
      const fullscreenDisplayMode = window.matchMedia('(display-mode: fullscreen)').matches
      const projectedMode = fullscreenActive || fullscreenDisplayMode

      setHideControlsForAudience(projectedMode)
    }

    syncPresentationState()
    window.addEventListener('fullscreenchange', syncPresentationState)
    window.addEventListener('webkitfullscreenchange', syncPresentationState)
    window.addEventListener('resize', syncPresentationState)

    return () => {
      window.removeEventListener('fullscreenchange', syncPresentationState)
      window.removeEventListener('webkitfullscreenchange', syncPresentationState)
      window.removeEventListener('resize', syncPresentationState)
    }
  }, [])

  useEffect(() => {
    const onRuntimeError = () => {
      setMirrorWarning('Mirror recovered from a runtime issue. Showing last known state.')
    }

    const onUnhandledRejection = () => {
      setMirrorWarning('Mirror sync is retrying in the background. Display remains live.')
    }

    window.addEventListener('error', onRuntimeError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      window.removeEventListener('error', onRuntimeError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const searchParams = new URLSearchParams(window.location.search)
    const contrastParam = searchParams.get('contrast')?.trim().toLowerCase()
      ?? searchParams.get('hc')?.trim().toLowerCase()
    const densityParam = searchParams.get('density')?.trim().toLowerCase()
      ?? searchParams.get('dm')?.trim().toLowerCase()
    const venueParam = searchParams.get('venue')?.trim().toLowerCase()
      ?? searchParams.get('vm')?.trim().toLowerCase()
    const safeMarginsParam = searchParams.get('safeMargins')?.trim().toLowerCase()
      ?? searchParams.get('safe')?.trim().toLowerCase()

    const hasContrastQuery = contrastParam === '1' || contrastParam === 'high' || contrastParam === 'true'
    const persistedContrastPreference = readTextFromLocalStorage(MIRROR_HIGH_CONTRAST_STORAGE_KEY) === '1'
    const hasSafeMarginsQuery = safeMarginsParam === '1' || safeMarginsParam === 'on' || safeMarginsParam === 'true'
    const persistedSafeMarginsPreference = readTextFromLocalStorage(MIRROR_SAFE_MARGINS_STORAGE_KEY) === '1'
    const persistedVenueMode = resolveMirrorVenueMode(readTextFromLocalStorage(MIRROR_VENUE_MODE_STORAGE_KEY))
    const resolvedVenueMode = resolveMirrorVenueMode(venueParam) ?? persistedVenueMode ?? 'lounge'
    const resolvedDensityMode: MirrorDensityMode = densityParam === 'cinema' || densityParam === 'xl' || densityParam === 'large'
      ? 'cinema'
      : 'medium'

    setHighContrastMode(hasContrastQuery || persistedContrastPreference)
    setDensityMode(resolvedDensityMode)
    setVenueMode(resolvedVenueMode)
    setShowSafeMargins(hasSafeMarginsQuery || persistedSafeMarginsPreference)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const result = saveTextToLocalStorage(MIRROR_HIGH_CONTRAST_STORAGE_KEY, highContrastMode ? '1' : '0')
    if (result.success) {
      _setStorageError(null)
      return
    }

    _setStorageError(result.error ?? 'Could not save contrast preference')
    console.warn('MirrorPage: failed to save high contrast mode', result.error)
  }, [highContrastMode])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const result = saveTextToLocalStorage(MIRROR_SAFE_MARGINS_STORAGE_KEY, showSafeMargins ? '1' : '0')
    if (result.success) {
      _setStorageError(null)
      return
    }

    _setStorageError(result.error ?? 'Could not save safe margins preference')
    console.warn('MirrorPage: failed to save safe margins', result.error)
  }, [showSafeMargins])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const result = saveTextToLocalStorage(MIRROR_VENUE_MODE_STORAGE_KEY, venueMode)
    if (result.success) {
      _setStorageError(null)
      return
    }

    _setStorageError(result.error ?? 'Could not save venue mode preference')
    console.warn('MirrorPage: failed to save venue mode', result.error)
  }, [venueMode])

  // Update OG meta tags for social media sharing
  useEffect(() => {
    if (!event) {
      resetOGTags()
      return
    }

    const gigUrl = typeof window !== 'undefined' ? window.location.href : undefined
    setGigOGTags(event.name, event.venue ?? null, event.name, undefined, gigUrl)
  }, [event?.id, event?.name, event?.venue])

  useEffect(() => {
    if (!eventId) {
      setPlaybackState(null)
      return
    }

    let isCurrent = true
    let subscription: ReturnType<typeof supabase.channel> | null = null
    let playbackBroadcastChannel: BroadcastChannel | null = null
    let playbackHealthTimerId: number | null = null
    let reconnectTimerId: number | null = null
    let reconnectAttempt = 0

    const clearReconnectTimer = () => {
      if (reconnectTimerId !== null) {
        window.clearTimeout(reconnectTimerId)
        reconnectTimerId = null
      }
    }

    const disconnectSubscription = () => {
      if (subscription) {
        void subscription.unsubscribe()
        subscription = null
      }
    }

    const syncPlaybackState = async () => {
      if (!isCurrent) return

      try {
        const state = await readSharedPlaybackState(eventId)

        if (isCurrent) {
          if (state) {
            setPlaybackState(state)
            setMirrorWarning(null)
            return
          }

          setMirrorWarning('Realtime playback sync is reconnecting. Using queue fallback.')
        }
      } catch {
        if (isCurrent) {
          setMirrorWarning('Realtime playback sync is reconnecting. Using queue fallback.')
        }
      }
    }

    const reconnectSubscription = () => {
      if (!isCurrent) {
        return
      }

      clearReconnectTimer()
      disconnectSubscription()

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
          () => {
            void syncPlaybackState()
          },
        )
        .subscribe((status) => {
          if (!isCurrent) {
            return
          }

          if (status === 'SUBSCRIBED') {
            reconnectAttempt = 0
            setMirrorWarning(null)
            void syncPlaybackState()
            return
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setMirrorWarning('Mirror realtime channel reconnecting. Display remains active.')

            if (reconnectTimerId !== null) {
              return
            }

            const retryDelayMs = Math.min(1000 * (2 ** reconnectAttempt), 8000)
            reconnectAttempt += 1
            reconnectTimerId = window.setTimeout(() => {
              reconnectTimerId = null
              reconnectSubscription()
              void syncPlaybackState()
            }, retryDelayMs)
          }
        })
    }

    const recoverMirrorSync = () => {
      if (!isCurrent) {
        return
      }

      reconnectSubscription()
      void syncPlaybackState()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        recoverMirrorSync()
      }
    }

    const onWindowFocus = () => {
      recoverMirrorSync()
    }

    const onOnline = () => {
      recoverMirrorSync()
    }

    const onPageShow = () => {
      recoverMirrorSync()
    }

    const onPlaybackStateEvent = (nextEvent: Event) => {
      const detail = (nextEvent as CustomEvent<{ eventId: string; state: SharedPlaybackState }>).detail

      if (detail?.eventId === eventId) {
        setPlaybackState(detail.state)
        setMirrorWarning(null)
      }
    }

    const onStoragePlaybackState = (nextEvent: StorageEvent) => {
      if (nextEvent.key !== MIRROR_PLAYBACK_STORAGE_KEY || !nextEvent.newValue) {
        return
      }

      try {
        const detail = JSON.parse(nextEvent.newValue) as { eventId?: string; state?: SharedPlaybackState }
        if (detail.eventId === eventId && detail.state) {
          setPlaybackState(detail.state)
          setMirrorWarning(null)
        }
      } catch {
        // Ignore malformed storage payloads.
      }
    }

    void syncPlaybackState()
    reconnectSubscription()
    window.addEventListener(PLAYBACK_STATE_EVENT, onPlaybackStateEvent as EventListener)
    window.addEventListener('storage', onStoragePlaybackState)
    window.addEventListener('focus', onWindowFocus)
    window.addEventListener('online', onOnline)
    window.addEventListener('pageshow', onPageShow)

    if ('BroadcastChannel' in window) {
      playbackBroadcastChannel = new BroadcastChannel(MIRROR_PLAYBACK_BROADCAST_CHANNEL)
      playbackBroadcastChannel.onmessage = (messageEvent: MessageEvent<{ eventId?: string; state?: SharedPlaybackState }>) => {
        const detail = messageEvent.data
        if (detail?.eventId === eventId && detail.state) {
          setPlaybackState(detail.state)
          setMirrorWarning(null)
        }
      }
    }

    playbackHealthTimerId = window.setInterval(() => {
      void syncPlaybackState()
    }, 15000)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      isCurrent = false
      clearReconnectTimer()
      disconnectSubscription()
      if (playbackHealthTimerId) {
        window.clearInterval(playbackHealthTimerId)
      }
      window.removeEventListener(PLAYBACK_STATE_EVENT, onPlaybackStateEvent as EventListener)
      window.removeEventListener('storage', onStoragePlaybackState)
      window.removeEventListener('focus', onWindowFocus)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      playbackBroadcastChannel?.close()
    }
  }, [eventId])

  useEffect(() => {
    return () => {
      if (spotlightTimerRef.current) {
        window.clearTimeout(spotlightTimerRef.current)
      }
      if (fallbackBetweenSongsTimerRef.current) {
        window.clearTimeout(fallbackBetweenSongsTimerRef.current)
      }
      if (shutterFallbackPulseTimerRef.current) {
        window.clearTimeout(shutterFallbackPulseTimerRef.current)
      }
      spotlightBusyRef.current = false
      spotlightQueueRef.current = []
    }
  }, [])

  useEffect(() => {
    // When playback state says "between songs", trust that as the source of truth.
    if (hasPlaybackBetweenSongsState) {
      if (fallbackBetweenSongsTimerRef.current) {
        window.clearTimeout(fallbackBetweenSongsTimerRef.current)
        fallbackBetweenSongsTimerRef.current = null
      }

      setFallbackBetweenSongs(false)
    }
  }, [hasPlaybackBetweenSongsState])

  useEffect(() => {
    const nextSongId = songs[0]?.id ?? null

    if (!nextSongId) {
      previousSongIdRef.current = null
      setFallbackBetweenSongs(false)
      return
    }

    const previousSongId = previousSongIdRef.current
    const hasSongTransition = Boolean(previousSongId && previousSongId !== nextSongId)

    // Fallback for missed storage sync across tabs/devices: show an interstitial quote on song change.
    if (hasSongTransition && !hasPlaybackBetweenSongsState) {
      const nextQuoteIndex = ((playbackState?.quoteIndex ?? fallbackQuoteIndex) + 1) % BETWEEN_SONG_QUOTES.length
      setFallbackQuoteIndex(nextQuoteIndex)
      setFallbackBetweenSongs(true)

      if (fallbackBetweenSongsTimerRef.current) {
        window.clearTimeout(fallbackBetweenSongsTimerRef.current)
      }

      fallbackBetweenSongsTimerRef.current = window.setTimeout(() => {
        setFallbackBetweenSongs(false)
        fallbackBetweenSongsTimerRef.current = null
      }, 5000)
    }

    previousSongIdRef.current = nextSongId
  }, [fallbackQuoteIndex, hasPlaybackBetweenSongsState, playbackState?.quoteIndex, safeSongs])

  useEffect(() => {
    if (!eventId || !showSpotlight) {
      spotlightQueueRef.current = []
      spotlightBusyRef.current = false
      seenSpotlightPostIdsRef.current = new Set()

      if (spotlightTimerRef.current) {
        window.clearTimeout(spotlightTimerRef.current)
        spotlightTimerRef.current = null
      }
      return
    }

    const startSpotlight = (nextItem: SpotlightQueueItem) => {
      spotlightBusyRef.current = true
      setFlashActive(true)
      const shutterSoundPlayed = playShutterSound()

      if (!shutterSoundPlayed) {
        setShowShutterFallbackPulse(true)

        if (shutterFallbackPulseTimerRef.current) {
          window.clearTimeout(shutterFallbackPulseTimerRef.current)
        }

        shutterFallbackPulseTimerRef.current = window.setTimeout(() => {
          setShowShutterFallbackPulse(false)
          shutterFallbackPulseTimerRef.current = null
        }, 840)
      }

      setQueuedSpotlightCount(spotlightQueueRef.current.length)

      window.setTimeout(() => {
        setFlashActive(false)
      }, 220)

      setSpotlight({
        id: nextItem.id,
        eventId: nextItem.eventId,
        imageDataUrl: nextItem.imageDataUrl,
        authorName: nextItem.authorName,
        caption: pickSpotlightCaption(nextItem.authorName),
      })

      if (spotlightTimerRef.current) {
        window.clearTimeout(spotlightTimerRef.current)
      }

      spotlightTimerRef.current = window.setTimeout(() => {
        setSpotlight(null)
        spotlightBusyRef.current = false
        spotlightTimerRef.current = null

        const queuedItem = spotlightQueueRef.current.shift()
        setQueuedSpotlightCount(spotlightQueueRef.current.length)

        if (queuedItem) {
          startSpotlight(queuedItem)
        }
      }, SPOTLIGHT_DURATION_MS)
    }

    const enqueueSpotlight = (nextItem: SpotlightQueueItem) => {
      if (spotlightBusyRef.current) {
        spotlightQueueRef.current.push(nextItem)
        setQueuedSpotlightCount(spotlightQueueRef.current.length)
        return
      }

      startSpotlight(nextItem)
    }

    const trackAndEnqueueSpotlight = (nextPost: {
      id?: string
      image_data_url?: string | null
      author_name?: string | null
    }) => {
      if (!nextPost.image_data_url || !nextPost.id) {
        return
      }

      if (seenSpotlightPostIdsRef.current.has(nextPost.id)) {
        return
      }

      seenSpotlightPostIdsRef.current.add(nextPost.id)

      enqueueSpotlight({
        id: nextPost.id,
        eventId,
        imageDataUrl: nextPost.image_data_url,
        authorName: nextPost.author_name?.trim() || 'Guest',
      })
    }

    let isCurrent = true
    let channel: ReturnType<typeof supabase.channel> | null = null
    let reconnectTimerId: number | null = null
    let reconnectAttempt = 0

    const clearReconnectTimer = () => {
      if (reconnectTimerId !== null) {
        window.clearTimeout(reconnectTimerId)
        reconnectTimerId = null
      }
    }

    const disconnectSpotlightChannel = () => {
      if (!channel) {
        return
      }

      void supabase.removeChannel(channel)
      channel = null
    }

    const loadRecentImagePosts = async (seedOnly: boolean) => {
      const { data, error } = await supabase
        .from('feed_posts')
        .select('id, image_data_url, author_name, created_at')
        .eq('event_id', eventId)
        .not('image_data_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(15)

      if (!isCurrent) {
        return
      }

      if (error) {
        setMirrorWarning('Crowd spotlight sync is reconnecting.')
        return
      }

      if (!data?.length) {
        return
      }

      const orderedPosts = [...data].reverse()

      for (const nextPost of orderedPosts) {
        if (!nextPost.id) {
          continue
        }

        if (seedOnly) {
          seenSpotlightPostIdsRef.current.add(nextPost.id)
          continue
        }

        trackAndEnqueueSpotlight(nextPost)
      }
    }

    const reconnectSpotlightChannel = () => {
      if (!isCurrent) {
        return
      }

      clearReconnectTimer()
      disconnectSpotlightChannel()

      channel = supabase
        .channel(`mirror-feed-spotlight-${eventId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'feed_posts',
            filter: `event_id=eq.${eventId}`,
          },
          (payload) => {
            const nextPost = payload.new as { id?: string; image_data_url?: string | null; author_name?: string | null }
            trackAndEnqueueSpotlight(nextPost)
          },
        )
        .subscribe((status) => {
          if (!isCurrent) {
            return
          }

          if (status === 'SUBSCRIBED') {
            reconnectAttempt = 0
            setMirrorWarning(null)
            return
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setMirrorWarning('Crowd spotlight sync is reconnecting.')

            if (reconnectTimerId !== null) {
              return
            }

            const retryDelayMs = Math.min(1000 * (2 ** reconnectAttempt), 8000)
            reconnectAttempt += 1
            reconnectTimerId = window.setTimeout(() => {
              reconnectTimerId = null
              reconnectSpotlightChannel()
              void loadRecentImagePosts(false)
            }, retryDelayMs)
          }
        })
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reconnectSpotlightChannel()
        void loadRecentImagePosts(false)
      }
    }

    const onWindowFocus = () => {
      reconnectSpotlightChannel()
      void loadRecentImagePosts(false)
    }

    const onOnline = () => {
      reconnectSpotlightChannel()
      void loadRecentImagePosts(false)
    }

    const onPageShow = () => {
      reconnectSpotlightChannel()
      void loadRecentImagePosts(false)
    }

    void loadRecentImagePosts(true)
    reconnectSpotlightChannel()

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onWindowFocus)
    window.addEventListener('online', onOnline)
    window.addEventListener('pageshow', onPageShow)

    const pollTimerId = window.setInterval(() => {
      if (isCurrent) {
        void loadRecentImagePosts(false)
      }
    }, SPOTLIGHT_POLL_INTERVAL_MS)

    return () => {
      isCurrent = false
      clearReconnectTimer()
      window.clearInterval(pollTimerId)
      if (spotlightTimerRef.current) {
        window.clearTimeout(spotlightTimerRef.current)
        spotlightTimerRef.current = null
      }
      if (shutterFallbackPulseTimerRef.current) {
        window.clearTimeout(shutterFallbackPulseTimerRef.current)
        shutterFallbackPulseTimerRef.current = null
      }
      seenSpotlightPostIdsRef.current = new Set()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onWindowFocus)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pageshow', onPageShow)
      disconnectSpotlightChannel()
    }
  }, [eventId, showSpotlight])

  const activeSpotlight = useMemo(() => {
    if (!eventId || !spotlight || spotlight.eventId !== eventId) {
      return null
    }

    return spotlight
  }, [eventId, spotlight])

  if (loading) {
    return (
      <div className="mirror-shell">
        <p className="mirror-loading">Connecting to stage…</p>
      </div>
    )
  }

  return (
    <div className={`mirror-shell ${isLive ? 'mirror-shell-live' : 'mirror-shell-paused'} ${highContrastMode ? 'mirror-shell-high-contrast' : ''} ${densityMode === 'cinema' ? 'mirror-shell-density-cinema' : 'mirror-shell-density-medium'} mirror-shell-venue-${venueMode} ${!shouldShowEditorControls ? 'mirror-shell-hide-controls' : ''}`} aria-label="Mirror display screen">
      <header className="mirror-header">
        <div className="mirror-header-main">
          <p className="mirror-brand">🎸 Human Jukebox</p>
          {event ? (
            <div>
              <p className="mirror-event-name">
                {normalizeMirrorText(event.name, 'Live Event')}
                {event.venue ? ` · ${normalizeMirrorText(event.venue, '')}` : ''}
              </p>
              {event.subtitle ? <p className="mirror-event-subtitle">{normalizeMirrorText(event.subtitle, '')}</p> : null}
            </div>
          ) : null}
        </div>
        <div className="mirror-header-meta">
          {mirrorWarning ? <p className="mirror-warning" role="status">{mirrorWarning}</p> : null}
          <span className={`mirror-status ${event?.roomOpen ? 'mirror-open' : 'mirror-paused'}`}>
            {event?.roomOpen ? '● Live' : '● Paused'}
          </span>
        </div>
        {shouldShowEditorControls ? (
          <div className="mirror-editor-controls" aria-label="Mirror editor controls">
            <button
              type="button"
              className="mirror-fullscreen-button"
              onClick={async () => {
                try {
                  if (!getActiveFullscreenElement()) {
                    await requestFullscreenSafe(document.documentElement)
                  } else {
                    await exitFullscreenSafe()
                  }
                } catch (error) {
                  console.warn('MirrorPage: fullscreen toggle failed', error)
                  setMirrorWarning('Fullscreen was blocked by the browser or iframe policy. Open /mirror in its own tab, then press F11 as fallback.')
                }
              }}
            >
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
            <button
              type="button"
              className="mirror-contrast-button"
              onClick={() => setHighContrastMode((currentMode) => !currentMode)}
            >
              {highContrastMode ? 'High Contrast: On' : 'High Contrast: Off'}
            </button>
            <button
              type="button"
              className="mirror-contrast-button"
              onClick={() => setShowSafeMargins((currentValue) => !currentValue)}
            >
              {showSafeMargins ? 'Safe Margins: On' : 'Safe Margins: Off'}
            </button>
            <button
              type="button"
              className="mirror-contrast-button"
              onClick={() => {
                setVenueMode((currentMode) => {
                  if (currentMode === 'club') {
                    return 'lounge'
                  }

                  if (currentMode === 'lounge') {
                    return 'festival'
                  }

                  return 'club'
                })
              }}
            >
              Venue: {venueMode === 'club' ? 'Club' : venueMode === 'festival' ? 'Festival' : 'Lounge'}
            </button>
          </div>
        ) : null}
        {isLive ? (
          <div className="mirror-header-qr" aria-label="Audience join QR">
            <img src={qrUrl} alt="QR code for the audience request page" className="mirror-header-qr-image" />
          </div>
        ) : null}
      </header>

      <main className={`mirror-stage ${isLive ? 'mirror-stage-live' : ''}`}>
        {!isLive ? (
          <section className="mirror-pre-show" aria-label="Pre-show welcome">
            <h1 className="mirror-pre-show-title">Welcome to the show!</h1>
            <p className="mirror-pre-show-subtitle">No pressure — just enjoy yourself and blame the rest on the music.</p>
            <div className="mirror-qr-block">
              <img src={qrUrl} alt="QR code for the audience request page" className="mirror-qr-image" />
              <div className="mirror-qr-copy">
                <p className="mirror-qr-label">Scan to join</p>
                <p>Open the audience app at <strong>{audienceUrl}</strong></p>
              </div>
            </div>
            <div className="mirror-how-it-works" aria-label="How it works">
              <p className="mirror-how-it-works-label">How It Works</p>
              <p>1. Scan the QR code.</p>
              <p>2. Enter your name and log in.</p>
              <p>3. Add song requests and vote your favorites up.</p>
            </div>
          </section>
        ) : (
          <>
            {shouldShowAdminElements ? (
              <section className={`mirror-now-playing ${isLive ? 'mirror-now-playing-live' : ''} ${isBetweenSongs ? 'mirror-now-playing-interstitial' : ''}`}>
                {isBetweenSongs ? (
                  <>
                    <div className="mirror-interstitial-sweep" aria-hidden="true" />
                    <p className="mirror-between-songs-quote">{betweenSongQuote}</p>
                  </>
                ) : (
                  <>
                    <p className="mirror-eyebrow">Now Playing</p>
                    <div className="mirror-now-playing-track">
                      {activeSong?.cover_url && !failedCoverUrls[activeSong.cover_url] ? (
                        <img
                          src={activeSong.cover_url}
                          alt={`Cover art for ${activeSong.title}`}
                          className="mirror-now-playing-cover"
                          onError={() => onCoverLoadError(activeSong.cover_url)}
                        />
                      ) : null}
                      <div className="mirror-now-playing-meta">
                        <h1 className="mirror-title">{normalizeMirrorText(activeSong?.title, 'Waiting for requests...')}</h1>
                        <p className="mirror-artist">{normalizeMirrorText(activeSong?.artist, 'Be the first to request a song!')}</p>
                        {activeSong?.audience_sings ? <span className="mirror-karaoke-tag">Karaoke Request</span> : null}
                      </div>
                    </div>
                  </>
                )}
              </section>
            ) : null}

            <section className={`mirror-secondary-grid ${shouldShowAdminElements ? '' : 'mirror-secondary-grid-feed-only'}`}>
              {shouldShowAdminElements ? (
                <section className={`mirror-up-next ${shouldCompactQueue ? 'mirror-up-next-compact' : ''}`}>
                  <p className="mirror-up-next-label">Up Next</p>
                  {upNext.length > 0 ? (
                    <ol className="mirror-queue">
                      {upNext.map((song, index) => (
                        <li key={song.id} className="mirror-queue-item">
                          <span className="mirror-queue-pos">{index + 2}</span>
                          {!shouldCompactQueue && song.cover_url && !failedCoverUrls[song.cover_url] ? (
                            <img
                              src={song.cover_url}
                              alt={`Cover art for ${song.title}`}
                              className="mirror-queue-cover"
                              onError={() => onCoverLoadError(song.cover_url)}
                            />
                          ) : null}
                          <div className="mirror-queue-info">
                            <span className="mirror-queue-title">{normalizeMirrorText(song.title, 'Untitled Song')}</span>
                            <span className="mirror-queue-artist">{normalizeMirrorText(song.artist, 'Unknown Artist')}</span>
                            {song.audience_sings ? <span className="mirror-karaoke-tag">Karaoke Request</span> : null}
                          </div>
                          <span className="mirror-queue-votes">+{song.votes_count}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mirror-empty-note">No songs in the queue yet.</p>
                  )}
                  {shouldCompactQueue && hiddenQueueCount > 0 ? (
                    <p className="mirror-compact-note">+{hiddenQueueCount} more songs waiting in queue</p>
                  ) : null}
                </section>
              ) : null}

              <LiveFeedPanel mode="mirror" showComposer={false} title="Crowd Feed" showModerationControls={shouldShowAdminElements} />
            </section>
          </>
        )}
      </main>

      {showSpotlight && activeSpotlight ? (
        <aside className="mirror-photo-spotlight" aria-label="Live crowd photo spotlight">
          <figure className="mirror-polaroid" key={activeSpotlight.id}>
            <img src={activeSpotlight.imageDataUrl} alt={`Crowd photo by ${activeSpotlight.authorName}`} className="mirror-polaroid-photo" />
            <figcaption>
              <strong>{activeSpotlight.authorName}</strong>
              <span>{activeSpotlight.caption}</span>
            </figcaption>
          </figure>
          {queuedSpotlightCount > 0 ? (
            <p className="mirror-spotlight-queue-pill">
              {queuedSpotlightCount} more photo{queuedSpotlightCount === 1 ? '' : 's'} coming
            </p>
          ) : null}
        </aside>
      ) : null}

      {showSpotlight && flashActive ? <div className="mirror-spotlight-flash" aria-hidden="true" /> : null}
      {showSpotlight && showShutterFallbackPulse ? <div className="mirror-spotlight-fallback-pulse" aria-hidden="true" /> : null}
      {showSafeMargins && shouldShowAdminElements ? <div className="mirror-safe-margins-overlay" aria-hidden="true" /> : null}

      {isLive && event?.requestInstructions ? (
        <footer className="mirror-footer">
          <p className="mirror-request-note">{event.requestInstructions}</p>
        </footer>
      ) : null}
    </div>
  )
}

export default MirrorPage
