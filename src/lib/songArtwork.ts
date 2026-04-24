import { supabase } from './supabase'

export async function fetchSongArtwork(title: string, artist: string) {
  if (typeof document === 'undefined') {
    return null
  }

  try {
    const { data, error } = await supabase.functions.invoke('song-artwork', {
      body: {
        title,
        artist,
      },
    })

    if (!error) {
      if (data && typeof data.coverUrl === 'string' && data.coverUrl.trim()) {
        return data.coverUrl
      }

      return null
    }

    return null
  } catch {
    return null
  }
}