import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsWithChildren } from 'react'
import { supabase } from '../lib/supabase'
import { readFromLocalStorage, saveToLocalStorage } from '../lib/saveHandling'
import { fetchSongArtwork } from '../lib/songArtwork'
import { readCommittedAudienceName } from '../lib/audienceIdentity'
import { useAuthStore } from './authStore'

export type QueueSong = {
  id: string
  event_id: string
  title: string
  artist: string
  votes_count: number
  is_explicit: boolean
  voting_locked: boolean
  is_removed: boolean
  cover_url: string | null
  library_song_id: string | null
  audience_sings: boolean
  position?: number
  createdByName: string | null
}

export type PerformedSong = QueueSong & {
  performedAt: string
}

type AddSongOptions = {
  coverUrl?: string | null
  librarySongId?: string | null
  performerMode?: 'performer' | 'audience'
  bypassEventRules?: boolean
}

type EventSettingsUpdates = {
  name: string
  venue: string
  gigDate: string
  gigStartTime: string
  gigEndTime: string
  subtitle: string
  requestInstructions: string
  instagramUrl: string
  tiktokUrl: string
  youtubeUrl: string
  facebookUrl: string
  paypalUrl: string
  mobilpayUrl: string
  contactEmail: string
  playlistOnlyRequests: boolean
  selectedPlaylistIds: string[]
  mirrorPhotoSpotlightEnabled: boolean
  mirrorCountdownEnabled: boolean
  allowDuplicateRequests: boolean
  maxActiveRequestsPerUser: number | null
  roomOpen: boolean
  explicitFilterEnabled: boolean
  showInAudienceNoGig: boolean
  coverImageUrl: string | null
  venueLogoUrl: string | null
  showCustomButton: boolean
  customButtonLabel: string | null
  customButtonLink: string | null
  tipThankYouMessageDA: string | null
  tipThankYouMessageEN: string | null
  eventType: 'halli-live' | 'karaoke' | 'build-self'
  karafunUrl: string | null
  artistName: string | null
  audienceVotingEnabled: boolean
  autoLiveEnabled: boolean
  introAudioUrl: string | null
}

type EventState = {
  id: string
  hostId: string | null
  name: string
  venue: string | null
  gigDate: string | null
  gigStartTime: string | null
  gigEndTime: string | null
  subtitle: string | null
  requestInstructions: string | null
  instagramUrl: string | null
  tiktokUrl: string | null
  youtubeUrl: string | null
  facebookUrl: string | null
  paypalUrl: string | null
  mobilpayUrl: string | null
  contactEmail: string | null
  playlistOnlyRequests: boolean
  mirrorPhotoSpotlightEnabled: boolean
  mirrorCountdownEnabled: boolean
  allowDuplicateRequests: boolean
  maxActiveRequestsPerUser: number | null
  roomOpen: boolean
  explicitFilterEnabled: boolean
  showInAudienceNoGig: boolean
  coverImageUrl: string | null
  venueLogoUrl: string | null
  showCustomButton: boolean
  customButtonLabel: string | null
  customButtonLink: string | null
  tipThankYouMessageDA: string | null
  tipThankYouMessageEN: string | null
  eventType: 'halli-live' | 'karaoke' | 'build-self'
  karafunUrl: string | null
  artistName: string | null
  audienceVotingEnabled: boolean
  autoLiveEnabled: boolean
  introAudioUrl: string | null
}

type CreateEventOptions = {
  subtitle?: string
  gigDate?: string
  gigStartTime?: string
  gigEndTime?: string
  showInAudienceNoGig?: boolean
  coverImageUrl?: string | null
  eventType?: 'halli-live' | 'karaoke' | 'build-self'
  karafunUrl?: string | null
  artistName?: string | null
  audienceVotingEnabled?: boolean
  autoLiveEnabled?: boolean
  introAudioUrl?: string | null
}

export type HostEventSummary = {
  id: string
  name: string
  venue: string | null
  isActive: boolean
  showInAudienceNoGig: boolean
  createdAt: string
  eventType: 'halli-live' | 'karaoke' | 'build-self'
  gigDate: string | null
  gigStartTime: string | null
  autoLiveEnabled: boolean
  introAudioUrl: string | null
}

export type QueueContextValue = {
  event: EventState | null
  hostEvents: HostEventSummary[]
  songs: QueueSong[]
  performedSongs: PerformedSong[]
  loading: boolean
  audienceConnectionStatus: 'connecting' | 'connected' | 'reconnecting' | 'offline'
  queueOperatingMode: 'normal' | 'degraded'
  queueHealthMessage: string | null
  addSong: (title: string, artist: string, isExplicit: boolean, options?: AddSongOptions) => Promise<void>
  setActiveEvent: (nextEventId: string) => Promise<void>
  endGig: (targetEventId: string) => Promise<void>
  deleteEvent: (targetEventId: string) => Promise<void>
  updateEventSettings: (updates: EventSettingsUpdates) => Promise<void>
  upvoteSong: (songId: string) => Promise<void>
  toggleRoomOpen: () => Promise<void>
  toggleExplicitFilter: () => Promise<void>
  setShowInAudienceNoGig: (visible: boolean) => Promise<void>
  setEventAudienceNoGigVisibility: (targetEventId: string, visible: boolean) => Promise<void>
  toggleVotingLock: (songId: string, nextValue: boolean) => Promise<void>
  removeSong: (songId: string) => Promise<void>
  moveSong: (songId: string, direction: 'up' | 'down') => Promise<void>
  reorderSong: (songId: string, targetIndex: number) => Promise<void>
  createEvent: (name: string, venue: string, options?: CreateEventOptions) => Promise<void>
  markPlayed: () => Promise<void>
  unmarkPlayed: (songId: string) => Promise<void>
}

export const QueueContext = createContext<QueueContextValue | null>(null)
const DEFAULT_DB_TIMEOUT_MS = 25_000
const ROOM_OPEN_SYNC_KEY = 'human-jukebox-room-open-sync'
const HOST_QUEUE_POLL_INTERVAL_MS = 15_000
const HOST_GIGS_ROUTE_POLL_INTERVAL_MS = 30_000
// How often the audience polls when connected to a live event (realtime handles most updates).
const AUDIENCE_QUEUE_POLL_INTERVAL_MS = 12_000
// How often the audience checks for a new live gig when sitting on the no-gig screen.
const AUDIENCE_LIVE_DISCOVERY_POLL_INTERVAL_MS = 8_000
const DEGRADE_AFTER_CONSECUTIVE_FAILURES = 3
const DEGRADED_AUDIENCE_QUEUE_POLL_INTERVAL_MS = 20_000
const DEGRADED_AUDIENCE_LIVE_DISCOVERY_POLL_INTERVAL_MS = 15_000
const TRANSIENT_LOAD_RETRY_ATTEMPTS = 3
const QUEUE_STATE_STORAGE_KEY = 'human-jukebox-queue-state-snapshot'
const QUEUE_STATE_MAX_AGE_MS = 12 * 60 * 60 * 1000

type PersistedQueueSnapshot = {
  event: EventState | null
  hostEvents: HostEventSummary[]
  songs: QueueSong[]
  performedSongs: PerformedSong[]
  nowPlayingSongId: string | null
  updatedAt: number
}

function isFeedRoutePath() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.location.pathname.startsWith('/feed')
}

function isAdminGigsRoutePath() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.location.pathname.startsWith('/admin/gigs')
}

function isAudienceRoutePath() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.location.pathname.startsWith('/audience')
}

function isAuthLockContentionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /lock broken|steal option|navigatorlockacquiretimeouterror|auth-token/i.test(message)
}

function getReadableErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const normalizedError = error as {
      code?: unknown
      message?: unknown
      details?: unknown
      hint?: unknown
      error?: unknown
    }

    const message = typeof normalizedError.message === 'string' ? normalizedError.message.trim() : ''
    const details = typeof normalizedError.details === 'string' ? normalizedError.details.trim() : ''
    const hint = typeof normalizedError.hint === 'string' ? normalizedError.hint.trim() : ''
    const code = typeof normalizedError.code === 'string' ? normalizedError.code.trim() : ''
    const nestedError = typeof normalizedError.error === 'string' ? normalizedError.error.trim() : ''

    const combinedParts = [message, details, hint, nestedError].filter(Boolean)

    if (combinedParts.length > 0) {
      return code ? `${combinedParts.join(' | ')} (${code})` : combinedParts.join(' | ')
    }

    try {
      return JSON.stringify(error)
    } catch {
      return '[unserializable error object]'
    }
  }

  return String(error)
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

function isMissingTipThankYouMessageColumnError(error: unknown) {
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

  return (code === '42703' || code === 'PGRST204')
    && (text.includes('tip_thank_you_message_da') || text.includes('tip_thank_you_message_en'))
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

function isMissingQueueSongProfilesRelationshipError(error: unknown) {
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

  return code === 'PGRST200'
    && text.includes('queue_songs')
    && text.includes('profiles')
}

function isMissingCreateGigRpcError(error: unknown) {
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

  return code === 'PGRST202'
    || code === '42883'
    || (code === '42702' && text.includes('column reference "id" is ambiguous'))
    || text.includes('create_host_gig')
}

function inferPlaylistType(rawType: string | null | undefined, playlistName: string | null | undefined): 'human_jukebox' | 'karaoke' {
  if (rawType === 'karaoke') {
    return 'karaoke'
  }

  if ((playlistName ?? '').toLowerCase().includes('karaoke')) {
    return 'karaoke'
  }

  return 'human_jukebox'
}

async function withAuthLockRetry<T>(operation: () => PromiseLike<T>, maxAttempts = 5) {
  let lastError: unknown = null

  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    try {
      return await Promise.resolve(operation())
    } catch (error) {
      lastError = error

      const isLastAttempt = attemptIndex === maxAttempts - 1

      if (!isAuthLockContentionError(error) || isLastAttempt) {
        throw error
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 300 * (attemptIndex + 1))
      })
    }
  }

  throw lastError
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, message: string) {
  let timerId: number | null = null

  const timeoutPromise = new Promise<T>((_, reject) => {
    timerId = window.setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)
  })

  return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => {
    if (timerId !== null) {
      window.clearTimeout(timerId)
    }
  }) as Promise<T>
}

function isTransientLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /timed out|statement timeout|connection pool|pgrst003|failed to fetch|networkerror|network error/i.test(message)
}

async function withTransientRetry<T>(operation: () => Promise<T>, attempts = TRANSIENT_LOAD_RETRY_ATTEMPTS) {
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const isLastAttempt = attempt >= attempts - 1

      if (!isTransientLoadError(error) || isLastAttempt) {
        throw error
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 350 * (attempt + 1))
      })
    }
  }

  throw lastError
}

function readRequestedEventIdFromUrl() {
  if (typeof window === 'undefined') {
    return null
  }

  const pathSegments = window.location.pathname
    .split('/')
    .filter(Boolean)

  if (pathSegments[0] === 'a') {
    const compactEventId = decodeURIComponent(pathSegments[1] ?? '').trim()

    if (compactEventId) {
      return compactEventId
    }
  }

  const searchParams = new URLSearchParams(window.location.search)
  const requestedEventId = searchParams.get('event') ?? searchParams.get('eventId')

  return requestedEventId?.trim() || null
}

