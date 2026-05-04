import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
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
import '../audience-karafun.css'
import { demoMode } from '../demo/demoMode'

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
    .select('id, name, venue, gig_date, gig_start_time, gig_end_time, cover_image_url, event_type, karafun_url')
    .eq('show_in_audience_no_gig', true)
    .order('gig_date', { ascending: true, nullsFirst: false })
    .order('gig_start_time', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (error && isMissingCoverImageColumnError(error)) {
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('events')
      .select('id, name, venue, gig_date, gig_start_time, gig_end_time, event_type, karafun_url')
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
const AUDIENCE_SONG_FACT_MAX_LENGTH = 220
const AUDIENCE_FUN_FACTS_CACHE_STORAGE_KEY = 'human-jukebox-audience-fun-facts-cache-v3'
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
    .filter((sentence) => sentence.length >= 35 && sentence.length <= 260)
    .filter((sentence) => !/^coordinates?:?/i.test(sentence))
    .filter((sentence) => !/^\d+\s*(km|mi|m|ft)\b/i.test(sentence))

  return Array.from(new Set(normalizedSentences)).slice(0, 12)
}

function normalizeFunFacts(facts: string[]) {
  const normalizedFacts = facts
    .map((fact) => truncateFact(fact))
    .map((fact) => fact.replace(/\s+/g, ' ').trim())
    .filter((fact) => !isLowValueFact(fact))
    .filter(Boolean)

  return Array.from(new Set(normalizedFacts))
}

function isLowValueFact(fact: string) {
  const normalizedFact = fact.trim().toLowerCase()

  return /has\s+\d+\s+word/.test(normalizedFact)
    || /uses\s+\d+\s+characters?/.test(normalizedFact)
    || /title initials/.test(normalizedFact)
    || /artist name\s+"?.+"?\s+has\s+\d+\s+word/.test(normalizedFact)
}

async function fetchItunesSongFacts(title: string, artist: string, signal: AbortSignal) {
  const searchTerm = `${title} ${artist}`.trim()
  const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=song&limit=3`

  try {
    const response = await fetch(searchUrl, { signal })

    if (!response.ok) {
      return []
    }

    const payload = await response.json() as {
      results?: Array<{
        trackName?: string
        artistName?: string
        collectionName?: string
        releaseDate?: string
        trackTimeMillis?: number
        primaryGenreName?: string
      }>
    }

    const exactMatch = payload.results?.find((track) => (
      (track.trackName ?? '').trim().toLowerCase() === title.trim().toLowerCase()
      && (track.artistName ?? '').trim().toLowerCase() === artist.trim().toLowerCase()
    ))

    const track = exactMatch ?? payload.results?.[0]

    if (!track) {
      return []
    }

    const releaseYear = track.releaseDate?.slice(0, 4)
    const durationMs = track.trackTimeMillis ?? 0
    const durationMinutes = durationMs > 0 ? Math.floor(durationMs / 60000) : 0
    const durationSeconds = durationMs > 0 ? String(Math.round((durationMs % 60000) / 1000)).padStart(2, '0') : '00'
    const durationLabel = durationMs > 0 ? `${durationMinutes}:${durationSeconds}` : null

    const facts = [
      track.collectionName
        ? `iTunes metadata: this track is listed on the release "${track.collectionName}".`
        : null,
      releaseYear
        ? `iTunes metadata: release year is ${releaseYear}.`
        : null,
      track.primaryGenreName
        ? `iTunes metadata tags this song as ${track.primaryGenreName}.`
        : null,
      durationLabel
        ? `iTunes metadata runtime is about ${durationLabel}.`
        : null,
    ].filter((fact): fact is string => Boolean(fact))

    return facts.slice(0, 4)
  } catch {
    return []
  }
}

async function fetchWikipediaSummarySentences(title: string, artist: string, signal: AbortSignal) {
  const candidateTitles = [
    `${title} (song)`,
    title,
    `${title} (${artist} song)`,
    `${title} ${artist}`,
    artist,
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

    const releaseYear = firstReleaseDate ? firstReleaseDate.slice(0, 4) : null
    const durationMs = recording.length ?? 0
    const durationMin = durationMs > 0 ? Math.floor(durationMs / 60000) : 0
    const durationSec = durationMs > 0 ? String(Math.round((durationMs % 60000) / 1000)).padStart(2, '0') : '00'
    const durationLabel = durationMs > 0 ? `${durationMin}:${durationSec}` : null

    const fallbackFacts = [
      releaseYear ? `"${title}" was first released in ${releaseYear} — celebrating every year since.` : null,
      releaseTitle && releaseTitle.toLowerCase() !== title.toLowerCase()
        ? `The track originally appeared on the album "${releaseTitle}".`
        : null,
      durationLabel ? `The track runs ${durationLabel} — just long enough to forget everything else. 🎶` : null,
      artistCredit && artistCredit.toLowerCase() !== artist.toLowerCase()
        ? `Also credited as: ${artistCredit}.`
        : null,
    ].filter((fact): fact is string => Boolean(fact))

    return fallbackFacts.slice(0, 4)
  } catch {
    return []
  }
}

const SONG_INFO_BUILDERS = [
  (song: NowPlayingInfoSong) => {
    if (/\//.test(song.title)) return `"${song.title}" reads like a medley title - multiple songs stitched into one spotlight moment.`
    if (/[()[\]]/.test(song.title)) return `"${song.title}" includes bracket tags, often signaling a remix, live cut, or special edit.`
    return `"${song.title}" keeps things clear and direct for a live audience screen.`
  },
  (song: NowPlayingInfoSong) => containsFeatToken(song.title)
    ? `This is a collab — ${song.artist} brought company along for this one. The more the merrier. 🎉`
    : `No features, no guests — "${song.title}" is a pure ${song.artist} statement from start to finish.`,
  (song: NowPlayingInfoSong) => song.is_explicit
    ? `This track carries an explicit label — apparently ${song.artist} had some very strong feelings and decided not to hold back. 🔥`
    : `Clean track — every single word is sing-along approved. Go completely wild. 🎤`,
  (song: NowPlayingInfoSong) => /[()[\]]/.test(song.title)
    ? `Those brackets in "${song.title}" usually signal a remix, a live version, or a hidden bonus — always worth paying attention to.`
    : `Straight title, no brackets — ${song.artist} said exactly what they meant.`,
  (song: NowPlayingInfoSong) => {
    if (/\?/.test(song.title)) return `"${song.title}" is a genuine question — and ${song.artist} spends the whole song answering it.`
    if (/!/.test(song.title)) return `That exclamation mark in "${song.title}" is not decoration — ${song.artist} really, truly means every word.`
    return `"${song.title}" — no question marks, no exclamations. Just pure, unfiltered confidence from ${song.artist}.`
  },
  (song: NowPlayingInfoSong) => {
    const looksLikeGroup = /&|\band\b|\bthe\s/i.test(song.artist) || countWords(song.artist) >= 3
    return looksLikeGroup
      ? `"${song.artist}" — sounds like a proper group effort. Great music has always been a team sport. 🎸`
      : `${song.artist} — one name, one sound, carrying the whole song on their shoulders tonight.`
  },
  (song: NowPlayingInfoSong) => {
    const n = countCharactersWithoutSpaces(song.title)
    if (n >= 24) return `Long-form title alert: "${song.title}" carries ${n} letters without spaces.`
    return `Compact title format (${n} letters without spaces) keeps this one easy to spot in queue.`
  },
  (song: NowPlayingInfoSong) => {
    const initials = buildInitials(song.title)
    if (initials.length <= 1) return `"${song.title}" is short enough that shorthand is not really needed.`
    return `Quick shorthand for hosts: "${song.title}" -> ${initials}.`
  },
]

function ensureRotatingFacts(song: NowPlayingInfoSong, facts: string[], minimumCount = 2) {
  const normalizedFacts = normalizeFunFacts(facts)

  if (normalizedFacts.length >= minimumCount) {
    return normalizedFacts.slice(0, 10)
  }

  const localFacts = normalizeFunFacts(SONG_INFO_BUILDERS.map((songInfoBuilder) => songInfoBuilder(song)))
  return normalizeFunFacts([...normalizedFacts, ...localFacts]).slice(0, 10)
}

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
    coverImageUrl: normalizeCoverUrl(
      (eventData.cover_image_url as string | null)
      ?? (eventData.coverImageUrl as string | null)
      ?? (eventData.cover_url as string | null)
      ?? null,
    ),
    eventType: (eventData.event_type as string | null) === 'karaoke' ? 'karaoke' : 'halli-live',
    karafunUrl: normalizeExternalLink((eventData.karafun_url as string | null) ?? (eventData.karafunUrl as string | null) ?? null),
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
    audienceConnectionStatus,
    queueOperatingMode,
    queueHealthMessage,
  } = useQueueStore()

  const [hostProfile, setHostProfile] = useState<HostProfile | null>(null)
  const [audienceNameInput, setAudienceNameInput] = useState(() => readCommittedAudienceName())
  const [audienceName, setAudienceName] = useState(() => readCommittedAudienceName())
  const [audienceLocale, setAudienceLocale] = useState<AudienceLocale>(() => readCommittedAudienceLocale())
  const [audienceNameError, setAudienceNameError] = useState<string | null>(null)
  const [audienceNameSaving, setAudienceNameSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [confirmationText, setConfirmationText] = useState<string | null>(null)
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
  const [hasCompletedInitialLiveGigProbe, setHasCompletedInitialLiveGigProbe] = useState(false)

  const previousVotesRef = useRef<Map<string, number>>(new Map())
  const previousSongRanksRef = useRef<Map<string, number>>(new Map())
  const audienceLinkVersionRef = useRef(AUDIENCE_CACHE_VERSION)
  const funFactsCacheRef = useRef<FunFactsCache>({})
  const funFactsInFlightRef = useRef<Partial<Record<string, Promise<string[]>>>>({})
  const votingSongIdsRef = useRef<Record<string, boolean>>({})
  const confirmationTimerRef = useRef<number | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  // Acquire a screen wake lock while the audience is in an active live gig.
  // This prevents the phone screen from locking mid-concert when browsing the queue.
  // Silently falls back when the API is unsupported (older browsers / iOS < 16.4).
  useEffect(() => {
    if (!event?.roomOpen) {
      return
    }

    let released = false

    const acquireWakeLock = async () => {
      if (!('wakeLock' in navigator)) {
        return
      }

      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen')

        wakeLockRef.current.addEventListener('release', () => {
          // Re-acquire after page visibility returns (e.g. tab switch then back).
          if (!released && !document.hidden) {
            void acquireWakeLock()
          }
        })
      } catch {
        // Permission denied or system overrule — no action needed.
      }
    }

    void acquireWakeLock()

    const onVisibilityChange = () => {
      if (!document.hidden && !wakeLockRef.current) {
        void acquireWakeLock()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [event?.roomOpen])

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
  const connectionBadgeLabel = audienceConnectionStatus === 'connected'
    ? 'Connected'
    : audienceConnectionStatus === 'reconnecting'
    ? 'Reconnecting'
    : audienceConnectionStatus === 'offline'
    ? 'Offline'
    : 'Connecting'
  const connectionBadgeClassName = audienceConnectionStatus === 'connected'
    ? 'connection-online'
    : audienceConnectionStatus === 'offline'
    ? 'connection-offline'
    : ''
  const hottestVoteCount = upNext.reduce((highestVotes, song) => Math.max(highestVotes, song.votes_count), 0)
  const recentlyPlayedSongs = performedSongs.slice(0, 8)
  const eventSearchParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const requestedEventId = eventSearchParams.get('event') ?? eventSearchParams.get('eventId')
  const hasRequestedEventParam = Boolean(requestedEventId)
  const queuedPositionParam = eventSearchParams.get('queued')
  const queuedPosition = queuedPositionParam ? parseInt(queuedPositionParam, 10) : null
  const [showQueuedBanner, setShowQueuedBanner] = useState(Boolean(queuedPosition && queuedPosition > 0))
  const liveGigApiUnavailableRef = useRef(false)
  const audienceLanguageOptions = (event?.audienceIcelandicEnabled ?? false)
    ? [
        { code: 'en' as const, label: 'English', flag: '🇬🇧' },
        { code: 'da' as const, label: 'Dansk', flag: '🇩🇰' },
        { code: 'is' as const, label: 'Islenska', flag: '🇮🇸' },
      ]
    : [
        { code: 'en' as const, label: 'English', flag: '🇬🇧' },
        { code: 'da' as const, label: 'Dansk', flag: '🇩🇰' },
      ]
  const copy = audienceLocale === 'da'
    ? {
        audienceApp: 'Publikumsapp',
        entryEyebrow: 'Official Audience Lounge',
        entryCopy: 'Du går ind i den live publikumsapp. Ønsk sange og stem dine favoritter til tops.',
        nameLabel: 'Dit navn',
        namePlaceholder: 'f.eks. Alex',
        languageLabel: 'Sprog',
        join: 'Bliv en del af showet',
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
    : audienceLocale === 'is'
    ? {
        audienceApp: 'Ahorfenda app',
        entryEyebrow: 'Official Audience Lounge',
        entryCopy: 'Thu ert ad skra thig inn i live ahorfenda appid. Oskadu lag og studdu uppahaldslagin med atkvaedum.',
        nameLabel: 'Nafnid thitt',
        namePlaceholder: 't.d. Alex',
        languageLabel: 'Tungumal',
        join: '🇮🇸 Taktu þátt í gleðinni',
        joining: 'Fer inn...',
        welcome: 'Velkomin! 🎤',
        waitingGreeting: 'Haell',
        waitingTitle: 'Velkomin i showid, frabaeru gestir!',
        waitingCopy: 'Komdu ther fyrir, vertu svalur, og kenndu liststjorninni um allt kaos.',
        startingSoon: 'Vidhburdur hefst bradum',
        viewUpcoming: 'Sja alla komandi vidburdi',
        audienceLive: 'Ahorfendur Live',
        audienceHome: 'Ahorfenda forsida',
        roomOpen: 'Salurinn er opinn',
        songList: 'Laglisti',
        tipJar: 'Tipskraling',
        socialLinks: 'Samfelagsmidlar',
        duplicateBlocked: 'Tvofeld osk er blokkerud fyrir thetta gigg.',
        activeRequestLimit: 'Hver gestur getur haft {count} virka osk i konni.',
        nowPlaying: 'Nu i gangi',
        queueThinking: 'Koin er ad hugsa sig um',
        requestPrompt: 'Opnadu Laglista og oskadu lag adur en eitthvad velur Wonderwall.',
        liveQueue: 'Live ko',
        votesRise: 'Flest atkvaedi fara efst',
        noSongsQueued: 'Engin log i ko enn.',
        playedSongs: 'Spilud log',
        latestOnTop: 'Nyjasta efst',
        noSongsPlayed: 'Engin log hafa verid spilud enn.',
        performerLinks: 'Listamanna tenglar',
        tipJarCopy: 'Ef seinasta lag fekk thig til ad syngja, hentu listamanninum smatips. Lofaklapp er saett, en leigan er haerri. 🎤✨',
        tipThankYou: event?.tipThankYouMessageEN?.trim() || 'Takk kaerlega fyrir studninginn - hann skiptir miklu mali. — Harald',
        enterName: 'Skraddu nafnid thitt til ad halda afram.',
        keepNameShort: `Hafdu nafnid undir ${MAX_AUDIENCE_NAME_LENGTH} stafi.`,
        removeUnsupported: 'Fjarlagdu ogild stafi ur nafninu.',
        saveFailed: 'Mistokst ad vista nafnid.',
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
    if ((event?.audienceIcelandicEnabled ?? false) || audienceLocale !== 'is') {
      return
    }

    setAudienceLocale('en')
  }, [audienceLocale, event?.audienceIcelandicEnabled])

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
    const songInfoContext: NowPlayingInfoSong = {
      title: song.title,
      artist: song.artist,
      is_explicit: song.is_explicit,
    }
    const embeddedFacts = normalizeFunFacts(songWithAudienceFacts.audienceFunFacts ?? [])

    if (embeddedFacts.length > 0) {
      const rotatingFacts = ensureRotatingFacts(songInfoContext, embeddedFacts)
      songWithAudienceFacts.audienceFunFacts = rotatingFacts
      return rotatingFacts
    }

    const cacheKey = buildFunFactsCacheKey(song.title, song.artist)
    const existingFacts = funFactsCacheRef.current[cacheKey]

    if (existingFacts?.length) {
      const rotatingFacts = ensureRotatingFacts(songInfoContext, existingFacts)
      funFactsCacheRef.current[cacheKey] = rotatingFacts
      songWithAudienceFacts.audienceFunFacts = rotatingFacts
      return rotatingFacts
    }

    if (funFactsInFlightRef.current[cacheKey]) {
      return funFactsInFlightRef.current[cacheKey] as Promise<string[]>
    }

    const fetchPromise = (async () => {
      const wikipediaFacts = await fetchWikipediaSummarySentences(song.title, song.artist, signal)
      const itunesFacts = await fetchItunesSongFacts(song.title, song.artist, signal)
      const fallbackFacts = wikipediaFacts.length + itunesFacts.length >= 3
        ? []
        : await fetchMusicBrainzFallbackFacts(song.title, song.artist, signal)

      const localFacts = SONG_INFO_BUILDERS.map((songInfoBuilder) => songInfoBuilder(songInfoContext))

      const mergedFacts = normalizeFunFacts([
        ...wikipediaFacts,
        ...itunesFacts,
        ...fallbackFacts,
        ...localFacts,
      ]).slice(0, 10)

      const rotatingFacts = ensureRotatingFacts(songInfoContext, mergedFacts)

      funFactsCacheRef.current[cacheKey] = rotatingFacts
      songWithAudienceFacts.audienceFunFacts = rotatingFacts
      persistFunFactsCache()

      return rotatingFacts
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
    const songInfoContext: NowPlayingInfoSong = {
      title: displaySong.title,
      artist: displaySong.artist,
      is_explicit: displaySong.is_explicit,
    }
    const embeddedFacts = normalizeFunFacts(songWithAudienceFacts.audienceFunFacts ?? [])

    if (embeddedFacts.length > 0) {
      const rotatingFacts = ensureRotatingFacts(songInfoContext, embeddedFacts)
      songWithAudienceFacts.audienceFunFacts = rotatingFacts
      setSongFunFacts(rotatingFacts)
      setCurrentSongFactIndex(0)
      return
    }

    const cacheKey = buildFunFactsCacheKey(displaySong.title, displaySong.artist)
    const cachedFacts = funFactsCacheRef.current[cacheKey]

    if (cachedFacts?.length) {
      const rotatingFacts = ensureRotatingFacts(songInfoContext, cachedFacts)
      funFactsCacheRef.current[cacheKey] = rotatingFacts
      songWithAudienceFacts.audienceFunFacts = rotatingFacts
      setSongFunFacts(rotatingFacts)
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
  const isKaraokeEvent = event?.eventType === 'karaoke'
  const isBuildSelfEvent = event?.eventType === 'build-self'
  const audienceVotingEnabled = event?.audienceVotingEnabled ?? true
  const karafunLink = normalizeExternalLink(event?.karafunUrl)
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

  // Broadcast presence to the host dashboard while audience member is active
  useEffect(() => {
    const eventId = event?.id

    if (!eventId || !audienceName || !roomOpen || demoMode) {
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

        if (demoMode) {
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

    if (!eventId || demoMode) {
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
        void supabase.removeChannel(subscription)
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
    setAudienceName('')
    setAudienceNameInput('')
    navigate('/audience', { replace: true })
  }, [navigate])

  if (loading && !event && upcomingEvents.length === 0) {
    return (
      <section className="page-logo-loader-shell" aria-label="Audience loading" role="status">
        <img className="page-logo-loader" src="/the-human-jukebox-logo.png" alt="" width="80" height="80" />
      </section>
    )
  }

  if (!event) {
    if (hasRequestedEventParam && (loading || authLoading)) {
      return (
        <section className="page-logo-loader-shell" aria-label="Audience loading" role="status">
          <img className="page-logo-loader" src="/the-human-jukebox-logo.png" alt="" width="80" height="80" />
        </section>
      )
    }

    // If auth is still in progress (no user yet), show the loading skeleton.
    // Showing "no live show" while auth reconnects after a retry is misleading.
    if (authLoading && !user) {
      return (
        <section className="page-logo-loader-shell" aria-label="Audience loading" role="status">
          <img className="page-logo-loader" src="/the-human-jukebox-logo.png" alt="" width="80" height="80" />
        </section>
      )
    }

    if (!hasRequestedEventParam && !hasCompletedInitialLiveGigProbe) {
      return (
        <section className="page-logo-loader-shell" aria-label="Audience loading" role="status">
          <img className="page-logo-loader" src="/the-human-jukebox-logo.png" alt="" width="80" height="80" />
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

  if (isBuildSelfEvent && !audienceVotingEnabled) {
    return (
      <section className="audience-entry-shell audience-karafun" aria-label="Build Self Gig info">
        <article className="queue-panel audience-entry-card">
          <p className="eyebrow audience-entry-eyebrow">🎵 Live Music</p>
          {event?.artistName ? <h2 className="subcopy audience-entry-artist">{event.artistName}</h2> : null}
          <h1>{event?.name ?? 'Live Show'}</h1>
          {event?.subtitle ? <p className="subcopy audience-entry-copy">{event.subtitle}</p> : null}
          {event?.coverImageUrl ? (
            <img
              src={event.coverImageUrl}
              alt="Event cover"
              className="audience-entry-cover-image"
            />
          ) : null}
          <span className="meta-badge audience-entry-meta-badge">Setlist Only</span>
          <div className="audience-start-actions audience-start-actions-spaced">
            {allTipLinks.length > 0 ? (
              <a
                href={allTipLinks[0].url}
                target="_blank"
                rel="noopener noreferrer"
                className="secondary-button"
              >
                💸 {allTipLinks[0].label}
              </a>
            ) : null}
            {socialLinks.length > 0 ? (
              <div className="audience-social-links-inline">
                {socialLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="secondary-button"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </article>
      </section>
    )
  }

  if (isKaraokeEvent) {
    return (
      <section className="audience-entry-shell audience-karafun" aria-label="Karaoke event info">
        <article className="queue-panel audience-entry-card">
          <p className="eyebrow audience-entry-eyebrow">🎤 Karaoke Night</p>
          <h1>{event?.name ?? 'Karaoke'}</h1>
          {event?.subtitle ? <p className="subcopy audience-entry-copy">{event.subtitle}</p> : null}
          <span className="meta-badge audience-entry-meta-badge">Karaoke Event</span>
          <div className="audience-start-actions audience-start-actions-spaced">
            {karafunLink ? (
              <a
                href={karafunLink}
                target="_blank"
                rel="noopener noreferrer"
                className="primary-button"
              >
                🎶 KaraFun Playlist
              </a>
            ) : null}
            {allTipLinks.length > 0 ? (
              <a
                href={allTipLinks[0].url}
                target="_blank"
                rel="noopener noreferrer"
                className="secondary-button"
              >
                💸 {allTipLinks[0].label}
              </a>
            ) : null}
            {socialLinks.length > 0 ? (
              <div className="audience-social-links-inline">
                {socialLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="secondary-button"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </article>
      </section>
    )
  }

  if (!audienceName) {
    return (
      <section className="audience-entry-shell audience-karafun" aria-label="Audience entry">
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
                {audienceLanguageOptions.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    className={`audience-language-option audience-language-option-${option.code}${audienceLocale === option.code ? ' audience-language-option-active' : ''}`}
                    onClick={() => setAudienceLocale(option.code)}
                  >
                    <span className="audience-language-option-flag" aria-hidden="true">{option.flag}</span>
                    <span className="audience-language-option-text">{option.label}</span>
                  </button>
                ))}
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
      <section className="audience-entry-shell audience-karafun" aria-label="Audience waiting room">
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
    <section className={`audience-shell audience-shell-compact audience-shell-modern audience-karafun${isKaraokeEvent ? ' audience-shell-karaoke' : ''}`} aria-label="Audience app">
      <section className="audience-stage">
        <AudienceFixedHeader
          eventName={isBuildSelfEvent && event?.artistName ? `${event.artistName} — ${event.name ?? copy.audienceLive}` : (event?.name ?? copy.audienceLive)}
          subtitle={event?.subtitle ?? null}
          logoSrc="/the-human-jukebox-logo.svg"
          locale={audienceLocale}
          onSignOut={handleSignOut}
        />

        <section className="queue-panel audience-connection-banner" aria-label="Audience connection health">
          <div className="audience-connection-banner-head">
            <span className={`meta-badge connection-badge ${connectionBadgeClassName}`}>{connectionBadgeLabel}</span>
            {queueOperatingMode === 'degraded' ? <span className="meta-badge audience-degraded-badge">Fallback Mode</span> : null}
          </div>
          {queueHealthMessage ? <p className="subcopy no-margin">{queueHealthMessage}</p> : null}
        </section>

        <section className="queue-panel audience-start-actions-panel" aria-label="Audience actions">
          <div className="panel-head audience-request-head">
            <div>
              <p className="eyebrow audience-request-eyebrow">{isKaraokeEvent ? '🎤 Karaoke Night' : copy.audienceHome}</p>
              <h2>Hi {audienceName}</h2>
            </div>
            <div className="audience-request-badges">
              {isKaraokeEvent ? <span className="meta-badge">Karaoke Event</span> : null}
              <span className="meta-badge">{copy.roomOpen}</span>
            </div>
          </div>
          {confirmationText ? <p className="meta-badge audience-policy-badge" role="status" aria-live="polite">{confirmationText}</p> : null}
          {errorText ? <p className="error-text request-error-inline">{errorText}</p> : null}
          <div className="audience-start-actions">
            {isKaraokeEvent ? (
              <>
                <a
                  href={karafunLink ?? 'https://www.karafun.com/048490/'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="primary-button"
                >
                  🎤 Join the Karaoke Show
                </a>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    document.getElementById('audience-tip-jar')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  disabled={allTipLinks.length === 0}
                >
                  💸 {copy.tipJar}
                </button>
                {audienceName ? (
                  <Link
                    to={`/feed${location.search || ''}`}
                    className="secondary-button audience-feed-button"
                  >
                    💬 Live Feed
                  </Link>
                ) : null}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    document.getElementById('audience-social-links')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  disabled={socialLinks.length === 0}
                >
                  🔗 {copy.socialLinks}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    navigate(`/audience/song-list${location.search || ''}`)
                  }}
                >
                  🎤 {copy.songList}
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
                  💸 {copy.tipJar}
                </button>
                {audienceName ? (
                  <Link
                    to={`/feed${location.search || ''}`}
                    className="secondary-button audience-feed-button"
                  >
                    💬 Live Feed
                  </Link>
                ) : null}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    document.getElementById('audience-social-links')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  disabled={socialLinks.length === 0}
                >
                  🔗 {copy.socialLinks}
                </button>
              </>
            )}
          </div>
          {!isKaraokeEvent && event?.requestInstructions ? <p className="subcopy audience-request-note">{event.requestInstructions}</p> : null}
          {!isKaraokeEvent && (duplicateRequestsBlocked || activeRequestCap) ? (
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

        {!isKaraokeEvent ? (
        <>
        <article className="now-playing-card audience-now-playing-panel">
          {showQueuedBanner && queuedPosition && queuedPosition > 0 ? (
            <div className="audience-queued-banner" role="status" aria-live="polite">
              <span className="audience-queued-banner-icon" aria-hidden="true">🎵</span>
              <span className="audience-queued-banner-text">
                {queuedPosition === 1
                  ? 'Your request is up next!'
                  : `Your request is #${queuedPosition} in the queue.`}
              </span>
              <button
                type="button"
                className="audience-queued-banner-dismiss"
                aria-label="Dismiss"
                onClick={() => setShowQueuedBanner(false)}
              >
                ✕
              </button>
            </div>
          ) : null}
          <p className="eyebrow"><span aria-hidden="true">🎤</span> {copy.nowPlaying}</p>
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

        <article className="queue-panel audience-live-queue-panel">
          <div className="panel-head">
            <h2><span aria-hidden="true">🏆</span> {copy.liveQueue}</h2>
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

        <article className="queue-panel audience-played-queue-panel" aria-label="Played songs">
          <div className="panel-head">
            <h2><span aria-hidden="true">✅</span> {copy.playedSongs}</h2>
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
                  <div className="audience-song-main-copy">
                    <p className="song" title={song.title}>{song.title}</p>
                    <p className="artist" title={song.artist}>{song.artist}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </article>
        </>
        ) : null}

        {socialLinks.length > 0 || allTipLinks.length > 0 ? (
          <section className={`queue-panel link-panel audience-links-panel${allTipLinks.length > 0 ? ' tip-jar-panel' : ''}`} aria-label={copy.performerLinks}>
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
                        {/* Guitar-pick shape with mic — mirrors the logo badge */}
                        <svg className="tip-jar-jar-svg" viewBox="0 0 160 196" fill="none" xmlns="http://www.w3.org/2000/svg">
                          {/* Guitar-pick jar body */}
                          <path d="M80 8C121 8 150 40 150 80C150 132 106 170 80 188C54 170 10 132 10 80C10 40 39 8 80 8Z"
                            fill="#0C1734" stroke="#5DD7FF" strokeWidth="3.5"/>
                          {/* Inner pink ring echo */}
                          <path d="M80 18C115 18 140 46 140 80C140 126 100 161 80 178C60 161 20 126 20 80C20 46 45 18 80 18Z"
                            fill="none" stroke="#FF7EAF" strokeWidth="1.2" strokeOpacity="0.35"/>
                          {/* Coin slot at top */}
                          <rect x="56" y="28" width="48" height="10" rx="5" fill="#070d22" stroke="#5DD7FF" strokeWidth="1.5"/>
                          <rect x="63" y="31" width="34" height="3.5" rx="1.75" fill="rgba(93,215,255,0.65)"/>
                          {/* Mic body */}
                          <rect x="62" y="72" width="36" height="50" rx="18" fill="#DFF6FF" stroke="#5DD7FF" strokeWidth="2.5"/>
                          {/* Mic arc / pickup */}
                          <path d="M50 100C50 124 63 138 80 138C97 138 110 124 110 100"
                            stroke="#8FD9FF" strokeWidth="4" strokeLinecap="round"/>
                          {/* Mic stand */}
                          <line x1="80" y1="138" x2="80" y2="156" stroke="#DFF6FF" strokeWidth="3.5" strokeLinecap="round"/>
                          {/* Mic base */}
                          <rect x="61" y="156" width="38" height="9" rx="4.5" fill="#FF7EAF"/>
                        </svg>
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
