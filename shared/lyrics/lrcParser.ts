import type { LyricLine, ParsedLrc } from './types'

const TIMESTAMP_RE = /\[(\d{1,3}:\d{2}(?:\.\d{1,3})?)\]/g
const METADATA_RE = /^\[([a-zA-Z]{2,}):(.*)\]$/

function normalizeIdFragment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function parseLrcTimestampToSeconds(timestamp: string): number | null {
  const normalized = timestamp.trim()
  const match = normalized.match(/^(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?$/)
  if (!match) {
    return null
  }

  const minutes = Number(match[1])
  const seconds = Number(match[2])
  const fractionalRaw = match[3] ?? '0'

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null
  }

  const milliseconds = Number((fractionalRaw + '00').slice(0, 3))
  if (!Number.isFinite(milliseconds)) {
    return null
  }

  return minutes * 60 + seconds + milliseconds / 1000
}

export function parseLrc(content: string): ParsedLrc {
  const metadata: Record<string, string> = {}
  const parsedLines: LyricLine[] = []

  const sourceLines = content.replace(/\r\n/g, '\n').split('\n')

  for (let index = 0; index < sourceLines.length; index += 1) {
    const rawLine = sourceLines[index]
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const metadataMatch = line.match(METADATA_RE)
    if (metadataMatch && !line.match(TIMESTAMP_RE)) {
      metadata[metadataMatch[1].toLowerCase()] = metadataMatch[2].trim()
      continue
    }

    const timestamps = [...line.matchAll(TIMESTAMP_RE)]
    if (timestamps.length === 0) {
      continue
    }

    const text = line.replace(TIMESTAMP_RE, '').trim()
    if (!text) {
      continue
    }

    for (const stampedTime of timestamps) {
      const timeSeconds = parseLrcTimestampToSeconds(stampedTime[1])
      if (timeSeconds === null) {
        continue
      }

      parsedLines.push({
        timeSeconds,
        text,
        sourceLineNumber: index + 1,
      })
    }
  }

  parsedLines.sort((left, right) => left.timeSeconds - right.timeSeconds)

  const offsetMilliseconds = Number(metadata.offset ?? '0')
  const safeOffsetSeconds = Number.isFinite(offsetMilliseconds) ? offsetMilliseconds / 1000 : 0

  return {
    metadata,
    offsetSeconds: safeOffsetSeconds,
    lines: parsedLines,
  }
}

export function buildLrcCandidatePaths(song: {
  songId?: string | null
  artist?: string | null
  title?: string | null
  explicitPath?: string
}, basePath = '/lyrics') {
  const candidates: string[] = []

  if (song.explicitPath) {
    candidates.push(song.explicitPath)
  }

  if (song.songId) {
    candidates.push(`${basePath}/${encodeURIComponent(song.songId)}.lrc`)
  }

  const normalizedTitle = song.title ? normalizeIdFragment(song.title) : ''
  const normalizedArtist = song.artist ? normalizeIdFragment(song.artist) : ''

  if (normalizedArtist && normalizedTitle) {
    candidates.push(`${basePath}/${normalizedArtist}-${normalizedTitle}.lrc`)
  }

  if (normalizedTitle) {
    candidates.push(`${basePath}/${normalizedTitle}.lrc`)
  }

  return [...new Set(candidates)]
}

export async function fetchLrc(path: string): Promise<string | null> {
  try {
    const response = await fetch(path)
    if (!response.ok) {
      return null
    }

    return await response.text()
  } catch {
    return null
  }
}
