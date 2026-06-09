import { useEffect, useMemo, useState } from 'react'
import KaraokeLyrics from '../components/KaraokeLyrics'
import { useJamzoneLyricSync } from '../../shared/lyrics/useJamzoneLyricSync'
import { createLocalLyricSyncTransport, type LyricSongRef } from '../../shared/lyrics'
import { supabase } from '../lib/supabase'
import {
  getJamzoneBridge,
  getJamzoneCurrentSong,
  getJamzoneCurrentTimeSeconds,
  type JamzoneSong,
} from '../lib/jamzoneBridge'

const LOCAL_LYRIC_SYNC_CHANNEL = 'human-jukebox-live-lyrics'

export default function JamzoneLyricsPage() {
  const [hasJamzoneBridge, setHasJamzoneBridge] = useState(false)
  const [song, setSong] = useState<JamzoneSong | null>(null)

  const localSyncTransport = useMemo(() => createLocalLyricSyncTransport(LOCAL_LYRIC_SYNC_CHANNEL), [])

  useEffect(() => {
    const updateFromBridge = () => {
      const bridge = getJamzoneBridge()
      setHasJamzoneBridge(Boolean(bridge))
      setSong(getJamzoneCurrentSong())
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
    () => getJamzoneCurrentTimeSeconds(),
    { updateIntervalMs: 80 },
  )

  useEffect(() => {
    if (!song) {
      return
    }

    const payload = {
      songId: song.id,
      jamzoneTimeSeconds: getJamzoneCurrentTimeSeconds(),
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
  }, [localSyncTransport, lyricWindow.current, lyricWindow.next, lyricWindow.upcoming, song])

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
          {!hasJamzoneBridge ? <p style={{ marginTop: '0.35rem', opacity: 0.75 }}>Jamzone bridge is not registered yet.</p> : null}
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
