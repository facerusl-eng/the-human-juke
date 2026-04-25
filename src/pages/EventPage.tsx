import { useState, useEffect, useRef } from 'react'
import type { FormEvent } from 'react'
import AudienceFixedHeader from '../components/audience/AudienceFixedHeader'
import SongVoteCard from '../components/audience/SongVoteCard'
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
  mobilpay_url: string | null
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
type SongRequestErrors = {
  songTitle?: string
  artistName?: string
  selection?: string
}

function EventPage() {
  const [hostProfile, setHostProfile] = useState<HostProfile | null>(null)
  const { authError } = useAuthStore()
  const {
    event,
    songs,
    loading,
    addSong,
    upvoteSong,
  } = useQueueStore()

  useEffect(() => {
    let isCurrent = true

    const loadHostProfile = async () => {
      const hostId = event?.hostId

      const baseQuery = supabase
        .from('profiles')
        .select('display_name, instagram_url, tiktok_url, youtube_url, facebook_url, paypal_url, mobilpay_url')

      const query = hostId
        ? baseQuery.eq('user_id', hostId).maybeSingle()
        : baseQuery.eq('role', 'host').limit(1).maybeSingle()

      const { data } = await query

      if (isCurrent) {
        setHostProfile((data as HostProfile | null) ?? null)
      }
    }

    void loadHostProfile()

    return () => {
      isCurrent = false
    }
  }, [event?.hostId])
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
  const [audienceNameError, setAudienceNameError] = useState<string | null>(null)
  const [songRequestErrors, setSongRequestErrors] = useState<SongRequestErrors>({})
  const [errorText, setErrorText] = useState<string | null>(null)
  const [submittingSongId, setSubmittingSongId] = useState<string | null>(null)
  const [votePulseTicks, setVotePulseTicks] = useState<Record<string, number>>({})
  const [songMoveTicks, setSongMoveTicks] = useState<Record<string, number>>({})
  const [playbackState, setPlaybackState] = useState<SharedPlaybackState | null>(null)
  const [canScrollSetlist, setCanScrollSetlist] = useState(false)
  const [isSetlistScrollAtEnd, setIsSetlistScrollAtEnd] = useState(false)
  const previousVotesRef = useRef<Map<string, number>>(new Map())
  const previousSongRanksRef = useRef<Map<string, number>>(new Map())
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
  const socialLinks = [
    { label: 'Instagram', url: hostProfile?.instagram_url },
    { label: 'TikTok', url: hostProfile?.tiktok_url },
    { label: 'YouTube', url: hostProfile?.youtube_url },
    { label: 'Facebook', url: hostProfile?.facebook_url },
  ].filter((link): link is { label: string; url: string } => Boolean(link.url?.trim()))
  const tipLinks = [
    { label: 'MobilePay', url: hostProfile?.mobilpay_url },
    { label: 'PayPal', url: hostProfile?.paypal_url },
  ].filter((link): link is { label: string; url: string } => Boolean(link.url?.trim()))
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
    const previousSongRanks = previousSongRanksRef.current
    const movedSongIds: string[] = []

    for (const song of songs) {
      const previousVotesCount = previousVotes.get(song.id)

      if (typeof previousVotesCount === 'number' && song.votes_count > previousVotesCount) {
        increasedSongIds.push(song.id)
      }

      const previousRank = previousSongRanks.get(song.id)
      const nextRank = upNext.findIndex((upNextSong) => upNextSong.id === song.id)

      if (typeof previousRank === 'number' && nextRank >= 0 && previousRank !== nextRank) {
        movedSongIds.push(song.id)
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

    if (movedSongIds.length) {
      setSongMoveTicks((currentTicks) => {
        const nextTicks = { ...currentTicks }

        for (const songId of movedSongIds) {
          nextTicks[songId] = (nextTicks[songId] ?? 0) + 1
        }

        return nextTicks
      })
    }

    previousVotesRef.current = new Map(songs.map((song) => [song.id, song.votes_count]))
    previousSongRanksRef.current = new Map(upNext.map((song, index) => [song.id, index]))
  }, [songs, upNext])

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
    setSongRequestErrors({})

    if (showCuratedPicker) {
      const selectedSong = curatedSongs.find((song) => song.id === selectedCuratedSongId)

      if (!selectedSong) {
        setSongRequestErrors({ selection: 'Please select a song from the setlist first.' })
        setErrorText('Choose a song first.')
        return
      }

      await submitCuratedSong(selectedSong, performerMode)

      return
    }

    const nextErrors: SongRequestErrors = {}

    if (!songTitle.trim()) {
      nextErrors.songTitle = 'Song title is required.'
    }

    if (!artistName.trim()) {
      nextErrors.artistName = 'Artist is required.'
    }

    if (nextErrors.songTitle || nextErrors.artistName) {
      setSongRequestErrors(nextErrors)
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
    setAudienceNameError(null)

    const normalizedAudienceName = audienceNameInput.trim()

    if (!normalizedAudienceName) {
      setAudienceNameError('Please enter your name to continue.')
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
                placeholder="e.g. Alex"
                maxLength={40}
                aria-describedby={audienceNameError ? 'audience-name-error' : undefined}
                autoFocus
              />
            </div>
            {audienceNameError ? <p id="audience-name-error" className="error-text request-error-inline" role="alert">{audienceNameError}</p> : null}
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
    <section className="audience-shell audience-shell-compact audience-shell-modern" aria-label="Audience app">
      <section className="audience-stage">
        <AudienceFixedHeader
          eventName={event?.name ?? 'Audience Live'}
          subtitle={event?.subtitle ?? null}
          logoSrc="/the-human-jukebox-logo.svg"
        />

        <div className="panel-head audience-stage-status">
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
            {upNext.map((song, songIndex) => (
              <SongVoteCard
                key={song.id}
                song={song}
                rank={songIndex + 1}
                hottestVoteCount={hottestVoteCount}
                votePulseTick={votePulseTicks[song.id] ?? 0}
                moveTick={songMoveTicks[song.id] ?? 0}
                normalizeCoverUrl={normalizeCoverUrl}
                disabled={!roomOpen || song.voting_locked}
                onVote={async (songId) => {
                  try {
                    await upvoteSong(songId)
                  } catch {
                    setErrorText('Vote failed. You may have already voted or voting is locked.')
                  }
                }}
              />
            ))}
          </ol>
        </article>
        <section className={`queue-panel audience-request-panel ${submittingSongId ? 'is-submitting' : ''}`}>
          <div className="panel-head audience-request-head">
            <div>
              <p className="eyebrow audience-request-eyebrow">Request a song</p>
              <h2>Pick tonight's next moment</h2>
            </div>
            {showCuratedPicker ? <span className="meta-badge">Curated setlist</span> : <span className="meta-badge">Open request</span>}
          </div>
          {showCuratedPicker ? (
            <p className="subcopy audience-request-note">Pick a song, choose who sings, then tap Add Request.</p>
          ) : null}
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
                    placeholder="Search by song title or artist"
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
                      <div className="curated-selected-summary" role="status" aria-live="polite">
                        <p className="curated-selected-summary-label">Selected song</p>
                        <p className="curated-selected-summary-title">{selectedCuratedSong.title}</p>
                        <p className="curated-selected-summary-artist">{selectedCuratedSong.artist}</p>
                        <p className="performer-mode-label">Who should sing this one?</p>
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
                            I want to sing
                          </button>
                        </div>
                        {performerMode === 'audience' ? (
                          <p className="meta-badge audience-policy-badge">This request will be marked as Karaoke in the queue.</p>
                        ) : null}
                        <button
                          type="button"
                          className="primary-button"
                          aria-label={`Request ${selectedCuratedSong.title} by ${selectedCuratedSong.artist}`}
                          disabled={Boolean(submittingSongId)}
                          onClick={() => {
                            void submitCuratedSong(selectedCuratedSong, performerMode)
                          }}
                        >
                          {submittingSongId ? 'Adding...' : 'Request Song'}
                        </button>
                        <button
                          type="button"
                          className="tertiary-button"
                          onClick={() => setSelectedCuratedSongId('')}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p className="meta-badge audience-policy-badge">Choose a song to continue.</p>
                    )}
                    {songRequestErrors.selection ? <p className="error-text request-error-inline" role="alert">{songRequestErrors.selection}</p> : null}

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
                    aria-describedby={songRequestErrors.songTitle ? 'song-title-error' : undefined}
                    placeholder="Blinding Lights"
                  />
                  {songRequestErrors.songTitle ? <p id="song-title-error" className="error-text request-error-inline" role="alert">{songRequestErrors.songTitle}</p> : null}
                </div>
                <div className="field-row">
                  <label htmlFor="artist-name">Artist</label>
                  <input
                    id="artist-name"
                    value={artistName}
                    onChange={(event) => setArtistName(event.target.value)}
                    aria-describedby={songRequestErrors.artistName ? 'artist-name-error' : undefined}
                    placeholder="The Weeknd"
                  />
                  {songRequestErrors.artistName ? <p id="artist-name-error" className="error-text request-error-inline" role="alert">{songRequestErrors.artistName}</p> : null}
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

            {readySongLabel ? (
              <p className="meta-badge audience-policy-badge">Ready to request: {readySongLabel}</p>
            ) : null}

            <button
              type="submit"
              className="primary-button"
              aria-label="Request Song"
              disabled={!hasSongSelection || Boolean(submittingSongId)}
            >
              {submittingSongId ? 'Adding...' : 'Request Song'}
            </button>

            {!showCuratedPicker ? (
              <button
                type="button"
                className="tertiary-button"
                onClick={() => {
                  setSongTitle('')
                  setArtistName('')
                  setIsExplicit(false)
                  setSongRequestErrors({})
                  setErrorText(null)
                }}
              >
                Cancel
              </button>
            ) : null}

            {errorText ? <p className="error-text request-error-inline">{errorText}</p> : null}
          </form>
        </section>

        {socialLinks.length > 0 || tipLinks.length > 0 ? (
          <section className="queue-panel link-panel" aria-label="Performer links">
            {socialLinks.length > 0 ? (
              <>
                <div className="panel-head">
                  <h2>Follow</h2>
                </div>
                <ul className="link-list" aria-label="Social media links">
                  {socialLinks.map((link) => (
                    <li key={link.label}>
                      <a className="link-chip" href={link.url} target="_blank" rel="noreferrer">
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {tipLinks.length > 0 ? (
              <>
                <div className="panel-head">
                  <h2>Tip Jar</h2>
                </div>
                <p className="subcopy">To tip... or not to tip... that is the question. But the answer is yes</p>
                <ul className="link-list" aria-label="Tip links">
                  {tipLinks.map((link) => (
                    <li key={link.label}>
                      <a className="link-chip tip-chip" href={link.url} target="_blank" rel="noreferrer">
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}
      </section>
    </section>
  )
}

export default EventPage
