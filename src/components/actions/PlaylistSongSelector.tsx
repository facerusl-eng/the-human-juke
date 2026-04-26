import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

export type PlaylistSong = {
  id: string
  title: string
  artist: string
  cover_url: string | null
  is_explicit: boolean
}

type PlaylistSongSelectorProps = {
  eventId: string
  queuedLibrarySongIds: Set<string>
  addingSongId: string | null
  onAddSong: (song: PlaylistSong) => Promise<void>
}

function normalizeCoverUrl(coverUrl: string | null | undefined) {
  if (!coverUrl) {
    return null
  }

  const trimmedCoverUrl = coverUrl.trim()

  if (!trimmedCoverUrl) {
    return null
  }

  return trimmedCoverUrl.replace(/^http:\/\//i, 'https://')
}

function PlaylistSongSelector({ eventId, queuedLibrarySongIds, addingSongId, onAddSong }: PlaylistSongSelectorProps) {
  const [playlistName, setPlaylistName] = useState('Selected Playlist')
  const [songs, setSongs] = useState<PlaylistSong[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loadingSongs, setLoadingSongs] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true

    const loadPlaylistSongs = async () => {
      setLoadingSongs(true)
      setErrorText(null)

      try {
        const { data: eventPlaylistRow, error: eventPlaylistError } = await supabase
          .from('event_playlists')
          .select('playlist_id')
          .eq('event_id', eventId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (eventPlaylistError) {
          throw eventPlaylistError
        }

        const selectedPlaylistId = eventPlaylistRow?.playlist_id as string | null

        if (!selectedPlaylistId) {
          if (isCurrent) {
            setPlaylistName('No playlist selected')
            setSongs([])
          }
          return
        }

        const { data: playlistRow, error: playlistError } = await supabase
          .from('playlists')
          .select('name')
          .eq('id', selectedPlaylistId)
          .maybeSingle()

        if (playlistError) {
          throw playlistError
        }

        const { data: playlistSongs, error: playlistSongsError } = await supabase
          .from('playlist_songs')
          .select('position, library_songs!inner(id, title, artist, cover_url, is_explicit)')
          .eq('playlist_id', selectedPlaylistId)
          .order('position', { ascending: true })
          .order('created_at', { ascending: true })

        if (playlistSongsError) {
          throw playlistSongsError
        }

        if (!isCurrent) {
          return
        }

        const dedupedSongs = new Map<string, PlaylistSong>()

        for (const row of (playlistSongs ?? []) as Array<{ library_songs: PlaylistSong | PlaylistSong[] | null }>) {
          const librarySong = Array.isArray(row.library_songs) ? row.library_songs[0] : row.library_songs

          if (!librarySong || dedupedSongs.has(librarySong.id)) {
            continue
          }

          dedupedSongs.set(librarySong.id, {
            id: librarySong.id,
            title: librarySong.title,
            artist: librarySong.artist,
            cover_url: normalizeCoverUrl(librarySong.cover_url),
            is_explicit: librarySong.is_explicit,
          })
        }

        setPlaylistName((playlistRow?.name as string | null)?.trim() || 'Selected Playlist')
        setSongs([...dedupedSongs.values()])
      } catch (error) {
        console.warn('PlaylistSongSelector: failed to load selected playlist songs', error)
        if (isCurrent) {
          setSongs([])
          setErrorText(error instanceof Error ? error.message : 'Could not load playlist songs.')
        }
      } finally {
        if (isCurrent) {
          setLoadingSongs(false)
        }
      }
    }

    void loadPlaylistSongs()

    return () => {
      isCurrent = false
    }
  }, [eventId])

  const filteredSongs = useMemo(() => {
    const normalizedSearchQuery = searchQuery.trim().toLowerCase()
    const nonQueuedSongs = songs.filter((song) => !queuedLibrarySongIds.has(song.id))

    if (!normalizedSearchQuery) {
      return nonQueuedSongs
    }

    return nonQueuedSongs.filter((song) => (
      `${song.title} ${song.artist}`.toLowerCase().includes(normalizedSearchQuery)
    ))
  }, [songs, searchQuery, queuedLibrarySongIds])

  return (
    <section className="gig-add-song-tab-content" aria-label="Playlist songs">
      <p className="subcopy no-margin">Showing songs from: <strong>{playlistName}</strong></p>

      <div className="field-row no-margin-bottom">
        <label htmlFor="gig-control-playlist-song-search">Search playlist songs</label>
        <input
          id="gig-control-playlist-song-search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search title or artist"
        />
      </div>

      {loadingSongs ? <p className="meta-badge" role="status" aria-live="polite">Loading playlist songs...</p> : null}
      {errorText ? <p className="error-text" role="alert">{errorText}</p> : null}

      {!loadingSongs ? (
        <ul className="gig-add-song-list" aria-label="Songs in selected playlist">
          {filteredSongs.map((song) => (
            <li key={song.id} className="gig-add-song-item">
              <div className="gig-add-song-main">
                {song.cover_url ? (
                  <img src={song.cover_url} alt={`Cover art for ${song.title}`} className="song-cover" />
                ) : (
                  <span className="song-cover song-cover-fallback" aria-hidden="true">♪</span>
                )}
                <div>
                  <p className="song">{song.title}</p>
                  <p className="artist">
                    {song.artist}
                    {song.is_explicit ? <span className="explicit-tag"> · E</span> : null}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={async () => {
                  await onAddSong(song)
                }}
                disabled={addingSongId === song.id}
              >
                {addingSongId === song.id ? 'Adding...' : 'Add to Queue'}
              </button>
            </li>
          ))}
          {filteredSongs.length === 0 ? (
            <li className="subcopy no-margin-bottom">No songs match this playlist search.</li>
          ) : null}
        </ul>
      ) : null}
    </section>
  )
}

export default PlaylistSongSelector
