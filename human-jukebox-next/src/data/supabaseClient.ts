import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

function assertConfig(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is missing. Configure Supabase env vars before using the supabase adapter.`)
  }

  return value
}

export const supabase = createClient(
  assertConfig(supabaseUrl, 'VITE_SUPABASE_URL'),
  assertConfig(supabaseAnonKey, 'VITE_SUPABASE_ANON_KEY'),
)
