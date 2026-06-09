import type { PerformedSong, QueueSong } from '../state/queueStore'
import { supabase } from './supabase'

const SNAPSHOT_STORAGE_KEY = 'human-jukebox-queue-snapshots'
const MAX_SNAPSHOTS_PER_EVENT = 20

export type QueueSnapshot = {
  id: string
  createdAt: string
  eventId: string
  eventName: string
  reason: string
  roomOpen: boolean
  explicitFilterEnabled: boolean
  queue: QueueSong[]
  performed: PerformedSong[]
}

type SnapshotMap = Record<string, QueueSnapshot[]>

type DbQueueSnapshotRow = {
  id: string
  created_at: string
  reason: string | null
  snapshot: {
    queue?: QueueSong[]
    performed?: PerformedSong[]
    roomOpen?: boolean
    explicitFilterEnabled?: boolean
    eventName?: string
  } | null
}

function readSnapshotMap(): SnapshotMap {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const stored = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY)

    if (!stored) {
      return {}
    }

    const parsed = JSON.parse(stored) as SnapshotMap
    return parsed ?? {}
  } catch (error) {
    console.warn('queueSnapshots: failed to read snapshots', error)
    return {}
  }
}

function writeSnapshotMap(snapshotMap: SnapshotMap) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshotMap))
  } catch (error) {
    console.warn('queueSnapshots: failed to write snapshots', error)
  }
}

export function captureQueueSnapshot(snapshot: Omit<QueueSnapshot, 'id' | 'createdAt' | 'reason'> & { reason?: string }): QueueSnapshot {
  const nextSnapshot: QueueSnapshot = {
    ...snapshot,
    id: `${snapshot.eventId}-${Date.now()}`,
    createdAt: new Date().toISOString(),
    reason: snapshot.reason?.trim() || 'manual',
    queue: snapshot.queue.map((song) => ({ ...song })),
    performed: snapshot.performed.map((song) => ({ ...song })),
  }

  const snapshotMap = readSnapshotMap()
  const current = snapshotMap[snapshot.eventId] ?? []

  snapshotMap[snapshot.eventId] = [nextSnapshot, ...current].slice(0, MAX_SNAPSHOTS_PER_EVENT)
  writeSnapshotMap(snapshotMap)

  return nextSnapshot
}

export function getLatestQueueSnapshot(eventId: string): QueueSnapshot | null {
  const snapshotMap = readSnapshotMap()
  const current = snapshotMap[eventId] ?? []
  return current[0] ?? null
}

export function getQueueSnapshots(eventId: string): QueueSnapshot[] {
  const snapshotMap = readSnapshotMap()
  return snapshotMap[eventId] ?? []
}

export async function saveQueueSnapshotToDatabase(snapshot: Omit<QueueSnapshot, 'id' | 'createdAt'>): Promise<void> {
  const { error } = await supabase
    .from('queue_snapshots')
    .insert({
      event_id: snapshot.eventId,
      reason: snapshot.reason,
      snapshot: {
        version: 1,
        eventName: snapshot.eventName,
        roomOpen: snapshot.roomOpen,
        explicitFilterEnabled: snapshot.explicitFilterEnabled,
        queue: snapshot.queue,
        performed: snapshot.performed,
      },
    })

  if (error) {
    throw error
  }
}

export async function getQueueSnapshotsFromDatabase(eventId: string, limit = 20): Promise<QueueSnapshot[]> {
  const { data, error } = await supabase
    .from('queue_snapshots')
    .select('id, created_at, reason, snapshot')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw error
  }

  const rows = (data ?? []) as DbQueueSnapshotRow[]

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    eventId,
    eventName: row.snapshot?.eventName ?? 'Untitled Gig',
    reason: row.reason ?? 'manual',
    roomOpen: Boolean(row.snapshot?.roomOpen),
    explicitFilterEnabled: Boolean(row.snapshot?.explicitFilterEnabled),
    queue: Array.isArray(row.snapshot?.queue) ? row.snapshot?.queue ?? [] : [],
    performed: Array.isArray(row.snapshot?.performed) ? row.snapshot?.performed ?? [] : [],
  }))
}

export async function restoreQueueSnapshotInDatabase(snapshotId: string): Promise<{ restoredCount: number }> {
  const { data, error } = await supabase.rpc('restore_queue_snapshot', {
    p_snapshot_id: snapshotId,
  })

  if (error) {
    throw error
  }

  const restoredCount = typeof (data as { restored_count?: unknown } | null)?.restored_count === 'number'
    ? (data as { restored_count: number }).restored_count
    : 0

  return { restoredCount }
}
