type SongItem = {
  title: string
  artist: string
  length: string
  energy: 'Low' | 'Medium' | 'High'
}

const songs: SongItem[] = [
  { title: 'Midnight Satellites', artist: 'Electric Avenue', length: '03:48', energy: 'Medium' },
  { title: 'City Lights, Loud Hearts', artist: 'Nova Hotel', length: '04:02', energy: 'High' },
  { title: 'Golden Static', artist: 'Harborline', length: '03:31', energy: 'Low' },
  { title: 'Heartbeat Parade', artist: 'Luna District', length: '03:59', energy: 'High' },
]

function LibraryPage() {
  return (
    <section className="surface-card page-shell" aria-label="Song library page">
      <header className="page-header">
        <p className="section-kicker">Library</p>
        <h2>Search, score, and stage songs fast</h2>
        <p>
          Curated for live performance with speed-first metadata so hosts can pick the right next track in seconds.
        </p>
      </header>

      <div className="library-toolbar">
        <button type="button" className="chip-active">Trending</button>
        <button type="button">Warm-up</button>
        <button type="button">Peak Hour</button>
        <button type="button">Encore</button>
      </div>

      <div className="song-list" role="list" aria-label="Songs">
        {songs.map((song) => (
          <article key={`${song.title}-${song.artist}`} className="song-row" role="listitem">
            <div>
              <h3>{song.title}</h3>
              <p>{song.artist}</p>
            </div>
            <p className="song-pill">{song.length}</p>
            <p className="song-pill">{song.energy}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

export default LibraryPage
