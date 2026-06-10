import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { buildLrcCandidatePaths, fetchLrc, parseLrc } from '../lyrics/lrcParser'
import type { LyricDisplayPatch, LyricDisplayState, LyricSongRef, LyricViewName } from './types'

const STORAGE_KEY = 'human-jukebox-lyric-display-state-v1'
const CHANNEL_NAME = 'human-jukebox-lyric-display-v1'
const EVENT_NAME = 'lyric-display-state'
const SECTION_LABEL_RE = /^(verse|chorus|pre-chorus|bridge|hook|refrain|intro|outro)\b/i
const SECTION_GAP_SECONDS = 12
const AUTO_CACHE_KEY = 'lyrics_auto_cache_v1'
const STATUS_KEY = 'lyrics_prefetch_status_v1'
const LRC_MISS_CACHE_TTL_MS = 15 * 60 * 1000
const MAX_BLOCK_LINES = 2
const MAX_BLOCK_CHARS = 110
const lrcMissCache = new Map<string, number>()
const SONG_BLOCK_CACHE_TTL_MS = 20 * 60 * 1000
const songBlocksCache = new Map<string, { cachedAt: number; blocks: string[] }>()
const pendingSongLoads = new Map<string, Promise<string[]>>()

function sanitizeLineText(value: string) {
  return value
    .trim()
    .replace(/^[\[(\s-]+|[\])\s:.-]+$/g, '')
}

function splitLongLine(line: string) {
  const normalizedLine = line.trim()
  if (normalizedLine.length <= MAX_BLOCK_CHARS) {
    return [normalizedLine]
  }

  const midpoint = Math.floor(normalizedLine.length / 2)
  const breakRegex = /[,;:.!?]|\s+and\s+|\s+but\s+|\s+or\s+/gi
  const breakPoints: number[] = []
  let match: RegExpExecArray | null = breakRegex.exec(normalizedLine)

  while (match) {
    breakPoints.push(match.index + match[0].length)
    match = breakRegex.exec(normalizedLine)
  }

  let splitAt = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (const point of breakPoints) {
    if (point <= 18 || point >= normalizedLine.length - 18) {
      continue
    }

    const distance = Math.abs(point - midpoint)
    if (distance < bestDistance) {
      splitAt = point
      bestDistance = distance
    }
  }

  if (splitAt < 0) {
    const words = normalizedLine.split(/\s+/)
    const firstHalf: string[] = []
    const secondHalf: string[] = []
    let firstLength = 0

    for (const word of words) {
      const projectedLength = firstLength === 0 ? word.length : firstLength + 1 + word.length
      if (projectedLength <= midpoint || firstHalf.length === 0) {
        firstHalf.push(word)
        firstLength = projectedLength
      } else {
        secondHalf.push(word)
      }
    }

    const firstLine = firstHalf.join(' ').trim()
    const secondLine = secondHalf.join(' ').trim()
    return [firstLine, secondLine].filter(Boolean)
  }

  const firstPart = normalizedLine.slice(0, splitAt).trim()
  const secondPart = normalizedLine.slice(splitAt).trim()
  return [firstPart, secondPart].filter(Boolean)
}

function normalizeLyricBlocks(rawBlocks: string[]) {
  const normalizedBlocks: string[] = []

  for (const rawBlock of rawBlocks) {
    const rawLines = rawBlock
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (rawLines.length === 0) {
      continue
    }

    const expandedLines = rawLines.flatMap((line) => splitLongLine(line))
    let currentLines: string[] = []
    let currentChars = 0

    for (const line of expandedLines) {
      const nextChars = currentChars === 0 ? line.length : currentChars + 1 + line.length
      const shouldFlush = currentLines.length >= MAX_BLOCK_LINES || nextChars > MAX_BLOCK_CHARS

      if (shouldFlush && currentLines.length > 0) {
        normalizedBlocks.push(currentLines.join('\n'))
        currentLines = []
        currentChars = 0
      }

      currentLines.push(line)
      currentChars = currentChars === 0 ? line.length : currentChars + 1 + line.length
    }

    if (currentLines.length > 0) {
      normalizedBlocks.push(currentLines.join('\n'))
    }
  }

  return normalizedBlocks
}

