export type LyricViewName = 'none' | 'lyric' | 'mirror-lyric' | 'audience-lyric'

export type LyricSongRef = {
  id: string
  title: string
  artist: string
}

export type LyricDisplayState = {
  activeView: LyricViewName
  song: LyricSongRef | null
  blocks: string[]
  currentBlockIndex: number
  showOnMirror: boolean
  returnToPath: string
  updatedAt: number
  updatedBy: string
}

export type LyricDisplayPatch = Partial<LyricDisplayState>
