import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { LyricMachineView } from '../../../shared/lyric-display'
import { supabase } from '../lib/supabase'
import { useQueueStore } from '../state/queueStore'

function normalizeSongId(title: string, artist: string) {
  return `${artist.toLowerCase().replace(/\s+/g, '-')}:${title.toLowerCase().replace(/\s+/g, '-')}`
}

export default function LyricMachinePage() {
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
      album: (params.get('album') ?? '').trim() || null,
      duration: Number(params.get('duration')) || null,
      librarySongId: (params.get('librarySongId') ?? params.get('songId') ?? '').trim() || null,
    }
  }, [location.search])

  const nowPlayingSong = useMemo(() => {
    const nowPlaying = songs[0]
    if (!nowPlaying?.title) {
      return null
    }

    const songMeta = nowPlaying as { album?: string | null; duration?: number | null } | null | undefined
    const artist = (nowPlaying.artist ?? '').trim()
    return {
      id: nowPlaying.library_song_id?.trim() || nowPlaying.id,
      title: nowPlaying.title,
      artist,
      album: songMeta?.album?.trim() || null,
      duration: typeof songMeta?.duration === 'number' && Number.isFinite(songMeta.duration) ? songMeta.duration : null,
      librarySongId: nowPlaying.library_song_id?.trim() || null,
      createdByName: nowPlaying.createdByName,
      audience_sings: nowPlaying.audience_sings,
    }
  }, [songs])

  const activeSong = querySong ?? nowPlayingSong

  return <LyricMachineView supabase={supabase} activeSong={activeSong} returnToPath={location.pathname + location.search} />
}
