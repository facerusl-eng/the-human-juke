/**
 * Fetches album art for demo songs from the iTunes Search API.
 * Free, no API key required, CORS-friendly.
 */

const _cache = new Map<string, string | null>()

export async function fetchDemoArtwork(title: string, artist: string): Promise<string | null> {
  const key = `${title.toLowerCase()}::${artist.toLowerCase()}`
  if (_cache.has(key)) return _cache.get(key) ?? null

  try {
    const q = encodeURIComponent(`${title} ${artist}`)
    const res = await fetch(
      `https://itunes.apple.com/search?term=${q}&media=music&entity=song&limit=1`,
    )
    if (!res.ok) {
      _cache.set(key, null)
      return null
    }

    const json = await res.json() as { results?: Array<{ artworkUrl100?: string }> }
    const raw = json.results?.[0]?.artworkUrl100 ?? null
    // Upgrade from 100x100 to 300x300
    const url = raw ? raw.replace('100x100bb', '300x300bb') : null
    _cache.set(key, url)
    return url
  } catch {
    _cache.set(key, null)
    return null
  }
}

/**
 * Fetches artwork for a list of songs in parallel and returns a map of id → url.
 */
export async function batchFetchDemoArtwork(
  songs: Array<{ id: string; title: string; artist: string }>,
): Promise<Record<string, string>> {
  const results = await Promise.allSettled(
    songs.map(async (song) => {
      const url = await fetchDemoArtwork(song.title, song.artist)
      return { id: song.id, url }
    }),
  )

  const map: Record<string, string> = {}
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.url) {
      map[r.value.id] = r.value.url
    }
  }
  return map
}
