import './dark-neon-karaoke.css'
import type { LyricDisplayState } from './types'

type AudienceLyricViewProps = {
  state: LyricDisplayState
}

export default function AudienceLyricView({ state }: AudienceLyricViewProps) {
  const currentBlock = state.blocks[state.currentBlockIndex] ?? state.blocks[0] ?? 'No lyric loaded yet.'
  const isIntroScreen = state.currentBlockIndex < 0
  const introRequesterLabel = state.song?.audience_sings && state.song.createdByName?.trim()
    ? `Requested by ${state.song.createdByName.trim()}`
    : null

  return (
    <section className="lyric-dark-neon-shell" aria-label="Audience lyric view">
      <article className="lyric-dark-neon-stage" aria-live="polite" aria-atomic="true">
        {isIntroScreen ? (
          <div className="lyric-dark-neon-intro">
            <p className="lyric-dark-neon-copy lyric-dark-neon-copy-control lyric-dark-neon-copy-active lyric-dark-neon-copy-intro-title">
              {state.song ? `${state.song.artist} - ${state.song.title}` : 'No song selected'}
            </p>
            {introRequesterLabel ? (
              <p className="lyric-dark-neon-meta lyric-dark-neon-meta-intro">{introRequesterLabel}</p>
            ) : null}
            <p className="lyric-dark-neon-meta lyric-dark-neon-meta-intro">
              Press the foot pedal to start the lyric
            </p>
          </div>
        ) : (
          <>
            <p className="lyric-dark-neon-copy lyric-dark-neon-copy-control lyric-dark-neon-copy-active">{currentBlock}</p>
            <p className="lyric-dark-neon-meta">
              {state.song ? `${state.song.artist} - ${state.song.title}` : 'No song selected'}
            </p>
          </>
        )}
      </article>
    </section>
  )
}
