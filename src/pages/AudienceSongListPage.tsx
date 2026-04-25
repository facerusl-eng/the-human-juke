import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { readCommittedAudienceName } from '../lib/audienceIdentity'
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
}

type PerformerMode = 'performer' | 'audience'

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
  const [songSearchQuery, setSongSearchQuery] = useState('')
  const [loadingSongs, setLoadingSongs] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [selectedSong, setSelectedSong] = useState<CuratedSong | null>(null)
  const [submittingMode, setSubmittingMode] = useState<PerformerMode | null>(null)

  const audienceName = readCommittedAudienceName()
  const performerDisplayName = 'Performer'
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

  const groupedSongs = useMemo(() => (
    availableSongs.map((song, index) => {
      const title = normalizeDisplayText(song.title, 'Untitled Song')
      const artist = normalizeDisplayText(song.artist, 'Unknown Artist')
      const songKey = title.charAt(0).toUpperCase() || '#'
      const previousSong = availableSongs[index - 1]
      const previousTitle = previousSong ? normalizeDisplayText(previousSong.title, 'Untitled Song') : ''
      const previousSongKey = previousTitle.charAt(0).toUpperCase() || '#'

      return {
        song,
        title,
        artist,
        sectionLabel: index === 0 || songKey !== previousSongKey ? songKey : null,
      }
    })
  ), [availableSongs])

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
  }, [event?.id, event?.name, event?.venue])

  useEffect(() => {
    let isCurrent = true

    const loadCuratedSongs = async () => {
      setLoadingSongs(true)
      setErrorText(null)

      const loadFallbackSongs = async () => {
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

        const nextSongsSource = (coveredFallbackSongs ?? []) as CuratedSong[]

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
            const nextSongs = ((fallbackSongs ?? []) as CuratedSong[])
              .sort((left, right) => left.title.localeCompare(right.title))
            setCuratedSongs(nextSongs)
          }
          return
        }

        if (isCurrent) {
          const nextSongs = nextSongsSource
            .sort((left, right) => left.title.localeCompare(right.title))
          setCuratedSongs(nextSongs)
        }
      }

      try {
        if (!event?.id) {
          await loadFallbackSongs()
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
          await loadFallbackSongs()
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

        const songIds = [...new Set((playlistSongs ?? [])
          .map((row) => (row as { song_id?: string | null }).song_id)
          .filter((songId): songId is string => Boolean(songId)))]

        if (!songIds.length) {
          await loadFallbackSongs()
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

        if (isCurrent) {
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

          setCuratedSongs(nextSongs)
        }
      } catch (error) {
        console.warn('AudienceSongListPage: failed to load songs', error)
        if (isCurrent) {
          setErrorText('Unable to load song choices right now. Please try again.')
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
  }, [event?.id])

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
        let coverUrl: string | null = null

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

    setSubmittingMode(mode)
    setErrorText(null)

    try {
      await addSong(selectedSong.title, selectedSong.artist, selectedSong.is_explicit, {
        coverUrl: selectedSong.cover_url,
        librarySongId: selectedSong.id,
        performerMode: mode,
      })

      navigate(`/audience${location.search || ''}`, {
        replace: true,
        state: {
          requestConfirmation: mode === 'audience'
            ? 'Request added. Karaoke mode selected.'
            : 'Request added to the queue.',
        },
      })
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Unable to add this request right now.')
      setSubmittingMode(null)
    }
  }

  return (
    <section className="audience-song-list-shell" aria-label="Song list page">
      <header className="audience-song-list-header">
        <button
          type="button"
          className="secondary-button audience-song-list-back"
          onClick={() => {
            navigate(`/audience${location.search || ''}`, { replace: true })
          }}
        >
          Back
        </button>
        <div className="audience-song-list-header-copy">
          <p className="eyebrow">Song List</p>
          <h1>Pick a song</h1>
          <p className="subcopy">Hi {audienceName || 'Guest'} - scroll and choose your next request.</p>
        </div>
      </header>

      <section className="audience-song-list-search">
        <label htmlFor="audience-song-list-search-input">Search songs</label>
        <input
          id="audience-song-list-search-input"
          value={songSearchQuery}
          onChange={(event) => setSongSearchQuery(event.target.value)}
          placeholder="Search by song title or artist"
        />
      </section>

      {event?.requestInstructions ? <p className="subcopy audience-song-list-note">{event.requestInstructions}</p> : null}

      {loadingSongs ? <p className="meta-badge audience-policy-badge" role="status" aria-live="polite">Loading songs...</p> : null}
      {errorText ? <p className="error-text request-error-inline">{errorText}</p> : null}

      {!loadingSongs ? (
        <div className="audience-song-list-scroll">
          <p className="curated-picker-results" aria-live="polite">
            {groupedSongs.length} song{groupedSongs.length === 1 ? '' : 's'} available
          </p>
          <ul className="audience-song-list-grid" aria-label="Song choices">
            {groupedSongs.map(({ song, title, artist, sectionLabel }) => (
              <li key={song.id} className="audience-song-list-item">
                {sectionLabel ? <p className="curated-section-label" aria-hidden="true">{sectionLabel}</p> : null}
                <button
                  type="button"
                  className="audience-song-list-card"
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
                    {song.is_explicit ? <span className="curated-pick-meta">Explicit</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!groupedSongs.length ? (
            <p className="meta-badge audience-policy-badge">
              {curatedSongs.length ? 'All matching songs are already in queue.' : 'No songs are assigned to this gig yet.'}
            </p>
          ) : null}
        </div>
      ) : null}

      {selectedSong ? (
        <aside className="audience-song-choice-overlay" aria-label="Choose who sings" role="dialog" aria-modal="true">
          <div className="audience-song-choice-sheet">
            <p className="eyebrow">Selected</p>
            <h2>{normalizeDisplayText(selectedSong.title, 'Untitled Song')}</h2>
            <p className="subcopy">{normalizeDisplayText(selectedSong.artist, 'Unknown Artist')}</p>
            <div className="audience-song-choice-actions">
              <button
                type="button"
                className="primary-button audience-song-choice-button"
                disabled={Boolean(submittingMode)}
                onClick={() => {
                  void submitSongRequest('performer')
                }}
              >
                {submittingMode === 'performer' ? 'Adding...' : `${performerDisplayName} sings the song`}
              </button>
              <button
                type="button"
                className="secondary-button audience-song-choice-button"
                disabled={Boolean(submittingMode)}
                onClick={() => {
                  void submitSongRequest('audience')
                }}
              >
                {submittingMode === 'audience' ? 'Adding...' : 'I want to sing the song'}
              </button>
              <button
                type="button"
                className="tertiary-button audience-song-choice-button"
                disabled={Boolean(submittingMode)}
                onClick={() => setSelectedSong(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </aside>
      ) : null}
    </section>
  )
}

export default AudienceSongListPage
