import { useEffect, useMemo, useRef, useState } from 'react'
import LiveFeedPanel from '../components/LiveFeedPanel'
import { getAudienceUrl } from '../lib/audienceUrl'
import {
  PLAYBACK_STATE_BROADCAST_CHANNEL,
  BETWEEN_SONG_QUOTES,
  PLAYBACK_STATE_EVENT,
  PLAYBACK_STATE_STORAGE_KEY,
  readSharedPlaybackState,
  type SharedPlaybackState,
} from '../lib/playbackState'
import { supabase } from '../lib/supabase'
import { useQueueStore } from '../state/queueStore'

type FeedImageSpotlight = {
  id: string
  eventId: string
  imageDataUrl: string
  authorName: string
  caption: string
}

const SPOTLIGHT_CAPTION_BUILDERS = [
  (authorName: string) => `${authorName}, you just lit up the room!`,
  (authorName: string) => `${authorName} brought the party to the big screen!`,
  (authorName: string) => `${authorName} just served a main character moment!`,
  (authorName: string) => `${authorName}'s crowd cam drop is pure gold!`,
  (authorName: string) => `Big cheers for ${authorName} and this dance-floor classic!`,
  (authorName: string) => `${authorName} just gave tonight another highlight reel!`,
]

const SPOTLIGHT_DURATION_MS = 7000

type SpotlightQueueItem = {
  id: string
  eventId: string
  imageDataUrl: string
  authorName: string
}

function pickSpotlightCaption(authorName: string) {
  const captionBuilder = SPOTLIGHT_CAPTION_BUILDERS[Math.floor(Math.random() * SPOTLIGHT_CAPTION_BUILDERS.length)]
  return captionBuilder(authorName)
}

function playShutterSound() {
  try {
    const audioContext = new window.AudioContext()
    const gainNode = audioContext.createGain()
    const oscillator = audioContext.createOscillator()

    oscillator.type = 'square'
    oscillator.frequency.setValueAtTime(1560, audioContext.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(720, audioContext.currentTime + 0.06)

    gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.065, audioContext.currentTime + 0.012)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.09)

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.1)

    window.setTimeout(() => {
      void audioContext.close()
    }, 160)
  } catch {
    // Some browsers block autoplay audio; visual flash still runs.
  }
}

