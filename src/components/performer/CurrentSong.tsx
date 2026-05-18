import type { PerformerQueueSong, SetlistMatch } from '../../lib/performerTypes'

type CurrentSongProps = {
  song: PerformerQueueSong | null
  match: SetlistMatch | null
}

export default function CurrentSong({ song, match }: CurrentSongProps) {
  if (!song) {
    return (
      <section className="rounded-2xl border border-purple-400/25 bg-gray-900/80 p-5 shadow-lg shadow-purple-950/30">
        <p className="text-xs uppercase tracking-wide text-purple-300">Now Playing</p>
        <h2 className="mt-2 text-xl font-semibold text-gray-100">No song is currently marked as playing.</h2>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-purple-400/40 bg-gray-900/90 p-5 shadow-lg shadow-purple-950/30">
      <p className="text-xs uppercase tracking-wide text-purple-300">Now Playing</p>
      <h2 className="mt-2 text-2xl font-semibold text-gray-50">{song.title}</h2>
      <p className="mt-1 text-sm text-gray-300">{song.artist}</p>
      <div className="mt-4 grid gap-2 text-sm text-gray-200 md:grid-cols-3">
        <p><span className="text-gray-400">Requester:</span> {song.requested_by}</p>
        <p><span className="text-gray-400">Votes:</span> {song.votes}</p>
        <p><span className="text-gray-400">Queue #:</span> {song.position}</p>
      </div>
      {match ? (
        <p className="mt-3 inline-flex rounded-full border border-emerald-400/50 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200">
          Setlist match ({Math.round(match.confidence * 100)}%)
        </p>
      ) : null}
    </section>
  )
}
