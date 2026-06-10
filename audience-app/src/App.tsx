import { useMemo, useState } from 'react'
import { AudienceLyricView, useSharedLyricState } from '../../shared/lyric-display'
import { supabase } from './lib/supabaseClient'
import './app.css'

export default function App() {
  const lyricController = useSharedLyricState(supabase, 'audience')
  const [showAudienceLyric, setShowAudienceLyric] = useState(false)

  const canShowLyric = useMemo(() => {
    return showAudienceLyric && lyricController.state.blocks.length > 0
  }, [lyricController.state.blocks.length, showAudienceLyric])

  if (canShowLyric) {
    return <AudienceLyricView state={lyricController.state} />
  }

  return (
    <main className="audience-lyric-entry-shell">
      <button
        type="button"
        onClick={() => setShowAudienceLyric(true)}
        className="audience-lyric-entry-button"
      >
        See Lyric
      </button>
    </main>
  )
}
