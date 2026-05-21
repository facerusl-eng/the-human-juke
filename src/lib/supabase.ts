import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const supabaseKey = supabaseAnonKey ?? supabasePublishableKey

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing Supabase environment variables. Set VITE_SUPABASE_URL and either VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY.',
  )
}

const memoryStorage = new Map<string, string>()

const safeStorage = {
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

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storageKey: 'human-jukebox-org-auth-token',
    storage: safeStorage,
    // In this desktop/webview environment, browser LockManager can deadlock or steal locks.
    lock: async (_name, _timeout, acquire) => await acquire(),
  },
})
