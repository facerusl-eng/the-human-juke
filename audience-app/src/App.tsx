import { useMemo } from 'react'
import { AudienceLyricView, useSharedLyricState } from '../../shared/lyric-display'
import { supabase } from './lib/supabaseClient'
import './app.css'

export default function App() {
  const lyricController = useSharedLyricState(supabase, 'audience')

  const canShowLyric = useMemo(() => {
    return lyricController.state.blocks.length > 0
  }, [lyricController.state.blocks.length])

  if (canShowLyric) {
    return <AudienceLyricView state={lyricController.state} />
  }

  return (
    <main className="audience-lyric-entry-shell">
      <p className="audience-lyric-waiting-copy">Waiting for lyrics...</p>
    </main>
  )
}
