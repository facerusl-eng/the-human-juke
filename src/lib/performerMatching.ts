import type { PerformerQueueSong, SetlistMatch, SetlistSong } from './performerTypes'

const SUBSTRING_MATCH_BOOST = 0.92
const TITLE_WEIGHT = 0.7
const ARTIST_WEIGHT = 0.3
const MATCH_CONFIDENCE_THRESHOLD = 0.72
const MATCH_TITLE_HIGH_THRESHOLD = 0.88
const MATCH_ARTIST_MIN_THRESHOLD = 0.45

function normalizeForMatch(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(value: string) {
  return normalizeForMatch(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
}

function jaccardScore(left: string, right: string) {
  const leftTokens = new Set(tokenize(left))
  const rightTokens = new Set(tokenize(right))

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0
  }

  let overlap = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1
    }
  }

  const union = leftTokens.size + rightTokens.size - overlap
  return union > 0 ? overlap / union : 0
}

function inclusionBoost(left: string, right: string) {
  const normalizedLeft = normalizeForMatch(left)
  const normalizedRight = normalizeForMatch(right)

  if (!normalizedLeft || !normalizedRight) {
    return 0
  }

  if (normalizedLeft === normalizedRight) {
    return 1
  }

  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return SUBSTRING_MATCH_BOOST
  }

  return 0
}

function fieldScore(left: string, right: string) {
  return Math.max(jaccardScore(left, right), inclusionBoost(left, right))
}

export function findBestSetlistMatch(queueSong: PerformerQueueSong, setlistSongs: SetlistSong[]): SetlistMatch | null {
  let best: SetlistMatch | null = null

  for (const setlistSong of setlistSongs) {
    const titleScore = fieldScore(queueSong.title, setlistSong.title)
    const artistScore = fieldScore(queueSong.artist, setlistSong.artist)
    const confidence = Number((titleScore * TITLE_WEIGHT + artistScore * ARTIST_WEIGHT).toFixed(3))

    const passesThreshold = confidence >= MATCH_CONFIDENCE_THRESHOLD
      || (titleScore >= MATCH_TITLE_HIGH_THRESHOLD && artistScore >= MATCH_ARTIST_MIN_THRESHOLD)

    if (!passesThreshold) {
      continue
    }

    if (!best || confidence > best.confidence) {
      best = { song: setlistSong, confidence }
    }
  }

  return best
}

export function buildSetlistMatchMap(queueSongs: PerformerQueueSong[], setlistSongs: SetlistSong[]) {
  const matchMap = new Map<string, SetlistMatch>()

  for (const queueSong of queueSongs) {
    const match = findBestSetlistMatch(queueSong, setlistSongs)
    if (match) {
      matchMap.set(queueSong.id, match)
    }
  }

  return matchMap
}
