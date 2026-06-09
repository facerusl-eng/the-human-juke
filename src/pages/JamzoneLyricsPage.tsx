import { useEffect, useMemo, useState } from 'react'
import KaraokeLyrics from '../components/KaraokeLyrics'
import { useJamzoneLyricSync } from '../../shared/lyrics/useJamzoneLyricSync'
import { createLocalLyricSyncTransport, type LyricSongRef } from '../../shared/lyrics'
import { supabase } from '../lib/supabase'

type JamzoneSong = {
  id: string
  title: string
  artist: string
}

type JamzoneBridge = {
  getCurrentTime: () => number
  getCurrentSong?: () => JamzoneSong | null
  currentSong?: JamzoneSong | null
}

type WindowWithJamzoneBridge = Window & {
  jamzoneBridge?: JamzoneBridge
  HumanJukeboxJamzone?: JamzoneBridge
}

const LOCAL_LYRIC_SYNC_CHANNEL = 'human-jukebox-live-lyrics'

function readJamzoneBridge(): JamzoneBridge | null {
  if (typeof window === 'undefined') {
    return null
  }

  const runtimeWindow = window as WindowWithJamzoneBridge
  return runtimeWindow.jamzoneBridge ?? runtimeWindow.HumanJukeboxJamzone ?? null
}

function readCurrentSong(bridge: JamzoneBridge | null): JamzoneSong | null {
  if (!bridge) {
    return null
  }

  if (typeof bridge.getCurrentSong === 'function') {
    return bridge.getCurrentSong()
  }

  return bridge.currentSong ?? null
}

export default function JamzoneLyricsPage() {
  const [jamzoneBridge, setJamzoneBridge] = useState<JamzoneBridge | null>(null)
  const [song, setSong] = useState<JamzoneSong | null>(null)

  const localSyncTransport = useMemo(() => createLocalLyricSyncTransport(LOCAL_LYRIC_SYNC_CHANNEL), [])

  useEffect(() => {
    const updateFromBridge = () => {
      const nextBridge = readJamzoneBridge()
      setJamzoneBridge(nextBridge)
      setSong(readCurrentSong(nextBridge))
    }

    updateFromBridge()
    const timerId = window.setInterval(updateFromBridge, 350)

    return () => {
      window.clearInterval(timerId)
    }
  }, [])

  const songRef = useMemo<LyricSongRef | null>(() => {
    if (!song) {
      return null
    }

    return {
      songId: song.id,
      artist: song.artist,
      title: song.title,
    }
  }, [song])

  const { window: lyricWindow, isLoading, loadError } = useJamzoneLyricSync(
    songRef,
    () => jamzoneBridge?.getCurrentTime() ?? 0,
    { updateIntervalMs: 80 },
  )

  useEffect(() => {
    if (!song) {
      return
    }

    const payload = {
      songId: song.id,
      jamzoneTimeSeconds: jamzoneBridge?.getCurrentTime() ?? 0,
      current: lyricWindow.current,
      next: lyricWindow.next,
      next2: lyricWindow.upcoming[1],
      updatedAtMs: Date.now(),
    }

    localSyncTransport.publish(payload)

    void supabase.channel('lyrics-sync').send({
      type: 'broadcast',
      event: 'lyrics-frame',
      payload,
    })
  }, [jamzoneBridge, localSyncTransport, lyricWindow.current, lyricWindow.next, lyricWindow.upcoming, song])

  return (
    <main style={{ minHeight: '100vh', background: '#02030a', padding: '1rem' }}>
      <section style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gap: '1rem' }}>
        <header style={{ color: '#d5dcff' }}>
          <h1 style={{ marginBottom: '0.4rem' }}>Jamzone Synced Karaoke</h1>
          <p style={{ margin: 0, opacity: 0.85 }}>
            This view reads Jamzone playback time only. Lyrics advance automatically without manual stepping.
          </p>
          {song ? <p style={{ marginTop: '0.55rem' }}>Now playing: {song.artist} - {song.title}</p> : null}
          {!song ? <p style={{ marginTop: '0.55rem', opacity: 0.85 }}>Waiting for Jamzone song metadata...</p> : null}
          <p style={{ marginTop: '0.35rem' }}>
            Fullscreen board: <a href="/lyrics-board" target="_blank" rel="noreferrer">open lyrics board</a>
          </p>
        </header>

        <section style={{ height: '72vh' }}>
          <KaraokeLyrics
            mode="main"
            current={lyricWindow.current}
            previous={lyricWindow.previous}
            next={lyricWindow.next}
            next2={lyricWindow.upcoming[1]}
            isBeforeFirstLine={lyricWindow.isBeforeFirstLine}
            isAfterLastLine={lyricWindow.isAfterLastLine}
          />
        </section>

        {isLoading ? <p style={{ color: '#8bd8ff' }}>Loading LRC file...</p> : null}
        {loadError ? <p style={{ color: '#ff98c7' }}>Lyric error: {loadError}</p> : null}
      </section>
    </main>
  )
}
