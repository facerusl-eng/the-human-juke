import { Zap } from 'lucide-react'
import type { PerformerQueueSong, SetlistMatch } from '../../lib/performerTypes'

type QueueListProps = {
  songs: PerformerQueueSong[]
  matchMap: Map<string, SetlistMatch>
  onJamzone: (song: PerformerQueueSong, match: SetlistMatch | null) => void
}

export default function QueueList({ songs, matchMap, onJamzone }: QueueListProps) {
  if (songs.length === 0) {
    return (
      <section className="rounded-2xl border border-purple-400/20 bg-gray-900/70 p-4">
        <p className="text-sm text-gray-300">No queued song requests right now.</p>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-purple-400/20 bg-gray-900/75">
      <header className="grid grid-cols-[auto,1fr,auto] items-center gap-3 border-b border-purple-400/20 px-4 py-3 text-xs uppercase tracking-wide text-purple-300">
        <span>Votes</span>
        <span>Queue</span>
        <span>JamZone</span>
      </header>
      <ul>
        {songs.map((song) => {
          const match = matchMap.get(song.id) ?? null

          return (
            <li key={song.id} className="grid grid-cols-[auto,1fr,auto] items-center gap-3 border-b border-purple-400/10 px-4 py-3 last:border-b-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-500/15 text-sm font-semibold text-purple-100">
                {song.votes}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-100">{song.title}</p>
                <p className="truncate text-xs text-gray-400">{song.artist} · requested by {song.requested_by}</p>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  {match ? (
                    <span className="inline-flex items-center rounded-full border border-emerald-400/50 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
                      ● setlist match
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-gray-500/40 bg-gray-600/10 px-2 py-0.5 text-gray-300">
                      ○ no match
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-yellow-300/50 bg-yellow-400/10 p-2 text-yellow-200 transition hover:bg-yellow-400/20"
                aria-label={`Open JamZone details for ${song.title}`}
                onClick={() => onJamzone(song, match)}
              >
                <Zap size={16} />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
