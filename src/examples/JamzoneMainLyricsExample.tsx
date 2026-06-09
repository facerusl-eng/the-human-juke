import { useMemo } from 'react'
import KaraokeLyrics from '../components/KaraokeLyrics'
import { useJamzoneLyricSync } from '../../shared/lyrics/useJamzoneLyricSync'
import type { LyricSongRef } from '../../shared/lyrics/types'

type JamzoneBridge = {
  getCurrentTime: () => number
  currentSong: {
    id: string
    artist: string
    title: string
  } | null
}

type JamzoneMainLyricsExampleProps = {
  jamzone: JamzoneBridge
}

export default function JamzoneMainLyricsExample({ jamzone }: JamzoneMainLyricsExampleProps) {
  const songRef = useMemo<LyricSongRef | null>(() => {
    if (!jamzone.currentSong) {
      return null
    }

    return {
      songId: jamzone.currentSong.id,
      artist: jamzone.currentSong.artist,
      title: jamzone.currentSong.title,
    }
  }, [jamzone.currentSong])

  const { window, isLoading, loadError } = useJamzoneLyricSync(songRef, jamzone.getCurrentTime)

  return (
    <section aria-label="Main app karaoke lyrics" style={{ minHeight: '70vh' }}>
      <KaraokeLyrics
        mode="main"
        current={window.current}
        previous={window.previous}
        next={window.next}
        next2={window.upcoming[1]}
        isBeforeFirstLine={window.isBeforeFirstLine}
        isAfterLastLine={window.isAfterLastLine}
      />

      {isLoading ? <p>Loading LRC file...</p> : null}
      {loadError ? <p>Lyric error: {loadError}</p> : null}
    </section>
  )
}
