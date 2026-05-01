import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import LiveFeedPanel from '../components/LiveFeedPanel'
import { readCommittedAudienceLocale, type AudienceLocale } from '../lib/audienceIdentity'
import { getAudienceUrl } from '../lib/audienceUrl'
import { logCrashTelemetry } from '../lib/crashTelemetry'
import {
  PLAYBACK_STATE_BROADCAST_CHANNEL,
  PLAYBACK_STATE_EVENT,
  PLAYBACK_STATE_STORAGE_KEY,
  readSharedPlaybackState,
  writeSharedPlaybackState,
  type SharedPlaybackState,
  BETWEEN_SONG_QUOTES,
} from '../lib/playbackState'
import { supabase } from '../lib/supabase'
import { useQueueStore, type QueueSong } from '../state/queueStore'
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

const KARAOKE_CHEER_BUILDERS = [
  (singerName: string) => `Right then, ${singerName} is about to give us a performance for the ages. Brace yourselves, legends.`,
  (singerName: string) => `${singerName} has taken the microphone. The brave shall inherit the earth, as they say.`,
  (singerName: string) => `Ladies and gents, please direct your attention to ${singerName}, who apparently has faith in themselves. Blimey.`,
  (singerName: string) => `${singerName} is stepping up to the mic. This should be absolutely cracking.`,
  (singerName: string) => `Hold onto your hats. ${singerName} is about to serenade us. Brilliant stuff.`,
  (singerName: string) => `${singerName} has requested the honour of singing. What could possibly go wrong? Let's find out.`,
  (singerName: string) => `Brilliant! ${singerName} is ready to give us a proper vocal showing. This is going to be something special.`,
  (singerName: string) => `${singerName} has taken the gauntlet. We're in for a treat, folks.`,
  (singerName: string) => `Blimey, ${singerName} is about to grace us with their vocal talents. This is going to be ace.`,
  (singerName: string) => `${singerName} is having a go at the karaoke. Let's see what they're made of, shall we?`,
]

const CHOSEN_BY_BUILDERS = [
  (name: string) => `Chosen by ${name} - excellent taste, no notes.`,
  (name: string) => `Chosen by ${name} - a cracking pick, frankly.`,
  (name: string) => `Chosen by ${name} - proper tune, that one.`,
  (name: string) => `Chosen by ${name} - bold, brilliant, and slightly dangerous.`,
  (name: string) => `Chosen by ${name} - the crowd approves with nods and pints.`,
  (name: string) => `Chosen by ${name} - certified banger behaviour.`,
  (name: string) => `Chosen by ${name} - top shelf decision-making.`,
  (name: string) => `Chosen by ${name} - absolutely spot on, mate.`,
]

const CHOSEN_BY_ACCENT_CLASSES = [
  'mirror-picker-accent-1',
  'mirror-picker-accent-2',
  'mirror-picker-accent-3',
  'mirror-picker-accent-4',
  'mirror-picker-accent-5',
  'mirror-picker-accent-6',
  'mirror-picker-accent-7',
  'mirror-picker-accent-8',
]

const SPOTLIGHT_DURATION_MS = 7000
const SPOTLIGHT_POLL_INTERVAL_MS = 2000
const SONG_INFO_ROTATE_INTERVAL_MS = 15000
const SONG_FACT_MAX_LENGTH = 180
const MIRROR_FUN_FACTS_CACHE_STORAGE_KEY = 'human-jukebox-mirror-fun-facts-cache-v1'
const MIRROR_HIGH_CONTRAST_STORAGE_KEY = 'human-jukebox-mirror-high-contrast'
const MIRROR_PLAYBACK_STORAGE_KEY = PLAYBACK_STATE_STORAGE_KEY
const MIRROR_PLAYBACK_BROADCAST_CHANNEL = PLAYBACK_STATE_BROADCAST_CHANNEL
const MIRROR_SAFE_MARGINS_STORAGE_KEY = 'human-jukebox-mirror-safe-margins'
const MIRROR_VENUE_MODE_STORAGE_KEY = 'human-jukebox-mirror-venue-mode'
const MIRROR_WARNING_MIN_VISIBLE_MS = 2600
const MIRROR_AUTO_FULLSCREEN_QUERY_PARAM = 'launchFullscreen'

type MirrorDensityMode = 'medium' | 'cinema'
type MirrorVenueMode = 'club' | 'lounge' | 'festival'
type NowPlayingInfoSong = Pick<QueueSong, 'title' | 'artist' | 'is_explicit'>
type FunFactsCache = Record<string, string[]>

function countWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length
}

function countCharactersWithoutSpaces(text: string) {
  return text.replace(/\s+/g, '').length
}

function buildInitials(text: string) {
  const initials = text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((chunk) => chunk.charAt(0).toUpperCase())
    .join('')

  return initials || '?'
}

function containsFeatToken(text: string) {
  return /\b(feat\.?|ft\.?)\b/i.test(text)
}

