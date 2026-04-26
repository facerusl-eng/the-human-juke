export const BETWEEN_SONG_QUOTES = [
  'Don\'t wander off — the next song might be your favourite by accident.',
  'Stay close. Things are just starting to get questionable.',
  'Don\'t leave now — the night is finally warming up.',
  'Stick around. I promise to behave... mostly.',
  'Don\'t go far — the next song might be dangerously good.',
  'Stay here. It gets funnier when you\'re watching.',
  'Don\'t disappear — I\'m about to impress someone. Maybe you.',
  'Stay put. The chaos resumes shortly.',
  'Don\'t leave — I haven\'t peaked yet.',
  'Stay close. The next song has potential. I think.',
  'Don\'t run away — I can see you, you know.',
  'Stay here. The night is young. Unlike us.',
  'Don\'t go — the next song might redeem everything.',
  'Stay nearby. Things are about to get mildly epic.',
  'Don\'t leave — I\'m funnier when you\'re here.',
  'Stay put. Your seat is emotionally attached to you.',
  'Don\'t wander — the next tune is legally required to be good.',
  'Stay here. I\'m about to make questionable choices.',
  'Don\'t go — I\'m finally warmed up.',
  'Stay close. The next song slaps. Gently.',
  'Don\'t leave — the vibe is fragile.',
  'Stay here. I promise not to sing in Icelandic. Probably.',
  'Don\'t go — the next song is 14% better.',
  'Stay put. I\'m about to do something impressive or stupid.',
  'Don\'t wander — the fun part is loading.',
  'Stay close. I need witnesses.',
  'Don\'t leave — the next song is your destiny.',
  'Stay here. The night is getting spicy.',
  'Don\'t go — I\'m about to hit a high note. Maybe.',
  'Stay put. The next singer might be unforgettable.',
  'Don\'t wander — the plot thickens.',
  'Stay here. The next song is a certified maybe-banger.',
  'Don\'t leave — I\'m emotionally fragile.',
  'Stay close. The next tune is legally fun.',
  'Don\'t go — I haven\'t embarrassed myself enough yet.',
  'Stay here. The next song might change your life. Or not.',
  'Don\'t wander — the night is getting interesting.',
  'Stay put. I\'m about to attempt talent.',
  'Don\'t leave — the next song is surprisingly decent.',
  'Stay close. Things escalate from here.',
  'Don\'t go — I\'m funnier when you\'re watching.',
  'Stay here. The next singer might be a legend.',
  'Don\'t wander — the next song is dangerously catchy.',
  'Stay put. I\'m about to do something musical.',
  'Don\'t leave — the night is still cooking.',
  'Stay close. The next tune has good intentions.',
  'Don\'t go — I\'m finally getting into it.',
  'Stay here. The next song is a vibe. Probably.',
  'Don\'t wander — the fun is just starting to misbehave.',
  'Stay put. The next moment might be the best one.',
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