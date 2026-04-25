import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAudienceUrl } from '../lib/audienceUrl'
import { BETWEEN_SONG_QUOTES, readSharedPlaybackState, writeSharedPlaybackState } from '../lib/playbackState'
import { useQueueStore } from '../state/queueStore'

function GigControlPage() {
  const navigate = useNavigate()
  const {
    event,
    hostEvents,
    songs,
    performedSongs,
    loading,
    addSong,
    markPlayed,
    removeSong,
    setActiveEvent,
    toggleRoomOpen,
    toggleExplicitFilter,
  } = useQueueStore()

  const [errorText, setErrorText] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualArtist, setManualArtist] = useState('')
  const [manualExplicit, setManualExplicit] = useState(false)
  const [manualKaraoke, setManualKaraoke] = useState(false)
  const [isNowPlayingStarted, setIsNowPlayingStarted] = useState(false)
  const [spaceActionBusy, setSpaceActionBusy] = useState(false)
  const [switchingGigId, setSwitchingGigId] = useState<string | null>(null)
  const [betweenSongQuoteIndex, setBetweenSongQuoteIndex] = useState(0)
  const quoteIndexRef = useRef(0)
  const previousSongIdRef = useRef<string | null>(null)

  const nowPlaying = songs[0]
  const upNext = isNowPlayingStarted ? songs.slice(1) : songs
  const upNextStartPosition = isNowPlayingStarted ? 2 : 1
  const joinUrl = getAudienceUrl(event?.id)
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(joinUrl)}`
  const betweenSongQuote = BETWEEN_SONG_QUOTES[betweenSongQuoteIndex]

  const copyJoinUrl = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
      return
    } catch {
      // Fall back to a hidden textarea when clipboard permissions are blocked.
    }

    try {
      const fallbackInput = document.createElement('textarea')
      fallbackInput.value = joinUrl
      fallbackInput.setAttribute('readonly', '')
      fallbackInput.style.position = 'fixed'
      fallbackInput.style.left = '-9999px'
      document.body.appendChild(fallbackInput)
      fallbackInput.select()
      const copiedWithFallback = document.execCommand('copy')
      document.body.removeChild(fallbackInput)

      if (!copiedWithFallback) {
        throw new Error('copy-failed')
      }

      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setErrorText('Copy failed. You can still select and copy the audience link manually.')
    }
  }

  const resolveCoverUrlForSong = (songId: string | null) => {
    if (!songId) {
      return null
    }

    return songs.find((song) => song.id === songId)?.cover_url ?? null
  }

  useEffect(() => {
    const activeEventId = event?.id

    setSpaceActionBusy(false)

    if (!activeEventId) {
      setIsNowPlayingStarted(false)
      previousSongIdRef.current = null
      return
    }

    let isCurrent = true

    const initializePlaybackState = async () => {
      const sharedPlaybackState = await readSharedPlaybackState(activeEventId)

      if (!isCurrent) return

      if (!nowPlaying?.id) {
        setIsNowPlayingStarted(false)
        previousSongIdRef.current = null

        await writeSharedPlaybackState(activeEventId, {
          currentSongId: null,
          currentSongCoverUrl: null,
          isStarted: false,
          quoteIndex: sharedPlaybackState?.quoteIndex ?? quoteIndexRef.current,
        })
        return
      }

      if (sharedPlaybackState) {
        const normalizedQuoteIndex = sharedPlaybackState.quoteIndex % BETWEEN_SONG_QUOTES.length
        quoteIndexRef.current = normalizedQuoteIndex
        setBetweenSongQuoteIndex(normalizedQuoteIndex)

        if (sharedPlaybackState.currentSongId === nowPlaying.id) {
          setIsNowPlayingStarted(sharedPlaybackState.isStarted)
          previousSongIdRef.current = nowPlaying.id
          return
        }
      }

      setIsNowPlayingStarted(false)
      await writeSharedPlaybackState(activeEventId, {
        currentSongId: nowPlaying.id,
        currentSongCoverUrl: resolveCoverUrlForSong(nowPlaying.id),
        isStarted: false,
        quoteIndex: quoteIndexRef.current,
      })

      previousSongIdRef.current = nowPlaying.id
    }

    void initializePlaybackState()

    return () => {
      isCurrent = false
    }
  }, [event?.id, nowPlaying?.id])

  const setQuoteIndex = (nextQuoteIndex: number) => {
    quoteIndexRef.current = nextQuoteIndex
    setBetweenSongQuoteIndex(nextQuoteIndex)
  }

  const syncStartedState = async (nextStarted: boolean, nextSongId = nowPlaying?.id ?? null) => {
    setIsNowPlayingStarted(nextStarted)

    if (!event?.id) {
      return
    }

    await writeSharedPlaybackState(event.id, {
      currentSongId: nextSongId,
      currentSongCoverUrl: resolveCoverUrlForSong(nextSongId),
      isStarted: nextStarted,
      quoteIndex: quoteIndexRef.current,
    })
  }

  const beginBetweenSongsTransition = async () => {
    const previousQuoteIndex = quoteIndexRef.current
    const nextQuoteIndex = (previousQuoteIndex + 1) % BETWEEN_SONG_QUOTES.length

    setQuoteIndex(nextQuoteIndex)
    await syncStartedState(false, songs[1]?.id ?? null)

    return previousQuoteIndex
  }

  const restoreStartedSong = async (previousQuoteIndex: number) => {
    setQuoteIndex(previousQuoteIndex)
    await syncStartedState(true, nowPlaying?.id ?? null)
  }

  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      if (event.key !== ' ') {
        return
      }

      const activeElement = document.activeElement as HTMLElement | null
      const tag = activeElement?.tagName
      const isTypingTarget =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        activeElement?.isContentEditable

      if (isTypingTarget || !nowPlaying || spaceActionBusy) {
        return
      }

      event.preventDefault()

      if (!isNowPlayingStarted) {
        await syncStartedState(true)
        return
      }

      setSpaceActionBusy(true)
      const previousQuoteIndex = await beginBetweenSongsTransition()
      void markPlayed()
        .catch(async () => {
          await restoreStartedSong(previousQuoteIndex)
          setErrorText('Failed to mark as played.')
        })
        .finally(() => {
          setSpaceActionBusy(false)
        })
    }

    window.addEventListener('keydown', onKeyDown as unknown as EventListener)
    return () => window.removeEventListener('keydown', onKeyDown as unknown as EventListener)
  }, [isNowPlayingStarted, markPlayed, nowPlaying, spaceActionBusy])

  const onManualAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorText(null)

    if (!manualTitle.trim() || !manualArtist.trim()) {
      setErrorText('Enter both song title and artist for manual add.')
      return
    }

    try {
      await addSong(manualTitle.trim(), manualArtist.trim(), manualExplicit, {
        performerMode: manualKaraoke ? 'audience' : 'performer',
        bypassEventRules: true,
      })
      setManualTitle('')
      setManualArtist('')
      setManualExplicit(false)
      setManualKaraoke(false)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to add song manually.')
    }
  }

  if (loading) {
    return <section className="gig-control-shell"><p className="subcopy">Loading gig data…</p></section>
  }

  if (!event) {
    return (
      <section className="gig-control-shell" aria-label="Gig control">
        <section className="hero-card admin-card">
          <p className="eyebrow">No active gig</p>
          <h1>No Gig Running</h1>
          <p className="subcopy">Create a gig first to start accepting requests.</p>
          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={() => navigate('/admin/create-gig')}>
              Create Gig
            </button>
          </div>
        </section>
      </section>
    )
  }

  return (
    <section className="gig-control-shell" aria-label="Gig control panel">
      {/* Gig header */}
      <section className="gig-control-top-grid">
        <article className="gig-control-header gig-control-main-card">
          <div>
            <p className="gig-control-card-label">Live Control</p>
            {hostEvents.length > 1 ? (
              <div className="gig-switcher">
                <label htmlFor="gig-switcher" className="gig-switcher-label">Choose gig</label>
                <select
                  id="gig-switcher"
                  className="gig-switcher-select"
                  value={event.id}
                  disabled={Boolean(switchingGigId)}
                  onChange={async (changeEvent) => {
                    const nextGigId = changeEvent.target.value

                    if (!nextGigId || nextGigId === event.id) {
                      return
                    }

                    setErrorText(null)
                    setSwitchingGigId(nextGigId)

                    try {
                      await setActiveEvent(nextGigId)
                    } catch (error) {
                      setErrorText(error instanceof Error ? error.message : 'Failed to switch gig.')
                    } finally {
                      setSwitchingGigId(null)
                    }
                  }}
                >
                  {hostEvents.map((hostEvent) => (
                    <option key={hostEvent.id} value={hostEvent.id}>
                      {hostEvent.name}{hostEvent.venue ? ` - ${hostEvent.venue}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <h1>{event.name}</h1>
            {event.venue ? <p className="subcopy no-margin">{event.venue}</p> : null}
            {event.subtitle ? <p className="subcopy gig-event-subtitle">{event.subtitle}</p> : null}
            <p className="subcopy gig-playback-note">
              Admin playback control is driven from this screen. Press Space to start the current song, then press
              Space again to move into the next quote transition. This applies to the full live queue for this gig,
              across every playlist attached to it.
            </p>
          </div>
          <div className="gig-control-actions">
            <button
              type="button"
              className={event.roomOpen ? 'secondary-button' : 'primary-button'}
              onClick={async () => {
                try { await toggleRoomOpen() } catch { setErrorText('Failed to toggle room.') }
              }}
            >
              {event.roomOpen ? 'Pause Live' : 'Go Live'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={async () => {
                try { await toggleExplicitFilter() } catch { setErrorText('Failed to toggle filter.') }
              }}
            >
              {event.explicitFilterEnabled ? 'Allow Explicit' : 'Block Explicit'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={async () => {
                await copyJoinUrl()
              }}
            >
              {copied ? 'Copied!' : 'Copy Audience Link'}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => navigate('/admin/gig-settings')}
            >
              Gig Settings
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                const mirrorUrl = `${window.location.origin}/mirror`
                window.open(mirrorUrl, '_blank', 'noopener,noreferrer')
              }}
            >
              Open Mirror Screen
            </button>
          </div>
        </article>

        <article className="gig-mirror-preview-card" aria-label="Live mirror preview">
          <p className="gig-control-card-label">Live Mirror Preview</p>
          <div className="gig-mirror-preview-frame" role="img" aria-label="Mirror screen preview">
            <div className="gig-mirror-preview-top">
              <span className="gig-mirror-preview-brand">Human Jukebox</span>
              <span className={`gig-mirror-preview-state ${event.roomOpen ? 'is-live' : 'is-paused'}`}>
                {event.roomOpen ? 'Live' : 'Paused'}
              </span>
            </div>
            {nowPlaying && !isNowPlayingStarted ? (
              <p className="gig-mirror-preview-quote">{betweenSongQuote}</p>
            ) : (
              <>
                <p className="gig-mirror-preview-label">Now Playing</p>
                <div className="gig-mirror-preview-now-playing-row">
                  {nowPlaying?.cover_url ? (
                    <img
                      src={nowPlaying.cover_url}
                      alt={`Cover art for ${nowPlaying.title}`}
                      className="gig-mirror-preview-now-playing-cover"
                    />
                  ) : null}
                  <div>
                    <p className="gig-mirror-preview-song">{nowPlaying?.title ?? 'Waiting for requests...'}</p>
                    <p className="gig-mirror-preview-artist">{nowPlaying?.artist ?? 'No song in queue'}</p>
                  </div>
                </div>
              </>
            )}
            <p className="gig-mirror-preview-label">Up Next</p>
            <ul className="gig-mirror-preview-list">
              {upNext.slice(0, 3).map((song) => (
                <li key={song.id}>
                  <div className="gig-mirror-preview-list-main">
                    {song.cover_url ? (
                      <img
                        src={song.cover_url}
                        alt={`Cover art for ${song.title}`}
                        className="gig-mirror-preview-list-cover"
                      />
                    ) : null}
                    <span>{song.title}</span>
                  </div>
                  <span>+{song.votes_count}</span>
                </li>
              ))}
              {upNext.length === 0 ? <li><span>No songs queued</span><span>+0</span></li> : null}
            </ul>
          </div>
        </article>

        <article className="qr-card gig-control-qr-card" aria-label="Audience join tools">
          <p className="gig-control-card-label">Audience Join QR</p>
          <img src={qrUrl} alt="QR code for audience join page" className="qr-image" />
          <p className="subcopy">Show this on your mirror screen so guests can scan and join.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={async () => {
              await copyJoinUrl()
            }}
          >
            {copied ? 'Copied!' : 'Copy Audience Link'}
          </button>
        </article>
      </section>

      <section className="queue-panel gig-manual-add-panel" aria-label="Admin add song controls">
        <div className="panel-head">
          <h2>Add Song To Queue</h2>
          <span className="meta-badge">Admin control</span>
        </div>
        <form className="queue-form gig-manual-add-form" onSubmit={onManualAdd}>
          <div className="field-row">
            <label htmlFor="manual-song-title">Song title</label>
            <input
              id="manual-song-title"
              value={manualTitle}
              onChange={(nextEvent) => setManualTitle(nextEvent.target.value)}
              placeholder="Wonderwall"
            />
          </div>
          <div className="field-row">
            <label htmlFor="manual-song-artist">Artist</label>
            <input
              id="manual-song-artist"
              value={manualArtist}
              onChange={(nextEvent) => setManualArtist(nextEvent.target.value)}
              placeholder="Oasis"
            />
          </div>
          <label className="checkbox-row" htmlFor="manual-explicit">
            <input
              id="manual-explicit"
              type="checkbox"
              checked={manualExplicit}
              onChange={(nextEvent) => setManualExplicit(nextEvent.target.checked)}
            />
            Explicit song
          </label>
          <label className="checkbox-row" htmlFor="manual-karaoke">
            <input
              id="manual-karaoke"
              type="checkbox"
              checked={manualKaraoke}
              onChange={(nextEvent) => setManualKaraoke(nextEvent.target.checked)}
            />
            Mark as Karaoke request
          </label>
          <button type="submit" className="primary-button">Add To Queue</button>
        </form>
      </section>

      {/* Now Playing */}
      <section className="gig-now-playing">
        <article className="now-playing-card">
          <p className="eyebrow">Now Playing</p>
          {nowPlaying && isNowPlayingStarted ? (
            <>
              <div className="now-playing-media">
                {nowPlaying.cover_url ? (
                  <img src={nowPlaying.cover_url} alt={`Cover art for ${nowPlaying.title}`} className="song-cover song-cover-large" />
                ) : null}
                <div>
                  <h2>{nowPlaying.title}</h2>
                  <p className="artist">{nowPlaying.artist}</p>
                </div>
              </div>
              <div className="hero-actions gig-now-playing-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={spaceActionBusy}
                  onClick={async () => {
                      const previousQuoteIndex = await beginBetweenSongsTransition()

                    try {
                      await markPlayed()
                    } catch {
                      restoreStartedSong(previousQuoteIndex)
                      setErrorText('Failed to mark as played.')
                    }
                  }}
                >
                  ✓ Mark as Played
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={spaceActionBusy}
                  onClick={async () => {
                      const previousQuoteIndex = await beginBetweenSongsTransition()

                    try {
                      await removeSong(nowPlaying.id)
                    } catch {
                      restoreStartedSong(previousQuoteIndex)
                      setErrorText('Failed to skip song.')
                    }
                  }}
                >
                  ✕ Skip
                </button>
              </div>
              <p className="subcopy no-margin">
                Playing now. Press Space again to mark as played.
              </p>
            </>
          ) : nowPlaying ? (
            <>
              <div className="gig-between-songs-state">
                <p className="gig-between-songs-quote">{betweenSongQuote}</p>
                <p className="subcopy gig-between-songs-hint">Press Space to start the next song.</p>
              </div>
            </>
          ) : (
            <>
              <h2>Queue is empty</h2>
              <p className="artist">Waiting for requests from the audience.</p>
            </>
          )}
        </article>
      </section>

      {/* Queue */}
      <section className="queue-panel gig-queue-panel">
        <div className="panel-head">
          <h2>Up Next ({upNext.length} tracks)</h2>
          <span className="meta-badge">{event.roomOpen ? 'Queue Open' : 'Queue Paused'}</span>
        </div>
        {upNext.length === 0 ? (
          <p className="subcopy queue-empty-note">No more songs in queue.</p>
        ) : (
          <ol className="queue-list gig-control-queue">
            {upNext.map((song, index) => (
              <li key={song.id} className="gig-control-row">
                <span className="queue-pos">{index + upNextStartPosition}</span>
                <div className="gig-song-info">
                  {song.cover_url ? (
                    <img src={song.cover_url} alt={`Cover art for ${song.title}`} className="song-cover" />
                  ) : null}
                  <div>
                    <p className="song">{song.title}</p>
                    <p className="artist">
                      {song.artist}
                      {song.audience_sings ? <span className="karaoke-tag"> · Karaoke</span> : null}
                      {song.is_explicit ? <span className="explicit-tag"> · E</span> : null}
                    </p>
                  </div>
                </div>
                <span className="votes">+{song.votes_count}</span>
                <div className="queue-actions">
                  <button
                    type="button"
                    className="vote-button danger-button"
                    onClick={async () => {
                      try { await removeSong(song.id) } catch { setErrorText('Failed to remove.') }
                    }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="queue-panel gig-performed-panel" aria-label="Performed songs">
        <div className="panel-head">
          <h2>Performed Songs ({performedSongs.length})</h2>
          <span className="meta-badge">Live set history</span>
        </div>
        {performedSongs.length === 0 ? (
          <p className="subcopy queue-empty-note">Played songs will appear here.</p>
        ) : (
          <ol className="queue-list gig-performed-list">
            {performedSongs.map((song, index) => (
              <li key={`${song.id}-${song.performedAt}`}>
                <span className="queue-pos">{index + 1}</span>
                <div className="gig-song-info">
                  {song.cover_url ? (
                    <img src={song.cover_url} alt={`Cover art for ${song.title}`} className="song-cover" />
                  ) : null}
                  <div>
                    <p className="song">{song.title}</p>
                    <p className="artist">{song.artist}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {errorText ? <p className="error-text">{errorText}</p> : null}
    </section>
  )
}

export default GigControlPage
