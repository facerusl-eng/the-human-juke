// Background lyrics pre-fetch that runs when a song is added to the queue.
// Results are stored in localStorage so LyricsPage can serve them instantly
// and know whether manual entry is needed.

const AUTO_CACHE_KEY = 'lyrics_auto_cache_v1'
const STATUS_KEY = 'lyrics_prefetch_status_v1'

type PrefetchStatus = 'found' | 'not_found'
type CacheMap = Record<string, string>
type StatusMap = Record<string, PrefetchStatus>

function normalizePart(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function extractNowPlayingTitleArtist(rawText: string): { title: string; artist: string } {
  const text = rawText.replace(/^\s*(now\s+playing|playing|track|song)\s*[:\-–—]?\s*/i, '').trim()
  if (!text) {
    return { title: rawText.trim(), artist: '' }
  }

  const separators = [/\s*[-–—]\s*/, /\s+by\s+/i, /\s*\|\s*/]
  for (const separator of separators) {
    const parts = text.split(separator)
    if (parts.length >= 2) {
      const left = parts[0].replace(/\s*\([^)]*\)|\s*\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()
      const right = parts.slice(1).join(' ').replace(/\s*\([^)]*\)|\s*\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()
      if (left && right) {
        return { title: right, artist: left }
      }
    }
  }

  return { title: rawText.trim(), artist: '' }
}

export function lyricsPrefetchCacheKey(title: string, artist: string): string {
  return `${normalizePart(title)}::${normalizePart(artist)}`
}

function buildQueryVariants(title: string, artist: string): Array<{ t: string; a: string }> {
  const parsedTitleArtist = extractNowPlayingTitleArtist(title || artist)
  const resolvedTitle = parsedTitleArtist.title || title
  const resolvedArtist = parsedTitleArtist.artist || artist

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
    normalizeQuotes(resolvedTitle),
    stripTitle(resolvedTitle),
    splitPrimary(stripTitle(resolvedTitle)),
    normalizeNoPunctuation(stripTitle(resolvedTitle)),
    stripApostrophes(stripTitle(resolvedTitle)),
  ].filter(Boolean)))

  const artists = Array.from(new Set([
    normalizeQuotes(resolvedArtist),
    stripArtist(resolvedArtist),
    splitPrimary(stripArtist(resolvedArtist)),
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
    const primaryKey = lyricsPrefetchCacheKey(title, artist)
    if (map[primaryKey]) return map[primaryKey]
    const songKey = songId ? `song:${(songId ?? '').trim().toLowerCase()}` : null
    if (songKey && map[songKey]) return map[songKey]
    return null
  } catch {
    return null
  }
}

export function getAutoCachedLyrics(title: string, artist: string, songId?: string | null): string | null {
  try {
    const raw = localStorage.getItem(AUTO_CACHE_KEY)
    if (!raw) return null
    const cache = JSON.parse(raw) as CacheMap
    const primaryKey = lyricsPrefetchCacheKey(title, artist)
    if (cache[primaryKey]) return cache[primaryKey]
    if (songId && cache[`song:${(songId ?? '').trim().toLowerCase()}`]) {
      return cache[`song:${(songId ?? '').trim().toLowerCase()}`]
    }

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
  const songKey = songId ? `song:${(songId ?? '').trim().toLowerCase()}` : primaryKey

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
  const songKey = songId ? `song:${(songId ?? '').trim().toLowerCase()}` : primaryKey

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
  if (!normalizePart(title)) return
  if (getLyricsPrefetchStatus(title, artist, songId) !== null) return

  const variants = buildQueryVariants(title, artist)

  void (async () => {
    const GOOD_ENOUGH_CHARS = 350
    const PREFETCH_TIMEOUT_MS = 14_000

    const fetchVariant = async ({ t, a }: { t: string; a: string }): Promise<string | null> => {
      try {
        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(), 7000)
        const res = await fetch(
          `/api/lyrics-genius?song=${encodeURIComponent(t)}&artist=${encodeURIComponent(a)}`,
          { signal: controller.signal },
        )
        window.clearTimeout(timeoutId)
        if (!res.ok) return null
        const data = (await res.json()) as Record<string, unknown>
        const text = typeof data?.lyrics === 'string' ? data.lyrics.trim() : ''
        return text.length > 0 ? text : null
      } catch {
        return null
      }
    }

    let bestLyrics: string | null = null
    let settled = 0
    let earlyResolved = false

    const allPromises = variants.map((v) => fetchVariant(v))

    await Promise.race([
      new Promise<void>((resolveRace) => {
        for (const p of allPromises) {
          void p.then((lyrics) => {
            settled++
            if (lyrics && !earlyResolved) {
              if (!bestLyrics || lyrics.length > bestLyrics.length) {
                bestLyrics = lyrics
              }
              if (lyrics.length >= GOOD_ENOUGH_CHARS) {
                earlyResolved = true
                resolveRace()
              }
            }
            if (settled === allPromises.length) {
              resolveRace()
            }
          })
        }
      }),
      new Promise<void>((r) => window.setTimeout(r, PREFETCH_TIMEOUT_MS)),
    ])

    if (bestLyrics) {
      cacheFoundLyrics(title, artist, bestLyrics)
    } else {
      markLyricsNotFound(title, artist)
    }
  })()
}