function truncateFact(value: string, maxLength = SONG_FACT_MAX_LENGTH) {
  const normalizedValue = value.trim()

  if (normalizedValue.length <= maxLength) {
    return normalizedValue
  }

  return `${normalizedValue.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}
function buildFunFactsCacheKey(title: string, artist: string) {
  return `${title.trim().toLowerCase()}::${artist.trim().toLowerCase()}`
}

function extractInterestingSentences(extract: string) {
  const sentenceMatches = extract.match(/[^.!?]+[.!?]+/g) ?? []

  const normalizedSentences = sentenceMatches
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 40 && sentence.length <= SONG_FACT_MAX_LENGTH)
    .filter((sentence) => !/^coordinates?:?/i.test(sentence))

  const uniqueSentences = Array.from(new Set(normalizedSentences))
  return uniqueSentences.slice(0, 10)
}

function normalizeFunFacts(facts: string[]) {
  const normalizedFacts = facts
    .map((fact) => truncateFact(fact))
    .map((fact) => fact.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  return Array.from(new Set(normalizedFacts))
}

async function fetchWikipediaSummarySentences(title: string, artist: string, signal: AbortSignal) {
  const candidateTitles = [
    `${title} (song)`,
    title,
    `${title} (${artist} song)`,
    `${title} ${artist}`,
  ]

  for (const candidateTitle of candidateTitles) {
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidateTitle)}`

    try {
      const summaryResponse = await fetch(summaryUrl, { signal })

      if (!summaryResponse.ok) {
        continue
      }

      const summaryPayload = await summaryResponse.json() as {
        extract?: string
      }

      const extract = summaryPayload.extract?.trim()

      if (!extract) {
        continue
      }

      const sentenceFacts = extractInterestingSentences(extract)

      if (sentenceFacts.length > 0) {
        return sentenceFacts
      }
    } catch {
      // Try next title candidate.
    }
  }

  return []
}

