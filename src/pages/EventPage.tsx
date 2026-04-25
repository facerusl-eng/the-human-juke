import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
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
import { supabase } from '../lib/supabase'
import { setEventOGTags, resetOGTags } from '../lib/metaTags'

type HostProfile = {
  display_name: string | null
  instagram_url: string | null
  tiktok_url: string | null
  youtube_url: string | null
  facebook_url: string | null
  paypal_url: string | null
  mobilpay_url: string | null
}

const MAX_AUDIENCE_NAME_LENGTH = 40

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

function hasUnsafeControlChars(value: string) {
  return /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value)
}

function normalizeExternalLink(url: string | null | undefined) {
  const trimmedUrl = url?.trim()

  if (!trimmedUrl) {
    return null
  }

  const withProtocol = /^https?:\/\//i.test(trimmedUrl)
    ? trimmedUrl
    : `https://${trimmedUrl}`

  try {
    const normalizedUrl = new URL(withProtocol)

    if (!['http:', 'https:'].includes(normalizedUrl.protocol)) {
      return null
    }

    return normalizedUrl.toString()
  } catch {
    return null
  }
}

function EventPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { authError } = useAuthStore()
  const {
    event,
    songs,
    performedSongs,
    loading,
    upvoteSong,
  } = useQueueStore()

  const [hostProfile, setHostProfile] = useState<HostProfile | null>(null)
  const [audienceNameInput, setAudienceNameInput] = useState('')
  const [audienceName, setAudienceName] = useState('')
  const [audienceNameError, setAudienceNameError] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [confirmationText, setConfirmationText] = useState<string | null>(null)
  const [votingSongIds, setVotingSongIds] = useState<Record<string, boolean>>({})
  const [votePulseTicks, setVotePulseTicks] = useState<Record<string, number>>({})
  const [songMoveTicks, setSongMoveTicks] = useState<Record<string, number>>({})
  const [playbackState, setPlaybackState] = useState<SharedPlaybackState | null>(null)

  const previousVotesRef = useRef<Map<string, number>>(new Map())
  const previousSongRanksRef = useRef<Map<string, number>>(new Map())

  const roomOpen = event?.roomOpen ?? false
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
    ? songs.filter((song) => song.id !== activeSong?.id)
    : songs.slice(1)
  const isBetweenSongs = playbackState && !playbackState.isStarted
  const betweenSongQuote = isBetweenSongs
    ? BETWEEN_SONG_QUOTES[(playbackState?.quoteIndex ?? 0) % BETWEEN_SONG_QUOTES.length]
    : null
  const hottestVoteCount = upNext.reduce((highestVotes, song) => Math.max(highestVotes, song.votes_count), 0)
  const recentlyPlayedSongs = performedSongs.slice(0, 8)

  const socialLinks = useMemo(() => ([
    { label: 'Instagram', url: hostProfile?.instagram_url },
    { label: 'TikTok', url: hostProfile?.tiktok_url },
    { label: 'YouTube', url: hostProfile?.youtube_url },
    { label: 'Facebook', url: hostProfile?.facebook_url },
  ]
    .map((link) => ({ ...link, url: normalizeExternalLink(link.url) }))
    .filter((link): link is { label: string; url: string } => Boolean(link.url))), [hostProfile])

  const tipLinks = useMemo(() => ([
    { label: 'MobilePay', url: hostProfile?.mobilpay_url },
    { label: 'PayPal', url: hostProfile?.paypal_url },
  ]
    .map((link) => ({ ...link, url: normalizeExternalLink(link.url) }))
    .filter((link): link is { label: string; url: string } => Boolean(link.url))), [hostProfile])

  useEffect(() => {
    const state = location.state as { requestConfirmation?: string } | null

    if (!state?.requestConfirmation) {
      return
    }

    setConfirmationText(state.requestConfirmation)
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })

    const timerId = window.setTimeout(() => {
      setConfirmationText(null)
    }, 2600)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [location.pathname, location.search, location.state, navigate])

  useEffect(() => {
    const storedAudienceName = readCommittedAudienceName()

    if (storedAudienceName) {
      setAudienceName(storedAudienceName)
      setAudienceNameInput(storedAudienceName)
    }
  }, [])

  useEffect(() => {
    let isCurrent = true

    const loadHostProfile = async () => {
      try {
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
      } catch (error) {
        console.warn('EventPage: failed to load host profile', error)
        if (isCurrent) {
          setHostProfile(null)
        }
      }
    }

    void loadHostProfile()

    return () => {
      isCurrent = false
    }
  }, [event?.hostId])

  // Update OG meta tags for social media sharing
  useEffect(() => {
    if (!event) {
      resetOGTags()
      return
    }

    const description = event.venue
      ? `Join the queue at ${event.name} in ${event.venue}. Request songs and vote with the audience!`
      : `Join the queue for ${event.name}. Request songs and vote with the audience!`

    setEventOGTags(event.name, description, undefined, typeof window !== 'undefined' ? window.location.href : undefined)
  }, [event?.id, event?.name, event?.venue])

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

      try {
        const state = await readSharedPlaybackState(eventId)
        if (isCurrent) {
          setPlaybackState(state)
        }
      } catch (error) {
        console.warn('EventPage: playback sync failed', error)
      }
    }

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

    const onPlaybackStateEvent = (nextEvent: Event) => {
      const detail = (nextEvent as CustomEvent<{ eventId: string; state: SharedPlaybackState }>).detail

      if (detail?.eventId === eventId) {
        setPlaybackState(detail.state)
      }
    }

    void syncPlaybackState()
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

  const onAudienceNameSubmit = (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault()
    setAudienceNameError(null)

    const normalizedAudienceName = audienceNameInput.trim()

    if (!normalizedAudienceName) {
      setAudienceNameError('Please enter your name to continue.')
      setErrorText('Please enter your name to continue.')
      return
    }

    if (normalizedAudienceName.length > MAX_AUDIENCE_NAME_LENGTH) {
      setAudienceNameError(`Please keep your name under ${MAX_AUDIENCE_NAME_LENGTH} characters.`)
      setErrorText(`Please keep your name under ${MAX_AUDIENCE_NAME_LENGTH} characters.`)
      return
    }

    if (hasUnsafeControlChars(normalizedAudienceName)) {
      setAudienceNameError('Please remove unsupported characters from your name.')
      setErrorText('Please remove unsupported characters from your name.')
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
                required
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

        <section className="queue-panel audience-start-actions-panel" aria-label="Audience actions">
          <div className="panel-head audience-request-head">
            <div>
              <p className="eyebrow audience-request-eyebrow">Audience Home</p>
              <h2>Hi {audienceName}</h2>
            </div>
            <span className="meta-badge">Room Open</span>
          </div>
          {confirmationText ? <p className="meta-badge audience-policy-badge" role="status" aria-live="polite">{confirmationText}</p> : null}
          {errorText ? <p className="error-text request-error-inline">{errorText}</p> : null}
          <div className="audience-start-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                navigate(`/audience/song-list${location.search || ''}`)
              }}
            >
              Song List
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                document.getElementById('audience-tip-jar')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              disabled={tipLinks.length === 0}
            >
              Tip Jar
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                document.getElementById('audience-social-links')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              disabled={socialLinks.length === 0}
            >
              Social Links
            </button>
          </div>
          {event?.requestInstructions ? <p className="subcopy audience-request-note">{event.requestInstructions}</p> : null}
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
        </section>

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
                <p className="artist">{displaySong?.artist ?? 'Open Song List to add a request.'}</p>
              </div>
            </div>
          )}
        </article>

        <article className="queue-panel">
          <div className="panel-head">
            <h2>Live Queue</h2>
            <span className="meta-badge">Most votes rises first</span>
          </div>
          <ol className="queue-list">
            {upNext.length === 0 ? <li className="subcopy">No songs queued yet.</li> : null}
            {upNext.map((song, songIndex) => (
              <SongVoteCard
                key={song.id}
                song={song}
                rank={songIndex + 1}
                hottestVoteCount={hottestVoteCount}
                votePulseTick={votePulseTicks[song.id] ?? 0}
                moveTick={songMoveTicks[song.id] ?? 0}
                normalizeCoverUrl={normalizeCoverUrl}
                disabled={!roomOpen || song.voting_locked || Boolean(votingSongIds[song.id])}
                isVoting={Boolean(votingSongIds[song.id])}
                onVote={async (songId) => {
                  if (votingSongIds[songId]) {
                    return
                  }

                  setVotingSongIds((currentState) => ({ ...currentState, [songId]: true }))

                  try {
                    await upvoteSong(songId)
                  } catch {
                    setErrorText('Vote failed. You may have already voted or voting is locked.')
                  } finally {
                    setVotingSongIds((currentState) => {
                      const nextState = { ...currentState }
                      delete nextState[songId]
                      return nextState
                    })
                  }
                }}
              />
            ))}
          </ol>
        </article>

        <article className="queue-panel" aria-label="Played songs">
          <div className="panel-head">
            <h2>Played Songs</h2>
            <span className="meta-badge">Latest on top</span>
          </div>
          <ol className="queue-list">
            {recentlyPlayedSongs.length === 0 ? <li className="subcopy">No songs played yet.</li> : null}
            {recentlyPlayedSongs.map((song, index) => (
              <li key={`${song.id}-${song.performedAt}`} className="audience-song-row">
                <span className="queue-rank-chip" aria-label={`Played position ${index + 1}`}>
                  {index + 1}
                </span>
                <div className="queue-song-main audience-song-main">
                  {song.cover_url ? (
                    <img
                      src={normalizeCoverUrl(song.cover_url) ?? song.cover_url}
                      alt={`Cover art for ${song.title}`}
                      className="song-cover"
                    />
                  ) : <span className="song-cover song-cover-fallback" aria-hidden="true">♪</span>}
                  <div>
                    <p className="song">{song.title}</p>
                    <p className="artist">{song.artist}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </article>

        {socialLinks.length > 0 || tipLinks.length > 0 ? (
          <section className="queue-panel link-panel" aria-label="Performer links">
            {socialLinks.length > 0 ? (
              <>
                <div className="panel-head" id="audience-social-links">
                  <h2>Social Links</h2>
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
                <div className="panel-head" id="audience-tip-jar">
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
