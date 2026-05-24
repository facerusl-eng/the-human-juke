export const BETWEEN_SONG_QUOTES = [
  'Remain calm. The next number has been approved by a committee of poor decisions.',
  'Do stay. I am moments away from either brilliance or a formal apology.',
  'Nobody panic, the entertainment is simply changing hats.',
  'Please hold your position. The next tune is almost suspiciously competent.',
  'Stay exactly where you are. Running now would look terribly dramatic.',
  'The next song is loading at the speed of British rail optimism.',
  'Do not leave the premises. I am finally approaching the funny bit.',
  'Remain seated. The next performer has confidence, which is half the battle.',
  'Stay close. The chaos has a clipboard and a vague plan.',
  'This interval is sponsored by questionable confidence and glitter.',
  'Do not wander off. I have nearly located the chorus.',
  'Stick around. The next track is emotionally available and rhythmically unstable.',
  'Stay put. Your pint and this playlist are in a committed relationship.',
  'The next tune is about to arrive with absolutely no sense of shame.',
  'Kindly remain. I am one key change away from glory.',
  'Do not go. Witnesses are required for what happens next.',
  'Stay with me. I am approaching peak nonsense.',
  'Remain in the building. The next singer has rehearsed optimism.',
  'Please hold. The vibe is being adjusted with a small spanner.',
  'Do not flee. The next song is at least 17% better than the last one.',
  'Stay nearby. I am pretending this is all under control.',
  'Keep your seat warm. The next tune has opinions.',
  'Do stay. I have excellent intentions and mixed results.',
  'Remain available for applause, gasps, and polite concern.',
  'Stay put. The next chorus may solve nothing, but loudly.',
  'Do not leave now. I have nearly reached the bit people film.',
  'Hold tight. The playlist is entering its confident era.',
  'Please remain. The next song is either iconic or educational.',
  'Stay where you are. I am about to commit to a very bold note.',
  'Do stay. The next act has charisma and no brakes.',
  'Remain calm. The beat is coming round the corner with a grin.',
  'Stay in formation. The next track is cheeky and fully hydrated.',
  'Do not wander. I have only just begun to be ridiculous.',
  'Stay close. The next tune has a strong opening argument.',
  'Please remain seated for the musical equivalent of a raised eyebrow.',
  'Do not disappear. The next song has paperwork and ambition.',
  'Remain in place. I am transitioning from decent to dangerous.',
  'Stay put. The next performer has brought both audacity and reverb.',
  'Do stay. I am now operating at professional mischief levels.',
  'Hold position. The next chorus has been lightly buttered for comfort.',
  'Stay nearby. The drama is purely melodic and mostly legal.',
  'Do not leave. The next song has excellent posture and bad intentions.',
  'Remain with me. I am one drum fill away from headlines.',
  'Stay put. The next number is very sure of itself.',
  'Do stay. I have reached the stage of the night where everything sounds clever.',
  'Please remain. The next tune arrives with confidence and no supervision.',
  'Stay close. I am about to do something musically irresponsible.',
  'Do not wander off. The next bit is where the eyebrows go up.',
  'Remain calm. The tempo is rising and so are expectations.',
  'Stay exactly there. The next song is a certified crowd persuader.',
]

import { supabase } from './supabase'
import type { AudienceLocale } from './audienceIdentity'
import { readFromLocalStorage, saveToLocalStorage } from './saveHandling'

export const PLAYBACK_STATE_EVENT = 'human-jukebox:playback-state'
export const PLAYBACK_STATE_STORAGE_KEY = 'human-jukebox:playback-state-sync'
export const PLAYBACK_STATE_BROADCAST_CHANNEL = 'human-jukebox:playback-state'
export const LAST_SONG_SOON_OVERLAY_MESSAGE = 'Last song is coming soon. New song requests are now closed. Vote in the live feed if you want an extra number (encore), and keep voting on songs already in the queue.'
export const LAST_SONG_SOON_OVERLAY_MESSAGE_DA = 'Aftenens sidste sang kommer snart. Nye sangønsker er nu lukket. Stem i livefeedet, hvis du vil have et ekstranummer, og stem videre på sangene i køen.'
export const LAST_SONG_SOON_OVERLAY_MESSAGE_IS = 'Síðasta lag kvöldsins kemur bráðum. Nýjar lagabeiðnir eru nú lokaðar. Kjósið í live-feedinu ef þið viljið aukalag, og haldið áfram að kjósa lögin í röðinni.'

