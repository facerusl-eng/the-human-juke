import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'

const JAMZONE_CLOCK_TABLE = 'jamzone_clock'
const JAMZONE_CLOCK_CHANNEL_PREFIX = 'jamzone-clock'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type JamzoneClockSourceType = 'bridge' | 'manual' | 'companion'

export type JamzoneClockSong = {
  id: string
  title: string
  artist: string
}

export type JamzoneClockSnapshot = {
  eventId: string
  sourceId: string
  sourceType: JamzoneClockSourceType
  currentSongId: string | null
  currentSongTitle: string | null
  currentSongArtist: string | null
  currentTimeSeconds: number
  isPlaying: boolean
  sequenceNumber: number
  updatedAtMs: number
}

type JamzoneClockRow = {
  event_id?: string | null
  source_id?: string | null
  source_type?: string | null
  current_song_id?: string | null
  current_song_title?: string | null
  current_song_artist?: string | null
  current_time_seconds?: number | string | null
  is_playing?: boolean | null
  sequence_number?: number | string | null
  updated_at?: string | null
}

export type JamzoneClockSubscriptionStatus = 'idle' | 'loading' | 'connected' | 'disconnected' | 'error'

function isUuidLikeEventId(eventId: string) {
  return UUID_PATTERN.test(eventId.trim())
}

function normalizeClockRow(eventId: string, row: JamzoneClockRow | null | undefined): JamzoneClockSnapshot | null {
  if (!row) {
    return null
  }

  const normalizedEventId = (row.event_id ?? eventId).trim()
  if (!normalizedEventId) {
    return null
  }

  const sourceId = (row.source_id ?? '').trim()
  const sourceType = row.source_type === 'bridge' || row.source_type === 'manual' || row.source_type === 'companion'
    ? row.source_type
    : 'companion'
  const currentSongId = typeof row.current_song_id === 'string' && row.current_song_id.trim().length > 0
    ? row.current_song_id.trim()
    : null
  const currentSongTitle = typeof row.current_song_title === 'string' && row.current_song_title.trim().length > 0
    ? row.current_song_title.trim()
    : null
  const currentSongArtist = typeof row.current_song_artist === 'string' && row.current_song_artist.trim().length > 0
    ? row.current_song_artist.trim()
    : null
  const currentTimeSeconds = typeof row.current_time_seconds === 'number'
    ? row.current_time_seconds
    : Number(row.current_time_seconds ?? 0)
  const sequenceNumber = typeof row.sequence_number === 'number'
    ? row.sequence_number
    : Number(row.sequence_number ?? 0)
  const updatedAtMs = row.updated_at ? Date.parse(row.updated_at) : Date.now()

  return {
    eventId: normalizedEventId,
    sourceId: sourceId || 'unknown-source',
    sourceType,
    currentSongId,
    currentSongTitle,
    currentSongArtist,
    currentTimeSeconds: Number.isFinite(currentTimeSeconds) && currentTimeSeconds >= 0 ? currentTimeSeconds : 0,
    isPlaying: row.is_playing ?? false,
    sequenceNumber: Number.isFinite(sequenceNumber) ? sequenceNumber : 0,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now(),
  }
}

export function jamzoneClockToSongRef(snapshot: JamzoneClockSnapshot | null) {
  if (!snapshot?.currentSongId || !snapshot.currentSongTitle || !snapshot.currentSongArtist) {
    return null
  }

  return {
    songId: snapshot.currentSongId,
    title: snapshot.currentSongTitle,
    artist: snapshot.currentSongArtist,
  }
}

export function getJamzoneClockDisplayTimeSeconds(snapshot: JamzoneClockSnapshot | null, nowMs = Date.now()) {
  if (!snapshot) {
    return 0
  }

  if (!snapshot.isPlaying) {
    return Math.max(0, snapshot.currentTimeSeconds)
  }

  const elapsedSeconds = Math.max(0, (nowMs - snapshot.updatedAtMs) / 1000)
  return Math.max(0, snapshot.currentTimeSeconds + elapsedSeconds)
}

