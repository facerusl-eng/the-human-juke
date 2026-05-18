export type PerformerSettings = {
  human_jukebox_api_key: string
  human_jukebox_gig_id: string
  jamzone_api_key: string
  jamzone_playlist_id: string
  auto_refresh_interval: number
}

export type SetlistSong = {
  id: string
  title: string
  artist: string
  jamzone_song_id: string
  key: string
  bpm: string
  notes: string
}

export type PerformerQueueSong = {
  id: string
  title: string
  artist: string
  requested_by: string
  votes: number
  status: 'queued' | 'playing' | 'played' | 'skipped'
  jamzone_song_id: string
  position: number
}

export type SetlistMatch = {
  song: SetlistSong
  confidence: number
}

export type QueueFetchResult = {
  songs: PerformerQueueSong[]
  source: string
  fetchedAt: string
}

export const DEFAULT_PERFORMER_SETTINGS: PerformerSettings = {
  human_jukebox_api_key: '',
  human_jukebox_gig_id: '',
  jamzone_api_key: '',
  jamzone_playlist_id: '',
  auto_refresh_interval: 15,
}