const LEGACY_LAST_SONG_SOON_OVERLAY_MESSAGES = [
  'The final song is coming up next. New song requests are now closed. You can still enjoy the live feed and vote on songs already in the queue to improve their chance of being played before the show ends.',
  'Aftenens sidste sang kommer lige om lidt. Nye sangønsker er nu lukket. Du kan stadig nyde live-feedet og stemme på sange i køen for at øge chancen for, at de bliver spillet, før showet slutter.',
  'Síðasta lag kvöldsins er að hefjast. Nýjar lagabeiðnir eru nú lokaðar. Þú getur samt notið live-feedins og kosið lög í röðinni til að auka líkurnar á að þau verði spiluð áður en sýningunni lýkur.',
  'Last song coming up soon. Get your final request in now!',
]

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PLAYBACK_PERMISSION_WARNING_INTERVAL_MS = 30000
const playbackPermissionWarningAtByEventId = new Map<string, number>()

export type SharedPlaybackState = {
  currentSongId: string | null
  currentSongCoverUrl: string | null
  isStarted: boolean
  quoteIndex: number
  countdownTargetMs?: number | null
  brbActive?: boolean
  brbMessage?: string | null
}

export function getLastSongSoonAudienceMessage(locale: AudienceLocale) {
  if (locale === 'da') {
    return LAST_SONG_SOON_OVERLAY_MESSAGE_DA
  }

  if (locale === 'is') {
    return LAST_SONG_SOON_OVERLAY_MESSAGE_IS
  }

  return LAST_SONG_SOON_OVERLAY_MESSAGE
}

function normalizeOverlayMessage(message: string | null | undefined) {
  return (message ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function isLastSongSoonOverlayMessage(message: string | null | undefined) {
  const normalizedMessage = normalizeOverlayMessage(message)

  if (!normalizedMessage) {
    return false
  }

  const knownMessages = [
    LAST_SONG_SOON_OVERLAY_MESSAGE,
    LAST_SONG_SOON_OVERLAY_MESSAGE_DA,
    LAST_SONG_SOON_OVERLAY_MESSAGE_IS,
    ...LEGACY_LAST_SONG_SOON_OVERLAY_MESSAGES,
  ]

  return knownMessages
    .map((entry) => normalizeOverlayMessage(entry))
    .includes(normalizedMessage)
}

export function isLastSongSoonPlaybackState(state: SharedPlaybackState | null | undefined) {
  return isLastSongSoonOverlayMessage(state?.brbMessage)
}

export function isCountdownTargetActive(targetMs: number | null | undefined, nowMs = Date.now()) {
  return typeof targetMs === 'number' && Number.isFinite(targetMs) && targetMs > nowMs
}

export function getCountdownTargetRemainingMs(targetMs: number | null | undefined, nowMs = Date.now()) {
  if (!isCountdownTargetActive(targetMs, nowMs)) {
    return null
  }

  return (targetMs as number) - nowMs
}

function resolvePreferredCountdownTargetMs(
  remoteTargetMs: number | null,
  localFallbackTargetMs: number | null,
  nowMs = Date.now(),
) {
  const remoteActive = isCountdownTargetActive(remoteTargetMs, nowMs)
  const localActive = isCountdownTargetActive(localFallbackTargetMs, nowMs)

  if (!remoteActive) {
    return localActive ? localFallbackTargetMs : remoteTargetMs
  }

  if (!localActive) {
    return remoteTargetMs
  }

  const remoteRemainingMs = getCountdownTargetRemainingMs(remoteTargetMs, nowMs)
  const localRemainingMs = getCountdownTargetRemainingMs(localFallbackTargetMs, nowMs)

  if (remoteRemainingMs === null || localRemainingMs === null) {
    return remoteTargetMs
  }

  // If local fallback is meaningfully sooner, treat it as the active override.
  if (localRemainingMs + 60_000 < remoteRemainingMs) {
    return localFallbackTargetMs
  }

  return remoteTargetMs
}

type SharedPlaybackStateMessage = {
  eventId: string
  state: SharedPlaybackState
  timestamp: number
}

function isMissingPlaybackBrbColumnsError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const normalizedError = error as {
    message?: unknown
    details?: unknown
    hint?: unknown
  }

  const text = [normalizedError.message, normalizedError.details, normalizedError.hint]
    .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''))
    .join(' ')

  return text.includes('brb_active') || text.includes('brb_message')
}

