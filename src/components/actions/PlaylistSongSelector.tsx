import { memo, useEffect, useMemo, useRef, useState } from 'react'
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
  const [selectedSongId, setSelectedSongId] = useState('')
  const [isSongPickerOpen, setIsSongPickerOpen] = useState(false)
  const [loadingSongs, setLoadingSongs] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const songPickerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let isCurrent = true

    const loadPlaylistSongs = async () => {
      setLoadingSongs(true)
      setErrorText(null)

      try {
        const { data: eventPlaylists, error: eventPlaylistError } = await supabase
          .from('event_playlists')
          .select('playlist_id')
          .eq('event_id', eventId)
          .order('created_at', { ascending: true })

        if (eventPlaylistError) {
          throw eventPlaylistError
        }

        const selectedPlaylistIds = [...new Set(
          ((eventPlaylists ?? []) as Array<{ playlist_id?: string | null }>)
            .map((row) => row.playlist_id)
            .filter((playlistId): playlistId is string => Boolean(playlistId)),
        )]

        if (selectedPlaylistIds.length === 0) {
          if (isCurrent) {
            setPlaylistName('No playlist selected')
            setSongs([])
          }
          return
        }

        const { data: playlistRows, error: playlistError } = await supabase
          .from('playlists')
          .select('name')
          .in('id', selectedPlaylistIds)

        if (playlistError) {
          throw playlistError
        }

        const { data: playlistSongs, error: playlistSongsError } = await supabase
          .from('playlist_songs')
          .select('position, library_songs!inner(id, title, artist, cover_url, is_explicit)')
          .in('playlist_id', selectedPlaylistIds)
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

        const normalizedPlaylistNames = ((playlistRows ?? []) as Array<{ name?: string | null }>)
          .map((row) => row.name?.trim())
          .filter((name): name is string => Boolean(name))

        if (normalizedPlaylistNames.length === 1) {
          setPlaylistName(normalizedPlaylistNames[0])
        } else if (normalizedPlaylistNames.length > 1) {
          setPlaylistName(`${normalizedPlaylistNames.length} playlists selected`)
        } else {
          setPlaylistName('Selected Playlist')
        }

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

  const availableSongs = useMemo(() => songs, [songs])

  useEffect(() => {
    if (availableSongs.length === 0) {
      setSelectedSongId('')
      setIsSongPickerOpen(false)
      return
    }

    const stillAvailable = availableSongs.some((song) => song.id === selectedSongId)
    if (!stillAvailable) {
      setSelectedSongId(availableSongs[0].id)
    }
  }, [availableSongs, selectedSongId])

  const selectedSong = useMemo(
    () => availableSongs.find((song) => song.id === selectedSongId) ?? null,
    [availableSongs, selectedSongId],
  )

  useEffect(() => {
    const handleDocumentPointerDown = (event: MouseEvent) => {
      if (!songPickerRef.current) {
        return
      }

      if (!songPickerRef.current.contains(event.target as Node)) {
        setIsSongPickerOpen(false)
      }
    }

    document.addEventListener('mousedown', handleDocumentPointerDown)
    return () => {
      document.removeEventListener('mousedown', handleDocumentPointerDown)
    }
  }, [])

  return (
    <section className="gig-add-song-tab-content" aria-label="Playlist songs">
      <p className="subcopy no-margin">Showing songs from: <strong>{playlistName}</strong></p>

      <div className="field-row no-margin-bottom" ref={songPickerRef}>
        <label htmlFor="gig-control-playlist-song-picker">Choose song from playlist</label>
        <button
          id="gig-control-playlist-song-picker"
          type="button"
          className="gig-song-picker-trigger"
          disabled={loadingSongs || availableSongs.length === 0}
          onClick={() => {
            setIsSongPickerOpen((open) => !open)
          }}
        >
          {selectedSong ? (
            <>
              {selectedSong.cover_url ? (
                <img src={selectedSong.cover_url} alt="" className="song-cover gig-song-picker-cover" aria-hidden="true" />
              ) : (
                <span className="song-cover song-cover-fallback gig-song-picker-cover" aria-hidden="true">♪</span>
              )}
              <span className="gig-song-picker-text">
                <span>{selectedSong.title}</span>
                <span className="artist">
                  {selectedSong.artist}
                  {selectedSong.is_explicit ? <span className="explicit-tag"> · E</span> : null}
                </span>
              </span>
            </>
          ) : (
            <span className="gig-song-picker-empty">No songs available to add</span>
          )}
          <span className="gig-song-picker-caret" aria-hidden="true">▾</span>
        </button>

        {isSongPickerOpen && availableSongs.length > 0 ? (
          <div id="gig-control-playlist-song-picker-list" className="gig-song-picker-list" aria-label="Playlist songs">
            {availableSongs.map((song) => (
              <div key={song.id}>
                <button
                  type="button"
                  className={`gig-song-picker-option${selectedSongId === song.id ? ' is-selected' : ''}`}
                  onClick={() => {
                    setSelectedSongId(song.id)
                    setIsSongPickerOpen(false)
                  }}
                >
                  {song.cover_url ? (
                    <img src={song.cover_url} alt="" className="song-cover gig-song-picker-cover" aria-hidden="true" />
                  ) : (
                    <span className="song-cover song-cover-fallback gig-song-picker-cover" aria-hidden="true">♪</span>
                  )}
                  <span className="gig-song-picker-text">
                    <span>{song.title}</span>
                    <span className="artist">
                      {song.artist}
                      {song.is_explicit ? <span className="explicit-tag"> · E</span> : null}
                    </span>
                  </span>
                  {queuedLibrarySongIds.has(song.id) ? <span className="meta-badge">Queued</span> : null}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {loadingSongs ? <p className="meta-badge" role="status" aria-live="polite">Loading playlist songs...</p> : null}
      {errorText ? <p className="error-text" role="alert">{errorText}</p> : null}

      {!loadingSongs && selectedSong ? (
        <article className="gig-add-song-item" aria-label="Selected playlist song">
          <div className="gig-add-song-main">
            {selectedSong.cover_url ? (
              <img src={selectedSong.cover_url} alt={`Cover art for ${selectedSong.title}`} className="song-cover" />
            ) : (
              <span className="song-cover song-cover-fallback" aria-hidden="true">♪</span>
            )}
            <div>
              <p className="song">{selectedSong.title}</p>
              <p className="artist">
                {selectedSong.artist}
                {selectedSong.is_explicit ? <span className="explicit-tag"> · E</span> : null}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={async () => {
              await onAddSong(selectedSong)
            }}
            disabled={addingSongId === selectedSong.id}
          >
            {addingSongId === selectedSong.id ? 'Adding...' : 'Add to Queue'}
          </button>
        </article>
      ) : null}

      {!loadingSongs && !selectedSong && !errorText ? (
        <p className="subcopy no-margin-bottom">No songs found in the selected playlist setup.</p>
      ) : null}

      {!loadingSongs && selectedSong ? (
        <p className="subcopy no-margin-bottom">
          {queuedLibrarySongIds.has(selectedSong.id)
            ? 'This song is already in queue. Adding again will create another queue entry.'
            : 'Ready to add this song to queue.'}
        </p>
      ) : null}
    </section>
  )
}

export default memo(PlaylistSongSelector)
