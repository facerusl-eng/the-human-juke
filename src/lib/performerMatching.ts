import type { PerformerQueueSong, SetlistMatch, SetlistSong } from './performerTypes'

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
    return 0.92
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
    const confidence = Number((titleScore * 0.7 + artistScore * 0.3).toFixed(3))

    const passesThreshold = confidence >= 0.72 || (titleScore >= 0.88 && artistScore >= 0.45)

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
