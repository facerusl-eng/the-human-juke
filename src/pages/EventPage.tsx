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
  commitAudienceLocale,
  readCommittedAudienceLocale,
  readCommittedAudienceName,
  clearAudienceIdentity,
  type AudienceLocale,
} from '../lib/audienceIdentity'
import {
  BETWEEN_SONG_QUOTES,
  isLastSongSoonOverlayMessage,
  PLAYBACK_STATE_BROADCAST_CHANNEL,
  PLAYBACK_STATE_EVENT,
  PLAYBACK_STATE_STORAGE_KEY,
  readSharedPlaybackState,
  type SharedPlaybackState,
} from '../lib/playbackState'
import { supabase } from '../lib/supabase'
import { setEventOGTags, resetOGTags } from '../lib/metaTags'
import { readFromLocalStorage, readTextFromLocalStorage, saveTextToLocalStorage } from '../lib/saveHandling'
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
  buymeacoffee_url: string | null
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

function normalizeEventTimeForDate(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return null
  }

  return trimmedValue.length > 5 && trimmedValue[2] === ':' && trimmedValue[5] === ':'
    ? trimmedValue.slice(0, 5)
    : trimmedValue
}

function parseEventStartMs(gigDate: string | null | undefined, gigStartTime: string | null | undefined): number | null {
  const normalizedDate = gigDate?.trim()

  if (!normalizedDate) {
    return null
  }

  const baseTime = normalizeEventTimeForDate(gigStartTime)
  const safeTime = baseTime ? `${baseTime}:00` : '18:00:00'
  const parsedDate = new Date(`${normalizedDate}T${safeTime}`)
  const parsedMs = parsedDate.getTime()

  return Number.isNaN(parsedMs) ? null : parsedMs
}

function resolveCountdownTargetMsFromSearch(search: string): number | null {
  const params = new URLSearchParams(search)
  const rawValue = params.get('ct')?.trim() || params.get('countdownTargetMs')?.trim() || ''

  if (!rawValue) {
    return null
  }

  const parsedValue = Number(rawValue)

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null
  }

  return parsedValue
}

function resolveClockOffsetMsFromSearch(search: string): number | null {
  const params = new URLSearchParams(search)
  const rawValue = params.get('co')?.trim() || params.get('clockOffsetMs')?.trim() || ''

  if (!rawValue) {
    return null
  }

  const parsedValue = Number(rawValue)

  if (!Number.isFinite(parsedValue)) {
    return null
  }

  // Reject clearly malformed offsets while allowing realistic skew corrections.
  if (Math.abs(parsedValue) > 86_400_000) {
    return null
  }

  return Math.round(parsedValue)
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

function formatCompactCountdownLabel(remainingMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, remainingMs) / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function toAudienceIntlLocale(locale: AudienceLocale) {
  if (locale === 'da') {
    return 'da-DK'
  }

  if (locale === 'is') {
    return 'is-IS'
  }

  return 'en-US'
}

function formatAudienceAbsoluteStartLabel(targetMs: number | null, locale: AudienceLocale): string | null {
  if (!Number.isFinite(targetMs)) {
    return null
  }

  const targetDate = new Date(targetMs as number)

  if (Number.isNaN(targetDate.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat(toAudienceIntlLocale(locale), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).format(targetDate)
}

function hasFutureCountdownTarget(events: AudienceUpcomingEvent[], nowMs = Date.now()): boolean {

  return events.some((eventRow) => {
    const eventStartMs = parseEventStartMs(eventRow.gigDate, eventRow.gigStartTime)
    return eventStartMs !== null && eventStartMs > nowMs
  })
}

function isFutureCountdownEvent(eventRow: AudienceUpcomingEvent | null | undefined, nowMs = Date.now()): boolean {
  if (!eventRow) {
    return false
  }

  const startsAtMs = parseEventStartMs(eventRow.gigDate, eventRow.gigStartTime)
  return startsAtMs !== null && startsAtMs > nowMs
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

function isMissingEventThemeColumnError(error: unknown) {
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

  return (code === '42703' || code === 'PGRST204') && text.includes('event_theme')
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

async function fetchUpcomingEventRows(timeoutMs = 12000, nowMs = Date.now()) {
  const abortController = new AbortController()
  const todayIso = new Date(nowMs).toISOString().slice(0, 10)
  let didTimeout = false
  const timeoutId = window.setTimeout(() => {
    didTimeout = true
    abortController.abort()
  }, timeoutMs)

  try {
    const baseSelect = 'id, name, venue, gig_date, gig_start_time, gig_end_time, event_type, karafun_url'

    const { data, error } = await supabase
      .from('events')
      .select(baseSelect)
      .abortSignal(abortController.signal)
      .or(`gig_date.gte.${todayIso},gig_date.is.null`)
      .order('gig_date', { ascending: true, nullsFirst: false })
      .order('gig_start_time', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(50)

    if (didTimeout) {
      throw new Error('EventPage: upcoming events fallback timed out')
    }

    if (error && isSupabaseStatementTimeout(error)) {
      throw new Error('EventPage: upcoming events fallback timed out (db)')
    }

    if (error) {
      throw error
    }

    return ((data ?? []) as Array<Record<string, unknown>>).map((eventData) => ({
      ...eventData,
      cover_image_url: null,
      event_theme: null,
    }))
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function fetchUpcomingEventCoverById(eventId: string, timeoutMs = 8000): Promise<string | null> {
  const abortController = new AbortController()
  let didTimeout = false
  const timeoutId = window.setTimeout(() => {
    didTimeout = true
    abortController.abort()
  }, timeoutMs)

  try {
    const response = await fetch(`/api/event-cover?id=${encodeURIComponent(eventId)}`, {
      method: 'GET',
      signal: abortController.signal,
      headers: {
        Accept: 'application/json',
      },
    })

    if (didTimeout || !response.ok) {
      return null
    }

    const payload = await response.json().catch(() => null)
    return normalizeCoverUrl((payload as { coverImageUrl?: string | null } | null)?.coverImageUrl ?? null)
  } finally {
    window.clearTimeout(timeoutId)
  }
}

const MAX_AUDIENCE_NAME_LENGTH = 40
const UPCOMING_EVENTS_POLL_INTERVAL_MS = 15000
const UPCOMING_EVENTS_DEGRADED_POLL_INTERVAL_MS = 60000
const LIVE_GIG_POLL_INTERVAL_MS = 4000
const PLAYBACK_SYNC_POLL_INTERVAL_MS = 10000
const PLAYBACK_NULL_SYNC_GRACE_MISSES = 3
const PLAYBACK_STALE_UPDATE_TOLERANCE_MS = 2500
const LIVE_GIG_API_POLLING_ENABLED = import.meta.env.VITE_ENABLE_LIVE_GIG_API?.trim() === '1'
const AUDIENCE_CACHE_VERSION = import.meta.env.VITE_AUDIENCE_LINK_VERSION?.trim() || '20260426'
const EXPECTED_API_FALLBACK_ERROR_PREFIX = 'Expected API fallback:'
const UPCOMING_EVENTS_CACHE_KEY = 'human-jukebox-upcoming-events-cache-v1'
const UPCOMING_EVENTS_CACHE_MAX_AGE_MS = 1000 * 60 * 5
const AUDIENCE_CLOCK_OFFSET_CACHE_KEY = 'human-jukebox-clock-offset-cache-v1'
const AUDIENCE_CLOCK_OFFSET_CACHE_MAX_AGE_MS = 1000 * 60 * 15
const AUDIENCE_CLOCK_OFFSET_REFRESH_INTERVAL_MS = 60000
const UPCOMING_FALLBACK_TIMEOUT_MS = 3500
const UPCOMING_FALLBACK_RETRY_TIMEOUT_MS = 4500
const UPCOMING_AUTH_RETRY_TIMEOUT_MS = 3500
const UPCOMING_COVER_FETCH_TIMEOUT_MS = 12000
const UPCOMING_COVER_FETCH_MAX_EVENTS = 10
const UPCOMING_COVER_RETRY_DELAY_MS = 30000
const UPCOMING_ERROR_LOG_THROTTLE_MS = 60000
const UPCOMING_RETRY_BASE_DELAY_MS = 8000
const UPCOMING_RETRY_MAX_DELAY_MS = 120000
const UPCOMING_RETRY_JITTER_MS = 2000
const UPCOMING_EVENTS_UNAVAILABLE_NOTICE = 'Upcoming gigs are temporarily unavailable. Please try again soon.'
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
  void title
  void artist
  void signal
  return []
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
        if (summaryResponse.status === 404) {
          // Downgrade 404s to info, not error
          console.info(`[Wikipedia] No summary for: ${candidateTitle}`)
        } else {
          console.warn(`[Wikipedia] Unexpected response (${summaryResponse.status}) for: ${candidateTitle}`)
        }
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
    } catch (err) {
      // Only log network errors as info, not error
      console.info(`[Wikipedia] Fetch error for: ${candidateTitle}`, err)
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

async function fetchJsonNoStore(path: string, timeoutMs = 6000) {
  const abortController = new AbortController()
  const timeoutId = window.setTimeout(() => abortController.abort(), timeoutMs)

  let response: Response

  try {
    response = await fetch(makeCacheBustedUrl(path), {
      cache: 'no-store',
      headers: {
        'cache-control': 'no-cache, no-store, max-age=0',
        pragma: 'no-cache',
        accept: 'application/json',
      },
      signal: abortController.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`${EXPECTED_API_FALLBACK_ERROR_PREFIX} request timed out (${timeoutMs}ms)`, { cause: error })
    }

    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }

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

function readUpcomingEventsCache({ allowStale = false }: { allowStale?: boolean } = {}): AudienceUpcomingEvent[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const rawCache = window.localStorage.getItem(UPCOMING_EVENTS_CACHE_KEY)

    if (!rawCache) {
      return []
    }

    const parsedCache = JSON.parse(rawCache) as { updatedAt?: unknown; events?: unknown }
    const updatedAt = typeof parsedCache?.updatedAt === 'number' ? parsedCache.updatedAt : 0
    const events = Array.isArray(parsedCache?.events) ? parsedCache.events : []

    if (!allowStale && (!updatedAt || Date.now() - updatedAt > UPCOMING_EVENTS_CACHE_MAX_AGE_MS)) {
      return []
    }

    return mapUpcomingEvents(events as Array<Record<string, unknown>>)
  } catch {
    return []
  }
}

function saveUpcomingEventsCache(events: AudienceUpcomingEvent[]) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(UPCOMING_EVENTS_CACHE_KEY, JSON.stringify({
      updatedAt: Date.now(),
      events,
    }))
  } catch {
    // Ignore localStorage write failures.
  }
}

function readAudienceClockOffsetCache(): number | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawCache = window.localStorage.getItem(AUDIENCE_CLOCK_OFFSET_CACHE_KEY)

    if (!rawCache) {
      return null
    }

    const parsedCache = JSON.parse(rawCache) as { updatedAt?: unknown; offsetMs?: unknown }
    const updatedAt = typeof parsedCache?.updatedAt === 'number' ? parsedCache.updatedAt : 0
    const offsetMs = typeof parsedCache?.offsetMs === 'number' ? parsedCache.offsetMs : null

    if (offsetMs === null || !Number.isFinite(offsetMs)) {
      return null
    }

    if (!updatedAt || Date.now() - updatedAt > AUDIENCE_CLOCK_OFFSET_CACHE_MAX_AGE_MS) {
      return null
    }

    return Math.round(offsetMs)
  } catch {
    return null
  }
}

function saveAudienceClockOffsetCache(offsetMs: number) {
  if (typeof window === 'undefined' || !Number.isFinite(offsetMs)) {
    return
  }

  try {
    window.localStorage.setItem(AUDIENCE_CLOCK_OFFSET_CACHE_KEY, JSON.stringify({
      updatedAt: Date.now(),
      offsetMs: Math.round(offsetMs),
    }))
  } catch {
    // Ignore localStorage write failures.
  }
}

function withPromiseTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutId: number | null = null

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage))
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
    }
  }) as Promise<T>
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
    && (left.countdownTargetMs ?? null) === (right.countdownTargetMs ?? null)
    && (left.brbActive ?? false) === (right.brbActive ?? false)
    && (left.brbMessage ?? null) === (right.brbMessage ?? null)
}

function coercePlaybackTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsedTimestamp = Date.parse(value)
    return Number.isFinite(parsedTimestamp) ? parsedTimestamp : null
  }

  return null
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
    eventTheme: (eventData.event_theme as string | null) === 'karaoke'
      ? 'karaoke'
      : (eventData.event_theme as string | null) === 'harald-live'
      ? 'harald-live'
      : 'human-jukebox',
    karafunUrl: normalizeExternalLink((eventData.karafun_url as string | null) ?? (eventData.karafunUrl as string | null) ?? null),
  }))
}

function isSupabaseStatementTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: unknown; message?: unknown }
  return (
    e.code === '57014'
    || e.code === 57014
    || (typeof e.message === 'string' && e.message.toLowerCase().includes('statement timeout'))
    // PGRST002: PostgREST schema cache rebuilding after a migration — treat as transient
    || e.code === 'PGRST002'
    // 503 / service unavailable during schema reload
    || (typeof e.message === 'string' && e.message.toLowerCase().includes('schema cache'))
  )
}

function isAbortLikeError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  if (!error || typeof error !== 'object') {
    return false
  }

  const normalizedError = error as { name?: unknown; message?: unknown }
  const name = typeof normalizedError.name === 'string' ? normalizedError.name.toLowerCase() : ''
  const message = typeof normalizedError.message === 'string' ? normalizedError.message.toLowerCase() : ''

  return name.includes('abort')
    || message.includes('abort')
    || message.includes('timed out')
    || message.includes('err_aborted')
}

function isExpectedUpcomingEventsTransientError(error: unknown): boolean {
  return isAbortLikeError(error) || isSupabaseStatementTimeout(error)
}

function buildUpcomingErrorLogKey(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().toLowerCase()
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim().toLowerCase()
  }

  if (error && typeof error === 'object') {
    const normalizedError = error as { code?: unknown; name?: unknown }
    const code = typeof normalizedError.code === 'string' ? normalizedError.code : ''
    const name = typeof normalizedError.name === 'string' ? normalizedError.name : ''
    const fallbackKey = `${code}:${name}`.toLowerCase().trim()

    if (fallbackKey !== ':') {
      return fallbackKey
    }
  }

  return 'unknown-upcoming-events-error'
}

function getUpcomingRetryDelayMs(failureCount: number): number {
  if (failureCount <= 0) {
    return 0
  }

  const exponentialFactor = Math.min(failureCount - 1, 5)
  const baseDelay = UPCOMING_RETRY_BASE_DELAY_MS * (2 ** exponentialFactor)
  const clampedDelay = Math.min(baseDelay, UPCOMING_RETRY_MAX_DELAY_MS)
  const jitter = Math.floor(Math.random() * UPCOMING_RETRY_JITTER_MS)

  return clampedDelay + jitter
}

