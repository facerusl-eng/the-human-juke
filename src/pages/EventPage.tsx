import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AudienceNoGigState, { type AudienceUpcomingEvent } from '../components/audience/AudienceNoGigState'
import AudienceFixedHeader from '../components/audience/AudienceFixedHeader'
import SongVoteCard from '../components/audience/SongVoteCard'
import { useQueueStore, type QueueSong } from '../state/queueStore'
import { useAuthStore } from '../state/authStore'
import {
  commitAudienceIdentity,
  readCommittedAudienceLocale,
  readCommittedAudienceName,
  clearAudienceIdentity,
  type AudienceLocale,
} from '../lib/audienceIdentity'
import {
  BETWEEN_SONG_QUOTES,
  PLAYBACK_STATE_EVENT,
  readSharedPlaybackState,
  type SharedPlaybackState,
} from '../lib/playbackState'
import { supabase } from '../lib/supabase'
import { setEventOGTags, resetOGTags } from '../lib/metaTags'
import { readTextFromLocalStorage, saveTextToLocalStorage } from '../lib/saveHandling'

type HostProfile = {
  display_name: string | null
  instagram_url: string | null
  tiktok_url: string | null
  youtube_url: string | null
  facebook_url: string | null
  paypal_url: string | null
  mobilpay_url: string | null
  contact_email: string | null
}

function normalizeCoverUrl(coverUrl: string | null | undefined) {
  if (!coverUrl) {
    return null
  }

  const trimmedCoverUrl = coverUrl.trim()

  if (!trimmedCoverUrl) {
    return null
  }

  return trimmedCoverUrl.replace(/^http:\/\//i, 'https://')
}

function isMissingCoverImageColumnError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const normalizedError = error as {
    code?: unknown
    message?: unknown
    details?: unknown
    hint?: unknown
  }

  const code = typeof normalizedError.code === 'string' ? normalizedError.code : ''
  const text = [normalizedError.message, normalizedError.details, normalizedError.hint]
    .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''))
    .join(' ')

  return (code === '42703' || code === 'PGRST204') && text.includes('cover_image_url')
}

function isAuthSessionError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const normalizedError = error as {
    code?: unknown
    message?: unknown
    details?: unknown
    hint?: unknown
    status?: unknown
  }

  const code = typeof normalizedError.code === 'string' ? normalizedError.code.toUpperCase() : ''
  const status = typeof normalizedError.status === 'number' ? normalizedError.status : null
  const text = [normalizedError.message, normalizedError.details, normalizedError.hint]
    .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''))
    .join(' ')

  return code === 'PGRST301'
    || status === 401
    || text.includes('jwt')
    || text.includes('not authenticated')
    || text.includes('auth session missing')
}

async function fetchUpcomingEventRows() {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, venue, gig_date, gig_start_time, gig_end_time, cover_image_url')
    .eq('show_in_audience_no_gig', true)
    .order('gig_date', { ascending: true, nullsFirst: false })
    .order('gig_start_time', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (error && isMissingCoverImageColumnError(error)) {
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('events')
      .select('id, name, venue, gig_date, gig_start_time, gig_end_time')
      .eq('show_in_audience_no_gig', true)
      .order('gig_date', { ascending: true, nullsFirst: false })
      .order('gig_start_time', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })

    if (fallbackError) {
      throw fallbackError
    }

    return (fallbackData ?? []).map((eventData) => ({
      ...(eventData as Record<string, unknown>),
      cover_image_url: null,
    }))
  }

  if (error) {
    throw error
  }

  return (data ?? []) as Array<Record<string, unknown>>
}

const MAX_AUDIENCE_NAME_LENGTH = 40
const UPCOMING_EVENTS_POLL_INTERVAL_MS = 15000
const LIVE_GIG_POLL_INTERVAL_MS = 12000
const PLAYBACK_SYNC_POLL_INTERVAL_MS = 10000
const LIVE_GIG_API_POLLING_ENABLED = import.meta.env.VITE_ENABLE_LIVE_GIG_API?.trim() === '1'
const AUDIENCE_CACHE_VERSION = import.meta.env.VITE_AUDIENCE_LINK_VERSION?.trim() || '20260426'
const EXPECTED_API_FALLBACK_ERROR_PREFIX = 'Expected API fallback:'
const AUDIENCE_SONG_FACT_ROTATE_INTERVAL_MS = 15000
const AUDIENCE_SONG_FACT_MAX_LENGTH = 180
const AUDIENCE_FUN_FACTS_CACHE_STORAGE_KEY = 'human-jukebox-audience-fun-facts-cache-v1'
const AUDIENCE_SONG_FACT_PLACEHOLDER = 'No fun facts available for this song yet.'

type NowPlayingInfoSong = Pick<QueueSong, 'title' | 'artist' | 'is_explicit'>
type SongWithAudienceFacts = QueueSong & { audienceFunFacts?: string[] }
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

function truncateFact(value: string, maxLength = AUDIENCE_SONG_FACT_MAX_LENGTH) {
  const normalizedValue = value.trim()

  if (normalizedValue.length <= maxLength) {
    return normalizedValue
  }

  return `${normalizedValue.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`
}

function buildFunFactsCacheKey(title: string, artist: string) {
  return `${title.trim().toLowerCase()}::${artist.trim().toLowerCase()}`
}

