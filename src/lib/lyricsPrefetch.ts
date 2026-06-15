// Background lyrics pre-fetch that runs when a song is added to the queue.
// Results are stored in localStorage so LyricsPage can serve them instantly
// and know whether manual entry is needed.

import { readCommittedAudienceLocale } from './audienceIdentity'

const AUTO_CACHE_KEY = 'lyrics_auto_cache_v1'
const STATUS_KEY = 'lyrics_prefetch_status_v1'

type PrefetchStatus = 'found' | 'not_found'
type CacheMap = Record<string, string>
type StatusMap = Record<string, PrefetchStatus>

function normalizePart(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function normalizeSongId(value: string | null | undefined): string {
  return normalizePart(value ?? '')
}

export function lyricsPrefetchCacheKey(title: string, artist: string, songId?: string | null): string {
  const normalizedSongId = normalizeSongId(songId)
  if (normalizedSongId) {
    return `song:${normalizedSongId}`
  }

  return `${normalizePart(title)}::${normalizePart(artist)}`
}

function buildQueryVariants(title: string, artist: string): Array<{ t: string; a: string }> {
  const normalizeQuotes = (v: string) =>
    v
      .replace(/[\u2018\u2019\u2032]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()

  const stripTitle = (v: string) =>
    normalizeQuotes(v)
      .replace(/\(.*?\)/g, ' ')
      .replace(/\[.*?\]/g, ' ')
      .replace(/\b(feat\.?|ft\.?)\b.*$/i, ' ')
      .replace(/\b(remix|version|edit|live|acoustic)\b/gi, ' ')
      .replace(/\s*-\s*(official|lyrics?|video).*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const stripApostrophes = (v: string) =>
    normalizeQuotes(v)
      .replace(/[\u2019'’]/g, '')
      .replace(/\s+/g, ' ')
      .trim()

  const stripArtist = (v: string) =>
    normalizeQuotes(v)
      .replace(/\b(feat\.?|ft\.?)\b.*$/i, ' ')
      .split(/\s(?:&|x|with|and)\s|,|\//i)[0]
      .replace(/\s+/g, ' ')
      .trim()

  const splitPrimary = (v: string) =>
    normalizeQuotes(v)
      .split(/\s\/\s|\s-\s|\s\|\s|\//)[0]
      .replace(/\s+/g, ' ')
      .trim()

  const normalizeNoPunctuation = (v: string) =>
    normalizeQuotes(v)
      .replace(/[.,!?:;]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const titles = Array.from(new Set([
    normalizeQuotes(title),
    stripTitle(title),
    splitPrimary(stripTitle(title)),
    normalizeNoPunctuation(stripTitle(title)),
    stripApostrophes(stripTitle(title)),
  ].filter(Boolean)))

  const artists = Array.from(new Set([
    normalizeQuotes(artist),
    stripArtist(artist),
    splitPrimary(stripArtist(artist)),
  ].filter(Boolean)))

  const pairs: Array<{ t: string; a: string }> = []

  for (const t of titles) {
    for (const a of artists) {
      pairs.push({ t, a })
    }
  }

  if (titles[0] && artists[0]) {
    pairs.push({ t: artists[0], a: titles[0] })
  }

  return Array.from(new Map(pairs.map((pair) => [`${pair.t}::${pair.a}`, pair])).values())
}

export function getLyricsPrefetchStatus(title: string, artist: string, songId?: string | null): PrefetchStatus | null {
  try {
    const raw = localStorage.getItem(STATUS_KEY)
    if (!raw) return null
    const map = JSON.parse(raw) as StatusMap
    const primaryKey = lyricsPrefetchCacheKey(title, artist, songId)
    return map[primaryKey] ?? map[lyricsPrefetchCacheKey(title, artist)] ?? null
  } catch {
    return null
  }
}

export function getAutoCachedLyrics(title: string, artist: string, songId?: string | null): string | null {
  try {
    const raw = localStorage.getItem(AUTO_CACHE_KEY)
    if (!raw) return null
    const cache = JSON.parse(raw) as CacheMap
    const primaryKey = lyricsPrefetchCacheKey(title, artist, songId)
    if (cache[primaryKey]) return cache[primaryKey]

    const fallbackKey = lyricsPrefetchCacheKey(title, artist)
    if (cache[fallbackKey]) return cache[fallbackKey]

    for (const { t, a } of buildQueryVariants(title, artist)) {
      const variantKey = lyricsPrefetchCacheKey(t, a)
      if (cache[variantKey]) return cache[variantKey]
    }

    return null
  } catch {
    return null
  }
}

export function cacheFoundLyrics(title: string, artist: string, lyrics: string, songId?: string | null): void {
  const normalizedLyrics = lyrics.trim()
  if (!normalizedLyrics) {
    return
  }

  const primaryKey = lyricsPrefetchCacheKey(title, artist)
  const songKey = lyricsPrefetchCacheKey(title, artist, songId)

  try {
    const cache: CacheMap = JSON.parse(localStorage.getItem(AUTO_CACHE_KEY) ?? '{}')
    cache[primaryKey] = normalizedLyrics
    cache[songKey] = normalizedLyrics
    localStorage.setItem(AUTO_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Non-blocking.
  }

  try {
    const statuses: StatusMap = JSON.parse(localStorage.getItem(STATUS_KEY) ?? '{}')
    statuses[primaryKey] = 'found'
    statuses[songKey] = 'found'
    localStorage.setItem(STATUS_KEY, JSON.stringify(statuses))
  } catch {
    // Non-blocking.
  }
}

export function markLyricsNotFound(title: string, artist: string, songId?: string | null): void {
  const primaryKey = lyricsPrefetchCacheKey(title, artist)
  const songKey = lyricsPrefetchCacheKey(title, artist, songId)

  try {
    const statuses: StatusMap = JSON.parse(localStorage.getItem(STATUS_KEY) ?? '{}')
    statuses[primaryKey] = 'not_found'
    statuses[songKey] = 'not_found'
    localStorage.setItem(STATUS_KEY, JSON.stringify(statuses))
  } catch {
    // Non-blocking.
  }
}

// Fire-and-forget. Call after a song is successfully added to the queue.
// Skips silently if the song was already checked.
export function prefetchAndCacheLyrics(title: string, artist: string, songId?: string | null): void {
  if (typeof window === 'undefined') return
  if (getLyricsPrefetchStatus(title, artist, songId) !== null) return

  const variants = buildQueryVariants(title, artist)
  const locale = readCommittedAudienceLocale()

  void (async () => {
    for (const { t, a } of variants) {
      try {
        const res = await fetch(
          `/api/lyrics-genius?song=${encodeURIComponent(t)}&artist=${encodeURIComponent(a)}&locale=${encodeURIComponent(locale)}`,
        )
        if (!res.ok) continue

        const data = (await res.json()) as Record<string, unknown>
        const lyricsText = typeof data?.lyrics === 'string' ? data.lyrics.trim() : ''

        if (lyricsText.length > 0) {
          cacheFoundLyrics(title, artist, lyricsText, songId)
          return
        }
      } catch {
        // Continue to next variant.
      }
    }

    // All variants exhausted.
    markLyricsNotFound(title, artist, songId)
  })()
}
