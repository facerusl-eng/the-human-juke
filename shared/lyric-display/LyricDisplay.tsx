import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useSharedLyricState } from './state'
import type { LyricSongRef } from './types'
import './dark-neon-karaoke.css'

type LyricDisplayProps = {
  supabase: SupabaseClient
  activeSong: LyricSongRef | null
  returnToPath: string
  autoOpenOnMount?: boolean
}

export default function LyricDisplay({
  supabase,
  activeSong,
  returnToPath,
  autoOpenOnMount = false,
}: LyricDisplayProps) {
  const navigate = useNavigate()
  const {
    state,
    setActiveView,
    openLyricForSong,
    closeLyric,
    setShowOnMirror,
    nextBlock,
    previousBlock,
  } = useSharedLyricState(supabase, 'control')

  const currentBlock = useMemo(() => {
    if (!state.blocks.length) {
      return 'No lyric loaded.'
    }

    return state.blocks[state.currentBlockIndex] ?? state.blocks[0]
  }, [state.blocks, state.currentBlockIndex])

  useEffect(() => {
    if (!autoOpenOnMount || !activeSong) {
      return
    }

    if (state.song?.id === activeSong.id && state.activeView === 'lyric' && state.blocks.length > 0) {
      return
    }

    void openLyricForSong(activeSong, returnToPath)
  }, [activeSong, autoOpenOnMount, openLyricForSong, returnToPath, state.activeView, state.blocks.length, state.song?.id])

  useEffect(() => {
    if (state.activeView !== 'lyric') {
      return
    }

    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (state.activeView !== 'lyric') {
        return
      }

      const target = keyEvent.target as HTMLElement | null
      const interactiveTarget = target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="button"], [role="textbox"]')
      if (interactiveTarget) {
        return
      }

      if (keyEvent.code !== 'Space' || keyEvent.altKey || keyEvent.ctrlKey || keyEvent.metaKey) {
        return
      }

      keyEvent.preventDefault()
      if (keyEvent.shiftKey) {
        previousBlock()
      } else {
        nextBlock()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [nextBlock, previousBlock, state.activeView])

  const openLyric = async () => {
    if (!activeSong) {
      return
    }

    setActiveView('lyric')
    await openLyricForSong(activeSong, returnToPath)
  }

  const goBack = () => {
    closeLyric()
    navigate(state.returnToPath || returnToPath, { replace: false })
  }

  return (
    <section className="lyric-dark-neon-shell" aria-label="Lyric display">
      <div className="lyric-dark-neon-controls" data-spacebar-ignore="true">
        <button type="button" className="lyric-dark-neon-button" onClick={openLyric}>
          Show Lyric
        </button>
        {state.blocks.length > 0 ? (
          <button
            type="button"
            className="lyric-dark-neon-button"
            onClick={() => setShowOnMirror(!state.showOnMirror)}
          >
            Show in Mirror Screen
          </button>
        ) : null}
        <button type="button" className="lyric-dark-neon-button" onClick={goBack}>
          Back to Control Room / Gig Control
        </button>
      </div>

      <article className="lyric-dark-neon-stage" aria-live="polite" aria-atomic="true">
        <p className="lyric-dark-neon-copy lyric-dark-neon-copy-control lyric-dark-neon-copy-active">{currentBlock}</p>
        <p className="lyric-dark-neon-meta">
          {state.song ? `${state.song.artist} - ${state.song.title}` : 'No song selected'}
          {' • '}
          Block {Math.min(state.currentBlockIndex + 1, Math.max(1, state.blocks.length))}/{Math.max(1, state.blocks.length)}
          {' • '}
          Space next, Shift+Space previous
        </p>
      </article>
    </section>
  )
}
