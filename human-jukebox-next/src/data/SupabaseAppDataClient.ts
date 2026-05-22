import type { AppDataset } from '../types/domain'
import type { AppDataClient } from './AppDataClient'

export class SupabaseAppDataClient implements AppDataClient {
  async fetchDataset(): Promise<AppDataset> {
    throw new Error('Supabase adapter is not configured yet. Set VITE_APP_DATA_PROVIDER=mock or implement Supabase fetching.')
  }
}