function MirrorPage() {
  const { event, songs, loading } = useQueueStore()
  const [spotlight, setSpotlight] = useState<FeedImageSpotlight | null>(null)
  const [flashActive, setFlashActive] = useState(false)
  const [queuedSpotlightCount, setQueuedSpotlightCount] = useState(0)
  const [playbackState, setPlaybackState] = useState<SharedPlaybackState | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fallbackBetweenSongs, setFallbackBetweenSongs] = useState(false)
  const [fallbackQuoteIndex, setFallbackQuoteIndex] = useState(0)
  const spotlightTimerRef = useRef<number | null>(null)
  const fallbackBetweenSongsTimerRef = useRef<number | null>(null)
  const previousSongIdRef = useRef<string | null>(null)
  const spotlightQueueRef = useRef<SpotlightQueueItem[]>([])
  const spotlightBusyRef = useRef(false)

  const nowPlaying = songs[0]
  const isLive = event?.roomOpen ?? false
  const isEmbeddedPreview =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1'
  const eventId = event?.id ?? null
  const audienceUrl = getAudienceUrl(eventId)
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(audienceUrl)}`
  const playbackSong = playbackState?.currentSongId
    ? songs.find((song) => song.id === playbackState.currentSongId) ?? null
    : null
  const activeSong = playbackSong ?? nowPlaying
  const isNowPlayingStarted = Boolean(playbackState?.isStarted && playbackState.currentSongId)
  const hasPlaybackBetweenSongsState = Boolean(playbackState && !playbackState.isStarted && songs.length > 0)
  const isBetweenSongs = hasPlaybackBetweenSongsState || fallbackBetweenSongs
  const upNext = isNowPlayingStarted
    ? songs.filter((song) => song.id !== (playbackSong?.id ?? nowPlaying?.id)).slice(0, 4)
    : songs.slice(0, 4)
  const betweenSongQuoteIndex = hasPlaybackBetweenSongsState
    ? (playbackState?.quoteIndex ?? 0)
    : fallbackQuoteIndex
  const betweenSongQuote = BETWEEN_SONG_QUOTES[betweenSongQuoteIndex % BETWEEN_SONG_QUOTES.length]

  const showSpotlight = (event?.mirrorPhotoSpotlightEnabled ?? true) && !isEmbeddedPreview

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }

    syncFullscreenState()
    window.addEventListener('fullscreenchange', syncFullscreenState)

    return () => {
      window.removeEventListener('fullscreenchange', syncFullscreenState)
    }
  }, [])

  useEffect(() => {
    if (!eventId) {
      setPlaybackState(null)
      return
    }

    let isCurrent = true
    let subscription: ReturnType<typeof supabase.channel> | null = null
    let playbackBroadcastChannel: BroadcastChannel | null = null

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

    const onStoragePlaybackState = (nextEvent: StorageEvent) => {
      if (nextEvent.key !== PLAYBACK_STATE_STORAGE_KEY || !nextEvent.newValue) {
        return
      }

      try {
        const detail = JSON.parse(nextEvent.newValue) as { eventId?: string; state?: SharedPlaybackState }
        if (detail.eventId === eventId && detail.state) {
          setPlaybackState(detail.state)
        }
      } catch {
        // Ignore malformed storage payloads.
      }
    }

    void syncPlaybackState()
    setupSubscription()
    window.addEventListener(PLAYBACK_STATE_EVENT, onPlaybackStateEvent as EventListener)
    window.addEventListener('storage', onStoragePlaybackState)

    if ('BroadcastChannel' in window) {
      playbackBroadcastChannel = new BroadcastChannel(PLAYBACK_STATE_BROADCAST_CHANNEL)
      playbackBroadcastChannel.onmessage = (messageEvent: MessageEvent<{ eventId?: string; state?: SharedPlaybackState }>) => {
        const detail = messageEvent.data
        if (detail?.eventId === eventId && detail.state) {
          setPlaybackState(detail.state)
        }
      }
    }

    return () => {
      isCurrent = false
      if (subscription) {
        void subscription.unsubscribe()
      }
      window.removeEventListener(PLAYBACK_STATE_EVENT, onPlaybackStateEvent as EventListener)
      window.removeEventListener('storage', onStoragePlaybackState)
      playbackBroadcastChannel?.close()
    }
  }, [eventId])

  useEffect(() => {
    return () => {
      if (spotlightTimerRef.current) {
        window.clearTimeout(spotlightTimerRef.current)
      }
      if (fallbackBetweenSongsTimerRef.current) {
        window.clearTimeout(fallbackBetweenSongsTimerRef.current)
      }
      spotlightBusyRef.current = false
      spotlightQueueRef.current = []
    }
  }, [])

  useEffect(() => {
    // When playback state says "between songs", trust that as the source of truth.
    if (hasPlaybackBetweenSongsState) {
      if (fallbackBetweenSongsTimerRef.current) {
        window.clearTimeout(fallbackBetweenSongsTimerRef.current)
        fallbackBetweenSongsTimerRef.current = null
      }

      setFallbackBetweenSongs(false)
    }
  }, [hasPlaybackBetweenSongsState])

  useEffect(() => {
    const nextSongId = songs[0]?.id ?? null

    if (!nextSongId) {
      previousSongIdRef.current = null
      setFallbackBetweenSongs(false)
      return
    }

    const previousSongId = previousSongIdRef.current
    const hasSongTransition = Boolean(previousSongId && previousSongId !== nextSongId)

    // Fallback for missed storage sync across tabs/devices: show an interstitial quote on song change.
    if (hasSongTransition && !hasPlaybackBetweenSongsState) {
      const nextQuoteIndex = ((playbackState?.quoteIndex ?? fallbackQuoteIndex) + 1) % BETWEEN_SONG_QUOTES.length
      setFallbackQuoteIndex(nextQuoteIndex)
      setFallbackBetweenSongs(true)

      if (fallbackBetweenSongsTimerRef.current) {
        window.clearTimeout(fallbackBetweenSongsTimerRef.current)
      }

      fallbackBetweenSongsTimerRef.current = window.setTimeout(() => {
        setFallbackBetweenSongs(false)
        fallbackBetweenSongsTimerRef.current = null
      }, 5000)
    }

    previousSongIdRef.current = nextSongId
  }, [fallbackQuoteIndex, hasPlaybackBetweenSongsState, playbackState?.quoteIndex, songs])

  useEffect(() => {
    if (!eventId || !showSpotlight) {
      spotlightQueueRef.current = []
      spotlightBusyRef.current = false

      if (spotlightTimerRef.current) {
        window.clearTimeout(spotlightTimerRef.current)
        spotlightTimerRef.current = null
      }
      return
    }

    const startSpotlight = (nextItem: SpotlightQueueItem) => {
      spotlightBusyRef.current = true
      setFlashActive(true)
      playShutterSound()
      setQueuedSpotlightCount(spotlightQueueRef.current.length)

      window.setTimeout(() => {
        setFlashActive(false)
      }, 220)

      setSpotlight({
        id: nextItem.id,
        eventId: nextItem.eventId,
        imageDataUrl: nextItem.imageDataUrl,
        authorName: nextItem.authorName,
        caption: pickSpotlightCaption(nextItem.authorName),
      })

      if (spotlightTimerRef.current) {
        window.clearTimeout(spotlightTimerRef.current)
      }

      spotlightTimerRef.current = window.setTimeout(() => {
        setSpotlight(null)
        spotlightBusyRef.current = false
        spotlightTimerRef.current = null

        const queuedItem = spotlightQueueRef.current.shift()
        setQueuedSpotlightCount(spotlightQueueRef.current.length)

        if (queuedItem) {
          startSpotlight(queuedItem)
        }
      }, SPOTLIGHT_DURATION_MS)
    }

    const enqueueSpotlight = (nextItem: SpotlightQueueItem) => {
      if (spotlightBusyRef.current) {
        spotlightQueueRef.current.push(nextItem)
        setQueuedSpotlightCount(spotlightQueueRef.current.length)
        return
      }

      startSpotlight(nextItem)
    }

    const channel = supabase
      .channel(`mirror-feed-spotlight-${eventId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'feed_posts',
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          const nextPost = payload.new as {
            id?: string
            image_data_url?: string | null
            author_name?: string | null
          }

          if (!nextPost.image_data_url) {
            return
          }

          enqueueSpotlight({
            id: nextPost.id ?? crypto.randomUUID(),
            eventId,
            imageDataUrl: nextPost.image_data_url,
            authorName: nextPost.author_name?.trim() || 'Guest',
          })
        },
      )
      .subscribe()

    return () => {
      if (spotlightTimerRef.current) {
        window.clearTimeout(spotlightTimerRef.current)
        spotlightTimerRef.current = null
      }
      void supabase.removeChannel(channel)
    }
  }, [eventId, showSpotlight])

  const activeSpotlight = useMemo(() => {
    if (!eventId || !spotlight || spotlight.eventId !== eventId) {
      return null
    }

    return spotlight
  }, [eventId, spotlight])

  if (loading) {
    return (
      <div className="mirror-shell">
        <p className="mirror-loading">Connecting to stage…</p>
      </div>
    )
  }

  return (
    <div className={`mirror-shell ${isLive ? 'mirror-shell-live' : 'mirror-shell-paused'}`} aria-label="Mirror display screen">
      <header className="mirror-header">
        <p className="mirror-brand">🎸 Human Jukebox</p>
        {event ? (
          <div>
            <p className="mirror-event-name">
              {event.name}
              {event.venue ? ` · ${event.venue}` : ''}
            </p>
            {event.subtitle ? <p className="mirror-event-subtitle">{event.subtitle}</p> : null}
          </div>
        ) : null}
        <span className={`mirror-status ${event?.roomOpen ? 'mirror-open' : 'mirror-paused'}`}>
          {event?.roomOpen ? '● Live' : '● Paused'}
        </span>
        <button
          type="button"
          className="mirror-fullscreen-button"
          onClick={async () => {
            try {
              if (!document.fullscreenElement) {
                await document.documentElement.requestFullscreen()
              } else {
                await document.exitFullscreen()
              }
            } catch {
              // Ignore browser fullscreen failures; button remains available.
            }
          }}
        >
          {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
        {isLive ? (
          <div className="mirror-header-qr" aria-label="Audience join QR">
            <img src={qrUrl} alt="QR code for the audience request page" className="mirror-header-qr-image" />
          </div>
        ) : null}
      </header>

      <main className={`mirror-stage ${isLive ? 'mirror-stage-live' : ''}`}>
        {!isLive ? (
          <section className="mirror-pre-show" aria-label="Pre-show welcome">
            <h1 className="mirror-pre-show-title">Welcome to the show!</h1>
            <p className="mirror-pre-show-subtitle">No pressure — just enjoy yourself and blame the rest on the music.</p>
            <div className="mirror-qr-block">
              <img src={qrUrl} alt="QR code for the audience request page" className="mirror-qr-image" />
              <div className="mirror-qr-copy">
                <p className="mirror-qr-label">Scan to join</p>
                <p>Open the audience app at <strong>{audienceUrl}</strong></p>
              </div>
            </div>
            <div className="mirror-how-it-works" aria-label="How it works">
              <p className="mirror-how-it-works-label">How It Works</p>
              <p>1. Scan the QR code.</p>
              <p>2. Enter your name and log in.</p>
              <p>3. Add song requests and vote your favorites up.</p>
            </div>
          </section>
        ) : (
          <>
            <section className={`mirror-now-playing ${isLive ? 'mirror-now-playing-live' : ''} ${isBetweenSongs ? 'mirror-now-playing-interstitial' : ''}`}>
              {isBetweenSongs ? (
                <>
                  <p className="mirror-between-songs-quote">{betweenSongQuote}</p>
                </>
              ) : (
                <>
                  <p className="mirror-eyebrow">Now Playing</p>
                  <div className="mirror-now-playing-track">
                    {activeSong?.cover_url ? (
                      <img
                        src={activeSong.cover_url}
                        alt={`Cover art for ${activeSong.title}`}
                        className="mirror-now-playing-cover"
                      />
                    ) : null}
                    <div className="mirror-now-playing-meta">
                      <h1 className="mirror-title">{activeSong?.title ?? 'Waiting for requests…'}</h1>
                      <p className="mirror-artist">{activeSong?.artist ?? 'Be the first to request a song!'}</p>
                    </div>
                  </div>
                </>
              )}
            </section>

            <section className="mirror-secondary-grid">
              <section className="mirror-up-next">
                <p className="mirror-up-next-label">Up Next</p>
                {upNext.length > 0 ? (
                  <ol className="mirror-queue">
                    {upNext.map((song, index) => (
                      <li key={song.id} className="mirror-queue-item">
                        <span className="mirror-queue-pos">{index + 2}</span>
                        {song.cover_url ? (
                          <img
                            src={song.cover_url}
                            alt={`Cover art for ${song.title}`}
                            className="mirror-queue-cover"
                          />
                        ) : null}
                        <div className="mirror-queue-info">
                          <span className="mirror-queue-title">{song.title}</span>
                          <span className="mirror-queue-artist">{song.artist}</span>
                        </div>
                        <span className="mirror-queue-votes">+{song.votes_count}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mirror-empty-note">No songs in the queue yet.</p>
                )}
              </section>

              <LiveFeedPanel mode="mirror" showComposer={false} title="Crowd Feed" />
            </section>
          </>
        )}
      </main>

      {showSpotlight && activeSpotlight ? (
        <aside className="mirror-photo-spotlight" aria-label="Live crowd photo spotlight">
          <figure className="mirror-polaroid" key={activeSpotlight.id}>
            <img src={activeSpotlight.imageDataUrl} alt={`Crowd photo by ${activeSpotlight.authorName}`} className="mirror-polaroid-photo" />
            <figcaption>
              <strong>{activeSpotlight.authorName}</strong>
              <span>{activeSpotlight.caption}</span>
            </figcaption>
          </figure>
          {queuedSpotlightCount > 0 ? (
            <p className="mirror-spotlight-queue-pill">
              {queuedSpotlightCount} more photo{queuedSpotlightCount === 1 ? '' : 's'} coming
            </p>
          ) : null}
        </aside>
      ) : null}

      {showSpotlight && flashActive ? <div className="mirror-spotlight-flash" aria-hidden="true" /> : null}

      {isLive && event?.requestInstructions ? (
        <footer className="mirror-footer">
          <p className="mirror-request-note">{event.requestInstructions}</p>
        </footer>
      ) : null}
    </div>
  )
}

export default MirrorPage
