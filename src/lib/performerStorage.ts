import { DEFAULT_PERFORMER_SETTINGS, type PerformerSettings, type SetlistSong } from './performerTypes'

const SETTINGS_STORAGE_KEY = 'human-jukebox-performer-settings-v1'
const SETLIST_STORAGE_KEY = 'human-jukebox-performer-setlist-v1'
const OBFUSCATION_PREFIX = 'obf:v1:'
const FNV1A_OFFSET_BASIS = 2166136261
const FNV1A_PRIME = 16777619

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

function createStableSongId(title: string, artist: string, jamzoneSongId: string) {
  const normalized = `${title.toLowerCase()}::${artist.toLowerCase()}::${jamzoneSongId.toLowerCase()}`
  let hash = FNV1A_OFFSET_BASIS

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, FNV1A_PRIME)
  }

  return `setlist-${(hash >>> 0).toString(16)}-${normalized.length.toString(36)}`
}

function obfuscateSensitiveValue(value: string, userId: string | null | undefined) {
  if (!value) {
    return ''
  }

  const secretSeed = `${userId?.trim() || 'anonymous'}::${window.location.host}::performer`
  const transformed = Array.from(value)
    .map((character, index) => String.fromCharCode(character.charCodeAt(0) ^ secretSeed.charCodeAt(index % secretSeed.length)))
    .join('')

  return `${OBFUSCATION_PREFIX}${window.btoa(transformed)}`
}

function deobfuscateSensitiveValue(value: string, userId: string | null | undefined) {
  if (!value) {
    return ''
  }

  if (!value.startsWith(OBFUSCATION_PREFIX)) {
    return value
  }

  try {
    const encodedPayload = value.slice(OBFUSCATION_PREFIX.length)
    const decodedPayload = window.atob(encodedPayload)
    const secretSeed = `${userId?.trim() || 'anonymous'}::${window.location.host}::performer`

    return Array.from(decodedPayload)
      .map((character, index) => String.fromCharCode(character.charCodeAt(0) ^ secretSeed.charCodeAt(index % secretSeed.length)))
      .join('')
  } catch {
    return ''
  }
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
    human_jukebox_api_key: deobfuscateSensitiveValue(String(stored.human_jukebox_api_key ?? ''), userId),
    human_jukebox_gig_id: String(stored.human_jukebox_gig_id ?? ''),
    jamzone_api_key: deobfuscateSensitiveValue(String(stored.jamzone_api_key ?? ''), userId),
    jamzone_playlist_id: String(stored.jamzone_playlist_id ?? ''),
    auto_refresh_interval: clampAutoRefreshInterval(Number(stored.auto_refresh_interval ?? DEFAULT_PERFORMER_SETTINGS.auto_refresh_interval)),
  }
}

export function savePerformerSettings(userId: string | null | undefined, settings: PerformerSettings) {
  if (typeof window === 'undefined') {
    return
  }

  const safeSettings: PerformerSettings = {
    human_jukebox_api_key: obfuscateSensitiveValue(settings.human_jukebox_api_key.trim(), userId),
    human_jukebox_gig_id: settings.human_jukebox_gig_id.trim(),
    jamzone_api_key: obfuscateSensitiveValue(settings.jamzone_api_key.trim(), userId),
    jamzone_playlist_id: settings.jamzone_playlist_id.trim(),
    auto_refresh_interval: clampAutoRefreshInterval(settings.auto_refresh_interval),
  }

  window.localStorage.setItem(scopedStorageKey(SETTINGS_STORAGE_KEY, userId), JSON.stringify(safeSettings))
}

function sanitizeSetlistSong(song: Partial<SetlistSong>): SetlistSong | null {
  const title = String(song.title ?? '').trim()
  const artist = String(song.artist ?? '').trim()
  const jamzoneSongId = String(song.jamzone_song_id ?? '').trim()

  if (!title || !artist) {
    return null
  }

  return {
    id: String(song.id ?? '').trim() || createStableSongId(title, artist, jamzoneSongId),
    title,
    artist,
    jamzone_song_id: jamzoneSongId,
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