async function fetchLatestActiveEventId() {
  const { data, error } = await withTimeout(
    supabase
      .from('events')
      .select('id')
      .eq('is_active', true)
      .eq('room_open', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    DEFAULT_DB_TIMEOUT_MS,
    'Loading the active gig timed out. Please try again.',
  )

  if (error) {
    throw error
  }

  return data?.id ?? null
}

async function fetchHostEvents(hostId: string) {
  const { data, error } = await withTimeout(
    supabase
      .from('events')
      .select('id, name, venue, is_active, show_in_audience_no_gig, created_at, event_type, gig_date, gig_start_time, auto_live_enabled, intro_audio_url')
      .eq('host_id', hostId)
      .order('created_at', { ascending: false }),
    DEFAULT_DB_TIMEOUT_MS,
    'Loading gigs timed out. Please try again.',
  )

  if (error) {
    throw error
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((eventData) => {
    const rawEventType = eventData.event_type as string | null
    return {
      id: String(eventData.id ?? ''),
      name: (eventData.name as string | null) ?? 'Untitled Gig',
      venue: (eventData.venue as string | null) ?? null,
      isActive: ((eventData.is_active as boolean | null) ?? false),
      showInAudienceNoGig: ((eventData.show_in_audience_no_gig as boolean | null) ?? false),
      createdAt: (eventData.created_at as string | null) ?? '',
      eventType: (rawEventType === 'karaoke' ? 'karaoke' : rawEventType === 'build-self' ? 'build-self' : 'halli-live') as 'halli-live' | 'karaoke' | 'build-self',
      gigDate: (eventData.gig_date as string | null) ?? null,
      gigStartTime: (eventData.gig_start_time as string | null) ?? null,
      autoLiveEnabled: ((eventData.auto_live_enabled as boolean | null) ?? false),
      introAudioUrl: (eventData.intro_audio_url as string | null) ?? null,
    }
  })
}

async function ensureDefaultHostPlaylists(hostId: string, eventName: string) {
  const allPlaylists: Array<{ id: string; name: string; created_at: string; playlist_type: 'human_jukebox' | 'karaoke' }> = []

  const { data: hostPlaylistsWithType, error: hostPlaylistsWithTypeError } = await withTimeout(
    withAuthLockRetry(() =>
      supabase
        .from('playlists')
        .select('id, name, created_at, playlist_type')
        .eq('user_id', hostId)
        .order('created_at', { ascending: true }),
    ),
    DEFAULT_DB_TIMEOUT_MS,
    'Timed out while loading your playlists. Please try again.',
  )

  if (hostPlaylistsWithTypeError && !isMissingPlaylistTypeColumnError(hostPlaylistsWithTypeError)) {
    throw new Error(hostPlaylistsWithTypeError.message)
  }

  if (hostPlaylistsWithTypeError && isMissingPlaylistTypeColumnError(hostPlaylistsWithTypeError)) {
    const { data: hostPlaylistsWithoutType, error: hostPlaylistsWithoutTypeError } = await withTimeout(
      withAuthLockRetry(() =>
        supabase
          .from('playlists')
          .select('id, name, created_at')
          .eq('user_id', hostId)
          .order('created_at', { ascending: true }),
      ),
      DEFAULT_DB_TIMEOUT_MS,
      'Timed out while loading your playlists. Please try again.',
    )

    if (hostPlaylistsWithoutTypeError) {
      throw new Error(hostPlaylistsWithoutTypeError.message)
    }

    allPlaylists.push(...((hostPlaylistsWithoutType ?? []) as Array<{ id: string; name: string; created_at: string }>).map((playlist) => ({
      ...playlist,
      playlist_type: inferPlaylistType(null, playlist.name),
    })))
  } else {
    allPlaylists.push(...((hostPlaylistsWithType ?? []) as Array<{ id: string; name: string; created_at: string; playlist_type?: string | null }>).map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      created_at: playlist.created_at,
      playlist_type: inferPlaylistType(playlist.playlist_type, playlist.name),
    })))
  }

  let defaultPlaylistId = allPlaylists[0]?.id ?? null
  let karaokePlaylistId = allPlaylists.find((playlist) => playlist.playlist_type === 'karaoke')?.id ?? null

  if (!defaultPlaylistId) {
    const { data: createdDefaultWithType, error: createdDefaultWithTypeError } = await withTimeout(
      withAuthLockRetry(() =>
        supabase
          .from('playlists')
          .insert({
            user_id: hostId,
            name: eventName ? `${eventName} Setlist` : 'Main Setlist',
            description: 'Main setlist for live requests.',
            playlist_type: 'human_jukebox',
          })
          .select('id')
          .single(),
      ),
      DEFAULT_DB_TIMEOUT_MS,
      'Timed out while creating your default playlist. Please try again.',
    )

    if (createdDefaultWithTypeError && !isMissingPlaylistTypeColumnError(createdDefaultWithTypeError)) {
      throw new Error(createdDefaultWithTypeError.message)
    }

    if (createdDefaultWithTypeError && isMissingPlaylistTypeColumnError(createdDefaultWithTypeError)) {
      const { data: createdDefaultWithoutType, error: createdDefaultWithoutTypeError } = await withTimeout(
        withAuthLockRetry(() =>
          supabase
            .from('playlists')
            .insert({
              user_id: hostId,
              name: eventName ? `${eventName} Setlist` : 'Main Setlist',
              description: 'Main setlist for live requests.',
            })
            .select('id')
            .single(),
        ),
        DEFAULT_DB_TIMEOUT_MS,
        'Timed out while creating your default playlist. Please try again.',
      )

      if (createdDefaultWithoutTypeError || !createdDefaultWithoutType?.id) {
        throw new Error(createdDefaultWithoutTypeError?.message ?? 'Unable to create your default playlist.')
      }

      defaultPlaylistId = createdDefaultWithoutType.id
    } else {
      defaultPlaylistId = createdDefaultWithType?.id ?? null
    }

    if (!defaultPlaylistId) {
      throw new Error('Unable to create your default playlist.')
    }
  }

  if (!karaokePlaylistId) {
    const { data: createdKaraokeWithType, error: createdKaraokeWithTypeError } = await withTimeout(
      withAuthLockRetry(() =>
        supabase
          .from('playlists')
          .insert({
            user_id: hostId,
            name: 'Karaoke Only',
            description: 'Songs reserved for audience karaoke requests.',
            playlist_type: 'karaoke',
          })
          .select('id')
          .single(),
      ),
      DEFAULT_DB_TIMEOUT_MS,
      'Timed out while creating the karaoke playlist. Please try again.',
    )

    if (createdKaraokeWithTypeError && !isMissingPlaylistTypeColumnError(createdKaraokeWithTypeError)) {
      throw new Error(createdKaraokeWithTypeError.message)
    }

    if (createdKaraokeWithTypeError && isMissingPlaylistTypeColumnError(createdKaraokeWithTypeError)) {
      const { data: createdKaraokeWithoutType, error: createdKaraokeWithoutTypeError } = await withTimeout(
        withAuthLockRetry(() =>
          supabase
            .from('playlists')
            .insert({
              user_id: hostId,
              name: 'Karaoke Only',
              description: 'Songs reserved for audience karaoke requests.',
            })
            .select('id')
            .single(),
        ),
        DEFAULT_DB_TIMEOUT_MS,
        'Timed out while creating the karaoke playlist. Please try again.',
      )

      if (createdKaraokeWithoutTypeError || !createdKaraokeWithoutType?.id) {
        throw new Error(createdKaraokeWithoutTypeError?.message ?? 'Unable to create the karaoke playlist.')
      }

      karaokePlaylistId = createdKaraokeWithoutType.id
    } else {
      karaokePlaylistId = createdKaraokeWithType?.id ?? null
    }

    if (!karaokePlaylistId) {
      throw new Error('Unable to create the karaoke playlist.')
    }
  }

  return {
    defaultPlaylistId,
    karaokePlaylistId,
  }
}

