import { useEffect, useMemo, useRef, useState } from 'react'
import { LyricEngine } from './lyricEngine'
import type { LyricSongRef, LyricWindow } from './types'

type UseJamzoneLyricSyncOptions = {
  updateIntervalMs?: number
}

type UseJamzoneLyricSyncResult = {
  window: LyricWindow
  isLoading: boolean
  loadError: string | null
}

function emptyWindow(): LyricWindow {
  return {
    current: null,
    upcoming: [],
    isBeforeFirstLine: true,
    isAfterLastLine: false,
  }
}

export function useJamzoneLyricSync(
  song: LyricSongRef | null,
  getCurrentTime: () => number,
  options: UseJamzoneLyricSyncOptions = {},
) {
  const [windowState, setWindowState] = useState<LyricWindow>(emptyWindow)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const engine = useMemo(() => new LyricEngine(), [])
  const lastSongKey = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const nextSongKey = song
      ? [song.songId ?? '', song.artist ?? '', song.title ?? '', song.explicitPath ?? ''].join('::')
      : null

    if (!song) {
      engine.unload()
      lastSongKey.current = null
      setWindowState(emptyWindow())
      setLoadError(null)
      setIsLoading(false)
      return
    }

    if (nextSongKey === lastSongKey.current) {
      return
    }

    lastSongKey.current = nextSongKey
    setIsLoading(true)
    setLoadError(null)

    void (async () => {
      const result = await engine.load(song)
      if (cancelled) {
        return
      }

      setIsLoading(false)

      if (!result.ok) {
        setLoadError(result.error ?? 'Lyrics file was not found.')
        setWindowState(emptyWindow())
        return
      }

      setWindowState(engine.getCurrentLyricLine(getCurrentTime()))
    })()

    return () => {
      cancelled = true
    }
  }, [engine, getCurrentTime, song])

  useEffect(() => {
    const updateIntervalMs = options.updateIntervalMs ?? 80
    const timerId = window.setInterval(() => {
      setWindowState(engine.getCurrentLyricLine(getCurrentTime()))
    }, updateIntervalMs)

    return () => {
      window.clearInterval(timerId)
    }
  }, [engine, getCurrentTime, options.updateIntervalMs])

  const result: UseJamzoneLyricSyncResult = {
    window: windowState,
    isLoading,
    loadError,
  }

  return result
}
