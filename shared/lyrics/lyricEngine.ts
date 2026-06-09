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
    allLines: [],
    currentIndex: -1,
  }
}

function formatLrcTimestamp(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds)
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = Math.floor(safeSeconds % 60)
  const centiseconds = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 100)

  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  const cc = String(centiseconds).padStart(2, '0')
  return `${mm}:${ss}.${cc}`
}

function hasLrcTimestamps(content: string) {
  return /\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/.test(content)
}

function toSyntheticLrc(content: string) {
  const lines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return ''
  }

  const intervalSeconds = 4
  return lines
    .map((line, index) => `[${formatLrcTimestamp(index * intervalSeconds)}]${line}`)
    .join('\n')
}

async function fetchApiLyrics(song: LyricSongRef): Promise<string | null> {
  const title = (song.title ?? '').trim()
  const artist = (song.artist ?? '').trim()

  if (!title) {
    return null
  }

  const params = new URLSearchParams({ song: title })
  if (artist) {
    params.set('artist', artist)
  }

  try {
    const response = await fetch(`/api/lyrics-genius?${params.toString()}`)
    if (!response.ok) {
      return null
    }

    const payload = await response.json() as { lyrics?: unknown }
    const lyricsText = typeof payload.lyrics === 'string' ? payload.lyrics.trim() : ''
    if (!lyricsText) {
      return null
    }

    return hasLrcTimestamps(lyricsText) ? lyricsText : toSyntheticLrc(lyricsText)
  } catch {
    return null
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

    const apiLyrics = await fetchApiLyrics(song)
    if (apiLyrics) {
      const parsed = parseLrc(apiLyrics)
      if (parsed.lines.length > 0) {
        const virtualPath = `api:lyrics-genius:${songKey}`
        this.parseCache.set(virtualPath, parsed)
        this.activeLyrics = parsed
        this.activeSongKey = songKey
        this.activeSourcePath = virtualPath
        this.lastError = null

        return {
          ok: true,
          pathTried: [...candidatePaths, '/api/lyrics-genius'],
          loadedPath: virtualPath,
        }
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
        allLines: lines,
        currentIndex: -1,
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
      allLines: lines,
      currentIndex: activeIndex,
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
      durationSeconds: this.getDurationSeconds(),
    }
  }

  getDurationSeconds() {
    if (!this.activeLyrics || this.activeLyrics.lines.length === 0) {
      return null
    }

    const lastLine = this.activeLyrics.lines[this.activeLyrics.lines.length - 1]
    return Math.max(0, lastLine.timeSeconds + this.activeLyrics.offsetSeconds)
  }

  private clear(error: string) {
    this.activeLyrics = null
    this.activeSongKey = null
    this.activeSourcePath = null
    this.lastError = error
  }
}
