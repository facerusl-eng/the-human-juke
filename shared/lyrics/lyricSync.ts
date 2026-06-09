import type { LyricLine } from './types'

export type LyricSyncPayload = {
  songId: string
  jamzoneTimeSeconds: number
  current: LyricLine | null
  next?: LyricLine
  next2?: LyricLine
  updatedAtMs: number
}

export type LyricSyncTransport = {
  publish: (payload: LyricSyncPayload) => void
  subscribe: (listener: (payload: LyricSyncPayload) => void) => () => void
}

const STORAGE_KEY_PREFIX = 'human-jukebox:lyric-sync:'

export function createLocalLyricSyncTransport(channelName: string): LyricSyncTransport {
  const storageKey = `${STORAGE_KEY_PREFIX}${channelName}`
  const hasBroadcastChannel = typeof window !== 'undefined' && typeof window.BroadcastChannel !== 'undefined'
  const broadcast = hasBroadcastChannel ? new BroadcastChannel(channelName) : null

  return {
    publish(payload) {
      const serialized = JSON.stringify(payload)

      if (broadcast) {
        broadcast.postMessage(payload)
      }

      try {
        window.localStorage.setItem(storageKey, serialized)
      } catch {
        // Ignore storage failures in private mode.
      }
    },
    subscribe(listener) {
      const onMessage = (event: MessageEvent<LyricSyncPayload>) => {
        listener(event.data)
      }

      const onStorage = (event: StorageEvent) => {
        if (event.key !== storageKey || !event.newValue) {
          return
        }

        try {
          listener(JSON.parse(event.newValue) as LyricSyncPayload)
        } catch {
          // Ignore malformed payloads.
        }
      }

      if (broadcast) {
        broadcast.addEventListener('message', onMessage as EventListener)
      }
      window.addEventListener('storage', onStorage)

      return () => {
        if (broadcast) {
          broadcast.removeEventListener('message', onMessage as EventListener)
        }
        window.removeEventListener('storage', onStorage)
      }
    },
  }
}
