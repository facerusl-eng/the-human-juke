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

function normalizeSearchValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['"`]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(feat\.?|ft\.?)\b.*$/i, ' ')
    .replace(/[.,!?:;()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildTitleVariants(value: string | null | undefined) {
  if (!value) {
    return [] as string[]
  }

  const normalized = normalizeSearchValue(value)
  const variants = [
    value.trim(),
    normalized,
    normalized.replace(/\s-\s.*$/, '').trim(),
  ]

  return [...new Set(variants.filter(Boolean).map(normalizeIdFragment).filter(Boolean))]
}

function buildArtistVariants(value: string | null | undefined) {
  if (!value) {
    return [] as string[]
  }

  const normalized = normalizeSearchValue(value)
  const variants = [
    value.trim(),
    normalized,
    normalized.split(/\s(?:&|x|with|and)\s|,|\//i)[0]?.trim() ?? '',
  ]

  return [...new Set(variants.filter(Boolean).map(normalizeIdFragment).filter(Boolean))]
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
    const normalizedSongId = song.songId.trim()
    const normalizedSongIdFragment = normalizeIdFragment(song.songId)

    if (normalizedSongId.length > 0) {
      candidates.push(`${basePath}/${normalizedSongId}.lrc`)
      candidates.push(`${basePath}/${encodeURIComponent(normalizedSongId)}.lrc`)
    }

    if (normalizedSongIdFragment.length > 0) {
      candidates.push(`${basePath}/${normalizedSongIdFragment}.lrc`)
    }

    candidates.push(`${basePath}/${encodeURIComponent(song.songId)}.lrc`)
  }

  const titleVariants = buildTitleVariants(song.title)
  const artistVariants = buildArtistVariants(song.artist)

  for (const titleVariant of titleVariants) {
    candidates.push(`${basePath}/${titleVariant}.lrc`)
  }

  for (const artistVariant of artistVariants) {
    for (const titleVariant of titleVariants) {
      candidates.push(`${basePath}/${artistVariant}-${titleVariant}.lrc`)
      candidates.push(`${basePath}/${titleVariant}-${artistVariant}.lrc`)
      candidates.push(`${basePath}/${artistVariant}_${titleVariant}.lrc`)
      candidates.push(`${basePath}/${titleVariant}_${artistVariant}.lrc`)
    }
  }

  return [...new Set(candidates.filter(Boolean))]
}

export async function fetchLrc(path: string): Promise<string | null> {
  const requestTimeoutMs = 4000

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, requestTimeoutMs)

    const response = await fetch(path, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (!response.ok) {
      return null
    }

    return await response.text()
  } catch {
    return null
  }
}
