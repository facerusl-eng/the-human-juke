import { Suspense, useCallback, useMemo, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AudienceLyricView, useSharedLyricState } from '../../shared/lyric-display'
import AudienceSongListPage from '../../src/pages/AudienceSongListPage'
import EventPage from '../../src/pages/EventPage'
import { AuthProvider } from '../../src/state/authStore'
import { QueueProvider } from '../../src/state/queueStore'
import { demoMode } from '../../src/demo/demoMode'
import { DemoAuthProvider } from '../../src/demo/DemoAuthProvider'
import { DemoQueueProvider } from '../../src/demo/DemoQueueProvider'
import { supabase } from './lib/supabaseClient'
import './app.css'

function LiveProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <QueueProvider>{children}</QueueProvider>
    </AuthProvider>
  )
}

function DemoProviders({ children }: { children: ReactNode }) {
  return (
    <DemoAuthProvider>
      <DemoQueueProvider>{children}</DemoQueueProvider>
    </DemoAuthProvider>
  )
}

function AudienceLyricsRoute() {
  const lyricController = useSharedLyricState(supabase, 'audience')
  const navigate = useNavigate()
  const location = useLocation()

  const canShowLyric = useMemo(() => {
    return lyricController.state.blocks.length > 0
  }, [lyricController.state.blocks.length])

  const handleBack = useCallback(() => {
    navigate('/audience/song-list' + location.search)
  }, [navigate, location.search])

  if (canShowLyric) {
    return <AudienceLyricView state={lyricController.state} onBack={handleBack} />
  }

  return (
    <main className="audience-lyric-entry-shell">
      <p className="audience-lyric-waiting-copy">Waiting for lyrics...</p>
    </main>
  )
}

function AudienceShortcutRedirect() {
  const { eventId } = useParams<{ eventId: string }>()
  if (!eventId) return <Navigate to="/audience" replace />
  return <Navigate to={`/audience?event=${encodeURIComponent(eventId)}`} replace />
}

export default function App() {
  const Providers = demoMode ? DemoProviders : LiveProviders

  return (
    <Providers>
      <BrowserRouter>
        <Suspense
          fallback={(
            <main className="audience-lyric-entry-shell">
              <p className="audience-lyric-waiting-copy">Loading audience experience...</p>
            </main>
          )}
        >
          <Routes>
            <Route path="/" element={<Navigate to="/audience/song-list" replace />} />
            <Route path="/j/:eventId" element={<AudienceShortcutRedirect />} />
            <Route path="/audience" element={<EventPage />} />
            <Route path="/audience/song-list" element={<AudienceSongListPage />} />
            <Route path="/lyrics" element={<AudienceLyricsRoute />} />
            <Route path="*" element={<Navigate to="/audience/song-list" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </Providers>
  )
}
