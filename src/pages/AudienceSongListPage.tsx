import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { readCommittedAudienceLocale, readCommittedAudienceName } from '../lib/audienceIdentity'
import { fetchSongArtwork } from '../lib/songArtwork'
import { supabase } from '../lib/supabase'
import { useQueueStore } from '../state/queueStore'
import { setEventOGTags, resetOGTags } from '../lib/metaTags'

type CuratedSong = {
  id: string
  title: string
  artist: string
  cover_url: string | null
  is_explicit: boolean
  fromKaraokeSetlist: boolean
}

type PerformerMode = 'performer' | 'audience'
type PlaylistType = 'human_jukebox' | 'karaoke'

type EventPlaylistRow = {
  playlist_id: string
  playlists: {
    id: string
    name: string
    playlist_type: string | null
  } | {
    id: string
    name: string
    playlist_type: string | null
  }[] | null
}

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

function sortSongs(left: CuratedSong, right: CuratedSong) {
  const leftHasCover = Boolean(left.cover_url && left.cover_url.trim())
  const rightHasCover = Boolean(right.cover_url && right.cover_url.trim())

  if (leftHasCover !== rightHasCover) {
    return leftHasCover ? -1 : 1
  }

  return left.title.localeCompare(right.title)
}

function buildSongRows(songs: CuratedSong[]) {
  return songs.map((song, index) => {
    const title = normalizeDisplayText(song.title, 'Untitled Song')
    const artist = normalizeDisplayText(song.artist, 'Unknown Artist')
    const songKey = title.charAt(0).toUpperCase() || '#'
    const previousSong = songs[index - 1]
    const previousTitle = previousSong ? normalizeDisplayText(previousSong.title, 'Untitled Song') : ''
    const previousSongKey = previousTitle.charAt(0).toUpperCase() || '#'

    return {
      song,
      title,
      artist,
      sectionLabel: index === 0 || songKey !== previousSongKey ? songKey : null,
    }
  })
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

function normalizeDisplayText(value: string | null | undefined, fallback: string) {
  const trimmedValue = value?.trim()
  return trimmedValue || fallback
}

function AudienceSongListPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    event,
    songs,
    addSong,
  } = useQueueStore()

  const [curatedSongs, setCuratedSongs] = useState<CuratedSong[]>([])
  const [hasKaraokePlaylist, setHasKaraokePlaylist] = useState(false)
  const [hasHumanJukeboxPlaylist, setHasHumanJukeboxPlaylist] = useState(false)
  const [songSearchQuery, setSongSearchQuery] = useState('')
  const [loadingSongs, setLoadingSongs] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [selectedSong, setSelectedSong] = useState<CuratedSong | null>(null)
  const [submittingMode, setSubmittingMode] = useState<PerformerMode | null>(null)
  const [activeSetlist, setActiveSetlist] = useState<'human_jukebox' | 'karaoke' | null>(null)

  const audienceName = readCommittedAudienceName()
  const audienceLocale = readCommittedAudienceLocale()
  const performerDisplayName = 'Performer'
  const copy = audienceLocale === 'da'
    ? {
        back: 'Tilbage',
        eyebrow: 'Sangliste',
        pickPlaylist: 'Vælg en playliste',
        greeting: 'Hej',
        guest: 'Gæst',
        choosePlaylistFirst: 'vælg først en playliste.',
        chooseRequest: 'scroll og vælg dit ønske.',
        loadingSongs: 'Indlæser sange...',
        hostPlays: 'Værten spiller - du vælger sangen',
        youSing: 'Du går op og synger den selv',
        songs: 'sange',
        searchSongs: 'Søg sange',
        searchPlaceholder: 'Søg på sangtitel eller artist',
        availableSuffix: 'tilgængelige',
        karaokeSongsLabel: 'Karaoke-sange',
        jukeboxSongsLabel: 'Human Jukebox-sange',
        iSing: 'Jeg synger',
        explicit: 'Eksplicit',
        allMatchingQueued: 'Alle matchende sange er allerede i kø.',
        noSongsAssigned: 'Ingen sange er tildelt dette gig endnu.',
        chooseWhoSings: 'Vælg hvem der synger',
        selected: 'Valgt',
        untitledSong: 'Unavngiven sang',
        unknownArtist: 'Ukendt artist',
        adding: 'Tilføjer...',
        addKaraoke: 'Tilføj karaokeønske (jeg synger denne)',
        performerSings: 'Performeren synger sangen',
        iWantToSing: 'Jeg vil synge sangen',
        cancel: 'Annuller',
        unableToLoadSongs: 'Kan ikke indlæse sangvalg lige nu. Prøv igen.',
        unableToAddRequest: 'Kan ikke tilføje dette ønske lige nu.',
      }
    : {
        back: 'Back',
        eyebrow: 'Song List',
        pickPlaylist: 'Pick a playlist',
        greeting: 'Hi',
        guest: 'Guest',
        choosePlaylistFirst: 'choose a playlist first.',
        chooseRequest: 'scroll and choose your request.',
        loadingSongs: 'Loading songs...',
        hostPlays: 'The host plays — you pick the song',
        youSing: 'You get up and sing it yourself',
        songs: 'songs',
        searchSongs: 'Search songs',
        searchPlaceholder: 'Search by song title or artist',
        availableSuffix: 'available',
        karaokeSongsLabel: 'Karaoke songs',
        jukeboxSongsLabel: 'Human jukebox songs',
        iSing: 'I sing',
        explicit: 'Explicit',
        allMatchingQueued: 'All matching songs are already in queue.',
        noSongsAssigned: 'No songs are assigned to this gig yet.',
        chooseWhoSings: 'Choose who sings',
        selected: 'Selected',
        untitledSong: 'Untitled Song',
        unknownArtist: 'Unknown Artist',
        adding: 'Adding...',
        addKaraoke: 'Add Karaoke Request (I sing this one)',
        performerSings: `${performerDisplayName} sings the song`,
        iWantToSing: 'I want to sing the song',
        cancel: 'Cancel',
        unableToLoadSongs: 'Unable to load song choices right now. Please try again.',
        unableToAddRequest: 'Unable to add this request right now.',
      }
  const normalizedSearchQuery = songSearchQuery.trim().toLowerCase()

  const queuedLibrarySongIds = useMemo(() => (
    new Set(
      songs
        .map((song) => song.library_song_id)
        .filter((songId): songId is string => Boolean(songId)),
    )
  ), [songs])

  const availableSongs = useMemo(() => {
    const songsWithoutQueued = curatedSongs.filter((song) => !queuedLibrarySongIds.has(song.id))

    if (!normalizedSearchQuery) {
      return songsWithoutQueued
    }

    return songsWithoutQueued.filter((song) => (
      `${song.title} ${song.artist}`.toLowerCase().includes(normalizedSearchQuery)
    ))
  }, [curatedSongs, normalizedSearchQuery, queuedLibrarySongIds])

  const humanJukeboxSongs = useMemo(
    () => availableSongs.filter((song) => !song.fromKaraokeSetlist),
    [availableSongs],
  )
  const karaokeSongs = useMemo(
    () => availableSongs.filter((song) => song.fromKaraokeSetlist),
    [availableSongs],
  )
  const humanJukeboxRows = useMemo(() => buildSongRows(humanJukeboxSongs), [humanJukeboxSongs])
  const karaokeRows = useMemo(() => buildSongRows(karaokeSongs), [karaokeSongs])

  useEffect(() => {
    if (!selectedSong || typeof document === 'undefined') {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [selectedSong])

  useEffect(() => {
    if (!selectedSong) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submittingMode) {
        setSelectedSong(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [selectedSong, submittingMode])

  useEffect(() => {
    if (!audienceName) {
      navigate('/audience', { replace: true })
    }
  }, [audienceName, navigate])

  // Update OG meta tags for social media sharing
  useEffect(() => {
    if (!event) {
      resetOGTags()
      return
    }

    const description = event.venue
      ? `Browse and request songs for ${event.name} in ${event.venue}!`
      : `Browse and request songs for ${event.name}!`

    setEventOGTags(event.name, description, undefined, typeof window !== 'undefined' ? window.location.href : undefined)
  }, [event, event?.id, event?.name, event?.venue])

  useEffect(() => {
    let isCurrent = true

    const loadCuratedSongs = async () => {
      setLoadingSongs(true)
      setErrorText(null)

      const loadFallbackSongs = async () => {
        if (isCurrent) {
          setHasKaraokePlaylist(false)
          setHasHumanJukeboxPlaylist(false)
        }

        const { data: coveredFallbackSongs, error: coveredFallbackSongsError } = await supabase
          .from('library_songs')
          .select('id, title, artist, cover_url, is_explicit')
          .not('cover_url', 'is', null)
          .neq('cover_url', '')
          .order('created_at', { ascending: false })
          .limit(220)

        if (coveredFallbackSongsError) {
          if (isCurrent) {
            setErrorText(coveredFallbackSongsError.message)
          }
          return
        }

        const nextSongsSource = ((coveredFallbackSongs ?? []) as Omit<CuratedSong, 'fromKaraokeSetlist'>[])
          .map((song) => ({ ...song, fromKaraokeSetlist: false }))

        if (nextSongsSource.length === 0) {
          const { data: fallbackSongs, error: fallbackSongsError } = await supabase
            .from('library_songs')
            .select('id, title, artist, cover_url, is_explicit')
            .order('created_at', { ascending: false })
            .limit(220)

          if (fallbackSongsError) {
            if (isCurrent) {
              setErrorText(fallbackSongsError.message)
            }
            return
          }

          if (isCurrent) {
            const nextSongs = ((fallbackSongs ?? []) as Omit<CuratedSong, 'fromKaraokeSetlist'>[])
              .map((song) => ({ ...song, fromKaraokeSetlist: false }))
              .sort(sortSongs)
            setCuratedSongs(nextSongs)
          }
          return
        }

        if (isCurrent) {
          const nextSongs = nextSongsSource.sort(sortSongs)
          setCuratedSongs(nextSongs)
        }
      }

      try {
        if (!event?.id) {
          await loadFallbackSongs()
          return
        }

        let eventPlaylistsRows: EventPlaylistRow[] = []

        const { data: eventPlaylistsWithType, error: eventPlaylistsWithTypeError } = await supabase
          .from('event_playlists')
          .select('playlist_id, playlists!inner(id, name, playlist_type)')
          .eq('event_id', event.id)

        if (eventPlaylistsWithTypeError && !isMissingPlaylistTypeColumnError(eventPlaylistsWithTypeError)) {
          if (isCurrent) {
            setErrorText(eventPlaylistsWithTypeError.message)
          }
          return
        }

        if (eventPlaylistsWithTypeError && isMissingPlaylistTypeColumnError(eventPlaylistsWithTypeError)) {
          const { data: fallbackEventPlaylists, error: fallbackEventPlaylistsError } = await supabase
            .from('event_playlists')
            .select('playlist_id, playlists!inner(id, name)')
            .eq('event_id', event.id)

          if (fallbackEventPlaylistsError) {
            if (isCurrent) {
              setErrorText(fallbackEventPlaylistsError.message)
            }
            return
          }

          eventPlaylistsRows = (fallbackEventPlaylists ?? []) as EventPlaylistRow[]
        } else {
          eventPlaylistsRows = (eventPlaylistsWithType ?? []) as EventPlaylistRow[]
        }

        const playlistTypeById = new Map<string, PlaylistType>()

        for (const row of eventPlaylistsRows) {
          const playlistData = Array.isArray(row.playlists) ? row.playlists[0] : row.playlists

          if (!playlistData) {
            continue
          }

          playlistTypeById.set(
            row.playlist_id,
            inferPlaylistType(playlistData.playlist_type, playlistData.name),
          )
        }

        if (!playlistTypeById.size && event.hostId) {
          const { data: hostPlaylistsWithType, error: hostPlaylistsWithTypeError } = await supabase
            .from('playlists')
            .select('id, name, playlist_type')
            .eq('user_id', event.hostId)

          if (hostPlaylistsWithTypeError && !isMissingPlaylistTypeColumnError(hostPlaylistsWithTypeError)) {
            if (isCurrent) {
              setErrorText(hostPlaylistsWithTypeError.message)
            }
            return
          }

          if (hostPlaylistsWithTypeError && isMissingPlaylistTypeColumnError(hostPlaylistsWithTypeError)) {
            const { data: hostPlaylistsWithoutType, error: hostPlaylistsWithoutTypeError } = await supabase
              .from('playlists')
              .select('id, name')
              .eq('user_id', event.hostId)

            if (hostPlaylistsWithoutTypeError) {
              if (isCurrent) {
                setErrorText(hostPlaylistsWithoutTypeError.message)
              }
              return
            }

            for (const playlist of (hostPlaylistsWithoutType ?? []) as Array<{ id: string; name: string | null }>) {
              playlistTypeById.set(playlist.id, inferPlaylistType(null, playlist.name))
            }
          } else {
            for (const playlist of (hostPlaylistsWithType ?? []) as Array<{ id: string; name: string | null; playlist_type: string | null }>) {
              playlistTypeById.set(playlist.id, inferPlaylistType(playlist.playlist_type, playlist.name))
            }
          }
        }

        const playlistIds = [...playlistTypeById.keys()]
        const assignedSetlistTypes = new Set<PlaylistType>(playlistTypeById.values())

        if (isCurrent) {
          setHasKaraokePlaylist(assignedSetlistTypes.has('karaoke'))
          setHasHumanJukeboxPlaylist(assignedSetlistTypes.has('human_jukebox'))
        }

        if (!playlistIds.length) {
          await loadFallbackSongs()
          return
        }

        const { data: playlistSongs, error: playlistSongsError } = await supabase
          .from('playlist_songs')
          .select('playlist_id, song_id')
          .in('playlist_id', playlistIds)

        if (playlistSongsError) {
          if (isCurrent) {
            setErrorText(playlistSongsError.message)
          }
          return
        }

        const karaokeSongIds = new Set<string>()
        const songIds = new Set<string>()

        for (const row of (playlistSongs ?? []) as Array<{ playlist_id?: string | null; song_id?: string | null }>) {
          if (!row.song_id) {
            continue
          }

          songIds.add(row.song_id)

          if (row.playlist_id && playlistTypeById.get(row.playlist_id) === 'karaoke') {
            karaokeSongIds.add(row.song_id)
          }
        }

        if (!songIds.size) {
          if (isCurrent) {
            setCuratedSongs([])
          }
          return
        }

        const { data: librarySongs, error: librarySongsError } = await supabase
          .from('library_songs')
          .select('id, title, artist, cover_url, is_explicit')
          .in('id', [...songIds])

        if (librarySongsError) {
          if (isCurrent) {
            setErrorText(librarySongsError.message)
          }
          return
        }

        if (isCurrent) {
          const dedupedSongs = new Map<string, CuratedSong>()

          for (const song of (librarySongs ?? []) as Omit<CuratedSong, 'fromKaraokeSetlist'>[]) {
            if (!dedupedSongs.has(song.id)) {
              dedupedSongs.set(song.id, {
                ...song,
                fromKaraokeSetlist: karaokeSongIds.has(song.id),
              })
            }
          }

          const nextSongs = [...dedupedSongs.values()].sort(sortSongs)

          setCuratedSongs(nextSongs)
        }
      } catch (error) {
        console.warn('AudienceSongListPage: failed to load songs', error)
        if (isCurrent) {
          setErrorText(copy.unableToLoadSongs)
        }
      } finally {
        if (isCurrent) {
          setLoadingSongs(false)
        }
      }
    }

    void loadCuratedSongs()

    return () => {
      isCurrent = false
    }
  }, [event?.id, event?.hostId])

  useEffect(() => {
    const songsMissingArtwork = curatedSongs
      .filter((song) => !song.cover_url?.trim())
      .slice(0, 8)

    if (!songsMissingArtwork.length) {
      return
    }

    let isCancelled = false

    const hydrateArtwork = async () => {
      for (const song of songsMissingArtwork) {
        let coverUrl: string | null

        try {
          coverUrl = await fetchSongArtwork(song.title, song.artist)
        } catch {
          continue
        }

        if (!coverUrl || isCancelled) {
          continue
        }

        const normalizedCover = normalizeCoverUrl(coverUrl)

        if (!normalizedCover) {
          continue
        }

        const { error } = await supabase
          .from('library_songs')
          .update({ cover_url: normalizedCover })
          .eq('id', song.id)

        if (!error && !isCancelled) {
          setCuratedSongs((currentSongs) => currentSongs.map((currentSong) => (
            currentSong.id === song.id ? { ...currentSong, cover_url: normalizedCover } : currentSong
          )))
        }
      }
    }

    void hydrateArtwork()

    return () => {
      isCancelled = true
    }
  }, [curatedSongs])

  const submitSongRequest = async (mode: PerformerMode) => {
    if (!selectedSong || submittingMode) {
      return
    }

    const effectiveMode: PerformerMode = selectedSong.fromKaraokeSetlist ? 'audience' : mode

    setSubmittingMode(effectiveMode)
    setErrorText(null)

    try {
      await addSong(selectedSong.title, selectedSong.artist, selectedSong.is_explicit, {
        coverUrl: selectedSong.cover_url,
        librarySongId: selectedSong.id,
        performerMode: effectiveMode,
      })

      const targetAudienceUrl = `/audience${location.search || ''}`

      // Use a full navigation to avoid stale lazy-chunk errors after rapid deploys.
      if (typeof window !== 'undefined') {
        window.location.assign(targetAudienceUrl)
        return
      }

      navigate(targetAudienceUrl, { replace: true })
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : copy.unableToAddRequest)
      setSubmittingMode(null)
    }
  }

  // Derived: setlist chooser should appear when both playlist modes are assigned.
  const hasBothSetlists = hasKaraokePlaylist && hasHumanJukeboxPlaylist
  const effectiveSetlist = activeSetlist ?? (hasKaraokePlaylist && !hasHumanJukeboxPlaylist ? 'karaoke' : 'human_jukebox')
  const showPlaylistPicker = !loadingSongs && hasBothSetlists && activeSetlist === null
  const activeRows = effectiveSetlist === 'karaoke' ? karaokeRows : humanJukeboxRows

  return (
    <section className="audience-song-list-shell" aria-label="Song list page">
      <header className="audience-song-list-header">
        <button
          type="button"
          className="secondary-button audience-song-list-back"
          onClick={() => {
            if (activeSetlist !== null && hasBothSetlists) {
              setActiveSetlist(null)
              setSongSearchQuery('')
            } else {
              navigate(`/audience${location.search || ''}`, { replace: true })
            }
          }}
        >
          ← {copy.back}
        </button>
        <div className="audience-song-list-header-copy">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{showPlaylistPicker ? copy.pickPlaylist : effectiveSetlist === 'karaoke' ? 'Karaoke' : 'Human Jukebox'}</h1>
          <p className="subcopy">{copy.greeting} {audienceName || copy.guest} — {showPlaylistPicker ? copy.choosePlaylistFirst : copy.chooseRequest}</p>
        </div>
      </header>

      {loadingSongs ? <p className="meta-badge audience-policy-badge" role="status" aria-live="polite">{copy.loadingSongs}</p> : null}
      {errorText ? <p className="error-text request-error-inline">{errorText}</p> : null}

      {/* ── Playlist picker ── */}
      {showPlaylistPicker ? (
        <div className="audience-playlist-picker">
          {event?.requestInstructions ? <p className="subcopy audience-song-list-note">{event.requestInstructions}</p> : null}
          <button
            type="button"
            className="audience-playlist-choice audience-playlist-choice-jukebox"
            onClick={() => setActiveSetlist('human_jukebox')}
          >
            <img src="/images/playlist-karaoke.jpg" alt="Human Jukebox playlist cover" className="audience-playlist-choice-cover" />
            <div className="audience-playlist-choice-overlay">
              <strong className="audience-playlist-choice-title">Human Jukebox</strong>
              <span className="audience-playlist-choice-sub">{copy.hostPlays}</span>
              <span className="audience-playlist-choice-count">{humanJukeboxRows.length} {copy.songs}</span>
            </div>
          </button>
          <button
            type="button"
            className="audience-playlist-choice audience-playlist-choice-karaoke"
            onClick={() => setActiveSetlist('karaoke')}
          >
            <img src="/images/playlist-human-jukebox.jpg" alt="Karaoke playlist cover" className="audience-playlist-choice-cover" />
            <div className="audience-playlist-choice-overlay">
              <strong className="audience-playlist-choice-title">Karaoke</strong>
              <span className="audience-playlist-choice-sub">{copy.youSing}</span>
              <span className="audience-playlist-choice-count">{karaokeRows.length} {copy.songs}</span>
            </div>
          </button>
        </div>
      ) : null}

      {/* ── Song list ── */}
      {!loadingSongs && !showPlaylistPicker ? (
        <>
          <section className="audience-song-list-search">
            <label htmlFor="audience-song-list-search-input">{copy.searchSongs}</label>
            <input
              id="audience-song-list-search-input"
              value={songSearchQuery}
              onChange={(event) => setSongSearchQuery(event.target.value)}
              placeholder={copy.searchPlaceholder}
            />
          </section>

          {event?.requestInstructions ? <p className="subcopy audience-song-list-note">{event.requestInstructions}</p> : null}

          <div className="audience-song-list-scroll">
            <p className="curated-picker-results" aria-live="polite">
              {activeRows.length} {copy.songs} {copy.availableSuffix}
            </p>
            <div className="audience-song-list-section">
              <ul className="audience-song-list-grid" aria-label={effectiveSetlist === 'karaoke' ? copy.karaokeSongsLabel : copy.jukeboxSongsLabel}>
                {activeRows.map(({ song, title, artist, sectionLabel }) => (
                  <li key={song.id} className="audience-song-list-item">
                    {sectionLabel ? <p className="curated-section-label" aria-hidden="true">{sectionLabel}</p> : null}
                    <button
                      type="button"
                      className={`audience-song-list-card${effectiveSetlist === 'karaoke' ? ' audience-song-list-card-karaoke' : ''}`}
                      onClick={() => {
                        setSelectedSong(song)
                        setErrorText(null)
                      }}
                    >
                      {song.cover_url ? (
                        <img
                          src={normalizeCoverUrl(song.cover_url) ?? song.cover_url}
                          alt={`Cover art for ${title}`}
                          className="audience-song-list-cover"
                        />
                      ) : (
                        <span className="audience-song-list-cover song-cover-fallback" aria-hidden="true">♪</span>
                      )}
                      <span className="audience-song-list-copy">
                        <span className="audience-song-list-title">{title}</span>
                        <span className="audience-song-list-artist">{artist}</span>
                        {effectiveSetlist === 'karaoke' ? <span className="karaoke-tag">{copy.iSing}</span> : null}
                        {song.is_explicit ? <span className="curated-pick-meta">{copy.explicit}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {!activeRows.length ? (
                <p className="subcopy">
                  {curatedSongs.length ? copy.allMatchingQueued : copy.noSongsAssigned}
                </p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {selectedSong ? (
        <aside
          className="audience-song-choice-overlay"
          aria-label={copy.chooseWhoSings}
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget && !submittingMode) {
              setSelectedSong(null)
            }
          }}
        >
          <div className="audience-song-choice-sheet">
            <p className="eyebrow">{copy.selected}</p>
            <h2>{normalizeDisplayText(selectedSong.title, copy.untitledSong)}</h2>
            <p className="subcopy">{normalizeDisplayText(selectedSong.artist, copy.unknownArtist)}</p>
            <div className="audience-song-choice-actions">
              {selectedSong.fromKaraokeSetlist ? (
                <button
                  type="button"
                  className="secondary-button audience-song-choice-button"
                  disabled={Boolean(submittingMode)}
                  onClick={() => {
                    void submitSongRequest('audience')
                  }}
                >
                  {submittingMode === 'audience' ? copy.adding : copy.addKaraoke}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="primary-button audience-song-choice-button"
                    disabled={Boolean(submittingMode)}
                    onClick={() => {
                      void submitSongRequest('performer')
                    }}
                  >
                    {submittingMode === 'performer' ? copy.adding : copy.performerSings}
                  </button>
                  <button
                    type="button"
                    className="secondary-button audience-song-choice-button"
                    disabled={Boolean(submittingMode)}
                    onClick={() => {
                      void submitSongRequest('audience')
                    }}
                  >
                    {submittingMode === 'audience' ? copy.adding : copy.iWantToSing}
                  </button>
                </>
              )}
              <button
                type="button"
                className="tertiary-button audience-song-choice-button"
                disabled={Boolean(submittingMode)}
                onClick={() => setSelectedSong(null)}
              >
                {copy.cancel}
              </button>
            </div>
          </div>
        </aside>
      ) : null}
    </section>
  )
}

export default AudienceSongListPage
