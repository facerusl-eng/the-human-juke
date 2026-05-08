import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PropsWithChildren } from 'react'
import { QueueContext } from '../state/queueStore'
import type { QueueSong, PerformedSong } from '../state/queueStore'
import { DEMO_EVENT } from './demoEvent'
import { DEMO_INITIAL_QUEUE } from './demoQueue'
import { DEMO_NOW_PLAYING } from './demoNowPlaying'
import { batchFetchDemoArtwork } from './demoArtwork'

let _demoIdCounter = 1000
const DEMO_DEFAULT_COVER_URL = '/the-human-jukebox-logo.png'

type DemoAddSongOptions = {
  coverUrl?: string | null
  librarySongId?: string | null
  performerMode?: 'performer' | 'audience'
}

function generateDemoId() {
  _demoIdCounter += 1
  return `demo-user-song-${_demoIdCounter}`
}

/**
 * DemoQueueProvider — provides the same QueueContext as QueueProvider but
 * backed entirely by in-memory fake data.
 *
 * Audience-facing interactions (addSong, upvoteSong) are fully functional and
 * update in-memory state so the UI reflects realistic changes.
 *
 * Host-only operations (endGig, deleteEvent, updateEventSettings, etc.) are
 * no-ops because demo users are always guests.
 */
export function DemoQueueProvider({ children }: PropsWithChildren) {
  // Prepend the now-playing song so songs[0] becomes the active track.
  const [songs, setSongs] = useState<QueueSong[]>([DEMO_NOW_PLAYING, ...DEMO_INITIAL_QUEUE])
  const [performedSongs, setPerformedSongs] = useState<PerformedSong[]>([
    {
      id: 'demo-played-001',
      event_id: DEMO_EVENT.id,
      title: 'Dancing in the Moonlight',
      artist: 'Toploader',
      votes_count: 9,
      is_explicit: false,
      voting_locked: true,
      is_removed: false,
      cover_url: DEMO_DEFAULT_COVER_URL,
      library_song_id: null,
      audience_sings: false,
      position: 0,
      createdByName: 'Oliver R.',
      performedAt: '2026-05-04T20:15:00.000Z',
    },
    {
      id: 'demo-played-002',
      event_id: DEMO_EVENT.id,
      title: 'I Wanna Dance with Somebody',
      artist: 'Whitney Houston',
      votes_count: 8,
      is_explicit: false,
      voting_locked: true,
      is_removed: false,
      cover_url: DEMO_DEFAULT_COVER_URL,
      library_song_id: null,
      audience_sings: false,
      position: 0,
      createdByName: 'Emma T.',
      performedAt: '2026-05-04T19:58:00.000Z',
    },
    {
      id: 'demo-played-003',
      event_id: DEMO_EVENT.id,
      title: 'Shut Up and Dance',
      artist: 'WALK THE MOON',
      votes_count: 7,
      is_explicit: false,
      voting_locked: true,
      is_removed: false,
      cover_url: DEMO_DEFAULT_COVER_URL,
      library_song_id: null,
      audience_sings: false,
      position: 0,
      createdByName: 'Noah V.',
      performedAt: '2026-05-04T19:41:00.000Z',
    },
  ])
  const [votedSongIds] = useState(() => new Set<string>())

  // Fetch real album art from iTunes on mount and update cover URLs
  useEffect(() => {
    const allSongs = [DEMO_NOW_PLAYING, ...DEMO_INITIAL_QUEUE]
    void batchFetchDemoArtwork(allSongs).then((artworkMap) => {
      if (Object.keys(artworkMap).length === 0) return
      setSongs((current) =>
        current.map((song) =>
          artworkMap[song.id] ? { ...song, cover_url: artworkMap[song.id] } : song,
        ),
      )
    })
  }, [])

  useEffect(() => {
    void batchFetchDemoArtwork(performedSongs).then((artworkMap) => {
      if (Object.keys(artworkMap).length === 0) return
      setPerformedSongs((current) =>
        current.map((song) =>
          artworkMap[song.id] ? { ...song, cover_url: artworkMap[song.id] } : song,
        ),
      )
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Simulate live audience activity: bump a random queue song's votes every ~7 seconds
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSongs((current) => {
        const [nowPlaying, ...queue] = current
        if (queue.length === 0) return current
        const eligibleIndexes = queue
          .map((song, index) => ({ song, index }))
          .filter(({ song }) => !song.is_removed)
          .map(({ index }) => index)
        if (eligibleIndexes.length === 0) return current
        const pick = eligibleIndexes[Math.floor(Math.random() * eligibleIndexes.length)]
        const updatedQueue = queue.map((song, index) =>
          index === pick ? { ...song, votes_count: song.votes_count + 1 } : song,
        )
        const reRanked = [...updatedQueue]
          .sort((a, b) => {
            if (b.votes_count !== a.votes_count) return b.votes_count - a.votes_count
            const posA = typeof a.position === 'number' ? a.position : 999
            const posB = typeof b.position === 'number' ? b.position : 999
            return posA - posB
          })
          .map((song, i) => ({ ...song, position: i + 1 }))
        return nowPlaying ? [{ ...nowPlaying, position: 0 }, ...reRanked] : reRanked
      })
    }, 7000)
    return () => window.clearInterval(timer)
  }, [])

  const addSong = useCallback(async (title: string, artist: string, isExplicit: boolean, options?: DemoAddSongOptions) => {
    // Enforce total queue size cap
    if (DEMO_EVENT.maxQueueSize != null) {
      const activeCount = songs.filter((s) => !s.is_removed).length
      if (activeCount >= DEMO_EVENT.maxQueueSize) {
        throw new Error(`The queue is full — only ${DEMO_EVENT.maxQueueSize} songs allowed at a time.`)
      }
    }

    const newSong: QueueSong = {
      id: generateDemoId(),
      event_id: DEMO_EVENT.id,
      title: title.trim() || 'Untitled',
      artist: artist.trim() || 'Unknown Artist',
      votes_count: 0,
      is_explicit: isExplicit,
      voting_locked: false,
      is_removed: false,
      cover_url: options?.coverUrl ?? DEMO_DEFAULT_COVER_URL,
      library_song_id: options?.librarySongId ?? null,
      audience_sings: options?.performerMode === 'audience',
      position: songs.length,
      createdByName: 'You',
    }

    setSongs((current) => [...current, newSong])
  }, [songs])

  const upvoteSong = useCallback(async (songId: string) => {
    // Only allow one vote per song per demo session.
    if (votedSongIds.has(songId)) {
      return
    }

    votedSongIds.add(songId)

    setSongs((current) => {
      const [nowPlaying, ...queue] = current

      const withUpdatedVotes = queue.map((song) => (
        song.id === songId
          ? { ...song, votes_count: song.votes_count + 1 }
          : song
      ))

      const reRankedQueue = withUpdatedVotes
        .map((song, originalIndex) => ({ song, originalIndex }))
        .sort((left, right) => {
          if (right.song.votes_count !== left.song.votes_count) {
            return right.song.votes_count - left.song.votes_count
          }

          const leftWasVoted = left.song.id === songId
          const rightWasVoted = right.song.id === songId

          // If votes are tied, promote the song that was just voted for.
          if (leftWasVoted !== rightWasVoted) {
            return leftWasVoted ? -1 : 1
          }

          // Preserve prior order for ties so the list remains stable.
          return left.originalIndex - right.originalIndex
        })
        .map(({ song }, index) => ({ ...song, position: index + 1 }))

      if (!nowPlaying) {
        return reRankedQueue
      }

      return [{ ...nowPlaying, position: 0 }, ...reRankedQueue]
    })
  }, [votedSongIds])

  const noop = useCallback(async () => {
    // Intentional no-op for host-only operations not available in demo mode.
  }, [])

  const value = useMemo(
    () => ({
      event: { ...DEMO_EVENT },
      hostEvents: [],
      songs,
      performedSongs,
      loading: false,
      audienceConnectionStatus: 'connected' as const,
      pendingOfflineSongs: [],
      queueOperatingMode: 'normal' as const,
      queueHealthMessage: null,
      addSong,
      upvoteSong,
      // Host-only operations — silently no-op.
      setActiveEvent: noop,
      endGig: noop,
      deleteEvent: noop,
      updateEventSettings: noop,
      toggleRoomOpen: noop,
      toggleExplicitFilter: noop,
      toggleAudienceVoting: noop,
      setShowInAudienceNoGig: noop,
      setEventAudienceNoGigVisibility: noop,
      toggleVotingLock: noop,
      removeSong: noop,
      moveSong: noop,
      reorderSong: noop,
      createEvent: noop,
      markPlayed: noop,
      unmarkPlayed: noop,
    }),
    [songs, performedSongs, addSong, upvoteSong, noop],
  )

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>
}
