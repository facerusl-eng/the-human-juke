import { memo } from 'react'
import { PrimaryButton, SectionHeader } from '../ui'

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

function isLocalFallbackCoverUrl(coverUrl: string | null | undefined) {
  if (!coverUrl) {
    return false
  }

  return coverUrl.trim().startsWith('data:')
}

function CustomSongList({ songs, addingSongId, onAddSong }: CustomSongListProps) {
  return (
    <section className="gig-custom-song-list" aria-label="Saved custom songs">
      <SectionHeader title="Custom Songs" subtitle={`${songs.length} saved`} titleLevel={3} />

      <ul className="gig-add-song-list">
        {songs.map((song) => (
          <li key={song.id} className="gig-add-song-item ui-card">
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
                  {isLocalFallbackCoverUrl(song.cover_url) ? (
                    <p className="meta-badge">Local cover fallback</p>
                  ) : null}
              </div>
            </div>
            <PrimaryButton
              type="button"
              variant="secondary"
              className="secondary-button"
              disabled={addingSongId === song.id}
              onClick={async () => {
                await onAddSong(song)
              }}
            >
              {addingSongId === song.id ? 'Adding...' : 'Add to Queue'}
            </PrimaryButton>
          </li>
        ))}
        {songs.length === 0 ? (
          <li className="subcopy no-margin-bottom">No custom songs saved yet.</li>
        ) : null}
      </ul>
    </section>
  )
}

export default memo(CustomSongList)
