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
  songDurationSeconds: number | null
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
  const [songDurationSeconds, setSongDurationSeconds] = useState<number | null>(null)

  const engine = useMemo(() => new LyricEngine(), [])
  const lastSongKey = useRef<string | null>(null)
  const getCurrentTimeRef = useRef(getCurrentTime)

  useEffect(() => {
    getCurrentTimeRef.current = getCurrentTime
  }, [getCurrentTime])

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
      setSongDurationSeconds(null)
      return
    }

    if (nextSongKey === lastSongKey.current) {
      return
    }

    lastSongKey.current = nextSongKey
    // Clear previous song lyrics immediately so mirror never shows stale lines
    // while the next song's lyrics are being resolved.
    engine.unload()
    setWindowState(emptyWindow())
    setSongDurationSeconds(null)
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
        setSongDurationSeconds(null)
        return
      }

      setWindowState(engine.getCurrentLyricLine(getCurrentTime()))
      setSongDurationSeconds(engine.getDurationSeconds())
    })()

    return () => {
      cancelled = true
    }
  }, [engine, song])

  useEffect(() => {
    const updateIntervalMs = options.updateIntervalMs ?? 80
    const timerId = window.setInterval(() => {
      setWindowState(engine.getCurrentLyricLine(getCurrentTimeRef.current()))
    }, updateIntervalMs)

    return () => {
      window.clearInterval(timerId)
    }
  }, [engine, options.updateIntervalMs])

  const result: UseJamzoneLyricSyncResult = {
    window: windowState,
    isLoading,
    loadError,
    songDurationSeconds,
  }

  return result
}
