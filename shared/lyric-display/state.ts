import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { buildLrcCandidatePaths, fetchLrc, parseLrc } from '../lyrics/lrcParser'
import type { LyricDisplayPatch, LyricDisplayState, LyricSongRef, LyricViewName } from './types'

const STORAGE_KEY = 'human-jukebox-lyric-display-state-v1'
const CHANNEL_NAME = 'human-jukebox-lyric-display-v1'
const EVENT_NAME = 'lyric-display-state'
const SECTION_LABEL_RE = /^(verse|chorus|pre-chorus|bridge|hook|refrain|intro|outro)\b/i
const SECTION_GAP_SECONDS = 12

function sanitizeLineText(value: string) {
  return value
    .trim()
    .replace(/^[\[(\s-]+|[\])\s:.-]+$/g, '')
}

function parseBlocksFromLrcText(lrcText: string) {
  const parsed = parseLrc(lrcText)
  if (!parsed.lines.length) {
    return []
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

  return blocks
}

async function loadBlocksForSong(song: LyricSongRef) {
  const candidates = buildLrcCandidatePaths({
    songId: song.id,
    title: song.title,
    artist: song.artist,
  })

  for (const candidatePath of candidates) {
    const lrcText = await fetchLrc(candidatePath)
    if (!lrcText) {
      continue
    }

    const blocks = parseBlocksFromLrcText(lrcText)
    if (blocks.length > 0) {
      return blocks
    }
  }

  return [`No lyric blocks found for ${song.artist} - ${song.title}`]
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
  setShowOnMirror: (enabled: boolean) => void
  nextBlock: () => void
  previousBlock: () => void
}

export function useSharedLyricState(supabase: SupabaseClient, sourcePrefix: string): SharedLyricStateController {
  const sourceIdRef = useRef(`${sourcePrefix}-${Math.random().toString(36).slice(2)}`)
  const [state, setState] = useState<LyricDisplayState>(() => {
    const storedState = readStoredState()
    return storedState ?? defaultState(sourceIdRef.current)
  })

  const channelRef = useRef<RealtimeChannel | null>(null)

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
    const blocks = await loadBlocksForSong(song)

    applyPatch({
      song,
      blocks,
      currentBlockIndex: 0,
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

  const setShowOnMirror = useCallback((enabled: boolean) => {
    applyPatch({
      showOnMirror: enabled,
      activeView: enabled ? 'lyric' : state.activeView,
    })
  }, [applyPatch, state.activeView])

  const nextBlock = useCallback(() => {
    applyPatch({
      currentBlockIndex: clampBlockIndex(state.currentBlockIndex + 1, state.blocks.length),
    })
  }, [applyPatch, state.blocks.length, state.currentBlockIndex])

  const previousBlock = useCallback(() => {
    applyPatch({
      currentBlockIndex: clampBlockIndex(state.currentBlockIndex - 1, state.blocks.length),
    })
  }, [applyPatch, state.blocks.length, state.currentBlockIndex])

  return useMemo(() => ({
    state,
    setActiveView,
    openLyricForSong,
    closeLyric,
    setShowOnMirror,
    nextBlock,
    previousBlock,
  }), [closeLyric, nextBlock, openLyricForSong, previousBlock, setActiveView, setShowOnMirror, state])
}
