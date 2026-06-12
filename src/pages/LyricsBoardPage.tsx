import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { LyricDisplay } from '../../shared/lyric-display'
import { supabase } from '../lib/supabase'
import { useQueueStore } from '../state/queueStore'

function normalizeSongId(title: string, artist: string) {
  return `${artist.toLowerCase().replace(/\s+/g, '-')}:${title.toLowerCase().replace(/\s+/g, '-')}`
}

export default function LyricsBoardPage() {
  const location = useLocation()
  const { songs } = useQueueStore()

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

  const nowPlayingSong = useMemo(() => {
    const nowPlaying = songs[0]
    if (!nowPlaying?.title) {
      return null
    }

    const artist = (nowPlaying.artist ?? '').trim()
    return {
      id: nowPlaying.library_song_id?.trim() || nowPlaying.id,
      title: nowPlaying.title,
      artist,
      createdByName: nowPlaying.createdByName,
      audience_sings: nowPlaying.audience_sings,
    }
  }, [songs])

  const activeSong = querySong ?? nowPlayingSong

  return (
    <LyricDisplay
      supabase={supabase}
      activeSong={activeSong}
      returnToPath={returnToPath}
      autoOpenOnMount={Boolean(activeSong)}
    />
  )
}
