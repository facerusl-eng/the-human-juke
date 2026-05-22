/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_DATA_PROVIDER?: 'mock' | 'supabase'
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_SUPABASE_SONGS_TABLE?: string
  readonly VITE_SUPABASE_SET_BLOCKS_TABLE?: string
  readonly VITE_SUPABASE_LIVE_CONSOLE_TABLE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
