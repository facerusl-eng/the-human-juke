import type { PerformerQueueSong, SetlistMatch } from '../../lib/performerTypes'

type NextUpCardProps = {
  song: PerformerQueueSong | null
  match: SetlistMatch | null
}

export default function NextUpCard({ song, match }: NextUpCardProps) {
  return (
    <section className="rounded-2xl border border-purple-400/20 bg-gray-900/70 p-4">
      <p className="text-xs uppercase tracking-wide text-purple-300">Next Up</p>
      {song ? (
        <>
          <h3 className="mt-2 text-lg font-semibold text-gray-100">{song.title}</h3>
          <p className="text-sm text-gray-300">{song.artist}</p>
          <p className="mt-2 text-xs text-gray-400">Requested by {song.requested_by} · {song.votes} votes</p>
          {match ? (
            <p className="mt-2 text-xs font-medium text-emerald-300">
              Ready in setlist ({Math.round(match.confidence * 100)}% match)
            </p>
          ) : (
            <p className="mt-2 text-xs text-amber-300">Not found in current setlist</p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-gray-400">Queue is empty.</p>
      )}
    </section>
  )
}
