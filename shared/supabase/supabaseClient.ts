import { createClient } from '@supabase/supabase-js'

export type SupabaseEnv = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
}

type SupabaseClientFactoryOptions = {
  env: SupabaseEnv
  authStorageKey: string
}

export type SafeStorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export function resolveSupabaseRuntimeConfig(env: SupabaseEnv) {
  const supabaseUrl = env.VITE_SUPABASE_URL ?? env.SUPABASE_URL
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY
  const supabasePublishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY
  const supabaseKey = supabaseAnonKey ?? supabasePublishableKey

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Missing Supabase environment variables. Set VITE_SUPABASE_URL/SUPABASE_URL and VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY/SUPABASE_ANON_KEY.',
    )
  }

  return {
    supabaseUrl,
    supabaseKey,
  }
}

export function createSafeStorage(): SafeStorageLike {
  const memoryStorage = new Map<string, string>()

  return {
    getItem(key: string) {
      if (typeof window === 'undefined') {
        return memoryStorage.get(key) ?? null
      }

      try {
        return window.localStorage.getItem(key)
      } catch {
        return memoryStorage.get(key) ?? null
      }
    },
    setItem(key: string, value: string) {
      if (typeof window === 'undefined') {
        memoryStorage.set(key, value)
        return
      }

      try {
        window.localStorage.setItem(key, value)
      } catch {
        memoryStorage.set(key, value)
      }
    },
    removeItem(key: string) {
      if (typeof window === 'undefined') {
        memoryStorage.delete(key)
        return
      }

      try {
        window.localStorage.removeItem(key)
      } catch {
        memoryStorage.delete(key)
      }
    },
  }
}

export function createSharedSupabaseClient(options: SupabaseClientFactoryOptions) {
  const { supabaseUrl, supabaseKey } = resolveSupabaseRuntimeConfig(options.env)
  const storage = createSafeStorage()

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      storageKey: options.authStorageKey,
      storage,
      lock: async (_name, _timeout, acquire) => await acquire(),
    },
  })

  return {
    supabase,
    storage,
  }
}
