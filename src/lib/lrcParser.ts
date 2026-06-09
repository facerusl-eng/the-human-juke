import {
  buildLrcCandidatePaths,
  parseLrcTimestampToSeconds,
} from '../../shared/lyrics/lrcParser'

export {
  parseLrc as parseLrcFile,
  parseLrcTimestampToSeconds,
  buildLrcCandidatePaths,
  fetchLrc as fetchLrcFile,
} from '../../shared/lyrics/lrcParser'

export type { LyricLine as TimedLine, ParsedLrc as ParsedLyrics } from '../../shared/lyrics/types'

export function parseTimestampToMs(timestamp: string): number | null {
  const seconds = parseLrcTimestampToSeconds(timestamp)
  if (seconds === null) {
    return null
  }

  return Math.round(seconds * 1000)
}

export function buildLrcFilePath(songId: string | null, title: string, artist: string): string {
  const candidates = buildLrcCandidatePaths({ songId, title, artist })
  return candidates[0] ?? `/lyrics/${encodeURIComponent(songId ?? title)}.lrc`
}

export function parseInlineWordTimestamps() {
  return []
}

export function hasInlineWordTimestamps() {
  return false
}

export function serializeParsedLyrics(parsed: import('../../shared/lyrics/types').ParsedLrc): string {
  return JSON.stringify(parsed)
}
