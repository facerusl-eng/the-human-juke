import './dark-neon-karaoke.css'
import type { LyricDisplayState } from './types'

type MirrorScreenLyricViewProps = {
  state: LyricDisplayState
}

export default function MirrorScreenLyricView({ state }: MirrorScreenLyricViewProps) {
  const currentBlock = state.blocks[state.currentBlockIndex] ?? state.blocks[0] ?? 'No lyric loaded.'

  return (
    <section className="lyric-dark-neon-shell" aria-label="Mirror lyric view">
      <article className="lyric-dark-neon-stage" aria-live="polite" aria-atomic="true">
        <p className="lyric-dark-neon-copy lyric-dark-neon-copy-mirror lyric-dark-neon-copy-active">{currentBlock}</p>
      </article>
    </section>
  )
}
