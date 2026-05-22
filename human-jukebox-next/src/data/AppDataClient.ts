import type { AppDataset } from '../types/domain'

export type AppDataProviderKind = 'mock' | 'supabase'

export interface AppDataClient {
  fetchDataset: () => Promise<AppDataset>
}
