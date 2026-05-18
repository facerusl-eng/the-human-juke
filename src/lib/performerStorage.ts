import { DEFAULT_PERFORMER_SETTINGS, type PerformerSettings, type SetlistSong } from './performerTypes'

const SETTINGS_STORAGE_KEY = 'human-jukebox-performer-settings-v1'
const SETLIST_STORAGE_KEY = 'human-jukebox-performer-setlist-v1'

function scopedStorageKey(baseKey: string, userId: string | null | undefined) {
  const scope = userId?.trim() || 'anonymous'
  return `${baseKey}:${scope}`
}

function safeParseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function clampAutoRefreshInterval(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_PERFORMER_SETTINGS.auto_refresh_interval
  }

  return Math.max(5, Math.min(120, Math.round(value)))
}

export function loadPerformerSettings(userId: string | null | undefined): PerformerSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_PERFORMER_SETTINGS
  }

  const stored = safeParseJson<Partial<PerformerSettings>>(
    window.localStorage.getItem(scopedStorageKey(SETTINGS_STORAGE_KEY, userId)),
    {},
  )

  return {
    human_jukebox_api_key: String(stored.human_jukebox_api_key ?? ''),
    human_jukebox_gig_id: String(stored.human_jukebox_gig_id ?? ''),
    jamzone_api_key: String(stored.jamzone_api_key ?? ''),
    jamzone_playlist_id: String(stored.jamzone_playlist_id ?? ''),
    auto_refresh_interval: clampAutoRefreshInterval(Number(stored.auto_refresh_interval ?? DEFAULT_PERFORMER_SETTINGS.auto_refresh_interval)),
  }
}

export function savePerformerSettings(userId: string | null | undefined, settings: PerformerSettings) {
  if (typeof window === 'undefined') {
    return
  }

  const safeSettings: PerformerSettings = {
    human_jukebox_api_key: settings.human_jukebox_api_key.trim(),
    human_jukebox_gig_id: settings.human_jukebox_gig_id.trim(),
    jamzone_api_key: settings.jamzone_api_key.trim(),
    jamzone_playlist_id: settings.jamzone_playlist_id.trim(),
    auto_refresh_interval: clampAutoRefreshInterval(settings.auto_refresh_interval),
  }

  window.localStorage.setItem(scopedStorageKey(SETTINGS_STORAGE_KEY, userId), JSON.stringify(safeSettings))
}

function sanitizeSetlistSong(song: Partial<SetlistSong>): SetlistSong | null {
  const title = String(song.title ?? '').trim()
  const artist = String(song.artist ?? '').trim()

  if (!title || !artist) {
    return null
  }

  return {
    id: String(song.id ?? '').trim() || crypto.randomUUID(),
    title,
    artist,
    jamzone_song_id: String(song.jamzone_song_id ?? '').trim(),
    key: String(song.key ?? '').trim(),
    bpm: String(song.bpm ?? '').trim(),
    notes: String(song.notes ?? '').trim(),
  }
}

export function loadSetlistSongs(userId: string | null | undefined): SetlistSong[] {
  if (typeof window === 'undefined') {
    return []
  }

  const rawSongs = safeParseJson<Array<Partial<SetlistSong>>>(
    window.localStorage.getItem(scopedStorageKey(SETLIST_STORAGE_KEY, userId)),
    [],
  )

  return rawSongs
    .map((song) => sanitizeSetlistSong(song))
    .filter((song): song is SetlistSong => Boolean(song))
}

export function saveSetlistSongs(userId: string | null | undefined, songs: SetlistSong[]) {
  if (typeof window === 'undefined') {
    return
  }

  const normalizedSongs = songs
    .map((song) => sanitizeSetlistSong(song))
    .filter((song): song is SetlistSong => Boolean(song))

  window.localStorage.setItem(scopedStorageKey(SETLIST_STORAGE_KEY, userId), JSON.stringify(normalizedSongs))
}
