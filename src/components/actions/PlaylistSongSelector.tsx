import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { IconButton, PrimaryButton } from '../ui'

export type PlaylistSong = {
  id: string
  title: string
  artist: string
  cover_url: string | null
  is_explicit: boolean
  playlist_type: 'human_jukebox' | 'karaoke' | 'setlist_by_name'
}

type PlaylistSongSelectorProps = {
  eventId: string
  userId: string | null
  playlistTypeFilter: 'human_jukebox' | 'karaoke' | 'setlist_by_name'
  queuedLibrarySongIds: Set<string>
  unavailableLibrarySongIds: Set<string>
  addingSongId: string | null
  addingRandomCount: number | null
  onAddSong: (song: PlaylistSong) => Promise<void>
  onAddRandomSongs: (candidateSongs: PlaylistSong[], requestedCount: number) => Promise<void>
}

type PlaylistMeta = {
  id: string
  name: string
  description: string | null
  playlist_type: 'human_jukebox' | 'karaoke'
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

function getEmptyPlaylistLabel(playlistTypeFilter: 'human_jukebox' | 'karaoke' | 'setlist_by_name') {
  if (playlistTypeFilter === 'karaoke') {
    return 'No karaoke playlist selected'
  }

  if (playlistTypeFilter === 'setlist_by_name') {
    return 'No named setlist selected'
  }

  return 'No Human Jukebox playlist selected'
}

function getPlaylistFallbackLabel(playlistTypeFilter: 'human_jukebox' | 'karaoke' | 'setlist_by_name') {
  if (playlistTypeFilter === 'karaoke') {
    return 'Karaoke Setlist'
  }

  if (playlistTypeFilter === 'setlist_by_name') {
    return 'Setlist by Name'
  }

  return 'Human Jukebox Setlist'
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

function PlaylistSongSelector({ eventId, userId, playlistTypeFilter, queuedLibrarySongIds, unavailableLibrarySongIds, addingSongId, addingRandomCount, onAddSong, onAddRandomSongs }: PlaylistSongSelectorProps) {
  const [playlistName, setPlaylistName] = useState(getPlaylistFallbackLabel(playlistTypeFilter))
  const [namedSetlistOptions, setNamedSetlistOptions] = useState<PlaylistMeta[]>([])
  const [selectedNamedSetlistId, setSelectedNamedSetlistId] = useState<string>('')
  const [draftSetlistName, setDraftSetlistName] = useState('')
  const [setlistBusyAction, setSetlistBusyAction] = useState<string | null>(null)
  const [setlistStatusText, setSetlistStatusText] = useState<string | null>(null)
  const [isCreateSetlistModalOpen, setIsCreateSetlistModalOpen] = useState(false)
  const [newSetlistName, setNewSetlistName] = useState('')
  const [targetSetlistIdForAdd, setTargetSetlistIdForAdd] = useState('')
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
        let availablePlaylists: PlaylistMeta[] = []

        if (playlistTypeFilter === 'setlist_by_name' && userId) {
          const { data: userPlaylists, error: userPlaylistsError } = await supabase
            .from('playlists')
            .select('id, name, description, playlist_type')
            .eq('user_id', userId)
            .order('created_at', { ascending: true })

          if (userPlaylistsError) {
            throw userPlaylistsError
          }

          availablePlaylists = ((userPlaylists ?? []) as Array<{ id: string; name: string; description?: string | null; playlist_type?: string | null }>)
            .map((playlist) => ({
              id: playlist.id,
              name: playlist.name,
              description: playlist.description ?? null,
              playlist_type: inferPlaylistType(playlist.playlist_type, playlist.name),
            }))
        } else {
          const { data: eventPlaylists, error: eventPlaylistError } = await supabase
            .from('event_playlists')
            .select('playlist_id, playlists!inner(id, name, description, playlist_type)')
            .eq('event_id', eventId)
            .order('created_at', { ascending: true })

          if (eventPlaylistError) {
            throw eventPlaylistError
          }

          availablePlaylists = ((eventPlaylists ?? []) as Array<{
            playlist_id?: string | null
            playlists?: { id: string; name: string; description?: string | null; playlist_type?: string | null } | Array<{ id: string; name: string; description?: string | null; playlist_type?: string | null }> | null
          }>)
            .map((row) => {
              const playlistData = Array.isArray(row.playlists) ? row.playlists[0] : row.playlists

              if (!playlistData) {
                return null
              }

              return {
                id: playlistData.id,
                name: playlistData.name,
                description: playlistData.description ?? null,
                playlist_type: inferPlaylistType(playlistData.playlist_type, playlistData.name),
              } as PlaylistMeta
            })
            .filter((playlist): playlist is PlaylistMeta => Boolean(playlist))
        }

        const filteredEventPlaylists = availablePlaylists.filter((playlist) => {
          if (playlistTypeFilter === 'karaoke') {
            return playlist.playlist_type === 'karaoke'
          }

          return playlist.playlist_type !== 'karaoke'
        })

        if (playlistTypeFilter === 'setlist_by_name') {
          setNamedSetlistOptions(filteredEventPlaylists)
        }

        const namedSetlistId = playlistTypeFilter === 'setlist_by_name'
          ? (selectedNamedSetlistId || filteredEventPlaylists[0]?.id || '')
          : ''

        if (playlistTypeFilter === 'setlist_by_name' && namedSetlistId !== selectedNamedSetlistId) {
          setSelectedNamedSetlistId(namedSetlistId)
        }

        const selectedPlaylistIds = playlistTypeFilter === 'setlist_by_name'
          ? (namedSetlistId ? [namedSetlistId] : [])
          : [...new Set(filteredEventPlaylists.map((playlist) => playlist.id))]

        if (selectedPlaylistIds.length === 0) {
          if (isCurrent) {
            setPlaylistName(getEmptyPlaylistLabel(playlistTypeFilter))
            setSongs([])
          }
          return
        }

        const playlistRows = filteredEventPlaylists.filter((playlist) => selectedPlaylistIds.includes(playlist.id))

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
            playlist_type: playlistTypeFilter === 'setlist_by_name' ? 'setlist_by_name' : playlistTypeFilter,
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
  }, [eventId, playlistTypeFilter, selectedNamedSetlistId, userId])

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

  const isSetlistByNameMode = playlistTypeFilter === 'setlist_by_name'
  const selectedNamedSetlist = useMemo(
    () => namedSetlistOptions.find((playlist) => playlist.id === selectedNamedSetlistId) ?? null,
    [namedSetlistOptions, selectedNamedSetlistId],
  )

  const isSongQueueBlocked = (song: PlaylistSong) => {
    if (queuedLibrarySongIds.has(song.id)) {
      return true
    }

    if (isSetlistByNameMode) {
      return false
    }

    return unavailableLibrarySongIds.has(song.id)
  }

  useEffect(() => {
    if (!isSetlistByNameMode) {
      return
    }

    setDraftSetlistName(selectedNamedSetlist?.name ?? '')
  }, [isSetlistByNameMode, selectedNamedSetlist?.name])

  useEffect(() => {
    if (!selectedSong) {
      setTargetSetlistIdForAdd('')
      return
    }

    if (!targetSetlistIdForAdd && namedSetlistOptions.length > 0) {
      setTargetSetlistIdForAdd(namedSetlistOptions[0].id)
    }
  }, [namedSetlistOptions, selectedSong, targetSetlistIdForAdd])

  const createSetlistByName = async () => {
    const trimmedName = newSetlistName.trim()

    if (!eventId || !userId || !trimmedName || setlistBusyAction) {
      return
    }

    setSetlistBusyAction('create')
    setSetlistStatusText(null)

    try {
      const { data: insertedPlaylist, error: createPlaylistError } = await supabase
        .from('playlists')
        .insert({
          user_id: userId,
          name: trimmedName,
          description: 'Created from Gig Control',
          playlist_type: 'human_jukebox',
        })
        .select('id, name, playlist_type')
        .single()

      if (createPlaylistError) {
        throw createPlaylistError
      }

      const { error: attachPlaylistError } = await supabase
        .from('event_playlists')
        .insert({
          event_id: eventId,
          playlist_id: insertedPlaylist.id,
        })

      if (attachPlaylistError) {
        throw attachPlaylistError
      }

      const createdPlaylist: PlaylistMeta = {
        id: insertedPlaylist.id,
        name: insertedPlaylist.name,
        description: null,
        playlist_type: inferPlaylistType(insertedPlaylist.playlist_type, insertedPlaylist.name),
      }

      setNamedSetlistOptions((currentPlaylists) => [...currentPlaylists, createdPlaylist])
      setSelectedNamedSetlistId(createdPlaylist.id)
      setNewSetlistName('')
      setIsCreateSetlistModalOpen(false)
      setSetlistStatusText(`Created list "${createdPlaylist.name}".`)
    } catch (error) {
      setSetlistStatusText(error instanceof Error ? error.message : 'Could not create list.')
    } finally {
      setSetlistBusyAction(null)
    }
  }

  const renameSelectedSetlist = async () => {
    const trimmedName = draftSetlistName.trim()

    if (!selectedNamedSetlist || !trimmedName || trimmedName === selectedNamedSetlist.name || setlistBusyAction) {
      return
    }

    setSetlistBusyAction('rename')
    setSetlistStatusText(null)

    try {
      const { error } = await supabase
        .from('playlists')
        .update({ name: trimmedName })
        .eq('id', selectedNamedSetlist.id)

      if (error) {
        throw error
      }

      setNamedSetlistOptions((currentPlaylists) => currentPlaylists.map((playlist) => (
        playlist.id === selectedNamedSetlist.id ? { ...playlist, name: trimmedName } : playlist
      )))
      setSetlistStatusText('List renamed.')
    } catch (error) {
      setSetlistStatusText(error instanceof Error ? error.message : 'Could not rename list.')
    } finally {
      setSetlistBusyAction(null)
    }
  }

  const deleteSelectedSetlist = async () => {
    if (!selectedNamedSetlist || setlistBusyAction) {
      return
    }

    setSetlistBusyAction('delete')
    setSetlistStatusText(null)

    try {
      const { error: detachError } = await supabase
        .from('event_playlists')
        .delete()
        .eq('event_id', eventId)
        .eq('playlist_id', selectedNamedSetlist.id)

      if (detachError) {
        throw detachError
      }

      const { error: deletePlaylistError } = await supabase
        .from('playlists')
        .delete()
        .eq('id', selectedNamedSetlist.id)

      if (deletePlaylistError) {
        throw deletePlaylistError
      }

      setNamedSetlistOptions((currentPlaylists) => {
        const nextPlaylists = currentPlaylists.filter((playlist) => playlist.id !== selectedNamedSetlist.id)
        setSelectedNamedSetlistId(nextPlaylists[0]?.id ?? '')
        return nextPlaylists
      })
      setSetlistStatusText('List deleted.')
    } catch (error) {
      setSetlistStatusText(error instanceof Error ? error.message : 'Could not delete list.')
    } finally {
      setSetlistBusyAction(null)
    }
  }

  const removeSongFromSelectedSetlist = async (songId: string) => {
    if (!selectedNamedSetlist || !songId || setlistBusyAction) {
      return
    }

    setSetlistBusyAction(`remove-song:${songId}`)
    setSetlistStatusText(null)

    try {
      const { error } = await supabase
        .from('playlist_songs')
        .delete()
        .eq('playlist_id', selectedNamedSetlist.id)
        .eq('song_id', songId)

      if (error) {
        throw error
      }

      setSongs((currentSongs) => currentSongs.filter((song) => song.id !== songId))
      setSetlistStatusText('Song removed from list.')
    } catch (error) {
      setSetlistStatusText(error instanceof Error ? error.message : 'Could not remove song.')
    } finally {
      setSetlistBusyAction(null)
    }
  }

  const addSelectedSongToNamedSetlist = async () => {
    if (!selectedSong || !targetSetlistIdForAdd || setlistBusyAction) {
      return
    }

    setSetlistBusyAction('add-to-list')
    setSetlistStatusText(null)

    try {
      const { data: existingRow, error: existingRowError } = await supabase
        .from('playlist_songs')
        .select('song_id')
        .eq('playlist_id', targetSetlistIdForAdd)
        .eq('song_id', selectedSong.id)
        .limit(1)
        .maybeSingle()

      if (existingRowError) {
        throw existingRowError
      }

      if (existingRow) {
        setSetlistStatusText('Song is already in that list.')
        return
      }

      const { data: maxPositionRow, error: maxPositionError } = await supabase
        .from('playlist_songs')
        .select('position')
        .eq('playlist_id', targetSetlistIdForAdd)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (maxPositionError) {
        throw maxPositionError
      }

      const nextPosition = (maxPositionRow?.position ?? -1) + 1

      const { error: insertError } = await supabase
        .from('playlist_songs')
        .insert({
          playlist_id: targetSetlistIdForAdd,
          song_id: selectedSong.id,
          position: nextPosition,
        })

      if (insertError) {
        throw insertError
      }

      const targetListName = namedSetlistOptions.find((playlist) => playlist.id === targetSetlistIdForAdd)?.name ?? 'selected list'
      setSetlistStatusText(`Added to ${targetListName}.`)
    } catch (error) {
      setSetlistStatusText(error instanceof Error ? error.message : 'Could not add song to list.')
    } finally {
      setSetlistBusyAction(null)
    }
  }

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
      {playlistTypeFilter === 'setlist_by_name' ? (
        <>
          <div className="hero-actions no-margin-bottom">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setIsCreateSetlistModalOpen(true)}
              disabled={!userId || Boolean(setlistBusyAction)}
            >
              Create new song list
            </button>
          </div>

          <label className="gig-song-search-field" htmlFor="gig-control-setlist-by-name-picker">
            <span className="gig-song-search-label">Select list</span>
            <select
              id="gig-control-setlist-by-name-picker"
              className="gig-song-search-input gig-song-search-select"
              value={selectedNamedSetlistId}
              onChange={(event) => {
                setSelectedNamedSetlistId(event.target.value)
                setSelectedSongId('')
              }}
              disabled={loadingSongs || namedSetlistOptions.length === 0}
            >
              <option value="">Choose a list...</option>
              {namedSetlistOptions.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>
                  {playlist.name}
                </option>
              ))}
            </select>
          </label>

          <div className="field-row no-margin-bottom">
            <label htmlFor="gig-control-setlist-rename">List name</label>
            <input
              id="gig-control-setlist-rename"
              type="text"
              value={draftSetlistName}
              onChange={(event) => setDraftSetlistName(event.target.value)}
              className="gig-song-search-input"
              placeholder="Rename selected list"
              disabled={!selectedNamedSetlist || Boolean(setlistBusyAction)}
            />
            <div className="hero-actions no-margin-bottom">
              <button
                type="button"
                className="secondary-button"
                onClick={() => { void renameSelectedSetlist() }}
                disabled={!selectedNamedSetlist || !draftSetlistName.trim() || Boolean(setlistBusyAction)}
              >
                Rename list
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => { void deleteSelectedSetlist() }}
                disabled={!selectedNamedSetlist || Boolean(setlistBusyAction)}
              >
                Delete list
              </button>
            </div>
          </div>
        </>
      ) : null}
      {setlistStatusText ? <p className="meta-badge" role="status" aria-live="polite">{setlistStatusText}</p> : null}
      <p className="gig-song-picker-hint no-margin">Pick a track, then send it straight to queue.</p>

      {isCreateSetlistModalOpen ? (
        <div className="admin-inline-confirm" role="dialog" aria-label="Create song list">
          <p className="subcopy no-margin">Create new song list</p>
          <input
            type="text"
            value={newSetlistName}
            onChange={(event) => setNewSetlistName(event.target.value)}
            className="gig-song-search-input"
            placeholder="List name"
          />
          <div className="hero-actions no-margin-bottom">
            <button
              type="button"
              className="primary-button"
              onClick={() => { void createSetlistByName() }}
              disabled={!newSetlistName.trim() || Boolean(setlistBusyAction)}
            >
              Save list
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setIsCreateSetlistModalOpen(false)
                setNewSetlistName('')
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
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
                {isSongQueueBlocked(selectedSong)
                  ? 'Unavailable because this song is already queued.'
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
            disabled={addingSongId === selectedSong.id || isSongQueueBlocked(selectedSong)}
          >
            {addingSongId === selectedSong.id
              ? 'Adding...'
              : isSongQueueBlocked(selectedSong)
              ? 'Already in queue'
              : 'Add to Queue'}
          </PrimaryButton>
        </article>
      ) : null}

      {!loadingSongs && selectedSong ? (
        <div className="field-row no-margin-bottom">
          <label htmlFor="gig-control-add-to-list">Add to list...</label>
          <select
            id="gig-control-add-to-list"
            className="gig-song-search-input"
            value={targetSetlistIdForAdd}
            onChange={(event) => setTargetSetlistIdForAdd(event.target.value)}
            disabled={namedSetlistOptions.length === 0 || Boolean(setlistBusyAction)}
          >
            <option value="">Choose a list...</option>
            {namedSetlistOptions.map((playlist) => (
              <option key={playlist.id} value={playlist.id}>{playlist.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="secondary-button"
            onClick={() => { void addSelectedSongToNamedSetlist() }}
            disabled={!targetSetlistIdForAdd || Boolean(setlistBusyAction)}
          >
            Add to list
          </button>
        </div>
      ) : null}

      {!loadingSongs && isSetlistByNameMode && songs.length > 0 ? (
        <div className="gig-add-song-list" aria-label="Songs in selected list">
          {songs.map((song) => (
            <article key={song.id} className="gig-add-song-item">
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
              <div className="hero-actions no-margin-bottom">
                <PrimaryButton
                  type="button"
                  variant="secondary"
                  className="secondary-button"
                  onClick={async () => {
                    await onAddSong(song)
                  }}
                  disabled={addingSongId === song.id || isSongQueueBlocked(song)}
                >
                  {addingSongId === song.id
                    ? 'Adding...'
                    : isSongQueueBlocked(song)
                    ? 'Already in queue'
                    : 'Add to Queue'}
                </PrimaryButton>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => { void removeSongFromSelectedSetlist(song.id) }}
                  disabled={Boolean(setlistBusyAction)}
                >
                  Remove from list
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {!loadingSongs && !selectedSong && !errorText ? (
        <p className="subcopy no-margin-bottom">
          {songs.length > 0
            ? 'No songs match your search. Try a different title or artist.'
            : `No songs found in the selected ${playlistTypeFilter === 'karaoke' ? 'karaoke' : playlistTypeFilter === 'setlist_by_name' ? 'named setlist' : 'Human Jukebox'} playlist.`}
        </p>
      ) : null}
    </section>
  )
}

export default memo(PlaylistSongSelector)
