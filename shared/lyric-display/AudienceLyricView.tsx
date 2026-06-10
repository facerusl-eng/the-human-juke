import './dark-neon-karaoke.css'
import type { LyricDisplayState } from './types'

type AudienceLyricViewProps = {
  state: LyricDisplayState
}

export default function AudienceLyricView({ state }: AudienceLyricViewProps) {
  const currentBlock = state.blocks[state.currentBlockIndex] ?? state.blocks[0] ?? 'No lyric loaded yet.'

  return (
    <section className="lyric-dark-neon-shell" aria-label="Audience lyric view">
      <article className="lyric-dark-neon-stage" aria-live="polite" aria-atomic="true">
        <p className="lyric-dark-neon-copy lyric-dark-neon-copy-control lyric-dark-neon-copy-active">{currentBlock}</p>
        <p className="lyric-dark-neon-meta">
          {state.song ? `${state.song.artist} - ${state.song.title}` : 'No song selected'}
        </p>
      </article>
    </section>
  )
}