async function fetchMusicBrainzFallbackFacts(title: string, artist: string, signal: AbortSignal) {
  const query = `recording:${JSON.stringify(title)} AND artist:${JSON.stringify(artist)}`
  const searchUrl = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=1`

  try {
    const response = await fetch(searchUrl, {
      signal,
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      return []
    }

    const payload = await response.json() as {
      recordings?: Array<{
        title?: string
        score?: number
        length?: number
        'first-release-date'?: string
        releases?: Array<{ title?: string }>
        'artist-credit'?: Array<{ name?: string }>
      }>
    }

    const recording = payload.recordings?.[0]

    if (!recording) {
      return []
    }

    const releaseTitle = recording.releases?.[0]?.title?.trim()
    const firstReleaseDate = recording['first-release-date']?.trim()
    const artistCredit = recording['artist-credit']?.map((credit) => credit.name?.trim()).filter(Boolean).join(', ')

    const fallbackFacts = [
      recording.score ? `MusicBrainz match confidence is ${recording.score}% for this track.` : null,
      firstReleaseDate ? `MusicBrainz lists the first release date as ${firstReleaseDate}.` : null,
      releaseTitle ? `This track appears on the release "${releaseTitle}" in MusicBrainz.` : null,
      artistCredit ? `MusicBrainz artist credit: ${artistCredit}.` : null,
      recording.length ? `MusicBrainz duration is about ${Math.round(recording.length / 1000)} seconds.` : null,
    ].filter((fact): fact is string => Boolean(fact))

    return fallbackFacts.slice(0, 5)
  } catch {
    return []
  }
}

const SONG_INFO_BUILDERS = [
  (song: NowPlayingInfoSong) => `Song fact: "${song.title}" has ${countWords(song.title)} word${countWords(song.title) === 1 ? '' : 's'} in the title.`,
  (song: NowPlayingInfoSong) => `Song fact: "${song.title}" uses ${countCharactersWithoutSpaces(song.title)} characters (without spaces).`,
  (song: NowPlayingInfoSong) => `Song fact: Artist name "${song.artist}" has ${countWords(song.artist)} word${countWords(song.artist) === 1 ? '' : 's'}.`,
  (song: NowPlayingInfoSong) => `Song fact: Title initials are ${buildInitials(song.title)}.`,
  (song: NowPlayingInfoSong) => containsFeatToken(song.title)
    ? 'Song fact: This title includes a featured-artist tag (feat./ft.).'
    : 'Song fact: This title does not include a featured-artist tag.',
  (song: NowPlayingInfoSong) => song.is_explicit
    ? 'Song fact: This track is marked explicit in the library.'
    : 'Song fact: This track is marked clean in the library.',
]

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
  msRequestFullscreen?: () => Promise<void> | void
  webkitRequestFullscreen?: () => Promise<void> | void
  webkitRequestFullScreen?: () => Promise<void> | void
}

function getActiveFullscreenElement() {
  const fullscreenDocument = document as FullscreenDocument
  return document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null
}

async function requestFullscreenSafe(targetElement: HTMLElement) {
  const fullscreenTargets = [
    targetElement,
    document.documentElement,
    document.body,
  ].filter((candidate): candidate is HTMLElement => Boolean(candidate))

  let lastError: unknown = null

  for (const candidate of fullscreenTargets) {
    const fullscreenTarget = candidate as FullscreenElement

    try {
      if (typeof fullscreenTarget.requestFullscreen === 'function') {
        await fullscreenTarget.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions)
        return
      }

      if (typeof fullscreenTarget.webkitRequestFullscreen === 'function') {
        await fullscreenTarget.webkitRequestFullscreen()
        return
      }

      if (typeof fullscreenTarget.webkitRequestFullScreen === 'function') {
        await fullscreenTarget.webkitRequestFullScreen()
        return
      }

      if (typeof fullscreenTarget.msRequestFullscreen === 'function') {
        await fullscreenTarget.msRequestFullscreen()
        return
      }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Fullscreen API is unavailable in this browser.')
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

function pickKaraokeCheer(singerName: string) {
  const cheerBuilder = KARAOKE_CHEER_BUILDERS[Math.floor(Math.random() * KARAOKE_CHEER_BUILDERS.length)]
  return cheerBuilder(singerName)
}

function buildChosenByLine(name: string | null | undefined, phraseIndex: number) {
  const normalizedName = name?.trim()

  if (!normalizedName) {
    return null
  }

  const chosenByBuilder = CHOSEN_BY_BUILDERS[phraseIndex]
  return chosenByBuilder(normalizedName)
}

function getMirrorCountdownTarget(gigDate: string | null | undefined, gigStartTime: string | null | undefined) {
  const normalizedDate = gigDate?.trim()

  if (!normalizedDate) {
    return null
  }

  const normalizedTime = gigStartTime?.trim() ? `${gigStartTime.trim()}:00` : '19:00:00'
  const scheduledStart = new Date(`${normalizedDate}T${normalizedTime}`)

  if (Number.isNaN(scheduledStart.getTime())) {
    return null
  }

  return scheduledStart
}

function formatMirrorCountdownLabel(remainingMs: number) {
  const safeRemainingMs = Math.max(0, remainingMs)
  const totalSeconds = Math.floor(safeRemainingMs / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const segments = [
    days > 0 ? `${days.toString().padStart(2, '0')}d` : null,
    `${hours.toString().padStart(2, '0')}h`,
    `${minutes.toString().padStart(2, '0')}m`,
    `${seconds.toString().padStart(2, '0')}s`,
  ].filter((segment): segment is string => Boolean(segment))

  return segments.join(' ')
}

function formatMirrorCountdownStartTime(date: Date, locale: AudienceLocale) {
  return new Intl.DateTimeFormat(locale === 'da' ? 'da-DK' : undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
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
  const { event, songs, loading, markPlayed } = useQueueStore()
  const { isHost } = useAuthStore()
  const [spotlight, setSpotlight] = useState<FeedImageSpotlight | null>(null)
  const [karaokeCheer, setKaraokeCheer] = useState<string | null>(null)
  const [funFacts, setFunFacts] = useState<string[]>([])
  const [currentFactIndex, setCurrentFactIndex] = useState(0)
  const spacebarBusyRef = useRef(false)
  const lastSpacebarActionAtRef = useRef(0)
  const [flashActive, setFlashActive] = useState(false)
  const [queuedSpotlightCount, setQueuedSpotlightCount] = useState(0)
  const [playbackState, setPlaybackState] = useState<SharedPlaybackState | null>(null)
  const [mirrorWarning, setMirrorWarning] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [highContrastMode, setHighContrastMode] = useState(false)
  const [densityMode, setDensityMode] = useState<MirrorDensityMode>('medium')
  const [venueMode, setVenueMode] = useState<MirrorVenueMode>('lounge')
  const [showSafeMargins, setShowSafeMargins] = useState(false)
  const [, setStorageError] = useState<string | null>(null)
  const [hideControlsForAudience, setHideControlsForAudience] = useState(false)
  const [showShutterFallbackPulse, setShowShutterFallbackPulse] = useState(false)
  const [failedCoverUrls, setFailedCoverUrls] = useState<Record<string, true>>({})
  const [audienceLocale, setAudienceLocale] = useState<AudienceLocale>(() => readCommittedAudienceLocale())
  const [countdownNow, setCountdownNow] = useState(() => Date.now())
  const [betweenSongQuoteIndex, setBetweenSongQuoteIndex] = useState(0)
  const quoteIndexRef = useRef(0)
  const nowPlayingRef = useRef<typeof songs[number] | undefined>(undefined)
  const songsRef = useRef(songs)
  const eventIdRef = useRef<string | null>(null)
  const isNowPlayingStartedRef = useRef(false)
  const spotlightTimerRef = useRef<number | null>(null)
  const shutterFallbackPulseTimerRef = useRef<number | null>(null)
  const mirrorWarningClearTimerRef = useRef<number | null>(null)
  const mirrorWarningLastShownAtRef = useRef<number>(0)
  const spotlightQueueRef = useRef<SpotlightQueueItem[]>([])
  const spotlightBusyRef = useRef(false)
  const seenSpotlightPostIdsRef = useRef<Set<string>>(new Set())
  const mirrorShellRef = useRef<HTMLDivElement | null>(null)
  const autoFullscreenAttemptedRef = useRef(false)
  const chosenByPhraseIndexBySongIdRef = useRef<Record<string, number>>({})
  const lastChosenByPhraseIndexRef = useRef<number | null>(null)
  const funFactsCacheRef = useRef<FunFactsCache>({})
  const funFactsInFlightRef = useRef<Partial<Record<string, Promise<string[]>>>>({})

  const setMirrorWarningMessage = (message: string) => {
    if (mirrorWarningClearTimerRef.current !== null) {
      window.clearTimeout(mirrorWarningClearTimerRef.current)
      mirrorWarningClearTimerRef.current = null
    }

    mirrorWarningLastShownAtRef.current = Date.now()
    setMirrorWarning((currentWarning) => (currentWarning === message ? currentWarning : message))
  }

  const clearMirrorWarningSmoothly = () => {
    const elapsedMs = Date.now() - mirrorWarningLastShownAtRef.current
    const delayMs = Math.max(0, MIRROR_WARNING_MIN_VISIBLE_MS - elapsedMs)

    if (mirrorWarningClearTimerRef.current !== null) {
      window.clearTimeout(mirrorWarningClearTimerRef.current)
      mirrorWarningClearTimerRef.current = null
    }

    mirrorWarningClearTimerRef.current = window.setTimeout(() => {
      setMirrorWarning(null)
      mirrorWarningClearTimerRef.current = null
    }, delayMs)
  }

  // Keep the screen awake while the mirror is open
  useEffect(() => {
    if (!('wakeLock' in navigator)) {
      return
    }

    let lock: WakeLockSentinel | null = null

    const acquire = async () => {
      if (document.visibilityState !== 'visible') {
        return
      }

      try {
        lock = await (navigator as Navigator & { wakeLock: { request(type: string): Promise<WakeLockSentinel> } }).wakeLock.request('screen')
      } catch {
        // Wake lock request can be silently denied (e.g. low battery). Safe to ignore.
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void acquire()
      }
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      lock?.release().catch(() => {})
    }
  }, [])

  useEffect(() => {
    return () => {
      if (mirrorWarningClearTimerRef.current !== null) {
        window.clearTimeout(mirrorWarningClearTimerRef.current)
        mirrorWarningClearTimerRef.current = null
      }
    }
  }, [])

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
  const audienceUrl = useMemo(() => {
    try {
      const audienceUrlResolver = getAudienceUrl as (...args: unknown[]) => string
      return audienceUrlResolver(eventId, { compact: true, includeVersion: false })
    } catch (error) {
      logCrashTelemetry({
        route: '/mirror',
        error,
        extra: {
          source: 'mirror-audience-url-resolver',
        },
      })
      console.warn('MirrorPage: audience URL resolution failed', error)
      return '/audience'
    }
  }, [eventId])
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=1400x1400&ecc=M&margin=8&data=${encodeURIComponent(audienceUrl)}`
  const playbackSong = playbackState?.currentSongId
    ? safeSongs.find((song) => song.id === playbackState.currentSongId) ?? null
    : null
  const activeSong = playbackSong ?? nowPlaying
  const isNowPlayingStarted = Boolean(playbackState?.isStarted && playbackState.currentSongId)
  const maxUpNextSongs = hideControlsForAudience ? 3 : 5
  const shouldCompactQueue = safeSongs.length > 6
  const upNext = isNowPlayingStarted
    ? safeSongs.filter((song) => song.id !== (playbackSong?.id ?? nowPlaying?.id)).slice(0, maxUpNextSongs)
    : safeSongs.slice(0, maxUpNextSongs)
  const hiddenQueueCount = Math.max(0, safeSongs.length - (isNowPlayingStarted ? 1 : 0) - upNext.length)
  const normalizedBetweenSongQuoteIndex = Number.isFinite(betweenSongQuoteIndex)
    ? Math.abs(Math.trunc(betweenSongQuoteIndex)) % BETWEEN_SONG_QUOTES.length
    : 0
  const currentBetweenSongQuote = BETWEEN_SONG_QUOTES[normalizedBetweenSongQuoteIndex]
    ?? 'Remain calm. The next song is loading.'

  const getChosenByLine = (songId: string, name: string | null | undefined) => {
    const normalizedName = name?.trim()

    if (!normalizedName) {
      return null
    }

    const phraseBuildersCount = CHOSEN_BY_BUILDERS.length

    if (phraseBuildersCount <= 0) {
      return `Chosen by ${normalizedName}`
    }

    const cachedPhraseIndex = chosenByPhraseIndexBySongIdRef.current[songId]
    let phraseIndex = typeof cachedPhraseIndex === 'number' ? cachedPhraseIndex : -1

    if (phraseIndex < 0 || phraseIndex >= phraseBuildersCount) {
      if (phraseBuildersCount === 1) {
        phraseIndex = 0
      } else {
        const lastPhraseIndex = lastChosenByPhraseIndexRef.current
        phraseIndex = Math.floor(Math.random() * phraseBuildersCount)

        if (phraseIndex === lastPhraseIndex) {
          phraseIndex = (phraseIndex + 1 + Math.floor(Math.random() * (phraseBuildersCount - 1))) % phraseBuildersCount
        }
      }

      chosenByPhraseIndexBySongIdRef.current[songId] = phraseIndex
      lastChosenByPhraseIndexRef.current = phraseIndex
    }

    return buildChosenByLine(normalizedName, phraseIndex) ?? `Chosen by ${normalizedName}`
  }

  const getChosenByAccentClass = (songId: string) => {
    const phraseIndex = chosenByPhraseIndexBySongIdRef.current[songId]

    if (typeof phraseIndex !== 'number' || phraseIndex < 0) {
      return CHOSEN_BY_ACCENT_CLASSES[0]
    }

    return CHOSEN_BY_ACCENT_CLASSES[phraseIndex % CHOSEN_BY_ACCENT_CLASSES.length]
  }

  const activeSongChosenByLine = activeSong?.createdByName
    ? (activeSong.audience_sings
      ? `Picked by ${activeSong.createdByName}`
      : getChosenByLine(activeSong.id, activeSong.createdByName) ?? `Chosen by ${activeSong.createdByName}`)
    : null
  const activeSongChosenByAccentClass = activeSong?.id
    ? getChosenByAccentClass(activeSong.id)
    : CHOSEN_BY_ACCENT_CLASSES[0]

  useEffect(() => {
    const activeSongIds = new Set(safeSongs.map((song) => song.id))
    const phraseCache = chosenByPhraseIndexBySongIdRef.current

    Object.keys(phraseCache).forEach((songId) => {
      if (!activeSongIds.has(songId)) {
        delete phraseCache[songId]
      }
    })
  }, [safeSongs])

  const showSpotlight = (event?.mirrorPhotoSpotlightEnabled ?? true) && !isEmbeddedPreview
  const shouldShowEditorControls = isHost && !hideControlsForAudience && !isEmbeddedPreview
  const shouldShowAdminElements = isHost
  const countdownCopy = audienceLocale === 'da'
    ? {
        live: '● Live',
        paused: '● Pause',
        startingIn: 'Starter om',
        scheduledStart: 'Planlagt start',
        scheduledPrefix: 'Planlagt start:',
      }
    : {
        live: '● Live',
        paused: '● Paused',
        startingIn: 'Starting In',
        scheduledStart: 'Scheduled Start',
        scheduledPrefix: 'Scheduled start:',
      }
  const countdownTarget = useMemo(
    () => getMirrorCountdownTarget(event?.gigDate ?? null, event?.gigStartTime ?? null),
    [event?.gigDate, event?.gigStartTime],
  )
  const countdownRemainingMs = countdownTarget ? countdownTarget.getTime() - countdownNow : null
  const showCountdown = !isLive
    && (event?.mirrorCountdownEnabled ?? true)
    && Boolean(countdownTarget)
    && Boolean(countdownRemainingMs && countdownRemainingMs > 0)
  const countdownLabel = showCountdown && countdownRemainingMs !== null
    ? formatMirrorCountdownLabel(countdownRemainingMs)
    : null
  const countdownStartLabel = countdownTarget ? formatMirrorCountdownStartTime(countdownTarget, audienceLocale) : null

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
    nowPlayingRef.current = nowPlaying
  }, [nowPlaying])

  useEffect(() => {
    songsRef.current = songs
  }, [songs])

  useEffect(() => {
    eventIdRef.current = eventId
  }, [eventId])

  useEffect(() => {
    isNowPlayingStartedRef.current = isNowPlayingStarted
  }, [isNowPlayingStarted])

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(getActiveFullscreenElement()))
    }

    syncFullscreenState()
    document.addEventListener('fullscreenchange', syncFullscreenState)
    document.addEventListener('webkitfullscreenchange', syncFullscreenState)
    window.addEventListener('fullscreenchange', syncFullscreenState)
    window.addEventListener('webkitfullscreenchange', syncFullscreenState)

    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState)
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState)
      window.removeEventListener('fullscreenchange', syncFullscreenState)
      window.removeEventListener('webkitfullscreenchange', syncFullscreenState)
    }
  }, [])

  useEffect(() => {
    if (autoFullscreenAttemptedRef.current) {
      return
    }

    const searchParams = new URLSearchParams(window.location.search)

    if (searchParams.get(MIRROR_AUTO_FULLSCREEN_QUERY_PARAM) !== '1') {
      return
    }

    autoFullscreenAttemptedRef.current = true

    void requestFullscreenSafe(mirrorShellRef.current ?? document.documentElement).catch(() => {
      // Best effort only. The launcher already opens a fill-screen popup as fallback.
    })
  }, [])

  useEffect(() => {
    const syncPresentationState = () => {
      const fullscreenActive = Boolean(getActiveFullscreenElement())
      const fullscreenDisplayMode = window.matchMedia('(display-mode: fullscreen)').matches
      const projectedMode = fullscreenActive || fullscreenDisplayMode

      setHideControlsForAudience(projectedMode)
    }

    syncPresentationState()
    document.addEventListener('fullscreenchange', syncPresentationState)
    document.addEventListener('webkitfullscreenchange', syncPresentationState)
    window.addEventListener('fullscreenchange', syncPresentationState)
    window.addEventListener('webkitfullscreenchange', syncPresentationState)
    window.addEventListener('resize', syncPresentationState)

    return () => {
      document.removeEventListener('fullscreenchange', syncPresentationState)
      document.removeEventListener('webkitfullscreenchange', syncPresentationState)
      window.removeEventListener('fullscreenchange', syncPresentationState)
      window.removeEventListener('webkitfullscreenchange', syncPresentationState)
      window.removeEventListener('resize', syncPresentationState)
    }
  }, [])

  useEffect(() => {
    const syncAudienceLocale = () => {
      setAudienceLocale(readCommittedAudienceLocale())
    }

    syncAudienceLocale()
    window.addEventListener('storage', syncAudienceLocale)

    return () => {
      window.removeEventListener('storage', syncAudienceLocale)
    }
  }, [])

  useEffect(() => {
    if (isLive && activeSong?.audience_sings && activeSong?.createdByName) {
      setKaraokeCheer(pickKaraokeCheer(activeSong.createdByName))
    } else {
      setKaraokeCheer(null)
    }
  }, [activeSong?.id, activeSong?.audience_sings, activeSong?.createdByName, isLive])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const persistedCacheText = readTextFromLocalStorage(MIRROR_FUN_FACTS_CACHE_STORAGE_KEY)

    if (!persistedCacheText) {
      return
    }

    try {
      const persistedCache = JSON.parse(persistedCacheText) as FunFactsCache

      if (persistedCache && typeof persistedCache === 'object') {
        funFactsCacheRef.current = persistedCache
      }
    } catch {
      // Corrupt cache should not block playback; overwrite on next write.
    }
  }, [])

  const persistFunFactsCache = useCallback(() => {
    const serializedCache = JSON.stringify(funFactsCacheRef.current)
    const result = saveTextToLocalStorage(MIRROR_FUN_FACTS_CACHE_STORAGE_KEY, serializedCache)

    if (!result.success) {
      console.warn('MirrorPage: failed to persist fun facts cache', result.error)
    }
  }, [])

  const ensureSongFunFacts = useCallback(async (song: QueueSong, signal: AbortSignal) => {
    const cacheKey = buildFunFactsCacheKey(song.title, song.artist)
    const existingFacts = funFactsCacheRef.current[cacheKey]

    if (existingFacts?.length) {
      return existingFacts
    }

    if (funFactsInFlightRef.current[cacheKey]) {
      return funFactsInFlightRef.current[cacheKey]
    }

    const fetchPromise = (async () => {
      const wikipediaFacts = await fetchWikipediaSummarySentences(song.title, song.artist, signal)
      const fallbackFacts = wikipediaFacts.length >= 3
        ? []
        : await fetchMusicBrainzFallbackFacts(song.title, song.artist, signal)

      const songInfoContext: NowPlayingInfoSong = {
        title: song.title,
        artist: song.artist,
        is_explicit: song.is_explicit,
      }
      const localFacts = SONG_INFO_BUILDERS.map((songInfoBuilder) => songInfoBuilder(songInfoContext))

      const mergedFacts = normalizeFunFacts([
        ...wikipediaFacts,
        ...fallbackFacts,
        ...localFacts,
      ]).slice(0, 10)

      funFactsCacheRef.current[cacheKey] = mergedFacts
      persistFunFactsCache()

      return mergedFacts
    })()

    funFactsInFlightRef.current[cacheKey] = fetchPromise

    try {
      return await fetchPromise
    } finally {
      delete funFactsInFlightRef.current[cacheKey]
    }
  }, [persistFunFactsCache])

  useEffect(() => {
    const abortController = new AbortController()

    const prefetchFacts = async () => {
      for (const song of safeSongs) {
        if (abortController.signal.aborted) {
          return
        }

        try {
          await ensureSongFunFacts(song, abortController.signal)
        } catch {
          // Fact prefetch is best effort only.
        }
      }
    }

    void prefetchFacts()

    return () => {
      abortController.abort()
    }
  }, [ensureSongFunFacts, safeSongs])

  useEffect(() => {
    if (!isNowPlayingStarted || !activeSong) {
      setFunFacts([])
      setCurrentFactIndex(0)
      return
    }

    const abortController = new AbortController()
    const cacheKey = buildFunFactsCacheKey(activeSong.title, activeSong.artist)
    const cachedFacts = funFactsCacheRef.current[cacheKey]

    if (cachedFacts?.length) {
      setFunFacts(cachedFacts)
      setCurrentFactIndex(0)
      return
    }

    const loadSongFunFacts = async () => {
      try {
        const fetchedFacts = await ensureSongFunFacts(activeSong, abortController.signal)

        if (abortController.signal.aborted) {
          return
        }

        setFunFacts(fetchedFacts)
        setCurrentFactIndex(0)
      } catch (error) {
        if (abortController.signal.aborted) {
          return
        }

        console.warn('MirrorPage: failed to load song fun facts', error)
        setFunFacts([])
        setCurrentFactIndex(0)
      }
    }

    void loadSongFunFacts()

    return () => {
      abortController.abort()
    }
  }, [activeSong, ensureSongFunFacts, isNowPlayingStarted])

  useEffect(() => {
    if (funFacts.length <= 1) {
      setCurrentFactIndex(0)
      return
    }

    const intervalId = window.setInterval(() => {
      setCurrentFactIndex((currentIndex) => (currentIndex + 1) % funFacts.length)
    }, SONG_INFO_ROTATE_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [funFacts])

  const setQuoteIndex = (nextQuoteIndex: number) => {
    quoteIndexRef.current = nextQuoteIndex
    setBetweenSongQuoteIndex(nextQuoteIndex)
  }

  const runQueueTogglePlayShortcut = useCallback(async () => {
    // Mirror the Gig Control playback transition behavior so both screens remain in sync.
    const activeEventId = eventIdRef.current
    const currentNowPlaying = nowPlayingRef.current
    const currentSongs = songsRef.current

    if (!activeEventId || !currentNowPlaying) {
      return
    }

    if (!isNowPlayingStartedRef.current) {
      await writeSharedPlaybackState(activeEventId, {
        currentSongId: currentNowPlaying.id,
        currentSongCoverUrl: currentNowPlaying.cover_url ?? null,
        isStarted: true,
        quoteIndex: quoteIndexRef.current,
      })
      return
    }

    const previousQuoteIndex = quoteIndexRef.current
    const nextQuoteIndex = (previousQuoteIndex + 1) % BETWEEN_SONG_QUOTES.length
    const nextSong = currentSongs[1] ?? null

    setQuoteIndex(nextQuoteIndex)

    await writeSharedPlaybackState(activeEventId, {
      currentSongId: nextSong?.id ?? null,
      currentSongCoverUrl: nextSong?.cover_url ?? null,
      isStarted: false,
      quoteIndex: nextQuoteIndex,
    })

    try {
      await markPlayed()
    } catch (error) {
      setQuoteIndex(previousQuoteIndex)
      await writeSharedPlaybackState(activeEventId, {
        currentSongId: currentNowPlaying.id,
        currentSongCoverUrl: currentNowPlaying.cover_url ?? null,
        isStarted: true,
        quoteIndex: previousQuoteIndex,
      })
      throw error
    }
  }, [markPlayed])

  const runQueueTogglePlayShortcutRef = useRef(runQueueTogglePlayShortcut)
  useEffect(() => {
    runQueueTogglePlayShortcutRef.current = runQueueTogglePlayShortcut
  }, [runQueueTogglePlayShortcut])

  useEffect(() => {
    const normalizedQuoteIndex = Number.isFinite(playbackState?.quoteIndex)
      ? (playbackState?.quoteIndex as number) % BETWEEN_SONG_QUOTES.length
      : 0

    if (normalizedQuoteIndex !== quoteIndexRef.current) {
      setQuoteIndex(normalizedQuoteIndex)
    }
  }, [playbackState?.quoteIndex])

  useEffect(() => {
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (!keyEvent.isTrusted || keyEvent.defaultPrevented) {
        return
      }

      if (keyEvent.code !== 'Space') {
        return
      }

      if (keyEvent.altKey || keyEvent.ctrlKey || keyEvent.metaKey || keyEvent.shiftKey) {
        return
      }

      if (keyEvent.repeat) {
        keyEvent.preventDefault()
        return
      }

      const target = keyEvent.target as HTMLElement | null
      const activeElement = document.activeElement as HTMLElement | null
      const interactiveTarget = target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="button"], [role="textbox"], [data-spacebar-ignore="true"]')
      const isTypingTarget = Boolean(interactiveTarget || activeElement?.isContentEditable)

      if (isTypingTarget) {
        return
      }

      const now = Date.now()
      if (now - lastSpacebarActionAtRef.current < 500) {
        keyEvent.preventDefault()
        return
      }

      if (spacebarBusyRef.current) {
        keyEvent.preventDefault()
        return
      }

      if (!nowPlayingRef.current) {
        return
      }

      keyEvent.preventDefault()
      lastSpacebarActionAtRef.current = now
      spacebarBusyRef.current = true

      const executeToggle = async () => {
        try {
          await runQueueTogglePlayShortcutRef.current()
        } catch (error) {
          console.warn('MirrorPage: spacebar playback action failed', error)
        } finally {
          spacebarBusyRef.current = false
        }
      }

      void executeToggle()
    }

    window.addEventListener('keydown', onKeyDown as unknown as EventListener)
    return () => window.removeEventListener('keydown', onKeyDown as unknown as EventListener)
  }, [])

  useEffect(() => {
    if (isLive || !countdownTarget) {
      return
    }

    setCountdownNow(Date.now())

    const timerId = window.setInterval(() => {
      setCountdownNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [countdownTarget, isLive])

  useEffect(() => {
    const onRuntimeError = (event: ErrorEvent) => {
      logCrashTelemetry({
        route: '/mirror',
        error: event.error ?? event.message,
        extra: {
          source: 'mirror-runtime-error',
        },
      })
      setMirrorWarningMessage('Mirror recovered from a runtime issue. Showing last known state.')
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      logCrashTelemetry({
        route: '/mirror',
        error: event.reason,
        extra: {
          source: 'mirror-unhandled-rejection',
        },
      })
      setMirrorWarningMessage('Mirror sync is retrying in the background. Display remains live.')
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
      setStorageError(null)
      return
    }

    setStorageError(result.error ?? 'Could not save contrast preference')
    console.warn('MirrorPage: failed to save high contrast mode', result.error)
  }, [highContrastMode])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const result = saveTextToLocalStorage(MIRROR_SAFE_MARGINS_STORAGE_KEY, showSafeMargins ? '1' : '0')
    if (result.success) {
      setStorageError(null)
      return
    }

    setStorageError(result.error ?? 'Could not save safe margins preference')
    console.warn('MirrorPage: failed to save safe margins', result.error)
  }, [showSafeMargins])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const result = saveTextToLocalStorage(MIRROR_VENUE_MODE_STORAGE_KEY, venueMode)
    if (result.success) {
      setStorageError(null)
      return
    }

    setStorageError(result.error ?? 'Could not save venue mode preference')
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
  }, [event, event?.id, event?.name, event?.venue])

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

    const stopPlaybackHealthTimer = () => {
      if (playbackHealthTimerId) {
        window.clearInterval(playbackHealthTimerId)
        playbackHealthTimerId = null
      }
    }

    const startPlaybackHealthTimer = () => {
      stopPlaybackHealthTimer()

      playbackHealthTimerId = window.setInterval(() => {
        if (document.hidden) {
          return
        }

        void syncPlaybackState()
      }, 15000)
    }

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
            clearMirrorWarningSmoothly()
            return
          }

          setMirrorWarningMessage('Realtime playback sync is reconnecting. Using queue fallback.')
        }
      } catch {
        if (isCurrent) {
          setMirrorWarningMessage('Realtime playback sync is reconnecting. Using queue fallback.')
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
          (payload: {
            eventType?: 'INSERT' | 'UPDATE' | 'DELETE'
            new?: {
              current_song_id?: string | null
              current_song_cover_url?: string | null
              is_started?: boolean | null
              quote_index?: number | null
            } | null
          }) => {
            const nextRow = payload?.new

            if (payload?.eventType === 'DELETE') {
              void syncPlaybackState()
              return
            }

            if (nextRow) {
              setPlaybackState({
                currentSongId: nextRow.current_song_id ?? null,
                currentSongCoverUrl: nextRow.current_song_cover_url ?? null,
                isStarted: Boolean(nextRow.is_started),
                quoteIndex: Number.isFinite(nextRow.quote_index)
                  ? (nextRow.quote_index as number)
                  : 0,
              })
              clearMirrorWarningSmoothly()
              return
            }

            void syncPlaybackState()
          },
        )
        .subscribe((status) => {
          if (!isCurrent) {
            return
          }

          if (status === 'SUBSCRIBED') {
            reconnectAttempt = 0
            clearMirrorWarningSmoothly()
            void syncPlaybackState()
            return
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setMirrorWarningMessage('Mirror realtime channel reconnecting. Display remains active.')

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
      if (document.visibilityState === 'hidden') {
        clearReconnectTimer()
        disconnectSubscription()
        stopPlaybackHealthTimer()
        return
      }

      recoverMirrorSync()
      startPlaybackHealthTimer()
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
        clearMirrorWarningSmoothly()
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
          clearMirrorWarningSmoothly()
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
          clearMirrorWarningSmoothly()
        }
      }
    }

    startPlaybackHealthTimer()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      isCurrent = false
      clearReconnectTimer()
      disconnectSubscription()
      stopPlaybackHealthTimer()
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
      if (shutterFallbackPulseTimerRef.current) {
        window.clearTimeout(shutterFallbackPulseTimerRef.current)
      }
      spotlightBusyRef.current = false
      spotlightQueueRef.current = []
    }
  }, [])

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
        console.warn('MirrorPage: failed to load spotlight feed posts', error)
        // Only show warning on initial seed load with no prior posts
        if (seedOnly && seenSpotlightPostIdsRef.current.size === 0) {
          setMirrorWarningMessage('Crowd spotlight sync is reconnecting.')
        }
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
            clearMirrorWarningSmoothly()
            return
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setMirrorWarningMessage('Crowd spotlight sync is reconnecting.')

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
      if (document.visibilityState === 'hidden') {
        clearReconnectTimer()
        disconnectSpotlightChannel()
        return
      }

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
      if (document.hidden) {
        return
      }

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
    <div ref={mirrorShellRef} className={`mirror-shell ${isLive ? 'mirror-shell-live' : 'mirror-shell-paused'} ${highContrastMode ? 'mirror-shell-high-contrast' : ''} ${densityMode === 'cinema' ? 'mirror-shell-density-cinema' : 'mirror-shell-density-medium'} mirror-shell-venue-${venueMode} ${!shouldShowEditorControls ? 'mirror-shell-hide-controls' : ''}`} aria-label="Mirror display screen">
      <header className="mirror-header">
        <div className="mirror-header-main">
          <p className="mirror-brand" aria-label="The Human Jukebox">
            <img src="/the-human-jukebox-logo.svg" alt="The Human Jukebox" className="mirror-brand-logo" />
          </p>
          {event?.venueLogoUrl ? (
            <p className="mirror-venue-logo" aria-label="Venue logo">
              <img src={event.venueLogoUrl} alt={`${event.venue || 'Venue'} logo`} className="mirror-venue-logo-image" />
            </p>
          ) : null}
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
          {mirrorWarning ? (
            <p className="mirror-warning" role="status">{mirrorWarning}</p>
          ) : (
            <p className="mirror-warning mirror-warning-hidden">\u00a0</p>
          )}
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
                    await requestFullscreenSafe(mirrorShellRef.current ?? document.documentElement)
                  } else {
                    await exitFullscreenSafe()
                  }
                } catch (error) {
                  console.warn('MirrorPage: fullscreen toggle failed', error)
                  setMirrorWarningMessage('Fullscreen was blocked by the browser or iframe policy. Open /mirror in its own tab, then press F11 as fallback.')
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
      </header>

      <main className={`mirror-stage ${isLive ? 'mirror-stage-live' : ''}`}>
        {!isLive && !nowPlaying ? (
          <section className="mirror-pre-show" aria-label="Pre-show welcome">
            <h1 className="mirror-pre-show-title">Welcome to the show, legends and troublemakers!</h1>
            <p className="mirror-pre-show-subtitle">Make yourselves comfy; tonight runs on requests, applause, and questionable decisions.</p>
            {showCountdown ? (
              <div className="mirror-countdown-card" aria-label="Countdown to show start">
                <p className="mirror-countdown-label">{countdownCopy.startingIn}</p>
                <p className="mirror-countdown-value">{countdownLabel}</p>
                {countdownStartLabel ? <p className="mirror-countdown-meta">{countdownCopy.scheduledPrefix} {countdownStartLabel}</p> : null}
              </div>
            ) : (event?.mirrorCountdownEnabled ?? true) && countdownStartLabel ? (
              <div className="mirror-countdown-card mirror-countdown-card-muted" aria-label="Scheduled show start">
                <p className="mirror-countdown-label">{countdownCopy.scheduledStart}</p>
                <p className="mirror-countdown-value mirror-countdown-value-compact">{countdownStartLabel}</p>
              </div>
            ) : null}
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
            <section className={`mirror-now-playing ${isLive ? 'mirror-now-playing-live' : ''}`}>
              <img src={qrUrl} alt="QR code for the audience request page" className="mirror-now-playing-qr" />
              {!isNowPlayingStarted && nowPlaying ? (
                <div className="mirror-between-songs" aria-label="Between songs">
                  <p className="mirror-between-songs-quote">{currentBetweenSongQuote}</p>
                </div>
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
                      <h1 className="mirror-title">{normalizeMirrorText(activeSong?.title, 'Waiting for requests from bold citizens...')}</h1>
                      <p className="mirror-artist">{normalizeMirrorText(activeSong?.artist, 'Be first to request a tune and set the tone.')}</p>
                      {activeSongChosenByLine ? (
                        <p className={`mirror-picked-by ${activeSongChosenByAccentClass}`}>
                          {activeSongChosenByLine}
                        </p>
                      ) : null}
                      {funFacts.length > 0 ? (
                        <div className="mirror-song-fact-box" aria-live="polite">
                          <p key={`${activeSong?.id ?? 'song'}-${currentFactIndex}`} className="mirror-song-fact">
                            {funFacts[currentFactIndex % funFacts.length]}
                          </p>
                        </div>
                      ) : null}
                      {activeSong?.audience_sings ? <span className="mirror-karaoke-tag karaoke-badge">Karaoke Request</span> : null}
                      {karaokeCheer ? (
                        <p className="mirror-karaoke-cheer">{karaokeCheer}</p>
                      ) : null}
                    </div>
                  </div>
                </>
              )}
            </section>

            <section className={`mirror-secondary-grid ${shouldShowAdminElements ? '' : 'mirror-secondary-grid-feed-only'}`}>
              <LiveFeedPanel mode="mirror" showComposer={false} title="Live Feed" showModerationControls={shouldShowAdminElements && !hideControlsForAudience} />

              <section className={`mirror-up-next ${shouldCompactQueue ? 'mirror-up-next-compact' : ''}`}>
                <p className="mirror-up-next-label">Queue</p>
                {upNext.length > 0 ? (
                  <ol className="mirror-queue">
                    {upNext.map((song, index) => {
                      const queueChosenByLine = song.createdByName
                        ? (getChosenByLine(song.id, song.createdByName) ?? `Chosen by ${song.createdByName}`)
                        : null
                      const queueChosenByAccentClass = getChosenByAccentClass(song.id)

                      return (
                        <li key={song.id} className="mirror-queue-item">
                          <span className="mirror-queue-pos">{index + 2}</span>
                          {song.cover_url && !failedCoverUrls[song.cover_url] ? (
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
                            {queueChosenByLine ? (
                              <span className={`mirror-queue-picker mirror-queue-artist-picker ${queueChosenByAccentClass}`}>{queueChosenByLine}</span>
                            ) : null}
                            {song.audience_sings ? <span className="mirror-karaoke-tag karaoke-badge">Karaoke Request</span> : null}
                          </div>
                          <span className="mirror-queue-votes">+{song.votes_count}</span>
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <p className="mirror-empty-note">No songs in the queue yet.</p>
                )}
                {shouldCompactQueue && hiddenQueueCount > 0 ? (
                  <p className="mirror-compact-note">+{hiddenQueueCount} more songs waiting in queue</p>
                ) : null}
              </section>
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
