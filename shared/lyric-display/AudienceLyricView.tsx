import './dark-neon-karaoke.css'
import type { LyricDisplayState } from './types'

type AudienceLyricViewProps = {
  state: LyricDisplayState
  onBack?: () => void
}

export default function AudienceLyricView({ state, onBack }: AudienceLyricViewProps) {
  const songLabel = state.song ? `${state.song.artist} - ${state.song.title}` : null
  const introRequesterLabel = state.song?.audience_sings && state.song.createdByName?.trim()
    ? `Requested by ${state.song.createdByName.trim()}`
    : null

  return (
    <section className="lyric-dark-neon-shell audience-lyric-scroll-shell" aria-label="Audience lyric view">
      {onBack ? (
        <div className="audience-lyric-back-bar">
          <button type="button" className="audience-lyric-back-btn" onClick={onBack}>
            ← Back to Lounge
          </button>
        </div>
      ) : null}
      <article className="lyric-dark-neon-stage audience-lyric-scroll-body">
        {songLabel ? (
          <p className="lyric-dark-neon-meta lyric-dark-neon-meta-intro audience-lyric-scroll-title">{songLabel}</p>
        ) : null}
        {introRequesterLabel ? (
          <p className="lyric-dark-neon-meta lyric-dark-neon-meta-intro">{introRequesterLabel}</p>
        ) : null}
        {state.blocks.length > 0
          ? state.blocks.map((block, index) => (
              <p key={index} className="lyric-dark-neon-copy lyric-dark-neon-copy-control audience-lyric-scroll-block">{block}</p>
            ))
          : <p className="lyric-dark-neon-meta">Waiting for lyrics...</p>
        }
      </article>
    </section>
  )
}
