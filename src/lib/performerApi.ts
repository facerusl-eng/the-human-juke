import type { PerformerQueueSong, QueueFetchResult } from './performerTypes'

type QueueResponseShape = {
  songs?: unknown
  queue?: unknown
  requests?: unknown
  data?: unknown
  items?: unknown
  source?: string
  fetchedAt?: string
}

type JamZoneOverlayDetails = {
  key?: string | null
  bpm?: number | string | null
  notes?: string | null
  title?: string | null
  artist?: string | null
}

export type JamZoneOverlayResult = {
  ok: boolean
  details: JamZoneOverlayDetails
  message?: string
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeStatus(value: unknown): 'queued' | 'playing' | 'played' | 'skipped' {
  const normalized = String(value ?? '').toLowerCase()

  if (normalized === 'playing' || normalized === 'now_playing' || normalized === 'current') {
    return 'playing'
  }

  if (normalized === 'played' || normalized === 'done' || normalized === 'completed') {
    return 'played'
  }

  if (normalized === 'skipped' || normalized === 'removed') {
    return 'skipped'
  }

  return 'queued'
}

function extractSongList(payload: QueueResponseShape | unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload
  }

  if (!payload || typeof payload !== 'object') {
    return []
  }

  const data = payload as QueueResponseShape
  const topLevelCandidates = [data.songs, data.queue, data.requests, data.items]

  for (const candidate of topLevelCandidates) {
    if (Array.isArray(candidate)) {
      return candidate
    }
  }

  if (data.data && typeof data.data === 'object') {
    const nestedData = data.data as QueueResponseShape
    const nestedCandidates = [nestedData.songs, nestedData.queue, nestedData.requests, nestedData.items]

    for (const candidate of nestedCandidates) {
      if (Array.isArray(candidate)) {
        return candidate
      }
    }
  }

  return []
}

function normalizeQueueSong(item: unknown, index: number): PerformerQueueSong | null {
  if (!item || typeof item !== 'object') {
    return null
  }

  const source = item as Record<string, unknown>
  const title = String(source.title ?? source.song_title ?? source.name ?? '').trim()
  const artist = String(source.artist ?? source.song_artist ?? source.performer ?? '').trim()

  if (!title || !artist) {
    return null
  }

  const votesSource = source.votes ?? source.vote_count ?? source.votes_count ?? source.upvotes
  const votes = Array.isArray(votesSource) ? votesSource.length : toNumber(votesSource)
  const status = normalizeStatus(source.status ?? source.state)
  const position = toNumber(source.position ?? source.rank ?? source.index, index + 1)

  return {
    id: String(source.id ?? source.song_id ?? `${title}-${artist}-${position}`),
    title,
    artist,
    requested_by: String(source.requested_by ?? source.requester ?? source.requestedBy ?? 'Audience').trim() || 'Audience',
    votes,
    status,
    jamzone_song_id: String(source.jamzone_song_id ?? source.jamzoneSongId ?? source.song_external_id ?? '').trim(),
    position,
  }
}

function mapQueueResponse(payload: unknown): QueueFetchResult {
  const songs = extractSongList(payload)
    .map((item, index) => normalizeQueueSong(item, index))
    .filter((song): song is PerformerQueueSong => Boolean(song))

  const enriched = songs.sort((left, right) => {
    if (left.status === 'playing' && right.status !== 'playing') {
      return -1
    }

    if (left.status !== 'playing' && right.status === 'playing') {
      return 1
    }

    if (left.status === 'queued' && right.status === 'queued') {
      if (right.votes !== left.votes) {
        return right.votes - left.votes
      }
      return left.position - right.position
    }

    return left.position - right.position
  })

  const source = payload && typeof payload === 'object' && 'source' in payload
    ? String((payload as QueueResponseShape).source ?? 'the-human-jukebox')
    : 'the-human-jukebox'

  const fetchedAt = payload && typeof payload === 'object' && 'fetchedAt' in payload
    ? String((payload as QueueResponseShape).fetchedAt ?? new Date().toISOString())
    : new Date().toISOString()

  return {
    songs: enriched,
    source,
    fetchedAt,
  }
}

export async function fetchPerformerQueue(apiKey: string, gigId: string): Promise<QueueFetchResult> {
  const response = await fetch('/api/fetch-human-jukebox-queue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ apiKey, gigId }),
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error?: unknown }).error ?? 'Could not load queue')
      : 'Could not load queue'
    throw new Error(message)
  }

  return mapQueueResponse(payload)
}

export async function loadSongInJamzone(options: {
  apiKey: string
  playlistId: string
  songId: string
  title: string
  artist: string
}): Promise<JamZoneOverlayResult> {
  const response = await fetch('/api/load-song-in-jamzone', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options),
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    return {
      ok: false,
      message: payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error?: unknown }).error ?? 'JamZone request failed')
        : 'JamZone request failed',
      details: {
        title: options.title,
        artist: options.artist,
      },
    }
  }

  const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}

  return {
    ok: true,
    message: typeof data.message === 'string' ? data.message : 'JamZone data loaded.',
    details: {
      title: typeof data.title === 'string' ? data.title : options.title,
      artist: typeof data.artist === 'string' ? data.artist : options.artist,
      key: typeof data.key === 'string' ? data.key : null,
      bpm: typeof data.bpm === 'number' || typeof data.bpm === 'string' ? data.bpm : null,
      notes: typeof data.notes === 'string' ? data.notes : null,
    },
  }
}
