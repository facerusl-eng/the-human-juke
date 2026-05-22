/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_DATA_PROVIDER?: 'mock' | 'supabase'
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_SUPABASE_LIBRARY_SONGS_TABLE?: string
  readonly VITE_SUPABASE_PLAYLISTS_TABLE?: string
  readonly VITE_SUPABASE_PLAYLIST_SONGS_TABLE?: string
  readonly VITE_SUPABASE_EVENTS_TABLE?: string
  readonly VITE_SUPABASE_PLAYBACK_STATE_TABLE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