function parseBlocksFromLrcText(lrcText: string) {
  const parsed = parseLrc(lrcText)
  if (!parsed.lines.length) {
    return parseBlocksFromPlainLyrics(lrcText)
  }

  const blocks: string[] = []
  let currentBlockLines: string[] = []

  for (let index = 0; index < parsed.lines.length; index += 1) {
    const line = parsed.lines[index]
    const previousLine = index > 0 ? parsed.lines[index - 1] : null
    const normalizedText = sanitizeLineText(line.text)
    const isSectionLabel = SECTION_LABEL_RE.test(normalizedText)
    const hasLongGap = previousLine ? line.timeSeconds - previousLine.timeSeconds >= SECTION_GAP_SECONDS : false

    if ((isSectionLabel || hasLongGap) && currentBlockLines.length > 0) {
      blocks.push(currentBlockLines.join('\n'))
      currentBlockLines = []
    }

    if (normalizedText.length > 0) {
      currentBlockLines.push(line.text.trim())
    }
  }

  if (currentBlockLines.length > 0) {
    blocks.push(currentBlockLines.join('\n'))
  }

  return normalizeLyricBlocks(blocks)
}

function parseBlocksFromPlainLyrics(rawLyrics: string) {
  const normalized = rawLyrics
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())

  const blocks: string[] = []
  let currentBlockLines: string[] = []

  for (const line of normalized) {
    if (!line) {
      if (currentBlockLines.length > 0) {
        blocks.push(currentBlockLines.join('\n'))
        currentBlockLines = []
      }
      continue
    }

    currentBlockLines.push(line)
  }

  if (currentBlockLines.length > 0) {
    blocks.push(currentBlockLines.join('\n'))
  }

  return normalizeLyricBlocks(blocks)
}

