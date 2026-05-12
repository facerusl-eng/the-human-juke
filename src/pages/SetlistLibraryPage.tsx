import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
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
  playlist_type: 'human_jukebox' | 'karaoke'
}

type PlaylistType = 'human_jukebox' | 'karaoke'
type CreatePlaylistType = PlaylistType | 'harald_live'

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

type ImportedSongWithArtwork = ImportedSongDraft & {
  coverUrl: string | null
}

const MAX_COVER_IMAGE_BYTES = 3 * 1024 * 1024
const IMPORT_ARTWORK_CONCURRENCY = 4

function isMissingPlaylistTypeColumnError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const normalizedError = error as {
    code?: unknown
    message?: unknown
    details?: unknown
    hint?: unknown
  }

  const code = typeof normalizedError.code === 'string' ? normalizedError.code : ''
  const text = [normalizedError.message, normalizedError.details, normalizedError.hint]
    .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''))
    .join(' ')

  return (code === '42703' || code === 'PGRST204') && text.includes('playlist_type')
}

function inferPlaylistType(rawType: string | null | undefined, playlistName: string | null | undefined): PlaylistType {
  if (rawType === 'karaoke') {
    return 'karaoke'
  }

  if ((playlistName ?? '').toLowerCase().includes('karaoke')) {
    return 'karaoke'
  }

  return 'human_jukebox'
}

function toPersistedPlaylistType(playlistType: CreatePlaylistType): 'human_jukebox' | 'karaoke' {
  return playlistType === 'harald_live' ? 'human_jukebox' : playlistType
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Could not process that image. Try another file.'))
    }

    reader.onerror = () => {
      reject(new Error('Could not read that image file.'))
    }

    reader.readAsDataURL(file)
  })
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
    .replace(/^\d+[.)-]\s*/, '')
    .replace(/^[\u2022*-]\s*/, '')
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

