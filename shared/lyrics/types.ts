export type LyricLine = {
  timeSeconds: number
  text: string
  sourceLineNumber: number
}

export type ParsedLrc = {
  metadata: Record<string, string>
  offsetSeconds: number
  lines: LyricLine[]
}

export type LyricWindow = {
  current: LyricLine | null
  previous?: LyricLine
  next?: LyricLine
  upcoming: LyricLine[]
  isBeforeFirstLine: boolean
  isAfterLastLine: boolean
}

export type LyricSongRef = {
  songId?: string | null
  artist?: string | null
  title?: string | null
  explicitPath?: string
}

export type LyricEngineLoadResult = {
  ok: boolean
  pathTried: string[]
  loadedPath?: string
  error?: string
}
