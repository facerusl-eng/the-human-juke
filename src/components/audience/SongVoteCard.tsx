import { memo, useCallback, useMemo } from 'react'
import type { QueueSong } from '../../state/queueStore'

type SongVoteCardProps = {
  song: QueueSong
  rank: number
  hottestVoteCount: number
  votePulseTick: number
  moveTick: number
  isVoting?: boolean
  disabled: boolean
  onVote: (songId: string) => Promise<void>
  normalizeCoverUrl: (coverUrl: string | null | undefined) => string | null
}

function SongVoteCard({
  song,
  rank,
  hottestVoteCount,
  votePulseTick,
  moveTick,
  isVoting = false,
  disabled,
  onVote,
  normalizeCoverUrl,
}: SongVoteCardProps) {
  const voteHeatPercent = useMemo(() => (
    hottestVoteCount > 0
      ? Math.round((song.votes_count / hottestVoteCount) * 100)
      : 0
  ), [hottestVoteCount, song.votes_count])

  const onVoteClick = useCallback(() => {
    void onVote(song.id)
  }, [onVote, song.id])

  return (
    <li className={`audience-song-card ${moveTick > 0 ? 'song-card-move' : ''}`}>
      <div className="audience-song-card-head">
        <span className="queue-rank-chip" aria-label={`Rank ${rank}`}>
          #{rank}
        </span>
        <div className="queue-song-main audience-song-main">
          {song.cover_url ? (
            <img
              src={normalizeCoverUrl(song.cover_url) ?? song.cover_url}
              alt={`Cover art for ${song.title}`}
              className="song-cover"
            />
          ) : <span className="song-cover song-cover-fallback" aria-hidden="true">♪</span>}
          <div>
            <p className="song">{song.title}</p>
            <p className="artist">
              {song.artist}
              {song.audience_sings ? <span className="karaoke-tag"> - Karaoke</span> : ''}
              {song.is_explicit ? ' - Explicit' : ''}
              {song.voting_locked ? ' - Voting Locked' : ''}
            </p>
          </div>
        </div>
      </div>

      <progress
        className="vote-heat-track"
        value={voteHeatPercent}
        max={100}
        aria-label={`Vote momentum ${voteHeatPercent}%`}
      />

      <div className="queue-actions audience-song-actions">
        <button
          type="button"
          className="secondary-button tap-vote like-vote audience-vote-button"
          onClick={onVoteClick}
          disabled={disabled}
          aria-busy={isVoting}
          aria-label={`Vote for ${song.title} by ${song.artist}`}
        >
          {isVoting ? 'Voting...' : 'Vote'}
        </button>
        <span
          key={`votes-${song.id}-${votePulseTick}`}
          className={`votes ${(votePulseTick > 0) ? 'votes-pulse' : ''}`}
          aria-label={`${song.votes_count} votes`}
        >
          {song.votes_count} votes
        </span>
      </div>
    </li>
  )
}

export default memo(SongVoteCard)
