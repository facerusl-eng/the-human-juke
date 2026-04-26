export type CustomSong = {
  id: string
  title: string
  artist: string | null
  cover_url: string | null
  created_at: string
}

type CustomSongListProps = {
  songs: CustomSong[]
  addingSongId: string | null
  onAddSong: (song: CustomSong) => Promise<void>
}

function normalizeCoverUrl(coverUrl: string | null | undefined) {
  if (!coverUrl) {
    return null
  }

  const trimmedCoverUrl = coverUrl.trim()

  if (!trimmedCoverUrl) {
    return null
  }

  return trimmedCoverUrl.replace(/^http:\/\//i, 'https://')
}

function CustomSongList({ songs, addingSongId, onAddSong }: CustomSongListProps) {
  return (
    <section className="gig-custom-song-list" aria-label="Saved custom songs">
      <div className="panel-head">
        <h3>Custom Songs</h3>
        <span className="meta-badge">{songs.length} saved</span>
      </div>

      <ul className="gig-add-song-list">
        {songs.map((song) => (
          <li key={song.id} className="gig-add-song-item">
            <div className="gig-add-song-main">
              {song.cover_url ? (
                <img
                  src={normalizeCoverUrl(song.cover_url) ?? song.cover_url}
                  alt={`Cover art for ${song.title}`}
                  className="song-cover"
                />
              ) : (
                <span className="song-cover song-cover-fallback" aria-hidden="true">♪</span>
              )}
              <div>
                <p className="song">{song.title}</p>
                <p className="artist">{song.artist?.trim() || 'Unknown Artist'}</p>
              </div>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={addingSongId === song.id}
              onClick={async () => {
                await onAddSong(song)
              }}
            >
              {addingSongId === song.id ? 'Adding...' : 'Add to Queue'}
            </button>
          </li>
        ))}
        {songs.length === 0 ? (
          <li className="subcopy no-margin-bottom">No custom songs saved yet.</li>
        ) : null}
      </ul>
    </section>
  )
}

export default CustomSongList
