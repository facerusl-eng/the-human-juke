import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AudienceNoGigState, { type AudienceUpcomingEvent } from '../components/audience/AudienceNoGigState'
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
  contact_email: string | null
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

function isMissingCoverImageColumnError(error: unknown) {
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

  return (code === '42703' || code === 'PGRST204') && text.includes('cover_image_url')
}

function isAuthSessionError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const normalizedError = error as {
    code?: unknown
    message?: unknown
    details?: unknown
    hint?: unknown
    status?: unknown
  }

  const code = typeof normalizedError.code === 'string' ? normalizedError.code.toUpperCase() : ''
  const status = typeof normalizedError.status === 'number' ? normalizedError.status : null
  const text = [normalizedError.message, normalizedError.details, normalizedError.hint]
    .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''))
    .join(' ')

  return code === 'PGRST301'
    || status === 401
    || text.includes('jwt')
    || text.includes('not authenticated')
    || text.includes('auth session missing')
}

async function fetchUpcomingEventRows() {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, venue, gig_date, gig_start_time, gig_end_time, cover_image_url')
    .eq('show_in_audience_no_gig', true)
    .order('gig_date', { ascending: true, nullsFirst: false })
    .order('gig_start_time', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (error && isMissingCoverImageColumnError(error)) {
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('events')
      .select('id, name, venue, gig_date, gig_start_time, gig_end_time')
      .eq('show_in_audience_no_gig', true)
      .order('gig_date', { ascending: true, nullsFirst: false })
      .order('gig_start_time', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })

    if (fallbackError) {
      throw fallbackError
    }

    return (fallbackData ?? []).map((eventData) => ({
      ...(eventData as Record<string, unknown>),
      cover_image_url: null,
    }))
  }

  if (error) {
    throw error
  }

  return (data ?? []) as Array<Record<string, unknown>>
}

const MAX_AUDIENCE_NAME_LENGTH = 40
const UPCOMING_EVENTS_POLL_INTERVAL_MS = 15000
const LIVE_GIG_POLL_INTERVAL_MS = 12000
const AUDIENCE_CACHE_VERSION = import.meta.env.VITE_AUDIENCE_LINK_VERSION?.trim() || '20260426'
const EXPECTED_API_FALLBACK_ERROR_PREFIX = 'Expected API fallback:'

