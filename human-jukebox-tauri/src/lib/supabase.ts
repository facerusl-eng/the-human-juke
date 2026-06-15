import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const supabaseKey = supabaseAnonKey ?? supabasePublishableKey
export const SUPABASE_AUTH_STORAGE_KEY = 'human-jukebox-org-auth-token'
const SUPABASE_AUTH_REMEMBER_KEY = 'human-jukebox-auth-remember-me'

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing Supabase environment variables. Set VITE_SUPABASE_URL and either VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY.',
  )
}

const memoryStorage = new Map<string, string>()

function shouldPersistSupabaseAuthToken() {
  if (typeof window === 'undefined') {
    return true
  }

  try {
    const storedPreference = window.localStorage.getItem(SUPABASE_AUTH_REMEMBER_KEY)
    return storedPreference !== '0'
  } catch {
    return true
  }
}

function readSessionStorageItem(key: string) {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeSessionStorageItem(key: string, value: string) {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    window.sessionStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function removeSessionStorageItem(key: string) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage.removeItem(key)
  } catch {
    // Ignore sessionStorage cleanup failures.
  }
}

const safeStorage = {
  getItem(key: string) {
    if (typeof window === 'undefined') {
      return memoryStorage.get(key) ?? null
    }

    if (key === SUPABASE_AUTH_STORAGE_KEY || key === `${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`) {
      if (shouldPersistSupabaseAuthToken()) {
        try {
          return window.localStorage.getItem(key)
        } catch {
          return memoryStorage.get(key) ?? null
        }
      }

      const sessionValue = readSessionStorageItem(key)
      return sessionValue ?? null
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

    if (key === SUPABASE_AUTH_STORAGE_KEY || key === `${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`) {
      if (shouldPersistSupabaseAuthToken()) {
        try {
          window.localStorage.setItem(key, value)
        } catch {
          memoryStorage.set(key, value)
        }
        removeSessionStorageItem(key)
        return
      }

      if (!writeSessionStorageItem(key, value)) {
        memoryStorage.set(key, value)
      }

      try {
        window.localStorage.removeItem(key)
      } catch {
        // Ignore localStorage cleanup failures.
      }
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

    removeSessionStorageItem(key)

    try {
      window.localStorage.removeItem(key)
    } catch {
      memoryStorage.delete(key)
    }
  },
}

export function setSupabaseAuthPersistence(rememberMe: boolean) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(SUPABASE_AUTH_REMEMBER_KEY, rememberMe ? '1' : '0')
  } catch {
    // Ignore remember-me preference write failures.
  }
}

export function getSupabaseAuthPersistence() {
  return shouldPersistSupabaseAuthToken()
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storageKey: SUPABASE_AUTH_STORAGE_KEY,
    storage: safeStorage,
    // In this desktop/webview environment, browser LockManager can deadlock or steal locks.
    lock: async (_name, _timeout, acquire) => await acquire(),
  },
})

export function clearSupabaseAuthStorage() {
  safeStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY)
  safeStorage.removeItem(`${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`)
}
