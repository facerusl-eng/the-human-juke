import { createSharedSupabaseClient } from '../../../shared/supabase/supabaseClient'

export const SUPABASE_AUTH_STORAGE_KEY = 'human-jukebox-org-auth-token'

const { supabase, storage } = createSharedSupabaseClient({
  env: import.meta.env,
  authStorageKey: SUPABASE_AUTH_STORAGE_KEY,
})

export { supabase }

export function clearSupabaseAuthStorage() {
  storage.removeItem(SUPABASE_AUTH_STORAGE_KEY)
  storage.removeItem(`${SUPABASE_AUTH_STORAGE_KEY}-code-verifier`)
}