function makeCacheBustedUrl(path: string) {
  const requestUrl = new URL(path, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  requestUrl.searchParams.set('v', `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  return requestUrl.toString()
}

async function fetchJsonNoStore(path: string) {
  const response = await fetch(makeCacheBustedUrl(path), {
    cache: 'no-store',
    headers: {
      'cache-control': 'no-cache, no-store, max-age=0',
      pragma: 'no-cache',
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`${EXPECTED_API_FALLBACK_ERROR_PREFIX} request failed (${response.status})`)
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''

  if (!contentType.includes('application/json')) {
    throw new Error(`${EXPECTED_API_FALLBACK_ERROR_PREFIX} unexpected response content-type (${contentType || 'unknown'})`)
  }

  try {
    return await response.json() as unknown
  } catch {
    throw new Error(`${EXPECTED_API_FALLBACK_ERROR_PREFIX} invalid JSON payload`)
  }
}

function isExpectedApiFallbackError(error: unknown) {
  return error instanceof Error && error.message.startsWith(EXPECTED_API_FALLBACK_ERROR_PREFIX)
}

function isSamePlaybackState(left: SharedPlaybackState | null, right: SharedPlaybackState | null) {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return left.currentSongId === right.currentSongId
    && left.currentSongCoverUrl === right.currentSongCoverUrl
    && left.isStarted === right.isStarted
    && left.quoteIndex === right.quoteIndex
}

function getLiveGigIdFromApiPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const normalizedPayload = payload as {
    id?: unknown
    eventId?: unknown
    event_id?: unknown
    liveGig?: unknown
    data?: unknown
  }

  const directId = normalizedPayload.id ?? normalizedPayload.eventId ?? normalizedPayload.event_id

  if (typeof directId === 'string' && directId.trim()) {
    return directId.trim()
  }

  const nestedLiveGig = normalizedPayload.liveGig

  if (nestedLiveGig && typeof nestedLiveGig === 'object') {
    const nestedId = (nestedLiveGig as { id?: unknown; eventId?: unknown; event_id?: unknown }).id
      ?? (nestedLiveGig as { id?: unknown; eventId?: unknown; event_id?: unknown }).eventId
      ?? (nestedLiveGig as { id?: unknown; eventId?: unknown; event_id?: unknown }).event_id

    if (typeof nestedId === 'string' && nestedId.trim()) {
      return nestedId.trim()
    }
  }

  const nestedData = normalizedPayload.data

  if (nestedData && typeof nestedData === 'object') {
    const nestedId = (nestedData as { id?: unknown; eventId?: unknown; event_id?: unknown }).id
      ?? (nestedData as { id?: unknown; eventId?: unknown; event_id?: unknown }).eventId
      ?? (nestedData as { id?: unknown; eventId?: unknown; event_id?: unknown }).event_id

    if (typeof nestedId === 'string' && nestedId.trim()) {
      return nestedId.trim()
    }
  }

  return null
}

function mapUpcomingEvents(rows: Array<Record<string, unknown>>): AudienceUpcomingEvent[] {
  return rows.map((eventData) => ({
    id: String(eventData.id ?? ''),
    name: (eventData.name as string | null) ?? 'Untitled Gig',
    venue: (eventData.venue as string | null) ?? null,
    gigDate: (eventData.gig_date as string | null) ?? null,
    gigStartTime: (eventData.gig_start_time as string | null) ?? null,
    gigEndTime: (eventData.gig_end_time as string | null) ?? null,
    coverImageUrl: normalizeCoverUrl((eventData.cover_image_url as string | null) ?? null),
  }))
}

async function fetchUpcomingEventsFromApi(): Promise<AudienceUpcomingEvent[]> {
  const payload = await fetchJsonNoStore('/events')

  if (!payload) {
    return []
  }

  if (Array.isArray(payload)) {
    return mapUpcomingEvents(payload as Array<Record<string, unknown>>)
  }

  if (typeof payload === 'object') {
    const normalizedPayload = payload as { events?: unknown; data?: unknown }
    const candidateRows = Array.isArray(normalizedPayload.events)
      ? normalizedPayload.events
      : Array.isArray(normalizedPayload.data)
      ? normalizedPayload.data
      : []

    return mapUpcomingEvents(candidateRows as Array<Record<string, unknown>>)
  }

  return []
}

function hasUnsafeControlChars(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index)

    if ((charCode >= 0 && charCode <= 8) || (charCode >= 11 && charCode <= 12) || (charCode >= 14 && charCode <= 31) || charCode === 127) {
      return true
    }
  }

  return false
}

// Handles MobilePay stored as either a URL or a raw phone number / username.
// Returns { href, display } or null.
function resolveMobilepayLink(value: string | null | undefined): { href: string; display: string } | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  // Phone number pattern: +45... or just digits with optional +
  if (/^\+?[\d\s-]{6,16}$/.test(trimmed)) {
    const digits = trimmed.replace(/[\s-]/g, '')
    return { href: `tel:${digits}`, display: `MobilePay (${trimmed})` }
  }

  const url = normalizeExternalLink(trimmed)
  if (!url) return null
  return { href: url, display: 'MobilePay' }
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
  const { authError, loading: authLoading, user } = useAuthStore()
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
  const [audienceNameSaving, setAudienceNameSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [confirmationText, setConfirmationText] = useState<string | null>(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [votingSongIds, setVotingSongIds] = useState<Record<string, boolean>>({})
  const [votePulseTicks, setVotePulseTicks] = useState<Record<string, number>>({})
  const [songMoveTicks, setSongMoveTicks] = useState<Record<string, number>>({})
  const [playbackState, setPlaybackState] = useState<SharedPlaybackState | null>(null)
  const [upcomingEvents, setUpcomingEvents] = useState<AudienceUpcomingEvent[]>([])
  const [upcomingEventsLoading, setUpcomingEventsLoading] = useState(false)
  const [upcomingEventsNotice, setUpcomingEventsNotice] = useState<string | null>(null)
  const [audienceLoadingFallbackActive, setAudienceLoadingFallbackActive] = useState(false)
  const [hasResolvedInitialAudienceLoad, setHasResolvedInitialAudienceLoad] = useState(false)

  const previousVotesRef = useRef<Map<string, number>>(new Map())
  const previousSongRanksRef = useRef<Map<string, number>>(new Map())
  const audienceLinkVersionRef = useRef(AUDIENCE_CACHE_VERSION)
  const votingSongIdsRef = useRef<Record<string, boolean>>({})
  const confirmationTimerRef = useRef<number | null>(null)

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
  const eventSearchParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const requestedEventId = eventSearchParams.get('event') ?? eventSearchParams.get('eventId')
  const hasRequestedEventParam = Boolean(requestedEventId)

  useEffect(() => {
    votingSongIdsRef.current = votingSongIds
  }, [votingSongIds])

  useEffect(() => {
    return () => {
      if (confirmationTimerRef.current !== null) {
        window.clearTimeout(confirmationTimerRef.current)
        confirmationTimerRef.current = null
      }
    }
  }, [])

  const handleVoteSong = useCallback(async (songId: string) => {
    if (votingSongIdsRef.current[songId]) {
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
  }, [upvoteSong])

  useEffect(() => {
    if (!loading || event) {
      setAudienceLoadingFallbackActive(false)
      return
    }

    const timerId = window.setTimeout(() => {
      setAudienceLoadingFallbackActive(true)
      setUpcomingEventsNotice('Loading is taking longer than expected. Showing upcoming events while we reconnect...')
    }, 3500)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [loading, event])

  useEffect(() => {
    if (hasResolvedInitialAudienceLoad) {
      return
    }

    if (!loading || Boolean(event) || upcomingEvents.length > 0 || Boolean(upcomingEventsNotice)) {
      setHasResolvedInitialAudienceLoad(true)
    }
  }, [loading, event, upcomingEvents.length, upcomingEventsNotice, hasResolvedInitialAudienceLoad])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    let isCurrent = true
    let pollTimerId: number | null = null

    const checkLiveGig = async () => {
      try {
        const payload = await fetchJsonNoStore('/api/live-gig')
        const liveGigId = getLiveGigIdFromApiPayload(payload)

        if (!isCurrent) {
          return
        }

        if (liveGigId) {
          if (requestedEventId !== liveGigId) {
            navigate(`/audience?event=${encodeURIComponent(liveGigId)}&v=${audienceLinkVersionRef.current}`, {
              replace: true,
            })
          }

          setUpcomingEventsNotice('A live show just started. Connecting now...')
          return
        }

        if (requestedEventId) {
          navigate(`/audience?v=${audienceLinkVersionRef.current}`, { replace: true })
        }
      } catch (error) {
        const expectedFallbackError = isExpectedApiFallbackError(error)

        if (!expectedFallbackError) {
          console.warn('EventPage: live gig API check failed', error)
        }

        if (isCurrent && !event && !expectedFallbackError) {
          setUpcomingEventsNotice('Live status is reconnecting. Upcoming events are shown below.')
        }
      }
    }

    void checkLiveGig()

    pollTimerId = window.setInterval(() => {
      if (document.hidden) {
        return
      }

      void checkLiveGig()
    }, LIVE_GIG_POLL_INTERVAL_MS)

    return () => {
      isCurrent = false
      if (pollTimerId !== null) {
        window.clearInterval(pollTimerId)
      }
    }
  }, [navigate, requestedEventId, event])

  const socialLinks = useMemo(() => ([
    { label: 'Instagram', url: hostProfile?.instagram_url },
    { label: 'TikTok', url: hostProfile?.tiktok_url },
    { label: 'YouTube', url: hostProfile?.youtube_url },
    { label: 'Facebook', url: hostProfile?.facebook_url },
  ]
    .map((link) => ({ ...link, url: normalizeExternalLink(link.url) }))
    .filter((link): link is { label: string; url: string } => Boolean(link.url))
    .concat(
      hostProfile?.contact_email?.trim()
        ? [{ label: '✉ Email', url: `mailto:${hostProfile.contact_email.trim()}` }]
        : []
    )
  ), [hostProfile])

  const resolvedMobilepayLink = resolveMobilepayLink(hostProfile?.mobilpay_url)
  const allTipLinks = useMemo(() => {
    const links: { label: string; url: string }[] = []
    if (resolvedMobilepayLink) {
      links.push({ label: resolvedMobilepayLink.display, url: resolvedMobilepayLink.href })
    }
    const paypal = normalizeExternalLink(hostProfile?.paypal_url)
    if (paypal) links.push({ label: 'PayPal', url: paypal })
    return links
  }, [resolvedMobilepayLink, hostProfile?.paypal_url])

  useEffect(() => {
    const state = location.state as { requestConfirmation?: string } | null

    if (!state?.requestConfirmation) {
      return
    }

    setConfirmationText(state.requestConfirmation)
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })

    if (confirmationTimerRef.current !== null) {
      window.clearTimeout(confirmationTimerRef.current)
    }

    confirmationTimerRef.current = window.setTimeout(() => {
      setConfirmationText(null)
      confirmationTimerRef.current = null
    }, 2600)
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
          .select('display_name, instagram_url, tiktok_url, youtube_url, facebook_url, paypal_url, mobilpay_url, contact_email')

        const query = hostId
          ? baseQuery.eq('user_id', hostId).maybeSingle()
          : baseQuery.eq('role', 'host').limit(1).maybeSingle()

        const { data, error } = await query

        if (error) {
          throw error
        }

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

  useEffect(() => {
    if (event) {
      setUpcomingEvents([])
      setUpcomingEventsLoading(false)
      setUpcomingEventsNotice(null)
      return
    }

    if (authLoading) {
      setUpcomingEventsLoading(true)
      setUpcomingEventsNotice('Finishing sign-in before loading upcoming gigs...')
      return
    }

    let isCurrent = true
    let channel: ReturnType<typeof supabase.channel> | null = null
    let pollTimerId: number | null = null

    const loadUpcomingEvents = async () => {
      setUpcomingEventsLoading(true)

      try {
        let mappedEvents: AudienceUpcomingEvent[] = []

        try {
          mappedEvents = await fetchUpcomingEventsFromApi()
        } catch (apiError) {
          if (!isExpectedApiFallbackError(apiError)) {
            console.warn('EventPage: /events fetch failed, falling back to Supabase', apiError)
          }
          const eventRows = await fetchUpcomingEventRows()
          mappedEvents = mapUpcomingEvents(eventRows)
        }

        if (mappedEvents.length === 0 && !user) {
          try {
            const { error: signInError } = await supabase.auth.signInAnonymously()

            if (signInError) {
              throw signInError
            }

            try {
              mappedEvents = await fetchUpcomingEventsFromApi()
            } catch {
              const eventRows = await fetchUpcomingEventRows()
              mappedEvents = mapUpcomingEvents(eventRows)
            }
          } catch (signInError) {
            console.warn('EventPage: anonymous sign-in retry failed for upcoming events', signInError)
          }
        }

        if (!isCurrent) {
          return
        }

        setUpcomingEvents(mappedEvents)

        if (mappedEvents.length === 0) {
          setUpcomingEventsNotice('No upcoming gigs have been posted yet.')
        } else {
          setUpcomingEventsNotice(null)
        }
      } catch (error) {
        console.warn('EventPage: failed to load upcoming no-gig events', error)

        if (isAuthSessionError(error) && !user) {
          try {
            const { error: signInError } = await supabase.auth.signInAnonymously()

            if (signInError) {
              throw signInError
            }

            let mappedEvents: AudienceUpcomingEvent[] = []

            try {
              mappedEvents = await fetchUpcomingEventsFromApi()
            } catch {
              const eventRows = await fetchUpcomingEventRows()
              mappedEvents = mapUpcomingEvents(eventRows)
            }

            if (isCurrent) {
              setUpcomingEvents(mappedEvents)

              if (mappedEvents.length === 0) {
                setUpcomingEventsNotice('No upcoming gigs have been posted yet.')
              } else {
                setUpcomingEventsNotice(null)
              }
            }

            return
          } catch (retryError) {
            console.warn('EventPage: auth retry failed while loading upcoming no-gig events', retryError)
          }
        }

        if (isCurrent) {
          setUpcomingEvents([])
          setUpcomingEventsNotice('Could not load upcoming gigs right now. Retrying in the background...')
        }
      } finally {
        if (isCurrent) {
          setUpcomingEventsLoading(false)
        }
      }
    }

    void loadUpcomingEvents()

    channel = supabase
      .channel(`audience-upcoming-events-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events',
        },
        () => {
          void loadUpcomingEvents()
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          return
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setUpcomingEventsNotice('Live updates are reconnecting. Upcoming events are still available.')
        }
      })

    pollTimerId = window.setInterval(() => {
      if (document.hidden) {
        return
      }

      void loadUpcomingEvents()
    }, UPCOMING_EVENTS_POLL_INTERVAL_MS)

    return () => {
      isCurrent = false
      if (channel) {
        void supabase.removeChannel(channel)
      }
      if (pollTimerId !== null) {
        window.clearInterval(pollTimerId)
      }
    }
  }, [event, authLoading, user])

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
  }, [event, event?.id, event?.name, event?.venue])

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
          setPlaybackState((currentState) => (isSamePlaybackState(currentState, state) ? currentState : state))
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
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn('EventPage: playback subscription reconnecting', { eventId, status })
        }
      })

    const onPlaybackStateEvent = (nextEvent: Event) => {
      const detail = (nextEvent as CustomEvent<{ eventId: string; state: SharedPlaybackState }>).detail

      if (detail?.eventId === eventId) {
        setPlaybackState((currentState) => (isSamePlaybackState(currentState, detail.state) ? currentState : detail.state))
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

    if (audienceNameSaving) {
      return
    }

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

    // Save audience name with loading state
    setAudienceNameSaving(true)
    setAudienceNameError(null)

    try {
      commitAudienceName(normalizedAudienceName)
      setAudienceName(normalizedAudienceName)
      setErrorText(null)
      setConfirmationText('Welcome! 🎤')

      if (confirmationTimerRef.current !== null) {
        window.clearTimeout(confirmationTimerRef.current)
      }

      confirmationTimerRef.current = window.setTimeout(() => {
        setConfirmationText(null)
        confirmationTimerRef.current = null
      }, 2000)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save your name.'
      setAudienceNameError(errorMessage)
      setErrorText(errorMessage)
      console.warn('EventPage: failed to save audience name', error)
    } finally {
      setAudienceNameSaving(false)
    }
  }

  if (
    loading
    && !audienceLoadingFallbackActive
    && !hasResolvedInitialAudienceLoad
    && !event
    && upcomingEvents.length === 0
  ) {
    return (
      <section className="audience-entry-shell" aria-label="Audience loading">
        <article className="queue-panel audience-entry-card">
          <p className="eyebrow">Audience App</p>
          <div className="loading-skeleton loading-skeleton-title" aria-hidden="true"></div>
          <div className="loading-skeleton loading-skeleton-line" aria-hidden="true"></div>
          <div className="loading-skeleton loading-skeleton-line loading-skeleton-line-short" aria-hidden="true"></div>
        </article>
      </section>
    )
  }

  if (!event) {
    return (
      <AudienceNoGigState
        upcomingEvents={upcomingEvents}
        loadingUpcomingEvents={upcomingEventsLoading}
        upcomingEventsNotice={upcomingEventsNotice ?? authError}
        getEventHref={(eventId) => `/audience?event=${encodeURIComponent(eventId)}&v=${audienceLinkVersionRef.current}`}
      />
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
            <button 
              type="submit" 
              className="primary-button"
              disabled={audienceNameSaving}
            >
              {audienceNameSaving ? 'Joining...' : 'Join Audience'}
            </button>
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
          {hasRequestedEventParam ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigate('/audience')}
            >
              View all upcoming gigs
            </button>
          ) : null}
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
              disabled={allTipLinks.length === 0}
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
            <button
              type="button"
              className="secondary-button"
              aria-controls="audience-how-it-works"
              onClick={() => setShowHowItWorks((current) => !current)}
            >
              {showHowItWorks ? 'Hide How It Works' : 'How It Works'}
            </button>
          </div>
          {showHowItWorks ? (
            <div id="audience-how-it-works" className="audience-how-it-works" role="region" aria-label="How the audience app works">
              <p className="audience-how-it-works-title">How It Works</p>
              <ol className="audience-how-it-works-list">
                <li>Tap Song List to browse and add your request.</li>
                <li>Vote in Live Queue to push your favorites up.</li>
                <li>Watch Now Playing and keep the energy going.</li>
                <li>Use Social Links or Tip Jar to support the artist.</li>
              </ol>
            </div>
          ) : null}
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
                onVote={handleVoteSong}
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

        {socialLinks.length > 0 || allTipLinks.length > 0 ? (
          <section className={`queue-panel link-panel${allTipLinks.length > 0 ? ' tip-jar-panel' : ''}`} aria-label="Performer links">
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

            {allTipLinks.length > 0 ? (
              <>
                <div className="panel-head" id="audience-tip-jar">
                  <h2>Tip Jar</h2>
                </div>
                <p className="subcopy tip-jar-copy">If that last song made you sing like nobody&apos;s watching (they were), toss the artist a tip. Applause is cute, rent is louder. 🎤✨</p>
                <ul className="link-list" aria-label="Tip links">
                  {allTipLinks.map((link) => (
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
