import { useEffect, useRef } from 'react'
import './dark-neon-karaoke.css'
import type { LyricDisplayState } from './types'

type MirrorScreenLyricViewProps = {
  state: LyricDisplayState
  onNextBlock?: () => void
  onPreviousBlock?: () => void
}

const PEDAL_ACTION_DEBOUNCE_MS = 180
const PEDAL_SAME_ACTION_COALESCE_MS = 520

type LyricPedalAction = 'next' | 'previous'

function resolveLyricActionFromKey(keyEvent: KeyboardEvent): LyricPedalAction | null {
  if (keyEvent.altKey || keyEvent.ctrlKey || keyEvent.metaKey) {
    return null
  }

  const key = keyEvent.key
  const code = keyEvent.code

  if (code === 'Space') {
    return keyEvent.shiftKey ? 'previous' : 'next'
  }

  if (
    key === 'Enter'
    || code === 'NumpadEnter'
    || key === 'ArrowRight'
    || key === 'ArrowDown'
    || key === 'PageDown'
    || key === 'MediaTrackNext'
  ) {
    return 'next'
  }

  if (
    key === 'ArrowLeft'
    || key === 'ArrowUp'
    || key === 'PageUp'
    || key === 'MediaTrackPrevious'
  ) {
    return 'previous'
  }

  return null
}

function pickMirrorEmojiSet(state: LyricDisplayState) {
  const title = (state.song?.title ?? '').toLowerCase()
  const artist = (state.song?.artist ?? '').toLowerCase()
  const combined = `${title} ${artist}`

  if (/(love|heart|kiss|romance|baby)/.test(combined)) {
    return ['❤️', '✨', '💖']
  }

  if (/(dance|party|club|beat|groove|funk|disco)/.test(combined)) {
    return ['🪩', '🔥', '🎉']
  }

  if (/(rock|river|thunder|storm|road|wild)/.test(combined)) {
    return ['⚡', '🔥', '🎸']
  }

  if (/(night|moon|dream|star|sky)/.test(combined)) {
    return ['🌙', '✨', '⭐']
  }

  return ['🎵', '✨', '🎤']
}

export default function MirrorScreenLyricView({
  state,
  onNextBlock,
  onPreviousBlock,
}: MirrorScreenLyricViewProps) {
  const currentBlock = state.blocks[state.currentBlockIndex] ?? state.blocks[0] ?? 'No lyric loaded.'
  const emojis = pickMirrorEmojiSet(state)
  const lastPedalActionAtRef = useRef(0)
  const lastPedalActionTypeRef = useRef<LyricPedalAction | null>(null)

  useEffect(() => {
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      const target = keyEvent.target as HTMLElement | null
      const textEntryTarget = target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
      if (textEntryTarget) {
        return
      }

      const action = resolveLyricActionFromKey(keyEvent)
      if (!action || keyEvent.repeat) {
        return
      }

      const now = Date.now()
      if (now - lastPedalActionAtRef.current < PEDAL_ACTION_DEBOUNCE_MS) {
        return
      }

      if (
        lastPedalActionTypeRef.current === action
        && now - lastPedalActionAtRef.current < PEDAL_SAME_ACTION_COALESCE_MS
      ) {
        return
      }

      lastPedalActionAtRef.current = now
      lastPedalActionTypeRef.current = action

      keyEvent.preventDefault()
      keyEvent.stopPropagation()

      if (action === 'previous') {
        onPreviousBlock?.()
      } else {
        onNextBlock?.()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [onNextBlock, onPreviousBlock])

  return (
    <section className="lyric-dark-neon-shell" aria-label="Mirror lyric view">
      <div className="lyric-dark-neon-mirror-flash" aria-hidden="true">
        <span className="lyric-dark-neon-mirror-emoji lyric-dark-neon-mirror-emoji-a">{emojis[0]}</span>
        <span className="lyric-dark-neon-mirror-emoji lyric-dark-neon-mirror-emoji-b">{emojis[1]}</span>
        <span className="lyric-dark-neon-mirror-emoji lyric-dark-neon-mirror-emoji-c">{emojis[2]}</span>
      </div>
      <article className="lyric-dark-neon-stage" aria-live="polite" aria-atomic="true">
        <p className="lyric-dark-neon-copy lyric-dark-neon-copy-control lyric-dark-neon-copy-active">{currentBlock}</p>
        <p className="lyric-dark-neon-meta">
          {state.song ? `${state.song.artist} - ${state.song.title}` : 'No song selected'}
        </p>
      </article>
    </section>
  )
}
