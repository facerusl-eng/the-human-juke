import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { PropsWithChildren } from 'react'
import { supabase } from '../lib/supabase'
import { fetchSongArtwork } from '../lib/songArtwork'
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
  subtitle: string
  requestInstructions: string
  playlistOnlyRequests: boolean
  selectedPlaylistIds: string[]
  mirrorPhotoSpotlightEnabled: boolean
  allowDuplicateRequests: boolean
  maxActiveRequestsPerUser: number | null
  roomOpen: boolean
  explicitFilterEnabled: boolean
}

type EventState = {
  id: string
  hostId: string | null
  name: string
  venue: string | null
  subtitle: string | null
  requestInstructions: string | null
  playlistOnlyRequests: boolean
  mirrorPhotoSpotlightEnabled: boolean
  allowDuplicateRequests: boolean
  maxActiveRequestsPerUser: number | null
  roomOpen: boolean
  explicitFilterEnabled: boolean
}

export type HostEventSummary = {
  id: string
  name: string
  venue: string | null
  isActive: boolean
  createdAt: string
}

type QueueContextValue = {
  event: EventState | null
  hostEvents: HostEventSummary[]
  songs: QueueSong[]
  performedSongs: PerformedSong[]
  loading: boolean
  addSong: (title: string, artist: string, isExplicit: boolean, options?: AddSongOptions) => Promise<void>
  setActiveEvent: (nextEventId: string) => Promise<void>
  deleteEvent: (targetEventId: string) => Promise<void>
  updateEventSettings: (updates: EventSettingsUpdates) => Promise<void>
  upvoteSong: (songId: string) => Promise<void>
  toggleRoomOpen: () => Promise<void>
  toggleExplicitFilter: () => Promise<void>
  toggleVotingLock: (songId: string, nextValue: boolean) => Promise<void>
  removeSong: (songId: string) => Promise<void>
  createEvent: (name: string, venue: string) => Promise<void>
  markPlayed: () => Promise<void>
}

const QueueContext = createContext<QueueContextValue | null>(null)
const DEFAULT_DB_TIMEOUT_MS = 25_000
const ROOM_OPEN_SYNC_KEY = 'human-jukebox-room-open-sync'

function isAuthLockContentionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /lock broken|steal option|navigatorlockacquiretimeouterror|auth-token/i.test(message)
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

function sortByVotesDesc(songs: QueueSong[]) {
  return [...songs].sort((songA, songB) => songB.votes_count - songA.votes_count)
}

