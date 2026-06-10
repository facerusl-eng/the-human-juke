import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { LyricDisplay } from '../../shared/lyric-display'
import { supabase } from '../lib/supabase'

function normalizeSongId(title: string, artist: string) {
  return `${artist.toLowerCase().replace(/\s+/g, '-')}:${title.toLowerCase().replace(/\s+/g, '-')}`
}

export default function JamzoneLyricsPage() {
  const location = useLocation()

  const querySong = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const title = (params.get('title') ?? '').trim()
    const artist = (params.get('artist') ?? '').trim()

    if (!title || !artist) {
      return null
    }

    return {
      id: (params.get('songId') ?? '').trim() || normalizeSongId(title, artist),
      title,
      artist,
    }
  }, [location.search])

  const returnToPath = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const returnTo = (params.get('returnTo') ?? '').trim()
    return returnTo || '/admin/gig-control'
  }, [location.search])

  return (
    <LyricDisplay
      supabase={supabase}
      activeSong={querySong}
      returnToPath={returnToPath}
      autoOpenOnMount={Boolean(querySong)}
    />
  )
}