async function fetchUpcomingEventsFromApi(nowMs = Date.now()): Promise<AudienceUpcomingEvent[]> {
  const todayIso = new Date(nowMs).toISOString().slice(0, 10)

  try {
    const response = await withPromiseTimeout(
      fetch(`/api/upcoming-events?today=${encodeURIComponent(todayIso)}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        cache: 'no-store',
      }),
      2500,
      'EventPage: upcoming events edge API timed out',
    )

    if (response.ok) {
      const payload = await response.json().catch(() => null) as { rows?: unknown }
      const rows = Array.isArray(payload?.rows) ? payload.rows as Array<Record<string, unknown>> : []
      return mapUpcomingEvents(rows)
    }
  } catch {
    // Fall through to direct Supabase fallback.
  }

  try {
    const eventRows = await fetchUpcomingEventRows(UPCOMING_FALLBACK_TIMEOUT_MS, nowMs)
    return mapUpcomingEvents(eventRows)
  } catch (error) {
    const isTimeoutError =
      (error instanceof Error && error.message.includes('timed out'))
      || isSupabaseStatementTimeout(error)

    if (!isTimeoutError) {
      throw error
    }

    const retryRows = await fetchUpcomingEventRows(UPCOMING_FALLBACK_RETRY_TIMEOUT_MS, nowMs)
    return mapUpcomingEvents(retryRows)
  }
}

async function fetchCountdownFallbackEventFromApi(nowMs = Date.now()): Promise<AudienceUpcomingEvent | null> {
  const todayIso = new Date(nowMs).toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('events')
    .select('id, name, venue, gig_date, gig_start_time, gig_end_time')
    .or(`gig_date.gte.${todayIso}`)
    .order('gig_date', { ascending: true, nullsFirst: false })
    .order('gig_start_time', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(50)

  if (error) {
    throw error
  }

  const mappedEvents = mapUpcomingEvents((data ?? []) as Array<Record<string, unknown>>)
  const nextEvent = mappedEvents
    .map((eventRow) => ({
      eventRow,
      startsAtMs: parseEventStartMs(eventRow.gigDate, eventRow.gigStartTime),
    }))
    .filter((candidate): candidate is { eventRow: AudienceUpcomingEvent; startsAtMs: number } => (
      candidate.startsAtMs !== null && candidate.startsAtMs > nowMs
    ))
    .sort((a, b) => a.startsAtMs - b.startsAtMs)[0]

  return nextEvent?.eventRow ?? null
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
  const requestedClockOffsetMs = useMemo(() => resolveClockOffsetMsFromSearch(location.search), [location.search])
  const { authError, loading: authLoading, user, signOut } = useAuthStore()
  const {
    event,
    songs,
    performedSongs,
    loading,
    upvoteSong,
    removeSong,
    audienceConnectionStatus,
    pendingOfflineSongs,
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
  const [hasStartedSongDuringLastSongMode, setHasStartedSongDuringLastSongMode] = useState(false)
  const [songFunFacts, setSongFunFacts] = useState<string[]>([])
  const [currentSongFactIndex, setCurrentSongFactIndex] = useState(0)
  const tipThankYouTimerRef = useRef<number | null>(null)
  const [playbackState, setPlaybackState] = useState<SharedPlaybackState | null>(null)
  const initialUpcomingEvents = useMemo(() => readUpcomingEventsCache({ allowStale: true }), [])
  const [upcomingEvents, setUpcomingEvents] = useState<AudienceUpcomingEvent[]>(() => initialUpcomingEvents)
  const [countdownFallbackEvent, setCountdownFallbackEvent] = useState<AudienceUpcomingEvent | null>(null)
  const [upcomingEventsLoading, setUpcomingEventsLoading] = useState(() => initialUpcomingEvents.length === 0)
  const [upcomingEventsNotice, setUpcomingEventsNotice] = useState<string | null>(null)
  const [hasCompletedInitialLiveGigProbe, setHasCompletedInitialLiveGigProbe] = useState(true)
  const [visibleConnectionStatus, setVisibleConnectionStatus] = useState(audienceConnectionStatus)
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null)
  const [audienceClockOffsetMs, setAudienceClockOffsetMs] = useState(() => requestedClockOffsetMs ?? readAudienceClockOffsetCache() ?? 0)
  const upcomingEventsRef = useRef<AudienceUpcomingEvent[]>([])
  const upcomingCoverFetchInFlightRef = useRef<Set<string>>(new Set())
  const upcomingCoverFetchRetryAfterRef = useRef<Map<string, number>>(new Map())
  const upcomingNoticeTimerRef = useRef<number | null>(null)
  const upcomingNoticeValueRef = useRef<string | null>(null)
  const upcomingErrorLogMapRef = useRef<Map<string, number>>(new Map())
  const upcomingLoadInFlightRef = useRef(false)
  const upcomingNextRefreshAtRef = useRef(0)
  const upcomingFailureCountRef = useRef(0)
  const upcomingBaseFetchHealthyRef = useRef(false)
  const audienceClockOffsetRef = useRef(requestedClockOffsetMs ?? 0)

  const previousVotesRef = useRef<Map<string, number>>(new Map())
  const previousSongRanksRef = useRef<Map<string, number>>(new Map())
  const audienceLinkVersionRef = useRef(AUDIENCE_CACHE_VERSION)
  const funFactsCacheRef = useRef<FunFactsCache>({})
  const funFactsInFlightRef = useRef<Partial<Record<string, Promise<string[]>>>>({})
  const votingSongIdsRef = useRef<Record<string, boolean>>({})
  const confirmationTimerRef = useRef<number | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const getAudienceNowMs = useCallback(() => Date.now() + audienceClockOffsetRef.current, [])

  useEffect(() => {
    audienceClockOffsetRef.current = audienceClockOffsetMs
  }, [audienceClockOffsetMs])

  useEffect(() => {
    saveAudienceClockOffsetCache(audienceClockOffsetMs)
  }, [audienceClockOffsetMs])

  useEffect(() => {
    if (requestedClockOffsetMs === null) {
      return
    }

    audienceClockOffsetRef.current = requestedClockOffsetMs
    setAudienceClockOffsetMs(requestedClockOffsetMs)
  }, [requestedClockOffsetMs])

  useEffect(() => {
    let isCurrent = true

    const syncClockOffset = async () => {
      const nextOffsetMs = await fetchServerClockOffsetMs()

      if (!isCurrent || nextOffsetMs === null) {
        return
      }

      audienceClockOffsetRef.current = nextOffsetMs
      setAudienceClockOffsetMs(nextOffsetMs)
    }

    void syncClockOffset()

    const timerId = window.setInterval(() => {
      void syncClockOffset()
    }, AUDIENCE_CLOCK_OFFSET_REFRESH_INTERVAL_MS)

    return () => {
      isCurrent = false
      window.clearInterval(timerId)
    }
  }, [])

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
  const eventSearchParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const requestedEventId = eventSearchParams.get('event') ?? eventSearchParams.get('eventId')
  const requestedTestMode = (eventSearchParams.get('test') ?? '').trim().toLowerCase()
  const isTestGigView = requestedTestMode === '1'
    || requestedTestMode === 'true'
    || requestedTestMode === 'yes'
    || requestedTestMode === 'on'
  const requestedCountdownTargetMs = useMemo(() => resolveCountdownTargetMsFromSearch(location.search), [location.search])
  const mirroredCountdownTargetMs = useMemo(() => {
    const candidateTarget = playbackState?.countdownTargetMs
    return typeof candidateTarget === 'number' && Number.isFinite(candidateTarget)
      ? candidateTarget
      : null
  }, [playbackState?.countdownTargetMs])
  const effectiveCountdownTargetMs = requestedCountdownTargetMs ?? mirroredCountdownTargetMs
  const hasRequestedEventParam = Boolean(requestedEventId)
  const [waitingRoomNowMs, setWaitingRoomNowMs] = useState(() => getAudienceNowMs())
  const waitingRoomStartMs = useMemo(() => {
    if (roomOpen) {
      return null
    }

    if (effectiveCountdownTargetMs !== null) {
      return effectiveCountdownTargetMs
    }

    if (!event?.id) {
      return null
    }

    return parseEventStartMs(event.gigDate, event.gigStartTime)
  }, [effectiveCountdownTargetMs, event?.gigDate, event?.gigStartTime, event?.id, roomOpen])
  const waitingRoomCountdownLabel = useMemo(() => {
    if (waitingRoomStartMs === null) {
      return null
    }

    const remainingMs = waitingRoomStartMs - waitingRoomNowMs
    if (remainingMs <= 0) {
      return null
    }

    return formatCompactCountdownLabel(remainingMs)
  }, [waitingRoomNowMs, waitingRoomStartMs])
  const waitingRoomRemainingMs = waitingRoomStartMs === null ? null : waitingRoomStartMs - waitingRoomNowMs
  const showGoingLiveNowBanner = waitingRoomRemainingMs !== null
    && waitingRoomRemainingMs <= 10_000
    && waitingRoomRemainingMs > -15_000
  const duplicateRequestsBlocked = event ? !event.allowDuplicateRequests : false
  const activeRequestCap = event?.maxActiveRequestsPerUser ?? null
  const queueSizeCap = event?.maxQueueSize ?? null
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
  const normalizedAudienceName = audienceName.trim().toLowerCase()
  const myQueuedRequests = useMemo(() => {
    if (!normalizedAudienceName) {
      return [] as Array<{ song: QueueSong; queuePosition: number }>
    }

    return upNext
      .map((song, songIndex) => ({ song, queuePosition: songIndex + 1 }))
      .filter(({ song }) => (song.createdByName ?? '').trim().toLowerCase() === normalizedAudienceName)
  }, [normalizedAudienceName, upNext])
  const myQueuedSongIds = useMemo(() => {
    return new Set(myQueuedRequests.map(({ song }) => song.id))
  }, [myQueuedRequests])
  const isBetweenSongs = playbackState?.isStarted === false
  const isLastSongSoonMode = isLastSongSoonOverlayMessage(playbackState?.brbMessage)
  const normalizedBetweenSongQuoteIndex = Number.isFinite(playbackState?.quoteIndex)
    ? Math.abs(Math.trunc(playbackState?.quoteIndex ?? 0)) % BETWEEN_SONG_QUOTES.length
    : 0
  const betweenSongQuote = isBetweenSongs
    ? (BETWEEN_SONG_QUOTES[normalizedBetweenSongQuoteIndex] ?? BETWEEN_SONG_QUOTES[0])
    : null
  const connectionBadgeLabel = visibleConnectionStatus === 'connected'
    ? 'Connected'
    : visibleConnectionStatus === 'reconnecting'
    ? 'Reconnecting'
    : visibleConnectionStatus === 'offline'
    ? 'Offline'
    : 'Connecting'
  const connectionBadgeClassName = visibleConnectionStatus === 'connected'
    ? 'connection-online'
    : visibleConnectionStatus === 'offline'
    ? 'connection-offline'
    : ''
  const hottestVoteCount = upNext.reduce((highestVotes, song) => Math.max(highestVotes, song.votes_count), 0)
  const recentlyPlayedSongs = performedSongs.slice(0, 8)
  const audienceShareUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return null
    }

    const shareUrl = new URL(window.location.href)
    if (event?.id) {
      shareUrl.searchParams.set('event', event.id)
    }
    return shareUrl.toString()
  }, [event?.id])
  const liveGigApiUnavailableRef = useRef(false)
  const audienceLanguageOptions = (event?.audienceIcelandicEnabled ?? false)
    ? [
        { code: 'en' as const, label: 'English', flagCode: 'gb' },
        { code: 'da' as const, label: 'Dansk', flagCode: 'dk' },
        { code: 'is' as const, label: 'Íslenska', flagCode: 'is' },
      ]
    : [
        { code: 'en' as const, label: 'English', flagCode: 'gb' },
        { code: 'da' as const, label: 'Dansk', flagCode: 'dk' },
      ]
  const copy = audienceLocale === 'da'
    ? {
        audienceApp: 'Publikumsapp',
        entryEyebrow: 'Officiel publikumslounge',
        entryCopy: 'Du er på vej ind i den live publikumsapp. Ønsk sange og stem dine favoritter til tops.',
        nameLabel: 'Dit navn',
        namePlaceholder: 'f.eks. Alex',
        languageLabel: 'Sprog',
        join: 'Bliv en del af showet',
        joining: 'Går ind...',
        welcome: 'Velkommen! 🎤',
        waitingGreeting: 'Hej',
        waitingTitle: 'Velkommen til publikumsloungen',
        waitingCopy: 'Du er klar til næste show. Hold denne side åben, så går vi live herfra.',
        waitingEndedTitle: 'Aftenens gig er afsluttet.',
        waitingEndedCopy: 'Tak for i aften. Hold øje med de næste gigs her i appen.',
        encoreThanksEyebrow: 'Tak for i aften',
        encoreThanksTitle: 'Ekstranummeret er færdigt.',
        encoreThanksBody: 'Tak fordi I dukkede op og gjorde aftenen helt speciel. Håber vi ses til næste gig.',
        startingSoon: 'Event starter snart',
        startsAt: 'Planlagt start',
        gigEnded: 'Gig er afsluttet',
        goingLiveNow: 'Går live nu...',
        viewMirror: 'Se Mirror-skærm',
        viewUpcoming: 'Se alle kommende events',
        audienceLive: 'Publikum Live',
        audienceHome: 'Publikumsforside',
        roomOpen: 'Rummet er åbent',
        songList: 'Sangliste',
        tipJar: 'Drikkepenge',
        socialLinks: 'Sociale links',
        duplicateBlocked: 'Dubletønsker er blokeret til dette gig.',
        activeRequestLimit: 'Hvert publikumsmedlem kan have {count} aktive ønsker i køen.',
        queueSizeLimit: 'Maksimalt {count} sange i køen ad gangen.',
        queueStatusNowPlaying: 'Din ønskesang spiller nu.',
        queueStatusUpNext: 'Din ønskesang er næste nummer!',
        queueStatusInQueue: 'Din ønskesang er nr. {position} i køen.',
        queueStatusAdditional: '+{count} flere af dine ønsker ligger i køen.',
        nowPlaying: 'Spiller nu',
        queueThinking: 'Køen tænker sig lige om',
        requestPrompt: 'Ingen sang spiller endnu.',
        liveQueue: 'Livekø',
        votesRise: 'Flest stemmer først',
        noSongsQueued: 'Ingen sange i kø endnu.',
        playedSongs: 'Spillede sange',
        latestOnTop: 'Nyeste øverst',
        noSongsPlayed: 'Ingen sange spillet endnu.',
        performerLinks: 'Kunstnerlinks',
        tipJarCopy: 'Hvis den sidste sang fik dig til at synge, så giv artisten en skilling. Klapsalver er søde, men huslejen larmer mere.',
        tipThankYou: event?.tipThankYouMessageDA?.trim() || 'Tusind tak for din støtte — det betyder meget. — Harald',
        enterName: 'Skriv dit navn for at fortsætte.',
        keepNameShort: `Hold dit navn under ${MAX_AUDIENCE_NAME_LENGTH} tegn.`,
        removeUnsupported: 'Fjern ugyldige tegn fra dit navn.',
        saveFailed: 'Kunne ikke gemme dit navn.',
        backToHome: 'Tilbage til start',
      }
    : audienceLocale === 'is'
    ? {
        audienceApp: 'Áhorfenda app',
        entryEyebrow: 'Official Audience Lounge',
        entryCopy: 'Skráðu þig inn, veldu lag og kjóstu þitt uppáhalds.',
        nameLabel: 'Nafnið þitt',
        namePlaceholder: 't.d. Alex',
        languageLabel: 'Íslenska',
        join: 'Taktu þátt í gleðinni',
        joining: 'Fer inn...',
        welcome: 'Velkomin! 🎤',
        waitingGreeting: 'Halló',
        waitingTitle: 'Velkomin i ahorfendastofuna',
        waitingCopy: 'Thu ert tilbúin(n) fyrir naesta vidburd. Haltu sidunni opinni og vid foru live her.',
        waitingEndedTitle: 'Tónleikunum er lokið.',
        waitingEndedCopy: 'Takk fyrir kvöldið. Skoðaðu næstu viðburði hér í appinu.',
        encoreThanksEyebrow: 'Takk fyrir kvöldið',
        encoreThanksTitle: 'Aukalagið er buið.',
        encoreThanksBody: 'Takk fyrir að mæta og gera kvöldið sérstakt. Vona að við sjáumst aftur á næsta viðburði.',
        startingSoon: 'Viðburður hefst bráðum',
        startsAt: 'Aetlud byrjun',
        gigEnded: 'Viðburði lokið',
        goingLiveNow: 'Fer i loftid nu...',
        viewMirror: 'Opna Mirror skja',
        viewUpcoming: 'Sjá alla komandi viðburði',
        audienceLive: 'Beint frá viðburði',
        audienceHome: 'Áhorfenda Forsíða',
        roomOpen: 'Salurinn er opinn',
        songList: 'Lagalisti',
        tipJar: 'Þjórfé',
        socialLinks: 'Samfélagsmiðlar',
        duplicateBlocked: 'Tvöfold ósk er bönnuð fyrir þetta gigg.',
        activeRequestLimit: 'Hver gestur getur haft {count} virka ósk í röðinni.',
        queueSizeLimit: 'Mest {count} lög í biðröðinni í einu.',
        queueStatusNowPlaying: 'Lagið þitt er í spilun núna.',
        queueStatusUpNext: 'Lagið þitt er næst í röð.',
        queueStatusInQueue: 'Lagið þitt er nr. {position} í röðinni.',
        queueStatusAdditional: '+{count} fleiri óskir frá þér eru í röðinni.',
        nowPlaying: 'Beint',
        queueThinking: 'Köðurinn er að hugsa sig um',
        requestPrompt: 'Ekkert lag er í gangi enn.',
        liveQueue: 'Live Lagalisti',
        votesRise: 'Flest atkvæði fara efst',
        noSongsQueued: 'Engin lög komin á listann',
        playedSongs: 'Spiluð Lög',
        latestOnTop: 'Nýjasta efst',
        noSongsPlayed: 'Engin lög hafa verið spiluð enn.',
        performerLinks: 'Listamanna tenglar',
        tipJarCopy: 'Viltu skilja eftir smá þjórfé fyrir stemninguna?',
        tipThankYou: 'Þúsund þakkir fyrir þitt framlag — þú gerir kvöldið enn betra',
        enterName: 'Skráðu nafnið þitt til að halda áfram.',
        keepNameShort: `Hafðu nafnið undir ${MAX_AUDIENCE_NAME_LENGTH} stafi.`,
        removeUnsupported: 'Fjarlægðu ógildar stafir úr nafninu.',
        saveFailed: 'Mistókst að vista nafnið.',
        backToHome: 'Aftur Heim.',
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
        waitingTitle: 'Welcome to the audience lounge',
        waitingCopy: 'You are ready for the next show. Keep this page open and we will go live here.',
        waitingEndedTitle: 'Tonight\'s gig has ended.',
        waitingEndedCopy: 'Thanks for joining. Check upcoming gigs in the audience app.',
        encoreThanksEyebrow: 'Thanks for tonight',
        encoreThanksTitle: 'The extra number is finished.',
        encoreThanksBody: 'Thank you for showing up and making the night special. Hope to see you again at the next gig.',
        startingSoon: 'Event starting soon',
        startsAt: 'Scheduled start',
        gigEnded: 'Gig ended',
        goingLiveNow: 'Going live now...',
        viewMirror: 'View Mirror screen',
        viewUpcoming: 'View all upcoming gigs',
        audienceLive: 'Audience Live',
        audienceHome: 'Audience Home',
        roomOpen: 'Room Open',
        songList: 'Song List',
        tipJar: 'Tip Jar',
        socialLinks: 'Social Links',
        duplicateBlocked: 'Duplicate requests are blocked for this gig.',
        activeRequestLimit: 'Each audience member can keep {count} active request{suffix} in the queue.',
        queueSizeLimit: 'Max {count} songs in the queue at a time.',
        queueStatusNowPlaying: 'Your request is playing now.',
        queueStatusUpNext: 'Your request is up next!',
        queueStatusInQueue: 'Your request is #{position} in the queue.',
        queueStatusAdditional: '+{count} more of your requests are in the queue.',
        nowPlaying: 'Now Playing',
        queueThinking: 'Queue is having a polite think',
        requestPrompt: 'No song playing yet.',
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
        backToHome: 'Back to Home Page',
      }

  const audienceUiCopy = audienceLocale === 'da'
    ? {
        fallbackMode: 'Fallback-tilstand',
        pendingBadgeTitle: 'Disse ønsker sendes automatisk, når du er online igen.',
        pendingRequestSingular: 'afventende ønske',
        pendingRequestPlural: 'afventende ønsker',
        pendingOfflineSingle: '"{title}" ligger i kø og bliver sendt, når du er online igen.',
        pendingOfflinePlural: '{count} ønsker ligger i kø og bliver sendt automatisk, når du er online igen.',
        karaokeNight: '🎤 Karaokeaften',
        karaokeEventBadge: 'Karaoke-event',
        joinKaraokeShow: '🎤 Deltag i karaoke-showet',
        liveFeed: '💬 Livefeed',
        cancelMyRequestAria: 'Annuller mit ønske',
        cancelButton: 'Annuller',
      }
    : audienceLocale === 'is'
    ? {
        fallbackMode: 'Fallback Mode',
        pendingBadgeTitle: 'These requests will submit automatically when you reconnect',
        pendingRequestSingular: 'pending request',
        pendingRequestPlural: 'pending requests',
        pendingOfflineSingle: '"{title}" is queued and will submit when you are back online.',
        pendingOfflinePlural: '{count} requests are queued and will submit automatically when you reconnect.',
        karaokeNight: '🎤 Karaoke Night',
        karaokeEventBadge: 'Karaoke Event',
        joinKaraokeShow: '🎤 Join the Karaoke Show',
        liveFeed: '💬 Live Feed',
        cancelMyRequestAria: 'Cancel my request',
        cancelButton: 'Cancel',
      }
    : {
        fallbackMode: 'Fallback Mode',
        pendingBadgeTitle: 'These requests will submit automatically when you reconnect',
        pendingRequestSingular: 'pending request',
        pendingRequestPlural: 'pending requests',
        pendingOfflineSingle: '"{title}" is queued and will submit when you are back online.',
        pendingOfflinePlural: '{count} requests are queued and will submit automatically when you reconnect.',
        karaokeNight: '🎤 Karaoke Night',
        karaokeEventBadge: 'Karaoke Event',
        joinKaraokeShow: '🎤 Join the Karaoke Show',
        liveFeed: '💬 Live Feed',
        cancelMyRequestAria: 'Cancel my request',
        cancelButton: 'Cancel',
      }

  const primaryQueuedRequest = myQueuedRequests[0] ?? null
  const additionalQueuedRequestCount = myQueuedRequests.length > 1 ? myQueuedRequests.length - 1 : 0
  const isMyRequestNowPlaying = Boolean(
    normalizedAudienceName
    && isNowPlayingStarted
    && (displaySong?.createdByName ?? '').trim().toLowerCase() === normalizedAudienceName,
  )
  const shouldShowQueuedBanner = isMyRequestNowPlaying || primaryQueuedRequest !== null
  const queuedBannerText = isMyRequestNowPlaying
    ? copy.queueStatusNowPlaying
    : primaryQueuedRequest?.queuePosition === 1
    ? copy.queueStatusUpNext
    : copy.queueStatusInQueue.replace('{position}', String(primaryQueuedRequest?.queuePosition ?? 0))
  const queuedBannerSecondaryText = additionalQueuedRequestCount > 0
    ? copy.queueStatusAdditional.replace('{count}', String(additionalQueuedRequestCount))
    : null
  const showAudienceEncoreThankYou = roomOpen
    && event?.eventType !== 'karaoke'
    && isLastSongSoonMode
    && hasStartedSongDuringLastSongMode
    && isBetweenSongs
    && !displaySong

  const waitingRoomHasEnded = waitingRoomRemainingMs !== null && waitingRoomRemainingMs <= -15_000
  const waitingRoomStartsAtLabel = formatAudienceAbsoluteStartLabel(waitingRoomStartMs, audienceLocale)
  const shouldPrioritizeAbsoluteStart = waitingRoomRemainingMs !== null && waitingRoomRemainingMs > 36 * 60 * 60 * 1000
  const currentEventAsUpcoming = event ? {
    id: event.id,
    name: event.name,
    venue: event.venue,
    gigDate: event.gigDate,
    gigStartTime: event.gigStartTime,
    gigEndTime: event.gigEndTime,
    coverImageUrl: event.coverImageUrl,
    eventType: event.eventType === 'karaoke' ? 'karaoke' as const : 'halli-live' as const,
    eventTheme: event.eventTheme === 'karaoke'
      ? 'karaoke' as const
      : event.eventTheme === 'harald-live'
      ? 'harald-live' as const
      : 'human-jukebox' as const,
    karafunUrl: event.karafunUrl ?? null,
  } : null
  const noGigStyledUpcomingEvents = currentEventAsUpcoming
    ? (upcomingEvents.some((upcomingEvent) => upcomingEvent.id === currentEventAsUpcoming.id)
      ? upcomingEvents
      : [currentEventAsUpcoming, ...upcomingEvents])
    : upcomingEvents
  const waitingRoomTitle = waitingRoomHasEnded ? copy.waitingEndedTitle : copy.waitingTitle
  const waitingRoomCopy = waitingRoomHasEnded ? copy.waitingEndedCopy : copy.waitingCopy
  const waitingRoomStatusLabel = waitingRoomHasEnded
    ? copy.gigEnded
    : shouldPrioritizeAbsoluteStart && waitingRoomStartsAtLabel
    ? `${copy.startsAt} · ${waitingRoomStartsAtLabel}`
    : waitingRoomCountdownLabel
    ? `${copy.startingSoon} · ${waitingRoomCountdownLabel}`
    : copy.startingSoon
  const loadingCountdownLabel = waitingRoomCountdownLabel
    ? `${copy.startingSoon} · ${waitingRoomCountdownLabel}`
    : copy.startingSoon

  const demoBackToHomeButton = demoMode ? (
    <button
      type="button"
      className="secondary-button"
      onClick={() => navigate('/')}
    >
      🏠 {copy.backToHome}
    </button>
  ) : null

  const audienceHomeButton = (
    <button
      type="button"
      className="secondary-button"
      onClick={() => navigate('/')}
    >
      🏠 {copy.backToHome}
    </button>
  )

  useEffect(() => {
    if (roomOpen || waitingRoomStartMs === null) {
      return
    }

    const tick = () => {
      setWaitingRoomNowMs(getAudienceNowMs())
    }

    tick()
    const timerId = window.setInterval(tick, 1000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [getAudienceNowMs, roomOpen, waitingRoomStartMs])

  useEffect(() => {
    if (!isLastSongSoonMode) {
      setHasStartedSongDuringLastSongMode(false)
      return
    }

    if (isNowPlayingStarted) {
      setHasStartedSongDuringLastSongMode(true)
    }
  }, [isLastSongSoonMode, isNowPlayingStarted])

  useEffect(() => {
    if (demoMode) return
    if (event === null) return
    if ((event?.audienceIcelandicEnabled ?? false) || audienceLocale !== 'is') {
      return
    }

    setAudienceLocale('en')
  }, [audienceLocale, event, event?.audienceIcelandicEnabled])

  useEffect(() => {
    if (hasRequestedEventParam) {
      setHasCompletedInitialLiveGigProbe(true)
      return
    }

    // Keep the no-gig screen responsive; live-gig probe continues in the background.
    setHasCompletedInitialLiveGigProbe(true)
  }, [hasRequestedEventParam])

  useEffect(() => {
    votingSongIdsRef.current = votingSongIds
  }, [votingSongIds])

  useEffect(() => {
    upcomingEventsRef.current = upcomingEvents
  }, [upcomingEvents])

  useEffect(() => {
    if (event || upcomingEvents.length === 0) {
      return
    }

    if (!upcomingBaseFetchHealthyRef.current) {
      return
    }

    const now = Date.now()
    const eventIds = new Set(upcomingEvents.map((upcomingEvent) => upcomingEvent.id))

    // Prune retry state for events no longer in view.
    for (const trackedEventId of upcomingCoverFetchRetryAfterRef.current.keys()) {
      if (!eventIds.has(trackedEventId)) {
        upcomingCoverFetchRetryAfterRef.current.delete(trackedEventId)
      }
    }

    const missingCoverEvents = upcomingEvents
      .filter((upcomingEvent) => !upcomingEvent.coverImageUrl)
      .filter((upcomingEvent) => !upcomingCoverFetchInFlightRef.current.has(upcomingEvent.id))
      .filter((upcomingEvent) => {
        const retryAfter = upcomingCoverFetchRetryAfterRef.current.get(upcomingEvent.id) ?? 0
        return retryAfter <= now
      })
      .slice(0, UPCOMING_COVER_FETCH_MAX_EVENTS)

    if (missingCoverEvents.length === 0) {
      return
    }

    let isCurrent = true

    const hydrateCovers = async () => {
      for (const upcomingEvent of missingCoverEvents) {
        if (!isCurrent) {
          return
        }

        upcomingCoverFetchInFlightRef.current.add(upcomingEvent.id)

        try {
          const coverImageUrl = await fetchUpcomingEventCoverById(upcomingEvent.id, UPCOMING_COVER_FETCH_TIMEOUT_MS)

          if (!isCurrent || !coverImageUrl) {
            upcomingCoverFetchRetryAfterRef.current.set(upcomingEvent.id, Date.now() + UPCOMING_COVER_RETRY_DELAY_MS)
            continue
          }

          upcomingCoverFetchRetryAfterRef.current.delete(upcomingEvent.id)

          setUpcomingEvents((previousEvents) => {
            const index = previousEvents.findIndex((eventRow) => eventRow.id === upcomingEvent.id)

            if (index < 0 || previousEvents[index].coverImageUrl) {
              return previousEvents
            }

            const updatedEvents = [...previousEvents]
            updatedEvents[index] = {
              ...updatedEvents[index],
              coverImageUrl,
            }

            saveUpcomingEventsCache(updatedEvents)
            return updatedEvents
          })
        } catch {
          // Best effort only - keep text-first cards if an image cannot be fetched quickly.
          upcomingCoverFetchRetryAfterRef.current.set(upcomingEvent.id, Date.now() + UPCOMING_COVER_RETRY_DELAY_MS)
        } finally {
          upcomingCoverFetchInFlightRef.current.delete(upcomingEvent.id)
        }
      }
    }

    void hydrateCovers()

    return () => {
      isCurrent = false
    }
  }, [event, upcomingEvents])

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

  useEffect(() => {
    if (audienceConnectionStatus === 'connected') {
      setVisibleConnectionStatus('connected')
      return
    }

    const timer = window.setTimeout(() => setVisibleConnectionStatus(audienceConnectionStatus), 3000)
    return () => window.clearTimeout(timer)
  }, [audienceConnectionStatus])

  const setUpcomingNoticeDebounced = useCallback((nextNotice: string | null, delayMs = 300) => {
    if (upcomingNoticeValueRef.current === nextNotice) {
      return
    }

    if (upcomingNoticeTimerRef.current !== null) {
      window.clearTimeout(upcomingNoticeTimerRef.current)
      upcomingNoticeTimerRef.current = null
    }

    upcomingNoticeTimerRef.current = window.setTimeout(() => {
      setUpcomingEventsNotice(nextNotice)
      upcomingNoticeValueRef.current = nextNotice
      upcomingNoticeTimerRef.current = null
    }, delayMs)
  }, [])

  useEffect(() => {
    return () => {
      if (upcomingNoticeTimerRef.current !== null) {
        window.clearTimeout(upcomingNoticeTimerRef.current)
        upcomingNoticeTimerRef.current = null
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

  // Prefetch facts for the next few songs only (not the entire queue) so we
  // don't hammer Wikipedia/iTunes/MusicBrainz on every queue change.
  const PREFETCH_AHEAD_COUNT = 3

  useEffect(() => {
    const abortController = new AbortController()

    const prefetchFacts = async () => {
      const songsToPreload = factEligibleSongs.slice(0, PREFETCH_AHEAD_COUNT)
      for (const song of songsToPreload) {
        if (abortController.signal.aborted) {
          return
        }

        // Don't burn bandwidth while the tab is in the background.
        if (document.hidden) {
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

    // Let the no-gig screen render immediately; the probe keeps running in the background.
    setHasCompletedInitialLiveGigProbe(true)

    const checkLiveGig = async () => {
      if (liveGigApiUnavailableRef.current) {
        if (isCurrent) {
          setHasCompletedInitialLiveGigProbe(true)
        }
        return
      }

      try {
        const payload = await fetchJsonNoStore('/api/live-gig', 3500)
        const liveGigId = getLiveGigIdFromApiPayload(payload)

        if (!isCurrent) {
          return
        }

        if (liveGigId) {
          if (!event && requestedEventId !== liveGigId) {
            navigate(`/audience?event=${encodeURIComponent(liveGigId)}&v=${audienceLinkVersionRef.current}`, {
              replace: true,
            })
          }

          if (!event) {
            setUpcomingEventsNotice('A live show just started. Connecting now...')
          }
          setHasCompletedInitialLiveGigProbe(true)
          return
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
    const bmc = normalizeExternalLink(hostProfile?.buymeacoffee_url)
    if (bmc) links.push({ label: 'Buy Me a Coffee', url: bmc })
    return links
  }, [event?.paypalUrl, hostProfile?.paypal_url, hostProfile?.buymeacoffee_url, resolvedMobilepayLink])
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
          .select('display_name, instagram_url, tiktok_url, youtube_url, facebook_url, paypal_url, mobilpay_url, buymeacoffee_url, contact_email')
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
      setCountdownFallbackEvent(null)
      upcomingEventsRef.current = []
      upcomingBaseFetchHealthyRef.current = false
      setUpcomingEventsLoading(false)
      setUpcomingNoticeDebounced(null, 0)
      return
    }

    if (authLoading && !user) {
      setUpcomingEventsLoading(true)
      setUpcomingNoticeDebounced('Finishing sign-in before loading upcoming gigs...', 200)
    }

    let isCurrent = true
    let channel: ReturnType<typeof supabase.channel> | null = null
    let pollTimerId: number | null = null

    const resolveCountdownFallback = async (events: AudienceUpcomingEvent[]) => {
      if (!isCurrent) {
        return
      }

      const nowMs = getAudienceNowMs()

      if (hasFutureCountdownTarget(events, nowMs)) {
        setCountdownFallbackEvent(null)
        return
      }

      try {
        const fallbackEvent = await fetchCountdownFallbackEventFromApi(nowMs)

        if (!isCurrent) {
          return
        }

        if (fallbackEvent && !events.some((eventRow) => eventRow.id === fallbackEvent.id)) {
          setCountdownFallbackEvent(fallbackEvent)
          return
        }

        setCountdownFallbackEvent((currentFallbackEvent) => (
          isFutureCountdownEvent(currentFallbackEvent, getAudienceNowMs()) ? currentFallbackEvent : null
        ))
      } catch {
        if (!isCurrent) {
          return
        }

        setCountdownFallbackEvent((currentFallbackEvent) => (
          isFutureCountdownEvent(currentFallbackEvent, getAudienceNowMs()) ? currentFallbackEvent : null
        ))
      }
    }

    const loadUpcomingEvents = async ({ showLoading = true }: { showLoading?: boolean } = {}) => {
      const now = getAudienceNowMs()

      if (upcomingLoadInFlightRef.current) {
        return
      }

      if (!showLoading && now < upcomingNextRefreshAtRef.current) {
        return
      }

      upcomingLoadInFlightRef.current = true

      if (showLoading && upcomingEventsRef.current.length === 0) {
        setUpcomingEventsLoading(true)
      }

      try {
        const mappedEvents = await fetchUpcomingEventsFromApi(now)

        if (!isCurrent) {
          return
        }

        setUpcomingEvents(mappedEvents)
        saveUpcomingEventsCache(mappedEvents)
        void resolveCountdownFallback(mappedEvents)
        upcomingFailureCountRef.current = 0
        upcomingNextRefreshAtRef.current = 0
        upcomingBaseFetchHealthyRef.current = true

        if (mappedEvents.length === 0) {
          setUpcomingNoticeDebounced('No upcoming gigs have been posted yet.', 250)

          if (!user) {
            // Keep first paint fast: do the auth retry + refetch in background.
            void (async () => {
              try {
                const { error: signInError } = await withPromiseTimeout(
                  supabase.auth.signInAnonymously(),
                  UPCOMING_AUTH_RETRY_TIMEOUT_MS,
                  'EventPage: anonymous sign-in retry timed out',
                )

                if (signInError) {
                  throw signInError
                }

                const refreshedEvents = await fetchUpcomingEventsFromApi(getAudienceNowMs())

                if (!isCurrent) {
                  return
                }

                setUpcomingEvents(refreshedEvents)
                saveUpcomingEventsCache(refreshedEvents)
                void resolveCountdownFallback(refreshedEvents)

                if (refreshedEvents.length > 0) {
                  setUpcomingNoticeDebounced(null, 300)
                }
              } catch (signInError) {
                console.warn('EventPage: anonymous sign-in retry failed for upcoming events', signInError)
              }
            })()
          }
        } else {
          setUpcomingNoticeDebounced(null, 1800)
        }
      } catch (error) {
        const shouldSkipLog = isExpectedUpcomingEventsTransientError(error)

        if (!shouldSkipLog) {
          const now = Date.now()
          const errorKey = buildUpcomingErrorLogKey(error)
          const lastLogAt = upcomingErrorLogMapRef.current.get(errorKey) ?? 0

          if (now - lastLogAt >= UPCOMING_ERROR_LOG_THROTTLE_MS) {
            console.warn('EventPage: failed to load upcoming no-gig events', error)
            upcomingErrorLogMapRef.current.set(errorKey, now)
          }
        }

        if (isAuthSessionError(error) && !user) {
          try {
            const { error: signInError } = await withPromiseTimeout(
              supabase.auth.signInAnonymously(),
              UPCOMING_AUTH_RETRY_TIMEOUT_MS,
              'EventPage: anonymous sign-in retry timed out',
            )

            if (signInError) {
              throw signInError
            }

            const mappedEvents = await fetchUpcomingEventsFromApi(getAudienceNowMs())

            if (isCurrent) {
              setUpcomingEvents(mappedEvents)
              saveUpcomingEventsCache(mappedEvents)
              void resolveCountdownFallback(mappedEvents)
              upcomingFailureCountRef.current = 0
              upcomingNextRefreshAtRef.current = 0
              upcomingBaseFetchHealthyRef.current = true

              if (mappedEvents.length === 0) {
                setUpcomingNoticeDebounced('No upcoming gigs have been posted yet.', 250)
              } else {
                setUpcomingNoticeDebounced(null, 1800)
              }
            }

            return
          } catch (retryError) {
            console.warn('EventPage: auth retry failed while loading upcoming no-gig events', retryError)
          }
        }

        if (isCurrent) {
          upcomingFailureCountRef.current += 1
          const retryDelay = getUpcomingRetryDelayMs(upcomingFailureCountRef.current)
          upcomingNextRefreshAtRef.current = Date.now() + retryDelay
          upcomingBaseFetchHealthyRef.current = false

          const staleCachedEvents = readUpcomingEventsCache({ allowStale: true })

          if (staleCachedEvents.length > 0) {
            setUpcomingEvents(staleCachedEvents)
            void resolveCountdownFallback(staleCachedEvents)
            setUpcomingNoticeDebounced('Refreshing upcoming gigs...', 250)
            return
          }

          if (upcomingEventsRef.current.length === 0) {
            setUpcomingEvents([])
            setUpcomingNoticeDebounced(UPCOMING_EVENTS_UNAVAILABLE_NOTICE, 250)
          } else {
            setUpcomingNoticeDebounced(null, 0)
          }
        }
      } finally {
        upcomingLoadInFlightRef.current = false

        if (isCurrent && showLoading) {
          setUpcomingEventsLoading(false)
        }
      }
    }

    void loadUpcomingEvents({ showLoading: true })

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
          void loadUpcomingEvents({ showLoading: false })
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          return
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setUpcomingNoticeDebounced('Live updates are reconnecting. Upcoming events are still available.', 350)
        }
      })

    const scheduleNextPoll = () => {
      const intervalMs = upcomingFailureCountRef.current > 0
        ? UPCOMING_EVENTS_DEGRADED_POLL_INTERVAL_MS
        : UPCOMING_EVENTS_POLL_INTERVAL_MS

      pollTimerId = window.setTimeout(() => {
        if (!document.hidden) {
          void loadUpcomingEvents({ showLoading: false })
        }

        if (isCurrent) {
          scheduleNextPoll()
        }
      }, intervalMs)
    }

    scheduleNextPoll()

    return () => {
      isCurrent = false
      if (channel) {
        void supabase.removeChannel(channel)
      }
      if (pollTimerId !== null) {
        window.clearTimeout(pollTimerId)
      }
    }
  }, [event, authLoading, user, setUpcomingNoticeDebounced, getAudienceNowMs])

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
    let playbackBroadcastChannel: BroadcastChannel | null = null
    let syncTimerId: number | null = null
    let nullSyncMissCount = 0
    let latestPlaybackState: SharedPlaybackState | null = null
    let lastAppliedPlaybackTimestampMs = 0

    const applyIncomingPlaybackState = (nextState: SharedPlaybackState | null, timestampHint?: unknown) => {
      if (!isCurrent) {
        return
      }

      const inferredTimestampMs = coercePlaybackTimestampMs(timestampHint) ?? Date.now()
      const nextStateDiffers = !isSamePlaybackState(latestPlaybackState, nextState)

      if (
        nextStateDiffers
        && inferredTimestampMs + PLAYBACK_STALE_UPDATE_TOLERANCE_MS < lastAppliedPlaybackTimestampMs
      ) {
        return
      }

      if (!nextStateDiffers) {
        lastAppliedPlaybackTimestampMs = Math.max(lastAppliedPlaybackTimestampMs, inferredTimestampMs)
        return
      }

      latestPlaybackState = nextState
      lastAppliedPlaybackTimestampMs = Math.max(lastAppliedPlaybackTimestampMs, inferredTimestampMs)
      setPlaybackState(nextState)
    }

    const syncPlaybackState = async () => {
      if (!isCurrent) return

      try {
        const state = await readSharedPlaybackState(eventId)
        if (!isCurrent) {
          return
        }

        if (state === null) {
          nullSyncMissCount += 1

          if (nullSyncMissCount < PLAYBACK_NULL_SYNC_GRACE_MISSES) {
            return
          }

          applyIncomingPlaybackState(null)
          return
        }

        nullSyncMissCount = 0
        applyIncomingPlaybackState(state)
      } catch (error) {
        console.warn('EventPage: playback sync failed', error)
      }
    }

    const cachedPlaybackMessage = readFromLocalStorage<{ eventId?: string; state?: SharedPlaybackState; timestamp?: unknown } | null>(
      PLAYBACK_STATE_STORAGE_KEY,
      null,
    )

    if (cachedPlaybackMessage?.eventId === eventId && cachedPlaybackMessage.state) {
      nullSyncMissCount = 0
      applyIncomingPlaybackState(cachedPlaybackMessage.state ?? null, cachedPlaybackMessage.timestamp)
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
            updated_at?: string | null
          } | null
        }) => {
          const nextRow = payload?.new

          if (payload?.eventType === 'DELETE') {
            void syncPlaybackState()
            return
          }

          if (nextRow) {
            const nextState: SharedPlaybackState = {
              currentSongId: nextRow.current_song_id ?? null,
              currentSongCoverUrl: nextRow.current_song_cover_url ?? null,
              isStarted: Boolean(nextRow.is_started),
              quoteIndex: Number.isFinite(nextRow.quote_index)
                ? (nextRow.quote_index as number)
                : 0,
              countdownTargetMs: Number.isFinite(nextRow.countdown_target_ms)
                ? Math.round(nextRow.countdown_target_ms as number)
                : null,
              brbActive: Boolean(nextRow.brb_active),
              brbMessage: typeof nextRow.brb_message === 'string' ? nextRow.brb_message : null,
            }

            nullSyncMissCount = 0
            applyIncomingPlaybackState(nextState, nextRow.updated_at)
            return
          }

          void syncPlaybackState()
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void syncPlaybackState()
          return
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn('EventPage: playback subscription reconnecting', { eventId, status })
          void syncPlaybackState()
        }
      })

    const onPlaybackStateEvent = (nextEvent: Event) => {
      const detail = (nextEvent as CustomEvent<{ eventId: string; state: SharedPlaybackState; timestamp?: unknown }>).detail

      if (detail?.eventId === eventId) {
        nullSyncMissCount = 0
        applyIncomingPlaybackState(detail.state ?? null, detail.timestamp)
      }
    }

    const onStoragePlaybackState = (nextEvent: StorageEvent) => {
      if (nextEvent.key !== PLAYBACK_STATE_STORAGE_KEY || !nextEvent.newValue) {
        return
      }

      try {
        const detail = JSON.parse(nextEvent.newValue) as { eventId?: string; state?: SharedPlaybackState; timestamp?: unknown }

        if (detail.eventId !== eventId || !detail.state) {
          return
        }

        nullSyncMissCount = 0
        applyIncomingPlaybackState(detail.state ?? null, detail.timestamp)
      } catch {
        // Ignore malformed cross-tab sync payloads.
      }
    }

    const onAudiencePlaybackWake = () => {
      void syncPlaybackState()
    }

    const onAudiencePlaybackVisibilityChange = () => {
      if (!document.hidden) {
        void syncPlaybackState()
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
    window.addEventListener('focus', onAudiencePlaybackWake)
    window.addEventListener('online', onAudiencePlaybackWake)
    window.addEventListener('pageshow', onAudiencePlaybackWake)
    document.addEventListener('visibilitychange', onAudiencePlaybackVisibilityChange)

    if ('BroadcastChannel' in window) {
      playbackBroadcastChannel = new BroadcastChannel(PLAYBACK_STATE_BROADCAST_CHANNEL)
      playbackBroadcastChannel.onmessage = (messageEvent: MessageEvent<{ eventId?: string; state?: SharedPlaybackState; timestamp?: unknown }>) => {
        const detail = messageEvent.data

        if (detail?.eventId !== eventId || !detail.state) {
          return
        }

        nullSyncMissCount = 0
        applyIncomingPlaybackState(detail.state ?? null, detail.timestamp)
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
      window.removeEventListener('focus', onAudiencePlaybackWake)
      window.removeEventListener('online', onAudiencePlaybackWake)
      window.removeEventListener('pageshow', onAudiencePlaybackWake)
      document.removeEventListener('visibilitychange', onAudiencePlaybackVisibilityChange)
      playbackBroadcastChannel?.close()
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

  const handleSignOut = useCallback(async () => {
    clearAudienceIdentity()
    setAudienceName('')
    setAudienceNameInput('')

    try {
      await signOut()
    } catch (error) {
      console.warn('EventPage: audience sign-out failed', error)
    }

    navigate('/audience', { replace: true })
  }, [navigate, signOut])

  if (loading && hasRequestedEventParam && !event && upcomingEvents.length === 0 && requestedCountdownTargetMs === null) {
    return (
      <section className="page-logo-loader-shell" aria-label="Audience loading" role="status">
        <img className="page-logo-loader" src="/the-human-jukebox-logo.png" alt="" width="80" height="80" />
        {requestedCountdownTargetMs !== null ? <p className="subcopy no-margin">{loadingCountdownLabel}</p> : null}
        {audienceHomeButton}
      </section>
    )
  }

  // Guard against stale cached audience snapshots on cold load.
  // Without an explicit event param, wait for the initial live-gig probe
  // before rendering event-specific UI like name/language entry.
  if (!hasRequestedEventParam && !hasCompletedInitialLiveGigProbe) {
    return (
      <section className="page-logo-loader-shell" aria-label="Audience loading" role="status">
        <img className="page-logo-loader" src="/the-human-jukebox-logo.png" alt="" width="80" height="80" />
        <p className="subcopy no-margin">Checking live gigs...</p>
        {audienceHomeButton}
      </section>
    )
  }

  if (!event) {
    if (hasRequestedEventParam && (loading || authLoading) && requestedCountdownTargetMs === null) {
      return (
        <section className="page-logo-loader-shell" aria-label="Audience loading" role="status">
          <img className="page-logo-loader" src="/the-human-jukebox-logo.png" alt="" width="80" height="80" />
          {requestedCountdownTargetMs !== null ? <p className="subcopy no-margin">{loadingCountdownLabel}</p> : null}
          {audienceHomeButton}
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
        countdownFallbackEvent={countdownFallbackEvent}
        countdownTargetMsFromLink={effectiveCountdownTargetMs}
        countdownTargetEventId={requestedEventId}
        nowOffsetMs={audienceClockOffsetMs}
        loadingUpcomingEvents={upcomingEventsLoading}
        upcomingEventsNotice={upcomingEventsNotice ?? authError}
        getEventHref={(eventId) => `/audience?event=${encodeURIComponent(eventId)}&v=${audienceLinkVersionRef.current}`}
        locale={audienceLocale}
        socialLinks={socialLinks}
      />
    )
  }

  if (!roomOpen && !isTestGigView) {
    return (
      <AudienceNoGigState
        upcomingEvents={noGigStyledUpcomingEvents}
        countdownFallbackEvent={countdownFallbackEvent}
        countdownTargetMsFromLink={effectiveCountdownTargetMs}
        countdownTargetEventId={requestedEventId}
        nowOffsetMs={audienceClockOffsetMs}
        loadingUpcomingEvents={upcomingEventsLoading}
        upcomingEventsNotice={upcomingEventsNotice ?? authError}
        getEventHref={(eventId) => `/audience?event=${encodeURIComponent(eventId)}&v=${audienceLinkVersionRef.current}`}
        locale={audienceLocale}
        socialLinks={socialLinks}
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
            {demoBackToHomeButton}
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
            {demoBackToHomeButton}
          </div>
        </article>
      </section>
    )
  }

  if (!roomOpen) {
    return (
      <section
        className={`audience-entry-shell audience-karafun audience-waiting-shell${isTestGigView ? '' : ' audience-theme-no-gig-blend'}`}
        aria-label="Audience waiting room"
      >
        <article className="queue-panel audience-entry-card audience-waiting-card">
          <p className="eyebrow audience-entry-eyebrow">{audienceName ? `${copy.waitingGreeting} ${audienceName}` : copy.entryEyebrow}</p>
          <h1>{waitingRoomTitle}</h1>
          <p className="subcopy audience-entry-copy">{waitingRoomCopy}</p>
          {authError ? <p className="error-text request-error-inline">{authError}</p> : null}
          <p className="meta-badge audience-soon-badge">
            {waitingRoomStatusLabel}
          </p>
          {!waitingRoomHasEnded && waitingRoomStartsAtLabel ? (
            <p className="subcopy audience-waiting-start-label">{copy.startsAt}: {waitingRoomStartsAtLabel}</p>
          ) : null}
          {showGoingLiveNowBanner && !waitingRoomHasEnded ? (
            <p className="meta-badge audience-going-live-banner" aria-live="assertive">{copy.goingLiveNow}</p>
          ) : null}
          {event?.name ? (
            <div className="audience-waiting-event-info">
              <p className="audience-waiting-event-name">{event.name}</p>
              {event.subtitle ? <p className="audience-waiting-event-subtitle">{event.subtitle}</p> : null}
            </div>
          ) : null}
          {allTipLinks.length > 0 ? (
            <a href={allTipLinks[0].url} target="_blank" rel="noopener noreferrer" className="secondary-button">
              💸 {allTipLinks[0].label}
            </a>
          ) : null}
          {socialLinks.length > 0 ? (
            <div className="audience-social-links-inline audience-waiting-secondary-actions">
              {socialLinks.map((link) => (
                <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer" className="secondary-button">
                  {link.label}
                </a>
              ))}
            </div>
          ) : null}
          <div className="audience-waiting-primary-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                const mirrorUrl = event?.id
                  ? `/mirror?event=${encodeURIComponent(event.id)}&launchFullscreen=1`
                  : '/mirror?launchFullscreen=1'
                window.open(mirrorUrl, '_blank', 'noopener,noreferrer')
              }}
            >
              📺 {copy.viewMirror}
            </button>
            {hasRequestedEventParam ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigate('/audience')}
              >
                {copy.viewUpcoming}
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate('/')}
            >
              🏠 {copy.backToHome}
            </button>
          </div>
          {demoBackToHomeButton}
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
                    onClick={() => { setAudienceLocale(option.code); commitAudienceLocale(option.code) }}
                  >
                    <img className="audience-language-option-flag" src={`https://flagcdn.com/20x15/${option.flagCode}.png`} alt="" aria-hidden="true" />
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
            {demoBackToHomeButton}
          </form>
          {errorText ? <p className="error-text request-error-inline">{errorText}</p> : null}
        </article>
      </section>
    )
  }

  return (
    <section
      className={`audience-shell audience-shell-compact audience-shell-modern audience-karafun${isKaraokeEvent ? ' audience-shell-karaoke' : ''}${isTestGigView ? '' : ' audience-theme-no-gig-blend'}`}
      aria-label="Audience app"
    >
      <section className="audience-stage">
        <AudienceFixedHeader
          eventName={isBuildSelfEvent && event?.artistName ? `${event.artistName} — ${event.name ?? copy.audienceLive}` : (event?.name ?? copy.audienceLive)}
          subtitle={event?.subtitle ?? null}
          logoSrc="/the-human-jukebox-logo.svg"
          locale={audienceLocale}
          shareUrl={audienceShareUrl || null}
          onSignOut={handleSignOut}
        />

        <section className="queue-panel audience-connection-banner" aria-label="Audience connection health">
          <div className="audience-connection-banner-head">
            <span className={`meta-badge connection-badge ${connectionBadgeClassName}`}>{connectionBadgeLabel}</span>
            {queueOperatingMode === 'degraded' ? <span className="meta-badge audience-degraded-badge">{audienceUiCopy.fallbackMode}</span> : null}
            {pendingOfflineSongs.length > 0 ? (
              <span className="meta-badge audience-pending-badge" title={audienceUiCopy.pendingBadgeTitle}>
                {pendingOfflineSongs.length} {pendingOfflineSongs.length === 1 ? audienceUiCopy.pendingRequestSingular : audienceUiCopy.pendingRequestPlural}
              </span>
            ) : null}
          </div>
          {pendingOfflineSongs.length > 0 && audienceConnectionStatus === 'offline' ? (
            <p className="subcopy no-margin" role="status" aria-live="polite">
              {pendingOfflineSongs.length === 1
                ? audienceUiCopy.pendingOfflineSingle.replace('{title}', pendingOfflineSongs[0].title)
                : audienceUiCopy.pendingOfflinePlural.replace('{count}', String(pendingOfflineSongs.length))}
            </p>
          ) : null}
          {queueHealthMessage ? <p className="subcopy no-margin">{queueHealthMessage}</p> : null}
        </section>

        <section className="queue-panel audience-start-actions-panel" aria-label="Audience actions">
          <div className="panel-head audience-request-head">
            <div>
              <p className="eyebrow audience-request-eyebrow">{isKaraokeEvent ? audienceUiCopy.karaokeNight : copy.audienceHome}</p>
              <h2>{copy.waitingGreeting} {audienceName}</h2>
            </div>
            <div className="audience-request-badges">
              <div className="audience-language-inline" role="group" aria-label={copy.languageLabel}>
                {audienceLanguageOptions.map((option) => (
                  <button
                    key={option.code}
                    type="button"
                    className={`audience-language-inline-btn${audienceLocale === option.code ? ' audience-language-inline-btn-active' : ''}`}
                    onClick={() => { setAudienceLocale(option.code); commitAudienceLocale(option.code) }}
                    title={option.label}
                    aria-current={audienceLocale === option.code ? 'true' : undefined}
                  >
                    <img src={`https://flagcdn.com/20x15/${option.flagCode}.png`} alt={option.label} width="20" height="15" />
                  </button>
                ))}
              </div>
              {isKaraokeEvent ? <span className="meta-badge">{audienceUiCopy.karaokeEventBadge}</span> : null}
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
                  {audienceUiCopy.joinKaraokeShow}
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
                    {audienceUiCopy.liveFeed}
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
                    {audienceUiCopy.liveFeed}
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
            {demoBackToHomeButton}
          </div>
          {!isKaraokeEvent && !demoMode && event?.requestInstructions ? <p className="subcopy audience-request-note">{event.requestInstructions}</p> : null}
          {!isKaraokeEvent && (duplicateRequestsBlocked || activeRequestCap || queueSizeCap) ? (
            <div className="audience-policy-list">
              {duplicateRequestsBlocked ? <p className="meta-badge audience-policy-badge">{copy.duplicateBlocked}</p> : null}
              {activeRequestCap ? (
                <p className="meta-badge audience-policy-badge">
                  {copy.activeRequestLimit
                    .replace('{count}', String(activeRequestCap))
                    .replace('{suffix}', activeRequestCap === 1 ? '' : 's')}
                </p>
              ) : null}
              {queueSizeCap ? (
                <p className="meta-badge audience-policy-badge">
                  {copy.queueSizeLimit.replace('{count}', String(queueSizeCap))}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        {showAudienceEncoreThankYou ? (
          <section className="queue-panel audience-encore-thanks-panel" aria-live="polite" role="status">
            <p className="audience-encore-thanks-eyebrow">{copy.encoreThanksEyebrow}</p>
            <h2>{copy.encoreThanksTitle}</h2>
            <p className="audience-encore-thanks-copy">{copy.encoreThanksBody}</p>
          </section>
        ) : null}

        {!isKaraokeEvent ? (
        <>
        <article className="now-playing-card audience-now-playing-panel">
          {shouldShowQueuedBanner ? (
            <div className="audience-queued-banner" role="status" aria-live="polite">
              <span className="audience-queued-banner-icon" aria-hidden="true">🎵</span>
              <span className="audience-queued-banner-text">
                {queuedBannerText}
                {queuedBannerSecondaryText ? ` ${queuedBannerSecondaryText}` : ''}
              </span>
              {primaryQueuedRequest && !isNowPlayingStarted ? (
                <div className="audience-queued-banner-actions">
                  <button
                    type="button"
                    className="audience-queued-banner-cancel"
                    aria-label={audienceUiCopy.cancelMyRequestAria}
                    disabled={cancellingRequestId === primaryQueuedRequest.song.id}
                    onClick={async () => {
                      setCancellingRequestId(primaryQueuedRequest.song.id)
                      try {
                        await removeSong(primaryQueuedRequest.song.id)
                      } finally {
                        setCancellingRequestId(null)
                      }
                    }}
                  >
                    {cancellingRequestId === primaryQueuedRequest.song.id ? '…' : audienceUiCopy.cancelButton}
                  </button>
                </div>
              ) : null}
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
                myName={audienceName || undefined}
                isOwnRequest={myQueuedSongIds.has(song.id)}
                hostId={event?.hostId}
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
                      <span className="tip-jar-ribbon">{copy.tipJarCopy}</span>
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