function normalizeQueryValue(value: string) {
  return value
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeComparableValue(value: string) {
  return normalizeQueryValue(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenOverlapScore(expected: string, actual: string) {
  const expectedTokens = new Set(normalizeComparableValue(expected).split(' ').filter(Boolean))
  const actualTokens = new Set(normalizeComparableValue(actual).split(' ').filter(Boolean))

  if (expectedTokens.size === 0 || actualTokens.size === 0) {
    return 0
  }

  let overlapCount = 0
  for (const token of expectedTokens) {
    if (actualTokens.has(token)) {
      overlapCount += 1
    }
  }

  return overlapCount / Math.max(expectedTokens.size, actualTokens.size)
}

function onlineResultMatchesSong(song: LyricSongRef, payload: Record<string, unknown>) {
  const payloadVariant = payload.variant
  if (!payloadVariant || typeof payloadVariant !== 'object') {
    return true
  }

  const variant = payloadVariant as Record<string, unknown>
  const variantTitle = typeof variant.title === 'string' ? variant.title : ''
  const variantArtist = typeof variant.artist === 'string' ? variant.artist : ''

  if (!variantTitle) {
    return true
  }

  const titleMatch = tokenOverlapScore(song.title, variantTitle)
  const artistMatch = variantArtist ? tokenOverlapScore(song.artist, variantArtist) : 1

  return titleMatch >= 0.55 && artistMatch >= 0.4
}

function normalizeSongIdentityValue(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function songIdentityKey(song: LyricSongRef) {
  const title = normalizeSongIdentityValue(song.title)
  const artist = normalizeSongIdentityValue(song.artist)
  const songId = normalizeSongIdentityValue(song.id)
  return `${songId}::${artist}::${title}`
}

function sameSongContent(left: LyricSongRef | null | undefined, right: LyricSongRef | null | undefined) {
  if (!left || !right) {
    return false
  }

  return (
    normalizeSongIdentityValue(left.title) === normalizeSongIdentityValue(right.title)
    && normalizeSongIdentityValue(left.artist) === normalizeSongIdentityValue(right.artist)
  )
}

function buildSongQueryVariants(song: LyricSongRef) {
  const stripTitle = (value: string) => normalizeQueryValue(value)
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/\b(feat\.?|ft\.?)\b.*$/i, ' ')
    .replace(/\b(remix|version|edit|live|acoustic)\b/gi, ' ')
    .replace(/\s*[-|/]\s*(official|lyrics?|video).*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const stripArtist = (value: string) => normalizeQueryValue(value)
    .replace(/\b(feat\.?|ft\.?)\b.*$/i, ' ')
    .split(/\s(?:&|x|with|and)\s|,|\//i)[0]
    .replace(/\s+/g, ' ')
    .trim()

  const titleCandidates = [
    normalizeQueryValue(song.title),
    stripTitle(song.title),
  ].filter(Boolean)

  const artistCandidates = [
    normalizeQueryValue(song.artist),
    stripArtist(song.artist),
  ].filter(Boolean)

  const variants: Array<{ title: string; artist: string }> = []
  for (const title of titleCandidates) {
    for (const artist of artistCandidates) {
      variants.push({ title, artist })
    }
  }

  const unique = new Map<string, { title: string; artist: string }>()
  for (const variant of variants) {
    unique.set(`${variant.title}::${variant.artist}`, variant)
  }

  return [...unique.values()]
}

function writeLyricsCache(song: LyricSongRef, lyrics: string) {
  if (typeof window === 'undefined') {
    return
  }

  const normalizedLyrics = lyrics.trim()
  if (!normalizedLyrics) {
    return
  }

  const normalizedTitle = song.title.trim().toLowerCase()
  const normalizedArtist = song.artist.trim().toLowerCase()
  const songKey = `song:${song.id.trim().toLowerCase()}`
  const pairKey = `${normalizedTitle}::${normalizedArtist}`

  try {
    const cache = JSON.parse(window.localStorage.getItem(AUTO_CACHE_KEY) ?? '{}') as Record<string, string>
    cache[songKey] = normalizedLyrics
    cache[pairKey] = normalizedLyrics
    window.localStorage.setItem(AUTO_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Best effort cache write.
  }

  try {
    const status = JSON.parse(window.localStorage.getItem(STATUS_KEY) ?? '{}') as Record<string, string>
    status[songKey] = 'found'
    status[pairKey] = 'found'
    window.localStorage.setItem(STATUS_KEY, JSON.stringify(status))
  } catch {
    // Best effort status write.
  }
}

async function fetchOnlineLyrics(song: LyricSongRef) {
  const variants = buildSongQueryVariants(song)

  for (const variant of variants) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => {
        controller.abort()
      }, 5000)

      const response = await fetch(
        `/api/lyrics-genius?song=${encodeURIComponent(variant.title)}&artist=${encodeURIComponent(variant.artist)}`,
        { signal: controller.signal },
      )
      clearTimeout(timeoutId)

      if (!response.ok) {
        continue
      }

      const payload = await response.json() as Record<string, unknown>
      if (!onlineResultMatchesSong(song, payload)) {
        continue
      }

      const rawLyrics = typeof payload.lyrics === 'string' ? payload.lyrics.trim() : ''
      if (!rawLyrics) {
        continue
      }

      writeLyricsCache(song, rawLyrics)

      const blocks = parseBlocksFromPlainLyrics(rawLyrics)
      if (blocks.length > 0) {
        return blocks
      }
    } catch {
      // Continue to next query variant.
    }
  }

  return [] as string[]
}

function readAutoCachedLyrics(song: LyricSongRef) {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawCache = window.localStorage.getItem(AUTO_CACHE_KEY)
    if (!rawCache) {
      return null
    }

    const parsedCache = JSON.parse(rawCache) as Record<string, string>
    const normalizedTitle = song.title.trim().toLowerCase()
    const normalizedArtist = song.artist.trim().toLowerCase()
    const songKeys = [
      `song:${song.id.trim().toLowerCase()}`,
      `${normalizedTitle}::${normalizedArtist}`,
    ]

    for (const songKey of songKeys) {
      const hit = parsedCache[songKey]
      if (typeof hit === 'string' && hit.trim().length > 0) {
        return hit
      }
    }
  } catch {
    return null
  }

  return null
}

async function loadBlocksForSong(song: LyricSongRef) {
  const identityKey = songIdentityKey(song)
  const cachedSongBlocks = songBlocksCache.get(identityKey)
  if (cachedSongBlocks && Date.now() - cachedSongBlocks.cachedAt < SONG_BLOCK_CACHE_TTL_MS) {
    return cachedSongBlocks.blocks
  }

  const pendingLoad = pendingSongLoads.get(identityKey)
  if (pendingLoad) {
    return pendingLoad
  }

  const loadPromise = (async () => {
  const missCachedAt = lrcMissCache.get(identityKey)
  const shouldSkipLrcProbe = typeof missCachedAt === 'number' && Date.now() - missCachedAt < LRC_MISS_CACHE_TTL_MS

  const candidates = buildLrcCandidatePaths({
    songId: song.id,
    title: song.title,
    artist: song.artist,
  })

  if (!shouldSkipLrcProbe) {
    for (const candidatePath of candidates.slice(0, 8)) {
      const lrcText = await fetchLrc(candidatePath)
      if (!lrcText) {
        continue
      }

      const blocks = parseBlocksFromLrcText(lrcText)
      if (blocks.length > 0) {
        lrcMissCache.delete(identityKey)
        return blocks
      }
    }

    lrcMissCache.set(identityKey, Date.now())
  }

  const autoCachedLyrics = readAutoCachedLyrics(song)
  if (autoCachedLyrics) {
    const cachedBlocks = parseBlocksFromPlainLyrics(autoCachedLyrics)
    if (cachedBlocks.length > 0) {
      return cachedBlocks
    }
  }

  const onlineBlocks = await fetchOnlineLyrics(song)
  if (onlineBlocks.length > 0) {
    return onlineBlocks
  }

    return [`No lyric blocks found for ${song.artist} - ${song.title}`]
  })()

  pendingSongLoads.set(identityKey, loadPromise)

  try {
    const blocks = await loadPromise
    songBlocksCache.set(identityKey, {
      cachedAt: Date.now(),
      blocks,
    })
    return blocks
  } finally {
    pendingSongLoads.delete(identityKey)
  }
}

function defaultState(sourceId: string): LyricDisplayState {
  return {
    activeView: 'none',
    song: null,
    blocks: [],
    currentBlockIndex: 0,
    showOnMirror: false,
    returnToPath: '/admin/gig-control',
    updatedAt: Date.now(),
    updatedBy: sourceId,
  }
}

function clampBlockIndex(nextIndex: number, totalBlocks: number) {
  if (totalBlocks <= 0) {
    return 0
  }

  return Math.max(0, Math.min(totalBlocks - 1, nextIndex))
}

function normalizeIntroBlockIndex(nextIndex: number, totalBlocks: number) {
  if (totalBlocks <= 0) {
    return 0
  }

  if (nextIndex < 0) {
    return -1
  }

  return clampBlockIndex(nextIndex, totalBlocks)
}

function readStoredState() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawState = window.localStorage.getItem(STORAGE_KEY)
    if (!rawState) {
      return null
    }

    return JSON.parse(rawState) as LyricDisplayState
  } catch {
    return null
  }
}

