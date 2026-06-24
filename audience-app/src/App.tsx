import { Suspense, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AudienceLyricView, useSharedLyricState } from '../../shared/lyric-display'
import AudienceSongListPage from '../../src/pages/AudienceSongListPage'
import EventPage from '../../src/pages/EventPage'
import { AuthProvider } from '../../src/state/authStore'
import { QueueProvider } from '../../src/state/queueStore'
import { useQueueStore } from '../../src/state/queueStore'
import { demoMode } from '../../src/demo/demoMode'
import { DemoAuthProvider } from '../../src/demo/DemoAuthProvider'
import { DemoQueueProvider } from '../../src/demo/DemoQueueProvider'
import { supabase } from './lib/supabaseClient'
import './app.css'

const LYRIC_MISSING_RETRY_COOLDOWN_MS = 10_000
const LYRIC_BACKGROUND_REFRESH_INTERVAL_MS = 25_000

function normalizeSongIdentityValue(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function isLyricLoadingPlaceholder(blocks: string[]) {
  return blocks.length === 1 && blocks[0].startsWith('Loading lyrics for ')
}

function isLyricMissingPlaceholder(blocks: string[]) {
  return blocks.length === 1 && blocks[0].startsWith('No lyric blocks found for ')
}

function songsLikelyMatch(
  left: { id?: string | null; librarySongId?: string | null; title?: string | null; artist?: string | null } | null | undefined,
  right: { id?: string | null; librarySongId?: string | null; title?: string | null; artist?: string | null } | null | undefined,
) {
  if (!left || !right) {
    return false
  }

  const leftSongId = normalizeSongIdentityValue(left.librarySongId ?? left.id)
  const rightSongId = normalizeSongIdentityValue(right.librarySongId ?? right.id)

  if (leftSongId && rightSongId && leftSongId === rightSongId) {
    return true
  }

  return normalizeSongIdentityValue(left.title) === normalizeSongIdentityValue(right.title)
    && normalizeSongIdentityValue(left.artist) === normalizeSongIdentityValue(right.artist)
}

function buildSongIdentityKey(song: { id?: string | null; librarySongId?: string | null; title?: string | null; artist?: string | null } | null) {
  if (!song) {
    return null
  }

  const id = normalizeSongIdentityValue(song.librarySongId ?? song.id)
  const title = normalizeSongIdentityValue(song.title)
  const artist = normalizeSongIdentityValue(song.artist)

  if (!id && !title && !artist) {
    return null
  }

  return `${id}::${artist}::${title}`
}

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
  const { state: lyricState, openLyricForSong } = useSharedLyricState(supabase, 'audience')
  const { songs } = useQueueStore()
  const navigate = useNavigate()
  const location = useLocation()
  const lastMissingRetryRef = useRef<{ songKey: string; attemptedAt: number } | null>(null)

  const querySong = useMemo(() => {
    const searchParams = new URLSearchParams(location.search)
    const title = (searchParams.get('title') ?? '').trim()
    const artist = (searchParams.get('artist') ?? '').trim()
    const songId = (searchParams.get('songId') ?? '').trim()

    if (!title && !artist) {
      return null
    }

    if (!title || !artist) {
      return null
    }

    return {
      id: songId || `${artist.toLowerCase().replace(/\s+/g, '-')}:${title.toLowerCase().replace(/\s+/g, '-')}`,
      title,
      artist,
      librarySongId: songId || null,
    }
  }, [location.search])

  const nowPlayingSong = useMemo(() => {
    const nowPlaying = songs[0]
    if (!nowPlaying?.title) {
      return null
    }

    const artist = (nowPlaying.artist ?? '').trim()
    return {
      id: nowPlaying.library_song_id?.trim() || nowPlaying.id,
      title: nowPlaying.title,
      artist,
      librarySongId: nowPlaying.library_song_id?.trim() || null,
      createdByName: nowPlaying.createdByName,
      audience_sings: nowPlaying.audience_sings,
    }
  }, [songs])

  const activeSong = useMemo(() => {
    // Keep audience lyrics pinned to current now-playing whenever queue data is available.
    return nowPlayingSong ?? querySong
  }, [nowPlayingSong, querySong])

  const activeSongKey = useMemo(() => buildSongIdentityKey(activeSong), [activeSong])
  const stateMatchesActiveSong = useMemo(() => songsLikelyMatch(lyricState.song, activeSong), [activeSong, lyricState.song])

  const ensureLyricsLoaded = useCallback(async () => {
    if (!activeSong || !activeSongKey) {
      return
    }

    const loadingPlaceholderVisible = isLyricLoadingPlaceholder(lyricState.blocks)
    const missingPlaceholderVisible = isLyricMissingPlaceholder(lyricState.blocks)

    if (stateMatchesActiveSong) {
      if (loadingPlaceholderVisible) {
        return
      }

      if (!missingPlaceholderVisible && lyricState.blocks.length > 0) {
        return
      }

      if (missingPlaceholderVisible) {
        const now = Date.now()
        const lastRetry = lastMissingRetryRef.current
        if (lastRetry && lastRetry.songKey === activeSongKey && now - lastRetry.attemptedAt < LYRIC_MISSING_RETRY_COOLDOWN_MS) {
          return
        }

        lastMissingRetryRef.current = {
          songKey: activeSongKey,
          attemptedAt: now,
        }
      }
    }

    await openLyricForSong(activeSong, '/audience/song-list' + location.search)
  }, [activeSong, activeSongKey, location.search, lyricState.blocks, openLyricForSong, stateMatchesActiveSong])

  useEffect(() => {
    void ensureLyricsLoaded()
  }, [ensureLyricsLoaded])

  useEffect(() => {
    const handleWake = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }

      void ensureLyricsLoaded()
    }

    window.addEventListener('online', handleWake)
    window.addEventListener('focus', handleWake)
    window.addEventListener('pageshow', handleWake)
    document.addEventListener('visibilitychange', handleWake)

    return () => {
      window.removeEventListener('online', handleWake)
      window.removeEventListener('focus', handleWake)
      window.removeEventListener('pageshow', handleWake)
      document.removeEventListener('visibilitychange', handleWake)
    }
  }, [ensureLyricsLoaded])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }

      void ensureLyricsLoaded()
    }, LYRIC_BACKGROUND_REFRESH_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [ensureLyricsLoaded])

  const canShowLyric = useMemo(() => {
    if (!activeSong || !stateMatchesActiveSong) {
      return false
    }

    if (isLyricLoadingPlaceholder(lyricState.blocks)) {
      return false
    }

    return lyricState.blocks.length > 0
  }, [activeSong, lyricState.blocks, stateMatchesActiveSong])

  const handleBack = useCallback(() => {
    navigate('/audience' + location.search)
  }, [navigate, location.search])

  if (canShowLyric) {
    return <AudienceLyricView state={lyricState} onBack={handleBack} />
  }

  return (
    <main className="audience-lyric-entry-shell">
      <p className="audience-lyric-waiting-copy">Syncing lyrics for the current song...</p>
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
