export const BETWEEN_SONG_QUOTES = [
  'Remain calm. The next number has been approved by a committee of poor decisions.',
  'Do stay. We are moments away from either brilliance or a formal apology.',
  'Nobody panic, the entertainment is simply changing hats.',
  'Please hold your position. The next tune is almost suspiciously competent.',
  'Stay exactly where you are. Running now would look terribly dramatic.',
  'The next song is loading at the speed of British rail optimism.',
  'Do not leave the premises. We are finally approaching the funny bit.',
  'Remain seated. The next performer has confidence, which is half the battle.',
  'Stay close. The chaos has a clipboard and a vague plan.',
  'This interval is sponsored by questionable confidence and glitter.',
  'Do not wander off. We have nearly located the chorus.',
  'Stick around. The next track is emotionally available and rhythmically unstable.',
  'Stay put. Your pint and this playlist are in a committed relationship.',
  'The next tune is about to arrive with absolutely no sense of shame.',
  'Kindly remain. We are one key change away from glory.',
  'Do not go. Witnesses are required for what happens next.',
  'Stay with us. We are approaching peak nonsense.',
  'Remain in the building. The next singer has rehearsed optimism.',
  'Please hold. The vibe is being adjusted with a small spanner.',
  'Do not flee. The next song is at least 17% better than the last one.',
  'Stay nearby. We are pretending this is all under control.',
  'Keep your seat warm. The next tune has opinions.',
  'Do stay. We have excellent intentions and mixed results.',
  'Remain available for applause, gasps, and polite concern.',
  'Stay put. The next chorus may solve nothing, but loudly.',
  'Do not leave now. We have nearly reached the bit people film.',
  'Hold tight. The playlist is entering its confident era.',
  'Please remain. The next song is either iconic or educational.',
  'Stay where you are. We are about to commit to a very bold note.',
  'Do stay. The next act has charisma and no brakes.',
  'Remain calm. The beat is coming round the corner with a grin.',
  'Stay in formation. The next track is cheeky and fully hydrated.',
  'Do not wander. We have only just begun to be ridiculous.',
  'Stay close. The next tune has a strong opening argument.',
  'Please remain seated for the musical equivalent of a raised eyebrow.',
  'Do not disappear. The next song has paperwork and ambition.',
  'Remain in place. We are transitioning from decent to dangerous.',
  'Stay put. The next performer has brought both audacity and reverb.',
  'Do stay. We are now operating at professional mischief levels.',
  'Hold position. The next chorus has been lightly buttered for comfort.',
  'Stay nearby. The drama is purely melodic and mostly legal.',
  'Do not leave. The next song has excellent posture and bad intentions.',
  'Remain with us. We are one drum fill away from headlines.',
  'Stay put. The next number is very sure of itself.',
  'Do stay. We have reached the stage of the night where everything sounds clever.',
  'Please remain. The next tune arrives with confidence and no supervision.',
  'Stay close. We are about to do something musically irresponsible.',
  'Do not wander off. The next bit is where the eyebrows go up.',
  'Remain calm. The tempo is rising and so are expectations.',
  'Stay exactly there. The next song is a certified crowd persuader.',
]

import { supabase } from './supabase'
import { saveToLocalStorage } from './saveHandling'

export const PLAYBACK_STATE_EVENT = 'human-jukebox:playback-state'
export const PLAYBACK_STATE_STORAGE_KEY = 'human-jukebox:playback-state-sync'
export const PLAYBACK_STATE_BROADCAST_CHANNEL = 'human-jukebox:playback-state'

export type SharedPlaybackState = {
  currentSongId: string | null
  currentSongCoverUrl: string | null
  isStarted: boolean
  quoteIndex: number
}

type SharedPlaybackStateMessage = {
  eventId: string
  state: SharedPlaybackState
  timestamp: number
}

function broadcastPlaybackState(message: SharedPlaybackStateMessage) {
  window.dispatchEvent(new CustomEvent(PLAYBACK_STATE_EVENT, { detail: message }))

  saveToLocalStorage(PLAYBACK_STATE_STORAGE_KEY, message)

  try {
    if ('BroadcastChannel' in window) {
      const channel = new BroadcastChannel(PLAYBACK_STATE_BROADCAST_CHANNEL)
      channel.postMessage(message)
      channel.close()
    }
  } catch {
    // Ignore BroadcastChannel support/runtime failures.
  }
}

export async function readSharedPlaybackState(eventId: string): Promise<SharedPlaybackState | null> {
  try {
    const { data, error } = await supabase
      .from('playback_state')
      .select('current_song_id, current_song_cover_url, is_started, quote_index')
      .eq('event_id', eventId)
      .single()

    if (error) {
      if (error.code !== 'PGRST116') {
        console.warn('playbackState: read failed', {
          eventId,
          code: error.code,
          message: error.message,
        })
      }
      return null
    }

    if (!data) {
      return null
    }

    const normalizedQuoteIndex = typeof data.quote_index === 'number' ? data.quote_index : 0

    return {
      currentSongId: data.current_song_id ?? null,
      currentSongCoverUrl: data.current_song_cover_url ?? null,
      isStarted: data.is_started ?? false,
      quoteIndex: normalizedQuoteIndex,
    }
  } catch (error) {
    console.warn('playbackState: unexpected read error', { eventId, error })
    return null
  }
}

export async function writeSharedPlaybackState(eventId: string, state: SharedPlaybackState): Promise<void> {
  try {
    const normalizedQuoteIndex = Number.isFinite(state.quoteIndex) ? state.quoteIndex : 0
    const normalizedState: SharedPlaybackState = {
      currentSongId: state.currentSongId,
      currentSongCoverUrl: state.currentSongCoverUrl,
      isStarted: state.isStarted,
      quoteIndex: normalizedQuoteIndex,
    }

    // Push update immediately to other local tabs/screens before network roundtrip.
    broadcastPlaybackState({
      eventId,
      state: normalizedState,
      timestamp: Date.now(),
    })

    const { error } = await supabase
      .from('playback_state')
      .upsert({
        event_id: eventId,
        current_song_id: normalizedState.currentSongId,
        current_song_cover_url: normalizedState.currentSongCoverUrl,
        is_started: normalizedState.isStarted,
        quote_index: normalizedQuoteIndex,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'event_id' })

    if (error) {
      console.error('Failed to write playback state:', error)
      return
    }
  } catch (err) {
    console.error('Error writing playback state:', err)
  }
}