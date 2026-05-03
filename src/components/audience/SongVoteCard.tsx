import { memo, useCallback, useMemo, useState } from 'react'
import type { QueueSong } from '../../state/queueStore'
import { IconButton, PrimaryButton } from '../ui'

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

  const [showInfo, setShowInfo] = useState(false)

  return (
    <li className={`audience-song-card queue-slide-in ${moveTick > 0 ? 'song-card-move' : ''}`}>
      {showInfo && (
        <div
          className="song-info-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`Info for ${song.title}`}
          onClick={() => setShowInfo(false)}
        >
          <div className="song-info-sheet" onClick={(e) => e.stopPropagation()}>
            {song.cover_url ? (
              <img
                src={normalizeCoverUrl(song.cover_url) ?? song.cover_url}
                alt={`Cover art for ${song.title}`}
                className="song-info-cover"
              />
            ) : (
              <span className="song-info-cover song-info-cover-fallback" aria-hidden="true">♪</span>
            )}
            <h3 className="song-info-title">{song.title}</h3>
            <p className="song-info-artist">{song.artist}</p>
            <div className="song-info-badges">
              {song.audience_sings && <span className="song-info-badge song-info-badge-karaoke">🎤 Karaoke</span>}
              {song.is_explicit && <span className="song-info-badge song-info-badge-explicit">🅴 Explicit</span>}
              {song.voting_locked && <span className="song-info-badge song-info-badge-locked">🔒 Voting Locked</span>}
            </div>
            {song.createdByName && (
              <p className="song-info-chosen-by">♡ Requested by {song.createdByName}</p>
            )}
            <p className="song-info-votes">{song.votes_count} {song.votes_count === 1 ? 'vote' : 'votes'}</p>
            <PrimaryButton type="button" className="song-info-close" onClick={() => setShowInfo(false)}>
              Close
            </PrimaryButton>
          </div>
        </div>
      )}
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
            {song.createdByName ? (
              <p className="audience-song-chosen-by">♡ {song.createdByName}</p>
            ) : null}
          </div>
        </div>
        <IconButton icon="ⓘ" label={`More info about ${song.title}`} className="song-info-trigger" onClick={() => setShowInfo(true)} />
      </div>

      <progress
        className="vote-heat-track"
        value={voteHeatPercent}
        max={100}
        aria-label={`Vote momentum ${voteHeatPercent}%`}
      />

      <div className="queue-actions audience-song-actions">
        <PrimaryButton
          className="secondary-button tap-vote like-vote audience-vote-button"
          variant="secondary"
          onClick={onVoteClick}
          disabled={disabled}
          aria-busy={isVoting}
          aria-label={`Vote for ${song.title} by ${song.artist}`}
        >
          {isVoting ? 'Voting…' : '❤️ Vote'}
        </PrimaryButton>
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
