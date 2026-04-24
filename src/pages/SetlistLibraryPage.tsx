import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { DEFAULT_SETLIST_SONGS } from '../lib/defaultSetlist'
import { fetchSongArtwork } from '../lib/songArtwork'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../state/authStore'
import { useQueueStore } from '../state/queueStore'

type Playlist = {
  id: string
  name: string
  description: string | null
  created_at: string
}

type PlaylistSongRecord = {
  id: string
  title: string
  artist: string
  cover_url: string | null
  is_explicit: boolean
  created_at: string
  position: number
}

type PlaylistSongRow = {
  position: number
  library_songs: PlaylistSongRecord | PlaylistSongRecord[] | null
}

type CountRow = {
  playlist_id: string
}

type ImportedSongDraft = {
  title: string
  artist: string
  isExplicit: boolean
}

function sanitizeCell(value: string) {
  return value.trim().replace(/^"|"$/g, '').trim()
}

function parseDelimitedLine(line: string, delimiter: string) {
  return line.split(delimiter).map((part) => sanitizeCell(part))
}

function detectDelimiter(line: string) {
  const delimiters = [',', ';', '\t', '|']
  const scored = delimiters
    .map((delimiter) => ({ delimiter, count: line.split(delimiter).length - 1 }))
    .sort((left, right) => right.count - left.count)

  return scored[0]?.count > 0 ? scored[0].delimiter : null
}

function normalizeLine(line: string) {
  return line
    .trim()
    .replace(/^\d+[\.)\-]\s*/, '')
    .replace(/^[\u2022*\-]\s*/, '')
    .trim()
}

function parseSongLine(line: string): ImportedSongDraft | null {
  const normalized = normalizeLine(line)

  if (!normalized) {
    return null
  }

  const bySeparatorMatch = normalized.match(/^(.+?)\s+by\s+(.+)$/i)
  if (bySeparatorMatch) {
    return {
      title: bySeparatorMatch[1].trim(),
      artist: bySeparatorMatch[2].trim(),
      isExplicit: /\bexplicit\b/i.test(normalized),
    }
  }

  const dashParts = normalized.split(/\s[-\u2013\u2014]\s/)
  if (dashParts.length >= 2) {
    const title = dashParts[0].trim()
    const artist = dashParts.slice(1).join(' - ').trim()

    if (title && artist) {
      return {
        title,
        artist,
        isExplicit: /\bexplicit\b/i.test(normalized),
      }
    }
  }

  return null
}

function parseSongsFromJson(text: string) {
  const parsed = JSON.parse(text)
  const rows = Array.isArray(parsed) ? parsed : [parsed]

  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') {
      return []
    }

    const source = row as Record<string, unknown>
    const title = String(source.title ?? source.song ?? source.track ?? '').trim()
    const artist = String(source.artist ?? source.performer ?? source.band ?? '').trim()
    const explicitValue = source.explicit ?? source.is_explicit

    if (!title || !artist) {
      return []
    }

    return [{
      title,
      artist,
      isExplicit: Boolean(explicitValue),
    }]
  })
}

