/**
 * Fetches album art for demo songs using the Supabase Edge Function.
 * This avoids CORS issues by routing through our backend.
 */

import { fetchSongArtwork } from '../lib/songArtwork'

export async function fetchDemoArtwork(title: string, artist: string): Promise<string | null> {
  return fetchSongArtwork(title, artist)
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
