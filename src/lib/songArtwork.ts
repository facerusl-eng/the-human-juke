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

    if (error) {
      console.warn('songArtwork: invoke failed', {
        title,
        artist,
        message: error.message,
      })
      return null
    }

    if (!data || typeof data !== 'object') {
      console.warn('songArtwork: invalid response payload', { title, artist, data })
      return null
    }

    const coverUrl = (data as { coverUrl?: unknown }).coverUrl

    if (typeof coverUrl === 'string' && coverUrl.trim()) {
      return coverUrl
    }

    return null
  } catch (error) {
    console.warn('songArtwork: unexpected invoke error', { title, artist, error })
    return null
  }
}