function readRequestedEventIdFromUrl() {
  if (typeof window === 'undefined') {
    return null
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
      .select('id, name, venue, is_active, created_at')
      .eq('host_id', hostId)
      .order('created_at', { ascending: false }),
    DEFAULT_DB_TIMEOUT_MS,
    'Loading gigs timed out. Please try again.',
  )

  if (error) {
    throw error
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((eventData) => ({
    id: String(eventData.id ?? ''),
    name: (eventData.name as string | null) ?? 'Untitled Gig',
    venue: (eventData.venue as string | null) ?? null,
    isActive: ((eventData.is_active as boolean | null) ?? false),
    createdAt: (eventData.created_at as string | null) ?? '',
  }))
}

async function ensureDefaultHostPlaylists(hostId: string, eventName: string) {
  const { data: hostPlaylists, error: hostPlaylistsError } = await withTimeout(
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

  if (hostPlaylistsError) {
    throw new Error(hostPlaylistsError.message)
  }

  const allPlaylists = (hostPlaylists ?? []) as Array<{ id: string; name: string; created_at: string }>
  let defaultPlaylistId = allPlaylists[0]?.id ?? null
  let karaokePlaylistId = allPlaylists.find((playlist) => /karaoke/i.test(playlist.name))?.id ?? null

  if (!defaultPlaylistId) {
    const { data: createdDefaultPlaylist, error: createdDefaultPlaylistError } = await withTimeout(
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

    if (createdDefaultPlaylistError || !createdDefaultPlaylist?.id) {
      throw new Error(createdDefaultPlaylistError?.message ?? 'Unable to create your default playlist.')
    }

    defaultPlaylistId = createdDefaultPlaylist.id
  }

  if (!karaokePlaylistId) {
    const { data: createdKaraokePlaylist, error: createdKaraokePlaylistError } = await withTimeout(
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

    if (createdKaraokePlaylistError || !createdKaraokePlaylist?.id) {
      throw new Error(createdKaraokePlaylistError?.message ?? 'Unable to create the karaoke playlist.')
    }

    karaokePlaylistId = createdKaraokePlaylist.id
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

  const eventId = profile?.active_event_id ?? null
  const isHostSession = isHost

  const fetchQueueSnapshot = async (activeEventId: string) => {
    const [{ data: eventData, error: eventError }, { data: songsData, error: songsError }] =
      await withTimeout(
        Promise.all([
          supabase
            .from('events')
            .select('id, host_id, name, venue, subtitle, request_instructions, playlist_only_requests, mirror_photo_spotlight_enabled, allow_duplicate_requests, max_active_requests_per_user, room_open, explicit_filter_enabled')
            .eq('id', activeEventId)
            .single(),
          supabase
            .from('queue_songs')
            .select('id, event_id, title, artist, votes_count, is_explicit, voting_locked, is_removed, cover_url, library_song_id, audience_sings')
            .eq('event_id', activeEventId)
            .eq('is_removed', false)
            .order('votes_count', { ascending: false })
            .order('created_at', { ascending: true }),
        ]),
        DEFAULT_DB_TIMEOUT_MS,
        'Loading the queue timed out. Please refresh and try again.',
      )

    if (eventError) {
      throw eventError
    }

    if (songsError) {
      throw songsError
    }

    setEvent({
      id: eventData.id,
      hostId: (eventData as Record<string, unknown>).host_id as string | null ?? null,
      name: (eventData as Record<string, unknown>).name as string ?? 'Untitled Gig',
      venue: (eventData as Record<string, unknown>).venue as string | null ?? null,
      subtitle: (eventData as Record<string, unknown>).subtitle as string | null ?? null,
      requestInstructions: (eventData as Record<string, unknown>).request_instructions as string | null ?? null,
      playlistOnlyRequests: ((eventData as Record<string, unknown>).playlist_only_requests as boolean | null) ?? false,
      mirrorPhotoSpotlightEnabled: ((eventData as Record<string, unknown>).mirror_photo_spotlight_enabled as boolean | null) ?? true,
      allowDuplicateRequests: ((eventData as Record<string, unknown>).allow_duplicate_requests as boolean | null) ?? true,
      maxActiveRequestsPerUser: (eventData as Record<string, unknown>).max_active_requests_per_user as number | null ?? null,
      roomOpen: eventData.room_open,
      explicitFilterEnabled: eventData.explicit_filter_enabled,
    })
    setSongs(sortByVotesDesc((songsData ?? []) as QueueSong[]))
  }

  useEffect(() => {
    let isCurrent = true
    let activeChannel: ReturnType<typeof supabase.channel> | null = null
    let audiencePollTimerId: number | null = null

    const load = async () => {
      if (!user) {
        if (isCurrent) {
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

        if (isHostSession) {
          const nextHostEvents = await fetchHostEvents(user.id)

          if (isCurrent) {
            setHostEvents(nextHostEvents)
          }

          targetEventId = eventId
            ?? nextHostEvents.find((nextEvent) => nextEvent.isActive)?.id
            ?? nextHostEvents[0]?.id
            ?? null
        } else {
          targetEventId = requestedEventId ?? await fetchLatestActiveEventId()
        }

        if (!targetEventId) {
          if (isCurrent) {
            setEvent(null)
            setSongs([])
            setPerformedSongs([])
          }
          return
        }

        let resolvedEventId = targetEventId

        if (isCurrent) {
          setPerformedSongs([])
        }

        try {
          await fetchQueueSnapshot(resolvedEventId)
        } catch {
          const canFallbackToLatestActive = !isHostSession && Boolean(requestedEventId) && requestedEventId === resolvedEventId

          if (!canFallbackToLatestActive) {
            throw new Error('Unable to load requested event.')
          }

          const latestActiveEventId = await fetchLatestActiveEventId()

          if (!latestActiveEventId) {
            throw new Error('No active gig found.')
          }

          resolvedEventId = latestActiveEventId
          await fetchQueueSnapshot(resolvedEventId)
        }

        if (!isCurrent) {
          return
        }

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
          if (isCurrent) {
            void fetchQueueSnapshot(resolvedEventId)
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
          if (isCurrent) {
            void fetchQueueSnapshot(resolvedEventId)
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Force a fresh fetch once subscribed to catch any missed changes
          if (isCurrent) {
            void fetchQueueSnapshot(resolvedEventId)
          }
        }
      })

        // Use aggressive polling for all users to ensure queue syncs reliably
        // Realtime is helpful but not guaranteed, so polling is the fallback
        audiencePollTimerId = window.setInterval(() => {
          if (isCurrent) {
            void fetchQueueSnapshot(resolvedEventId)
          }
        }, 1500)
      } catch {
        if (isCurrent) {
          setEvent(null)
          setSongs([])
        }
      } finally {
        if (isCurrent) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      isCurrent = false
      if (activeChannel) {
        void supabase.removeChannel(activeChannel)
      }
      if (audiencePollTimerId !== null) {
        window.clearInterval(audiencePollTimerId)
      }
    }
  }, [user, eventId, isHostSession])

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
      } catch {
        // Ignore malformed payloads.
      }
    }

    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener('storage', onStorage)
    }
  }, [event?.id])

  const value = useMemo(
    () => ({
      event,
      hostEvents,
      songs,
      performedSongs,
      loading,
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
          return
        }

        const shouldBypassRules = options?.bypassEventRules || isHostSession

        if (!shouldBypassRules && event) {
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

        const coverUrl = options?.coverUrl ?? await fetchSongArtwork(normalizedTitle, normalizedArtist)

        const { error } = await supabase.from('queue_songs').insert({
          event_id: targetEventId,
          title: normalizedTitle,
          artist: normalizedArtist,
          is_explicit: isExplicit,
          cover_url: coverUrl,
          library_song_id: options?.librarySongId ?? null,
          audience_sings: options?.performerMode === 'audience',
          created_by: user.id,
        })

        if (error) {
          throw error
        }

        await fetchQueueSnapshot(targetEventId)
      },
      setActiveEvent: async (nextEventId: string) => {
        if (!user || !isHostSession) {
          throw new Error('Host account required to set the active gig.')
        }

        await withTimeout(
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
          throw new Error(activateError.message)
        }

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
          throw new Error(profileError.message)
        }

        try {
          await withAuthLockRetry(() => refreshProfile(), 2)
        } catch {
          // The active gig change succeeded; profile refresh can recover on next load.
        }

        const [nextHostEvents] = await Promise.all([
          fetchHostEvents(user.id),
          fetchQueueSnapshot(nextEventId),
        ])

        setHostEvents(nextHostEvents)
        setPerformedSongs([])
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
          } catch {
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
          } catch {
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

        const { error } = await withTimeout(
          withAuthLockRetry(() =>
            supabase
              .from('events')
              .update({
                name: updates.name,
                venue: updates.venue || null,
                subtitle: updates.subtitle || null,
                request_instructions: updates.requestInstructions || null,
                playlist_only_requests: updates.playlistOnlyRequests,
                mirror_photo_spotlight_enabled: updates.mirrorPhotoSpotlightEnabled,
                allow_duplicate_requests: updates.allowDuplicateRequests,
                max_active_requests_per_user: updates.maxActiveRequestsPerUser,
                room_open: updates.roomOpen,
                explicit_filter_enabled: updates.explicitFilterEnabled,
              })
              .eq('id', event.id),
          ),
          DEFAULT_DB_TIMEOUT_MS,
          'Timed out while saving event settings. Please try again.',
        )

        if (error) {
          throw error
        }

        const normalizedPlaylistIds = [...new Set(updates.selectedPlaylistIds)]

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

        await fetchQueueSnapshot(event.id)
      },
      upvoteSong: async (songId: string) => {
        if (!user) {
          return
        }

        const { error } = await supabase.from('votes').insert({
          song_id: songId,
          user_id: user.id,
        })

        if (error && error.code !== '23505') {
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

        try {
          window.localStorage.setItem(
            ROOM_OPEN_SYNC_KEY,
            JSON.stringify({
              eventId: event.id,
              roomOpen: nextRoomOpen,
              timestamp: Date.now(),
            }),
          )
        } catch {
          // Ignore storage sync failures.
        }

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
      createEvent: async (name: string, venue: string) => {
        if (!user) {
          throw new Error('Sign in with the host account before creating a gig.')
        }

        if (!isHostSession) {
          throw new Error('Host account required. Sign out and sign back in with the host email to create a gig.')
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

        const { data: newEvent, error: insertError } = await withTimeout(
          withAuthLockRetry(() =>
            supabase
              .from('events')
              .insert({
                host_id: authenticatedUserId,
                name,
                venue: venue || null,
                is_active: false,
                playlist_only_requests: true,
                room_open: false,
                explicit_filter_enabled: true,
              })
              .select('id')
              .single(),
          ),
          DEFAULT_DB_TIMEOUT_MS,
          'Timed out while creating gig. Please try again.',
        )

        if (insertError) {
          throw new Error(insertError.message)
        }

        const { defaultPlaylistId, karaokePlaylistId } = await ensureDefaultHostPlaylists(authenticatedUserId, name)

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
        } catch {
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
    }),
    [event, hostEvents, songs, performedSongs, loading, user, eventId, isHostSession, refreshProfile],
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