function parseSongsFromText(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (!lines.length) {
    return [] as ImportedSongDraft[]
  }

  const delimiter = detectDelimiter(lines[0])

  if (delimiter) {
    const firstRow = parseDelimitedLine(lines[0], delimiter).map((part) => part.toLowerCase())
    const titleColumnIndex = firstRow.findIndex((column) => /^(title|song|track)$/.test(column))
    const artistColumnIndex = firstRow.findIndex((column) => /^(artist|performer|band)$/.test(column))
    const explicitColumnIndex = firstRow.findIndex((column) => /^(explicit|is_explicit)$/.test(column))
    const hasHeader = titleColumnIndex !== -1 && artistColumnIndex !== -1
    const rowStartIndex = hasHeader ? 1 : 0

    const parsedRows = lines.slice(rowStartIndex).flatMap((line) => {
      const parts = parseDelimitedLine(line, delimiter)

      if (!parts.length) {
        return []
      }

      const title = hasHeader
        ? (parts[titleColumnIndex] ?? '').trim()
        : (parts[0] ?? '').trim()
      const artist = hasHeader
        ? (parts[artistColumnIndex] ?? '').trim()
        : (parts[1] ?? '').trim()

      if (!title || !artist) {
        return []
      }

      const explicitSource = hasHeader && explicitColumnIndex !== -1
        ? (parts[explicitColumnIndex] ?? '')
        : ''

      return [{
        title,
        artist,
        isExplicit: /^(true|1|yes|explicit)$/i.test(String(explicitSource).trim()),
      }]
    })

    if (parsedRows.length > 0) {
      return parsedRows
    }
  }

  return lines.flatMap((line) => {
    const parsedSong = parseSongLine(line)
    return parsedSong ? [parsedSong] : []
  })
}

function parseSongsFromFile(fileName: string, text: string) {
  const normalizedFileName = fileName.trim().toLowerCase()

  if (normalizedFileName.endsWith('.json')) {
    return parseSongsFromJson(text)
  }

  return parseSongsFromText(text)
}

