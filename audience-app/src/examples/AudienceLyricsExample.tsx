import { useEffect, useState } from 'react'
import { KaraokeLyrics } from '../../../shared/lyrics'
import type { LyricWindow } from '../../../shared/lyrics'
import { supabase } from '../lib/supabaseClient'

function emptyWindow(): LyricWindow {
  return {
    current: null,
    upcoming: [],
    isBeforeFirstLine: true,
    isAfterLastLine: false,
  }
}

type AudienceLyricPayload = {
  current: LyricWindow['current']
  next?: LyricWindow['next']
  next2?: LyricWindow['upcoming'][1]
  updatedAtMs: number
}

export default function AudienceLyricsExample() {
  const [windowState, setWindowState] = useState<LyricWindow>(emptyWindow)

  useEffect(() => {
    const channel = supabase
      .channel('lyrics-sync')
      .on('broadcast', { event: 'lyrics-frame' }, ({ payload }) => {
        const lyricPayload = payload as AudienceLyricPayload
        setWindowState((previous) => ({
          ...previous,
          current: lyricPayload.current ?? null,
          next: lyricPayload.next,
          upcoming: [lyricPayload.next, lyricPayload.next2].filter(Boolean) as LyricWindow['upcoming'],
          isBeforeFirstLine: false,
        }))
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  return (
    <section style={{ minHeight: '100vh', background: '#020308' }} aria-label="Audience karaoke lyrics">
      <KaraokeLyrics
        mode="audience"
        current={windowState.current}
        previous={windowState.previous}
        next={windowState.next}
        next2={windowState.upcoming[1]}
        isBeforeFirstLine={windowState.isBeforeFirstLine}
        isAfterLastLine={windowState.isAfterLastLine}
      />
    </section>
  )
}