function extractInterestingSentences(extract: string) {
  const sentenceMatches = extract.match(/[^.!?]+[.!?]+/g) ?? []

  const normalizedSentences = sentenceMatches
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 40 && sentence.length <= AUDIENCE_SONG_FACT_MAX_LENGTH)
    .filter((sentence) => !/^coordinates?:?/i.test(sentence))

  return Array.from(new Set(normalizedSentences)).slice(0, 10)
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

      const summaryPayload = await summaryResponse.json() as { extract?: string }
      const extract = summaryPayload.extract?.trim()

      if (!extract) {
        continue
      }

      const sentenceFacts = extractInterestingSentences(extract)
      if (sentenceFacts.length >= 3) {
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

function makeCacheBustedUrl(path: string) {
  const requestUrl = new URL(path, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  requestUrl.searchParams.set('v', `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  return requestUrl.toString()
}

async function fetchJsonNoStore(path: string) {
  const response = await fetch(makeCacheBustedUrl(path), {
    cache: 'no-store',
    headers: {
      'cache-control': 'no-cache, no-store, max-age=0',
      pragma: 'no-cache',
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`${EXPECTED_API_FALLBACK_ERROR_PREFIX} request failed (${response.status})`)
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''

  if (!contentType.includes('application/json')) {
    throw new Error(`${EXPECTED_API_FALLBACK_ERROR_PREFIX} unexpected response content-type (${contentType || 'unknown'})`)
  }

  try {
    return await response.json() as unknown
  } catch {
    throw new Error(`${EXPECTED_API_FALLBACK_ERROR_PREFIX} invalid JSON payload`)
  }
}

function isExpectedApiFallbackError(error: unknown) {
  return error instanceof Error && error.message.startsWith(EXPECTED_API_FALLBACK_ERROR_PREFIX)
}

function getExpectedApiFallbackStatusCode(error: unknown): number | null {
  if (!(error instanceof Error)) {
    return null
  }

  const statusMatch = error.message.match(/\((\d{3})\)$/)

  if (!statusMatch?.[1]) {
    return null
  }

  const parsedStatus = Number(statusMatch[1])
  return Number.isFinite(parsedStatus) ? parsedStatus : null
}

function isSamePlaybackState(left: SharedPlaybackState | null, right: SharedPlaybackState | null) {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return left.currentSongId === right.currentSongId
    && left.currentSongCoverUrl === right.currentSongCoverUrl
    && left.isStarted === right.isStarted
    && left.quoteIndex === right.quoteIndex
}

function getLiveGigIdFromApiPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const normalizedPayload = payload as {
    id?: unknown
    eventId?: unknown
    event_id?: unknown
    liveGig?: unknown
    data?: unknown
  }

  const directId = normalizedPayload.id ?? normalizedPayload.eventId ?? normalizedPayload.event_id

  if (typeof directId === 'string' && directId.trim()) {
    return directId.trim()
  }

  const nestedLiveGig = normalizedPayload.liveGig

  if (nestedLiveGig && typeof nestedLiveGig === 'object') {
    const nestedId = (nestedLiveGig as { id?: unknown; eventId?: unknown; event_id?: unknown }).id
      ?? (nestedLiveGig as { id?: unknown; eventId?: unknown; event_id?: unknown }).eventId
      ?? (nestedLiveGig as { id?: unknown; eventId?: unknown; event_id?: unknown }).event_id

    if (typeof nestedId === 'string' && nestedId.trim()) {
      return nestedId.trim()
    }
  }

  const nestedData = normalizedPayload.data

  if (nestedData && typeof nestedData === 'object') {
    const nestedId = (nestedData as { id?: unknown; eventId?: unknown; event_id?: unknown }).id
      ?? (nestedData as { id?: unknown; eventId?: unknown; event_id?: unknown }).eventId
      ?? (nestedData as { id?: unknown; eventId?: unknown; event_id?: unknown }).event_id

    if (typeof nestedId === 'string' && nestedId.trim()) {
      return nestedId.trim()
    }
  }

  return null
}

function mapUpcomingEvents(rows: Array<Record<string, unknown>>): AudienceUpcomingEvent[] {
  return rows.map((eventData) => ({
    id: String(eventData.id ?? ''),
    name: (eventData.name as string | null) ?? 'Untitled Gig',
    venue: (eventData.venue as string | null) ?? null,
    gigDate: (eventData.gig_date as string | null) ?? null,
    gigStartTime: (eventData.gig_start_time as string | null) ?? null,
    gigEndTime: (eventData.gig_end_time as string | null) ?? null,
    coverImageUrl: normalizeCoverUrl((eventData.cover_image_url as string | null) ?? null),
  }))
}

async function fetchUpcomingEventsFromApi(): Promise<AudienceUpcomingEvent[]> {
  const payload = await fetchJsonNoStore('/events')

  if (!payload) {
    return []
  }

  if (Array.isArray(payload)) {
    return mapUpcomingEvents(payload as Array<Record<string, unknown>>)
  }

  if (typeof payload === 'object') {
    const normalizedPayload = payload as { events?: unknown; data?: unknown }
    const candidateRows = Array.isArray(normalizedPayload.events)
      ? normalizedPayload.events
      : Array.isArray(normalizedPayload.data)
      ? normalizedPayload.data
      : []

    return mapUpcomingEvents(candidateRows as Array<Record<string, unknown>>)
  }

  return []
}

function hasUnsafeControlChars(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index)

    if ((charCode >= 0 && charCode <= 8) || (charCode >= 11 && charCode <= 12) || (charCode >= 14 && charCode <= 31) || charCode === 127) {
      return true
    }
  }

  return false
}

// Handles MobilePay stored as either a URL or a raw phone number / username.
// Returns { href, display } or null.
function resolveMobilepayLink(value: string | null | undefined): { href: string; display: string } | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  // Phone number pattern: +45... or just digits with optional +
  if (/^\+?[\d\s-]{6,16}$/.test(trimmed)) {
    const digits = trimmed.replace(/[\s-]/g, '')
    return { href: `tel:${digits}`, display: `MobilePay (${trimmed})` }
  }

  const url = normalizeExternalLink(trimmed)
  if (!url) return null
  return { href: url, display: 'MobilePay' }
}

function normalizeExternalLink(url: string | null | undefined) {
  const trimmedUrl = url?.trim()

  if (!trimmedUrl) {
    return null
  }

  const withProtocol = /^https?:\/\//i.test(trimmedUrl)
    ? trimmedUrl
    : `https://${trimmedUrl}`

  try {
    const normalizedUrl = new URL(withProtocol)

    if (!['http:', 'https:'].includes(normalizedUrl.protocol)) {
      return null
    }

    return normalizedUrl.toString()
  } catch {
    return null
  }
}

function EventPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { authError, loading: authLoading, user } = useAuthStore()
  const {
    event,
    songs,
    performedSongs,
    loading,
    upvoteSong,
  } = useQueueStore()

  const [hostProfile, setHostProfile] = useState<HostProfile | null>(null)
  const [audienceNameInput, setAudienceNameInput] = useState('')
  const [audienceName, setAudienceName] = useState('')
  const [audienceLocale, setAudienceLocale] = useState<AudienceLocale>(() => readCommittedAudienceLocale())
  const [audienceNameError, setAudienceNameError] = useState<string | null>(null)
  const [audienceNameSaving, setAudienceNameSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [confirmationText, setConfirmationText] = useState<string | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [votingSongIds, setVotingSongIds] = useState<Record<string, boolean>>({})
  const [votePulseTicks, setVotePulseTicks] = useState<Record<string, number>>({})
  const [songMoveTicks, setSongMoveTicks] = useState<Record<string, number>>({})
  const [showTipThankYou, setShowTipThankYou] = useState(false)
  const [songFunFacts, setSongFunFacts] = useState<string[]>([])
  const [currentSongFactIndex, setCurrentSongFactIndex] = useState(0)
  const tipThankYouTimerRef = useRef<number | null>(null)
  const [playbackState, setPlaybackState] = useState<SharedPlaybackState | null>(null)
  const [upcomingEvents, setUpcomingEvents] = useState<AudienceUpcomingEvent[]>([])
  const [upcomingEventsLoading, setUpcomingEventsLoading] = useState(false)
  const [upcomingEventsNotice, setUpcomingEventsNotice] = useState<string | null>(null)
  const [audienceLoadingFallbackActive, setAudienceLoadingFallbackActive] = useState(false)
  const [hasResolvedInitialAudienceLoad, setHasResolvedInitialAudienceLoad] = useState(false)
  const [hasCompletedInitialLiveGigProbe, setHasCompletedInitialLiveGigProbe] = useState(false)

  const previousVotesRef = useRef<Map<string, number>>(new Map())
  const previousSongRanksRef = useRef<Map<string, number>>(new Map())
  const audienceLinkVersionRef = useRef(AUDIENCE_CACHE_VERSION)
  const funFactsCacheRef = useRef<FunFactsCache>({})
  const funFactsInFlightRef = useRef<Partial<Record<string, Promise<string[]>>>>({})
  const votingSongIdsRef = useRef<Record<string, boolean>>({})
  const confirmationTimerRef = useRef<number | null>(null)

  const roomOpen = event?.roomOpen ?? false
  const duplicateRequestsBlocked = event ? !event.allowDuplicateRequests : false
  const activeRequestCap = event?.maxActiveRequestsPerUser ?? null
  const nowPlaying = songs[0]
  const playbackSong = playbackState?.currentSongId
    ? songs.find((song) => song.id === playbackState.currentSongId) ?? null
    : null
  const activeSong = playbackSong ?? nowPlaying
  const isNowPlayingStarted = Boolean(playbackState?.isStarted && playbackState.currentSongId)
  const displaySong = isNowPlayingStarted ? activeSong : nowPlaying
  const displaySongCoverUrl = displaySong?.cover_url ?? playbackState?.currentSongCoverUrl ?? null
  const currentSongFact = songFunFacts.length > 0
    ? songFunFacts[currentSongFactIndex % songFunFacts.length]
    : AUDIENCE_SONG_FACT_PLACEHOLDER
  const factEligibleSongs = useMemo(() => songs.filter((song) => (
    song
    && typeof song.id === 'string'
    && typeof song.title === 'string'
    && typeof song.artist === 'string'
  )), [songs])
  const upNext = useMemo(() => {
    const candidateSongs = isNowPlayingStarted
      ? songs.filter((song) => song.id !== activeSong?.id)
      : songs.slice(1)

    return [...candidateSongs].sort((songA, songB) => {
      if (songB.votes_count !== songA.votes_count) {
        return songB.votes_count - songA.votes_count
      }

      const positionA = typeof songA.position === 'number' ? songA.position : Number.MAX_SAFE_INTEGER
      const positionB = typeof songB.position === 'number' ? songB.position : Number.MAX_SAFE_INTEGER
      return positionA - positionB
    })
  }, [songs, isNowPlayingStarted, activeSong?.id])
  const isBetweenSongs = playbackState && !playbackState.isStarted
  const betweenSongQuote = isBetweenSongs
    ? BETWEEN_SONG_QUOTES[(playbackState?.quoteIndex ?? 0) % BETWEEN_SONG_QUOTES.length]
    : null
  const hottestVoteCount = upNext.reduce((highestVotes, song) => Math.max(highestVotes, song.votes_count), 0)
  const recentlyPlayedSongs = performedSongs.slice(0, 8)
  const eventSearchParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const requestedEventId = eventSearchParams.get('event') ?? eventSearchParams.get('eventId')
  const hasRequestedEventParam = Boolean(requestedEventId)
  const liveGigApiUnavailableRef = useRef(false)
  const copy = audienceLocale === 'da'
    ? {
        audienceApp: 'Publikumsapp',
        entryEyebrow: 'Official Audience Lounge',
        entryCopy: 'Du går ind i den live publikumsapp. Ønsk sange og stem dine favoritter til tops.',
        nameLabel: 'Dit navn',
        namePlaceholder: 'f.eks. Alex',
        languageLabel: 'Sprog',
        join: 'Gå ind',
        joining: 'Går ind...',
        welcome: 'Velkommen! 🎤',
        waitingGreeting: 'Hej',
        waitingTitle: 'Velkommen til showet, skønne mennesker!',
        waitingCopy: 'Find jer til rette, se selvsikre ud, og giv den kunstneriske ledelse skylden for alt kaos.',
        startingSoon: 'Event starter snart',
        viewUpcoming: 'Se alle kommende events',
        audienceLive: 'Publikum Live',
        audienceHome: 'Publikumsforside',
        roomOpen: 'Rummet er åbent',
        songList: 'Sangliste',
        tipJar: 'Drikkepenge',
        socialLinks: 'Sociale links',
        howItWorks: 'Sådan virker det',
        hideHowItWorks: 'Skjul guide',
        howItWorksTitle: 'Sådan virker det',
        howItWorksSteps: [
          'Tryk på Sangliste og vælg Human Jukebox eller Karaoke.',
          'Tilføj dit ønske (karaoke kræver bekræftelse, fordi du synger selv).',
          'Stem i Livekø for at skubbe dine favoritter op.',
          'Følg Spiller nu og hold energien i gang.',
          'Brug Sociale links eller Drikkepenge for at støtte artisten.',
        ],
        duplicateBlocked: 'Dubletønsker er blokeret til dette gig.',
        activeRequestLimit: 'Hvert publikumsmedlem kan have {count} aktive ønsker i køen.',
        nowPlaying: 'Spiller nu',
        queueThinking: 'Køen tænker sig lige om',
        requestPrompt: 'Åbn Sangliste og ønsk en sang, før nogen vælger Wonderwall.',
        liveQueue: 'Livekø',
        votesRise: 'Flest stemmer først',
        noSongsQueued: 'Ingen sange i kø endnu.',
        playedSongs: 'Spillede sange',
        latestOnTop: 'Nyeste øverst',
        noSongsPlayed: 'Ingen sange spillet endnu.',
        performerLinks: 'Artistlinks',
        tipJarCopy: 'Hvis den sidste sang fik dig til at synge, så giv artisten en skilling. Klapsalver er søde, men huslejen larmer mere.',
        tipThankYou: event?.tipThankYouMessageDA?.trim() || 'Tusind tak for din støtte — det betyder meget. — Harald',
        enterName: 'Skriv dit navn for at fortsætte.',
        keepNameShort: `Hold dit navn under ${MAX_AUDIENCE_NAME_LENGTH} tegn.`,
        removeUnsupported: 'Fjern ugyldige tegn fra dit navn.',
        saveFailed: 'Kunne ikke gemme dit navn.',
      }
    : {
        audienceApp: 'Audience App',
        entryEyebrow: 'Official Audience Lounge',
        entryCopy: 'You are joining the live audience board. Request songs and vote your favorites to the top.',
        nameLabel: 'Your name',
        namePlaceholder: 'e.g. Alex',
        languageLabel: 'Language',
        join: 'Join Audience',
        joining: 'Joining...',
        welcome: 'Welcome! 🎤',
        waitingGreeting: 'Hi',
        waitingTitle: 'Welcome to the show, you lovely lot!',
        waitingCopy: 'Settle in, look confident, and blame any chaos on artistic direction.',
        startingSoon: 'Event starting soon',
        viewUpcoming: 'View all upcoming gigs',
        audienceLive: 'Audience Live',
        audienceHome: 'Audience Home',
        roomOpen: 'Room Open',
        songList: 'Song List',
        tipJar: 'Tip Jar',
        socialLinks: 'Social Links',
        howItWorks: 'How It Works',
        hideHowItWorks: 'Hide How It Works',
        howItWorksTitle: 'How It Works',
        howItWorksSteps: [
          'Tap Song List and choose Human Jukebox or Karaoke.',
          'Add your request (karaoke asks for confirmation because you sing it).',
          'Vote in Live Queue to push your favorites up.',
          'Watch Now Playing and keep the energy going.',
          'Use Social Links or Tip Jar to support the artist.',
        ],
        duplicateBlocked: 'Duplicate requests are blocked for this gig.',
        activeRequestLimit: 'Each audience member can keep {count} active request{suffix} in the queue.',
        nowPlaying: 'Now Playing',
        queueThinking: 'Queue is having a polite think',
        requestPrompt: 'Open Song List and request one before someone picks Wonderwall.',
        liveQueue: 'Live Queue',
        votesRise: 'Most votes rises first',
        noSongsQueued: 'No songs queued yet.',
        playedSongs: 'Played Songs',
        latestOnTop: 'Latest on top',
        noSongsPlayed: 'No songs played yet.',
        performerLinks: 'Performer links',
        tipJarCopy: 'If that last song made you sing like nobody\'s watching (they were), toss the artist a tip. Applause is cute, rent is louder. 🎤✨',
        tipThankYou: event?.tipThankYouMessageEN?.trim() || 'Thank you so much for your support — it means a lot. — Harald',
        enterName: 'Please enter your name to continue.',
        keepNameShort: `Please keep your name under ${MAX_AUDIENCE_NAME_LENGTH} characters.`,
        removeUnsupported: 'Please remove unsupported characters from your name.',
        saveFailed: 'Failed to save your name.',
      }

  useEffect(() => {
    if (hasRequestedEventParam) {
      setHasCompletedInitialLiveGigProbe(true)
      return
    }

    setHasCompletedInitialLiveGigProbe(false)
  }, [hasRequestedEventParam])

  useEffect(() => {
    votingSongIdsRef.current = votingSongIds
  }, [votingSongIds])

  useEffect(() => {
    return () => {
      if (confirmationTimerRef.current !== null) {
        window.clearTimeout(confirmationTimerRef.current)
        confirmationTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      if (tipThankYouTimerRef.current !== null) {
        window.clearTimeout(tipThankYouTimerRef.current)
        tipThankYouTimerRef.current = null
      }
    }
  }, [])

  const persistFunFactsCache = useCallback(() => {
    const serializedCache = JSON.stringify(funFactsCacheRef.current)
    const result = saveTextToLocalStorage(AUDIENCE_FUN_FACTS_CACHE_STORAGE_KEY, serializedCache)

    if (!result.success) {
      console.warn('EventPage: failed to persist song fun facts cache', result.error)
    }
  }, [])

  const ensureSongFunFacts = useCallback(async (song: QueueSong, signal: AbortSignal) => {
    const songWithAudienceFacts = song as SongWithAudienceFacts
    const embeddedFacts = normalizeFunFacts(songWithAudienceFacts.audienceFunFacts ?? [])

    if (embeddedFacts.length > 0) {
      return embeddedFacts.slice(0, 10)
    }

    const cacheKey = buildFunFactsCacheKey(song.title, song.artist)
    const existingFacts = funFactsCacheRef.current[cacheKey]

    if (existingFacts?.length) {
      songWithAudienceFacts.audienceFunFacts = existingFacts
      return existingFacts
    }

    if (funFactsInFlightRef.current[cacheKey]) {
      return funFactsInFlightRef.current[cacheKey] as Promise<string[]>
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
      songWithAudienceFacts.audienceFunFacts = mergedFacts
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
    const persistedCacheText = readTextFromLocalStorage(AUDIENCE_FUN_FACTS_CACHE_STORAGE_KEY)

    if (!persistedCacheText) {
      return
    }

    try {
      const persistedCache = JSON.parse(persistedCacheText) as FunFactsCache

      if (persistedCache && typeof persistedCache === 'object') {
        funFactsCacheRef.current = persistedCache
      }
    } catch {
      // Corrupt cache is ignored and replaced on next write.
    }
  }, [])

  useEffect(() => {
    const abortController = new AbortController()

    const prefetchFacts = async () => {
      for (const song of factEligibleSongs) {
        if (abortController.signal.aborted) {
          return
        }

        try {
          await ensureSongFunFacts(song, abortController.signal)
        } catch {
          // Prefetch is best effort only.
        }
      }
    }

    void prefetchFacts()

    return () => {
      abortController.abort()
    }
  }, [ensureSongFunFacts, factEligibleSongs])

  useEffect(() => {
    if (!displaySong || isBetweenSongs) {
      setSongFunFacts([])
      setCurrentSongFactIndex(0)
      return
    }

    const abortController = new AbortController()
    const songWithAudienceFacts = displaySong as SongWithAudienceFacts
    const embeddedFacts = normalizeFunFacts(songWithAudienceFacts.audienceFunFacts ?? [])

    if (embeddedFacts.length > 0) {
      setSongFunFacts(embeddedFacts)
      setCurrentSongFactIndex(0)
      return
    }

    const cacheKey = buildFunFactsCacheKey(displaySong.title, displaySong.artist)
    const cachedFacts = funFactsCacheRef.current[cacheKey]

    if (cachedFacts?.length) {
      songWithAudienceFacts.audienceFunFacts = cachedFacts
      setSongFunFacts(cachedFacts)
      setCurrentSongFactIndex(0)
      return
    }

    const loadSongFunFacts = async () => {
      try {
        const fetchedFacts = await ensureSongFunFacts(displaySong, abortController.signal)

        if (abortController.signal.aborted) {
          return
        }

        setSongFunFacts(fetchedFacts)
        setCurrentSongFactIndex(0)
      } catch (error) {
        if (abortController.signal.aborted) {
          return
        }

        console.warn('EventPage: failed to load song fun facts', error)
        setSongFunFacts([])
        setCurrentSongFactIndex(0)
      }
    }

    void loadSongFunFacts()

    return () => {
      abortController.abort()
    }
  }, [displaySong, ensureSongFunFacts, isBetweenSongs])

  useEffect(() => {
    if (songFunFacts.length <= 1) {
      setCurrentSongFactIndex(0)
      return
    }

    const intervalId = window.setInterval(() => {
      setCurrentSongFactIndex((currentIndex) => (currentIndex + 1) % songFunFacts.length)
    }, AUDIENCE_SONG_FACT_ROTATE_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [songFunFacts])

  const handleTipClick = useCallback(() => {
    if (tipThankYouTimerRef.current !== null) {
      window.clearTimeout(tipThankYouTimerRef.current)
    }
    setShowTipThankYou(true)
    tipThankYouTimerRef.current = window.setTimeout(() => {
      setShowTipThankYou(false)
      tipThankYouTimerRef.current = null
    }, 4000)
  }, [])

  const handleVoteSong = useCallback(async (songId: string) => {
    if (votingSongIdsRef.current[songId]) {
      return
    }

    setVotingSongIds((currentState) => ({ ...currentState, [songId]: true }))

    try {
      await upvoteSong(songId)
    } catch {
      setErrorText('Vote failed. You may have already voted or voting is locked.')
    } finally {
      setVotingSongIds((currentState) => {
        const nextState = { ...currentState }
        delete nextState[songId]
        return nextState
      })
    }
  }, [upvoteSong])

  useEffect(() => {
    if (!loading || event) {
      setAudienceLoadingFallbackActive(false)
      return
    }

    const timerId = window.setTimeout(() => {
      setAudienceLoadingFallbackActive(true)
      setUpcomingEventsNotice('Loading is taking longer than expected. Showing upcoming events while we reconnect...')
    }, 1600)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [loading, event])

  useEffect(() => {
    if (hasResolvedInitialAudienceLoad) {
      return
    }

    if (!loading || Boolean(event) || upcomingEvents.length > 0 || Boolean(upcomingEventsNotice)) {
      setHasResolvedInitialAudienceLoad(true)
    }
  }, [loading, event, upcomingEvents.length, upcomingEventsNotice, hasResolvedInitialAudienceLoad])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (!LIVE_GIG_API_POLLING_ENABLED) {
      setHasCompletedInitialLiveGigProbe(true)
      return
    }

    let isCurrent = true
    let pollTimerId: number | null = null

    const checkLiveGig = async () => {
      if (liveGigApiUnavailableRef.current) {
        if (isCurrent) {
          setHasCompletedInitialLiveGigProbe(true)
        }
        return
      }

      try {
        const payload = await fetchJsonNoStore('/api/live-gig')
        const liveGigId = getLiveGigIdFromApiPayload(payload)

        if (!isCurrent) {
          return
        }

        if (liveGigId) {
          if (requestedEventId !== liveGigId) {
            navigate(`/audience?event=${encodeURIComponent(liveGigId)}&v=${audienceLinkVersionRef.current}`, {
              replace: true,
            })
          }

          setUpcomingEventsNotice('A live show just started. Connecting now...')
          setHasCompletedInitialLiveGigProbe(true)
          return
        }

        if (requestedEventId) {
          navigate(`/audience?v=${audienceLinkVersionRef.current}`, { replace: true })
        }

        setHasCompletedInitialLiveGigProbe(true)
      } catch (error) {
        const expectedFallbackError = isExpectedApiFallbackError(error)
        const fallbackStatusCode = getExpectedApiFallbackStatusCode(error)

        if (expectedFallbackError && fallbackStatusCode === 404) {
          // /api/live-gig is optional in some deployments; disable polling to avoid repeated 404 logs.
          liveGigApiUnavailableRef.current = true
          if (isCurrent) {
            setHasCompletedInitialLiveGigProbe(true)
          }
          return
        }

        if (!expectedFallbackError) {
          console.warn('EventPage: live gig API check failed', error)
        }

        if (isCurrent && !event && !expectedFallbackError) {
          setUpcomingEventsNotice('Live status is reconnecting. Upcoming events are shown below.')
          setHasCompletedInitialLiveGigProbe(true)
        }
      }
    }

    void checkLiveGig()

    pollTimerId = window.setInterval(() => {
      if (document.hidden) {
        return
      }

      void checkLiveGig()
    }, LIVE_GIG_POLL_INTERVAL_MS)

    return () => {
      isCurrent = false
      if (pollTimerId !== null) {
        window.clearInterval(pollTimerId)
      }
    }
  }, [navigate, requestedEventId, event])

  const socialLinks = useMemo(() => ([
    { label: 'Instagram', url: event?.instagramUrl || hostProfile?.instagram_url },
    { label: 'TikTok', url: event?.tiktokUrl || hostProfile?.tiktok_url },
    { label: 'YouTube', url: event?.youtubeUrl || hostProfile?.youtube_url },
    { label: 'Facebook', url: event?.facebookUrl || hostProfile?.facebook_url },
  ]
    .map((link) => ({ ...link, url: normalizeExternalLink(link.url) }))
    .filter((link): link is { label: string; url: string } => Boolean(link.url))
    .concat(
      (event?.contactEmail || hostProfile?.contact_email)?.trim()
        ? [{ label: '✉ Email', url: `mailto:${(event?.contactEmail || hostProfile?.contact_email)?.trim()}` }]
        : []
    )
  ), [event?.contactEmail, event?.facebookUrl, event?.instagramUrl, event?.tiktokUrl, event?.youtubeUrl, hostProfile])

  const resolvedMobilepayLink = resolveMobilepayLink(event?.mobilpayUrl || hostProfile?.mobilpay_url)
  const allTipLinks = useMemo(() => {
    const links: { label: string; url: string }[] = []
    if (resolvedMobilepayLink) {
      links.push({ label: resolvedMobilepayLink.display, url: resolvedMobilepayLink.href })
    }
    const paypal = normalizeExternalLink(event?.paypalUrl || hostProfile?.paypal_url)
    if (paypal) links.push({ label: 'PayPal', url: paypal })
    return links
  }, [event?.paypalUrl, hostProfile?.paypal_url, resolvedMobilepayLink])
  const primaryTipLink = allTipLinks[0] ?? null
  const secondaryTipLinks = allTipLinks.slice(1)

  useEffect(() => {
    const state = location.state as { requestConfirmation?: string } | null

    if (!state?.requestConfirmation) {
      return
    }

    setConfirmationText(state.requestConfirmation)
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })

    if (confirmationTimerRef.current !== null) {
      window.clearTimeout(confirmationTimerRef.current)
    }

    confirmationTimerRef.current = window.setTimeout(() => {
      setConfirmationText(null)
      confirmationTimerRef.current = null
    }, 2600)
  }, [location.pathname, location.search, location.state, navigate])

  useEffect(() => {
    const storedAudienceName = readCommittedAudienceName()

    if (storedAudienceName) {
      setAudienceName(storedAudienceName)
      setAudienceNameInput(storedAudienceName)
    }

    setAudienceLocale(readCommittedAudienceLocale())
  }, [])

  // Broadcast presence to the host dashboard while audience member is active
  useEffect(() => {
    const eventId = event?.id

    if (!eventId || !audienceName || !roomOpen) {
      return
    }

    const channel = supabase.channel(`audience-presence:${eventId}`, {
      config: { presence: { key: audienceName } },
    })

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ name: audienceName, joinedAt: Date.now() })
      }
    })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [event?.id, audienceName, roomOpen])

  useEffect(() => {
    let isCurrent = true

    const loadHostProfile = async () => {
      try {
        const hostId = event?.hostId

        if (!hostId) {
          if (isCurrent) {
            setHostProfile(null)
          }
          return
        }

        const { data, error } = await supabase
          .from('profiles')
          .select('display_name, instagram_url, tiktok_url, youtube_url, facebook_url, paypal_url, mobilpay_url, contact_email')
          .eq('user_id', hostId)
          .maybeSingle()

        if (error) {
          throw error
        }

        if (isCurrent) {
          setHostProfile((data as HostProfile | null) ?? null)
        }
      } catch (error) {
        console.warn('EventPage: failed to load host profile', error)
        if (isCurrent) {
          setHostProfile(null)
        }
      }
    }

    void loadHostProfile()

    return () => {
      isCurrent = false
    }
  }, [event?.hostId])

  useEffect(() => {
    if (event) {
      setUpcomingEvents([])
      setUpcomingEventsLoading(false)
      setUpcomingEventsNotice(null)
      return
    }

    if (authLoading && !user) {
      setUpcomingEventsLoading(true)
      setUpcomingEventsNotice('Finishing sign-in before loading upcoming gigs...')
    }

    let isCurrent = true
    let channel: ReturnType<typeof supabase.channel> | null = null
    let pollTimerId: number | null = null

    const loadUpcomingEvents = async () => {
      setUpcomingEventsLoading(true)

      try {
        let mappedEvents: AudienceUpcomingEvent[] = []

        try {
          mappedEvents = await fetchUpcomingEventsFromApi()
        } catch (apiError) {
          if (!isExpectedApiFallbackError(apiError)) {
            console.warn('EventPage: /events fetch failed, falling back to Supabase', apiError)
          }
          const eventRows = await fetchUpcomingEventRows()
          mappedEvents = mapUpcomingEvents(eventRows)
        }

        if (mappedEvents.length === 0 && !user) {
          try {
            const { error: signInError } = await supabase.auth.signInAnonymously()

            if (signInError) {
              throw signInError
            }

            try {
              mappedEvents = await fetchUpcomingEventsFromApi()
            } catch {
              const eventRows = await fetchUpcomingEventRows()
              mappedEvents = mapUpcomingEvents(eventRows)
            }
          } catch (signInError) {
            console.warn('EventPage: anonymous sign-in retry failed for upcoming events', signInError)
          }
        }

        if (!isCurrent) {
          return
        }

        setUpcomingEvents(mappedEvents)

        if (mappedEvents.length === 0) {
          setUpcomingEventsNotice('No upcoming gigs have been posted yet.')
        } else {
          setUpcomingEventsNotice(null)
        }
      } catch (error) {
        console.warn('EventPage: failed to load upcoming no-gig events', error)

        if (isAuthSessionError(error) && !user) {
          try {
            const { error: signInError } = await supabase.auth.signInAnonymously()

            if (signInError) {
              throw signInError
            }

            let mappedEvents: AudienceUpcomingEvent[] = []

            try {
              mappedEvents = await fetchUpcomingEventsFromApi()
            } catch {
              const eventRows = await fetchUpcomingEventRows()
              mappedEvents = mapUpcomingEvents(eventRows)
            }

            if (isCurrent) {
              setUpcomingEvents(mappedEvents)

              if (mappedEvents.length === 0) {
                setUpcomingEventsNotice('No upcoming gigs have been posted yet.')
              } else {
                setUpcomingEventsNotice(null)
              }
            }

            return
          } catch (retryError) {
            console.warn('EventPage: auth retry failed while loading upcoming no-gig events', retryError)
          }
        }

        if (isCurrent) {
          setUpcomingEvents([])
          setUpcomingEventsNotice('Could not load upcoming gigs right now. Retrying in the background...')
        }
      } finally {
        if (isCurrent) {
          setUpcomingEventsLoading(false)
        }
      }
    }

    void loadUpcomingEvents()

    channel = supabase
      .channel('audience-upcoming-events')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events',
        },
        () => {
          void loadUpcomingEvents()
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          return
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setUpcomingEventsNotice('Live updates are reconnecting. Upcoming events are still available.')
        }
      })

    pollTimerId = window.setInterval(() => {
      if (document.hidden) {
        return
      }

      void loadUpcomingEvents()
    }, UPCOMING_EVENTS_POLL_INTERVAL_MS)

    return () => {
      isCurrent = false
      if (channel) {
        void supabase.removeChannel(channel)
      }
      if (pollTimerId !== null) {
        window.clearInterval(pollTimerId)
      }
    }
  }, [event, authLoading, user])

  // Update OG meta tags for social media sharing
  useEffect(() => {
    if (!event) {
      resetOGTags()
      return
    }

    const description = event.venue
      ? `Join the queue at ${event.name} in ${event.venue}. Request songs and vote with the audience!`
      : `Join the queue for ${event.name}. Request songs and vote with the audience!`

    setEventOGTags(event.name, description, undefined, typeof window !== 'undefined' ? window.location.href : undefined)
  }, [event, event?.id, event?.name, event?.venue])

  useEffect(() => {
    const previousVotes = previousVotesRef.current
    const increasedSongIds: string[] = []
    const previousSongRanks = previousSongRanksRef.current
    const movedSongIds: string[] = []

    for (const song of songs) {
      const previousVotesCount = previousVotes.get(song.id)

      if (typeof previousVotesCount === 'number' && song.votes_count > previousVotesCount) {
        increasedSongIds.push(song.id)
      }

      const previousRank = previousSongRanks.get(song.id)
      const nextRank = upNext.findIndex((upNextSong) => upNextSong.id === song.id)

      if (typeof previousRank === 'number' && nextRank >= 0 && previousRank !== nextRank) {
        movedSongIds.push(song.id)
      }
    }

    if (increasedSongIds.length) {
      setVotePulseTicks((currentTicks) => {
        const nextTicks = { ...currentTicks }

        for (const songId of increasedSongIds) {
          nextTicks[songId] = (nextTicks[songId] ?? 0) + 1
        }

        return nextTicks
      })
    }

    if (movedSongIds.length) {
      setSongMoveTicks((currentTicks) => {
        const nextTicks = { ...currentTicks }

        for (const songId of movedSongIds) {
          nextTicks[songId] = (nextTicks[songId] ?? 0) + 1
        }

        return nextTicks
      })
    }

    previousVotesRef.current = new Map(songs.map((song) => [song.id, song.votes_count]))
    previousSongRanksRef.current = new Map(upNext.map((song, index) => [song.id, index]))
  }, [songs, upNext])

  useEffect(() => {
    const eventId = event?.id

    if (!eventId) {
      setPlaybackState(null)
      return
    }

    let isCurrent = true
    let subscription: ReturnType<typeof supabase.channel> | null = null
    let syncTimerId: number | null = null

    const syncPlaybackState = async () => {
      if (!isCurrent) return

      try {
        const state = await readSharedPlaybackState(eventId)
        if (isCurrent) {
          setPlaybackState((currentState) => (isSamePlaybackState(currentState, state) ? currentState : state))
        }
      } catch (error) {
        console.warn('EventPage: playback sync failed', error)
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
        () => {
          void syncPlaybackState()
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn('EventPage: playback subscription reconnecting', { eventId, status })
        }
      })

    const onPlaybackStateEvent = (nextEvent: Event) => {
      const detail = (nextEvent as CustomEvent<{ eventId: string; state: SharedPlaybackState }>).detail

      if (detail?.eventId === eventId) {
        setPlaybackState((currentState) => (isSamePlaybackState(currentState, detail.state) ? currentState : detail.state))
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

    return () => {
      isCurrent = false
      if (subscription) {
        void subscription.unsubscribe()
      }
      if (syncTimerId !== null) {
        window.clearInterval(syncTimerId)
      }
      window.removeEventListener(PLAYBACK_STATE_EVENT, onPlaybackStateEvent as EventListener)
    }
  }, [event?.id])

  const onAudienceNameSubmit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault()
    setAudienceNameError(null)

    if (audienceNameSaving) {
      return
    }

    const normalizedAudienceName = audienceNameInput.trim()

    if (!normalizedAudienceName) {
      setAudienceNameError(copy.enterName)
      setErrorText(copy.enterName)
      return
    }

    if (normalizedAudienceName.length > MAX_AUDIENCE_NAME_LENGTH) {
      setAudienceNameError(copy.keepNameShort)
      setErrorText(copy.keepNameShort)
      return
    }

    if (hasUnsafeControlChars(normalizedAudienceName)) {
      setAudienceNameError(copy.removeUnsupported)
      setErrorText(copy.removeUnsupported)
      return
    }

    // Save audience name with loading state
    setAudienceNameSaving(true)
    setAudienceNameError(null)

    try {
      commitAudienceIdentity({ name: normalizedAudienceName, locale: audienceLocale })
      setAudienceName(normalizedAudienceName)
      setErrorText(null)
      setConfirmationText(copy.welcome)

      if (confirmationTimerRef.current !== null) {
        window.clearTimeout(confirmationTimerRef.current)
      }

      confirmationTimerRef.current = window.setTimeout(() => {
        setConfirmationText(null)
        confirmationTimerRef.current = null
      }, 2000)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : copy.saveFailed
      setAudienceNameError(errorMessage)
      setErrorText(errorMessage)
      console.warn('EventPage: failed to save audience name', error)
    } finally {
      setAudienceNameSaving(false)
    }
  }

  const handleSignOut = useCallback(() => {
    clearAudienceIdentity()
    navigate('/audience', { replace: true })
  }, [navigate])

  if (
    loading
    && !audienceLoadingFallbackActive
    && !hasResolvedInitialAudienceLoad
    && !event
    && !hasCompletedInitialLiveGigProbe
    && upcomingEvents.length === 0
  ) {
    return (
      <section className="audience-entry-shell" aria-label="Audience loading">
        <article className="queue-panel audience-entry-card">
          <p className="eyebrow">Audience App</p>
          <div className="loading-skeleton loading-skeleton-title" aria-hidden="true"></div>
          <div className="loading-skeleton loading-skeleton-line" aria-hidden="true"></div>
          <div className="loading-skeleton loading-skeleton-line loading-skeleton-line-short" aria-hidden="true"></div>
        </article>
      </section>
    )
  }

  if (!event) {
    if (!hasRequestedEventParam && !hasCompletedInitialLiveGigProbe) {
      return (
        <section className="audience-entry-shell" aria-label="Audience loading">
          <article className="queue-panel audience-entry-card">
            <p className="eyebrow">Audience App</p>
            <div className="loading-skeleton loading-skeleton-title" aria-hidden="true"></div>
            <div className="loading-skeleton loading-skeleton-line" aria-hidden="true"></div>
            <div className="loading-skeleton loading-skeleton-line loading-skeleton-line-short" aria-hidden="true"></div>
          </article>
        </section>
      )
    }

    return (
      <AudienceNoGigState
        upcomingEvents={upcomingEvents}
        loadingUpcomingEvents={upcomingEventsLoading}
        upcomingEventsNotice={upcomingEventsNotice ?? authError}
        getEventHref={(eventId) => `/audience?event=${encodeURIComponent(eventId)}&v=${audienceLinkVersionRef.current}`}
        locale={audienceLocale}
      />
    )
  }

  if (!audienceName) {
    return (
      <section className="audience-entry-shell" aria-label="Audience entry">
        <article className="queue-panel audience-entry-card">
          <p className="eyebrow audience-entry-eyebrow">{copy.entryEyebrow}</p>
          <h1>{event?.name ?? 'Human Jukebox'}</h1>
          <p className="subcopy audience-entry-copy">
            {copy.entryCopy}
          </p>
          <form className="queue-form audience-entry-form" onSubmit={onAudienceNameSubmit}>
            <div className="field-row">
              <label htmlFor="audience-name" className="audience-entry-label">{copy.nameLabel}</label>
              <input
                id="audience-name"
                value={audienceNameInput}
                onChange={(event) => setAudienceNameInput(event.target.value)}
                placeholder={copy.namePlaceholder}
                maxLength={40}
                required
                aria-describedby={audienceNameError ? 'audience-name-error' : undefined}
                autoFocus
              />
            </div>
            <div className="field-row">
              <span id="audience-language" className="audience-entry-label">{copy.languageLabel}</span>
              <div className="audience-language-picker" role="radiogroup" aria-labelledby="audience-language">
                <button
                  type="button"
                  className={`audience-language-option audience-language-option-en${audienceLocale === 'en' ? ' audience-language-option-active' : ''}`}
                  onClick={() => setAudienceLocale('en')}
                >
                  <span className="audience-language-option-flag" aria-hidden="true">🇬🇧</span>
                  <span className="audience-language-option-text">English</span>
                </button>
                <button
                  type="button"
                  className={`audience-language-option audience-language-option-da${audienceLocale === 'da' ? ' audience-language-option-active' : ''}`}
                  onClick={() => setAudienceLocale('da')}
                >
                  <span className="audience-language-option-flag" aria-hidden="true">🇩🇰</span>
                  <span className="audience-language-option-text">Dansk</span>
                </button>
              </div>
            </div>
            {audienceNameError ? <p id="audience-name-error" className="error-text request-error-inline" role="alert">{audienceNameError}</p> : null}
            <button 
              type="submit" 
              className="primary-button"
              disabled={audienceNameSaving}
            >
              {audienceNameSaving ? copy.joining : copy.join}
            </button>
          </form>
          {errorText ? <p className="error-text request-error-inline">{errorText}</p> : null}
        </article>
      </section>
    )
  }

  if (!roomOpen) {
    return (
      <section className="audience-entry-shell" aria-label="Audience waiting room">
        <article className="queue-panel audience-entry-card">
          <p className="eyebrow audience-entry-eyebrow">{copy.waitingGreeting} {audienceName}</p>
          <h1>{copy.waitingTitle}</h1>
          <p className="subcopy audience-entry-copy">{copy.waitingCopy}</p>
          {authError ? <p className="error-text request-error-inline">{authError}</p> : null}
          <p className="meta-badge audience-soon-badge">{copy.startingSoon}</p>
          {hasRequestedEventParam ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate('/audience')}
            >
              {copy.viewUpcoming}
            </button>
          ) : null}
        </article>
      </section>
    )
  }

  return (
    <section className="audience-shell audience-shell-compact audience-shell-modern" aria-label="Audience app">
      <section className="audience-stage">
        <AudienceFixedHeader
          eventName={event?.name ?? copy.audienceLive}
          subtitle={event?.subtitle ?? null}
          logoSrc="/the-human-jukebox-logo.svg"
          locale={audienceLocale}
          onSignOut={handleSignOut}
        />

        <section className="queue-panel audience-start-actions-panel" aria-label="Audience actions">
          <div className="panel-head audience-request-head">
            <div>
              <p className="eyebrow audience-request-eyebrow">{copy.audienceHome}</p>
              <h2>Hi {audienceName}</h2>
            </div>
            <span className="meta-badge">{copy.roomOpen}</span>
          </div>
          {confirmationText ? <p className="meta-badge audience-policy-badge" role="status" aria-live="polite">{confirmationText}</p> : null}
          {errorText ? <p className="error-text request-error-inline">{errorText}</p> : null}
          <div className="audience-start-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                navigate(`/audience/song-list${location.search || ''}`)
              }}
            >
              {copy.songList}
            </button>
            {event?.showCustomButton && event.customButtonLabel?.trim() && event.customButtonLink?.trim() ? (
              <a
                href={event.customButtonLink}
                target="_blank"
                rel="noopener noreferrer"
                className="audience-custom-button"
              >
                {event.customButtonLabel}
              </a>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                document.getElementById('audience-tip-jar')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              disabled={allTipLinks.length === 0}
            >
              {copy.tipJar}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                document.getElementById('audience-social-links')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              disabled={socialLinks.length === 0}
            >
              {copy.socialLinks}
            </button>
            <button
              type="button"
              className="secondary-button"
              aria-controls="audience-how-it-works"
              onClick={() => setShowHowItWorks((current) => !current)}
            >
              {showHowItWorks ? copy.hideHowItWorks : copy.howItWorks}
            </button>
          </div>
          {showHowItWorks ? (
            <div id="audience-how-it-works" className="audience-how-it-works" role="region" aria-label="How the audience app works">
              <p className="audience-how-it-works-title">{copy.howItWorksTitle}</p>
              <ol className="audience-how-it-works-list">
                {copy.howItWorksSteps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </div>
          ) : null}
          {event?.requestInstructions ? <p className="subcopy audience-request-note">{event.requestInstructions}</p> : null}
          {duplicateRequestsBlocked || activeRequestCap ? (
            <div className="audience-policy-list">
              {duplicateRequestsBlocked ? <p className="meta-badge audience-policy-badge">{copy.duplicateBlocked}</p> : null}
              {activeRequestCap ? (
                <p className="meta-badge audience-policy-badge">
                  {copy.activeRequestLimit
                    .replace('{count}', String(activeRequestCap))
                    .replace('{suffix}', activeRequestCap === 1 ? '' : 's')}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        <article className="now-playing-card">
          <p className="eyebrow">{copy.nowPlaying}</p>
          {isBetweenSongs ? (
            <div className="now-playing-media now-playing-between-songs">
              <p className="between-songs-quote">{betweenSongQuote}</p>
            </div>
          ) : (
            <div className="now-playing-media now-playing-media-stacked">
              <h2>{displaySong?.title ?? copy.queueThinking}</h2>
              <p className="artist now-playing-artist">{displaySong?.artist ?? copy.requestPrompt}</p>
              <div className="now-playing-artwork-slot">
                {displaySongCoverUrl ? (
                  <img
                    src={normalizeCoverUrl(displaySongCoverUrl) ?? displaySongCoverUrl}
                    alt={`Cover art for ${displaySong?.title ?? 'current song'}`}
                    className="song-cover song-cover-large"
                  />
                ) : (
                  <span className="song-cover song-cover-large song-cover-fallback now-playing-cover-fallback" aria-hidden="true">
                    {displaySong?.audience_sings ? '🎤' : '♪'}
                  </span>
                )}
              </div>
              <div className="now-playing-fact-box" aria-live="polite">
                <p key={`${displaySong?.id ?? 'unknown'}-${currentSongFactIndex}`} className="now-playing-fact">
                  {currentSongFact}
                </p>
              </div>
            </div>
          )}
        </article>

        <article className="queue-panel">
          <div className="panel-head">
            <h2>{copy.liveQueue}</h2>
            <span className="meta-badge">{copy.votesRise}</span>
          </div>
          <ol className="queue-list">
            {upNext.length === 0 ? <li className="subcopy">{copy.noSongsQueued}</li> : null}
            {upNext.map((song, songIndex) => (
              <SongVoteCard
                key={song.id}
                song={song}
                rank={songIndex + 1}
                hottestVoteCount={hottestVoteCount}
                votePulseTick={votePulseTicks[song.id] ?? 0}
                moveTick={songMoveTicks[song.id] ?? 0}
                normalizeCoverUrl={normalizeCoverUrl}
                disabled={!roomOpen || song.voting_locked || Boolean(votingSongIds[song.id])}
                isVoting={Boolean(votingSongIds[song.id])}
                onVote={handleVoteSong}
              />
            ))}
          </ol>
        </article>

        <article className="queue-panel" aria-label="Played songs">
          <div className="panel-head">
            <h2>{copy.playedSongs}</h2>
            <span className="meta-badge">{copy.latestOnTop}</span>
          </div>
          <ol className="queue-list">
            {recentlyPlayedSongs.length === 0 ? <li className="subcopy">{copy.noSongsPlayed}</li> : null}
            {recentlyPlayedSongs.map((song, index) => (
              <li key={`${song.id}-${song.performedAt}`} className="audience-song-row">
                <span className="queue-rank-chip" aria-label={`Played position ${index + 1}`}>
                  {index + 1}
                </span>
                <div className="queue-song-main audience-song-main">
                  {song.cover_url ? (
                    <img
                      src={normalizeCoverUrl(song.cover_url) ?? song.cover_url}
                      alt={`Cover art for ${song.title}`}
                      className="song-cover"
                    />
                  ) : <span className="song-cover song-cover-fallback" aria-hidden="true">♪</span>}
                  <div>
                    <p className="song">{song.title}</p>
                    <p className="artist">{song.artist}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </article>

        {socialLinks.length > 0 || allTipLinks.length > 0 ? (
          <section className={`queue-panel link-panel${allTipLinks.length > 0 ? ' tip-jar-panel' : ''}`} aria-label={copy.performerLinks}>
            {socialLinks.length > 0 ? (
              <>
                <div className="panel-head" id="audience-social-links">
                  <h2>{copy.socialLinks}</h2>
                </div>
                <ul className="link-list" aria-label="Social media links">
                  {socialLinks.map((link) => (
                    <li key={link.label}>
                      <a className="link-chip" href={link.url} target="_blank" rel="noreferrer">
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {allTipLinks.length > 0 ? (
              <>
                <div className="panel-head" id="audience-tip-jar">
                  <h2>{copy.tipJar}</h2>
                </div>
                <div className="tip-jar-showcase" aria-label="Tip links">
                  {primaryTipLink ? (
                    <a className="tip-jar-link" href={primaryTipLink.url} target="_blank" rel="noreferrer" onClick={handleTipClick}>
                      <span className="tip-jar-glass" aria-hidden="true">
                        <span className="tip-jar-lid" />
                        <span className="tip-jar-symbol">£</span>
                        <span className="tip-jar-coin-drop">🪙</span>
                      </span>
                      <span className="tip-jar-ribbon">A Tip Would Be Lovely. No Drama.</span>
                      <span className="tip-jar-provider">Pay via {primaryTipLink.label}</span>
                    </a>
                  ) : null}

                  {secondaryTipLinks.length > 0 ? (
                    <ul className="link-list tip-jar-secondary-links">
                      {secondaryTipLinks.map((link) => (
                        <li key={link.label}>
                          <a className="link-chip tip-chip" href={link.url} target="_blank" rel="noreferrer" onClick={handleTipClick}>
                            {link.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {showTipThankYou ? (
                    <div className="tip-thankyou-overlay" role="status" aria-live="polite">
                      <span className="tip-thankyou-icon" aria-hidden="true">🫙✨</span>
                      <p className="tip-thankyou-message">{copy.tipThankYou}</p>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </section>
        ) : null}
      </section>
    </section>
  )
}

export default EventPage
