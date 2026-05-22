import { useMemo, useState } from 'react'
import { useAppData } from '../state/AppDataContext'

const NOTE_STORAGE_KEY = 'hj-next-stage-note'

const KEY_SEQUENCE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function transposeKey(baseKey: string, semitoneShift: number) {
  const raw = baseKey.trim()
  const upperRaw = raw.toUpperCase()
  const minor = upperRaw.endsWith('M') || upperRaw.endsWith('MIN') || upperRaw.endsWith('MINOR')
  const normalized = upperRaw
    .replace('MINOR', '')
    .replace('MIN', '')
    .replace(/M$/, '')
    .trim()
  const root = normalized.replace(/M$/, '')
  const rootIndex = KEY_SEQUENCE.indexOf(root)

  if (rootIndex === -1) {
    return baseKey
  }

  const shifted = (rootIndex + semitoneShift + KEY_SEQUENCE.length * 4) % KEY_SEQUENCE.length
  return `${KEY_SEQUENCE[shifted]}${minor ? 'm' : ''}`
}

function readInitialNote() {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.localStorage.getItem(NOTE_STORAGE_KEY) ?? ''
}

function StageModePage() {
  const { data, isLoading, errorMessage, refresh } = useAppData()
  const songs = data?.songs ?? []
  const orderedSet = data?.setBlocks?.find((setBlock) => (setBlock.songIds?.length ?? 0) > 0) ?? null
  const orderedSongs = useMemo(() => {
    if (!orderedSet?.songIds?.length) {
      return songs
    }

    const map = new Map(songs.map((song) => [song.id, song]))
    return orderedSet.songIds
      .map((songId) => map.get(songId))
      .filter((song): song is NonNullable<typeof song> => Boolean(song))
  }, [orderedSet, songs])

  const [songIndex, setSongIndex] = useState(0)
  const [semitones, setSemitones] = useState(0)
  const [bpmDelta, setBpmDelta] = useState(0)
  const [stageNote, setStageNote] = useState(readInitialNote)

  const currentSong = orderedSongs[songIndex] ?? null
  const hasSongs = orderedSongs.length > 0
  const baseKey = currentSong?.defaultPerformanceKey ?? currentSong?.originalKey ?? 'C'
  const displayedKey = transposeKey(baseKey, semitones)
  const displayedBpm = Math.max(40, (currentSong?.bpm ?? 100) + bpmDelta)

  return (
    <section className="surface-card page-shell" aria-label="Stage mode page">
      <header className="page-header">
        <p className="section-kicker">Stage Mode</p>
        <h2>Performer-first set control for original songs</h2>
        <p>
          Built for your own catalog with live key shifts, BPM tweaks, cues, and one-screen next-song focus.
        </p>
      </header>

      {isLoading ? <p className="page-state">Loading stage data...</p> : null}
      {errorMessage ? (
        <div className="page-state page-state-error" role="alert">
          <p>{errorMessage}</p>
          <button type="button" onClick={() => void refresh()}>Retry</button>
        </div>
      ) : null}

      {!isLoading && !errorMessage && orderedSongs.length === 0 ? (
        <p className="page-state" role="status">
          No songs found in your current provider. Add rows to library_songs and playlist_songs, or switch to mock mode to test Stage Mode quickly.
        </p>
      ) : null}

      <div className="stage-layout">
        <article className="stage-panel">
          <p className="panel-label">Current Song</p>
          <h3>{currentSong?.title ?? 'No songs loaded'}</h3>
          <p>{currentSong?.artist ?? 'Add songs to begin stage mode'}</p>
          <p className="stage-meta-row">
            <span>Length: {currentSong?.length ?? '--:--'}</span>
            <span>Energy: {currentSong?.energy ?? 'Medium'}</span>
            <span>{currentSong?.isOriginal ? 'Original' : 'Catalog'}</span>
          </p>
        </article>

        <article className="stage-panel">
          <p className="panel-label">Key + Tempo</p>
          <div className="stage-transport-row">
            <div>
              <p className="stage-stat-label">Key</p>
              <p className="stage-stat-value">{displayedKey}</p>
            </div>
            <div>
              <p className="stage-stat-label">BPM</p>
              <p className="stage-stat-value">{displayedBpm}</p>
            </div>
            <div>
              <p className="stage-stat-label">Capo</p>
              <p className="stage-stat-value">{currentSong?.capo ?? 0}</p>
            </div>
          </div>
          <div className="action-row">
            <button type="button" onClick={() => setSemitones((v) => Math.max(v - 1, -6))}>Transpose -</button>
            <button type="button" onClick={() => setSemitones(0)}>Reset key</button>
            <button type="button" onClick={() => setSemitones((v) => Math.min(v + 1, 6))}>Transpose +</button>
          </div>
          <div className="action-row">
            <button type="button" onClick={() => setBpmDelta((v) => Math.max(v - 2, -20))}>BPM -2</button>
            <button type="button" onClick={() => setBpmDelta(0)}>Reset BPM</button>
            <button type="button" onClick={() => setBpmDelta((v) => Math.min(v + 2, 20))}>BPM +2</button>
          </div>
        </article>

        <article className="stage-panel">
          <p className="panel-label">Cue Stack</p>
          <ul className="cue-list" aria-label="Song cues">
            {(currentSong?.cues ?? []).map((cue) => (
              <li key={cue}>{cue}</li>
            ))}
          </ul>
          {!(currentSong?.cues?.length) ? <p className="page-state">No cues set for this song yet.</p> : null}
          <p className="lyrics-preview">{currentSong?.lyricsExcerpt ?? 'Add a lyric excerpt for confidence cues.'}</p>
        </article>

        <article className="stage-panel">
          <p className="panel-label">Set Flow</p>
          <div className="action-row">
            <button type="button" disabled={!hasSongs || songIndex === 0} onClick={() => setSongIndex((i) => Math.max(0, i - 1))}>Previous</button>
            <button type="button" disabled={!hasSongs || songIndex >= orderedSongs.length - 1} onClick={() => setSongIndex((i) => Math.min(orderedSongs.length - 1, i + 1))}>Next</button>
          </div>
          <p>
            {orderedSet ? `Using set: ${orderedSet.name}` : 'No set order found. Using library order.'}
          </p>
          <ol className="stage-order-list">
            {orderedSongs.map((song, index) => (
              <li key={song.id} className={index === songIndex ? 'stage-order-active' : ''}>
                {song.title}
              </li>
            ))}
          </ol>
        </article>

        <article className="stage-panel stage-panel-note">
          <p className="panel-label">Performer Note</p>
          <textarea
            value={stageNote}
            onChange={(event) => {
              const nextValue = event.target.value
              setStageNote(nextValue)
              if (typeof window !== 'undefined') {
                window.localStorage.setItem(NOTE_STORAGE_KEY, nextValue)
              }
            }}
            placeholder="Write reminders: counts, cue lights, or transitions..."
          />
        </article>
      </div>

      <footer className="stage-perform-bar" aria-label="Performance quick controls">
        <button
          type="button"
          disabled={!hasSongs || songIndex === 0}
          onClick={() => setSongIndex((i) => Math.max(0, i - 1))}
        >
          Previous Song
        </button>
        <p>
          {hasSongs ? `Song ${songIndex + 1} of ${orderedSongs.length}` : 'No songs loaded'}
        </p>
        <button
          type="button"
          disabled={!hasSongs || songIndex >= orderedSongs.length - 1}
          onClick={() => setSongIndex((i) => Math.min(orderedSongs.length - 1, i + 1))}
        >
          Next Song
        </button>
      </footer>
    </section>
  )
}

export default StageModePage
