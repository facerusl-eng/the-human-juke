import { useMemo, useState } from 'react'
import { useAppData } from '../state/AppDataContext'

function LibraryPage() {
  const [selectedTag, setSelectedTag] = useState('Trending')
  const [searchValue, setSearchValue] = useState('')
  const { data, isLoading, errorMessage, refresh } = useAppData()
  const tags = ['Trending', 'Original', 'Warm-up', 'Peak Hour', 'Encore']

  const songs = data?.songs ?? []
  const filteredSongs = useMemo(() => {
    const search = searchValue.trim().toLowerCase()

    return songs.filter((song) => {
      if (!song.tags.includes(selectedTag)) {
        return false
      }

      if (!search) {
        return true
      }

      return [
        song.title,
        song.artist,
        song.defaultPerformanceKey,
        song.readiness,
        song.setNote,
        ...(song.cues ?? []),
        ...song.tags,
      ].some((value) => value?.toLowerCase().includes(search))
    })
  }, [searchValue, selectedTag, songs])

  return (
    <section className="surface-card page-shell" aria-label="Song library page">
      <header className="page-header">
        <p className="section-kicker">Library</p>
        <h2>Search, score, and stage songs fast</h2>
        <p>
          Your original catalog, performance-scored with key, BPM, and cue metadata so you can move fast on stage.
        </p>
      </header>

      <div className="library-toolbar">
        <label className="library-search">
          <span>Search stage notes</span>
          <input
            type="search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search title, cue, key, or note"
          />
        </label>
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className={selectedTag === tag ? 'chip-active' : ''}
            onClick={() => {
              setSelectedTag(tag)
            }}
          >
            {tag}
          </button>
        ))}
      </div>

      {isLoading ? <p className="page-state">Loading songs...</p> : null}
      {errorMessage ? (
        <div className="page-state page-state-error" role="alert">
          <p>{errorMessage}</p>
          <button type="button" onClick={() => void refresh()}>Retry</button>
        </div>
      ) : null}

      <div className="song-list" role="list" aria-label="Songs">
        {filteredSongs.map((song) => (
          <article key={song.id} className="song-row" role="listitem">
            <div className="song-row-main">
              <h3>{song.title}</h3>
              <p>{song.artist}</p>
              <p className="song-row-note">{song.setNote ?? 'Add a set note for faster prep.'}</p>
              <div className="song-meta-grid" aria-label={`${song.title} performance metadata`}>
                <p className="song-pill">Key {song.defaultPerformanceKey ?? song.originalKey ?? '--'}</p>
                <p className="song-pill">{song.bpm ?? '--'} BPM</p>
                <p className="song-pill">Capo {song.capo ?? 0}</p>
                <p className="song-pill">{song.difficulty ?? 'Medium'}</p>
                <p className="song-pill">{song.readiness ?? 'Needs Review'}</p>
                <p className="song-pill">Count-in {song.introCountBars ?? 0} bar</p>
              </div>
              <div className="song-cue-list" aria-label={`${song.title} cues`}>
                {(song.cues ?? []).slice(0, 3).map((cue) => (
                  <p key={cue} className="song-cue-chip">{cue}</p>
                ))}
              </div>
            </div>
            <div className="song-row-side">
              <p className="song-pill">{song.length}</p>
              <p className="song-pill">{song.energy}</p>
              <p className="song-pill">{song.defaultRoutePreset ?? 'Route TBD'}</p>
              <p className="song-pill">{song.x18SceneName ?? 'No X18 scene'}</p>
            </div>
          </article>
        ))}
        {!isLoading && !errorMessage && filteredSongs.length === 0 ? (
          <p className="page-state">No songs found for this category yet.</p>
        ) : null}
      </div>
    </section>
  )
}

export default LibraryPage
