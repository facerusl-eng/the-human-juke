import type { AppDataClient, AppDataProviderKind } from './AppDataClient'
import { MockAppDataClient } from './MockAppDataClient'
import { SupabaseAppDataClient } from './SupabaseAppDataClient'

function resolveProviderKind(rawValue: string | undefined): AppDataProviderKind {
  if (rawValue === 'supabase') {
    return 'supabase'
  }

  return 'mock'
}

export function getAppDataClient(): AppDataClient {
  const providerKind = resolveProviderKind(import.meta.env.VITE_APP_DATA_PROVIDER)

  if (providerKind === 'supabase') {
    return new SupabaseAppDataClient()
  }

  return new MockAppDataClient()
}