export type SharedLyricStateController = {
  state: LyricDisplayState
  setActiveView: (activeView: LyricViewName) => void
  openLyricForSong: (song: LyricSongRef, returnToPath: string) => Promise<void>
  closeLyric: () => void
  setBlocks: (blocks: string[]) => void
  setShowOnMirror: (enabled: boolean) => void
  nextBlock: () => void
  previousBlock: () => void
}

export function useSharedLyricState(supabase: SupabaseClient, sourcePrefix: string): SharedLyricStateController {
  const sourceIdRef = useRef(`${sourcePrefix}-${Math.random().toString(36).slice(2)}`)
  const latestOpenRequestIdRef = useRef(0)
  const [state, setState] = useState<LyricDisplayState>(() => {
    const storedState = readStoredState()
    return storedState ?? defaultState(sourceIdRef.current)
  })

  const stateRef = useRef(state)
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const applyPatch = useCallback((patch: LyricDisplayPatch) => {
    setState((currentState) => {
      const nextState = {
        ...currentState,
        ...patch,
        updatedAt: Date.now(),
        updatedBy: sourceIdRef.current,
      }

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState))
      }

      return nextState
    })
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel(CHANNEL_NAME)
      .on('broadcast', { event: EVENT_NAME }, ({ payload }) => {
        const nextState = payload as LyricDisplayState
        if (!nextState || nextState.updatedBy === sourceIdRef.current) {
          return
        }

        if (nextState.updatedAt <= (stateRef.current.updatedAt ?? 0)) {
          return
        }

        setState(nextState)
      })
      .subscribe()

    channelRef.current = channel

    const onStorage = (storageEvent: StorageEvent) => {
      if (storageEvent.key !== STORAGE_KEY || !storageEvent.newValue) {
        return
      }

      try {
        const nextState = JSON.parse(storageEvent.newValue) as LyricDisplayState
        if (nextState.updatedBy === sourceIdRef.current) {
          return
        }

        if (nextState.updatedAt <= (stateRef.current.updatedAt ?? 0)) {
          return
        }

        setState(nextState)
      } catch {
        // Ignore malformed storage payloads.
      }
    }

    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener('storage', onStorage)
      void channel.unsubscribe()
      channelRef.current = null
    }
  }, [supabase])

  useEffect(() => {
    if (!channelRef.current) {
      return
    }

    void channelRef.current.send({
      type: 'broadcast',
      event: EVENT_NAME,
      payload: state,
    })
  }, [state])

  const openLyricForSong = useCallback(async (song: LyricSongRef, returnToPath: string) => {
    if (sameSongContent(stateRef.current.song, song) && stateRef.current.blocks.length > 0) {
      applyPatch({
        song,
        activeView: 'lyric',
        currentBlockIndex: -1,
        returnToPath,
      })
      return
    }

    latestOpenRequestIdRef.current += 1
    const requestId = latestOpenRequestIdRef.current

    const blocks = await loadBlocksForSong(song)

    if (requestId !== latestOpenRequestIdRef.current) {
      return
    }

    applyPatch({
      song,
      blocks,
      currentBlockIndex: -1,
      activeView: 'lyric',
      showOnMirror: false,
      returnToPath,
    })
  }, [applyPatch])

  const setActiveView = useCallback((activeView: LyricViewName) => {
    applyPatch({ activeView })
  }, [applyPatch])

  const closeLyric = useCallback(() => {
    applyPatch({
      activeView: 'none',
      showOnMirror: false,
      currentBlockIndex: 0,
    })
  }, [applyPatch])

  const setBlocks = useCallback((blocks: string[]) => {
    const normalizedBlocks = normalizeLyricBlocks(blocks
      .map((block) => block.replace(/\r\n/g, '\n').trim())
      .filter(Boolean))

    applyPatch({
      blocks: normalizedBlocks.length > 0 ? normalizedBlocks : ['No lyric loaded.'],
      currentBlockIndex: -1,
      activeView: 'lyric',
    })
  }, [applyPatch])

  const setShowOnMirror = useCallback((enabled: boolean) => {
    applyPatch({
      showOnMirror: enabled,
      activeView: enabled ? 'lyric' : state.activeView,
    })
  }, [applyPatch, state.activeView])

  const nextBlock = useCallback(() => {
    applyPatch({
      currentBlockIndex: normalizeIntroBlockIndex(state.currentBlockIndex + 1, state.blocks.length),
    })
  }, [applyPatch, state.blocks.length, state.currentBlockIndex])

  const previousBlock = useCallback(() => {
    applyPatch({
      currentBlockIndex: normalizeIntroBlockIndex(state.currentBlockIndex - 1, state.blocks.length),
    })
  }, [applyPatch, state.blocks.length, state.currentBlockIndex])

  return useMemo(() => ({
    state,
    setActiveView,
    openLyricForSong,
    closeLyric,
    setBlocks,
    setShowOnMirror,
    nextBlock,
    previousBlock,
  }), [closeLyric, nextBlock, openLyricForSong, previousBlock, setActiveView, setBlocks, setShowOnMirror, state])
}