function dedupeSongs(songs: ImportedSongDraft[]) {
  const seen = new Set<string>()

  return songs.filter((song) => {
    const key = `${song.title.toLowerCase()}::${song.artist.toLowerCase()}`

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function SetlistLibraryPage() {
  const { user } = useAuthStore()
  const { addSong, event } = useQueueStore()
  const userId = user?.id ?? null
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [playlistCounts, setPlaylistCounts] = useState<Record<string, number>>({})
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null)
  const [songs, setSongs] = useState<PlaylistSongRecord[]>([])
  const [totalSongCount, setTotalSongCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [playlistName, setPlaylistName] = useState('')
  const [playlistDescription, setPlaylistDescription] = useState('')
  const [draftPlaylistName, setDraftPlaylistName] = useState('')
  const [songTitle, setSongTitle] = useState('')
  const [artistName, setArtistName] = useState('')
  const [isExplicit, setIsExplicit] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [successText, setSuccessText] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const deferredSearchText = useDeferredValue(searchText)

  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null,
    [playlists, selectedPlaylistId],
  )

  const filteredSongs = useMemo(() => {
    const normalizedQuery = deferredSearchText.trim().toLowerCase()

    if (!normalizedQuery) {
      return songs
    }

    return songs.filter((song) => `${song.title} ${song.artist}`.toLowerCase().includes(normalizedQuery))
  }, [deferredSearchText, songs])

  useEffect(() => {
    if (!userId) {
      return
    }

    let isCancelled = false

    const loadSidebarData = async () => {
      setLoading(true)
      setErrorText(null)

      try {
        const { data: existingPlaylists, error: existingPlaylistsError } = await supabase
          .from('playlists')
          .select('id')
          .eq('user_id', userId)
          .limit(1)

        if (existingPlaylistsError) {
          throw existingPlaylistsError
        }

        if (!existingPlaylists?.length) {
          const { data: playlist, error: playlistError } = await supabase
            .from('playlists')
            .insert({
              user_id: userId,
              name: 'The Human Jukebox',
              description: 'Your core room-friendly catalog with acoustic staples, singalongs, and closers.',
            })
            .select('id')
            .single()

          if (playlistError) {
            throw playlistError
          }

          const seedBaseTime = Date.now()
          const songRows = DEFAULT_SETLIST_SONGS.map((song, index) => ({
            user_id: userId,
            title: song.title,
            artist: song.artist,
            is_explicit: Boolean(song.isExplicit),
            created_at: new Date(seedBaseTime + index).toISOString(),
          }))

          const { data: insertedSongs, error: insertedSongsError } = await supabase
            .from('library_songs')
            .insert(songRows)
            .select('id, created_at')

          if (insertedSongsError) {
            throw insertedSongsError
          }

          const playlistSongs = [...(insertedSongs ?? [])]
            .sort((left, right) => left.created_at.localeCompare(right.created_at))
            .map((song, index) => ({
              playlist_id: playlist.id,
              song_id: song.id,
              position: index,
            }))

          const { error: playlistSongsError } = await supabase
            .from('playlist_songs')
            .insert(playlistSongs)

          if (playlistSongsError) {
            throw playlistSongsError
          }
        }

        const [playlistsResult, playlistCountsResult, totalSongsResult] = await Promise.all([
          supabase
            .from('playlists')
            .select('id, name, description, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: true }),
          supabase
            .from('playlist_songs')
            .select('playlist_id'),
          supabase
            .from('library_songs')
            .select('id', { count: 'exact' })
            .eq('user_id', userId),
        ])

        if (playlistsResult.error) {
          throw playlistsResult.error
        }

        if (playlistCountsResult.error) {
          throw playlistCountsResult.error
        }

        if (totalSongsResult.error) {
          throw totalSongsResult.error
        }

        if (isCancelled) {
          return
        }

        const nextPlaylists = (playlistsResult.data ?? []) as Playlist[]
        const nextPlaylistCounts = ((playlistCountsResult.data ?? []) as CountRow[]).reduce<Record<string, number>>(
          (countMap, row) => {
            countMap[row.playlist_id] = (countMap[row.playlist_id] ?? 0) + 1
            return countMap
          },
          {},
        )

        setPlaylists(nextPlaylists)
        setPlaylistCounts(nextPlaylistCounts)
        setTotalSongCount(totalSongsResult.count ?? 0)
        setSelectedPlaylistId((currentPlaylistId) => {
          const nextSelectedPlaylistId = currentPlaylistId && nextPlaylists.some((playlist) => playlist.id === currentPlaylistId)
            ? currentPlaylistId
            : nextPlaylists[0]?.id ?? null

          setDraftPlaylistName(nextPlaylists.find((playlist) => playlist.id === nextSelectedPlaylistId)?.name ?? '')
          return nextSelectedPlaylistId
        })
      } catch (error) {
        if (!isCancelled) {
          setErrorText(error instanceof Error ? error.message : 'Unable to load the setlist library.')
        }
      } finally {
        if (!isCancelled) {
          setLoading(false)
        }
      }
    }

    void loadSidebarData()

    return () => {
      isCancelled = true
    }
  }, [userId])

  useEffect(() => {
    if (!selectedPlaylistId) {
      return
    }

    let isCancelled = false

    const loadSongs = async () => {
      setErrorText(null)

      const { data, error } = await supabase
        .from('playlist_songs')
        .select('position, library_songs!inner(id, title, artist, cover_url, is_explicit, created_at)')
        .eq('playlist_id', selectedPlaylistId)
        .order('position', { ascending: true })

      if (error) {
        if (!isCancelled) {
          setErrorText(error.message)
        }
        return
      }

      if (isCancelled) {
        return
      }

      const nextSongs = ((data ?? []) as PlaylistSongRow[]).flatMap((row) => {
        const librarySong = Array.isArray(row.library_songs) ? row.library_songs[0] : row.library_songs

        return librarySong
          ? [{ ...librarySong, position: row.position }]
          : []
      })

      setSongs(nextSongs)
    }

    void loadSongs()

    return () => {
      isCancelled = true
    }
  }, [selectedPlaylistId])

  useEffect(() => {
    const songsMissingArtwork = filteredSongs.filter((song) => !song.cover_url).slice(0, 8)

    if (!songsMissingArtwork.length) {
      return
    }

    let isCancelled = false

    const hydrateArtwork = async () => {
      for (const song of songsMissingArtwork) {
        const coverUrl = await fetchSongArtwork(song.title, song.artist)

        if (!coverUrl || isCancelled) {
          continue
        }

        const { error } = await supabase
          .from('library_songs')
          .update({ cover_url: coverUrl })
          .eq('id', song.id)

        if (!error && !isCancelled) {
          setSongs((currentSongs) => currentSongs.map((currentSong) => (
            currentSong.id === song.id ? { ...currentSong, cover_url: coverUrl } : currentSong
          )))
        }
      }
    }

    void hydrateArtwork()

    return () => {
      isCancelled = true
    }
  }, [filteredSongs])

  const onCreatePlaylist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!userId || !playlistName.trim()) {
      return
    }

    setBusyAction('create-playlist')
    setErrorText(null)
    setSuccessText(null)

    const { data, error } = await supabase
      .from('playlists')
      .insert({
        user_id: userId,
        name: playlistName.trim(),
        description: playlistDescription.trim() || null,
      })
      .select('id, name, description, created_at')
      .single()

    setBusyAction(null)

    if (error) {
      setErrorText(error.message)
      return
    }

    setPlaylists((currentPlaylists) => [...currentPlaylists, data as Playlist])
    setPlaylistCounts((currentCounts) => ({ ...currentCounts, [data.id]: 0 }))
    setSelectedPlaylistId(data.id)
    setDraftPlaylistName(data.name)
    setPlaylistName('')
    setPlaylistDescription('')
  }

  const onRenamePlaylist = async () => {
    if (!selectedPlaylist || !draftPlaylistName.trim()) {
      return
    }

    setBusyAction('rename-playlist')
    setErrorText(null)
    setSuccessText(null)

    const { error } = await supabase
      .from('playlists')
      .update({ name: draftPlaylistName.trim() })
      .eq('id', selectedPlaylist.id)

    setBusyAction(null)

    if (error) {
      setErrorText(error.message)
      return
    }

    setPlaylists((currentPlaylists) => currentPlaylists.map((playlist) => (
      playlist.id === selectedPlaylist.id
        ? { ...playlist, name: draftPlaylistName.trim() }
        : playlist
    )))
  }

  const onDeletePlaylist = async () => {
    if (!selectedPlaylist || playlists.length <= 1) {
      return
    }

    const confirmed = window.confirm(`Delete playlist "${selectedPlaylist.name}"?`)

    if (!confirmed) {
      return
    }

    setBusyAction('delete-playlist')
    setErrorText(null)
    setSuccessText(null)

    const { error } = await supabase
      .from('playlists')
      .delete()
      .eq('id', selectedPlaylist.id)

    setBusyAction(null)

    if (error) {
      setErrorText(error.message)
      return
    }

    const remainingPlaylists = playlists.filter((playlist) => playlist.id !== selectedPlaylist.id)
    setPlaylists(remainingPlaylists)
    setSelectedPlaylistId(remainingPlaylists[0]?.id ?? null)
    setDraftPlaylistName(remainingPlaylists[0]?.name ?? '')
    setSongs([])
    setPlaylistCounts((currentCounts) => {
      const nextCounts = { ...currentCounts }
      delete nextCounts[selectedPlaylist.id]
      return nextCounts
    })
  }

  const onAddSongToPlaylist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!user || !selectedPlaylistId || !songTitle.trim() || !artistName.trim()) {
      return
    }

    setBusyAction('add-song')
    setErrorText(null)
    setSuccessText(null)

    const coverUrl = await fetchSongArtwork(songTitle.trim(), artistName.trim())

    const { data: insertedSong, error: insertedSongError } = await supabase
      .from('library_songs')
      .insert({
        user_id: user.id,
        title: songTitle.trim(),
        artist: artistName.trim(),
        cover_url: coverUrl,
        is_explicit: isExplicit,
      })
      .select('id, title, artist, cover_url, is_explicit, created_at')
      .single()

    if (insertedSongError) {
      setBusyAction(null)
      setErrorText(insertedSongError.message)
      return
    }

    const { error: linkError } = await supabase
      .from('playlist_songs')
      .insert({
        playlist_id: selectedPlaylistId,
        song_id: insertedSong.id,
        position: songs.length,
      })

    setBusyAction(null)

    if (linkError) {
      setErrorText(linkError.message)
      return
    }

    setSongs((currentSongs) => [...currentSongs, { ...(insertedSong as PlaylistSongRecord), position: currentSongs.length }])
    setPlaylistCounts((currentCounts) => ({
      ...currentCounts,
      [selectedPlaylistId]: (currentCounts[selectedPlaylistId] ?? 0) + 1,
    }))
    setTotalSongCount((currentCount) => currentCount + 1)
    setSongTitle('')
    setArtistName('')
    setIsExplicit(false)
  }

  const onRemoveSongFromPlaylist = async (songId: string) => {
    if (!selectedPlaylistId) {
      return
    }

    setBusyAction(`remove-song-${songId}`)
    setErrorText(null)
    setSuccessText(null)

    const { error } = await supabase
      .from('playlist_songs')
      .delete()
      .eq('playlist_id', selectedPlaylistId)
      .eq('song_id', songId)

    setBusyAction(null)

    if (error) {
      setErrorText(error.message)
      return
    }

    setSongs((currentSongs) => currentSongs.filter((song) => song.id !== songId))
    setPlaylistCounts((currentCounts) => ({
      ...currentCounts,
      [selectedPlaylistId]: Math.max((currentCounts[selectedPlaylistId] ?? 1) - 1, 0),
    }))
  }

  const onAddSongToLiveQueue = async (song: PlaylistSongRecord) => {
    setBusyAction(`queue-song-${song.id}`)
    setErrorText(null)
    setSuccessText(null)

    try {
      await addSong(song.title, song.artist, song.is_explicit, {
        coverUrl: song.cover_url,
        librarySongId: song.id,
        bypassEventRules: true,
      })
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to queue this song.')
    } finally {
      setBusyAction(null)
    }
  }

  const onImportPlaylistFile = async (changeEvent: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = changeEvent.target.files?.[0]
    changeEvent.target.value = ''

    if (!selectedFile) {
      return
    }

    if (!userId || !selectedPlaylistId) {
      setErrorText('Select a playlist first, then import your file.')
      return
    }

    setBusyAction('import-file')
    setErrorText(null)
    setSuccessText(null)

    try {
      const fileText = await selectedFile.text()
      const parsedSongs = dedupeSongs(parseSongsFromFile(selectedFile.name, fileText))

      if (!parsedSongs.length) {
        throw new Error('No songs found in this file. Use lines like "Song - Artist" or a CSV with title/artist columns.')
      }

      const { data: insertedSongs, error: insertedSongsError } = await supabase
        .from('library_songs')
        .insert(
          parsedSongs.map((song) => ({
            user_id: userId,
            title: song.title,
            artist: song.artist,
            is_explicit: song.isExplicit,
          })),
        )
        .select('id, title, artist, cover_url, is_explicit, created_at')

      if (insertedSongsError) {
        throw insertedSongsError
      }

      const nextSongsToAdd = (insertedSongs ?? []) as PlaylistSongRecord[]
      const positionStart = songs.length

      const { error: addToPlaylistError } = await supabase
        .from('playlist_songs')
        .insert(
          nextSongsToAdd.map((song, index) => ({
            playlist_id: selectedPlaylistId,
            song_id: song.id,
            position: positionStart + index,
          })),
        )

      if (addToPlaylistError) {
        throw addToPlaylistError
      }

      setSongs((currentSongs) => [
        ...currentSongs,
        ...nextSongsToAdd.map((song, index) => ({
          ...song,
          position: positionStart + index,
        })),
      ])
      setPlaylistCounts((currentCounts) => ({
        ...currentCounts,
        [selectedPlaylistId]: (currentCounts[selectedPlaylistId] ?? 0) + nextSongsToAdd.length,
      }))
      setTotalSongCount((currentCount) => currentCount + nextSongsToAdd.length)
      setSuccessText(`Imported ${nextSongsToAdd.length} song${nextSongsToAdd.length === 1 ? '' : 's'} from ${selectedFile.name}.`)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to import songs from this file.')
    } finally {
      setBusyAction(null)
    }
  }

  if (loading) {
    return <section className="admin-shell"><section className="queue-panel">Loading setlist library...</section></section>
  }

  return (
    <section className="admin-shell setlist-shell" aria-label="Setlist library">
      <section className="hero-card admin-card setlist-hero">
        <div className="setlist-hero-copy">
          <p className="eyebrow">Song Library</p>
          <h1>Setlist Library</h1>
          <p className="subcopy">
            Keep your crowd-ready catalog in one place. Search the library, review staples,
            and shape the core playlist you want to build from at every gig.
          </p>
        </div>

        <div className="setlist-kpis" aria-label="Setlist library stats">
          <div>
            <strong>{totalSongCount}</strong>
            <span>songs</span>
          </div>
          <div>
            <strong>{playlists.length}</strong>
            <span>{playlists.length === 1 ? 'playlist' : 'playlists'}</span>
          </div>
          <div>
            <strong>{filteredSongs.length}</strong>
            <span>matching</span>
          </div>
        </div>
      </section>

      <section className="setlist-layout">
        <aside className="queue-panel setlist-sidebar">
          <div className="panel-head">
            <h2>Playlists</h2>
            <span className="meta-badge">{playlists.length} total</span>
          </div>

          <form className="setlist-playlist-form" onSubmit={onCreatePlaylist}>
            <input
              type="text"
              placeholder="New playlist name"
              value={playlistName}
              onChange={(event) => setPlaylistName(event.target.value)}
            />
            <textarea
              placeholder="Optional description"
              value={playlistDescription}
              onChange={(event) => setPlaylistDescription(event.target.value)}
              rows={2}
            />
            <button type="submit" className="secondary-button setlist-playlist-action" disabled={busyAction === 'create-playlist'}>
              {busyAction === 'create-playlist' ? 'Creating...' : 'New Playlist'}
            </button>
          </form>

          <div className="setlist-playlist-list" aria-label="Playlists">
            {playlists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                className={`setlist-playlist-card ${playlist.id === selectedPlaylistId ? 'is-selected' : ''}`}
                onClick={() => {
                  setSelectedPlaylistId(playlist.id)
                  setDraftPlaylistName(playlist.name)
                }}
              >
                <p className="eyebrow">Playlist</p>
                <h3>{playlist.name}</h3>
                <p className="subcopy no-margin-bottom">{playlist.description ?? 'No description yet.'}</p>
                <div className="setlist-playlist-meta">
                  <span className="meta-badge">{playlistCounts[playlist.id] ?? 0} songs</span>
                  {playlist.id === selectedPlaylistId ? <span className="meta-badge">Selected</span> : null}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="queue-panel setlist-library-panel">
          <div className="panel-head setlist-panel-head">
            <div>
              <p className="eyebrow">Library</p>
              <h2>{selectedPlaylist?.name ?? 'Setlist Library'}</h2>
              <p className="subcopy no-margin-bottom">
                {selectedPlaylist?.description ?? 'Build and manage the songs you want ready for live requests.'}
              </p>
            </div>

            <label className="setlist-search" htmlFor="setlist-search">
              <span>Search songs or artists</span>
              <input
                id="setlist-search"
                type="search"
                placeholder={`Search ${playlistCounts[selectedPlaylistId ?? ''] ?? filteredSongs.length} songs`}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
              />
            </label>
          </div>

          <div className="setlist-toolbar">
            <div className="setlist-rename-controls">
              <input
                type="text"
                value={draftPlaylistName}
                onChange={(event) => setDraftPlaylistName(event.target.value)}
                aria-label="Rename selected playlist"
              />
              <button type="button" className="secondary-button" onClick={onRenamePlaylist} disabled={!selectedPlaylist || busyAction === 'rename-playlist'}>
                {busyAction === 'rename-playlist' ? 'Saving...' : 'Rename'}
              </button>
              <button type="button" className="ghost-button" onClick={onDeletePlaylist} disabled={playlists.length <= 1 || busyAction === 'delete-playlist'}>
                {busyAction === 'delete-playlist' ? 'Deleting...' : 'Delete'}
              </button>
            </div>
            <span className="meta-badge">{event ? `Queue to ${event.name}` : 'Create a gig to queue songs'}</span>
          </div>

          <form className="setlist-song-form" onSubmit={onAddSongToPlaylist}>
            <input
              type="text"
              placeholder="Song title"
              value={songTitle}
              onChange={(event) => setSongTitle(event.target.value)}
            />
            <input
              type="text"
              placeholder="Artist"
              value={artistName}
              onChange={(event) => setArtistName(event.target.value)}
            />
            <label className="checkbox-row setlist-checkbox-row" htmlFor="setlist-explicit">
              <input
                id="setlist-explicit"
                type="checkbox"
                checked={isExplicit}
                onChange={(event) => setIsExplicit(event.target.checked)}
              />
              Explicit
            </label>
            <button type="submit" className="primary-button" disabled={!selectedPlaylistId || busyAction === 'add-song'}>
              {busyAction === 'add-song' ? 'Adding...' : 'Add Song'}
            </button>
          </form>

          <div className="setlist-import-block">
            <label className="setlist-search" htmlFor="setlist-import-file">
              <span>Import song list file</span>
              <input
                id="setlist-import-file"
                type="file"
                accept=".txt,.csv,.tsv,.json,.md,.m3u,.m3u8,.rtf"
                onChange={onImportPlaylistFile}
                disabled={!selectedPlaylistId || busyAction === 'import-file'}
              />
            </label>
            <p className="subcopy no-margin-bottom">
              Best support: CSV/TSV with title+artist columns, JSON arrays, or text lines like "Song - Artist".
            </p>
          </div>

          <div className="setlist-table-wrap">
            <table className="setlist-table">
              <thead>
                <tr>
                  <th scope="col">Cover</th>
                  <th scope="col">#</th>
                  <th scope="col">Title</th>
                  <th scope="col">Artist</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSongs.map((song, index) => (
                  <tr key={song.id}>
                    <td>
                      {song.cover_url ? (
                        <img src={song.cover_url} alt={`Cover art for ${song.title}`} className="setlist-cover" />
                      ) : (
                        <div className="setlist-cover setlist-cover-placeholder" aria-hidden="true">♪</div>
                      )}
                    </td>
                    <td>{index + 1}</td>
                    <td>{song.title}</td>
                    <td>{song.artist}</td>
                    <td>
                      <span className="setlist-status">{song.is_explicit ? 'Explicit' : 'Ready'}</span>
                    </td>
                    <td>
                      <div className="setlist-row-actions">
                        <button
                          type="button"
                          className="vote-button"
                          onClick={async () => { await onAddSongToLiveQueue(song) }}
                          disabled={!event || busyAction === `queue-song-${song.id}`}
                        >
                          {busyAction === `queue-song-${song.id}` ? 'Queueing...' : 'Add to Queue'}
                        </button>
                        <button
                          type="button"
                          className="vote-button danger-button"
                          onClick={async () => { await onRemoveSongFromPlaylist(song.id) }}
                          disabled={busyAction === `remove-song-${song.id}`}
                        >
                          {busyAction === `remove-song-${song.id}` ? 'Removing...' : 'Remove'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {errorText ? <p className="error-text no-margin">{errorText}</p> : null}
          {successText ? <p className="subcopy no-margin-bottom">{successText}</p> : null}

          {filteredSongs.length === 0 ? (
            <p className="subcopy setlist-empty">No songs match this search.</p>
          ) : null}
        </section>
      </section>
    </section>
  )
}

export default SetlistLibraryPage