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

/**
 * Real facts about "Take On Me" by a-ha, shown in the song fact panel
 * on the mirror screen in demo mode.
 */
export const DEMO_NOW_PLAYING_FACTS: string[] = [
  'Take On Me was recorded three times before it finally charted — the band kept re-recording it until it was right.',
  'The iconic pencil-sketch music video took 16 weeks and over 3,000 individual drawings to create.',
  'Released in 1985, it reached #1 in the UK, Norway, and the United States.',
  'The synthesiser riff was written by Magne Furuholmen (Mags) and became one of the most recognised in pop history.',
  'The song\'s falsetto chorus reaches up to a C#5 — one of the most demanding notes in mainstream pop of the era.',
  'The original 1985 video has over 1.5 billion views on YouTube.',
  'a-ha are from Oslo, Norway — making this one of the biggest international hits ever by a Scandinavian act.',
]