function isMissingPlaybackCountdownColumnError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const normalizedError = error as {
    message?: unknown
    details?: unknown
    hint?: unknown
  }

  const text = [normalizedError.message, normalizedError.details, normalizedError.hint]
    .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''))
    .join(' ')

  return text.includes('countdown_target_ms')
}

function isPlaybackPermissionError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const normalizedError = error as {
    code?: unknown
    message?: unknown
    details?: unknown
    hint?: unknown
    status?: unknown
  }

  const code = typeof normalizedError.code === 'string' ? normalizedError.code.toUpperCase() : ''
  const status = typeof normalizedError.status === 'number' ? normalizedError.status : null
  const text = [normalizedError.message, normalizedError.details, normalizedError.hint]
    .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''))
    .join(' ')

  return code === '42501'
    || code === 'PGRST301'
    || status === 401
    || status === 403
    || text.includes('row-level security')
    || text.includes('permission denied')
}

export function normalizeCountdownTargetMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value)
  }

  if (typeof value === 'string' && value.trim()) {
    const parsedValue = Number(value)
    if (Number.isFinite(parsedValue)) {
      return Math.round(parsedValue)
    }
  }

  return null
}

function readLastBroadcastPlaybackState(eventId: string): SharedPlaybackState | null {
  const cachedMessage = readFromLocalStorage<{ eventId?: string; state?: SharedPlaybackState } | null>(
    PLAYBACK_STATE_STORAGE_KEY,
    null,
  )

  if (!cachedMessage || cachedMessage.eventId !== eventId || !cachedMessage.state) {
    return null
  }

  return cachedMessage.state
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

function isUuidLikeEventId(eventId: string) {
  return UUID_PATTERN.test(eventId.trim())
}

export async function readSharedPlaybackState(eventId: string): Promise<SharedPlaybackState | null> {
  if (!isUuidLikeEventId(eventId)) {
    return null
  }

  try {
    const selectWithCountdownAndBrb = 'current_song_id, current_song_cover_url, is_started, quote_index, countdown_target_ms, brb_active, brb_message'
    const selectWithBrb = 'current_song_id, current_song_cover_url, is_started, quote_index, brb_active, brb_message'
    const selectLegacy = 'current_song_id, current_song_cover_url, is_started, quote_index'

    let data: Record<string, unknown> | null = null
    let error: { code?: string; message?: string } | null = null

    const initialRead = await supabase
      .from('playback_state')
      .select(selectWithCountdownAndBrb)
      .eq('event_id', eventId)
      .single()

    data = (initialRead.data as Record<string, unknown> | null) ?? null
    error = initialRead.error as { code?: string; message?: string } | null

    if (error && isMissingPlaybackCountdownColumnError(error)) {
      const withoutCountdownRead = await supabase
        .from('playback_state')
        .select(selectWithBrb)
        .eq('event_id', eventId)
        .single()

      data = (withoutCountdownRead.data as Record<string, unknown> | null) ?? null
      error = withoutCountdownRead.error as { code?: string; message?: string } | null
    }

    if (error && isMissingPlaybackBrbColumnsError(error)) {
      const legacyRead = await supabase
        .from('playback_state')
        .select(selectLegacy)
        .eq('event_id', eventId)
        .single()

      data = (legacyRead.data as Record<string, unknown> | null) ?? null
      error = legacyRead.error as { code?: string; message?: string } | null
    }

    if (error) {
      if (isPlaybackPermissionError(error)) {
        return readLastBroadcastPlaybackState(eventId)
      }

      if (error.code === 'PGRST116') {
        return readLastBroadcastPlaybackState(eventId)
      }

      console.warn('playbackState: read failed', {
        eventId,
        code: error.code,
        message: error.message,
      })
      return null
    }

    if (!data) {
      return readLastBroadcastPlaybackState(eventId)
    }

    const row = data as {
      current_song_id?: string | null
      current_song_cover_url?: string | null
      is_started?: boolean | null
      quote_index?: number | null
      countdown_target_ms?: number | string | null
      brb_active?: boolean | null
      brb_message?: string | null
    }
    const normalizedQuoteIndex = typeof row.quote_index === 'number' ? row.quote_index : 0
    const rowCountdownTargetMs = normalizeCountdownTargetMs(row.countdown_target_ms)
    const localFallbackState = readLastBroadcastPlaybackState(eventId)
    const localFallbackCountdownTargetMs = normalizeCountdownTargetMs(localFallbackState?.countdownTargetMs)
    const resolvedCountdownTargetMs = resolvePreferredCountdownTargetMs(
      rowCountdownTargetMs,
      localFallbackCountdownTargetMs,
    )

    return {
      currentSongId: row.current_song_id ?? null,
      currentSongCoverUrl: row.current_song_cover_url ?? null,
      isStarted: row.is_started ?? false,
      quoteIndex: normalizedQuoteIndex,
      countdownTargetMs: resolvedCountdownTargetMs,
      brbActive: row.brb_active ?? false,
      brbMessage: row.brb_message ?? null,
    }
  } catch (error) {
    console.warn('playbackState: unexpected read error', { eventId, error })
    return null
  }
}

export async function writeSharedPlaybackState(eventId: string, state: SharedPlaybackState): Promise<boolean> {
  try {
    const normalizedQuoteIndex = Number.isFinite(state.quoteIndex) ? state.quoteIndex : 0
    const previousState = readLastBroadcastPlaybackState(eventId)
    const normalizedBrbActive = typeof state.brbActive === 'boolean'
      ? state.brbActive
      : (previousState?.brbActive ?? false)

    let normalizedBrbMessage: string | null
    if (typeof state.brbMessage === 'string' || state.brbMessage === null) {
      normalizedBrbMessage = state.brbMessage
    } else if (typeof state.brbActive === 'boolean' && !state.brbActive) {
      normalizedBrbMessage = null
    } else {
      normalizedBrbMessage = previousState?.brbMessage ?? null
    }

    if (typeof normalizedBrbMessage === 'string') {
      const trimmedBrbMessage = normalizedBrbMessage.trim()
      normalizedBrbMessage = trimmedBrbMessage.length > 0 ? trimmedBrbMessage : null
    }

    const normalizedState: SharedPlaybackState = {
      currentSongId: state.currentSongId,
      currentSongCoverUrl: state.currentSongCoverUrl,
      isStarted: state.isStarted,
      quoteIndex: normalizedQuoteIndex,
      countdownTargetMs: normalizeCountdownTargetMs(state.countdownTargetMs),
      brbActive: normalizedBrbActive,
      brbMessage: normalizedBrbMessage,
    }

    // Push update immediately to other local tabs/screens before network roundtrip.
    broadcastPlaybackState({
      eventId,
      state: normalizedState,
      timestamp: Date.now(),
    })

    if (!isUuidLikeEventId(eventId)) {
      return true
    }

    const withBrbPayload = {
      event_id: eventId,
      current_song_id: normalizedState.currentSongId,
      current_song_cover_url: normalizedState.currentSongCoverUrl,
      is_started: normalizedState.isStarted,
      quote_index: normalizedQuoteIndex,
      countdown_target_ms: normalizedState.countdownTargetMs,
      brb_active: normalizedState.brbActive ?? false,
      brb_message: normalizedState.brbMessage ?? null,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from('playback_state')
      .upsert(withBrbPayload, { onConflict: 'event_id' })

    if (error && (isMissingPlaybackBrbColumnsError(error) || isMissingPlaybackCountdownColumnError(error))) {
      const { error: legacyWriteError } = await supabase
        .from('playback_state')
        .upsert({
          event_id: eventId,
          current_song_id: normalizedState.currentSongId,
          current_song_cover_url: normalizedState.currentSongCoverUrl,
          is_started: normalizedState.isStarted,
          quote_index: normalizedQuoteIndex,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'event_id' })

      if (legacyWriteError) {
        console.error('Failed to write playback state:', legacyWriteError)
        return false
      }

      return true
    }

    if (error) {
      if (isPlaybackPermissionError(error)) {
        // Local event/storage/broadcast sync is already published above.
        // Treat permission-denied remote writes as non-fatal for same-browser sync.
        const nowMs = Date.now()
        const lastWarningAt = playbackPermissionWarningAtByEventId.get(eventId) ?? 0

        if (nowMs - lastWarningAt >= PLAYBACK_PERMISSION_WARNING_INTERVAL_MS) {
          playbackPermissionWarningAtByEventId.set(eventId, nowMs)
          console.warn('playbackState: remote write blocked, using local sync fallback', {
            eventId,
            code: (error as { code?: string }).code,
          })
        }

        return true
      }

      console.error('Failed to write playback state:', error)
      return false
    }

    return true
  } catch (err) {
    console.error('Error writing playback state:', err)
    return false
  }
}