async function resolveArtworkForImportedSongs(songs: ImportedSongDraft[]): Promise<ImportedSongWithArtwork[]> {
  const songsWithArtwork: ImportedSongWithArtwork[] = songs.map((song) => ({
    ...song,
    coverUrl: null,
  }))

  let nextSongIndex = 0

  // Keep a small concurrency window to avoid hammering the artwork provider.
  const workers = Array.from({ length: Math.min(IMPORT_ARTWORK_CONCURRENCY, songsWithArtwork.length) }, async () => {
    while (nextSongIndex < songsWithArtwork.length) {
      const currentIndex = nextSongIndex
      nextSongIndex += 1
      const currentSong = songsWithArtwork[currentIndex]

      try {
        const coverUrl = await fetchSongArtwork(currentSong.title, currentSong.artist)
        songsWithArtwork[currentIndex] = {
          ...currentSong,
          coverUrl,
        }
      } catch {
        songsWithArtwork[currentIndex] = {
          ...currentSong,
          coverUrl: null,
        }
      }
    }
  })

  await Promise.all(workers)

  return songsWithArtwork
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
  const [playlistType, setPlaylistType] = useState<CreatePlaylistType>('human_jukebox')
  const [draftPlaylistName, setDraftPlaylistName] = useState('')
  const [songTitle, setSongTitle] = useState('')
  const [artistName, setArtistName] = useState('')
  const [isExplicit, setIsExplicit] = useState(false)
  const [customCoverDataUrl, setCustomCoverDataUrl] = useState<string | null>(null)
  const [customCoverName, setCustomCoverName] = useState('')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [successText, setSuccessText] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const isMountedRef = useRef(true)
  const actionLocksRef = useRef<Set<string>>(new Set())

  const deferredSearchText = useDeferredValue(searchText)

  useEffect(() => {
    isMountedRef.current = true
    const actionLocks = actionLocksRef.current

    return () => {
      isMountedRef.current = false
      actionLocks.clear()
    }
  }, [])

  const beginAction = (actionKey: string) => {
    if (actionLocksRef.current.has(actionKey)) {
      return false
    }

    actionLocksRef.current.add(actionKey)

    if (isMountedRef.current) {
      setBusyAction(actionKey)
    }

    return true
  }

  const endAction = (actionKey: string) => {
    actionLocksRef.current.delete(actionKey)

    if (isMountedRef.current) {
      setBusyAction((currentAction) => (currentAction === actionKey ? null : currentAction))
    }
  }

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

        let playlistRows: Playlist[] = []

        const { data: playlistsWithType, error: playlistsWithTypeError } = await supabase
          .from('playlists')
          .select('id, name, description, created_at, playlist_type')
          .eq('user_id', userId)
          .order('created_at', { ascending: true })

        if (playlistsWithTypeError && !isMissingPlaylistTypeColumnError(playlistsWithTypeError)) {
          throw playlistsWithTypeError
        }

        if (playlistsWithTypeError && isMissingPlaylistTypeColumnError(playlistsWithTypeError)) {
          const { data: playlistsWithoutType, error: playlistsWithoutTypeError } = await supabase
            .from('playlists')
            .select('id, name, description, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: true })

          if (playlistsWithoutTypeError) {
            throw playlistsWithoutTypeError
          }

          playlistRows = ((playlistsWithoutType ?? []) as Array<Omit<Playlist, 'playlist_type'>>).map((playlist) => ({
            ...playlist,
            playlist_type: inferPlaylistType(null, playlist.name),
          }))
        } else {
          playlistRows = ((playlistsWithType ?? []) as Array<Omit<Playlist, 'playlist_type'> & { playlist_type?: string | null }>).map((playlist) => ({
            ...playlist,
            playlist_type: inferPlaylistType(playlist.playlist_type, playlist.name),
          }))
        }

        const [playlistCountsResult, totalSongsResult] = await Promise.all([
          supabase
            .from('playlist_songs')
            .select('playlist_id'),
          supabase
            .from('library_songs')
            .select('id', { count: 'exact' })
            .eq('user_id', userId),
        ])

        if (playlistCountsResult.error) {
          throw playlistCountsResult.error
        }

        if (totalSongsResult.error) {
          throw totalSongsResult.error
        }

        if (isCancelled) {
          return
        }

        const nextPlaylists = playlistRows
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

      try {
        const { data, error } = await supabase
          .from('playlist_songs')
          .select('position, library_songs!inner(id, title, artist, cover_url, is_explicit, created_at)')
          .eq('playlist_id', selectedPlaylistId)
          .order('position', { ascending: true })

        if (error) {
          throw error
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
      } catch (error) {
        console.warn('SetlistLibraryPage: failed to load playlist songs', error)
        if (!isCancelled) {
          setErrorText(error instanceof Error ? error.message : 'Unable to load playlist songs.')
        }
      }
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
        let coverUrl: string | null = null

        try {
          coverUrl = await fetchSongArtwork(song.title, song.artist)
        } catch (error) {
          console.warn('SetlistLibraryPage: artwork fetch failed', { songId: song.id, error })
          continue
        }

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
        } else if (error) {
          console.warn('SetlistLibraryPage: artwork update failed', { songId: song.id, error })
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

    const actionKey = 'create-playlist'

    if (!userId || !playlistName.trim()) {
      setErrorText('Playlist name is required.')
      return
    }

    if (!beginAction(actionKey)) {
      return
    }

    setErrorText(null)
    setSuccessText(null)

    try {
      let createdPlaylist: Playlist | null = null

      const { data: createdWithType, error: createdWithTypeError } = await supabase
        .from('playlists')
        .insert({
          user_id: userId,
          name: playlistName.trim(),
          description: playlistDescription.trim() || null,
          playlist_type: toPersistedPlaylistType(playlistType),
        })
        .select('id, name, description, created_at, playlist_type')
        .single()

      if (createdWithTypeError && !isMissingPlaylistTypeColumnError(createdWithTypeError)) {
        throw createdWithTypeError
      }

      if (createdWithTypeError && isMissingPlaylistTypeColumnError(createdWithTypeError)) {
        const { data: createdWithoutType, error: createdWithoutTypeError } = await supabase
          .from('playlists')
          .insert({
            user_id: userId,
            name: playlistName.trim(),
            description: playlistDescription.trim() || null,
          })
          .select('id, name, description, created_at')
          .single()

        if (createdWithoutTypeError) {
          throw createdWithoutTypeError
        }

        createdPlaylist = {
          ...(createdWithoutType as Omit<Playlist, 'playlist_type'>),
          playlist_type: inferPlaylistType(null, createdWithoutType?.name),
        }
      } else {
        createdPlaylist = {
          ...(createdWithType as Omit<Playlist, 'playlist_type'> & { playlist_type?: string | null }),
          playlist_type: inferPlaylistType(createdWithType?.playlist_type, createdWithType?.name),
        }
      }

      if (!createdPlaylist) {
        throw new Error('Unable to create playlist.')
      }

      setPlaylists((currentPlaylists) => [...currentPlaylists, createdPlaylist])
      setPlaylistCounts((currentCounts) => ({ ...currentCounts, [createdPlaylist.id]: 0 }))
      setSelectedPlaylistId(createdPlaylist.id)
      setDraftPlaylistName(createdPlaylist.name)
      setPlaylistName('')
      setPlaylistDescription('')
      setPlaylistType('human_jukebox')
      setSuccessText('Playlist created.')
    } catch (error) {
      console.warn('SetlistLibraryPage: failed to create playlist', error)
      if (isMountedRef.current) {
        setErrorText(error instanceof Error ? error.message : 'Unable to create playlist.')
      }
    } finally {
      endAction(actionKey)
    }
  }

  const onRenamePlaylist = async () => {
    const actionKey = 'rename-playlist'

    if (!selectedPlaylist || !draftPlaylistName.trim()) {
      setErrorText('Playlist name is required.')
      return
    }

    if (!beginAction(actionKey)) {
      return
    }

    setErrorText(null)
    setSuccessText(null)

    try {
      const { error } = await supabase
        .from('playlists')
        .update({ name: draftPlaylistName.trim() })
        .eq('id', selectedPlaylist.id)

      if (error) {
        throw error
      }

      setPlaylists((currentPlaylists) => currentPlaylists.map((playlist) => (
        playlist.id === selectedPlaylist.id
          ? { ...playlist, name: draftPlaylistName.trim() }
          : playlist
      )))
      setSuccessText('Playlist renamed.')
    } catch (error) {
      console.warn('SetlistLibraryPage: failed to rename playlist', error)
      if (isMountedRef.current) {
        setErrorText(error instanceof Error ? error.message : 'Unable to rename playlist.')
      }
    } finally {
      endAction(actionKey)
    }
  }

  const onDeletePlaylist = async () => {
    const actionKey = 'delete-playlist'

    if (!selectedPlaylist || playlists.length <= 1) {
      return
    }

    const confirmed = window.confirm(`Delete playlist "${selectedPlaylist.name}"?`)

    if (!confirmed) {
      return
    }

    if (!beginAction(actionKey)) {
      return
    }

    setErrorText(null)
    setSuccessText(null)

    try {
      const { error } = await supabase
        .from('playlists')
        .delete()
        .eq('id', selectedPlaylist.id)

      if (error) {
        throw error
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
      setSuccessText('Playlist deleted.')
    } catch (error) {
      console.warn('SetlistLibraryPage: failed to delete playlist', error)
      if (isMountedRef.current) {
        setErrorText(error instanceof Error ? error.message : 'Unable to delete playlist.')
      }
    } finally {
      endAction(actionKey)
    }
  }

  const onAddSongToPlaylist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const actionKey = 'add-song'

    if (!user || !selectedPlaylistId || !songTitle.trim() || !artistName.trim()) {
      return
    }

    if (!beginAction(actionKey)) {
      return
    }

    setErrorText(null)
    setSuccessText(null)

    try {
      const coverUrl = customCoverDataUrl ?? await fetchSongArtwork(songTitle.trim(), artistName.trim())

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
        throw insertedSongError
      }

      const { error: linkError } = await supabase
        .from('playlist_songs')
        .insert({
          playlist_id: selectedPlaylistId,
          song_id: insertedSong.id,
          position: songs.length,
        })

      if (linkError) {
        throw linkError
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
      setCustomCoverDataUrl(null)
      setCustomCoverName('')
      setSuccessText('Song added to playlist.')
    } catch (error) {
      console.warn('SetlistLibraryPage: failed to add song to playlist', error)
      if (isMountedRef.current) {
        setErrorText(error instanceof Error ? error.message : 'Unable to add song to playlist.')
      }
    } finally {
      endAction(actionKey)
    }
  }

  const onSelectCoverImage = async (changeEvent: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = changeEvent.target.files?.[0]
    changeEvent.target.value = ''

    if (!selectedFile) {
      setCustomCoverDataUrl(null)
      setCustomCoverName('')
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      setErrorText('Please choose an image file for the cover art.')
      return
    }

    if (selectedFile.size > MAX_COVER_IMAGE_BYTES) {
      setErrorText('Cover image is too large. Use an image up to 3 MB.')
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(selectedFile)
      setCustomCoverDataUrl(dataUrl)
      setCustomCoverName(selectedFile.name)
      setErrorText(null)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to import that cover image.')
    }
  }

  const onRemoveSongFromPlaylist = async (songId: string) => {
    const actionKey = `remove-song-${songId}`

    if (!selectedPlaylistId) {
      return
    }

    if (!beginAction(actionKey)) {
      return
    }

    setErrorText(null)
    setSuccessText(null)

    try {
      const { error } = await supabase
        .from('playlist_songs')
        .delete()
        .eq('playlist_id', selectedPlaylistId)
        .eq('song_id', songId)

      if (error) {
        throw error
      }

      setSongs((currentSongs) => currentSongs.filter((song) => song.id !== songId))
      setPlaylistCounts((currentCounts) => ({
        ...currentCounts,
        [selectedPlaylistId]: Math.max((currentCounts[selectedPlaylistId] ?? 1) - 1, 0),
      }))
      setSuccessText('Song removed from playlist.')
    } catch (error) {
      console.warn('SetlistLibraryPage: failed to remove song from playlist', { songId, error })
      if (isMountedRef.current) {
        setErrorText(error instanceof Error ? error.message : 'Unable to remove song from playlist.')
      }
    } finally {
      endAction(actionKey)
    }
  }

  const onAddSongToLiveQueue = async (song: PlaylistSongRecord) => {
    const actionKey = `queue-song-${song.id}`

    if (!beginAction(actionKey)) {
      return
    }

    setErrorText(null)
    setSuccessText(null)

    try {
      await addSong(song.title, song.artist, song.is_explicit, {
        coverUrl: song.cover_url,
        librarySongId: song.id,
        bypassEventRules: true,
      })
    } catch (error) {
      if (isMountedRef.current) {
        setErrorText(error instanceof Error ? error.message : 'Failed to queue this song.')
      }
    } finally {
      endAction(actionKey)
    }
  }

  const onImportPlaylistFile = async (changeEvent: ChangeEvent<HTMLInputElement>) => {
    const actionKey = 'import-file'
    const selectedFile = changeEvent.target.files?.[0]
    changeEvent.target.value = ''

    if (!selectedFile) {
      return
    }

    if (!userId || !selectedPlaylistId) {
      setErrorText('Select a playlist first, then import your file.')
      return
    }

    if (!beginAction(actionKey)) {
      return
    }

    setErrorText(null)
    setSuccessText(null)

    try {
      const fileText = await selectedFile.text()
      const parsedSongs = dedupeSongs(parseSongsFromFile(selectedFile.name, fileText))

      if (!parsedSongs.length) {
        throw new Error('No songs found in this file. Use lines like "Song - Artist" or a CSV with title/artist columns.')
      }

      const songsWithArtwork = await resolveArtworkForImportedSongs(parsedSongs)

      const { data: insertedSongs, error: insertedSongsError } = await supabase
        .from('library_songs')
        .insert(
          songsWithArtwork.map((song) => ({
            user_id: userId,
            title: song.title,
            artist: song.artist,
            is_explicit: song.isExplicit,
            cover_url: song.coverUrl,
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
      const importedWithArtworkCount = songsWithArtwork.filter((song) => Boolean(song.coverUrl)).length
      setSuccessText(
        `Imported ${nextSongsToAdd.length} song${nextSongsToAdd.length === 1 ? '' : 's'} from ${selectedFile.name}. `
        + `Found cover art for ${importedWithArtworkCount}.`,
      )
    } catch (error) {
      if (isMountedRef.current) {
        setErrorText(error instanceof Error ? error.message : 'Unable to import songs from this file.')
      }
    } finally {
      endAction(actionKey)
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
            <select
              aria-label="Playlist type"
              value={playlistType}
              onChange={(event) => setPlaylistType(event.target.value as CreatePlaylistType)}
            >
              <option value="harald_live">Harald Live Setlist</option>
              <option value="human_jukebox">Human Jukebox Setlist</option>
              <option value="karaoke">Karaoke Setlist</option>
            </select>
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
                <div className={`setlist-playlist-art setlist-playlist-art-${playlist.playlist_type === 'karaoke' ? 'karaoke' : 'human-jukebox'}`} aria-hidden="true">
                  <span className="setlist-playlist-art-badge">{playlist.playlist_type === 'karaoke' ? 'Sing along' : 'Main floor'}</span>
                  <strong>{playlist.playlist_type === 'karaoke' ? 'Karaoke Setlist' : 'Human Jukebox Setlist'}</strong>
                </div>
                <h3>{playlist.name}</h3>
                <p className="subcopy no-margin-bottom">{playlist.description ?? 'No description yet.'}</p>
                <div className="setlist-playlist-meta">
                  <span className="meta-badge">{playlistCounts[playlist.id] ?? 0} songs</span>
                  <span className="meta-badge">{playlist.playlist_type === 'karaoke' ? 'Karaoke' : 'Human Jukebox'}</span>
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
            <label className="setlist-search" htmlFor="setlist-cover-file">
              <span>Cover image (optional)</span>
              <input
                id="setlist-cover-file"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={onSelectCoverImage}
              />
            </label>
            <button type="submit" className="primary-button" disabled={!selectedPlaylistId || busyAction === 'add-song'}>
              {busyAction === 'add-song' ? 'Adding...' : 'Add Song'}
            </button>
          </form>

          {customCoverName ? <p className="subcopy no-margin-bottom">Selected cover: {customCoverName}</p> : null}

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