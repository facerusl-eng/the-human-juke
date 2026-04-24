import { useState, useEffect, useRef } from 'react'
import type { FormEvent } from 'react'
import { useQueueStore } from '../state/queueStore'
import { useAuthStore } from '../state/authStore'
import { commitAudienceName, readCommittedAudienceName } from '../lib/audienceIdentity'
import {
  BETWEEN_SONG_QUOTES,
  PLAYBACK_STATE_EVENT,
  readSharedPlaybackState,
  type SharedPlaybackState,
} from '../lib/playbackState'
import { fetchSongArtwork } from '../lib/songArtwork'
import { supabase } from '../lib/supabase'

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

type HostProfile = {
  display_name: string | null
  instagram_url: string | null
  tiktok_url: string | null
  youtube_url: string | null
  facebook_url: string | null
  paypal_url: string | null
  buymeacoffee_url: string | null
  kofi_url: string | null
}

type CuratedSong = {
  id: string
  title: string
  artist: string
  cover_url: string | null
  is_explicit: boolean
}

type PickerViewMode = 'cards' | 'rows' | 'covers'
type PerformerMode = 'performer' | 'audience'

function EventPage() {
  const [hostProfile, setHostProfile] = useState<HostProfile | null>(null)
  const { authError } = useAuthStore()

  useEffect(() => {
    supabase
      .from('profiles')
      .select('display_name, instagram_url, tiktok_url, youtube_url, facebook_url, paypal_url, buymeacoffee_url, kofi_url')
      .eq('role', 'host')
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) setHostProfile(data as HostProfile)
      })
  }, [])
  const {
    event,
    songs,
    loading,
    addSong,
    upvoteSong,
  } = useQueueStore()
  const [songTitle, setSongTitle] = useState('')
  const [artistName, setArtistName] = useState('')
  const [isExplicit, setIsExplicit] = useState(false)
  const [curatedSongs, setCuratedSongs] = useState<CuratedSong[]>([])
  const [selectedCuratedSongId, setSelectedCuratedSongId] = useState('')
  const [songSearchQuery, setSongSearchQuery] = useState('')
  const [pickerViewMode, setPickerViewMode] = useState<PickerViewMode>('rows')
  const [performerMode, setPerformerMode] = useState<PerformerMode>('performer')
  const [audienceNameInput, setAudienceNameInput] = useState('')
  const [audienceName, setAudienceName] = useState('')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [submittingSongId, setSubmittingSongId] = useState<string | null>(null)
  const [votePulseTicks, setVotePulseTicks] = useState<Record<string, number>>({})
  const [playbackState, setPlaybackState] = useState<SharedPlaybackState | null>(null)
  const [canScrollSetlist, setCanScrollSetlist] = useState(false)
  const [isSetlistScrollAtEnd, setIsSetlistScrollAtEnd] = useState(false)
  const previousVotesRef = useRef<Map<string, number>>(new Map())
  const curatedPickerScrollRef = useRef<HTMLDivElement | null>(null)

  const roomOpen = event?.roomOpen ?? false
  const playlistOnlyRequests = event?.playlistOnlyRequests ?? false
  const duplicateRequestsBlocked = event ? !event.allowDuplicateRequests : false
  const activeRequestCap = event?.maxActiveRequestsPerUser ?? null
  const nowPlaying = songs[0]
  const playbackSong = playbackState?.currentSongId
    ? songs.find((song) => song.id === playbackState.currentSongId) ?? null
    : null
  const activeSong = playbackSong ?? nowPlaying
  const isNowPlayingStarted = Boolean(playbackState?.isStarted && playbackState.currentSongId)
  const displaySong = isNowPlayingStarted ? activeSong : nowPlaying
  const displaySongCoverUrl = displaySong?.cover_url ?? playbackState?.currentSongCoverUrl ?? null
  const upNext = isNowPlayingStarted
    ? songs.filter((song) => song.id !== activeSong?.id).slice(0)
    : songs.slice(1)
  const isBetweenSongs = playbackState && !playbackState.isStarted
  const betweenSongQuote = isBetweenSongs
    ? BETWEEN_SONG_QUOTES[(playbackState?.quoteIndex ?? 0) % BETWEEN_SONG_QUOTES.length]
    : null
  const hottestVoteCount = upNext.reduce((highestVotes, song) => Math.max(highestVotes, song.votes_count), 0)
  const normalizedSearchQuery = songSearchQuery.trim().toLowerCase()
  const filteredCuratedSongs = normalizedSearchQuery
    ? curatedSongs.filter((song) => `${song.title} ${song.artist}`.toLowerCase().includes(normalizedSearchQuery))
    : curatedSongs
  const coveredCuratedSongs = filteredCuratedSongs.filter((song) => Boolean(song.cover_url && song.cover_url.trim()))
  const displayCuratedSongs = coveredCuratedSongs.length > 0 ? coveredCuratedSongs : filteredCuratedSongs
  const queuedLibrarySongIds = new Set(
    songs
      .map((song) => song.library_song_id)
      .filter((songId): songId is string => Boolean(songId)),
  )
  const availableCuratedSongs = displayCuratedSongs.filter((song) => !queuedLibrarySongIds.has(song.id))
  const selectedCuratedSong = availableCuratedSongs.find((song) => song.id === selectedCuratedSongId) ?? null
  const showCuratedPicker = curatedSongs.length > 0
  const shouldShowSetlistScrollButton = canScrollSetlist || availableCuratedSongs.length > 6
  const performerDisplayName = hostProfile?.display_name?.trim() || 'Performer'
  const hasSongSelection = showCuratedPicker
    ? Boolean(selectedCuratedSongId)
    : Boolean(songTitle.trim() && artistName.trim())
  const readySongLabel = selectedCuratedSong
    ? `${selectedCuratedSong.title} - ${selectedCuratedSong.artist}`
    : null

  const updateSetlistScrollState = () => {
    const scrollRegion = curatedPickerScrollRef.current

    if (!scrollRegion) {
      setCanScrollSetlist(false)
      setIsSetlistScrollAtEnd(false)
      return
    }

    const nextCanScroll = scrollRegion.scrollHeight - scrollRegion.clientHeight > 8
    const nextIsAtEnd = nextCanScroll
      ? scrollRegion.scrollTop + scrollRegion.clientHeight >= scrollRegion.scrollHeight - 12
      : false

    setCanScrollSetlist(nextCanScroll)
    setIsSetlistScrollAtEnd(nextIsAtEnd)
  }

  const scrollSetlist = () => {
    const scrollRegion = curatedPickerScrollRef.current

    if (!scrollRegion) {
      return
    }

    if (isSetlistScrollAtEnd) {
      scrollRegion.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    scrollRegion.scrollBy({
      top: Math.max(scrollRegion.clientHeight * 0.82, 240),
      behavior: 'smooth',
    })
  }

  useEffect(() => {
    if (selectedCuratedSongId && !availableCuratedSongs.some((song) => song.id === selectedCuratedSongId)) {
      setSelectedCuratedSongId('')
    }
  }, [selectedCuratedSongId, availableCuratedSongs])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      updateSetlistScrollState()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [availableCuratedSongs.length, pickerViewMode, selectedCuratedSongId, songSearchQuery])

  useEffect(() => {
    let isCurrent = true

    const loadCuratedSongs = async () => {
      const loadLibraryFallbackSongs = async () => {
        const { data: coveredFallbackSongs, error: coveredFallbackSongsError } = await supabase
          .from('library_songs')
          .select('id, title, artist, cover_url, is_explicit')
          .not('cover_url', 'is', null)
          .neq('cover_url', '')
          .order('created_at', { ascending: false })
          .limit(180)

        if (coveredFallbackSongsError) {
          if (isCurrent) {
            setErrorText(coveredFallbackSongsError.message)
          }
          return
        }

        const nextSongsSource = (coveredFallbackSongs ?? []) as CuratedSong[]

        if (nextSongsSource.length === 0) {
          const { data: fallbackSongs, error: fallbackSongsError } = await supabase
            .from('library_songs')
            .select('id, title, artist, cover_url, is_explicit')
            .order('created_at', { ascending: false })
            .limit(180)

          if (fallbackSongsError) {
            if (isCurrent) {
              setErrorText(fallbackSongsError.message)
            }
            return
          }

          const allNextSongs = ((fallbackSongs ?? []) as CuratedSong[])
            .sort((left, right) => left.title.localeCompare(right.title))

          setCuratedSongs(allNextSongs)
          setSelectedCuratedSongId((currentSongId) => {
            if (currentSongId && allNextSongs.some((song) => song.id === currentSongId)) {
              return currentSongId
            }

            return ''
          })

          return
        }

        const nextSongs = nextSongsSource.sort((left, right) => left.title.localeCompare(right.title))

        setCuratedSongs(nextSongs)
        setSelectedCuratedSongId((currentSongId) => {
          if (currentSongId && nextSongs.some((song) => song.id === currentSongId)) {
            return currentSongId
          }

          return ''
        })
      }

      if (!event?.id) {
        await loadLibraryFallbackSongs()
        return
      }

      const { data: eventPlaylists, error: eventPlaylistsError } = await supabase
        .from('event_playlists')
        .select('playlist_id')
        .eq('event_id', event.id)

      if (eventPlaylistsError) {
        if (isCurrent) {
          setErrorText(eventPlaylistsError.message)
        }
        return
      }

      const playlistIds = (eventPlaylists ?? []).map((row) => row.playlist_id as string)

      if (!playlistIds.length) {
        await loadLibraryFallbackSongs()
        return
      }

      const { data: playlistSongs, error: playlistSongsError } = await supabase
        .from('playlist_songs')
        .select('song_id')
        .in('playlist_id', playlistIds)

      if (playlistSongsError) {
        if (isCurrent) {
          setErrorText(playlistSongsError.message)
        }
        return
      }

      if (!isCurrent) {
        return
      }

      const songIds = [...new Set((playlistSongs ?? [])
        .map((row) => (row as { song_id?: string | null }).song_id)
        .filter((songId): songId is string => Boolean(songId)))]

      if (!songIds.length) {
        await loadLibraryFallbackSongs()
        return
      }

      const { data: librarySongs, error: librarySongsError } = await supabase
        .from('library_songs')
        .select('id, title, artist, cover_url, is_explicit')
        .in('id', songIds)

      if (librarySongsError) {
        if (isCurrent) {
          setErrorText(librarySongsError.message)
        }
        return
      }

      if (!isCurrent) {
        return
      }

      const dedupedSongs = new Map<string, CuratedSong>()

      for (const song of (librarySongs ?? []) as CuratedSong[]) {
        if (!dedupedSongs.has(song.id)) {
          dedupedSongs.set(song.id, song)
        }
      }

      const nextSongs = [...dedupedSongs.values()]
        .sort((left, right) => {
          const leftHasCover = Boolean(left.cover_url && left.cover_url.trim())
          const rightHasCover = Boolean(right.cover_url && right.cover_url.trim())

          if (leftHasCover !== rightHasCover) {
            return leftHasCover ? -1 : 1
          }

          return left.title.localeCompare(right.title)
        })

      const hasAnyCover = nextSongs.some((song) => Boolean(song.cover_url && song.cover_url.trim()))

      if (!hasAnyCover) {
        await loadLibraryFallbackSongs()
        return
      }

      setCuratedSongs(nextSongs)
      setSelectedCuratedSongId((currentSongId) => {
        if (currentSongId && nextSongs.some((song) => song.id === currentSongId)) {
          return currentSongId
        }

        return ''
      })
    }

    void loadCuratedSongs()

    return () => {
      isCurrent = false
    }
  }, [event?.id, playlistOnlyRequests])

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
        const coverUrl = await fetchSongArtwork(song.title, song.artist)

        if (!coverUrl || isCancelled) {
          continue
        }

        const normalizedCoverUrl = normalizeCoverUrl(coverUrl)

        if (!normalizedCoverUrl) {
          continue
        }

        const { error } = await supabase
          .from('library_songs')
          .update({ cover_url: normalizedCoverUrl })
          .eq('id', song.id)

        if (!error && !isCancelled) {
          setCuratedSongs((currentSongs) => currentSongs.map((currentSong) => (
            currentSong.id === song.id ? { ...currentSong, cover_url: normalizedCoverUrl } : currentSong
          )))
        }
      }
    }

    void hydrateArtwork()

    return () => {
      isCancelled = true
    }
  }, [curatedSongs])

  useEffect(() => {
    const previousVotes = previousVotesRef.current
    const increasedSongIds: string[] = []

    for (const song of songs) {
      const previousVotesCount = previousVotes.get(song.id)

      if (typeof previousVotesCount === 'number' && song.votes_count > previousVotesCount) {
        increasedSongIds.push(song.id)
      }
    }

    if (increasedSongIds.length) {
      setVotePulseTicks((currentTicks) => {
        const nextTicks = { ...currentTicks }

        for (const songId of increasedSongIds) {
          nextTicks[songId] = (nextTicks[songId] ?? 0) + 1
        }

        return nextTicks
      })
    }

    previousVotesRef.current = new Map(songs.map((song) => [song.id, song.votes_count]))
  }, [songs])

  useEffect(() => {
    const storedAudienceName = readCommittedAudienceName()

    if (storedAudienceName) {
      setAudienceName(storedAudienceName)
      setAudienceNameInput(storedAudienceName)
    }
  }, [])

  useEffect(() => {
    const eventId = event?.id

    if (!eventId) {
      setPlaybackState(null)
      return
    }

    let isCurrent = true
    let subscription: ReturnType<typeof supabase.channel> | null = null
    let syncTimerId: number | null = null

    const syncPlaybackState = async () => {
      if (!isCurrent) return
      const state = await readSharedPlaybackState(eventId)
      if (isCurrent) {
        setPlaybackState(state)
      }
    }

    const setupSubscription = () => {
      subscription = supabase
        .channel(`playback_state:${eventId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'playback_state',
            filter: `event_id=eq.${eventId}`,
          },
          () => {
            void syncPlaybackState()
          },
        )
        .subscribe()
    }

    const onPlaybackStateEvent = (nextEvent: Event) => {
      const detail = (nextEvent as CustomEvent<{ eventId: string; state: SharedPlaybackState }>).detail

      if (detail?.eventId === eventId) {
        setPlaybackState(detail.state)
      }
    }

    void syncPlaybackState()
    setupSubscription()
    syncTimerId = window.setInterval(() => {
      void syncPlaybackState()
    }, 1200)
    window.addEventListener(PLAYBACK_STATE_EVENT, onPlaybackStateEvent as EventListener)

    return () => {
      isCurrent = false
      if (subscription) {
        void subscription.unsubscribe()
      }
      if (syncTimerId !== null) {
        window.clearInterval(syncTimerId)
      }
      window.removeEventListener(PLAYBACK_STATE_EVENT, onPlaybackStateEvent as EventListener)
    }
  }, [event?.id])

  const submitCuratedSong = async (song: CuratedSong, requestedPerformerMode: PerformerMode) => {
    if (submittingSongId) {
      return
    }

    setErrorText(null)
    setPerformerMode(requestedPerformerMode)
    setSubmittingSongId(song.id)

    try {
      await addSong(song.title, song.artist, song.is_explicit, {
        coverUrl: song.cover_url,
        librarySongId: song.id,
        performerMode: requestedPerformerMode,
      })
      setCuratedSongs((currentSongs) => currentSongs.filter((currentSong) => currentSong.id !== song.id))
      setSelectedCuratedSongId('')
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to add this request. Check room settings and try again.')
    } finally {
      setSubmittingSongId(null)
    }
  }

  const onSubmit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault()
    setErrorText(null)

    if (showCuratedPicker) {
      const selectedSong = curatedSongs.find((song) => song.id === selectedCuratedSongId)

      if (!selectedSong) {
        setErrorText('Choose a song first.')
        return
      }

      await submitCuratedSong(selectedSong, performerMode)

      return
    }

    if (!songTitle.trim() || !artistName.trim()) {
      setErrorText('Enter both song title and artist.')
      return
    }

    try {
      await addSong(songTitle.trim(), artistName.trim(), isExplicit, { performerMode })
      setSongTitle('')
      setArtistName('')
      setIsExplicit(false)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to add this request. Check room settings and try again.')
    }
  }

  const onAudienceNameSubmit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault()

    const normalizedAudienceName = audienceNameInput.trim()

    if (!normalizedAudienceName) {
      setErrorText('Please enter your name to continue.')
      return
    }

    setAudienceName(normalizedAudienceName)
    setErrorText(null)
    commitAudienceName(normalizedAudienceName)
  }

  if (loading) {
    return (
      <section className="audience-entry-shell" aria-label="Audience loading">
        <article className="queue-panel audience-entry-card">
          <p className="eyebrow">Audience App</p>
          <h1>Loading live queue...</h1>
        </article>
      </section>
    )
  }

  if (!audienceName) {
    return (
      <section className="audience-entry-shell" aria-label="Audience entry">
        <article className="queue-panel audience-entry-card">
          <p className="eyebrow audience-entry-eyebrow">Official Audience Lounge</p>
          <h1>{event?.name ?? 'Human Jukebox'}</h1>
          <p className="subcopy audience-entry-copy">
            You are joining the live audience board. Request songs and vote your favorites to the top.
          </p>
          <form className="queue-form audience-entry-form" onSubmit={onAudienceNameSubmit}>
            <div className="field-row">
              <label htmlFor="audience-name" className="audience-entry-label">Your name</label>
              <input
                id="audience-name"
                value={audienceNameInput}
                onChange={(event) => setAudienceNameInput(event.target.value)}
                placeholder="Your name"
                maxLength={40}
                autoFocus
              />
            </div>
            <button type="submit" className="primary-button">Join Audience</button>
          </form>
          {errorText ? <p className="error-text request-error-inline">{errorText}</p> : null}
        </article>
      </section>
    )
  }

  if (!roomOpen) {
    return (
      <section className="audience-entry-shell" aria-label="Audience waiting room">
        <article className="queue-panel audience-entry-card">
          <p className="eyebrow audience-entry-eyebrow">Hi {audienceName}</p>
          <h1>Welcome to the show!</h1>
          <p className="subcopy audience-entry-copy">No pressure - just enjoy yourself and blame the rest on the music.</p>
          {authError ? <p className="error-text request-error-inline">{authError}</p> : null}
          <p className="meta-badge audience-soon-badge">Event starting soon</p>
        </article>
      </section>
    )
  }

  return (
    <section className="audience-shell audience-shell-compact" aria-label="Audience app">
      <section className="audience-stage">
        <div className="panel-head">
          <div>
            <h1>{event?.name ?? 'Audience Live'}</h1>
            {event?.subtitle ? <p className="subcopy audience-event-subtitle">{event.subtitle}</p> : null}
          </div>
          <span className="live-dot">Room Open</span>
        </div>

        <article className="now-playing-card">
          <p className="eyebrow">Now Playing</p>
          {isBetweenSongs ? (
            <div className="now-playing-media now-playing-between-songs">
              <p className="between-songs-quote">{betweenSongQuote}</p>
            </div>
          ) : (
            <div className="now-playing-media">
              {displaySongCoverUrl ? (
                <img src={normalizeCoverUrl(displaySongCoverUrl) ?? displaySongCoverUrl} alt={`Cover art for ${displaySong?.title ?? 'current song'}`} className="song-cover song-cover-large" />
              ) : null}
              <div>
                <h2>{displaySong?.title ?? 'Queue is warming up'}</h2>
                <p className="artist">{displaySong?.artist ?? 'Add the first request below.'}</p>
              </div>
            </div>
          )}
        </article>

        <article className="queue-panel">
          <div className="panel-head">
            <h2>Up Next</h2>
            <span className="meta-badge">Most votes rises first</span>
          </div>
          <ol className="queue-list">
            {upNext.map((song, songIndex) => {
              const voteHeatPercent = hottestVoteCount > 0
                ? Math.round((song.votes_count / hottestVoteCount) * 100)
                : 0

              return (
              <li key={song.id} className="audience-song-row">
                <div className="queue-rank-chip" aria-label={`Rank ${songIndex + 1}`}>
                  #{songIndex + 1}
                </div>
                <div className="queue-song-main">
                  {song.cover_url ? (
                    <img src={normalizeCoverUrl(song.cover_url) ?? song.cover_url} alt={`Cover art for ${song.title}`} className="song-cover" />
                  ) : null}
                  <div>
                  <p className="song">{song.title}</p>
                  <p className="artist">
                    {song.artist}
                    {song.audience_sings ? <span className="karaoke-tag"> - Karaoke</span> : ''}
                    {song.is_explicit ? ' - Explicit' : ''}
                    {song.voting_locked ? ' - Voting Locked' : ''}
                  </p>
                  <div className="vote-heat-track" aria-label={`Vote momentum ${voteHeatPercent}%`}>
                    <span className="vote-heat-fill" style={{ width: `${voteHeatPercent}%` }} />
                  </div>
                  </div>
                </div>
                <div className="queue-actions">
                  <span
                    key={`votes-${song.id}-${votePulseTicks[song.id] ?? 0}`}
                    className={`votes ${(votePulseTicks[song.id] ?? 0) > 0 ? 'votes-pulse' : ''}`}
                  >
                    +{song.votes_count}
                  </span>
                  <button
                    type="button"
                    className="tap-vote like-vote"
                    onClick={async () => {
                      try {
                        await upvoteSong(song.id)
                      } catch {
                        setErrorText('Vote failed. You may have already voted or voting is locked.')
                      }
                    }}
                    disabled={!roomOpen || song.voting_locked}
                  >
                    Like
                  </button>
                </div>
              </li>
              )
            })}
          </ol>
        </article>
        <section className="queue-panel audience-request-panel">
          <div className="panel-head audience-request-head">
            <div>
              <p className="eyebrow audience-request-eyebrow">Request a song</p>
              <h2>Pick tonight's next moment</h2>
            </div>
            {showCuratedPicker ? <span className="meta-badge">Curated setlist</span> : <span className="meta-badge">Open request</span>}
          </div>
          {event?.requestInstructions ? (
            <p className="subcopy audience-request-note">{event.requestInstructions}</p>
          ) : null}
          {duplicateRequestsBlocked || activeRequestCap ? (
            <div className="audience-policy-list">
              {duplicateRequestsBlocked ? <p className="meta-badge audience-policy-badge">Duplicate requests are blocked for this gig.</p> : null}
              {activeRequestCap ? (
                <p className="meta-badge audience-policy-badge">
                  {`Each audience member can keep ${activeRequestCap} active request${activeRequestCap === 1 ? '' : 's'} in the queue.`}
                </p>
              ) : null}
            </div>
          ) : null}
          <form className="queue-form audience-request-form" onSubmit={onSubmit}>
            {showCuratedPicker ? (
              <>
                <div className="field-row">
                  <label htmlFor="song-search">Search songs from tonight's playlists</label>
                  <input
                    id="song-search"
                    value={songSearchQuery}
                    onChange={(event) => setSongSearchQuery(event.target.value)}
                    placeholder="Search title or artist"
                    disabled={!curatedSongs.length}
                  />
                </div>

                {curatedSongs.length ? (
                  <>
                    <div className="picker-view-switch" role="group" aria-label="Song picker layouts">
                      <button
                        type="button"
                        className={`picker-view-chip ${pickerViewMode === 'cards' ? 'is-active' : ''}`}
                        onClick={() => setPickerViewMode('cards')}
                      >
                        Visual Cards
                      </button>
                      <button
                        type="button"
                        className={`picker-view-chip ${pickerViewMode === 'rows' ? 'is-active' : ''}`}
                        onClick={() => setPickerViewMode('rows')}
                      >
                        List Rows
                      </button>
                      <button
                        type="button"
                        className={`picker-view-chip ${pickerViewMode === 'covers' ? 'is-active' : ''}`}
                        onClick={() => setPickerViewMode('covers')}
                      >
                        Cover Wall
                      </button>
                    </div>

                    {selectedCuratedSong ? (
                      <p className="meta-badge audience-policy-badge">
                        Selected: {selectedCuratedSong.title} - {selectedCuratedSong.artist}
                      </p>
                    ) : (
                      <p className="meta-badge audience-policy-badge">Choose a song to continue.</p>
                    )}

                    {availableCuratedSongs.length ? (
                      <div className="curated-picker-scroll-shell">
                        {shouldShowSetlistScrollButton ? (
                          <div className="curated-picker-scroll-head">
                            <p className="curated-picker-scroll-label">Scroll the setlist</p>
                            <button
                              type="button"
                              className="curated-picker-scroll-button"
                              onClick={scrollSetlist}
                            >
                              {isSetlistScrollAtEnd ? 'Back to top' : 'More songs'}
                            </button>
                          </div>
                        ) : null}
                        <div
                          ref={curatedPickerScrollRef}
                          className="curated-picker-scroll-region"
                          onScroll={updateSetlistScrollState}
                        >
                          <ul className={`curated-picker curated-picker-${pickerViewMode} ${selectedCuratedSongId ? 'is-selection-active' : ''}`} aria-label="Curated song choices">
                            {availableCuratedSongs.map((song) => {
                              const isSelected = selectedCuratedSongId === song.id
                              const fallbackInitial = song.title.charAt(0).toUpperCase() || '♪'
                              const isSubmittingThisSong = submittingSongId === song.id

                              return (
                                <li key={song.id} className={`curated-pick-item ${isSelected ? 'is-selected' : ''}`}>
                                  <button
                                    type="button"
                                    className={`curated-pick ${isSelected ? 'is-selected' : ''}`}
                                    disabled={Boolean(submittingSongId)}
                                    onClick={() => {
                                      setSelectedCuratedSongId(song.id)
                                      setErrorText(null)
                                    }}
                                  >
                                    {song.cover_url ? (
                                      <img src={normalizeCoverUrl(song.cover_url) ?? song.cover_url} alt={`Cover art for ${song.title}`} className="curated-pick-cover" />
                                    ) : (
                                      <span className="curated-pick-fallback" aria-hidden="true">{fallbackInitial}</span>
                                    )}
                                    <span className="curated-pick-copy">
                                      <span className="curated-pick-title">{song.title}</span>
                                      <span className="curated-pick-artist">{song.artist}</span>
                                      {song.is_explicit ? <span className="curated-pick-meta">Explicit</span> : null}
                                    </span>
                                    {isSelected ? <span className="curated-selected-pill">Selected</span> : null}
                                  </button>
                                  {isSelected ? (
                                    <div className="curated-performer-overlay" role="group" aria-label="Performer choice">
                                      <p className="curated-performer-overlay-label">Who sings this one?</p>
                                      <div className="curated-performer-overlay-actions">
                                        <button
                                          type="button"
                                          className={`performer-mode-chip ${performerMode === 'performer' ? 'is-active' : ''}`}
                                          disabled={Boolean(submittingSongId)}
                                          onClick={() => {
                                            void submitCuratedSong(song, 'performer')
                                          }}
                                        >
                                          {isSubmittingThisSong ? 'Adding...' : `${performerDisplayName} sings`}
                                        </button>
                                        <button
                                          type="button"
                                          className={`performer-mode-chip karaoke-choice-button ${performerMode === 'audience' ? 'is-active' : ''}`}
                                          disabled={Boolean(submittingSongId)}
                                          onClick={() => {
                                            void submitCuratedSong(song, 'audience')
                                          }}
                                        >
                                          I sing myself
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      </div>
                    ) : (
                      <p className="meta-badge audience-policy-badge">
                        {displayCuratedSongs.length
                          ? 'All matching songs are already in the queue.'
                          : 'No songs matched that search. Try another title or artist.'}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="meta-badge audience-policy-badge">No songs are assigned to this gig yet.</p>
                )}
              </>
            ) : (
              <>
                <div className="field-row">
                  <label htmlFor="song-title">Song title</label>
                  <input
                    id="song-title"
                    value={songTitle}
                    onChange={(event) => setSongTitle(event.target.value)}
                    placeholder="Blinding Lights"
                  />
                </div>
                <div className="field-row">
                  <label htmlFor="artist-name">Artist</label>
                  <input
                    id="artist-name"
                    value={artistName}
                    onChange={(event) => setArtistName(event.target.value)}
                    placeholder="The Weeknd"
                  />
                </div>
                <label className="checkbox-row" htmlFor="song-explicit">
                  <input
                    id="song-explicit"
                    type="checkbox"
                    checked={isExplicit}
                    onChange={(event) => setIsExplicit(event.target.checked)}
                  />
                  Explicit song
                </label>
              </>
            )}

            {!showCuratedPicker && hasSongSelection ? (
              <div className="performer-mode-panel">
                <p className="performer-mode-label">Who should perform this request?</p>
                <div className="performer-mode-toggle" role="group" aria-label="Performer choice">
                  <button
                    type="button"
                    className={`performer-mode-chip ${performerMode === 'performer' ? 'is-active' : ''}`}
                    onClick={() => setPerformerMode('performer')}
                  >
                    {performerDisplayName} sings
                  </button>
                  <button
                    type="button"
                    className={`performer-mode-chip karaoke-choice-button ${performerMode === 'audience' ? 'is-active' : ''}`}
                    onClick={() => setPerformerMode('audience')}
                  >
                    I want to sing it myself
                  </button>
                </div>
                {performerMode === 'audience' ? (
                  <p className="meta-badge audience-policy-badge">This request will be marked as Karaoke in the queue.</p>
                ) : null}
              </div>
            ) : null}

            {!showCuratedPicker && readySongLabel ? (
              <p className="meta-badge audience-policy-badge">Ready to request: {readySongLabel}</p>
            ) : null}

            {!showCuratedPicker ? (
              <button
                type="submit"
                className="primary-button"
              >
                Add Request
              </button>
            ) : null}

            {errorText ? <p className="error-text request-error-inline">{errorText}</p> : null}
          </form>
        </section>
      </section>
    </section>
  )
}

export default EventPage
