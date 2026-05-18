import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { SetlistSong } from '../../lib/performerTypes'

type SetlistManagerProps = {
  songs: SetlistSong[]
  onChange: (songs: SetlistSong[]) => void
}

type DraftSetlistSong = {
  title: string
  artist: string
  jamzone_song_id: string
  key: string
  bpm: string
  notes: string
}

const EMPTY_DRAFT: DraftSetlistSong = {
  title: '',
  artist: '',
  jamzone_song_id: '',
  key: '',
  bpm: '',
  notes: '',
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `setlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function SetlistManager({ songs, onChange }: SetlistManagerProps) {
  const [draft, setDraft] = useState<DraftSetlistSong>(EMPTY_DRAFT)
  const sortedSongs = useMemo(
    () => [...songs].sort((left, right) => left.title.localeCompare(right.title)),
    [songs],
  )

  const addSong = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const title = draft.title.trim()
    const artist = draft.artist.trim()

    if (!title || !artist) {
      return
    }

    onChange([
      ...songs,
      {
        id: createId(),
        title,
        artist,
        jamzone_song_id: draft.jamzone_song_id.trim(),
        key: draft.key.trim(),
        bpm: draft.bpm.trim(),
        notes: draft.notes.trim(),
      },
    ])

    setDraft(EMPTY_DRAFT)
  }

  const removeSong = (songId: string) => {
    onChange(songs.filter((song) => song.id !== songId))
  }

  return (
    <section className="rounded-2xl border border-purple-400/20 bg-gray-900/70 p-5">
      <h2 className="text-lg font-semibold text-gray-100">Setlist Manager</h2>
      <p className="mt-1 text-sm text-gray-400">Add songs you can perform so incoming requests can be highlighted.</p>

      <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={addSong}>
        <input className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100" placeholder="Title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
        <input className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100" placeholder="Artist" value={draft.artist} onChange={(event) => setDraft((current) => ({ ...current, artist: event.target.value }))} />
        <input className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100" placeholder="JamZone Song ID" value={draft.jamzone_song_id} onChange={(event) => setDraft((current) => ({ ...current, jamzone_song_id: event.target.value }))} />
        <input className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100" placeholder="Key" value={draft.key} onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))} />
        <input className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100" placeholder="BPM" value={draft.bpm} onChange={(event) => setDraft((current) => ({ ...current, bpm: event.target.value }))} />
        <input className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100" placeholder="Notes" value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} />
        <button type="submit" className="md:col-span-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500">
          Add to setlist
        </button>
      </form>

      <ul className="mt-5 space-y-2">
        {sortedSongs.map((song) => (
          <li key={song.id} className="flex items-start justify-between gap-3 rounded-lg border border-purple-400/15 bg-gray-950/80 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-100">{song.title} · {song.artist}</p>
              <p className="truncate text-xs text-gray-400">
                {song.key || 'No key'} · {song.bpm || 'No BPM'} · {song.jamzone_song_id || 'No JamZone ID'}
              </p>
              {song.notes ? <p className="mt-1 text-xs text-gray-300">{song.notes}</p> : null}
            </div>
            <button
              type="button"
              className="rounded-md border border-red-400/40 px-2 py-1 text-xs text-red-200 hover:bg-red-500/15"
              onClick={() => removeSong(song.id)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
