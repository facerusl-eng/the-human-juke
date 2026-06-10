import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { IconButton, PrimaryButton } from '../ui'

export type PlaylistSong = {
  id: string
  title: string
  artist: string
  cover_url: string | null
  is_explicit: boolean
  playlist_type: 'human_jukebox' | 'karaoke'
}

type PlaylistSongSelectorProps = {
  eventId: string
  playlistTypeFilter: 'human_jukebox' | 'karaoke'
  queuedLibrarySongIds: Set<string>
  addingSongId: string | null
  addingRandomCount: number | null
  onAddSong: (song: PlaylistSong) => Promise<void>
  onAddRandomSongs: (candidateSongs: PlaylistSong[], requestedCount: number) => Promise<void>
}

type PlaylistSongRow = {
  library_songs: {
    id: string
    title: string
    artist: string
    cover_url: string | null
    is_explicit: boolean
  } | Array<{
    id: string
    title: string
    artist: string
    cover_url: string | null
    is_explicit: boolean
  }> | null
}

function inferPlaylistType(rawType: string | null | undefined, playlistName: string | null | undefined) {
  if (rawType === 'karaoke') {
    return 'karaoke'
  }

  if ((playlistName ?? '').toLowerCase().includes('karaoke')) {
    return 'karaoke'
  }

  return 'human_jukebox'
}

function getEmptyPlaylistLabel(playlistTypeFilter: 'human_jukebox' | 'karaoke') {
  return playlistTypeFilter === 'karaoke' ? 'No karaoke playlist selected' : 'No Human Jukebox playlist selected'
}

