import { buildLrcCandidatePaths, fetchLrc, parseLrc } from './lrcParser'
import type { LyricEngineLoadResult, LyricLine, LyricSongRef, LyricWindow, ParsedLrc } from './types'

type LyricEngineOptions = {
  basePath?: string
  fetcher?: (path: string) => Promise<string | null>
}

function findActiveLineIndex(lines: LyricLine[], currentTimeSeconds: number) {
  if (lines.length === 0) {
    return -1
  }

  let low = 0
  let high = lines.length - 1
  let activeIndex = -1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (lines[middle].timeSeconds <= currentTimeSeconds) {
      activeIndex = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return activeIndex
}

function emptyLyricWindow(): LyricWindow {
  return {
    current: null,
    upcoming: [],
    isBeforeFirstLine: true,
    isAfterLastLine: false,
  }
}

export class LyricEngine {
  private readonly basePath: string

  private readonly fetcher: (path: string) => Promise<string | null>

  private readonly parseCache = new Map<string, ParsedLrc>()

  private activeLyrics: ParsedLrc | null = null

  private activeSongKey: string | null = null

  private activeSourcePath: string | null = null

  private lastError: string | null = null

  constructor(options: LyricEngineOptions = {}) {
    this.basePath = options.basePath ?? '/lyrics'
    this.fetcher = options.fetcher ?? fetchLrc
  }

  async load(song: LyricSongRef): Promise<LyricEngineLoadResult> {
    const songKey = [song.songId ?? '', song.artist ?? '', song.title ?? '', song.explicitPath ?? ''].join('::')
    const candidatePaths = buildLrcCandidatePaths(song, this.basePath)

    if (candidatePaths.length === 0) {
      this.clear('No lyric path candidates were generated for this song.')
      return {
        ok: false,
        pathTried: [],
        error: this.lastError ?? undefined,
      }
    }

    for (const path of candidatePaths) {
      const cached = this.parseCache.get(path)
      if (cached) {
        this.activeLyrics = cached
        this.activeSongKey = songKey
        this.activeSourcePath = path
        this.lastError = null

        return {
          ok: true,
          pathTried: candidatePaths,
          loadedPath: path,
        }
      }

      const fileContent = await this.fetcher(path)
      if (!fileContent) {
        continue
      }

      const parsed = parseLrc(fileContent)
      this.parseCache.set(path, parsed)
      this.activeLyrics = parsed
      this.activeSongKey = songKey
      this.activeSourcePath = path
      this.lastError = null

      return {
        ok: true,
        pathTried: candidatePaths,
        loadedPath: path,
      }
    }

    this.clear(`Missing LRC file for ${song.title ?? 'unknown title'}`)

    return {
      ok: false,
      pathTried: candidatePaths,
      error: this.lastError ?? undefined,
    }
  }

  unload() {
    this.activeLyrics = null
    this.activeSongKey = null
    this.activeSourcePath = null
    this.lastError = null
  }

  clearCache() {
    this.parseCache.clear()
  }

  getCurrentLyricLine(currentTimeSeconds: number): LyricWindow {
    if (!this.activeLyrics || this.activeLyrics.lines.length === 0) {
      return emptyLyricWindow()
    }

    const adjustedTime = currentTimeSeconds + this.activeLyrics.offsetSeconds
    const lines = this.activeLyrics.lines
    const activeIndex = findActiveLineIndex(lines, adjustedTime)

    if (activeIndex < 0) {
      return {
        current: null,
        previous: undefined,
        next: lines[0],
        upcoming: lines.slice(0, 2),
        isBeforeFirstLine: true,
        isAfterLastLine: false,
      }
    }

    const current = lines[activeIndex]
    const previous = lines[activeIndex - 1]
    const next = lines[activeIndex + 1]
    const nextTwo = lines.slice(activeIndex + 1, activeIndex + 3)

    return {
      current,
      previous,
      next,
      upcoming: nextTwo,
      isBeforeFirstLine: false,
      isAfterLastLine: activeIndex >= lines.length - 1,
    }
  }

  getState() {
    return {
      hasLyrics: Boolean(this.activeLyrics && this.activeLyrics.lines.length > 0),
      lineCount: this.activeLyrics?.lines.length ?? 0,
      songKey: this.activeSongKey,
      sourcePath: this.activeSourcePath,
      lastError: this.lastError,
      metadata: this.activeLyrics?.metadata ?? {},
    }
  }

  private clear(error: string) {
    this.activeLyrics = null
    this.activeSongKey = null
    this.activeSourcePath = null
    this.lastError = error
  }
}
