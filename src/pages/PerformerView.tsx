import { useCallback, useEffect, useMemo, useState } from 'react'
import CurrentSong from '../components/performer/CurrentSong'
import NextUpCard from '../components/performer/NextUpCard'
import QueueList from '../components/performer/QueueList'
import SongMatchOverlay from '../components/performer/SongMatchOverlay'
import { loadSongInJamzone, type JamZoneOverlayResult } from '../lib/performerApi'
import { buildSetlistMatchMap } from '../lib/performerMatching'
import { fetchPerformerQueue } from '../lib/performerApi'
import { loadPerformerSettings, loadSetlistSongs } from '../lib/performerStorage'
import type { PerformerQueueSong, PerformerSettings, SetlistMatch, SetlistSong } from '../lib/performerTypes'
import { DEFAULT_PERFORMER_SETTINGS } from '../lib/performerTypes'
import { useAuthStore } from '../state/authStore'

type OverlayState = {
  song: PerformerQueueSong
  match: SetlistMatch | null
}

export default function PerformerView() {
  const { user } = useAuthStore()
  const [settings, setSettings] = useState<PerformerSettings>(DEFAULT_PERFORMER_SETTINGS)
  const [setlistSongs, setSetlistSongs] = useState<SetlistSong[]>([])
  const [songs, setSongs] = useState<PerformerQueueSong[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [overlayState, setOverlayState] = useState<OverlayState | null>(null)
  const [jamzoneResult, setJamzoneResult] = useState<JamZoneOverlayResult | null>(null)

  useEffect(() => {
    setSettings(loadPerformerSettings(user?.id))
    setSetlistSongs(loadSetlistSongs(user?.id))
  }, [user?.id])

  const refreshQueue = useCallback(async () => {
    if (!settings.human_jukebox_api_key || !settings.human_jukebox_gig_id) {
      setSongs([])
      setError('Add your Human Jukebox API key and Gig ID in Performer Settings first.')
      return
    }

    setLoading(true)

    try {
      const result = await fetchPerformerQueue(settings.human_jukebox_api_key, settings.human_jukebox_gig_id)
      setSongs(result.songs)
      setLastUpdated(result.fetchedAt)
      setError(null)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Could not load Human Jukebox queue.')
    } finally {
      setLoading(false)
    }
  }, [settings.human_jukebox_api_key, settings.human_jukebox_gig_id])

  useEffect(() => {
    void refreshQueue()
  }, [refreshQueue])

  useEffect(() => {
    const intervalMs = Math.max(5, settings.auto_refresh_interval) * 1000
    const timerId = window.setInterval(() => {
      void refreshQueue()
    }, intervalMs)

    return () => {
      window.clearInterval(timerId)
    }
  }, [refreshQueue, settings.auto_refresh_interval])

  const queueSongs = useMemo(
    () => songs.filter((song) => song.status === 'queued' || song.status === 'playing'),
    [songs],
  )
  const currentSong = useMemo(
    () => queueSongs.find((song) => song.status === 'playing') ?? queueSongs[0] ?? null,
    [queueSongs],
  )
  const upcomingSongs = useMemo(
    () => queueSongs.filter((song) => song.id !== currentSong?.id && song.status === 'queued'),
    [currentSong?.id, queueSongs],
  )

  const matchMap = useMemo(
    () => buildSetlistMatchMap(queueSongs, setlistSongs),
    [queueSongs, setlistSongs],
  )

  const currentMatch = currentSong ? (matchMap.get(currentSong.id) ?? null) : null
  const nextSong = upcomingSongs[0] ?? null
  const nextMatch = nextSong ? (matchMap.get(nextSong.id) ?? null) : null

  const openOverlay = async (song: PerformerQueueSong, match: SetlistMatch | null) => {
    setOverlayState({ song, match })
    setJamzoneResult(null)

    if (!settings.jamzone_api_key || !settings.jamzone_playlist_id) {
      setJamzoneResult({
        ok: false,
        message: 'Configure JamZone API key and playlist ID in Performer Settings.',
        details: {
          title: song.title,
          artist: song.artist,
          key: match?.song.key ?? null,
          bpm: match?.song.bpm ?? null,
          notes: match?.song.notes ?? null,
        },
      })
      return
    }

    const songId = song.jamzone_song_id || match?.song.jamzone_song_id || ''

    if (!songId) {
      setJamzoneResult({
        ok: false,
        message: 'No JamZone song ID is available for this song yet.',
        details: {
          title: song.title,
          artist: song.artist,
          key: match?.song.key ?? null,
          bpm: match?.song.bpm ?? null,
          notes: match?.song.notes ?? null,
        },
      })
      return
    }

    const response = await loadSongInJamzone({
      apiKey: settings.jamzone_api_key,
      playlistId: settings.jamzone_playlist_id,
      songId,
      title: song.title,
      artist: song.artist,
    })

    if (!response.details.key && match?.song.key) {
      response.details.key = match.song.key
    }

    if (!response.details.bpm && match?.song.bpm) {
      response.details.bpm = match.song.bpm
    }

    if (!response.details.notes && match?.song.notes) {
      response.details.notes = match.song.notes
    }

    setJamzoneResult(response)
  }

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-purple-300">Performer Companion</p>
          <h1 className="mt-1 text-3xl font-semibold text-gray-100">Live Dashboard</h1>
          <p className="text-sm text-gray-400">Now Playing, Next Up, vote-ranked queue, and JamZone quick access.</p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-purple-400/40 bg-purple-500/10 px-4 py-2 text-sm font-medium text-purple-100 hover:bg-purple-500/20"
          onClick={() => {
            void refreshQueue()
          }}
        >
          {loading ? 'Refreshing…' : 'Refresh now'}
        </button>
      </header>

      {error ? (
        <section className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {error}
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
        <CurrentSong song={currentSong} match={currentMatch} />
        <NextUpCard song={nextSong} match={nextMatch} />
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-100">Queued requests</h2>
          <p className="text-xs text-gray-400">
            {lastUpdated ? `Last update: ${new Date(lastUpdated).toLocaleTimeString()}` : 'No updates yet'}
          </p>
        </div>
        <QueueList songs={upcomingSongs} matchMap={matchMap} onJamzone={openOverlay} />
      </section>

      {overlayState ? (
        <SongMatchOverlay
          song={overlayState.song}
          match={overlayState.match}
          jamzone={jamzoneResult}
          onClose={() => {
            setOverlayState(null)
            setJamzoneResult(null)
          }}
        />
      ) : null}
    </section>
  )
}
