import './dark-neon-karaoke.css'
import type { LyricDisplayState } from './types'

type MirrorScreenLyricViewProps = {
  state: LyricDisplayState
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

export default function MirrorScreenLyricView({ state }: MirrorScreenLyricViewProps) {
  const currentBlock = state.blocks[state.currentBlockIndex] ?? state.blocks[0] ?? 'No lyric loaded.'
  const emojis = pickMirrorEmojiSet(state)

  return (
    <section className="lyric-dark-neon-shell" aria-label="Mirror lyric view">
      <div className="lyric-dark-neon-mirror-flash" aria-hidden="true">
        <span className="lyric-dark-neon-mirror-emoji lyric-dark-neon-mirror-emoji-a">{emojis[0]}</span>
        <span className="lyric-dark-neon-mirror-emoji lyric-dark-neon-mirror-emoji-b">{emojis[1]}</span>
        <span className="lyric-dark-neon-mirror-emoji lyric-dark-neon-mirror-emoji-c">{emojis[2]}</span>
      </div>
      <article className="lyric-dark-neon-stage" aria-live="polite" aria-atomic="true">
        <p className="lyric-dark-neon-copy lyric-dark-neon-copy-mirror lyric-dark-neon-copy-active">{currentBlock}</p>
        <p className="lyric-dark-neon-meta lyric-dark-neon-meta-mirror">
          {state.song ? `${state.song.artist} - ${state.song.title}` : 'No song selected'}
        </p>
      </article>
    </section>
  )
}
