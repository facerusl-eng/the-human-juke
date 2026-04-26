import type { PerformedSong, QueueSong } from '../state/queueStore'

const SNAPSHOT_STORAGE_KEY = 'human-jukebox-queue-snapshots'
const MAX_SNAPSHOTS_PER_EVENT = 10

export type QueueSnapshot = {
  id: string
  createdAt: string
  eventId: string
  eventName: string
  roomOpen: boolean
  explicitFilterEnabled: boolean
  queue: QueueSong[]
  performed: PerformedSong[]
}

type SnapshotMap = Record<string, QueueSnapshot[]>

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

export function captureQueueSnapshot(snapshot: Omit<QueueSnapshot, 'id' | 'createdAt'>): QueueSnapshot {
  const nextSnapshot: QueueSnapshot = {
    ...snapshot,
    id: `${snapshot.eventId}-${Date.now()}`,
    createdAt: new Date().toISOString(),
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
