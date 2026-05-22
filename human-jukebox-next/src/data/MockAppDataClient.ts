import type { AppDataset } from '../types/domain'
import type { AppDataClient } from './AppDataClient'
import { mockDataset } from './mockData'

const API_DELAY_MS = 180

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export class MockAppDataClient implements AppDataClient {
  async fetchDataset(): Promise<AppDataset> {
    await wait(API_DELAY_MS)
    return structuredClone(mockDataset)
  }
}
