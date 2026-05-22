import type { AppDataset, SongEnergy } from '../types/domain'
import type { AppDataClient } from './AppDataClient'
import { supabase } from './supabaseClient'

const LIBRARY_SONGS_TABLE = import.meta.env.VITE_SUPABASE_LIBRARY_SONGS_TABLE || 'library_songs'
const PLAYLISTS_TABLE = import.meta.env.VITE_SUPABASE_PLAYLISTS_TABLE || 'playlists'
const PLAYLIST_SONGS_TABLE = import.meta.env.VITE_SUPABASE_PLAYLIST_SONGS_TABLE || 'playlist_songs'
const EVENTS_TABLE = import.meta.env.VITE_SUPABASE_EVENTS_TABLE || 'events'
const PLAYBACK_STATE_TABLE = import.meta.env.VITE_SUPABASE_PLAYBACK_STATE_TABLE || 'playback_state'

type SongRow = {
  id: string
  title: string | null
  artist: string | null
  is_explicit: boolean | null
  created_at: string | null
}

type SetBlockRow = {
  id: string
  name: string | null
  description: string | null
  playlist_type: string | null
}

type PlaylistSongRow = {
  playlist_id: string | null
}

type EventRow = {
  id: string
  room_open: boolean | null
  gig_date: string | null
  gig_start_time: string | null
}

type PlaybackStateRow = {
  brb_active: boolean | null
  countdown_target_ms: number | string | null
}

function toSongEnergy(isExplicit: boolean | null): SongEnergy {
  if (isExplicit) {
    return 'High'
  }

  return 'Medium'
}

function toSongTags(row: SongRow): string[] {
  const tags = ['Trending']

  if (row.is_explicit) {
    tags.push('Peak Hour')
  } else {
    tags.push('Warm-up')
  }

  if (row.created_at) {
    const createdAtMs = Date.parse(row.created_at)

    if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs < 1000 * 60 * 60 * 24 * 30) {
      tags.push('Encore')
    }
  }

  return tags
}

function formatRemainingLabel(targetMs: number): string {
  const remainingMs = Math.max(0, targetMs - Date.now())
  const totalSeconds = Math.floor(remainingMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function parseCountdownTargetMs(rawValue: number | string | null | undefined): number | null {
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return rawValue
  }

  if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
    const parsed = Number(rawValue)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function parseEventStartMs(event: EventRow | null): number | null {
  const gigDate = event?.gig_date?.trim()

  if (!gigDate) {
    return null
  }

  const rawTime = event?.gig_start_time?.trim() || '18:00:00'
  const normalizedTime = rawTime.length > 5 && rawTime[2] === ':' && rawTime[5] === ':'
    ? rawTime
    : `${rawTime}:00`

  const parsedMs = Date.parse(`${gigDate}T${normalizedTime}`)
  return Number.isFinite(parsedMs) ? parsedMs : null
}

function resolveLiveState(event: EventRow | null, playbackState: PlaybackStateRow | null): 'pre_show' | 'live' | 'break' {
  if (playbackState?.brb_active) {
    return 'break'
  }

  if (event?.room_open) {
    return 'live'
  }

  return 'pre_show'
}

function resolveNextTransitionIn(event: EventRow | null, playbackState: PlaybackStateRow | null): string {
  const countdownTargetMs = parseCountdownTargetMs(playbackState?.countdown_target_ms)

  if (countdownTargetMs !== null && countdownTargetMs > Date.now()) {
    return formatRemainingLabel(countdownTargetMs)
  }

  const eventStartMs = parseEventStartMs(event)

  if (eventStartMs !== null && eventStartMs > Date.now()) {
    return formatRemainingLabel(eventStartMs)
  }

  return '00:00'
}

export class SupabaseAppDataClient implements AppDataClient {
  async fetchDataset(): Promise<AppDataset> {
    const [songsResult, playlistsResult, playlistSongsResult, activeEventResult] = await Promise.all([
      supabase
        .from(LIBRARY_SONGS_TABLE)
        .select('id,title,artist,is_explicit,created_at')
        .order('created_at', { ascending: false })
        .limit(400),
      supabase
        .from(PLAYLISTS_TABLE)
        .select('id,name,description,playlist_type')
        .order('created_at', { ascending: false }),
      supabase
        .from(PLAYLIST_SONGS_TABLE)
        .select('playlist_id'),
      supabase
        .from(EVENTS_TABLE)
        .select('id,room_open,gig_date,gig_start_time')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1),
    ])

    if (songsResult.error) {
      throw songsResult.error
    }

    if (playlistsResult.error) {
      throw playlistsResult.error
    }

    if (playlistSongsResult.error) {
      throw playlistSongsResult.error
    }

    if (activeEventResult.error) {
      throw activeEventResult.error
    }

    const activeEvent = ((activeEventResult.data ?? [])[0] ?? null) as EventRow | null

    let playbackState: PlaybackStateRow | null = null

    if (activeEvent?.id) {
      const playbackResult = await supabase
        .from(PLAYBACK_STATE_TABLE)
        .select('brb_active,countdown_target_ms')
        .eq('event_id', activeEvent.id)
        .order('updated_at', { ascending: false })
        .limit(1)

      if (playbackResult.error) {
        throw playbackResult.error
      }

      playbackState = ((playbackResult.data ?? [])[0] ?? null) as PlaybackStateRow | null
    }

    const songsRows = (songsResult.data ?? []) as SongRow[]
    const setBlockRows = (playlistsResult.data ?? []) as SetBlockRow[]
    const playlistSongsRows = (playlistSongsResult.data ?? []) as PlaylistSongRow[]

    const playlistCounts = playlistSongsRows.reduce<Record<string, number>>((counts, row) => {
      const playlistId = row.playlist_id?.trim()

      if (!playlistId) {
        return counts
      }

      counts[playlistId] = (counts[playlistId] ?? 0) + 1
      return counts
    }, {})

    return {
      songs: songsRows.map((row) => ({
        id: row.id,
        title: row.title ?? 'Untitled Song',
        artist: row.artist ?? 'Unknown Artist',
        length: '00:00',
        energy: toSongEnergy(row.is_explicit),
        tags: toSongTags(row),
      })),
      setBlocks: setBlockRows.map((row) => ({
        id: row.id,
        name: row.name ?? 'Untitled Set',
        songs: playlistCounts[row.id] ?? 0,
        vibe: row.playlist_type ?? 'Unspecified vibe',
        duration: row.description?.trim() || '0 min',
      })),
      liveConsole: {
        state: resolveLiveState(activeEvent, playbackState),
        nextTransitionIn: resolveNextTransitionIn(activeEvent, playbackState),
        syncLatencyMs: 220,
      },
    }
  }
}
