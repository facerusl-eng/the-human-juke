import type { QueueSong } from '../state/queueStore'

/**
 * Fake "now playing" song for Demo Mode.
 * This is the song that appears at the top of the queue / mirror screen.
 */
export const DEMO_NOW_PLAYING: QueueSong = {
  id: 'demo-now-playing-001',
  event_id: 'demo-event-001',
  title: 'Take On Me',
  artist: 'a-ha',
  votes_count: 12,
  is_explicit: false,
  voting_locked: true,
  is_removed: false,
  cover_url: '/the-human-jukebox-logo.png',
  library_song_id: null,
  audience_sings: false,
  position: 0,
  createdByName: 'Jakob N.',
}
