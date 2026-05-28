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

export function lyricsPrefetchCacheKey(title: string, artist: string): string {
  return `${normalizePart(title)}::${normalizePart(artist)}`
}

function buildQueryVariants(title: string, artist: string): Array<{ t: string; a: string }> {
  const stripTitle = (v: string) =>
    v
      .replace(/\(.*?\)/g, ' ')
      .replace(/\[.*?\]/g, ' ')
      .replace(/\b(feat\.?|ft\.?)\b.*$/i, ' ')
      .replace(/\s*-\s*(official|lyrics?|video).*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const stripArtist = (v: string) =>
    v
      .replace(/\b(feat\.?|ft\.?)\b.*$/i, ' ')
      .replace(/[,&/].*$/, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const titles = Array.from(new Set([title, stripTitle(title)].filter(Boolean)))
  const artists = Array.from(new Set([artist, stripArtist(artist)].filter(Boolean)))
  const pairs: Array<{ t: string; a: string }> = []

  for (const t of titles) {
    for (const a of artists) {
      pairs.push({ t, a })
    }
  }

  return pairs
}

export function getLyricsPrefetchStatus(title: string, artist: string): PrefetchStatus | null {
  try {
    const raw = localStorage.getItem(STATUS_KEY)
    if (!raw) return null
    const map = JSON.parse(raw) as StatusMap
    return map[lyricsPrefetchCacheKey(title, artist)] ?? null
  } catch {
    return null
  }
}

export function getAutoCachedLyrics(title: string, artist: string): string | null {
  try {
    const raw = localStorage.getItem(AUTO_CACHE_KEY)
    if (!raw) return null
    const cache = JSON.parse(raw) as CacheMap
    const primaryKey = lyricsPrefetchCacheKey(title, artist)
    if (cache[primaryKey]) return cache[primaryKey]

    for (const { t, a } of buildQueryVariants(title, artist)) {
      const variantKey = lyricsPrefetchCacheKey(t, a)
      if (cache[variantKey]) return cache[variantKey]
    }

    return null
  } catch {
    return null
  }
}

// Fire-and-forget. Call after a song is successfully added to the queue.
// Skips silently if the song was already checked.
export function prefetchAndCacheLyrics(title: string, artist: string): void {
  if (typeof window === 'undefined') return
  if (getLyricsPrefetchStatus(title, artist) !== null) return

  const primaryKey = lyricsPrefetchCacheKey(title, artist)
  const variants = buildQueryVariants(title, artist)

  void (async () => {
    for (const { t, a } of variants) {
      try {
        const res = await fetch(
          `/api/lyrics-genius?song=${encodeURIComponent(t)}&artist=${encodeURIComponent(a)}`,
        )
        if (!res.ok) continue

        const data = (await res.json()) as Record<string, unknown>
        const lyricsText = typeof data?.lyrics === 'string' ? data.lyrics.trim() : ''

        if (lyricsText.length > 0) {
          try {
            const cache: CacheMap = JSON.parse(localStorage.getItem(AUTO_CACHE_KEY) ?? '{}')
            cache[primaryKey] = lyricsText
            localStorage.setItem(AUTO_CACHE_KEY, JSON.stringify(cache))
          } catch {
            // Non-blocking.
          }
          try {
            const statuses: StatusMap = JSON.parse(localStorage.getItem(STATUS_KEY) ?? '{}')
            statuses[primaryKey] = 'found'
            localStorage.setItem(STATUS_KEY, JSON.stringify(statuses))
          } catch {
            // Non-blocking.
          }
          return
        }
      } catch {
        // Continue to next variant.
      }
    }

    // All variants exhausted.
    try {
      const statuses: StatusMap = JSON.parse(localStorage.getItem(STATUS_KEY) ?? '{}')
      statuses[primaryKey] = 'not_found'
      localStorage.setItem(STATUS_KEY, JSON.stringify(statuses))
    } catch {
      // Non-blocking.
    }
  })()
}
