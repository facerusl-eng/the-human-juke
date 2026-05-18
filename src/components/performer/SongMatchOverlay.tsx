import type { JamZoneOverlayResult } from '../../lib/performerApi'
import type { PerformerQueueSong, SetlistMatch } from '../../lib/performerTypes'

type SongMatchOverlayProps = {
  song: PerformerQueueSong
  match: SetlistMatch | null
  jamzone: JamZoneOverlayResult | null
  onClose: () => void
}

export default function SongMatchOverlay({ song, match, jamzone, onClose }: SongMatchOverlayProps) {
  const jamzoneDetails = jamzone?.details

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4">
      <section className="w-full max-w-xl rounded-2xl border border-purple-300/40 bg-gray-950 p-6 shadow-2xl shadow-purple-950/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-purple-300">Song overlay</p>
            <h2 className="mt-2 text-2xl font-semibold text-gray-50">{song.title}</h2>
            <p className="text-sm text-gray-300">{song.artist}</p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-gray-700 px-3 py-1 text-sm text-gray-200 hover:bg-gray-800"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-3 rounded-xl border border-purple-400/20 bg-gray-900/70 p-4 text-sm text-gray-200">
          <p><span className="text-gray-400">Requester:</span> {song.requested_by}</p>
          <p><span className="text-gray-400">Votes:</span> {song.votes}</p>
          <p><span className="text-gray-400">Status:</span> {song.status}</p>
          <p><span className="text-gray-400">Key:</span> {String(jamzoneDetails?.key ?? match?.song.key ?? '—')}</p>
          <p><span className="text-gray-400">BPM:</span> {String(jamzoneDetails?.bpm ?? match?.song.bpm ?? '—')}</p>
          <p><span className="text-gray-400">Notes:</span> {jamzoneDetails?.notes ?? match?.song.notes ?? 'No notes yet.'}</p>
          {jamzone ? (
            <p className={jamzone.ok ? 'text-emerald-300' : 'text-amber-300'}>{jamzone.message}</p>
          ) : null}
        </div>
      </section>
    </div>
  )
}