function QueueProvider({ children }: PropsWithChildren) {
  const { user, profile, isHost, refreshProfile } = useAuthStore()
  const [event, setEvent] = useState<EventState | null>(null)
  const [hostEvents, setHostEvents] = useState<HostEventSummary[]>([])
  const [songs, setSongs] = useState<QueueSong[]>([])
  const [performedSongs, setPerformedSongs] = useState<PerformedSong[]>([])
  const [loading, setLoading] = useState(true)
  const [audienceConnectionStatus, setAudienceConnectionStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'offline'>('connecting')
  const [queueOperatingMode, setQueueOperatingMode] = useState<'normal' | 'degraded'>('normal')
  const [queueHealthMessage, setQueueHealthMessage] = useState<string | null>(null)
  const [audienceRefreshTick, setAudienceRefreshTick] = useState(0)
  const activeEventIdRef = useRef<string | null>(null)

  const eventId = profile?.active_event_id ?? null
  const isHostSession = isHost
  const routePathname = typeof window === 'undefined' ? '' : window.location.pathname

  useEffect(() => {
    const snapshot = readFromLocalStorage<PersistedQueueSnapshot | null>(QUEUE_STATE_STORAGE_KEY, null)

    if (!snapshot) {
      return
    }

    const snapshotAge = Date.now() - (snapshot.updatedAt ?? 0)
    if (!Number.isFinite(snapshotAge) || snapshotAge > QUEUE_STATE_MAX_AGE_MS) {
      return
    }

    setEvent(snapshot.event ?? null)
    setHostEvents(Array.isArray(snapshot.hostEvents) ? snapshot.hostEvents : [])
    setSongs(Array.isArray(snapshot.songs) ? snapshot.songs : [])
    setPerformedSongs(Array.isArray(snapshot.performedSongs) ? snapshot.performedSongs : [])
    activeEventIdRef.current = snapshot.event?.id ?? null
    setLoading(false)
  }, [])

  useEffect(() => {
    saveToLocalStorage(QUEUE_STATE_STORAGE_KEY, {
      event,
      hostEvents,
      songs,
      performedSongs,
      nowPlayingSongId: songs[0]?.id ?? null,
      updatedAt: Date.now(),
    } satisfies PersistedQueueSnapshot)
  }, [event, hostEvents, performedSongs, songs])

  const fetchQueueSnapshot = useCallback(async (activeEventId: string) => {
    const loadEventSnapshot = async () => {
      const withCoverSelect = 'id, host_id, name, venue, gig_date, gig_start_time, gig_end_time, subtitle, request_instructions, instagram_url, tiktok_url, youtube_url, facebook_url, paypal_url, mobilpay_url, contact_email, playlist_only_requests, mirror_photo_spotlight_enabled, mirror_countdown_enabled, allow_duplicate_requests, max_active_requests_per_user, room_open, explicit_filter_enabled, show_in_audience_no_gig, cover_image_url, venue_logo_url, show_custom_button, custom_button_label, custom_button_link'
      const withoutCoverSelect = 'id, host_id, name, venue, gig_date, gig_start_time, gig_end_time, subtitle, request_instructions, instagram_url, tiktok_url, youtube_url, facebook_url, paypal_url, mobilpay_url, contact_email, playlist_only_requests, mirror_photo_spotlight_enabled, mirror_countdown_enabled, allow_duplicate_requests, max_active_requests_per_user, room_open, explicit_filter_enabled, show_in_audience_no_gig, venue_logo_url, show_custom_button, custom_button_label, custom_button_link'

      const { data, error } = await supabase
        .from('events')
        .select(withCoverSelect)
        .eq('id', activeEventId)
        .single()

      if (!error) {
        return data as Record<string, unknown>
      }

      if (!isMissingCoverImageColumnError(error)) {
        throw error
      }

      const { data: fallbackData, error: fallbackError } = await supabase
        .from('events')
        .select(withoutCoverSelect)
        .eq('id', activeEventId)
        .single()

      if (fallbackError) {
        throw fallbackError
      }

      return {
        ...(fallbackData as Record<string, unknown>),
        cover_image_url: null,
        venue_logo_url: (fallbackData as Record<string, unknown>).venue_logo_url ?? null,
      }
    }

    // Separately fetch tip thank-you messages (columns may not exist in older DB schemas).
    // This is non-blocking — failure just results in null values.
    const loadTipMessages = async (): Promise<{ tip_thank_you_message_da: string | null; tip_thank_you_message_en: string | null }> => {
      try {
        const { data, error } = await supabase
          .from('events')
          .select('tip_thank_you_message_da, tip_thank_you_message_en')
          .eq('id', activeEventId)
          .single()

        if (error || !data) {
          return { tip_thank_you_message_da: null, tip_thank_you_message_en: null }
        }

        const row = data as Record<string, unknown>
        return {
          tip_thank_you_message_da: (row.tip_thank_you_message_da as string | null) ?? null,
          tip_thank_you_message_en: (row.tip_thank_you_message_en as string | null) ?? null,
        }
      } catch {
        return { tip_thank_you_message_da: null, tip_thank_you_message_en: null }
      }
    }

    // Separately fetch event type settings (columns added via migration — graceful fallback).
    const loadEventTypeSettings = async (): Promise<{ event_type: 'halli-live' | 'karaoke' | 'build-self'; karafun_url: string | null; artist_name: string | null; audience_voting_enabled: boolean; auto_live_enabled: boolean; intro_audio_url: string | null }> => {
      try {
        const { data, error } = await supabase
          .from('events')
          .select('event_type, karafun_url, event_artist_name, audience_voting_enabled, auto_live_enabled, intro_audio_url')
          .eq('id', activeEventId)
          .single()

        if (error || !data) {
          return { event_type: 'halli-live', karafun_url: null, artist_name: null, audience_voting_enabled: true, auto_live_enabled: false, intro_audio_url: null }
        }

        const row = data as Record<string, unknown>
        const rawType = row.event_type as string | null
        const resolvedType: 'halli-live' | 'karaoke' | 'build-self' =
          rawType === 'karaoke' ? 'karaoke' : rawType === 'build-self' ? 'build-self' : 'halli-live'
        return {
          event_type: resolvedType,
          karafun_url: (row.karafun_url as string | null) ?? null,
          artist_name: (row.event_artist_name as string | null) ?? null,
          audience_voting_enabled: (row.audience_voting_enabled as boolean | null) ?? true,
          auto_live_enabled: (row.auto_live_enabled as boolean | null) ?? false,
          intro_audio_url: (row.intro_audio_url as string | null) ?? null,
        }
      } catch {
        return { event_type: 'halli-live', karafun_url: null, artist_name: null, audience_voting_enabled: true, auto_live_enabled: false, intro_audio_url: null }
      }
    }

    const [eventData, tipMessages, eventTypeSettings] = await Promise.all([
      withTimeout(
        loadEventSnapshot(),
        DEFAULT_DB_TIMEOUT_MS,
        'Loading the live gig timed out. Please refresh and try again.',
      ),
      loadTipMessages(),
      loadEventTypeSettings(),
    ])

    let queueSongs: QueueSong[] = []
    let queueLoaded = false

    try {
      const songsSelectWithProfiles = 'id, event_id, title, artist, votes_count, is_explicit, voting_locked, is_removed, cover_url, library_song_id, audience_sings, position, created_by, requester_name'
      const songsSelectWithoutProfiles = songsSelectWithProfiles

      let songsData: Array<Record<string, unknown>> | null = null

      const { data: songsWithProfiles, error: songsWithProfilesError } = await withTimeout(
        supabase
          .from('queue_songs')
          .select(songsSelectWithProfiles)
          .eq('event_id', activeEventId)
          .eq('is_removed', false)
          .order('position', { ascending: true }),
        DEFAULT_DB_TIMEOUT_MS,
        'Loading the queue timed out. Please refresh and try again.',
      )

      if (songsWithProfilesError && !isMissingQueueSongProfilesRelationshipError(songsWithProfilesError)) {
        throw songsWithProfilesError
      }

      if (songsWithProfilesError && isMissingQueueSongProfilesRelationshipError(songsWithProfilesError)) {
        const { data: songsWithoutProfiles, error: songsWithoutProfilesError } = await withTimeout(
          supabase
            .from('queue_songs')
            .select(songsSelectWithoutProfiles)
            .eq('event_id', activeEventId)
            .eq('is_removed', false)
            .order('position', { ascending: true }),
          DEFAULT_DB_TIMEOUT_MS,
          'Loading the queue timed out. Please refresh and try again.',
        )

        if (songsWithoutProfilesError) {
          throw songsWithoutProfilesError
        }

        songsData = (songsWithoutProfiles ?? []) as Array<Record<string, unknown>>
      } else {
        songsData = (songsWithProfiles ?? []) as Array<Record<string, unknown>>
      }

      const mappedQueueSongs = (songsData ?? []).map((song) => {
        const normalizedSong = song as Record<string, unknown>
        const profile = normalizedSong.profiles as { display_name?: string | null } | null | undefined
        const creatorId = typeof normalizedSong.created_by === 'string' ? normalizedSong.created_by : null
        const requesterName = typeof normalizedSong.requester_name === 'string' ? normalizedSong.requester_name.trim() : ''

        return {
          id: String(normalizedSong.id ?? ''),
          event_id: String(normalizedSong.event_id ?? ''),
          title: String(normalizedSong.title ?? ''),
          artist: String(normalizedSong.artist ?? ''),
          votes_count: Number(normalizedSong.votes_count ?? 0),
          is_explicit: Boolean(normalizedSong.is_explicit),
          voting_locked: Boolean(normalizedSong.voting_locked),
          is_removed: Boolean(normalizedSong.is_removed),
          cover_url: (normalizedSong.cover_url as string | null) ?? null,
          library_song_id: (normalizedSong.library_song_id as string | null) ?? null,
          audience_sings: Boolean(normalizedSong.audience_sings),
          position: typeof normalizedSong.position === 'number' ? normalizedSong.position : undefined,
          createdByName: requesterName || profile?.display_name || null,
          creatorId,
        }
      })

      const missingCreatorIds = [...new Set(
        mappedQueueSongs
          .filter((song) => !song.createdByName && song.creatorId)
          .map((song) => song.creatorId)
          .filter((creatorId): creatorId is string => Boolean(creatorId)),
      )]

      let creatorNameById = new Map<string, string>()

      if (missingCreatorIds.length > 0) {
        try {
          const { data: creatorProfiles, error: creatorProfilesError } = await withTimeout(
            supabase
              .from('profiles')
              .select('user_id, display_name')
              .in('user_id', missingCreatorIds),
            DEFAULT_DB_TIMEOUT_MS,
            'Loading queue picker names timed out. Please refresh and try again.',
          )

          if (creatorProfilesError) {
            throw creatorProfilesError
          }

          creatorNameById = new Map(
            ((creatorProfiles ?? []) as Array<{ user_id?: string | null; display_name?: string | null }>)
              .filter((profile) => Boolean(profile.user_id && profile.display_name))
              .map((profile) => [profile.user_id as string, profile.display_name as string]),
          )
        } catch (error) {
          console.warn('queueStore: failed to backfill queue picker names from profiles', error)
        }
      }

      queueSongs = mappedQueueSongs.map((song) => ({
        id: song.id,
        event_id: song.event_id,
        title: song.title,
        artist: song.artist,
        votes_count: song.votes_count,
        is_explicit: song.is_explicit,
        voting_locked: song.voting_locked,
        is_removed: song.is_removed,
        cover_url: song.cover_url,
        library_song_id: song.library_song_id,
        audience_sings: song.audience_sings,
        position: song.position,
        createdByName: song.createdByName ?? (song.creatorId ? creatorNameById.get(song.creatorId) ?? null : null),
      }))
      queueLoaded = true
    } catch (error) {
      if (!isTransientLoadError(error)) {
        throw error
      }

      console.warn('queueStore: queue songs unavailable, keeping live event shell active', error)
    }

    const missingCoverLibrarySongIds = [...new Set(
      queueSongs
        .filter((song) => !song.cover_url && song.library_song_id)
        .map((song) => song.library_song_id)
        .filter((songId): songId is string => Boolean(songId)),
    )]

    let coverUrlByLibrarySongId = new Map<string, string>()

    if (missingCoverLibrarySongIds.length > 0) {
      const { data: librarySongsWithCovers, error: librarySongsWithCoversError } = await supabase
        .from('library_songs')
        .select('id, cover_url')
        .in('id', missingCoverLibrarySongIds)

      if (librarySongsWithCoversError) {
        console.warn('queueStore: failed to backfill queue cover art from library songs', librarySongsWithCoversError)
      } else {
        coverUrlByLibrarySongId = new Map(
          ((librarySongsWithCovers ?? []) as Array<{ id?: string | null; cover_url?: string | null }>)
            .filter((song) => Boolean(song.id && song.cover_url))
            .map((song) => [song.id as string, song.cover_url as string]),
        )
      }
    }

    setEvent({
      id: String((eventData as Record<string, unknown>).id ?? ''),
      hostId: (eventData as Record<string, unknown>).host_id as string | null ?? null,
      name: (eventData as Record<string, unknown>).name as string ?? 'Untitled Gig',
      venue: (eventData as Record<string, unknown>).venue as string | null ?? null,
      gigDate: (eventData as Record<string, unknown>).gig_date as string | null ?? null,
      gigStartTime: (eventData as Record<string, unknown>).gig_start_time as string | null ?? null,
      gigEndTime: (eventData as Record<string, unknown>).gig_end_time as string | null ?? null,
      subtitle: (eventData as Record<string, unknown>).subtitle as string | null ?? null,
      requestInstructions: (eventData as Record<string, unknown>).request_instructions as string | null ?? null,
      instagramUrl: (eventData as Record<string, unknown>).instagram_url as string | null ?? null,
      tiktokUrl: (eventData as Record<string, unknown>).tiktok_url as string | null ?? null,
      youtubeUrl: (eventData as Record<string, unknown>).youtube_url as string | null ?? null,
      facebookUrl: (eventData as Record<string, unknown>).facebook_url as string | null ?? null,
      paypalUrl: (eventData as Record<string, unknown>).paypal_url as string | null ?? null,
      mobilpayUrl: (eventData as Record<string, unknown>).mobilpay_url as string | null ?? null,
      contactEmail: (eventData as Record<string, unknown>).contact_email as string | null ?? null,
      playlistOnlyRequests: ((eventData as Record<string, unknown>).playlist_only_requests as boolean | null) ?? false,
      mirrorPhotoSpotlightEnabled: ((eventData as Record<string, unknown>).mirror_photo_spotlight_enabled as boolean | null) ?? true,
      mirrorCountdownEnabled: ((eventData as Record<string, unknown>).mirror_countdown_enabled as boolean | null) ?? true,
      allowDuplicateRequests: ((eventData as Record<string, unknown>).allow_duplicate_requests as boolean | null) ?? true,
      maxActiveRequestsPerUser: (eventData as Record<string, unknown>).max_active_requests_per_user as number | null ?? null,
      roomOpen: ((eventData as Record<string, unknown>).room_open as boolean | null) ?? false,
      explicitFilterEnabled: ((eventData as Record<string, unknown>).explicit_filter_enabled as boolean | null) ?? false,
      showInAudienceNoGig: ((eventData as Record<string, unknown>).show_in_audience_no_gig as boolean | null) ?? false,
      coverImageUrl: ((eventData as Record<string, unknown>).cover_image_url as string | null) ?? null,
      venueLogoUrl: ((eventData as Record<string, unknown>).venue_logo_url as string | null) ?? null,
      showCustomButton: ((eventData as Record<string, unknown>).show_custom_button as boolean | null) ?? false,
      customButtonLabel: ((eventData as Record<string, unknown>).custom_button_label as string | null) ?? null,
      customButtonLink: ((eventData as Record<string, unknown>).custom_button_link as string | null) ?? null,
      tipThankYouMessageDA: tipMessages.tip_thank_you_message_da,
      tipThankYouMessageEN: tipMessages.tip_thank_you_message_en,
      eventType: eventTypeSettings.event_type,
      karafunUrl: eventTypeSettings.karafun_url,
      artistName: eventTypeSettings.artist_name,
      audienceVotingEnabled: eventTypeSettings.audience_voting_enabled,
      autoLiveEnabled: eventTypeSettings.auto_live_enabled,
      introAudioUrl: eventTypeSettings.intro_audio_url,
    })
    if (queueLoaded) {
      setSongs(queueSongs.map((song) => {
        if (song.cover_url || !song.library_song_id) {
          return song
        }

        return {
          ...song,
          cover_url: coverUrlByLibrarySongId.get(song.library_song_id) ?? null,
        }
      }))
    } else {
      setSongs((currentSongs) => (activeEventIdRef.current === activeEventId ? currentSongs : []))
    }
  }, [])

  const fetchQueueSnapshotRef = useRef(fetchQueueSnapshot)

  useEffect(() => {
    fetchQueueSnapshotRef.current = fetchQueueSnapshot
  }, [fetchQueueSnapshot])

  useEffect(() => {
    let isCurrent = true
    let activeChannel: ReturnType<typeof supabase.channel> | null = null
    let audiencePollTimerId: number | null = null
    let channelReconnectTimerId: number | null = null
    let channelReconnectAttempt = 0
    let activeChannelReconnectHandler: (() => void) | null = null
    let channelWatchdogTimerId: number | null = null
    let lastRealtimeEventAt = Date.now()
    const feedRouteMode = isFeedRoutePath()
    let snapshotInFlight = false
    let snapshotQueued = false
    let consecutiveLoadFailures = 0

    const markSnapshotSuccess = () => {
      consecutiveLoadFailures = 0
      setQueueOperatingMode('normal')
      setQueueHealthMessage(null)
    }

    const markSnapshotFailure = (error: unknown) => {
      consecutiveLoadFailures += 1

      if (consecutiveLoadFailures >= DEGRADE_AFTER_CONSECUTIVE_FAILURES) {
        setQueueOperatingMode('degraded')
        setQueueHealthMessage(`Live sync is unstable. Running fallback mode: slower polling and auto-retries. (${getReadableErrorMessage(error)})`)
      }
    }

    const clearChannelReconnectTimer = () => {
      if (channelReconnectTimerId !== null) {
        window.clearTimeout(channelReconnectTimerId)
        channelReconnectTimerId = null
      }
    }

    const disconnectActiveChannel = () => {
      if (activeChannel) {
        void supabase.removeChannel(activeChannel)
        activeChannel = null
      }
    }

    const scheduleChannelReconnect = () => {
      // For audience sessions, don't schedule reconnects when the tab is hidden
      // (saves battery on mobile). Host sessions must always reconnect.
      if (!isCurrent || (!isHostSession && document.hidden) || !activeChannelReconnectHandler || channelReconnectTimerId !== null) {
        return
      }

      const maxBackoffMs = isHostSession ? 4000 : 8000
      const retryDelayMs = Math.min(1000 * (2 ** channelReconnectAttempt), maxBackoffMs)
      channelReconnectAttempt += 1

      channelReconnectTimerId = window.setTimeout(() => {
        channelReconnectTimerId = null

        if (!isCurrent || !activeChannelReconnectHandler) {
          return
        }

        activeChannelReconnectHandler()
      }, retryDelayMs)
    }

    // Watchdog: if the Realtime channel is subscribed but delivers no events
    // for too long, force a reconnect. This catches silent NAT/proxy timeouts
    // that cut the WebSocket without triggering a CHANNEL_ERROR.
    // Host sessions use a shorter threshold to detect drops faster.
    const REALTIME_WATCHDOG_INTERVAL_MS = 30_000
    const REALTIME_SILENCE_THRESHOLD_MS = isHostSession ? 45_000 : 90_000

    const clearChannelWatchdog = () => {
      if (channelWatchdogTimerId !== null) {
        window.clearInterval(channelWatchdogTimerId)
        channelWatchdogTimerId = null
      }
    }

    const startChannelWatchdog = () => {
      clearChannelWatchdog()

      channelWatchdogTimerId = window.setInterval(() => {
        // Host sessions keep the watchdog running even when hidden (tab not focused)
        // so they recover silently if the connection is lost while the host
        // has briefly switched to another app.
        if (!isCurrent || (!isHostSession && document.hidden) || !activeChannel) {
          return
        }

        const silenceMs = Date.now() - lastRealtimeEventAt

        if (silenceMs >= REALTIME_SILENCE_THRESHOLD_MS) {
          console.warn(`queueStore: Realtime silent for ${silenceMs}ms — forcing reconnect`)
          lastRealtimeEventAt = Date.now()
          scheduleChannelReconnect()
        }
      }, REALTIME_WATCHDOG_INTERVAL_MS)
    }

    const load = async () => {
      if (!user) {
        activeEventIdRef.current = null
        if (isCurrent) {
          setAudienceConnectionStatus('offline')
          setEvent(null)
          setHostEvents([])
          setSongs([])
          setPerformedSongs([])
          setLoading(false)
        }
        return
      }

      setLoading(true)

      try {
        let targetEventId: string | null = null
        const requestedEventId = readRequestedEventIdFromUrl()
        const runAsHostSession = isHostSession && !isAudienceRoutePath()
        setAudienceConnectionStatus(runAsHostSession ? 'connected' : 'connecting')

        const syncAudienceActiveEventId = async (nextEventId: string) => {
          if (runAsHostSession) {
            return
          }

          if (eventId === nextEventId) {
            return
          }

          // Use a short timeout — this is a background optimisation only.
          // A failure must never block the audience from seeing the live queue.
          const PROFILE_SYNC_TIMEOUT_MS = 6_000

          const { error: profileUpdateError } = await withTimeout(
            withAuthLockRetry(() =>
              supabase
                .from('profiles')
                .update({ active_event_id: nextEventId })
                .eq('user_id', user.id),
            ),
            PROFILE_SYNC_TIMEOUT_MS,
            'Profile sync timed out.',
          )

          if (profileUpdateError) {
            // Foreign key violation means the requested event ID no longer exists.
            // Signal the caller to fall back to the latest active event instead.
            if (profileUpdateError.code === '23503') {
              throw Object.assign(new Error(profileUpdateError.message), { isForeignKeyViolation: true })
            }
            // All other errors: log and continue — the queue still loads.
            console.warn('queueStore: profile active_event_id sync failed (non-blocking)', profileUpdateError.message)
          }
        }

        if (runAsHostSession) {
          const nextHostEvents = await withTransientRetry(() => fetchHostEvents(user.id))

          if (isCurrent) {
            setHostEvents(nextHostEvents)
          }

          targetEventId = nextHostEvents.find((nextEvent) => nextEvent.id === eventId)?.id
            ?? nextHostEvents.find((nextEvent) => nextEvent.isActive)?.id
            ?? nextHostEvents[0]?.id
            ?? null
        } else {
          // Audience default behavior: prefer explicit event in URL.
          // Otherwise, only auto-attach to currently live gigs (room open).
          targetEventId = requestedEventId ?? await fetchLatestActiveEventId()
        }

        const requestAudienceReload = () => {
          if (!isCurrent || runAsHostSession) {
            return
          }

          setAudienceRefreshTick((currentTick) => currentTick + 1)
        }

        const maybeReloadAudienceWhenLiveReturns = async () => {
          if (runAsHostSession) {
            return
          }

          try {
            const latestActiveEventId = await fetchLatestActiveEventId()

            if (latestActiveEventId && latestActiveEventId !== activeEventIdRef.current) {
              requestAudienceReload()
            }
          } catch (error) {
            console.warn('queueStore: failed to re-check latest active event', error)
          }
        }

        if (!targetEventId) {
          activeEventIdRef.current = null
          if (isCurrent) {
            setEvent(null)
            setSongs([])
            setPerformedSongs([])
          }

          if (!runAsHostSession) {
            const connectAudienceLiveWatchChannel = () => {
              if (!isCurrent || document.hidden) {
                return
              }

              clearChannelReconnectTimer()
              disconnectActiveChannel()

              activeChannel = supabase
                .channel('audience-live-watch')
                .on(
                  'postgres_changes',
                  {
                    event: '*',
                    schema: 'public',
                    table: 'events',
                  },
                  () => {
                    void maybeReloadAudienceWhenLiveReturns()
                  },
                )
                .subscribe((status) => {
                  if (!isCurrent) {
                    return
                  }

                  if (status === 'SUBSCRIBED') {
                    channelReconnectAttempt = 0
                    setAudienceConnectionStatus('connected')
                    void maybeReloadAudienceWhenLiveReturns()
                    return
                  }

                  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    setAudienceConnectionStatus('reconnecting')
                    scheduleChannelReconnect()
                  }
                })
            }

            activeChannelReconnectHandler = connectAudienceLiveWatchChannel
            connectAudienceLiveWatchChannel()

            audiencePollTimerId = window.setInterval(() => {
              if (document.hidden || !isCurrent) {
                return
              }

              void maybeReloadAudienceWhenLiveReturns()
            }, queueOperatingMode === 'degraded'
              ? DEGRADED_AUDIENCE_LIVE_DISCOVERY_POLL_INTERVAL_MS
              : AUDIENCE_LIVE_DISCOVERY_POLL_INTERVAL_MS)
          }

          return
        }

        if (!runAsHostSession) {
          // Only await long enough to detect a stale event ID (FK violation).
          // Profile sync errors are non-blocking — the queue loads regardless.
          try {
            await syncAudienceActiveEventId(targetEventId!)
          } catch (syncError) {
            // If the event ID is stale (FK violation), fall back to the current live event.
            if (syncError instanceof Error && (syncError as Error & { isForeignKeyViolation?: boolean }).isForeignKeyViolation) {
              console.warn('queueStore: requested event no longer exists, falling back to latest active event', syncError)
              const latestActiveEventId = await fetchLatestActiveEventId()
              if (!latestActiveEventId) {
                activeEventIdRef.current = null
                if (isCurrent) {
                  setEvent(null)
                  setSongs([])
                  setPerformedSongs([])
                }
                return
              }
              targetEventId = latestActiveEventId
              // Best-effort sync for the fallback event — don't block on it.
              void syncAudienceActiveEventId(latestActiveEventId).catch(() => {})
            }
            // All other sync errors are already logged inside syncAudienceActiveEventId — continue loading.
          }
        }

        let resolvedEventId: string = targetEventId!
        activeEventIdRef.current = resolvedEventId

        if (isCurrent) {
          setPerformedSongs([])
        }

        try {
          await withTransientRetry(() => fetchQueueSnapshot(resolvedEventId), 2)
          markSnapshotSuccess()
        } catch (error) {
          markSnapshotFailure(error)
          const canFallbackToLatestActive = !runAsHostSession

          if (!canFallbackToLatestActive) {
            console.warn('queueStore: failed to load requested event snapshot', error)
            throw new Error('Unable to load requested event.', { cause: error })
          }

          const latestActiveEventId = await fetchLatestActiveEventId()

          if (!latestActiveEventId) {
            throw new Error('No active gig found.', { cause: error })
          }

          resolvedEventId = latestActiveEventId

          if (!runAsHostSession) {
            // Best-effort — don't block the snapshot load on a profile write.
            void syncAudienceActiveEventId(resolvedEventId).catch(() => {})
          }

          await withTransientRetry(() => fetchQueueSnapshot(resolvedEventId), 2)
          markSnapshotSuccess()
        }

        if (!isCurrent) {
          return
        }

        const refreshSnapshot = async () => {
          if (!isCurrent) {
            return
          }

          if (snapshotInFlight) {
            snapshotQueued = true
            return
          }

          snapshotInFlight = true

          try {
            if (runAsHostSession) {
              const refreshedHostEvents = await withTransientRetry(() => fetchHostEvents(user.id), 2)

              if (isCurrent) {
                setHostEvents(refreshedHostEvents)
              }

              if (!refreshedHostEvents.some((hostEvent) => hostEvent.id === resolvedEventId)) {
                const fallbackHostEventId = refreshedHostEvents.find((hostEvent) => hostEvent.isActive)?.id
                  ?? refreshedHostEvents[0]?.id
                  ?? null

                if (!fallbackHostEventId) {
                  setEvent(null)
                  setSongs([])
                  setPerformedSongs([])
                  activeEventIdRef.current = null
                  return
                }

                resolvedEventId = fallbackHostEventId
                activeEventIdRef.current = fallbackHostEventId
              }
            }

            const requestedEventIdFromUrl = readRequestedEventIdFromUrl()

            if (!runAsHostSession && requestedEventIdFromUrl && requestedEventIdFromUrl !== resolvedEventId) {
              activeEventIdRef.current = requestedEventIdFromUrl
              requestAudienceReload()
              return
            }

            if (!runAsHostSession && !requestedEventIdFromUrl) {
              const latestActiveEventId = await fetchLatestActiveEventId()

              if (!latestActiveEventId) {
                activeEventIdRef.current = null
                setEvent(null)
                setSongs([])
                setPerformedSongs([])
                requestAudienceReload()
                return
              }

              if (latestActiveEventId !== resolvedEventId) {
                activeEventIdRef.current = latestActiveEventId
                requestAudienceReload()
                return
              }
            }

            await withTransientRetry(() => fetchQueueSnapshot(resolvedEventId), 2)
            markSnapshotSuccess()
          } catch (error) {
            markSnapshotFailure(error)
            console.warn('queueStore: transient snapshot refresh failure', error)
            // Keep the last known snapshot when transient network errors occur.
          } finally {
            snapshotInFlight = false

            if (snapshotQueued) {
              snapshotQueued = false
              void refreshSnapshot()
            }
          }
        }

        const connectQueueLiveChannel = () => {
          if (!isCurrent || document.hidden) {
            return
          }

          clearChannelReconnectTimer()
          disconnectActiveChannel()

          activeChannel = supabase
            .channel(`queue-live-${resolvedEventId}`)
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'queue_songs',
                filter: `event_id=eq.${resolvedEventId}`,
              },
              () => {
                lastRealtimeEventAt = Date.now()
                if (!feedRouteMode) {
                  void refreshSnapshot()
                }
              },
            )
            .on(
              'postgres_changes',
              {
                event: 'UPDATE',
                schema: 'public',
                table: 'events',
                filter: `id=eq.${resolvedEventId}`,
              },
              () => {
                lastRealtimeEventAt = Date.now()
                void refreshSnapshot()
              },
            )
            .subscribe((status) => {
              if (!isCurrent) {
                return
              }

              if (status === 'SUBSCRIBED') {
                channelReconnectAttempt = 0
                lastRealtimeEventAt = Date.now()
                setAudienceConnectionStatus('connected')
                startChannelWatchdog()
                // Force a fresh fetch once subscribed to catch any missed changes.
                void refreshSnapshot()
                return
              }

              if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                setAudienceConnectionStatus('reconnecting')
                clearChannelWatchdog()
                scheduleChannelReconnect()
              }
            })
        }

        activeChannelReconnectHandler = connectQueueLiveChannel
        connectQueueLiveChannel()

        const pollIntervalMs = runAsHostSession
          ? (isAdminGigsRoutePath() ? HOST_GIGS_ROUTE_POLL_INTERVAL_MS : HOST_QUEUE_POLL_INTERVAL_MS)
          : queueOperatingMode === 'degraded'
          ? DEGRADED_AUDIENCE_QUEUE_POLL_INTERVAL_MS
          : AUDIENCE_QUEUE_POLL_INTERVAL_MS

        audiencePollTimerId = window.setInterval(() => {
          if (document.hidden) {
            return
          }

          if (isCurrent) {
            void refreshSnapshot()
          }
        }, pollIntervalMs)
      } catch (error) {
        markSnapshotFailure(error)
        setAudienceConnectionStatus('reconnecting')
        console.warn('queueStore: initial queue load failed', error)
        // Keep previous state so transient failures do not blank the UI.
        if (isCurrent) {
          setLoading(false)
        }
      } finally {
        if (isCurrent) {
          setLoading(false)
        }
      }
    }

    void load()

    const resumeRealtimeSync = () => {
      if (!isCurrent || document.hidden) {
        return
      }

      clearChannelReconnectTimer()
      channelReconnectAttempt = 0
      lastRealtimeEventAt = Date.now()

      // Proactively refresh the anonymous auth token when foregrounding after a
      // long background period (e.g. phone screen off during a 3+ hour gig).
      // This is best-effort — a failure must never block the channel reconnect.
      void supabase.auth.refreshSession().catch((refreshError) => {
        console.warn('queueStore: background session refresh failed (non-blocking)', refreshError)
      })

      activeChannelReconnectHandler?.()

      const currentEventId = activeEventIdRef.current
      if (currentEventId) {
        void fetchQueueSnapshotRef.current(currentEventId)
      }
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        // Audience mobile: disconnect to save battery.
        // Host session: keep the channel alive — the host must not lose
        // connection just because they briefly switched apps.
        if (!isHostSession) {
          setAudienceConnectionStatus('offline')
          clearChannelReconnectTimer()
          disconnectActiveChannel()
        }
        return
      }

      resumeRealtimeSync()
    }

    const onOffline = () => {
      setAudienceConnectionStatus('offline')
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', resumeRealtimeSync)
    window.addEventListener('online', resumeRealtimeSync)
    window.addEventListener('offline', onOffline)
    window.addEventListener('pageshow', resumeRealtimeSync)

    return () => {
      isCurrent = false
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', resumeRealtimeSync)
      window.removeEventListener('online', resumeRealtimeSync)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('pageshow', resumeRealtimeSync)
      clearChannelReconnectTimer()
      activeChannelReconnectHandler = null
      disconnectActiveChannel()
      if (audiencePollTimerId !== null) {
        window.clearInterval(audiencePollTimerId)
      }
      clearChannelWatchdog()
    }
  }, [user, eventId, isHostSession, routePathname, audienceRefreshTick, refreshProfile, fetchQueueSnapshot, queueOperatingMode])

  useEffect(() => {
    const refreshOnForeground = () => {
      if (document.hidden) {
        return
      }

      const currentEventId = activeEventIdRef.current

      if (!currentEventId) {
        return
      }

      void fetchQueueSnapshotRef.current(currentEventId)
    }

    const onVisibilityChange = () => {
      if (!document.hidden) {
        refreshOnForeground()
      }
    }

    window.addEventListener('focus', refreshOnForeground)
    window.addEventListener('online', refreshOnForeground)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('focus', refreshOnForeground)
      window.removeEventListener('online', refreshOnForeground)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fetchQueueSnapshot])

  useEffect(() => {
    if (!event?.id) {
      return
    }

    const onStorage = (storageEvent: StorageEvent) => {
      if (storageEvent.key !== ROOM_OPEN_SYNC_KEY || !storageEvent.newValue) {
        return
      }

      try {
        const payload = JSON.parse(storageEvent.newValue) as { eventId?: string }

        if (payload.eventId === event.id) {
          void fetchQueueSnapshot(event.id)
        }
      } catch (error) {
        console.warn('queueStore: failed to parse room sync payload', error)
        // Ignore malformed payloads.
      }
    }

    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener('storage', onStorage)
    }
  }, [event?.id, fetchQueueSnapshot])

  const value = useMemo(
    () => ({
      event,
      hostEvents,
      songs,
      performedSongs,
      loading,
      audienceConnectionStatus,
      queueOperatingMode,
      queueHealthMessage,
      addSong: async (title: string, artist: string, isExplicit: boolean, options?: AddSongOptions) => {
        const targetEventId = eventId ?? event?.id ?? null

        if (!user) {
          throw new Error('Please sign in before requesting a song.')
        }

        if (!targetEventId) {
          throw new Error('No active gig found right now. Please try again in a moment.')
        }

        const normalizedTitle = title.trim()
        const normalizedArtist = artist.trim()

        if (!normalizedTitle || !normalizedArtist) {
          throw new Error('Song title and artist are required.')
        }

        const shouldBypassRules = options?.bypassEventRules || isHostSession

        if (!shouldBypassRules) {
          // Rate limiting: per-session cooldown to prevent rapid-fire requests.
          const RATE_LIMIT_WINDOW_MS = 2 * 60 * 1000 // 2 minutes
          const rateLimitKey = `human-jukebox-request-cooldown-${user.id}-${targetEventId}`
          const lastRequestRaw = typeof window !== 'undefined' ? window.sessionStorage.getItem(rateLimitKey) : null
          if (lastRequestRaw) {
            const lastRequestTime = parseInt(lastRequestRaw, 10)
            const elapsed = Date.now() - lastRequestTime
            if (Number.isFinite(lastRequestTime) && elapsed >= 0 && elapsed < RATE_LIMIT_WINDOW_MS) {
              const remaining = Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000)
              throw new Error(`Please wait ${remaining}s before making another request.`)
            }
          }
        }

        if (!shouldBypassRules && event) {
          // Client-side pre-check for duplicates — saves a DB round-trip.
          if (!event.allowDuplicateRequests) {
            const isDuplicate = songs.some(
              (s) =>
                s.title.trim().toLowerCase() === normalizedTitle.toLowerCase() &&
                s.artist.trim().toLowerCase() === normalizedArtist.toLowerCase(),
            )
            if (isDuplicate) {
              throw new Error('That song is already in the live queue for this gig.')
            }
          }

          if (event.maxActiveRequestsPerUser && event.maxActiveRequestsPerUser > 0) {
            const { count, error: countError } = await supabase
              .from('queue_songs')
              .select('id', { count: 'exact', head: true })
              .eq('event_id', targetEventId)
              .eq('created_by', user.id)
              .eq('is_removed', false)

            if (countError) {
              throw countError
            }

            if ((count ?? 0) >= event.maxActiveRequestsPerUser) {
              throw new Error(`You already have ${event.maxActiveRequestsPerUser} active request${event.maxActiveRequestsPerUser === 1 ? '' : 's'} in the queue.`)
            }
          }

          if (!event.allowDuplicateRequests) {
            const { data: existingSong, error: duplicateError } = await supabase
              .from('queue_songs')
              .select('id')
              .eq('event_id', targetEventId)
              .eq('title', normalizedTitle)
              .eq('artist', normalizedArtist)
              .eq('is_removed', false)
              .limit(1)
              .maybeSingle()

            if (duplicateError) {
              throw duplicateError
            }

            if (existingSong) {
              throw new Error('That song is already in the live queue for this gig.')
            }
          }
        }

        let coverUrl = options?.coverUrl ?? null

        if (!coverUrl) {
          try {
            coverUrl = await fetchSongArtwork(normalizedTitle, normalizedArtist)
          } catch (error) {
            console.warn('queueStore: artwork lookup failed, continuing without cover', error)
            coverUrl = null
          }
        }

        // Get the max position to calculate the next position for this song
        const { data: maxPositionData, error: maxPositionError } = await supabase
          .from('queue_songs')
          .select('position')
          .eq('event_id', targetEventId)
          .eq('is_removed', false)
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (maxPositionError) {
          throw maxPositionError
        }

        const nextPosition = ((maxPositionData?.position as number | null) ?? -1) + 1
        const requesterName = readCommittedAudienceName().trim()

        // Keep audience profile display_name in sync with the chosen audience identity
        // so picker names can be resolved in queue/mirror views.
        if (!isHostSession) {
          const committedAudienceName = readCommittedAudienceName().trim()

          if (committedAudienceName) {
            try {
              const { error: updateAudienceNameError } = await supabase
                .from('profiles')
                .update({ display_name: committedAudienceName })
                .eq('user_id', user.id)

              if (updateAudienceNameError) {
                console.warn('queueStore: failed to sync audience display name before queue insert', updateAudienceNameError)
              }
            } catch (error) {
              console.warn('queueStore: unexpected audience display name sync error', error)
            }
          }
        }

        const { error } = await supabase.from('queue_songs').insert({
          event_id: targetEventId,
          title: normalizedTitle,
          artist: normalizedArtist,
          is_explicit: isExplicit,
          cover_url: coverUrl,
          library_song_id: options?.librarySongId ?? null,
          audience_sings: options?.performerMode === 'audience',
          created_by: user.id,
          requester_name: requesterName || null,
          position: nextPosition,
        })

        if (error) {
          throw error
        }

        // Record the timestamp so the rate limiter can enforce the cooldown.
        if (!options?.bypassEventRules && !isHostSession) {
          const rateLimitKey = `human-jukebox-request-cooldown-${user.id}-${targetEventId}`
          try {
            window.sessionStorage.setItem(rateLimitKey, String(Date.now()))
          } catch {
            // sessionStorage may be unavailable in private mode — not a blocker.
          }
        }

        await fetchQueueSnapshot(targetEventId)
      },
      setActiveEvent: async (nextEventId: string) => {
        if (!user || !isHostSession) {
          throw new Error('Host account required to set the active gig.')
        }

        try {
          const { error: deactivateError } = await withTimeout(
            withAuthLockRetry(() =>
              supabase
                .from('events')
                .update({ is_active: false })
                .eq('host_id', user.id)
                .neq('id', nextEventId)
                .eq('is_active', true),
            ),
            DEFAULT_DB_TIMEOUT_MS,
            'Timed out while updating active gig. Please try again.',
          )

          if (deactivateError) {
            throw new Error(`Failed to deactivate other gigs: ${deactivateError.message}`)
          }
        } catch (error) {
          console.error('queueStore: setActiveEvent deactivate step failed', error)
          throw error
        }

        try {
          const { error: activateError } = await withTimeout(
            withAuthLockRetry(() =>
              supabase
                .from('events')
                .update({ is_active: true })
                .eq('id', nextEventId)
                .eq('host_id', user.id),
            ),
            DEFAULT_DB_TIMEOUT_MS,
            'Timed out while updating active gig. Please try again.',
          )

          if (activateError) {
            throw new Error(`Failed to activate gig: ${activateError.message}`)
          }
        } catch (error) {
          console.error('queueStore: setActiveEvent activate step failed', error)
          throw error
        }

        try {
          const { error: profileError } = await withTimeout(
            withAuthLockRetry(() =>
              supabase
                .from('profiles')
                .update({ active_event_id: nextEventId })
                .eq('user_id', user.id),
            ),
            DEFAULT_DB_TIMEOUT_MS,
            'Timed out while switching control to this gig. Please try again.',
          )

          if (profileError) {
            throw new Error(`Failed to update profile: ${profileError.message}`)
          }
        } catch (error) {
          console.error('queueStore: setActiveEvent profile update step failed', error)
          throw error
        }

        try {
          await withAuthLockRetry(() => refreshProfile(), 2)
        } catch (error) {
          console.warn('queueStore: profile refresh failed after setActiveEvent', error)
          // The active gig change succeeded; profile refresh can recover on next load.
        }

        try {
          const [nextHostEvents] = await Promise.all([
            fetchHostEvents(user.id),
            fetchQueueSnapshot(nextEventId),
          ])

          setHostEvents(nextHostEvents)
          setPerformedSongs([])
        } catch (error) {
          console.error('queueStore: setActiveEvent fetch step failed', error)
          throw new Error(`Failed to refresh gig data: ${getReadableErrorMessage(error)}`, { cause: error })
        }
      },
      endGig: async (targetEventId: string) => {
        if (!user || !isHostSession) {
          throw new Error('Host account required to end a gig.')
        }

        const { error: endGigError } = await withTimeout(
          withAuthLockRetry(() =>
            supabase
              .from('events')
              .update({
                is_active: false,
                room_open: false,
              })
              .eq('id', targetEventId)
              .eq('host_id', user.id),
          ),
          DEFAULT_DB_TIMEOUT_MS,
          'Timed out while ending gig. Please try again.',
        )

        if (endGigError) {
          throw new Error(endGigError.message)
        }

        const nextHostEvents = await fetchHostEvents(user.id)
        setHostEvents(nextHostEvents)

        if (event?.id === targetEventId) {
          setEvent((currentEvent) => {
            if (!currentEvent || currentEvent.id !== targetEventId) {
              return currentEvent
            }

            return {
              ...currentEvent,
              roomOpen: false,
            }
          })
        }
      },
      setEventAudienceNoGigVisibility: async (targetEventId: string, visible: boolean) => {
        if (!user || !isHostSession) {
          throw new Error('Host account required to update audience fallback visibility.')
        }

        const normalizedEventId = targetEventId.trim()

        if (!normalizedEventId) {
          throw new Error('Missing event id for audience fallback visibility update.')
        }

        const { error } = await withTimeout(
          withAuthLockRetry(() =>
            supabase
              .from('events')
              .update({
                show_in_audience_no_gig: visible,
              })
              .eq('id', normalizedEventId)
              .eq('host_id', user.id),
          ),
          DEFAULT_DB_TIMEOUT_MS,
          'Timed out while saving no-live audience visibility. Please try again.',
        )

        if (error) {
          throw new Error(error.message)
        }

        setHostEvents((currentHostEvents) => currentHostEvents.map((hostEvent) => {
          if (hostEvent.id !== normalizedEventId) {
            return hostEvent
          }

          return {
            ...hostEvent,
            showInAudienceNoGig: visible,
          }
        }))

        setEvent((currentEvent) => {
          if (!currentEvent || currentEvent.id !== normalizedEventId) {
            return currentEvent
          }

          return {
            ...currentEvent,
            showInAudienceNoGig: visible,
          }
        })
      },
      deleteEvent: async (targetEventId: string) => {
        if (!user || !isHostSession) {
          throw new Error('Host account required to delete a gig.')
        }

        const targetEvent = hostEvents.find((hostEvent) => hostEvent.id === targetEventId)

        if (!targetEvent) {
          return
        }

        const remainingHostEvents = hostEvents.filter((hostEvent) => hostEvent.id !== targetEventId)
        const isCurrentGig = event?.id === targetEventId
        const isAudienceActiveGig = targetEvent.isActive
        const needsFallbackGig = isCurrentGig || isAudienceActiveGig
        const fallbackGigId = remainingHostEvents.find((hostEvent) => hostEvent.isActive)?.id ?? remainingHostEvents[0]?.id ?? null

        if (needsFallbackGig && fallbackGigId) {
          await withTimeout(
            withAuthLockRetry(() =>
              supabase
                .from('events')
                .update({ is_active: false })
                .eq('host_id', user.id)
                .neq('id', fallbackGigId)
                .eq('is_active', true),
            ),
            DEFAULT_DB_TIMEOUT_MS,
            'Timed out while updating active gig. Please try again.',
          )

          const { error: activateFallbackError } = await withTimeout(
            withAuthLockRetry(() =>
              supabase
                .from('events')
                .update({ is_active: true })
                .eq('id', fallbackGigId)
                .eq('host_id', user.id),
            ),
            DEFAULT_DB_TIMEOUT_MS,
            'Timed out while updating active gig. Please try again.',
          )

          if (activateFallbackError) {
            throw new Error(activateFallbackError.message)
          }

          const { error: fallbackProfileError } = await withTimeout(
            withAuthLockRetry(() =>
              supabase
                .from('profiles')
                .update({ active_event_id: fallbackGigId })
                .eq('user_id', user.id),
            ),
            DEFAULT_DB_TIMEOUT_MS,
            'Timed out while switching control to this gig. Please try again.',
          )

          if (fallbackProfileError) {
            throw new Error(fallbackProfileError.message)
          }

          try {
            await withAuthLockRetry(() => refreshProfile(), 2)
          } catch (error) {
            console.warn('queueStore: profile refresh failed after fallback activation', error)
            // The profile can recover on the next load if refresh contention occurs.
          }
        } else if (needsFallbackGig) {
          const { error: clearProfileError } = await withTimeout(
            withAuthLockRetry(() =>
              supabase
                .from('profiles')
                .update({ active_event_id: null })
                .eq('user_id', user.id),
            ),
            DEFAULT_DB_TIMEOUT_MS,
            'Timed out while clearing your active gig. Please try again.',
          )

          if (clearProfileError) {
            throw new Error(clearProfileError.message)
          }

          try {
            await withAuthLockRetry(() => refreshProfile(), 2)
          } catch (error) {
            console.warn('queueStore: profile refresh failed after clearing fallback gig', error)
            // The profile can recover on the next load if refresh contention occurs.
          }
        }

        const { error: deleteError } = await withTimeout(
          withAuthLockRetry(() =>
            supabase
              .from('events')
              .delete()
              .eq('id', targetEventId)
              .eq('host_id', user.id),
          ),
          DEFAULT_DB_TIMEOUT_MS,
          'Timed out while deleting gig. Please try again.',
        )

        if (deleteError) {
          throw new Error(deleteError.message)
        }

        const nextHostEvents = await fetchHostEvents(user.id)
        setHostEvents(nextHostEvents)

        const resolvedActiveGigId = nextHostEvents.find((hostEvent) => hostEvent.isActive)?.id ?? fallbackGigId

        if (resolvedActiveGigId) {
          await fetchQueueSnapshot(resolvedActiveGigId)
          setPerformedSongs([])
          return
        }

        setEvent(null)
        setSongs([])
        setPerformedSongs([])
      },
      updateEventSettings: async (updates: EventSettingsUpdates) => {
        if (!event) {
          return
        }

        const eventUpdatePayload: Record<string, unknown> = {
          name: updates.name,
          venue: updates.venue || null,
          gig_date: updates.gigDate || null,
          gig_start_time: updates.gigStartTime || null,
          gig_end_time: updates.gigEndTime || null,
          subtitle: updates.subtitle || null,
          request_instructions: updates.requestInstructions || null,
          instagram_url: updates.instagramUrl || null,
          tiktok_url: updates.tiktokUrl || null,
          youtube_url: updates.youtubeUrl || null,
          facebook_url: updates.facebookUrl || null,
          paypal_url: updates.paypalUrl || null,
          mobilpay_url: updates.mobilpayUrl || null,
          contact_email: updates.contactEmail || null,
          playlist_only_requests: updates.playlistOnlyRequests,
          mirror_photo_spotlight_enabled: updates.mirrorPhotoSpotlightEnabled,
          mirror_countdown_enabled: updates.mirrorCountdownEnabled,
          allow_duplicate_requests: updates.allowDuplicateRequests,
          max_active_requests_per_user: updates.maxActiveRequestsPerUser,
          room_open: updates.roomOpen,
          explicit_filter_enabled: updates.explicitFilterEnabled,
          show_in_audience_no_gig: updates.showInAudienceNoGig,
          cover_image_url: updates.coverImageUrl,
          venue_logo_url: updates.venueLogoUrl,
          show_custom_button: updates.showCustomButton,
          custom_button_label: updates.customButtonLabel || null,
          custom_button_link: updates.customButtonLink || null,
          tip_thank_you_message_da: updates.tipThankYouMessageDA || null,
          tip_thank_you_message_en: updates.tipThankYouMessageEN || null,
          event_type: updates.eventType ?? 'halli-live',
          karafun_url: updates.karafunUrl ?? null,
          event_artist_name: updates.artistName ?? null,
          auto_live_enabled: updates.autoLiveEnabled ?? false,
          intro_audio_url: updates.introAudioUrl ?? null,
        }

        const { error } = await withTimeout(
          withAuthLockRetry(() =>
            supabase
              .from('events')
              .update(eventUpdatePayload)
              .eq('id', event.id),
          ),
          DEFAULT_DB_TIMEOUT_MS,
          'Timed out while saving event settings. Please try again.',
        )

        if (error && (isMissingCoverImageColumnError(error) || isMissingTipThankYouMessageColumnError(error))) {
          const fallbackPayload = { ...eventUpdatePayload }

          if (isMissingCoverImageColumnError(error)) {
            delete fallbackPayload.cover_image_url
          }

          if (isMissingTipThankYouMessageColumnError(error)) {
            delete fallbackPayload.tip_thank_you_message_da
            delete fallbackPayload.tip_thank_you_message_en
          }

          const { error: fallbackError } = await withTimeout(
            withAuthLockRetry(() =>
              supabase
                .from('events')
                .update(fallbackPayload)
                .eq('id', event.id),
            ),
            DEFAULT_DB_TIMEOUT_MS,
            'Timed out while saving event settings. Please try again.',
          )

          if (fallbackError) {
            throw fallbackError
          }
        } else if (error) {
          throw error
        }

        const normalizedPlaylistIds = [...new Set(
          updates.selectedPlaylistIds
            .map((playlistId) => (typeof playlistId === 'string' ? playlistId.trim() : ''))
            .filter((playlistId) => playlistId.length > 0),
        )]

        const { error: clearPlaylistsError } = await withTimeout(
          withAuthLockRetry(() =>
            supabase
              .from('event_playlists')
              .delete()
              .eq('event_id', event.id),
          ),
          DEFAULT_DB_TIMEOUT_MS,
          'Timed out while updating gig playlists. Please try again.',
        )

        if (clearPlaylistsError) {
          throw clearPlaylistsError
        }

        if (normalizedPlaylistIds.length > 0) {
          const { error: addPlaylistsError } = await withTimeout(
            withAuthLockRetry(() =>
              supabase
                .from('event_playlists')
                .insert(
                  normalizedPlaylistIds.map((playlistId) => ({
                    event_id: event.id,
                    playlist_id: playlistId,
                  })),
                ),
            ),
            DEFAULT_DB_TIMEOUT_MS,
            'Timed out while saving selected playlists. Please try again.',
          )

          if (addPlaylistsError) {
            throw addPlaylistsError
          }
        }

        setHostEvents((currentHostEvents) => currentHostEvents.map((hostEvent) => {
          if (hostEvent.id !== event.id) {
            return hostEvent
          }

          return {
            ...hostEvent,
            name: updates.name,
            venue: updates.venue || null,
            showInAudienceNoGig: updates.showInAudienceNoGig,
            eventType: updates.eventType,
          }
        }))

        await fetchQueueSnapshot(event.id)
      },
      upvoteSong: async (songId: string) => {
        if (!songId) {
          throw new Error('Invalid song selection. Please try again.')
        }

        const selectedSong = songs.find((song) => song.id === songId)

        if (selectedSong?.voting_locked) {
          throw new Error('Voting is currently locked for this song.')
        }

        let voterId = user?.id ?? null

        if (!voterId) {
          const { data: authUserData, error: authUserError } = await withTimeout(
            withAuthLockRetry(() => supabase.auth.getUser(), 2),
            DEFAULT_DB_TIMEOUT_MS,
            'Timed out while reconnecting your audience session. Please try again.',
          )

          if (authUserError || !authUserData.user?.id) {
            throw new Error('Your audience session is reconnecting. Please try voting again in a moment.')
          }

          voterId = authUserData.user.id
        }

        const { error } = await withTimeout(
          withAuthLockRetry(() =>
            supabase.from('votes').insert({
              song_id: songId,
              user_id: voterId,
            }),
          ),
          DEFAULT_DB_TIMEOUT_MS,
          'Timed out while submitting your vote. Please try again.',
        )

        if (error?.code === '23505') {
          throw new Error('You have already voted for this song.')
        }

        if (error) {
          throw error
        }

        if (event?.id) {
          await fetchQueueSnapshot(event.id)
        }
      },
      toggleRoomOpen: async () => {
        if (!event) {
          return
        }

        const nextRoomOpen = !event.roomOpen

        setEvent((currentEvent) => {
          if (!currentEvent || currentEvent.id !== event.id) {
            return currentEvent
          }

          return {
            ...currentEvent,
            roomOpen: nextRoomOpen,
          }
        })

        const { error } = await supabase
          .from('events')
          .update({ room_open: nextRoomOpen })
          .eq('id', event.id)

        if (error) {
          setEvent((currentEvent) => {
            if (!currentEvent || currentEvent.id !== event.id) {
              return currentEvent
            }

            return {
              ...currentEvent,
              roomOpen: event.roomOpen,
            }
          })
          throw error
        }

        saveToLocalStorage(ROOM_OPEN_SYNC_KEY, {
          eventId: event.id,
          roomOpen: nextRoomOpen,
          timestamp: Date.now(),
        })

        await fetchQueueSnapshot(event.id)
      },
      toggleExplicitFilter: async () => {
        if (!event) {
          return
        }

        const { error } = await supabase
          .from('events')
          .update({ explicit_filter_enabled: !event.explicitFilterEnabled })
          .eq('id', event.id)

        if (error) {
          throw error
        }

        await fetchQueueSnapshot(event.id)
      },
      setShowInAudienceNoGig: async (visible: boolean) => {
        if (!event) {
          return
        }

        const { error } = await withTimeout(
          withAuthLockRetry(() =>
            supabase
              .from('events')
              .update({ show_in_audience_no_gig: visible })
              .eq('id', event.id),
          ),
          DEFAULT_DB_TIMEOUT_MS,
          'Timed out while updating audience visibility. Please try again.',
        )

        if (error) {
          throw new Error(error.message)
        }

        setHostEvents((currentHostEvents) => currentHostEvents.map((hostEvent) => (
          hostEvent.id === event.id
            ? { ...hostEvent, showInAudienceNoGig: visible }
            : hostEvent
        )))

        await fetchQueueSnapshot(event.id)
      },
      toggleVotingLock: async (songId: string, nextValue: boolean) => {
        const { error } = await supabase
          .from('queue_songs')
          .update({ voting_locked: nextValue })
          .eq('id', songId)

        if (error) {
          throw error
        }

        if (event?.id) {
          await fetchQueueSnapshot(event.id)
        }
      },
      removeSong: async (songId: string) => {
        const { error } = await supabase
          .from('queue_songs')
          .update({ is_removed: true })
          .eq('id', songId)

        if (error) {
          throw error
        }

        if (event?.id) {
          await fetchQueueSnapshot(event.id)
        }
      },
      moveSong: async (songId: string, direction: 'up' | 'down') => {
        if (!event?.id) {
          throw new Error('No active gig to reorder songs.')
        }

        const songIndex = songs.findIndex((song) => song.id === songId)
        if (songIndex === -1) {
          throw new Error('Song not found in queue.')
        }

        // Can't move first song up or last song down
        if ((direction === 'up' && songIndex === 0) || (direction === 'down' && songIndex === songs.length - 1)) {
          return
        }

        const targetIndex = direction === 'up' ? songIndex - 1 : songIndex + 1
        const currentSong = songs[songIndex]
        const targetSong = songs[targetIndex]

        // Swap positions in the database
        const { error: error1 } = await supabase
          .from('queue_songs')
          .update({ position: targetSong.position ?? targetIndex })
          .eq('id', currentSong.id)

        if (error1) {
          throw error1
        }

        const { error: error2 } = await supabase
          .from('queue_songs')
          .update({ position: currentSong.position ?? songIndex })
          .eq('id', targetSong.id)

        if (error2) {
          throw error2
        }

        if (event?.id) {
          await fetchQueueSnapshot(event.id)
        }
      },
      reorderSong: async (songId: string, targetIndex: number) => {
        if (!event?.id) {
          throw new Error('No active gig to reorder songs.')
        }

        const sourceIndex = songs.findIndex((song) => song.id === songId)
        if (sourceIndex === -1) {
          throw new Error('Song not found in queue.')
        }

        const clampedTargetIndex = Math.max(0, Math.min(targetIndex, songs.length - 1))
        if (sourceIndex === clampedTargetIndex) {
          return
        }

        const reorderedSongs = [...songs]
        const [draggedSong] = reorderedSongs.splice(sourceIndex, 1)

        if (!draggedSong) {
          return
        }

        reorderedSongs.splice(clampedTargetIndex, 0, draggedSong)

        await Promise.all(
          reorderedSongs.map(async (song, index) => {
            const currentPosition = song.position ?? index
            if (currentPosition === index) {
              return
            }

            const { error } = await supabase
              .from('queue_songs')
              .update({ position: index })
              .eq('id', song.id)

            if (error) {
              throw error
            }
          }),
        )

        await fetchQueueSnapshot(event.id)
      },
      createEvent: async (name: string, venue: string, options?: CreateEventOptions) => {
        if (!user) {
          throw new Error('Sign in with the host account before creating a gig.')
        }

        if (!isHostSession) {
          throw new Error('Host account required. Sign out and sign back in with the host email to create a gig.')
        }

        const normalizedName = name.trim()

        if (!normalizedName) {
          throw new Error('Gig name is required.')
        }

        const { data: authUserData, error: authUserError } = await withTimeout(
          withAuthLockRetry(() => supabase.auth.getUser()),
          DEFAULT_DB_TIMEOUT_MS,
          'Timed out while validating your host session. Please try again.',
        )

        if (authUserError || !authUserData.user?.id) {
          throw new Error('Your host session is no longer valid. Sign out and sign back in, then try again.')
        }

        const authenticatedUserId = authUserData.user.id

        const createdAtIso = new Date().toISOString()

        const optimisticEventState: EventState = {
          id: '',
          hostId: authenticatedUserId,
          name: normalizedName,
          venue: venue || null,
          gigDate: options?.gigDate ?? null,
          gigStartTime: options?.gigStartTime ?? null,
          gigEndTime: options?.gigEndTime ?? null,
          subtitle: options?.subtitle ?? null,
          requestInstructions: null,
          instagramUrl: null,
          tiktokUrl: null,
          youtubeUrl: null,
          facebookUrl: null,
          paypalUrl: null,
          mobilpayUrl: null,
          contactEmail: null,
          playlistOnlyRequests: true,
          mirrorPhotoSpotlightEnabled: true,
          mirrorCountdownEnabled: true,
          allowDuplicateRequests: true,
          maxActiveRequestsPerUser: null,
          roomOpen: false,
          explicitFilterEnabled: true,
          showInAudienceNoGig: options?.showInAudienceNoGig ?? false,
          coverImageUrl: options?.coverImageUrl ?? null,
          venueLogoUrl: null,
          showCustomButton: false,
          customButtonLabel: null,
          customButtonLink: null,
          tipThankYouMessageDA: null,
          tipThankYouMessageEN: null,
          eventType: options?.eventType ?? 'halli-live',
          karafunUrl: options?.karafunUrl ?? null,
          artistName: options?.artistName ?? null,
          audienceVotingEnabled: options?.audienceVotingEnabled ?? true,
          autoLiveEnabled: options?.autoLiveEnabled ?? false,
          introAudioUrl: options?.introAudioUrl ?? null,
        }

        try {
          const { data: rpcData, error: rpcError } = await withTimeout(
            withAuthLockRetry(() =>
              supabase.rpc('create_host_gig', {
                p_name: normalizedName,
                p_venue: venue || null,
                p_gig_date: options?.gigDate ?? null,
                p_gig_start_time: options?.gigStartTime ?? null,
                p_gig_end_time: options?.gigEndTime ?? null,
                p_show_in_audience_no_gig: options?.showInAudienceNoGig ?? false,
                p_cover_image_url: options?.coverImageUrl ?? null,
              }),
            ),
            DEFAULT_DB_TIMEOUT_MS,
            'Timed out while creating gig. Please try again.',
          )

          if (rpcError && !isMissingCreateGigRpcError(rpcError)) {
            throw new Error(rpcError.message)
          }

          if (rpcError && isMissingCreateGigRpcError(rpcError)) {
            throw rpcError
          }

          const createdGig = Array.isArray(rpcData) ? rpcData[0] : rpcData
          const createdGigId = typeof createdGig?.id === 'string' ? createdGig.id : null
          const activated = Boolean(createdGig?.activated)

          if (!createdGigId) {
            throw new Error('Unable to create gig.')
          }

          const nextEventState = {
            ...optimisticEventState,
            id: createdGigId,
          }

          setEvent(nextEventState)

          // RPC create_host_gig does not support event_type, karafun_url, subtitle, or newer custom fields yet.
          if (
            (options?.eventType && options.eventType !== 'halli-live')
            || options?.karafunUrl
            || options?.subtitle
            || options?.artistName
            || options?.audienceVotingEnabled === false
            || options?.autoLiveEnabled
            || options?.introAudioUrl
          ) {
            void supabase
              .from('events')
              .update({
                event_type: options?.eventType ?? 'halli-live',
                karafun_url: options?.karafunUrl ?? null,
                subtitle: options?.subtitle ?? null,
                event_artist_name: options?.artistName ?? null,
                audience_voting_enabled: options?.audienceVotingEnabled ?? true,
                auto_live_enabled: options?.autoLiveEnabled ?? false,
                intro_audio_url: options?.introAudioUrl ?? null,
              })
              .eq('id', createdGigId)
              .then(({ error }) => {
                if (error) console.warn('queueStore: failed to set event_type/karafun_url/subtitle after rpc create', error)
              })
          }

          setHostEvents((currentHostEvents) => {
            const nextSummary: HostEventSummary = {
              id: createdGigId,
              name: normalizedName,
              venue: venue || null,
              isActive: activated,
              showInAudienceNoGig: options?.showInAudienceNoGig ?? false,
              createdAt: createdAtIso,
              eventType: options?.eventType ?? 'halli-live',
              gigDate: options?.gigDate ?? null,
              gigStartTime: options?.gigStartTime ?? null,
              autoLiveEnabled: options?.autoLiveEnabled ?? false,
              introAudioUrl: options?.introAudioUrl ?? null,
            }

            const withoutCreatedGig = currentHostEvents.filter((currentEvent) => currentEvent.id !== createdGigId)
            const normalizedExistingEvents = activated
              ? withoutCreatedGig.map((currentEvent) => ({
                  ...currentEvent,
                  isActive: false,
                }))
              : withoutCreatedGig

            return [nextSummary, ...normalizedExistingEvents]
          })

          void withAuthLockRetry(() => refreshProfile(), 2).catch((error) => {
            console.warn('queueStore: profile refresh failed after rpc gig creation', error)
          })

          return
        } catch (rpcFallbackError) {
          if (!isMissingCreateGigRpcError(rpcFallbackError)) {
            throw rpcFallbackError
          }
        }

        const newEventPayload = {
          host_id: authenticatedUserId,
          name: normalizedName,
          venue: venue || null,
          subtitle: options?.subtitle ?? null,
          is_active: false,
          playlist_only_requests: true,
          room_open: false,
          explicit_filter_enabled: true,
          gig_date: options?.gigDate ?? null,
          gig_start_time: options?.gigStartTime ?? null,
          gig_end_time: options?.gigEndTime ?? null,
          show_in_audience_no_gig: options?.showInAudienceNoGig ?? false,
          cover_image_url: options?.coverImageUrl ?? null,
          event_type: options?.eventType ?? 'halli-live',
          karafun_url: options?.karafunUrl ?? null,
          event_artist_name: options?.artistName ?? null,
          auto_live_enabled: options?.autoLiveEnabled ?? false,
          intro_audio_url: options?.introAudioUrl ?? null,
        }

        let newEvent: { id: string } | null = null

        const { data: insertedWithCover, error: insertError } = await withTimeout(
          withAuthLockRetry(() =>
            supabase
              .from('events')
              .insert(newEventPayload)
              .select('id')
              .single(),
          ),
          DEFAULT_DB_TIMEOUT_MS,
          'Timed out while creating gig. Please try again.',
        )

        if (insertError && isMissingCoverImageColumnError(insertError)) {
          const fallbackPayload = { ...newEventPayload }
          delete (fallbackPayload as { cover_image_url?: string | null }).cover_image_url
          const { data: insertedWithoutCover, error: fallbackInsertError } = await withTimeout(
            withAuthLockRetry(() =>
              supabase
                .from('events')
                .insert(fallbackPayload)
                .select('id')
                .single(),
            ),
            DEFAULT_DB_TIMEOUT_MS,
            'Timed out while creating gig. Please try again.',
          )

          if (fallbackInsertError) {
            throw new Error(fallbackInsertError.message)
          }

          newEvent = insertedWithoutCover as { id: string }
        } else if (insertError) {
          throw new Error(insertError.message)
        } else {
          newEvent = insertedWithCover as { id: string }
        }

        if (!newEvent?.id) {
          throw new Error('Unable to create gig.')
        }

        const { defaultPlaylistId, karaokePlaylistId } = await ensureDefaultHostPlaylists(authenticatedUserId, normalizedName)

        const playlistIdsForGig = [...new Set([defaultPlaylistId, karaokePlaylistId].filter((playlistId): playlistId is string => Boolean(playlistId)))]

        if (playlistIdsForGig.length > 0) {
          const { error: linkPlaylistError } = await withTimeout(
            withAuthLockRetry(() =>
              supabase
                .from('event_playlists')
                .insert(
                  playlistIdsForGig.map((playlistId) => ({
                    event_id: newEvent.id,
                    playlist_id: playlistId,
                  })),
                ),
            ),
            DEFAULT_DB_TIMEOUT_MS,
            'Timed out while linking playlists to the new gig. Please try again.',
          )

          if (linkPlaylistError) {
            throw new Error(linkPlaylistError.message)
          }
        }

        const { error: profileError } = await withTimeout(
          withAuthLockRetry(() =>
            supabase
              .from('profiles')
              .update({ active_event_id: newEvent.id })
              .eq('user_id', authenticatedUserId),
          ),
          DEFAULT_DB_TIMEOUT_MS,
          'Timed out while updating profile. Please try again.',
        )

        if (profileError) {
          throw new Error(profileError.message)
        }

        try {
          await withAuthLockRetry(() => refreshProfile(), 2)
        } catch (error) {
          console.warn('queueStore: profile refresh failed after event creation', error)
          // Profile refresh can fail under auth lock contention; event creation already succeeded.
        }

        const nextHostEvents = await fetchHostEvents(authenticatedUserId)
        setHostEvents(nextHostEvents)

        if (!nextHostEvents.some((nextEvent) => nextEvent.isActive)) {
          await withTimeout(
            withAuthLockRetry(() =>
              supabase
                .from('events')
                .update({ is_active: true })
                .eq('id', newEvent.id)
                .eq('host_id', authenticatedUserId),
            ),
            DEFAULT_DB_TIMEOUT_MS,
            'Timed out while setting your first active gig. Please try again.',
          )

          setHostEvents((currentHostEvents) =>
            currentHostEvents.map((currentEvent) => ({
              ...currentEvent,
              isActive: currentEvent.id === newEvent.id,
            })),
          )
        }
      },
      markPlayed: async () => {
        if (!songs[0]) {
          return
        }

        const currentSong = songs[0]
        const remainingSongs = songs.slice(1)
        const performedAt = new Date().toISOString()

        setSongs(remainingSongs)
        setPerformedSongs((currentPerformedSongs) => [
          {
            ...currentSong,
            performedAt,
          },
          ...currentPerformedSongs.filter((song) => song.id !== currentSong.id),
        ])

        const { error } = await supabase
          .from('queue_songs')
          .update({ is_removed: true })
          .eq('id', currentSong.id)

        if (error) {
          setSongs(songs)
          setPerformedSongs((currentPerformedSongs) =>
            currentPerformedSongs.filter(
              (song) => !(song.id === currentSong.id && song.performedAt === performedAt),
            ),
          )
          throw error
        }

        if (event?.id) {
          await fetchQueueSnapshot(event.id)
        }
      },
      unmarkPlayed: async (songId: string) => {
        if (!user || !isHostSession) {
          throw new Error('Host account required.')
        }

        const targetSong = performedSongs.find((song) => song.id === songId)
        if (!targetSong) {
          return
        }

        // Optimistically remove from performed list.
        setPerformedSongs((current) => current.filter((song) => song.id !== songId))

        const { error } = await supabase
          .from('queue_songs')
          .update({ is_removed: false })
          .eq('id', songId)

        if (error) {
          // Roll back on failure.
          setPerformedSongs((current) => [targetSong, ...current])
          throw error
        }

        if (event?.id) {
          await fetchQueueSnapshot(event.id)
        }
      },
    }),
    [
      event,
      hostEvents,
      songs,
      performedSongs,
      loading,
      audienceConnectionStatus,
      queueOperatingMode,
      queueHealthMessage,
      user,
      eventId,
      isHostSession,
      refreshProfile,
      fetchQueueSnapshot,
    ],
  )

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>
}

function useQueueStore() {
  const contextValue = useContext(QueueContext)

  if (!contextValue) {
    throw new Error('useQueueStore must be used within a QueueProvider')
  }

  return contextValue
}

export { QueueProvider, useQueueStore }