export async function readJamzoneClockState(eventId: string): Promise<JamzoneClockSnapshot | null> {
  if (!isUuidLikeEventId(eventId)) {
    return null
  }

  const { data, error } = await supabase
    .from(JAMZONE_CLOCK_TABLE)
    .select('event_id, source_id, source_type, current_song_id, current_song_title, current_song_artist, current_time_seconds, is_playing, sequence_number, updated_at')
    .eq('event_id', eventId)
    .single()

  if (error || !data) {
    return null
  }

  return normalizeClockRow(eventId, data as JamzoneClockRow)
}

export async function writeJamzoneClockState(eventId: string, snapshot: Omit<JamzoneClockSnapshot, 'eventId' | 'updatedAtMs' | 'sequenceNumber'> & Partial<Pick<JamzoneClockSnapshot, 'sequenceNumber'>>) {
  if (!isUuidLikeEventId(eventId)) {
    return false
  }

  const payload = {
    event_id: eventId,
    source_id: snapshot.sourceId,
    source_type: snapshot.sourceType,
    current_song_id: snapshot.currentSongId,
    current_song_title: snapshot.currentSongTitle,
    current_song_artist: snapshot.currentSongArtist,
    current_time_seconds: Number.isFinite(snapshot.currentTimeSeconds) ? Math.max(0, snapshot.currentTimeSeconds) : 0,
    is_playing: Boolean(snapshot.isPlaying),
    sequence_number: Number.isFinite(snapshot.sequenceNumber ?? NaN) ? Number(snapshot.sequenceNumber) : Date.now(),
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from(JAMZONE_CLOCK_TABLE)
    .upsert(payload, { onConflict: 'event_id' })

  return !error
}

export function useJamzoneClockState(eventId: string | null) {
  const [snapshot, setSnapshot] = useState<JamzoneClockSnapshot | null>(null)
  const [status, setStatus] = useState<JamzoneClockSubscriptionStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const lastSequenceRef = useRef(0)

  const channelName = useMemo(() => {
    if (!eventId || !isUuidLikeEventId(eventId)) {
      return null
    }

    return `${JAMZONE_CLOCK_CHANNEL_PREFIX}:${eventId}`
  }, [eventId])

  useEffect(() => {
    if (!eventId || !channelName) {
      setSnapshot(null)
      setStatus('idle')
      setError(null)
      lastSequenceRef.current = 0
      return
    }

    let cancelled = false
    setStatus('loading')
    setError(null)

    void (async () => {
      const initialSnapshot = await readJamzoneClockState(eventId)
      if (!cancelled && initialSnapshot) {
        lastSequenceRef.current = initialSnapshot.sequenceNumber
        setSnapshot(initialSnapshot)
      }
    })()

    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: JAMZONE_CLOCK_TABLE,
        filter: `event_id=eq.${eventId}`,
      }, (payload) => {
        const nextSnapshot = normalizeClockRow(eventId, (payload.new ?? payload.old) as JamzoneClockRow)
        if (!nextSnapshot) {
          return
        }

        if (nextSnapshot.sequenceNumber < lastSequenceRef.current) {
          return
        }

        lastSequenceRef.current = nextSnapshot.sequenceNumber
        setSnapshot(nextSnapshot)
      })

    channel.subscribe((channelStatus) => {
      if (channelStatus === 'SUBSCRIBED') {
        setStatus('connected')
        return
      }

      if (channelStatus === 'CHANNEL_ERROR') {
        setStatus('error')
        setError('Jamzone clock channel error')
        return
      }

      if (channelStatus === 'TIMED_OUT' || channelStatus === 'CLOSED') {
        setStatus('disconnected')
      }
    })

    return () => {
      cancelled = true
      setStatus('disconnected')
      void supabase.removeChannel(channel)
    }
  }, [channelName, eventId])

  return {
    snapshot,
    status,
    error,
    isConnected: status === 'connected',
  }
}