function getPlaylistFallbackLabel(playlistTypeFilter: 'human_jukebox' | 'karaoke') {
  return playlistTypeFilter === 'karaoke' ? 'Karaoke Setlist' : 'Human Jukebox Setlist'
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

function PlaylistSongSelector({ eventId, playlistTypeFilter, queuedLibrarySongIds, addingSongId, addingRandomCount, onAddSong, onAddRandomSongs }: PlaylistSongSelectorProps) {
  const [playlistName, setPlaylistName] = useState(getPlaylistFallbackLabel(playlistTypeFilter))
  const [songs, setSongs] = useState<PlaylistSong[]>([])
  const [selectedSongId, setSelectedSongId] = useState('')
  const [isSongPickerOpen, setIsSongPickerOpen] = useState(false)
  const [isRandomMenuOpen, setIsRandomMenuOpen] = useState(false)
  const [loadingSongs, setLoadingSongs] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [songSearchQuery, setSongSearchQuery] = useState('')
  const songPickerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let isCurrent = true

    const loadPlaylistSongs = async () => {
      setLoadingSongs(true)
      setErrorText(null)

      try {
        const { data: eventPlaylists, error: eventPlaylistError } = await supabase
          .from('event_playlists')
          .select('playlist_id, playlists!inner(id, name, playlist_type)')
          .eq('event_id', eventId)
          .order('created_at', { ascending: true })

        if (eventPlaylistError) {
          throw eventPlaylistError
        }

        const filteredEventPlaylists = ((eventPlaylists ?? []) as Array<{
          playlist_id?: string | null
          playlists?: { id: string; name: string; playlist_type?: string | null } | Array<{ id: string; name: string; playlist_type?: string | null }> | null
        }>)
          .filter((row) => {
            const playlistData = Array.isArray(row.playlists) ? row.playlists[0] : row.playlists

            if (!playlistData) {
              return false
            }

            return inferPlaylistType(playlistData.playlist_type, playlistData.name) === playlistTypeFilter
          })

        const selectedPlaylistIds = [...new Set(
          filteredEventPlaylists
            .map((row) => row.playlist_id)
            .filter((playlistId): playlistId is string => Boolean(playlistId)),
        )]

        if (selectedPlaylistIds.length === 0) {
          if (isCurrent) {
            setPlaylistName(getEmptyPlaylistLabel(playlistTypeFilter))
            setSongs([])
          }
          return
        }

        const playlistRows = filteredEventPlaylists
          .map((row) => Array.isArray(row.playlists) ? row.playlists[0] : row.playlists)
          .filter((playlist): playlist is { id: string; name: string; playlist_type?: string | null } => Boolean(playlist))

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

        for (const row of (playlistSongs ?? []) as PlaylistSongRow[]) {
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
            playlist_type: playlistTypeFilter,
          })
        }

        const normalizedPlaylistNames = playlistRows
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
  }, [eventId, playlistTypeFilter])

  const availableSongs = useMemo(() => {
    const normalizedQuery = songSearchQuery.trim().toLowerCase()
    if (!normalizedQuery) {
      return songs
    }

    const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean)

    return songs.filter((song) => {
      const songTitle = song.title.toLowerCase()
      const songArtist = song.artist.toLowerCase()
      const searchableText = `${songTitle} ${songArtist}`

      return queryTokens.every((token) => searchableText.includes(token))
    })
  }, [songSearchQuery, songs])

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
        setIsRandomMenuOpen(false)
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
      <p className="gig-song-picker-hint no-margin">Pick a track, then send it straight to queue.</p>
      <label className="gig-song-search-field" htmlFor={`gig-control-song-search-${playlistTypeFilter}`}>
        <span className="gig-song-search-label">Search by song or artist</span>
        <input
          id={`gig-control-song-search-${playlistTypeFilter}`}
          type="text"
          value={songSearchQuery}
          onChange={(event) => setSongSearchQuery(event.target.value)}
          placeholder="Type title or artist name"
          className="gig-song-search-input"
        />
      </label>

      <div className="field-row no-margin-bottom" ref={songPickerRef}>
        <div className="gig-song-picker-label-row">
          <label htmlFor="gig-control-playlist-song-picker">Choose song from playlist</label>
          <div className="gig-song-picker-random-wrap">
            <IconButton
              icon={addingRandomCount ? '⏳' : '🎲'}
              label={addingRandomCount ? `Adding ${addingRandomCount} random songs` : 'Randomly add songs'}
              className="gig-random-pick-button"
              disabled={loadingSongs || availableSongs.length === 0 || Boolean(addingSongId) || Boolean(addingRandomCount)}
              onClick={() => {
                setIsRandomMenuOpen((open) => !open)
                setIsSongPickerOpen(false)
              }}
            />
            {isRandomMenuOpen ? (
              <div className="gig-random-pick-menu" aria-label="Random add options">
                <PrimaryButton
                  variant="ghost"
                  className="gig-random-pick-option"
                  onClick={() => {
                    setIsRandomMenuOpen(false)
                    void onAddRandomSongs(availableSongs, 10)
                  }}
                >
                  Add random 10
                </PrimaryButton>
                <PrimaryButton
                  variant="ghost"
                  className="gig-random-pick-option"
                  onClick={() => {
                    setIsRandomMenuOpen(false)
                    void onAddRandomSongs(availableSongs, 20)
                  }}
                >
                  Add random 20
                </PrimaryButton>
              </div>
            ) : null}
          </div>
        </div>
        <button
          id="gig-control-playlist-song-picker"
          type="button"
          className="gig-song-picker-trigger"
          disabled={loadingSongs || availableSongs.length === 0 || Boolean(addingRandomCount)}
          onClick={() => {
            setIsSongPickerOpen((open) => !open)
            setIsRandomMenuOpen(false)
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
              <button
                key={song.id}
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
            ))}
          </div>
        ) : null}
      </div>

      {loadingSongs ? <p className="meta-badge" role="status" aria-live="polite">Loading playlist songs...</p> : null}
      {errorText ? <p className="error-text" role="alert">{errorText}</p> : null}
      {!loadingSongs && !errorText ? (
        <p className="gig-song-search-results-count no-margin" aria-live="polite">
          Showing {availableSongs.length} of {songs.length} songs
        </p>
      ) : null}

      {!loadingSongs && selectedSong ? (
        <article className="gig-add-song-item gig-add-song-selected-card" aria-label="Selected playlist song">
          <div className="gig-add-song-main">
            {selectedSong.cover_url ? (
              <img src={selectedSong.cover_url} alt={`Cover art for ${selectedSong.title}`} className="song-cover" />
            ) : (
              <span className="song-cover song-cover-fallback" aria-hidden="true">♪</span>
            )}
            <div className="gig-song-picker-selected-copy">
              <p className="song">{selectedSong.title}</p>
              <p className="artist">
                {selectedSong.artist}
                {selectedSong.is_explicit ? <span className="explicit-tag"> · E</span> : null}
              </p>
              <p className="gig-song-picker-selected-hint">
                {queuedLibrarySongIds.has(selectedSong.id)
                  ? 'Already queued. Add again to create another queue entry.'
                  : 'Ready to add this track to queue.'}
              </p>
            </div>
          </div>
          <PrimaryButton
            type="button"
            variant="secondary"
            className="secondary-button"
            onClick={async () => {
              await onAddSong(selectedSong)
            }}
            disabled={addingSongId === selectedSong.id}
          >
            {addingSongId === selectedSong.id ? 'Adding...' : 'Add to Queue'}
          </PrimaryButton>
        </article>
      ) : null}

      {!loadingSongs && !selectedSong && !errorText ? (
        <p className="subcopy no-margin-bottom">
          {songs.length > 0
            ? 'No songs match your search. Try a different title or artist.'
            : `No songs found in the selected ${playlistTypeFilter === 'karaoke' ? 'karaoke' : 'Human Jukebox'} playlist.`}
        </p>
      ) : null}
    </section>
  )
}

export default memo(PlaylistSongSelector)
