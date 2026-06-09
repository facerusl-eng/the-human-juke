import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

const AUDIENCE_SESSION_CACHE_MS = 10_000

let ensureAudienceSessionInFlight: Promise<Session | null> | null = null
let lastAudienceSessionAt = 0

async function readCurrentSession() {
  const { data, error } = await supabase.auth.getSession()

  if (error) {
    throw error
  }

  return data.session ?? null
}

export async function ensureAnonymousAudienceSession(): Promise<Session | null> {
  const now = Date.now()

  // Avoid repeated auth API calls when several components verify auth on mount.
  if (now - lastAudienceSessionAt <= AUDIENCE_SESSION_CACHE_MS) {
    const cachedSession = await readCurrentSession()

    if (cachedSession) {
      return cachedSession
    }
  }

  const existingSession = await readCurrentSession()

  if (existingSession) {
    lastAudienceSessionAt = Date.now()
    return existingSession
  }

  if (ensureAudienceSessionInFlight) {
    return ensureAudienceSessionInFlight
  }

  ensureAudienceSessionInFlight = (async () => {
    const { data, error } = await supabase.auth.signInAnonymously()

    if (error) {
      throw error
    }

    const signedInSession = data.session ?? null

    if (signedInSession) {
      lastAudienceSessionAt = Date.now()
      return signedInSession
    }

    const refreshedSession = await readCurrentSession()

    if (refreshedSession) {
      lastAudienceSessionAt = Date.now()
    }

    return refreshedSession
  })()

  try {
    return await ensureAudienceSessionInFlight
  } finally {
    ensureAudienceSessionInFlight = null
  }
}