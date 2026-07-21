/**
 * IndexedDB helpers for the offline song request queue.
 *
 * Stores song requests submitted while the device is offline so they can be
 * replayed automatically once connectivity is restored.
 */

export type PendingOfflineSong = {
  id: string
  eventId: string
  title: string
  artist: string
  isExplicit: boolean
  coverUrl: string | null
  librarySongId: string | null
  performerMode: 'performer' | 'audience' | undefined
  requesterName: string
  createdAt: number
}

const DB_NAME = 'human-jukebox-offline-v1'
const DB_VERSION = 2
const STORE_NAME = 'pending-songs'
const VOTES_STORE_NAME = 'pending-votes'

/** Pending entries older than this are considered stale and are pruned on load. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000 // 6 hours

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('eventId', 'eventId', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
      if (!db.objectStoreNames.contains(VOTES_STORE_NAME)) {
        const votesStore = db.createObjectStore(VOTES_STORE_NAME, { keyPath: 'id' })
        votesStore.createIndex('eventId', 'eventId', { unique: false })
        votesStore.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function idbAddPendingSong(song: PendingOfflineSong): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).add(song)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function idbGetPendingSongs(eventId: string): Promise<PendingOfflineSong[]> {
  const db = await openDb()
  const cutoff = Date.now() - MAX_AGE_MS

  // First pass: prune stale entries across all events.
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('createdAt')
    const range = IDBKeyRange.upperBound(cutoff)
    const req = index.openCursor(range)
    req.onsuccess = () => {
      const cursor = req.result as IDBCursorWithValue | null
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve() // non-fatal
  })

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const index = tx.objectStore(STORE_NAME).index('eventId')
    const request = index.getAll(IDBKeyRange.only(eventId))
    request.onsuccess = () => { db.close(); resolve(request.result as PendingOfflineSong[]) }
    request.onerror = () => { db.close(); reject(request.error) }
  })
}

export async function idbRemovePendingSong(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

/**
 * A vote submitted while offline. The id is deterministic
 * (`${eventId}:${songId}:${userId}`) so repeated offline taps for the same song
 * by the same user collapse into a single pending entry.
 */
export type PendingOfflineVote = {
  id: string
  eventId: string
  songId: string
  userId: string
  createdAt: number
}

export async function idbAddPendingVote(vote: PendingOfflineVote): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VOTES_STORE_NAME, 'readwrite')
    // put() is idempotent: a repeated offline vote (same id) overwrites rather
    // than duplicating, so a user can only queue one offline vote per song.
    tx.objectStore(VOTES_STORE_NAME).put(vote)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function idbGetPendingVotes(eventId: string): Promise<PendingOfflineVote[]> {
  const db = await openDb()
  const cutoff = Date.now() - MAX_AGE_MS

  // First pass: prune stale entries across all events.
  await new Promise<void>((resolve) => {
    const tx = db.transaction(VOTES_STORE_NAME, 'readwrite')
    const store = tx.objectStore(VOTES_STORE_NAME)
    const index = store.index('createdAt')
    const range = IDBKeyRange.upperBound(cutoff)
    const req = index.openCursor(range)
    req.onsuccess = () => {
      const cursor = req.result as IDBCursorWithValue | null
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve() // non-fatal
  })

  return new Promise((resolve, reject) => {
    const tx = db.transaction(VOTES_STORE_NAME, 'readonly')
    const index = tx.objectStore(VOTES_STORE_NAME).index('eventId')
    const request = index.getAll(IDBKeyRange.only(eventId))
    request.onsuccess = () => { db.close(); resolve(request.result as PendingOfflineVote[]) }
    request.onerror = () => { db.close(); reject(request.error) }
  })
}

export async function idbRemovePendingVote(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VOTES_STORE_NAME, 'readwrite')
    tx.objectStore(VOTES_STORE_NAME).delete(id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}
