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
const DB_VERSION = 1
const STORE_NAME = 'pending-songs'

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
