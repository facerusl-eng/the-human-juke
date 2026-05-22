import { useMemo, useState } from 'react'
import { useAppData } from '../state/AppDataContext'

function LibraryPage() {
  const [selectedTag, setSelectedTag] = useState('Trending')
  const { data, isLoading, errorMessage, refresh } = useAppData()
  const tags = ['Trending', 'Original', 'Warm-up', 'Peak Hour', 'Encore']

  const songs = data?.songs ?? []
  const filteredSongs = useMemo(() => {
    return songs.filter((song) => song.tags.includes(selectedTag))
  }, [selectedTag, songs])

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
            <div>
              <h3>{song.title}</h3>
              <p>{song.artist}</p>
            </div>
            <p className="song-pill">{song.length}</p>
            <p className="song-pill">{song.energy}</p>
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
