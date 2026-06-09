import { LyricEngine } from '../../shared/lyrics/lyricEngine'
import type { LyricWindow } from '../../shared/lyrics/types'

export type LyricContext = LyricWindow & {
  nextNext: LyricWindow['upcoming'][1] | null
  progress: number
}

const engine = new LyricEngine()

function toLegacyContext(windowState: LyricWindow): LyricContext {
  return {
    ...windowState,
    nextNext: windowState.upcoming[1] ?? null,
    progress: 0,
  }
}

export function getLyricContext(currentTimeMs: number): LyricContext {
  return toLegacyContext(engine.getCurrentLyricLine(currentTimeMs / 1000))
}

export function getCurrentLyricLine(currentTime: number) {
  return engine.getCurrentLyricLine(currentTime)
}

export async function loadLyrics(songId: string | null, title: string, artist: string) {
  const result = await engine.load({ songId, title, artist })
  return result.ok
}

export function unloadLyrics() {
  engine.unload()
}

export function getLyricEngineState() {
  return engine.getState()
}

export function hasLyricsLoaded(songId: string | null, title: string, artist: string) {
  const state = engine.getState()
  const key = `${songId ?? ''}::${artist}::${title}::`
  return state.songKey === key && state.hasLyrics
}

export async function preloadLyrics(songs: Array<{ songId: string | null; title: string; artist: string }>) {
  const results: Record<string, boolean> = {}

  for (const song of songs) {
    const key = `${song.songId ?? 'none'}::${song.title}::${song.artist}`
    const result = await engine.load(song)
    results[key] = result.ok
  }

  return results
}
