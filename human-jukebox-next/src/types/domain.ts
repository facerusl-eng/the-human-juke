export type SongEnergy = 'Low' | 'Medium' | 'High'

export type SongItem = {
  id: string
  title: string
  artist: string
  length: string
  energy: SongEnergy
  tags: string[]
}

export type SetBlock = {
  id: string
  name: string
  songs: number
  vibe: string
  duration: string
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
