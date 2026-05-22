import { mockDataset } from './mockData'
import type { AppDataset } from '../types/domain'

const API_DELAY_MS = 180

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export async function fetchAppDataset(): Promise<AppDataset> {
  await wait(API_DELAY_MS)
  return structuredClone(mockDataset)
}
