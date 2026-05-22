export type SongEnergy = 'Low' | 'Medium' | 'High'

export type SongItem = {
  id: string
  title: string
  artist: string
  length: string
  energy: SongEnergy
  tags: string[]
  originalKey?: string
  defaultPerformanceKey?: string
  bpm?: number
  capo?: number
  lyricsExcerpt?: string
  cues?: string[]
  isOriginal?: boolean
}

export type SetBlock = {
  id: string
  name: string
  songs: number
  vibe: string
  duration: string
  songIds?: string[]
}

export type LiveShowState = 'pre_show' | 'live' | 'break'

export type LiveConsoleSnapshot = {
  state: LiveShowState
  nextTransitionIn: string
  syncLatencyMs: number
}

export type AppDataset = {
  songs: SongItem[]
  setBlocks: SetBlock[]
  liveConsole: LiveConsoleSnapshot
}
