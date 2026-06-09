import { useEffect, useMemo, useState } from 'react'
import KaraokeLyrics from '../components/KaraokeLyrics'
import { createLocalLyricSyncTransport, type LyricWindow } from '../../shared/lyrics'

const LOCAL_LYRIC_SYNC_CHANNEL = 'human-jukebox-live-lyrics'

function emptyWindow(): LyricWindow {
  return {
    current: null,
    upcoming: [],
    isBeforeFirstLine: true,
    isAfterLastLine: false,
  }
}

export default function LyricsBoardPage() {
  const [windowState, setWindowState] = useState<LyricWindow>(emptyWindow)
  const transport = useMemo(() => createLocalLyricSyncTransport(LOCAL_LYRIC_SYNC_CHANNEL), [])

  useEffect(() => {
    return transport.subscribe((payload) => {
      setWindowState((prev) => ({
        ...prev,
        current: payload.current,
        next: payload.next,
        upcoming: [payload.next, payload.next2].filter(Boolean) as LyricWindow['upcoming'],
        isBeforeFirstLine: false,
      }))
    })
  }, [transport])

  return (
    <main style={{ width: '100vw', height: '100vh', background: '#02030a' }}>
      <KaraokeLyrics
        mode="board"
        current={windowState.current}
        previous={windowState.previous}
        next={windowState.next}
        next2={windowState.upcoming[1]}
        isBeforeFirstLine={windowState.isBeforeFirstLine}
        isAfterLastLine={windowState.isAfterLastLine}
      />
    </main>
  )
}
