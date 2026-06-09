import KaraokeLyrics from '../components/KaraokeLyrics'
import type { LyricWindow } from '../../shared/lyrics/types'

type FullscreenLyricsBoardExampleProps = {
  lyricWindow: LyricWindow
}

export default function FullscreenLyricsBoardExample({ lyricWindow }: FullscreenLyricsBoardExampleProps) {
  return (
    <main style={{ width: '100vw', height: '100vh', background: '#04040a' }}>
      <KaraokeLyrics
        mode="board"
        current={lyricWindow.current}
        previous={lyricWindow.previous}
        next={lyricWindow.next}
        next2={lyricWindow.upcoming[1]}
        isBeforeFirstLine={lyricWindow.isBeforeFirstLine}
        isAfterLastLine={lyricWindow.isAfterLastLine}
      />
    </main>
  )
}
