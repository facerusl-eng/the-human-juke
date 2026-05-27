import { MirrorQrCode } from '../components/MirrorQrCode';

// Expanded QueueSong type for all referenced properties
type QueueSong = {
  id: string;
  title: string;
  artist: string;
  createdByName?: string;
  votes_count?: number;
  audience_sings?: boolean;
  cover_url?: string;
  creatorId?: string;
  is_explicit?: boolean;
};
// --- MISSING CONSTANTS FOR MIRROR PAGE ---
const AUTO_LIVE_WELCOME_MESSAGE = 'Welcome to the show!';
const MIRROR_FUN_FACTS_CACHE_STORAGE_KEY = 'mirror_fun_facts_cache';
const SONG_INFO_ROTATE_INTERVAL_MS = 10000;
const QUOTE_ROTATE_INTERVAL_MS = 10000;
const DEMO_NOW_PLAYING_FACTS: any[] = [];
const SPOTLIGHT_DURATION_MS = 5000;
const SPOTLIGHT_POLL_INTERVAL_MS = 10000;
const MIRROR_FUN_FACTS_CACHE_KEY = 'mirror_fun_facts_cache';
const resetOGTags = () => {};
const setGigOGTags = (
  name?: string,
  venue?: string | null,
  eventName?: string,
  _?: any,
  gigUrl?: string
) => {};
const getVenueLogoAppearanceClassName = (_: any) => '';
// Utility/component stubs for missing references
const handleFeedSpotlightInsert = (..._args: any[]) => {};

// --- STUBS FOR MISSING TYPES, CONSTANTS, AND HOOKS ---
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
const UUID_PATTERN = { test: (v: string) => /^[0-9a-fA-F-]{36}$/.test(v) };
const SONG_FACT_MAX_LENGTH = 120;
type NowPlayingInfoSong = { id: string; title: string; artist: string; cover_url?: string; is_explicit?: boolean; audience_sings?: boolean; createdByName?: string; votes_count?: number };
type MirrorVenueMode = 'club' | 'lounge' | 'festival';
type SharedPlaybackState = any;
type AudienceLocale = string;
type MirrorLayoutState = any;
type MirrorLayoutVisibilityState = any;
type MirrorLayoutPanelId = string;
type FeedImageSpotlight = any;
const DEFAULT_MIRROR_LAYOUT_STATE = {};
const DEFAULT_MIRROR_LAYOUT_VISIBILITY = {};
const MIRROR_LAYOUT_EDITOR_PREFS_KEY = 'mirror_layout_editor_prefs';
const MIRROR_LAYOUT_EDITOR_STORAGE_KEY = 'mirror_layout_editor_storage';
const MIRROR_HIGH_CONTRAST_STORAGE_KEY = 'mirror_high_contrast';
const MIRROR_SAFE_MARGINS_STORAGE_KEY = 'mirror_safe_margins';
const MIRROR_VENUE_MODE_STORAGE_KEY = 'mirror_venue_mode';
const MIRROR_PLAYBACK_STORAGE_KEY = 'mirror_playback';
const MIRROR_BANNER_STORAGE_KEY = 'mirror_banner';
const MIRROR_PLAYBACK_BROADCAST_CHANNEL = 'mirror_playback_broadcast';
const SPOTLIGHT_CAPTION_BUILDERS = [() => 'Great crowd!', () => 'Sing along!'];
const CHOSEN_BY_BUILDERS = [() => 'Picked by audience', () => 'Picked by host'];
type SongWithMirrorFacts = QueueSong & { mirrorFacts?: string[] };
const isMirrorLayoutEditRequest = false;
const MirrorLayoutEditorPage = () => null;
const supabase = {
  from: (_table: string) => {
    let chain: any = {};
    chain = {
      select: (..._args: any[]) => chain,
      eq: (..._args: any[]) => chain,
      not: (..._args: any[]) => chain,
      order: (..._args: any[]) => chain,
      limit: (..._args: any[]) => chain,
      update: (..._args: any[]) => chain,
      removeChannel: (..._args: any[]) => chain,
      neq: (..._args: any[]) => chain,
      then: (cb: any) => Promise.resolve(cb({ data: [], error: null })),
      data: [],
      error: null,
    };
    return chain;
  },
  channel: (_name: string) => {
    // Recursively return an object with unsubscribe and on methods for any depth
    const makeDeepChannel = (depth = 0) => ({
      unsubscribe: (..._args: any[]) => {},
      on: (..._args: any[]) => ({
        subscribe: (..._args2: any[]) => makeDeepChannel(depth + 1)
      })
    });
    return {
      on: (..._args: any[]) => ({
        subscribe: (..._args2: any[]) => makeDeepChannel(1)
      })
    };
  },
  removeChannel: (..._args: any[]) => {},
};
type Event = {
  id: string;
  gigDate: string;
  gigStartTime: string;
  mirrorCountdownQrLink: string;
  mirrorCountdownQrCustomEnabled: boolean;
  mirrorCountdownQrCustomUrl: string;
  mirrorBreakQrEnabled: boolean;
  mirrorBreakQrCustomUrl: string;
  mirrorCountdownQrText: string;
  mirrorCountdownQrFlashVenue: string;
  mirrorVenue: string;
  mirrorBannerEnabled: boolean;
  venueLogoUrl: string;
  name: string;
  venue: string;
  mirrorCountdownEnabled: boolean;
  roomOpen: boolean;
  isTestGig: boolean;
  hostId: string;
  mirrorBannerText: string;
  mirrorCountdownQrFlashEnabled: boolean;
  mirrorPhotoSpotlightEnabled: boolean;
  venueLogoScale: number;
  venueLogoOffsetX: number;
  venueLogoOffsetY: number;
  venueLogoAppearance: string;
  autoLiveEnabled: boolean;
  introAudioUrl?: string;
  mirrorCountdownShowQrLink?: boolean;
};

// --- MISSING CONSTANTS, TYPES, AND UTILS STUBS ---
const MIRROR_LAYOUT_STATE_STORAGE_KEY = 'mirror_layout_state';
const mergeMirrorLayoutState = (state: any) => state;
const readCommittedAudienceLocale = () => 'en';
type MirrorUpcomingEvent = { id: string; name: string; venue?: string };
type MirrorLayoutRect = any;
type FunFactsCache = any;
const demoMode = false;
const MIRROR_WARNING_MIN_VISIBLE_MS = 2000;
const getAudienceUrl = (_id: any, _opts?: any) => '';
const buildQrLandingUrl = (_opts: any) => '';
const QR_FLASH_BASE_LINES: string[] = [];
const forceQuoteMode = false;
const useAuthStore = () => ({ user: { id: 'user-id' }, isHost: true });
const saveTextToLocalStorage = (_k: any, _v: any) => ({ success: true });
const readTextFromLocalStorage = (_k: any) => '';
const loadGlobalMirrorLayoutState = async (_id: any) => ({});
const saveGlobalMirrorLayoutState = async (_id: any, _state: any) => {};
const isMissingMirrorLayoutProfileColumnError = (_e: any) => false;
const launchCastToScreen = async () => {};
const normalizeCountdownTargetMs = (v: any) => v;
const clearMirrorWarningSmoothly = () => {};
const setMirrorWarningMessage = (_msg: any) => {};
const logCrashTelemetry = (_obj: any) => {};
const getMirrorNowMs = () => Date.now();
const LiveFeedPanel = (_props: any) => null;

// --- MISSING CONSTANTS/TYPES STUBS ---
type MirrorDensityMode = 'medium' | 'cinema';
const MIRROR_AUTO_FULLSCREEN_QUERY_PARAM = 'autoFullscreen';
type MirrorVenueLogoLayoutPreviewMessage = any;
const MIRROR_LAYOUT_EDIT_QUERY_PARAM = 'editLayout';
const MIRROR_LAYOUT_EDIT_STORAGE_KEY = 'mirror_layout_edit';

// --- EXPAND EVENT STUB ---
const useQueueStore = () => ({
  event: {
    id: 'event-id',
    gigDate: '2023-01-01',
    gigStartTime: '20:00',
    mirrorCountdownQrLink: '',
    mirrorCountdownQrCustomEnabled: false,
    mirrorCountdownQrCustomUrl: '',
    mirrorBreakQrEnabled: false,
    mirrorBreakQrCustomUrl: '',
    mirrorCountdownQrText: '',
    mirrorCountdownQrFlashVenue: '',
    mirrorVenue: '',
    mirrorBannerEnabled: false,
    venueLogoUrl: '',
    name: '',
    venue: '',
    mirrorCountdownEnabled: true,
    roomOpen: true,
    isTestGig: false,
    hostId: 'host-id',
    mirrorBannerText: 'Welcome!',
    mirrorCountdownQrFlashEnabled: true,
    mirrorPhotoSpotlightEnabled: true,
    venueLogoScale: 100,
    venueLogoOffsetX: 0,
    venueLogoOffsetY: 0,
    venueLogoAppearance: 'default',
    autoLiveEnabled: true,
    introAudioUrl: '',
    mirrorCountdownShowQrLink: true
  },
  hostEvents: [
    { id: 'host-event-1', name: 'Host Event 1', venue: 'Venue 1', gigDate: '2023-01-01', gigStartTime: '20:00' },
  ],
  songs: [
    {
      id: 'song-1',
      title: 'Song 1',
      artist: 'Artist 1',
      createdByName: 'User 1',
      votes_count: 5,
      audience_sings: true,
      cover_url: 'cover1.jpg',
      creatorId: 'user-1',
      is_explicit: false,
    },
    {
      id: 'song-2',
      title: 'Song 2',
      artist: 'Artist 2',
      createdByName: 'User 2',
      votes_count: 3,
      audience_sings: false,
      cover_url: 'cover2.jpg',
      creatorId: 'user-2',
      is_explicit: true,
    },
  ],
  loading: false,
  setRoomOpen: () => Promise.resolve(),
});
// --- MISSING UTILITY FUNCTION/CONSTANT STUBS ---
const isLastSongSoonOverlayMessage = (_msg: any) => false;
const getSharedPlaybackDisplayMessage = (_msg: any) => '';
const isMissingMirrorBannerTextColumnError = (_e: any) => false;
const isCountdownTargetActive = (_target: any, _now: any) => false;
const getSharedPlaybackTransitionState = (_state: any) => '';
const normalizeVenueLogoAppearance = (_appearance: any) => 'default';
const parseVenueLogoLayoutPreviewMessage = (_raw: any) => ({ eventId: '' });
const MIRROR_VENUE_LOGO_LAYOUT_PREVIEW_STORAGE_KEY = 'mirror_venue_logo_layout_preview';
const MIRROR_VENUE_LOGO_LAYOUT_PREVIEW_BROADCAST_CHANNEL = 'mirror_venue_logo_layout_preview_bc';
const MIRROR_VENUE_LOGO_LAYOUT_PREVIEW_MAX_AGE_MS = 60000;
const readIntroAudioPlayLockForEvent = (_id: any) => false;
const INTRO_AUDIO_LOCK_STORAGE_KEY = 'intro_audio_lock';
const QR_FLASH_ROTATE_INTERVAL_MS = 5000;
const writeSharedPlaybackState = async (_id: any, _state: any) => {};

const HOST_PICKED_BY_FALLBACK = 'Picked by host';
const CHOSEN_BY_ACCENT_CLASSES = ['accent-1', 'accent-2', 'accent-3'];
const BETWEEN_SONG_QUOTES = [
  'Welcome to the show.',
  'Sing along with us!',
  'Request your favorite song!',
];

// All state/hooks/refs that were previously top-level must be inside the main component:

const homeMirrorPreviewMode = false;
const DEFAULT_BRB_MESSAGE = "We'll be right back!";
// ...existing code...
// --- MirrorNowPlayingBlock: Rendered inside MirrorPageContent for correct state scope ---
type MirrorNowPlayingBlockProps = {
  beginPanelDrag: any;
  beginInteraction: any;
  isQuoteModeActive: boolean;
  displayedBetweenSongMessage: string;
  playbackTransitionStatusText: string | null;
  activeSong: any;
  currentFactIndex: number;
  currentSongFact: string;
}

function MirrorNowPlayingBlock(props: MirrorNowPlayingBlockProps) {
  const {
    beginPanelDrag,
    beginInteraction,
    isQuoteModeActive,
    displayedBetweenSongMessage,
    playbackTransitionStatusText,
    activeSong,
    currentFactIndex,
    currentSongFact,
  } = props;
  return (
    <section className="mirror-now-playing mirror-frame mirror-frame-now-playing mirror-layout-edit-panel" data-mirror-layout-panel="nowPlaying" onPointerDown={beginPanelDrag('nowPlaying')}>
      <button type="button" className="mirror-layout-drag-handle" aria-label="Drag now playing panel" onPointerDown={beginInteraction('nowPlaying', 'drag')}>Move</button>
      <p className="mirror-now-playing-band-label">Now Playing</p>
      <div className="mirror-now-playing-track">
        <div className="mirror-now-playing-meta">
          {isQuoteModeActive ? (
            <div className="now-playing-media now-playing-between-songs">
              <p className="between-songs-quote">{displayedBetweenSongMessage}</p>
              {playbackTransitionStatusText ? <p className="subcopy no-margin">{playbackTransitionStatusText}</p> : null}
            </div>
          ) : (
            <div className="now-playing-media now-playing-media-stacked">
              <h2>{activeSong?.title ?? 'Loading...'}</h2>
              <p className="artist now-playing-artist">{activeSong?.artist ?? ''}</p>
              <div className="now-playing-artwork-slot">
                {activeSong?.cover_url ? (
                  <img
                    src={activeSong.cover_url}
                    alt={`Cover art for ${activeSong?.title ?? 'current song'}`}
                    className="song-cover song-cover-large"
                  />
                ) : (
                  <span className="song-cover song-cover-large song-cover-fallback now-playing-cover-fallback" aria-hidden="true">
                    {activeSong?.audience_sings ? '🎤' : '♪'}
                  </span>
                )}
              </div>
              <div className="now-playing-fact-box" aria-live="polite">
                <p key={`${activeSong?.id ?? 'unknown'}-${currentFactIndex}`} className="now-playing-fact">
                  {currentSongFact}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      <button type="button" className="mirror-layout-resize-handle" aria-label="Resize now playing panel" onPointerDown={beginInteraction('nowPlaying', 'resize')} />
    </section>
  )
}

function countCharactersWithoutSpaces(text: string) {
  return text.replace(/\s+/g, '').length
}

function buildInitials(text: string) {
  const initials = text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((chunk) => chunk.charAt(0).toUpperCase())
    .join('')

  return initials || '?'
}

function containsFeatToken(text: string) {
  return /\b(feat\.?|ft\.?)\b/i.test(text)
}

function isUuidLikeEventId(eventId: string | null) {
  return Boolean(eventId && UUID_PATTERN.test(eventId.trim()))
}

function truncateFact(value: string, maxLength = SONG_FACT_MAX_LENGTH) {
  const normalizedValue = value.trim()

  if (normalizedValue.length <= maxLength) {
    return normalizedValue
  }

  return `${normalizedValue.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}
function buildFunFactsCacheKey(title: string, artist: string) {
  return `${title.trim().toLowerCase()}::${artist.trim().toLowerCase()}`
}

function extractInterestingSentences(extract: string) {
  const sentenceMatches = extract.match(/[^.!?]+[.!?]+/g) ?? []

  const normalizedSentences = sentenceMatches
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 40 && sentence.length <= SONG_FACT_MAX_LENGTH)
    .filter((sentence) => !/^coordinates?:?/i.test(sentence))

  const uniqueSentences = Array.from(new Set(normalizedSentences))
  return uniqueSentences.slice(0, 10)
}

function normalizeFunFacts(facts: string[]) {
  const normalizedFacts = facts
    .map((fact) => truncateFact(fact))
    .map((fact) => fact.replace(/\s+/g, ' ').trim())
    .filter((fact) => !isLowValueFact(fact))
    .filter(Boolean)

  return Array.from(new Set(normalizedFacts))
}

function isLowValueFact(fact: string) {
  const normalizedFact = fact.trim().toLowerCase()

  return /has\s+\d+\s+word/.test(normalizedFact)
    || /uses\s+\d+\s+characters?/.test(normalizedFact)
    || /title initials/.test(normalizedFact)
    || /artist name\s+"?.+"?\s+has\s+\d+\s+word/.test(normalizedFact)
}

async function fetchItunesSongFacts(title: string, artist: string, signal: AbortSignal) {
  void title
  void artist
  void signal
  return []
}

async function fetchWikipediaSummarySentences(title: string, artist: string, signal: AbortSignal) {
  const candidateTitles = [
    `${title} (song)`,
    title,
    `${title} (${artist} song)`,
    `${title} ${artist}`,
  ]

  for (const candidateTitle of candidateTitles) {
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidateTitle)}`

    try {
      const summaryResponse = await fetch(summaryUrl, { signal })

      if (!summaryResponse.ok) {
        continue
      }

      const summaryPayload = await summaryResponse.json() as {
        extract?: string
      }

      const extract = summaryPayload.extract?.trim()

      if (!extract) {
        continue
      }

      const sentenceFacts = extractInterestingSentences(extract)

      if (sentenceFacts.length >= 3) {
        return sentenceFacts
      }
    } catch {
      // Try next title candidate.
    }
  }

  return []
}

async function fetchMusicBrainzFallbackFacts(title: string, artist: string, signal: AbortSignal) {
  const query = `recording:${JSON.stringify(title)} AND artist:${JSON.stringify(artist)}`
  const searchUrl = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=1`

  try {
    const response = await fetch(searchUrl, {
      signal,
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      return []
    }

    const payload = await response.json() as {
      recordings?: Array<{
        title?: string
        score?: number
        length?: number
        'first-release-date'?: string
        releases?: Array<{ title?: string }>
        'artist-credit'?: Array<{ name?: string }>
      }>
    }

    const recording = payload.recordings?.[0];
    if (!recording) return [];

    const releaseTitle = recording.releases?.[0]?.title?.trim();
    const firstReleaseDate = recording['first-release-date']?.trim();
    const artistCredit = recording['artist-credit']?.map((credit: any) => credit.name?.trim()).filter(Boolean).join(', ');

    const fallbackFacts = [
      recording.score ? `MusicBrainz match confidence is ${recording.score}% for this track.` : null,
      firstReleaseDate ? `MusicBrainz lists the first release date as ${firstReleaseDate}.` : null,
      releaseTitle ? `This track appears on the release "${releaseTitle}" in MusicBrainz.` : null,
      artistCredit ? `MusicBrainz artist credit: ${artistCredit}.` : null,
      recording.length ? `MusicBrainz duration is about ${Math.round(recording.length / 1000)} seconds.` : null,
    ].filter((fact): fact is string => Boolean(fact));

    return fallbackFacts.slice(0, 5);
  } catch {
    return []
  }
}

const SONG_INFO_BUILDERS = [
  (song: NowPlayingInfoSong) => /\//.test(song.title)
    ? `This title looks like a medley set — multiple songs woven into one performance.`
    : `Tonight's crowd voted "${song.title}" to the top of the queue.`,
  (song: NowPlayingInfoSong) => /[()[\]]/.test(song.title)
    ? `Bracketed title detected - this is often a remix, edit, or live version.`
    : `No remix/live tags in the title - this is presented as a straight version.`,
  (song: NowPlayingInfoSong) => /\b(live|acoustic|remix|edit|version)\b/i.test(song.title)
    ? `Version keyword found in title - this cut likely has a distinct arrangement.`
    : `No version keyword found - likely the standard studio-style listing.`,
  (song: NowPlayingInfoSong) => containsFeatToken(song.title)
    ? 'Featured artist tag detected (feat./ft.) - this is a collaboration track.'
    : 'No featured artist tag in the title - this reads like a solo billing.',
  (song: NowPlayingInfoSong) => song.is_explicit
    ? 'Library flag: this track is marked explicit.'
    : 'Library flag: this track is marked clean.',
  (song: NowPlayingInfoSong) => {
    const initials = buildInitials(song.title)
    return initials.length > 1
      ? `Shortcode for hosts: "${song.title}" can be referenced as ${initials}.`
      : `Short title detected - easy to call out quickly in a live room.`
  },
  (song: NowPlayingInfoSong) => {
    const compactLength = countCharactersWithoutSpaces(song.title)
    return compactLength >= 24
      ? `Long-form title (${compactLength} letters without spaces) - built for dramatic mirror presence.`
      : `Compact title (${compactLength} letters without spaces) - quick to read from a distance.`
  },
]

function ensureRotatingFacts(song: NowPlayingInfoSong, facts: string[], minimumCount = 2) {
  const normalizedFacts = normalizeFunFacts(facts)

  if (normalizedFacts.length >= minimumCount) {
    return normalizedFacts.slice(0, 10)
  }

  const localFacts = normalizeFunFacts(SONG_INFO_BUILDERS.map((songInfoBuilder) => songInfoBuilder(song)))
  return normalizeFunFacts([...normalizedFacts, ...localFacts]).slice(0, 10)
}

function resolveMirrorVenueMode(value: string | null | undefined): MirrorVenueMode | null {
  if (!value) {
    return null
  }

  const normalizedValue = value.trim().toLowerCase()

  if (normalizedValue === 'club' || normalizedValue === 'tight') {
    return 'club'
  }

  if (normalizedValue === 'festival' || normalizedValue === 'big-stage' || normalizedValue === 'arena') {
    return 'festival'
  }

  if (normalizedValue === 'lounge' || normalizedValue === 'balanced') {
    return 'lounge'
  }

  return null
}

function normalizeMirrorText(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmedValue = value.trim()
  return trimmedValue || fallback
}

function isSamePlaybackState(left: SharedPlaybackState | null, right: SharedPlaybackState | null) {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return left.currentSongId === right.currentSongId
    && left.currentSongCoverUrl === right.currentSongCoverUrl
    && left.isStarted === right.isStarted
    && left.quoteIndex === right.quoteIndex
    && (left.countdownTargetMs ?? null) === (right.countdownTargetMs ?? null)
    && left.brbActive === right.brbActive
    && left.brbMessage === right.brbMessage
}

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

type FullscreenElement = HTMLElement & {
  msRequestFullscreen?: () => Promise<void> | void
  webkitRequestFullscreen?: () => Promise<void> | void
  webkitRequestFullScreen?: () => Promise<void> | void
}

function getActiveFullscreenElement() {
  const fullscreenDocument = document as FullscreenDocument
  return document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null
}

async function requestFullscreenSafe(targetElement: HTMLElement) {
  const fullscreenTargets = [
    targetElement,
    document.documentElement,
    document.body,
  ].filter((candidate): candidate is HTMLElement => Boolean(candidate))

  let lastError: unknown = null

  for (const candidate of fullscreenTargets) {
    const fullscreenTarget = candidate as FullscreenElement

    try {
      if (typeof fullscreenTarget.requestFullscreen === 'function') {
        await fullscreenTarget.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions)
        return
      }

      if (typeof fullscreenTarget.webkitRequestFullscreen === 'function') {
        await fullscreenTarget.webkitRequestFullscreen()
        return
      }

      if (typeof fullscreenTarget.webkitRequestFullScreen === 'function') {
        await fullscreenTarget.webkitRequestFullScreen()
        return
      }

      if (typeof fullscreenTarget.msRequestFullscreen === 'function') {
        await fullscreenTarget.msRequestFullscreen()
        return
      }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Fullscreen API is unavailable in this browser.')
}

async function exitFullscreenSafe() {
  const fullscreenDocument = document as FullscreenDocument

  if (typeof document.exitFullscreen === 'function') {
    await document.exitFullscreen()
    return
  }

  if (typeof fullscreenDocument.webkitExitFullscreen === 'function') {
    await fullscreenDocument.webkitExitFullscreen()
    return
  }

  throw new Error('Exiting fullscreen is unavailable in this browser.')
}

type SpotlightQueueItem = {
  id: string
  eventId: string
  imageDataUrl: string
  authorName: string
}

function pickSpotlightCaption(authorName: string) {
  const captionBuilder = SPOTLIGHT_CAPTION_BUILDERS[Math.floor(Math.random() * SPOTLIGHT_CAPTION_BUILDERS.length)]
  return captionBuilder()
}

function buildChosenByLine(name: string | null | undefined, phraseIndex: number) {
  const normalizedName = name?.trim()

  if (!normalizedName) {
    return null
  }

  const chosenByBuilder = CHOSEN_BY_BUILDERS[phraseIndex]
  return chosenByBuilder()
}

function getMirrorCountdownTarget(gigDate: string | null | undefined, gigStartTime: string | null | undefined) {
  const normalizedDate = gigDate?.trim()

  if (!normalizedDate) {
    return null
  }

  const rawTime = gigStartTime?.trim() ?? ''
  // Postgres may return 'HH:MM:SS'; strip seconds so we don't double-append ':00'
  const baseTime = rawTime.length > 5 && rawTime[2] === ':' && rawTime[5] === ':' ? rawTime.slice(0, 5) : rawTime
  const normalizedTime = baseTime ? `${baseTime}:00` : '19:00:00'
  const scheduledStart = new Date(`${normalizedDate}T${normalizedTime}`)

  if (Number.isNaN(scheduledStart.getTime())) {
    return null
  }

  return scheduledStart
}

async function fetchServerClockOffsetMs(): Promise<number | null> {
  if (typeof window === 'undefined') {
    return null
  }

  const requestStartedAt = Date.now()

  try {
    const response = await fetch(`/api/keepwarm?clock-sync=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
    })

    if (!response.ok) {
      return null
    }

    const requestEndedAt = Date.now()
    const serverDateHeader = response.headers.get('date')

    if (!serverDateHeader) {
      return null
    }

    const serverNowMs = Date.parse(serverDateHeader)

    if (!Number.isFinite(serverNowMs)) {
      return null
    }

    const estimatedClientNowMs = Math.round((requestStartedAt + requestEndedAt) / 2)
    return serverNowMs - estimatedClientNowMs
  } catch {
    return null
  }
}

function formatMirrorCountdownLabel(remainingMs: number) {
  const safeRemainingMs = Math.max(0, remainingMs)
  const totalSeconds = Math.floor(safeRemainingMs / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const segments = [
    days > 0 ? `${days.toString().padStart(2, '0')}d` : null,
    `${hours.toString().padStart(2, '0')}h`,
    `${minutes.toString().padStart(2, '0')}m`,
    `${seconds.toString().padStart(2, '0')}s`,
  ].filter((segment): segment is string => Boolean(segment))

  return segments.join(' ')
}

function formatMirrorCountdownStartTime(date: Date, locale: AudienceLocale) {
  const resolvedLocale = locale === 'da' ? 'da-DK' : locale === 'is' ? 'is-IS' : undefined

  return new Intl.DateTimeFormat(resolvedLocale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function playShutterSound() {
  try {
    const audioContext = new window.AudioContext()

    if (audioContext.state === 'suspended') {
      void audioContext.close()
      return false
    }

    const gainNode = audioContext.createGain()
    const oscillator = audioContext.createOscillator()

    oscillator.type = 'square'
    oscillator.frequency.setValueAtTime(1560, audioContext.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(720, audioContext.currentTime + 0.06)

    gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.065, audioContext.currentTime + 0.012)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.09)

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.1)

    window.setTimeout(() => {
      void audioContext.close()
    }, 160)

    return true
  } catch {
    // Some browsers block autoplay audio; visual flash still runs.
    return false
  }
}

function MirrorPageContent() {
          // ...existing code...
          // ...existing code...
          // Render QR code for audience join link (after event is defined)
          // Place this after event is declared

          // ...existing code...
          // Place this inside the main return, after event is declared
            // ...existing code...
            // Null checks for countdown and encore event logic (MUST be after all variables are declared)
            // Place this block after countdownTarget, countdownNow, isLive, audienceLocale, upcomingEncoreEvent are declared.

            // --- Place this block after all referenced variables are declared ---
            // const safeCountdownTarget = countdownTarget ?? new Date();
            // const safeCountdownRemainingMs = countdownTarget ? countdownTarget.getTime() - countdownNow : 0;
            // const safeShowCountdown = !isLive && Boolean(countdownTarget) && safeCountdownRemainingMs > 0;
            // const safeCountdownDisplayRemainingMs = safeCountdownRemainingMs > 0 ? safeCountdownRemainingMs : 0;
            // const safeFinalCountdownSeconds = safeShowCountdown && safeCountdownRemainingMs > 0 && safeCountdownRemainingMs <= 10_000
            //   ? Math.ceil(safeCountdownRemainingMs / 1000)
            //   : null;
            // const safeCountdownStartLabel = countdownTarget ? formatMirrorCountdownStartTime(countdownTarget, audienceLocale) : null;
            // const safeUpcomingEncoreEvent = upcomingEncoreEvent ?? { name: '', venue: '', gigDate: '', gigStartTime: '' };
            // const safeNextGigStart = safeUpcomingEncoreEvent.gigDate && safeUpcomingEncoreEvent.gigStartTime
            //   ? getMirrorCountdownTarget(safeUpcomingEncoreEvent.gigDate, safeUpcomingEncoreEvent.gigStartTime)
            //   : null;
            // const safeNextGigStartLabel = safeNextGigStart ? formatMirrorCountdownStartTime(safeNextGigStart, audienceLocale) : null;

            // ...existing code...
            // Place QR code rendering after event is declared
          // ...existing code...
        // Layout editor state and effects (moved from top-level)
        const [layoutState, setLayoutState] = useState<MirrorLayoutState>(DEFAULT_MIRROR_LAYOUT_STATE);
        const [visibleBlocks, setVisibleBlocks] = useState<MirrorLayoutVisibilityState>(DEFAULT_MIRROR_LAYOUT_VISIBILITY);
        const [snapToGrid, setSnapToGrid] = useState<boolean>(false);
        const [showGrid, setShowGrid] = useState(() => {
          const savedText = readTextFromLocalStorage(MIRROR_LAYOUT_EDITOR_PREFS_KEY);
          if (!savedText) return true;
          try {
            const savedPrefs = JSON.parse(savedText) as { showGrid?: boolean };
            return savedPrefs.showGrid ?? true;
          } catch {
            return true;
          }
        });
        const [showBlockPicker, setShowBlockPicker] = useState(true);
        const [activePanelId, setActivePanelId] = useState<MirrorLayoutPanelId | null>(null);

        useEffect(() => {
          void saveTextToLocalStorage(MIRROR_LAYOUT_EDITOR_STORAGE_KEY, JSON.stringify(layoutState));
        }, [layoutState]);

        useEffect(() => {
          void saveTextToLocalStorage(MIRROR_LAYOUT_EDITOR_PREFS_KEY, JSON.stringify({
            visibleBlocks,
            snapToGrid,
            showGrid,
          }));
        }, [showGrid, snapToGrid, visibleBlocks]);

        useEffect(() => {
          const onPointerMove = (pointerEvent: PointerEvent) => {
            const interaction = interactionRef.current;
            if (!interaction || pointerEvent.pointerId !== interaction.pointerId) return;
            const deltaX = ((pointerEvent.clientX - interaction.startX) / interaction.shellWidth) * 100;
            const deltaY = ((pointerEvent.clientY - interaction.startY) / interaction.shellHeight) * 100;
            setLayoutState((currentState: MirrorLayoutState) => {
              const startRect = interaction.startState[interaction.panelId];
              const rawRect = interaction.mode === 'resize'
                ? clampMirrorLayoutRect({
                    left: startRect.left,
                    top: startRect.top,
                    width: startRect.width + deltaX,
                    height: startRect.height + deltaY,
                  })
                : clampMirrorLayoutRect({
                    left: startRect.left + deltaX,
                    top: startRect.top + deltaY,
                    width: startRect.width,
                    height: startRect.height,
                  });
              const nextRect = snapToGrid
                ? {
                    left: Math.round(rawRect.left),
                    top: Math.round(rawRect.top),
                    width: Math.round(rawRect.width),
                    height: Math.round(rawRect.height),
                  }
                : rawRect;
              return {
                ...currentState,
                [interaction.panelId]: nextRect,
              };
            });
          };
          // ...existing code for pointer event listeners if present...
        }, [snapToGrid, setLayoutState]);
      // Stubs for missing refs and functions
      const interactionRef = useRef<any>(null);
      const editorShellRef = useRef<any>(null);
      function clampMirrorLayoutRect(rect: any) { return rect; }
  const { event, hostEvents, songs, loading, setRoomOpen } = useQueueStore()
  const [liveMirrorEventSettings, setLiveMirrorEventSettings] = useState<{
    gigDate: string | null;
    gigStartTime: string | null;
    mirrorCountdownQrLink: string | null;
    mirrorCountdownQrCustomEnabled: boolean;
    mirrorCountdownQrCustomUrl: string | null;
    mirrorBreakQrEnabled: boolean;
    mirrorBreakQrCustomUrl: string | null;
    mirrorCountdownQrText: string | null;
    mirrorCountdownQrFlashVenue: string | null;
  }>(() => ({
    gigDate: event?.gigDate ?? null,
    gigStartTime: event?.gigStartTime ?? null,
    mirrorCountdownQrLink: event?.mirrorCountdownQrLink ?? null,
    mirrorCountdownQrCustomEnabled: event?.mirrorCountdownQrCustomEnabled ?? false,
    mirrorCountdownQrCustomUrl: event?.mirrorCountdownQrCustomUrl ?? null,
    mirrorBreakQrEnabled: event?.mirrorBreakQrEnabled ?? false,
    mirrorBreakQrCustomUrl: event?.mirrorBreakQrCustomUrl ?? null,
    mirrorCountdownQrText: event?.mirrorCountdownQrText ?? null,
    mirrorCountdownQrFlashVenue: event?.mirrorCountdownQrFlashVenue ?? null,
  }))

  useEffect(() => {
    const currentEventId = event?.id

    if (!currentEventId) {
      return
    }

    let isCurrent = true
    const channel = supabase
      .channel(`mirror_event_settings:${currentEventId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'events',
          filter: `id=eq.${currentEventId}`,
        },
        (payload: any) => {
          if (!isCurrent) {
            return
          }

          const row = (payload?.new ?? {}) as Record<string, unknown>
          const nextGigDate = typeof row.gig_date === 'string' ? row.gig_date : null
          const nextGigStartTime = typeof row.gig_start_time === 'string' ? row.gig_start_time : null

          setLiveMirrorEventSettings((previousValue) => ({
            ...previousValue,
            gigDate: nextGigDate,
            gigStartTime: nextGigStartTime,
            mirrorCountdownQrLink: typeof row.mirror_brb_qr_link === 'string' ? row.mirror_brb_qr_link : previousValue.mirrorCountdownQrLink,
            mirrorCountdownQrCustomEnabled: typeof row.mirror_countdown_qr_custom_enabled === 'boolean'
              ? row.mirror_countdown_qr_custom_enabled
              : previousValue.mirrorCountdownQrCustomEnabled,
            mirrorCountdownQrCustomUrl: typeof row.mirror_countdown_qr_custom_url === 'string'
              ? row.mirror_countdown_qr_custom_url
              : previousValue.mirrorCountdownQrCustomUrl,
            mirrorBreakQrEnabled: typeof row.mirror_break_qr_enabled === 'boolean'
              ? row.mirror_break_qr_enabled
              : previousValue.mirrorBreakQrEnabled,
            mirrorBreakQrCustomUrl: typeof row.mirror_break_qr_custom_url === 'string'
              ? row.mirror_break_qr_custom_url
              : previousValue.mirrorBreakQrCustomUrl,
            mirrorCountdownQrText: typeof row.mirror_brb_qr_text === 'string'
              ? row.mirror_brb_qr_text
              : previousValue.mirrorCountdownQrText,
            mirrorCountdownQrFlashVenue: typeof row.mirror_brb_qr_flash_venue === 'string'
              ? row.mirror_brb_qr_flash_venue
              : previousValue.mirrorCountdownQrFlashVenue,
          }))
        },
      )
      .subscribe()

    return () => {
      isCurrent = false
      void channel.unsubscribe()
    }
  }, [event?.id])
  const { user, isHost } = useAuthStore()
  const [spotlight, setSpotlight] = useState<FeedImageSpotlight | null>(null)
  const [funFacts, setFunFacts] = useState<string[]>([])
  const [currentFactIndex, setCurrentFactIndex] = useState(0)
  const lastSpacebarActionAtRef = useRef(0)
  const [flashActive, setFlashActive] = useState(false)
  const [queuedSpotlightCount, setQueuedSpotlightCount] = useState(0)
  const [playbackState, setPlaybackState] = useState<SharedPlaybackState | null>(null)
  const [mirrorWarning, setMirrorWarning] = useState<string | null>(null)
  const [, setAutoLiveLockDebugText] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(
    () => new URLSearchParams(window.location.search).get(MIRROR_AUTO_FULLSCREEN_QUERY_PARAM) === '1',
  )
  const [highContrastMode, setHighContrastMode] = useState(false)
  const [castClarityMode, setCastClarityMode] = useState(false)
  const [densityMode, setDensityMode] = useState<MirrorDensityMode>('medium')
  const [venueMode, setVenueMode] = useState<MirrorVenueMode>('lounge')
  const [showSafeMargins, setShowSafeMargins] = useState(false)
  const [bannerText, setBannerText] = useState<string>('')
  const [bannerEnabledOverride, setBannerEnabledOverride] = useState<boolean | null>(null)
  const [, setStorageError] = useState<string | null>(null)
  const [hideControlsForAudience, setHideControlsForAudience] = useState(false)
  const [globalMirrorLayoutSaveBusy, setGlobalMirrorLayoutSaveBusy] = useState(false)
  const [venueLogoLayoutPreview, setVenueLogoLayoutPreview] = useState<MirrorVenueLogoLayoutPreviewMessage | null>(null)
  const [layoutEditMode, setLayoutEditMode] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    const searchParams = new URLSearchParams(window.location.search)
    const queryEnabled = searchParams.get(MIRROR_LAYOUT_EDIT_QUERY_PARAM) === '1'
    const persistedEnabled = readTextFromLocalStorage(MIRROR_LAYOUT_EDIT_STORAGE_KEY) === '1'
    return queryEnabled || persistedEnabled
  })
  const [mirrorLayoutState, setMirrorLayoutState] = useState<MirrorLayoutState>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_MIRROR_LAYOUT_STATE
    }

    const persistedStateText = readTextFromLocalStorage(MIRROR_LAYOUT_STATE_STORAGE_KEY)

    if (!persistedStateText) {
      return DEFAULT_MIRROR_LAYOUT_STATE
    }

    try {
      return mergeMirrorLayoutState(JSON.parse(persistedStateText) as Partial<MirrorLayoutState>)
    } catch {
      return DEFAULT_MIRROR_LAYOUT_STATE
    }
  })
  const [showShutterFallbackPulse, setShowShutterFallbackPulse] = useState(false)
  const [failedCoverUrls, setFailedCoverUrls] = useState<Record<string, true>>({})
  const [audienceLocale, setAudienceLocale] = useState<AudienceLocale>(() => readCommittedAudienceLocale())
  const [isMirrorNetworkAllowed, setIsMirrorNetworkAllowed] = useState(false)
  const [hasCheckedMirrorNetworkAccess, setHasCheckedMirrorNetworkAccess] = useState(false)
  const [mirrorClockOffsetMs, setMirrorClockOffsetMs] = useState(0)
  const [countdownNow, setCountdownNow] = useState(() => Date.now())
  const [fallbackUpcomingEvent, setFallbackUpcomingEvent] = useState<MirrorUpcomingEvent | null>(null)
  const [betweenSongQuoteIndex, setBetweenSongQuoteIndex] = useState(0)
  const [hasStartedSongDuringLastSongMode, setHasStartedSongDuringLastSongMode] = useState(false)
  const [forceQuoteMode, setForceQuoteMode] = useState(false)
  const [qrFlashTextIndex, setQrFlashTextIndex] = useState(0)
  const quoteIndexRef = useRef(0)
  const autoLiveAttemptedEventIdRef = useRef<string | null>(null)
  const autoLiveInFlightRef = useRef(false)
  const spotlightTimerRef = useRef<number | null>(null)
  const shutterFallbackPulseTimerRef = useRef<number | null>(null)
  const mirrorWarningClearTimerRef = useRef<number | null>(null)
  const mirrorWarningLastShownAtRef = useRef<number>(0)
  const bannerSaveDebounceTimerRef = useRef<number | null>(null)
  const spotlightQueueRef = useRef<SpotlightQueueItem[]>([])
  const spotlightBusyRef = useRef(false)
  const seenSpotlightPostIdsRef = useRef<Set<string>>(new Set())
  const mirrorClockOffsetRef = useRef(0)
  const mirrorShellRef = useRef<HTMLDivElement | null>(null)
  const venueLogoImageRef = useRef<HTMLImageElement | null>(null)
  const autoFullscreenAttemptedRef = useRef(false)
  const mirrorLayoutStageRef = useRef<HTMLDivElement | null>(null)
  const layoutInteractionRef = useRef<{
    panelId: MirrorLayoutPanelId
    mode: 'drag' | 'resize'
    pointerId: number
    startX: number
    startY: number
    startRect: MirrorLayoutRect
    startState: MirrorLayoutState
    stageWidth: number
    stageHeight: number
  } | null>(null)
  const chosenByPhraseIndexBySongIdRef = useRef<Record<string, number>>({})
  const lastChosenByPhraseIndexRef = useRef<number | null>(null)
  const funFactsCacheRef = useRef<FunFactsCache>({})
  const funFactsInFlightRef = useRef<Partial<Record<string, Promise<string[]>>>>({})
  const mirrorLayoutStateRef = useRef(mirrorLayoutState)
  const getMirrorNowMs = useCallback(() => Date.now() + mirrorClockOffsetRef.current, [])

  useEffect(() => {
    mirrorClockOffsetRef.current = mirrorClockOffsetMs
  }, [mirrorClockOffsetMs])

  useEffect(() => {
    let isCurrent = true

    const syncClockOffset = async () => {
      const nextOffsetMs = await fetchServerClockOffsetMs()

      if (!isCurrent || nextOffsetMs === null) {
        return
      }

      mirrorClockOffsetRef.current = nextOffsetMs
      setMirrorClockOffsetMs(nextOffsetMs)
      setCountdownNow(Date.now() + nextOffsetMs)
    }

    void syncClockOffset()

    const timerId = window.setInterval(() => {
      void syncClockOffset()
    }, 120_000)

    return () => {
      isCurrent = false
      window.clearInterval(timerId)
    }
  }, [])

  const setMirrorWarningMessage = (message: string) => {
    if (demoMode) return  // suppress all warnings in demo — reconnects are expected and not real
    if (message === 'Crowd spotlight sync is reconnecting.') {
      return
    }
    if (mirrorWarningClearTimerRef.current !== null) {
      window.clearTimeout(mirrorWarningClearTimerRef.current)
      mirrorWarningClearTimerRef.current = null
    }

    mirrorWarningLastShownAtRef.current = Date.now()
    setMirrorWarning((currentWarning) => (currentWarning === message ? currentWarning : message))
  }

  const clearMirrorWarningSmoothly = () => {
    const elapsedMs = Date.now() - mirrorWarningLastShownAtRef.current
    const delayMs = Math.max(0, MIRROR_WARNING_MIN_VISIBLE_MS - elapsedMs)

    if (mirrorWarningClearTimerRef.current !== null) {
      window.clearTimeout(mirrorWarningClearTimerRef.current)
      mirrorWarningClearTimerRef.current = null
    }

    mirrorWarningClearTimerRef.current = window.setTimeout(() => {
      setMirrorWarning(null)
      mirrorWarningClearTimerRef.current = null
    }, delayMs)
  }

  useEffect(() => {
    mirrorLayoutStateRef.current = mirrorLayoutState
  }, [mirrorLayoutState])

  useEffect(() => {
    const result: { success?: boolean; error?: string | null } | null = saveTextToLocalStorage(MIRROR_LAYOUT_STATE_STORAGE_KEY, JSON.stringify(mirrorLayoutState))

    if ((result as any) && (result as any).success) {
      setStorageError(null)
      return
    }
    setStorageError((result as any)?.error ?? 'Could not save mirror layout locally')
  }, [mirrorLayoutState])

  // Keep the screen awake while the mirror is open
  useEffect(() => {
    if (!('wakeLock' in navigator)) {
      return
    }

    let lock: WakeLockSentinel | null = null

    const acquire = async () => {
      if (document.visibilityState !== 'visible') {
        return
      }

      try {
        lock = await (navigator as Navigator & { wakeLock: { request(type: string): Promise<WakeLockSentinel> } }).wakeLock.request('screen')
      } catch {
        // Wake lock request can be silently denied (e.g. low battery). Safe to ignore.
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void acquire()
      }
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      lock?.release().catch(() => {})
    }
  }, [])

  useEffect(() => {
    return () => {
      if (mirrorWarningClearTimerRef.current !== null) {
        window.clearTimeout(mirrorWarningClearTimerRef.current)
        mirrorWarningClearTimerRef.current = null
      }
    }
  }, [])

  const safeSongs = useMemo(() => songs.filter((song: QueueSong) => (
    song
    && typeof song.id === 'string'
    && typeof song.title === 'string'
    && typeof song.artist === 'string'
  )), [songs])
  const nowPlaying = safeSongs[0]
  const isLive = event?.roomOpen ?? false
  const isEmbeddedPreview =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1'
  const showMirrorDebugOverlay =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mirrorDebug') === '1'
  const eventId = event?.id ?? null
  const isTestGigAudienceMode = event?.isTestGig ?? false
  const mirrorLayoutOwnerId = event?.hostId ?? (isHost ? user?.id ?? null : null)
  const audienceUrl = useMemo(() => {
    try {
      return getAudienceUrl(eventId, {
        compact: true,
        includeVersion: true,
        mode: isTestGigAudienceMode ? 'test' : 'public',
      })
    } catch (error) {
      logCrashTelemetry({
        route: '/mirror',
        error,
        extra: {
          source: 'mirror-audience-url-resolver',
        },
      })
      console.warn('MirrorPage: audience URL resolution failed', error)
      return '/audience'
    }
  }, [eventId, isTestGigAudienceMode])
  const audienceUrlVersion = useMemo(() => {
    try {
      const parsedUrl = new URL(audienceUrl)
      return parsedUrl.searchParams.get('v')?.trim() || null
    } catch {
      return null
    }
  }, [audienceUrl])
  const legacyCountdownQrLink = liveMirrorEventSettings.mirrorCountdownQrLink?.trim() || ''
  const customCountdownQrLink = liveMirrorEventSettings.mirrorCountdownQrCustomUrl?.trim() || ''
  const customBreakQrLink = liveMirrorEventSettings.mirrorBreakQrCustomUrl?.trim() || ''
  const configuredCountdownQrText = liveMirrorEventSettings.mirrorCountdownQrText?.trim() || ''
  const customQrFlashVenueName = liveMirrorEventSettings.mirrorCountdownQrFlashVenue?.trim() || event?.venue?.trim() || ''
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : ''
  const linkCountdownTarget = getMirrorCountdownTarget(
    liveMirrorEventSettings.gigDate ?? null,
    liveMirrorEventSettings.gigStartTime ?? null,
  )
  const buildCountdownLandingUrl = (customUrl: string | null, qrContext: 'countdown' | 'break' | null = null) => buildQrLandingUrl({
    origin: appOrigin,
    eventId,
    isTestGig: isTestGigAudienceMode,
    countdownTargetMs: linkCountdownTarget?.getTime() ?? null,
    audienceLinkVersion: audienceUrlVersion,
    clockOffsetMs: mirrorClockOffsetMs,
    customUrl,
    loungeUrl: legacyCountdownQrLink || null,
    qrContext,
  })
  const countdownQrDestination = buildCountdownLandingUrl(null)
  
  // Custom QR code logic for countdown and break screens
  const useCustomCountdownQr = liveMirrorEventSettings.mirrorCountdownQrCustomEnabled && customCountdownQrLink.length > 0
  const useCustomBreakQr = liveMirrorEventSettings.mirrorBreakQrEnabled && customBreakQrLink.length > 0

  const countdownQrCodeUrl = useCustomCountdownQr
    ? buildCountdownLandingUrl(customCountdownQrLink, 'countdown')
    : countdownQrDestination
    
  const breakQrCodeUrl = useCustomBreakQr
    ? buildCountdownLandingUrl(customBreakQrLink, 'break')
    : countdownQrDestination
  const countdownQrDestinationLabel = useCustomCountdownQr
    ? customCountdownQrLink
    : (legacyCountdownQrLink || audienceUrl)
  const countdownQrText = configuredCountdownQrText || countdownQrDestinationLabel
  
  const qrFlashLines = useMemo(() => {
    const baseLines = [...QR_FLASH_BASE_LINES]
    
    // Add custom flash text from banner if it contains "-" delimiter
    if (event?.mirrorBannerText?.trim()) {
      const bannerText = event.mirrorBannerText.trim()
      // If banner contains "-", split into multiple lines
      if (bannerText.includes('-')) {
        const customLines = bannerText
          .split('-')
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0)
        return [...baseLines, ...customLines]
      }
      // Otherwise, treat it as single custom venue name
      return [...baseLines, bannerText]
    }
    
    // Fallback to custom venue name if no banner text
    if (customQrFlashVenueName) {
      return [...baseLines, customQrFlashVenueName]
    }

    return baseLines
  }, [event?.mirrorBannerText, customQrFlashVenueName])
  const showQrFlashText = (event?.mirrorCountdownQrFlashEnabled ?? true) && qrFlashLines.length > 0
  const activeQrFlashText = showQrFlashText
    ? qrFlashLines[qrFlashTextIndex % qrFlashLines.length] ?? null
    : null
  const audienceQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=2400x2400&ecc=M&margin=36&data=${encodeURIComponent(audienceUrl)}`
  const countdownQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=2400x2400&ecc=M&margin=36&data=${encodeURIComponent(countdownQrCodeUrl)}`
  const breakQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=2400x2400&ecc=M&margin=36&data=${encodeURIComponent(breakQrCodeUrl)}`
  const playbackSong = playbackState?.currentSongId
    ? safeSongs.find((song: QueueSong) => song.id === playbackState.currentSongId) ?? null
    : null
  const activeSong = playbackSong ?? nowPlaying
  // Keep demo mode in always-playing mode for screenshots and promo captures.
  const isNowPlayingStarted = demoMode
    ? Boolean(nowPlaying)
    : Boolean(playbackState?.isStarted && playbackState.currentSongId)
  const isBetweenSongs = Boolean(playbackState && !playbackState.isStarted)
  const isQuoteModeActive = (demoMode && forceQuoteMode) || isBetweenSongs || !activeSong
  const shouldCompactQueue = safeSongs.length > 6
  const upNext = useMemo(() => {
    const candidateSongs = isNowPlayingStarted
      ? safeSongs.filter((song: QueueSong) => song.id !== activeSong?.id)
      : safeSongs

    return candidateSongs
  }, [safeSongs, isNowPlayingStarted, activeSong?.id])
  type MirrorUpcomingEvent = { id: string; name: string; venue: string; gigDate: string; gigStartTime: string };
  const hostUpcomingEvent = useMemo<MirrorUpcomingEvent | null>(() => {
    const nowMs = getMirrorNowMs()

    type HostEvent = { id: string; name: string; venue: string; gigDate: string; gigStartTime: string };
    const candidates = hostEvents
      .filter((hostEvent: HostEvent) => hostEvent.id !== eventId)
      .map((hostEvent: HostEvent) => ({
        id: hostEvent.id,
        name: hostEvent.name,
        venue: hostEvent.venue,
        gigDate: hostEvent.gigDate,
        gigStartTime: hostEvent.gigStartTime,
        startAt: getMirrorCountdownTarget(hostEvent.gigDate, hostEvent.gigStartTime),
      }))

    if (candidates.length === 0) {
      return null
    }

    const candidatesWithDate = candidates
      .filter((candidate: any) => candidate.startAt !== null)
      .sort((left: any, right: any) => (left.startAt as Date).getTime() - (right.startAt as Date).getTime())

    const nextFutureCandidate = candidatesWithDate.find((candidate: any) => (candidate.startAt as Date).getTime() > nowMs)
    const chosenCandidate = nextFutureCandidate ?? candidatesWithDate[0] ?? candidates[0]

    return {
      id: chosenCandidate.id,
      name: chosenCandidate.name,
      venue: chosenCandidate.venue,
      gigDate: chosenCandidate.gigDate,
      gigStartTime: chosenCandidate.gigStartTime,
    }
  }, [eventId, getMirrorNowMs, hostEvents])
  const upcomingEncoreEvent = hostUpcomingEvent ?? fallbackUpcomingEvent
  const normalizedBetweenSongQuoteIndex = Number.isFinite(betweenSongQuoteIndex)
    ? Math.abs(Math.trunc(betweenSongQuoteIndex)) % BETWEEN_SONG_QUOTES.length
    : 0
  const openingWelcomeMessage = isBetweenSongs && !isLastSongSoonOverlayMessage(playbackState?.brbMessage)
    ? getSharedPlaybackDisplayMessage(playbackState?.brbMessage)
    : null
  const currentBetweenSongQuote = BETWEEN_SONG_QUOTES[normalizedBetweenSongQuoteIndex]
    ?? 'Remain calm. The next song is loading.'
  const displayedBetweenSongMessage = openingWelcomeMessage ?? currentBetweenSongQuote
  const currentSongFact = funFacts.length > 0
    ? funFacts[currentFactIndex % funFacts.length]
    : 'No fun facts available for this song yet.'

  const getChosenByLine = (songId: string, name: string | null | undefined) => {
    const normalizedName = name?.trim()

    if (!normalizedName) {
      return null
    }

    const phraseBuildersCount = CHOSEN_BY_BUILDERS.length

    if (phraseBuildersCount <= 0) {
      return `Picked by ${normalizedName}`
    }

    const cachedPhraseIndex = chosenByPhraseIndexBySongIdRef.current[songId]
    let phraseIndex = typeof cachedPhraseIndex === 'number' ? cachedPhraseIndex : -1

    if (phraseIndex < 0 || phraseIndex >= phraseBuildersCount) {
      if (phraseBuildersCount === 1) {
        phraseIndex = 0
      } else {
        const lastPhraseIndex = lastChosenByPhraseIndexRef.current
        phraseIndex = Math.floor(Math.random() * phraseBuildersCount)

        if (phraseIndex === lastPhraseIndex) {
          phraseIndex = (phraseIndex + 1 + Math.floor(Math.random() * (phraseBuildersCount - 1))) % phraseBuildersCount
        }
      }

      chosenByPhraseIndexBySongIdRef.current[songId] = phraseIndex
      lastChosenByPhraseIndexRef.current = phraseIndex
    }

    return buildChosenByLine(normalizedName, phraseIndex) ?? `Picked by ${normalizedName}`
  }

  const getChosenByAccentClass = (songId: string) => {
    const phraseIndex = chosenByPhraseIndexBySongIdRef.current[songId]

    if (typeof phraseIndex !== 'number' || phraseIndex < 0) {
      return CHOSEN_BY_ACCENT_CLASSES[0]
    }

    return CHOSEN_BY_ACCENT_CLASSES[phraseIndex % CHOSEN_BY_ACCENT_CLASSES.length]
  }

  const isHostPick = (song: QueueSong | null | undefined) => {
    if (!song?.creatorId || !event?.hostId) {
      return false
    }

    return song.creatorId === event.hostId
  }

  const activeSongChosenByLine = activeSong?.createdByName
    ? (getChosenByLine(activeSong.id, activeSong.createdByName) ?? `Picked by ${activeSong.createdByName}`)
    : (isHostPick(activeSong) ? HOST_PICKED_BY_FALLBACK : null)
  const activeSongChosenByAccentClass = activeSong?.id
    ? getChosenByAccentClass(activeSong.id)
    : CHOSEN_BY_ACCENT_CLASSES[0]

  useEffect(() => {
    const activeSongIds = new Set(safeSongs.map((song: QueueSong) => song.id))
    const phraseCache = chosenByPhraseIndexBySongIdRef.current

    Object.keys(phraseCache).forEach((songId) => {
      if (!activeSongIds.has(songId)) {
        delete phraseCache[songId]
      }
    })
  }, [safeSongs])

  const showSpotlight = (event?.mirrorPhotoSpotlightEnabled ?? true) && !isEmbeddedPreview
  const shouldShowHostDebugHints = isHost && !isEmbeddedPreview
  const shouldShowEditorControls = isHost && !isEmbeddedPreview && layoutEditMode
  const shouldShowAdminElements = isHost && !isEmbeddedPreview && layoutEditMode
  const isMirrorBannerEnabled = bannerEnabledOverride ?? (event?.mirrorBannerEnabled ?? true)

  const launchCastToScreen = useCallback(async () => {
    if (typeof window === 'undefined') {
      return
    }

    const castUrl = new URL(window.location.href)
    castUrl.searchParams.set(MIRROR_AUTO_FULLSCREEN_QUERY_PARAM, '1')
    castUrl.searchParams.set('cast', '1')
    castUrl.searchParams.delete(MIRROR_LAYOUT_EDIT_QUERY_PARAM)

    const castUrlText = castUrl.toString()
    const userAgent = window.navigator.userAgent
    const isWindows = /Windows NT/i.test(userAgent)
    const isEdgeBrowser = /Edg\//.test(userAgent)
    const isChromiumBrowser = /Chrome|Chromium/.test(userAgent) || isEdgeBrowser
    let openedViaEdgeProtocol = false

    let castTab: Window | null = null

    if (!isEdgeBrowser && isWindows) {
      castTab = window.open(`microsoft-edge:${castUrlText}`, '_blank', 'noopener,noreferrer')
      openedViaEdgeProtocol = Boolean(castTab)
    }

    if (!castTab) {
      castTab = window.open(castUrlText, '_blank', 'noopener,noreferrer')
    }

    if (!castTab) {
      setMirrorWarningMessage('Cast launch was blocked. Allow pop-ups, then open Microsoft Edge and use menu > Cast media to device.')
      return
    }

    castTab.focus()

    if (openedViaEdgeProtocol) {
      setMirrorWarningMessage('Mirror opened in Microsoft Edge for casting. In Edge: menu (three dots) > Cast media to device > Sources > Cast tab.')
    } else if (isEdgeBrowser) {
      setMirrorWarningMessage('Edge cast tab opened. In Edge: menu (three dots) > Cast media to device > Sources > Cast tab.')
    } else if (isChromiumBrowser) {
      setMirrorWarningMessage('Cast tab opened. In browser: menu > Cast... > Sources > Cast tab.')
    } else {
      setMirrorWarningMessage('Cast tab opened. For reliable casting, open this tab in Edge and use menu > Cast media to device.')
    }

    if (!getActiveFullscreenElement()) {
      try {
        await requestFullscreenSafe(mirrorShellRef.current ?? document.documentElement)
      } catch {
        // Fullscreen can be blocked by browser policy. Cast flow can continue.
      }
    }
  }, [])

  useEffect(() => {
    const eventBannerText = event?.mirrorBannerText
    const fallbackLocalBannerText = readTextFromLocalStorage(MIRROR_BANNER_STORAGE_KEY)
    const nextBannerText = typeof eventBannerText === 'string'
      ? eventBannerText
      : (fallbackLocalBannerText ?? '')

    setBannerText(nextBannerText)
  }, [event?.id, event?.mirrorBannerText])

  useEffect(() => {
    if (bannerSaveDebounceTimerRef.current !== null) {
      window.clearTimeout(bannerSaveDebounceTimerRef.current)
      bannerSaveDebounceTimerRef.current = null
    }

    if (!shouldShowEditorControls || demoMode || !event?.id) {
      return
    }

    const nextBannerText = bannerText.trim()
    const persistedBannerText = (event?.mirrorBannerText ?? '').trim()

    if (nextBannerText === persistedBannerText) {
      return
    }

    bannerSaveDebounceTimerRef.current = window.setTimeout(() => {
      void supabase
        .from('events')
        .update({ mirror_banner_text: nextBannerText || null })
        .eq('id', event.id)
        .then(({ error }: any) => {
          if (error) {
            if (isMissingMirrorBannerTextColumnError(error)) {
              return
            }
            setMirrorWarningMessage('Could not save banner text. Please try again.')
          }
        })
      bannerSaveDebounceTimerRef.current = null
    }, 450)

    return () => {
      if (bannerSaveDebounceTimerRef.current !== null) {
        window.clearTimeout(bannerSaveDebounceTimerRef.current)
        bannerSaveDebounceTimerRef.current = null
      }
    }
  }, [bannerText, shouldShowEditorControls, event?.id, event?.mirrorBannerText])

  useEffect(() => {
    let isCurrent = true

    const runAccessCheck = () => {
      if (!isCurrent) {
        return
      }

      // Network gate removed — mirror is accessible from any connection.
      setIsMirrorNetworkAllowed(true)
      setHasCheckedMirrorNetworkAccess(true)
    }

    runAccessCheck()

    const onOnlineOrFocus = () => {
      void runAccessCheck()
    }

    window.addEventListener('online', onOnlineOrFocus)
    window.addEventListener('focus', onOnlineOrFocus)

    return () => {
      isCurrent = false
      window.removeEventListener('online', onOnlineOrFocus)
      window.removeEventListener('focus', onOnlineOrFocus)
    }
  }, [layoutEditMode])

  const countdownCopy = audienceLocale === 'da'
    ? {
        live: '● Live',
        startingSoon: '● Starter snart',
        paused: '● Pause',
        startingIn: 'Starter om',
        scheduledStart: 'Planlagt start',
        scheduledPrefix: 'Planlagt start:',
      }
    : audienceLocale === 'is'
    ? {
        live: '● Live',
        startingSoon: '● Starting Soon',
        paused: '● I pusu',
        startingIn: 'Hefst eftir',
        scheduledStart: 'Aetlud byrjun',
        scheduledPrefix: 'Aetlud byrjun:',
      }
    : {
        live: '● Live',
        startingSoon: '● Starting Soon',
        paused: '● Paused',
        startingIn: 'Starting In',
        scheduledStart: 'Scheduled Start',
        scheduledPrefix: 'Scheduled start:',
      }
  // Use live-updating gig settings for countdown
  const fallbackCountdownTarget = useMemo(
    () => getMirrorCountdownTarget(liveMirrorEventSettings.gigDate ?? null, liveMirrorEventSettings.gigStartTime ?? null),
    [liveMirrorEventSettings.gigDate, liveMirrorEventSettings.gigStartTime],
  )
  const mirroredCountdownTarget = useMemo(() => {
    const targetMs = playbackState?.countdownTargetMs
    if (!isCountdownTargetActive(targetMs, getMirrorNowMs())) {
      return null
    }

    return new Date(targetMs as number)
  }, [getMirrorNowMs, playbackState?.countdownTargetMs])
  const playbackTransitionState = useMemo(
    () => getSharedPlaybackTransitionState(playbackState),
    [playbackState],
  )
  const countdownTarget = fallbackCountdownTarget ?? mirroredCountdownTarget
  const countdownRemainingMs = countdownTarget ? countdownTarget.getTime() - countdownNow : null
  const playbackTransitionRemainingMs = (playbackTransitionState as any)?.phase === 'countdown'
    && (playbackTransitionState as any).countdownTargetMs !== null
    ? Math.max(0, (playbackTransitionState as any).countdownTargetMs - countdownNow)
    : null
  const playbackTransitionStatusText = (playbackTransitionState as any)?.phase === 'countdown'
    ? playbackTransitionRemainingMs !== null
      ? `Starting in ${Math.max(1, Math.ceil(playbackTransitionRemainingMs / 1000))}`
      : 'Starting soon'
    : (playbackTransitionState as any)?.phase === 'intro'
    ? 'Intro MP3 playing...'
    : null
  const countdownDisplayRemainingMs = countdownRemainingMs === null
    ? null
    : Math.max(0, countdownRemainingMs)
  const showCountdown = !isLive && Boolean(countdownTarget) && countdownRemainingMs !== null && countdownRemainingMs > 0
  const showCountdownQrLink = event?.mirrorCountdownShowQrLink ?? true
  const countdownLabel = showCountdown && countdownDisplayRemainingMs !== null
    ? formatMirrorCountdownLabel(countdownDisplayRemainingMs)
    : null
  const finalCountdownSeconds = showCountdown && countdownRemainingMs !== null && countdownRemainingMs > 0 && countdownRemainingMs <= 10_000
    ? Math.ceil(countdownRemainingMs / 1000)
    : null
  const showFinalCountdownOverlay = finalCountdownSeconds !== null
  const countdownStartLabel = countdownTarget ? formatMirrorCountdownStartTime(countdownTarget, audienceLocale) : null
  const activeVenueLogoLayoutPreview = venueLogoLayoutPreview?.eventId === eventId
    ? venueLogoLayoutPreview
    : null
  const venueLogoScale = Math.min(220, Math.max(60, activeVenueLogoLayoutPreview?.venueLogoScale ?? event?.venueLogoScale ?? 100))
  const venueLogoOffsetX = Math.min(100, Math.max(-100, activeVenueLogoLayoutPreview?.venueLogoOffsetX ?? event?.venueLogoOffsetX ?? 0))
  const venueLogoOffsetY = Math.min(100, Math.max(-100, activeVenueLogoLayoutPreview?.venueLogoOffsetY ?? event?.venueLogoOffsetY ?? 0))
  const venueLogoAppearance = normalizeVenueLogoAppearance(activeVenueLogoLayoutPreview?.venueLogoAppearance ?? event?.venueLogoAppearance)
  const shouldShowPreShow = !isLive
  const isLastSongSoonMode = isLastSongSoonOverlayMessage(playbackState?.brbMessage)
  const encoreCandidateSong = upNext[0] ?? null
  const showEncoreVoteOverlay = isLive
    && !shouldShowPreShow
    && !playbackState?.brbActive
    && isLastSongSoonMode
    && hasStartedSongDuringLastSongMode
    && isQuoteModeActive
  const showEncoreVotePrompt = showEncoreVoteOverlay && Boolean(encoreCandidateSong)
  const showEncoreClosingPrompt = showEncoreVoteOverlay && !encoreCandidateSong
  const upcomingEncoreStartLabel = upcomingEncoreEvent
    ? (() => {
      const nextGigStart = getMirrorCountdownTarget(upcomingEncoreEvent.gigDate, upcomingEncoreEvent.gigStartTime)
      return nextGigStart ? formatMirrorCountdownStartTime(nextGigStart, audienceLocale) : null
    })()
    : null
  const encoreCopy = audienceLocale === 'da'
    ? {
        voteEyebrow: 'Ekstranummer-afstemning',
        voteTitle: 'Sidste sang er spillet.',
        voteBody: 'Stem i livefeedet, hvis I vil have et ekstranummer.',
        acceptHint: 'For at acceptere ekstranummeret: vælg en sang i sanglisten.',
        topCandidateLabel: 'Mest stemte ekstranummer lige nu',
        closeEyebrow: 'Hvis vi lukker her',
        closeMessage: 'Tak fordi I dukkede op, sang med og gjorde aftenen helt speciel. Det har været en fornøjelse at spille for jer.',
        upcomingLabel: 'Næste gig',
        whenLabel: 'Tid',
        whereLabel: 'Sted',
        noUpcoming: 'Næste gig bliver annonceret snart.',
        seeYouAgain: 'Håber vi ses der igen.',
      }
    : audienceLocale === 'is'
    ? {
        voteEyebrow: 'Aukalagakosning',
        voteTitle: 'Siðasta lagi er lokið.',
        voteBody: 'Kjósið i live-feedinu ef þið viljið aukalag.',
        acceptHint: 'Til að samþykkja aukalag: veldu lag i Song List.',
        topCandidateLabel: 'Efsta aukalag i bili',
        closeEyebrow: 'Ef við lokum her',
        closeMessage: 'Takk fyrir að mæta, syngja með og skapa stemninguna með mér i kvöld. Þið gerðuð kvöldið eftirminnilegt.',
        upcomingLabel: 'Næsti viðburður',
        whenLabel: 'Tími',
        whereLabel: 'Staður',
        noUpcoming: 'Næsti viðburður verður auglystur fljotlega.',
        seeYouAgain: 'Vona að við sjáumst þar aftur.',
      }
    : {
        voteEyebrow: 'Encore Vote',
        voteTitle: 'The last song has just finished.',
        voteBody: 'Vote in the live feed if you want an extra number (encore).',
        acceptHint: 'To accept the encore: choose a song from Song List.',
        topCandidateLabel: 'Top encore candidate right now',
        closeEyebrow: 'If we close here',
        closeMessage: 'Thank you for showing up, singing along, and making this night unforgettable with me.',
        upcomingLabel: 'Coming Gig',
        whenLabel: 'When',
        whereLabel: 'Where',
        noUpcoming: 'The next gig will be announced soon.',
        seeYouAgain: 'Hope to see you there again.',
      }
  const mirrorDebugRows = [
    `event=${event?.id ?? 'null'}`,
    `roomOpen=${String(isLive)}`,
    `countdownEnabled=${String(event?.mirrorCountdownEnabled ?? true)}`,
    `preShow=${String(shouldShowPreShow)}`,
    `showCountdown=${String(showCountdown)}`,
    `gigDate=${event?.gigDate ?? 'null'}`,
    `gigStart=${event?.gigStartTime ?? 'null'}`,
    `songs=${String(safeSongs.length)}`,
    `nowPlaying=${nowPlaying?.id ?? 'null'}`,
  ]

  useEffect(() => {
    if (!isLastSongSoonMode) {
      setHasStartedSongDuringLastSongMode(false)
      return
    }

    if (isNowPlayingStarted) {
      setHasStartedSongDuringLastSongMode(true)
    }
  }, [isLastSongSoonMode, isNowPlayingStarted])

  useEffect(() => {
    if (hostUpcomingEvent) {
      setFallbackUpcomingEvent(null)
      return
    }

    if (!event?.hostId) {
      setFallbackUpcomingEvent(null)
      return
    }

    let isCurrent = true

    const loadFallbackUpcomingEvent = async () => {
      try {
        let query = supabase
          .from('events')
          .select('id, name, venue, gig_date, gig_start_time, show_in_audience_no_gig')
          .eq('host_id', event.hostId)
          .order('gig_date', { ascending: true, nullsFirst: false })
          .order('gig_start_time', { ascending: true, nullsFirst: false })
          .limit(12)

        if (eventId) {
          query = query.neq('id', eventId)
        }

        const { data, error } = await query

        if (error || !isCurrent) {
          setFallbackUpcomingEvent(null)
          return
        }

        const nowMs = getMirrorNowMs()
        const candidates = (data ?? []).map((row: any) => {
          const normalizedRow = row as {
            id?: string
            name?: string
            venue?: string | null
            gig_date?: string | null
            gig_start_time?: string | null
          }

          return {
            id: normalizedRow.id ?? '',
            name: normalizedRow.name?.trim() || 'Upcoming gig',
            venue: normalizedRow.venue ?? null,
            gigDate: normalizedRow.gig_date ?? null,
            gigStartTime: normalizedRow.gig_start_time ?? null,
            startAt: getMirrorCountdownTarget(normalizedRow.gig_date ?? null, normalizedRow.gig_start_time ?? null),
          }
        }).filter((candidate: any) => candidate.id)

        if (candidates.length === 0) {
          setFallbackUpcomingEvent(null)
          return
        }

        const candidatesWithDate = candidates
          .filter((candidate: any) => candidate.startAt !== null)
          .sort((left: any, right: any) => (left.startAt as Date).getTime() - (right.startAt as Date).getTime())

        const nextFutureCandidate = candidatesWithDate.find((candidate: any) => (candidate.startAt as Date).getTime() > nowMs)
        const selectedCandidate = nextFutureCandidate ?? candidatesWithDate[0] ?? candidates[0]

        setFallbackUpcomingEvent({
          id: selectedCandidate.id,
          name: selectedCandidate.name,
          venue: selectedCandidate.venue,
          gigDate: selectedCandidate.gigDate,
          gigStartTime: selectedCandidate.gigStartTime,
        })
      } catch {
        if (isCurrent) {
          setFallbackUpcomingEvent(null)
        }
      }
    }

    void loadFallbackUpcomingEvent()

    return () => {
      isCurrent = false
    }
  }, [event?.hostId, eventId, getMirrorNowMs, hostUpcomingEvent])

  useEffect(() => {
    if (!activeVenueLogoLayoutPreview || !eventId) {
      return
    }

    const serverStateMatchesPreview = (event?.venueLogoScale ?? 100) === activeVenueLogoLayoutPreview.venueLogoScale
      && (event?.venueLogoOffsetX ?? 0) === activeVenueLogoLayoutPreview.venueLogoOffsetX
      && (event?.venueLogoOffsetY ?? 0) === activeVenueLogoLayoutPreview.venueLogoOffsetY
      && normalizeVenueLogoAppearance(event?.venueLogoAppearance) === activeVenueLogoLayoutPreview.venueLogoAppearance

    if (serverStateMatchesPreview) {
      setVenueLogoLayoutPreview(null)
      return
    }

    const elapsedMs = Date.now() - activeVenueLogoLayoutPreview.sentAt
    const remainingMs = Math.max(0, MIRROR_VENUE_LOGO_LAYOUT_PREVIEW_MAX_AGE_MS - elapsedMs)
    const timeoutId = window.setTimeout(() => {
      setVenueLogoLayoutPreview(null)
    }, remainingMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [activeVenueLogoLayoutPreview, event?.venueLogoAppearance, event?.venueLogoOffsetX, event?.venueLogoOffsetY, event?.venueLogoScale, eventId])

  useEffect(() => {
    if (!shouldShowHostDebugHints || !eventId) {
      setAutoLiveLockDebugText(null)
      return
    }

    const refreshAutoLiveLockDebugText = () => {
      const lock = readIntroAudioPlayLockForEvent(eventId)

      if (!lock) {
        setAutoLiveLockDebugText(null)
        return
      }

      const remainingSeconds = Math.max(1, Math.ceil(((lock as any).expiresAt - Date.now()) / 1000))
      setAutoLiveLockDebugText(`Auto Live lock active in another host tab (${remainingSeconds}s)`)
    }

    refreshAutoLiveLockDebugText()

    const timerId = window.setInterval(refreshAutoLiveLockDebugText, 1000)
    const onStorageUpdate = (storageEvent: StorageEvent) => {
      if (storageEvent.key === INTRO_AUDIO_LOCK_STORAGE_KEY) {
        refreshAutoLiveLockDebugText()
      }
    }

    window.addEventListener('storage', onStorageUpdate)

    return () => {
      window.clearInterval(timerId)
      window.removeEventListener('storage', onStorageUpdate)
    }
  }, [eventId, shouldShowHostDebugHints])

  useEffect(() => {
    if (!showQrFlashText) {
      setQrFlashTextIndex(0)
      return
    }

    const rotateInterval = window.setInterval(() => {
      setQrFlashTextIndex((currentIndex) => (currentIndex + 1) % qrFlashLines.length)
    }, QR_FLASH_ROTATE_INTERVAL_MS)

    return () => {
      window.clearInterval(rotateInterval)
    }
  }, [showQrFlashText, qrFlashLines])

  useEffect(() => {
    setQrFlashTextIndex(0)
  }, [event?.id, qrFlashLines])

  useEffect(() => {
    const imageElement = venueLogoImageRef.current

    if (!imageElement) {
      return
    }

    imageElement.style.setProperty('--mirror-venue-logo-scale', String(venueLogoScale / 100))
    imageElement.style.setProperty('--mirror-venue-logo-offset-x', `${venueLogoOffsetX}%`)
    imageElement.style.setProperty('--mirror-venue-logo-offset-y', `${venueLogoOffsetY}%`)
  }, [venueLogoOffsetX, venueLogoOffsetY, venueLogoScale, event?.venueLogoUrl])

  const onCoverLoadError = (coverUrl: string | null | undefined) => {
    if (!coverUrl) {
      return
    }

    setFailedCoverUrls((currentUrls) => {
      if (currentUrls[coverUrl]) {
        return currentUrls
      }

      return { ...currentUrls, [coverUrl]: true }
    })
  }

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    if (!event?.id) {
      autoLiveAttemptedEventIdRef.current = null
      return
    }

    if (!event.autoLiveEnabled || event.roomOpen) {
      autoLiveAttemptedEventIdRef.current = null
    }
  }, [event?.id, event?.autoLiveEnabled, event?.roomOpen, layoutEditMode])

  useEffect(() => {
    const runMirrorAutoLive = async () => {
      if (!isHost || !event?.id || !event.autoLiveEnabled || event.roomOpen || autoLiveInFlightRef.current) {
        return
      }

      if (!countdownTarget || countdownRemainingMs === null || countdownRemainingMs > 0) {
        return
      }

      if (autoLiveAttemptedEventIdRef.current === event.id) {
        return
      }

      autoLiveAttemptedEventIdRef.current = event.id
      autoLiveInFlightRef.current = true

      try {
        await setRoomOpen()

        await writeSharedPlaybackState(event.id, {
          currentSongId: nowPlaying?.id ?? null,
          currentSongCoverUrl: nowPlaying?.cover_url ?? null,
          isStarted: false,
          quoteIndex: quoteIndexRef.current,
          countdownTargetMs: countdownTarget?.getTime() ?? null,
          brbActive: false,
          brbMessage: AUTO_LIVE_WELCOME_MESSAGE,
        })

        setMirrorWarningMessage('Auto Live started from scheduled countdown.')
      } catch {
        setMirrorWarningMessage('Countdown ended, but Auto Live could not open the room. Use Gig Control to go live manually.')
      } finally {
        autoLiveInFlightRef.current = false
      }
    }

    void runMirrorAutoLive()
  }, [
    countdownRemainingMs,
    countdownTarget,
    event?.id,
    event?.autoLiveEnabled,
    event?.introAudioUrl,
    event?.roomOpen,
    isHost,
    nowPlaying?.cover_url,
    nowPlaying?.id,
    setRoomOpen,
    layoutEditMode,
  ])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(getActiveFullscreenElement()))
    }

    syncFullscreenState()
    document.addEventListener('fullscreenchange', syncFullscreenState)
    document.addEventListener('webkitfullscreenchange', syncFullscreenState)
    window.addEventListener('fullscreenchange', syncFullscreenState)
    window.addEventListener('webkitfullscreenchange', syncFullscreenState)

    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState)
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState)
      window.removeEventListener('fullscreenchange', syncFullscreenState)
      window.removeEventListener('webkitfullscreenchange', syncFullscreenState)
    }
  }, [layoutEditMode])


  // Always show persistent fullscreen prompt if not fullscreen
  useEffect(() => {
    if (layoutEditMode) return;
    const checkFullscreen = () => {
      setShowFullscreenPrompt(!getActiveFullscreenElement());
    };
    checkFullscreen();
    document.addEventListener('fullscreenchange', checkFullscreen);
    window.addEventListener('resize', checkFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', checkFullscreen);
      window.removeEventListener('resize', checkFullscreen);
    };
  }, [layoutEditMode]);

  const handleFullscreenPromptClick = useCallback(() => {
    requestFullscreenSafe(mirrorShellRef.current ?? document.documentElement)
      .then(() => setShowFullscreenPrompt(false))
      .catch(() => setShowFullscreenPrompt(true));
  }, []);

  // In your render, show the prompt if showFullscreenPrompt is true:
  // {showFullscreenPrompt && (
  //   <div className="mirror-fullscreen-prompt" onClick={handleFullscreenPromptClick}>
  //     Click here or press any key to enter fullscreen
  //   </div>
  // )}

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    const syncPresentationState = () => {
      const fullscreenActive = Boolean(getActiveFullscreenElement())
      const fullscreenDisplayMode = window.matchMedia('(display-mode: fullscreen)').matches
      const projectedMode = fullscreenActive || fullscreenDisplayMode

      setHideControlsForAudience(projectedMode)
    }

    syncPresentationState()
    document.addEventListener('fullscreenchange', syncPresentationState)
    document.addEventListener('webkitfullscreenchange', syncPresentationState)
    window.addEventListener('fullscreenchange', syncPresentationState)
    window.addEventListener('webkitfullscreenchange', syncPresentationState)
    window.addEventListener('resize', syncPresentationState)

    return () => {
      document.removeEventListener('fullscreenchange', syncPresentationState)
      document.removeEventListener('webkitfullscreenchange', syncPresentationState)
      window.removeEventListener('fullscreenchange', syncPresentationState)
      window.removeEventListener('webkitfullscreenchange', syncPresentationState)
      window.removeEventListener('resize', syncPresentationState)
    }
  }, [layoutEditMode])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    const syncAudienceLocale = () => {
      setAudienceLocale(readCommittedAudienceLocale())
    }

    syncAudienceLocale()
    window.addEventListener('storage', syncAudienceLocale)

    return () => {
      window.removeEventListener('storage', syncAudienceLocale)
    }
  }, [layoutEditMode])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    if (typeof window === 'undefined') {
      return
    }

    const persistedCacheText = readTextFromLocalStorage(MIRROR_FUN_FACTS_CACHE_STORAGE_KEY)

    if (!persistedCacheText) {
      return
    }

    try {
      const persistedCache = JSON.parse(persistedCacheText) as FunFactsCache

      if (persistedCache && typeof persistedCache === 'object') {
        funFactsCacheRef.current = persistedCache
      }
    } catch {
      // Corrupt cache should not block playback; overwrite on next write.
    }
  }, [layoutEditMode])

  const persistFunFactsCache = useCallback(() => {
    const serializedCache = JSON.stringify(funFactsCacheRef.current)
    const result: { success?: boolean; error?: string | null } | null = saveTextToLocalStorage(MIRROR_FUN_FACTS_CACHE_STORAGE_KEY, serializedCache)

    if (!result || !(result as any).success) {
      console.warn('MirrorPage: failed to persist fun facts cache', (result as any)?.error)
    }
  }, [])

  const ensureSongFunFacts = useCallback(async (song: QueueSong, signal: AbortSignal) => {
    const songWithMirrorFacts = song as SongWithMirrorFacts
    const songInfoContext: NowPlayingInfoSong = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      is_explicit: song.is_explicit,
    }
    const embeddedFacts = normalizeFunFacts(songWithMirrorFacts.mirrorFacts ?? [])

    if (embeddedFacts.length > 0) {
      const rotatingFacts = ensureRotatingFacts(songInfoContext, embeddedFacts)
      songWithMirrorFacts.mirrorFacts = rotatingFacts
      return rotatingFacts
    }

    const cacheKey = buildFunFactsCacheKey(song.title, song.artist)
    const existingFacts = funFactsCacheRef.current[cacheKey]

    if (existingFacts?.length) {
      const rotatingFacts = ensureRotatingFacts(songInfoContext, existingFacts)
      funFactsCacheRef.current[cacheKey] = rotatingFacts
      songWithMirrorFacts.mirrorFacts = rotatingFacts
      return rotatingFacts
    }

    if (funFactsInFlightRef.current[cacheKey]) {
      return funFactsInFlightRef.current[cacheKey]
    }

    const fetchPromise = (async () => {
      const wikipediaFacts = await fetchWikipediaSummarySentences(song.title, song.artist, signal)
      const itunesFacts = await fetchItunesSongFacts(song.title, song.artist, signal)
      const fallbackFacts = wikipediaFacts.length + itunesFacts.length >= 3
        ? []
        : await fetchMusicBrainzFallbackFacts(song.title, song.artist, signal)

      const localFacts = SONG_INFO_BUILDERS.map((songInfoBuilder) => songInfoBuilder(songInfoContext))

      const mergedFacts = normalizeFunFacts([
        ...wikipediaFacts,
        ...itunesFacts,
        ...fallbackFacts,
        ...localFacts,
      ]).slice(0, 10)
      const guaranteedFacts = mergedFacts.length >= 3
        ? mergedFacts
        : normalizeFunFacts([...mergedFacts, ...localFacts]).slice(0, 10)
      const rotatingFacts = ensureRotatingFacts(songInfoContext, guaranteedFacts)

      funFactsCacheRef.current[cacheKey] = rotatingFacts
      songWithMirrorFacts.mirrorFacts = rotatingFacts
      persistFunFactsCache()

      return rotatingFacts
    })()

    funFactsInFlightRef.current[cacheKey] = fetchPromise

    try {
      return await fetchPromise
    } finally {
      delete funFactsInFlightRef.current[cacheKey]
    }
  }, [persistFunFactsCache])

  useEffect(() => {
    const abortController = new AbortController()

    const prefetchFacts = async () => {
      for (const song of safeSongs) {
        if (abortController.signal.aborted) {
          return
        }

        try {
          await ensureSongFunFacts(song, abortController.signal)
        } catch {
          // Fact prefetch is best effort only.
        }
      }
    }

    void prefetchFacts()

    return () => {
      abortController.abort()
    }
  }, [ensureSongFunFacts, safeSongs])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    if (!isNowPlayingStarted || !activeSong) {
      setFunFacts([])
      setCurrentFactIndex(0)
      return
    }

    if (demoMode) {
      setFunFacts(DEMO_NOW_PLAYING_FACTS)
      setCurrentFactIndex(0)
      return
    }

    const abortController = new AbortController()
    const activeSongWithMirrorFacts = activeSong as SongWithMirrorFacts
    const songInfoContext: NowPlayingInfoSong = {
      id: activeSong.id,
      title: activeSong.title,
      artist: activeSong.artist,
      is_explicit: activeSong.is_explicit,
    }
    const embeddedFacts = normalizeFunFacts(activeSongWithMirrorFacts.mirrorFacts ?? [])

    if (embeddedFacts.length > 0) {
      const rotatingFacts = ensureRotatingFacts(songInfoContext, embeddedFacts)
      activeSongWithMirrorFacts.mirrorFacts = rotatingFacts
      setFunFacts(rotatingFacts)
      setCurrentFactIndex(0)
      return
    }

    const cacheKey = buildFunFactsCacheKey(activeSong.title, activeSong.artist)
    const cachedFacts = funFactsCacheRef.current[cacheKey]

    if (cachedFacts?.length) {
      const rotatingFacts = ensureRotatingFacts(songInfoContext, cachedFacts)
      funFactsCacheRef.current[cacheKey] = rotatingFacts
      activeSongWithMirrorFacts.mirrorFacts = rotatingFacts
      setFunFacts(rotatingFacts)
      setCurrentFactIndex(0)
      return
    }

    const loadSongFunFacts = async () => {
      try {
        const fetchedFacts = await ensureSongFunFacts(activeSong, abortController.signal)

        if (abortController.signal.aborted) {
          return
        }

        setFunFacts(fetchedFacts)
        setCurrentFactIndex(0)
      } catch (error) {
        if (abortController.signal.aborted) {
          return
        }

        console.warn('MirrorPage: failed to load song fun facts', error)
        setFunFacts([])
        setCurrentFactIndex(0)
      }
    }

    void loadSongFunFacts()

    return () => {
      abortController.abort()
    }
  }, [activeSong, ensureSongFunFacts, isNowPlayingStarted, layoutEditMode])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    if (funFacts.length <= 1) {
      setCurrentFactIndex(0)
      return
    }

    const intervalId = window.setInterval(() => {
      setCurrentFactIndex((currentIndex) => (currentIndex + 1) % funFacts.length)
    }, SONG_INFO_ROTATE_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [funFacts, layoutEditMode])

  const setQuoteIndex = (nextQuoteIndex: number) => {
    quoteIndexRef.current = nextQuoteIndex
    setBetweenSongQuoteIndex(nextQuoteIndex)
  }


  // When the show goes live, reset the quote index to 0 so the first message is always the welcome message
  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    if (isLive && quoteIndexRef.current !== 0) {
      setQuoteIndex(0)
      return
    }

    const normalizedQuoteIndex = Number.isFinite(playbackState?.quoteIndex)
      ? (playbackState?.quoteIndex as number) % BETWEEN_SONG_QUOTES.length
      : 0

    if (normalizedQuoteIndex !== quoteIndexRef.current) {
      setQuoteIndex(normalizedQuoteIndex)
    }
  }, [isLive, playbackState?.quoteIndex, layoutEditMode])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    if (!isQuoteModeActive) {
      return
    }

    const intervalId = window.setInterval(() => {
      const nextQuoteIndex = (quoteIndexRef.current + 1) % BETWEEN_SONG_QUOTES.length
      setQuoteIndex(nextQuoteIndex)
    }, QUOTE_ROTATE_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isQuoteModeActive, layoutEditMode])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (!keyEvent.isTrusted || keyEvent.defaultPrevented) {
        return
      }

      const target = keyEvent.target as HTMLElement | null
      const activeElement = document.activeElement as HTMLElement | null
      const interactiveTarget = target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="button"], [role="textbox"], [data-spacebar-ignore="true"]')
      const isTypingTarget = Boolean(interactiveTarget || activeElement?.isContentEditable)

      if (isTypingTarget) {
        return
      }

      if (keyEvent.key === 'Escape') {
        if (!getActiveFullscreenElement()) {
          return
        }

        keyEvent.preventDefault()
        void exitFullscreenSafe().catch((error) => {
          console.warn('MirrorPage: keyboard fullscreen exit failed', error)
          setMirrorWarningMessage('Could not exit fullscreen from keyboard shortcut.')
        })
        return
      }

      if (keyEvent.key.toLowerCase() === 'f' && !keyEvent.altKey && !keyEvent.ctrlKey && !keyEvent.metaKey) {
        keyEvent.preventDefault()
        void (async () => {
          try {
            if (!getActiveFullscreenElement()) {
              await requestFullscreenSafe(mirrorShellRef.current ?? document.documentElement)
            } else {
              await exitFullscreenSafe()
            }
          } catch (error) {
            console.warn('MirrorPage: keyboard fullscreen toggle failed', error)
            setMirrorWarningMessage('Could not toggle fullscreen from keyboard shortcut.')
          }
        })()
        return
      }

      if (keyEvent.key.toLowerCase() === 'c' && !keyEvent.altKey && !keyEvent.ctrlKey && !keyEvent.metaKey) {
        keyEvent.preventDefault()
        void launchCastToScreen()
        return
      }

      if (keyEvent.code !== 'Space') {
        return
      }

      if (keyEvent.altKey || keyEvent.ctrlKey || keyEvent.metaKey || keyEvent.shiftKey) {
        return
      }

      if (keyEvent.repeat) {
        keyEvent.preventDefault()
        return
      }

      const now = Date.now()
      if (now - lastSpacebarActionAtRef.current < 500) {
        keyEvent.preventDefault()
        return
      }

      keyEvent.preventDefault()
      lastSpacebarActionAtRef.current = now
      // --- Advance queue on spacebar if gig is live ---
      // TODO: Implement queue advancement logic here if needed, using available store/actions.
      // ---
    }

    window.addEventListener('keydown', onKeyDown as unknown as EventListener)
    return () => window.removeEventListener('keydown', onKeyDown as unknown as EventListener)
  }, [launchCastToScreen, layoutEditMode])

  useEffect(() => {
    if (!isHost || isEmbeddedPreview) {
      return
    }

    const onLayoutEditToggleKeyDown = (keyEvent: KeyboardEvent) => {
      if (!keyEvent.isTrusted || keyEvent.defaultPrevented) {
        return
      }

      if (keyEvent.key.toLowerCase() !== 'e') {
        return
      }

      if (keyEvent.altKey || keyEvent.ctrlKey || keyEvent.metaKey) {
        return
      }

      const target = keyEvent.target as HTMLElement | null
      const activeElement = document.activeElement as HTMLElement | null
      const interactiveTarget = target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="button"], [role="textbox"], [data-spacebar-ignore="true"]')
      const isTypingTarget = Boolean(interactiveTarget || activeElement?.isContentEditable)

      if (isTypingTarget) {
        return
      }

      keyEvent.preventDefault()
      setLayoutEditMode((currentMode) => !currentMode)
    }

    window.addEventListener('keydown', onLayoutEditToggleKeyDown as unknown as EventListener)
    return () => window.removeEventListener('keydown', onLayoutEditToggleKeyDown as unknown as EventListener)
  }, [isHost, isEmbeddedPreview])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    if (isLive || !countdownTarget) {
      return
    }

    setCountdownNow(getMirrorNowMs())

    const timerId = window.setInterval(() => {
      setCountdownNow(getMirrorNowMs())
    }, 1000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [countdownTarget, isLive, layoutEditMode, getMirrorNowMs])

  useEffect(() => {
    const onRuntimeError = (event: ErrorEvent) => {
      logCrashTelemetry({
        route: '/mirror',
        error: event.error ?? event.message,
        extra: {
          source: 'mirror-runtime-error',
        },
      })
      setMirrorWarningMessage('Mirror recovered from a runtime issue. Showing last known state.')
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      logCrashTelemetry({
        route: '/mirror',
        error: event.reason,
        extra: {
          source: 'mirror-unhandled-rejection',
        },
      })
      setMirrorWarningMessage('Mirror sync is retrying in the background. Display remains live.')
    }

    window.addEventListener('error', onRuntimeError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      window.removeEventListener('error', onRuntimeError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const searchParams = new URLSearchParams(window.location.search)
    const contrastParam = searchParams.get('contrast')?.trim().toLowerCase()
      ?? searchParams.get('hc')?.trim().toLowerCase()
    const densityParam = searchParams.get('density')?.trim().toLowerCase()
      ?? searchParams.get('dm')?.trim().toLowerCase()
    const venueParam = searchParams.get('venue')?.trim().toLowerCase()
      ?? searchParams.get('vm')?.trim().toLowerCase()
    const safeMarginsParam = searchParams.get('safeMargins')?.trim().toLowerCase()
      ?? searchParams.get('safe')?.trim().toLowerCase()
    const castParam = searchParams.get('cast')?.trim().toLowerCase()
      ?? searchParams.get('quality')?.trim().toLowerCase()

    const hasContrastQuery = contrastParam === '1' || contrastParam === 'high' || contrastParam === 'true'
    const hasCastBlurQuery = castParam === '0' || castParam === 'false' || castParam === 'off' || castParam === 'blur'
    const persistedContrastPreference = readTextFromLocalStorage(MIRROR_HIGH_CONTRAST_STORAGE_KEY) === '1'
    const hasSafeMarginsQuery = safeMarginsParam === '1' || safeMarginsParam === 'on' || safeMarginsParam === 'true'
    const persistedSafeMarginsPreference = readTextFromLocalStorage(MIRROR_SAFE_MARGINS_STORAGE_KEY) === '1'
    const persistedVenueMode = resolveMirrorVenueMode(readTextFromLocalStorage(MIRROR_VENUE_MODE_STORAGE_KEY))
    const resolvedVenueMode = resolveMirrorVenueMode(venueParam) ?? persistedVenueMode ?? 'lounge'
    const resolvedDensityMode: MirrorDensityMode = densityParam === 'cinema' || densityParam === 'xl' || densityParam === 'large'
      ? 'cinema'
      : 'medium'

    setHighContrastMode(hasContrastQuery || persistedContrastPreference)
    const resolvedCastClarityMode = !hasCastBlurQuery

    // Keep mirror output crisp by default, including after hard refresh.
    setCastClarityMode(resolvedCastClarityMode)
    setDensityMode(resolvedDensityMode)
    setVenueMode(resolvedVenueMode)
    setShowSafeMargins(hasSafeMarginsQuery || persistedSafeMarginsPreference)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const result: any = saveTextToLocalStorage(MIRROR_HIGH_CONTRAST_STORAGE_KEY, highContrastMode ? '1' : '0');
    if (result && result.success) {
      setStorageError(null);
      return;
    }
    setStorageError(result?.error ?? 'Could not save contrast preference');
    console.warn('MirrorPage: failed to save high contrast mode', result?.error);
  }, [highContrastMode])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const result: any = saveTextToLocalStorage(MIRROR_SAFE_MARGINS_STORAGE_KEY, showSafeMargins ? '1' : '0');
    if (result && result.success) {
      setStorageError(null);
      return;
    }
    setStorageError(result?.error ?? 'Could not save safe margins preference');
    console.warn('MirrorPage: failed to save safe margins', result?.error);
  }, [showSafeMargins])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const result: any = saveTextToLocalStorage(MIRROR_VENUE_MODE_STORAGE_KEY, venueMode);
    if (result && result.success) {
      setStorageError(null);
      return;
    }
    setStorageError(result?.error ?? 'Could not save venue mode preference');
    console.warn('MirrorPage: failed to save venue mode', result?.error);
  }, [venueMode])

  // Update OG meta tags for social media sharing
  useEffect(() => {
    if (!event) {
      resetOGTags()
      return
    }

    const gigUrl = typeof window !== 'undefined' ? window.location.href : undefined
    setGigOGTags(event.name, event.venue ?? null, event.name, undefined, gigUrl)
  }, [event, event?.id, event?.name, event?.venue])

  // --- Playback sync/reconnect logic moved inside MirrorPageContent ---
  // (PASTE THE ENTIRE useEffect AND ALL INNER LOGIC HERE, INSIDE THE FUNCTION)
  // ...existing code...

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    return () => {
      if (spotlightTimerRef.current) {
        window.clearTimeout(spotlightTimerRef.current)
      }
      if (shutterFallbackPulseTimerRef.current) {
        window.clearTimeout(shutterFallbackPulseTimerRef.current)
      }
      spotlightBusyRef.current = false
      spotlightQueueRef.current = []
    }
  }, [layoutEditMode])

  // ...existing code...
  // (Spotlight/channel useEffect moved below, after eventId, showSpotlight, and layoutEditMode are declared)

  const activeSpotlight = useMemo(() => {
    if (!eventId || !spotlight || spotlight.eventId !== eventId) {
      return null;
    }
    return spotlight;
  }, [eventId, spotlight]);



  const beginMirrorLayoutInteraction = useCallback((panelId: MirrorLayoutPanelId, mode: 'drag' | 'resize') => (pointerEvent: React.PointerEvent<HTMLButtonElement>) => {
    if (!layoutEditMode || !mirrorShellRef.current) {
      return
    }

    const stageRect = mirrorShellRef.current.getBoundingClientRect()

    if (stageRect.width <= 0 || stageRect.height <= 0) {
      return
    }

    pointerEvent.preventDefault()
    pointerEvent.stopPropagation()

    layoutInteractionRef.current = {
      panelId,
      mode,
      pointerId: pointerEvent.pointerId,
      startX: pointerEvent.clientX,
      startY: pointerEvent.clientY,
      startRect: mirrorLayoutStateRef.current[panelId],
      startState: mirrorLayoutStateRef.current,
      stageWidth: stageRect.width,
      stageHeight: stageRect.height,
    }

    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId)
  }, [layoutEditMode])

  const resetMirrorLayoutState = useCallback(() => {
    setMirrorLayoutState(DEFAULT_MIRROR_LAYOUT_STATE)
  }, [])

  const saveMirrorLayoutGlobally = useCallback(async () => {
    if (!isHost || !user?.id) {
      setMirrorWarningMessage('Sign in as host to hard-save the mirror layout globally.')
      return
    }

    setGlobalMirrorLayoutSaveBusy(true)

    try {
      await saveGlobalMirrorLayoutState(user.id, mirrorLayoutStateRef.current)
      setMirrorWarningMessage('Mirror layout hard-saved globally for this host.')
    } catch (error) {
      console.warn('MirrorPage: failed to save mirror layout globally', error)

      if (isMissingMirrorLayoutProfileColumnError(error)) {
        setMirrorWarningMessage('Global mirror layout save needs the latest profile migration.')
      } else {
        setMirrorWarningMessage('Could not hard-save the mirror layout globally. Please try again.')
      }
    } finally {
      setGlobalMirrorLayoutSaveBusy(false)
    }
  }, [isHost, user?.id])

  useEffect(() => {
    if (!mirrorLayoutOwnerId || !UUID_PATTERN.test(mirrorLayoutOwnerId)) {
      return
    }

    let isCurrent = true

    const hydrateGlobalMirrorLayout = async () => {
      try {
        const globalLayoutState = await loadGlobalMirrorLayoutState(mirrorLayoutOwnerId)

        if (!isCurrent || !globalLayoutState) {
          return
        }

        setMirrorLayoutState(globalLayoutState as any)
      } catch (error) {
        console.warn('MirrorPage: failed to load global mirror layout', error)
      }
    }

    void hydrateGlobalMirrorLayout()

    return () => {
      isCurrent = false
    }
  }, [mirrorLayoutOwnerId])

  const mirrorLayoutEditorStyles = useMemo(() => {
    if (!layoutEditMode) {
      return ''
    }

    return (Object.entries(mirrorLayoutState) as Array<[MirrorLayoutPanelId, MirrorLayoutRect]>)
      .map(([panelId, rect]) => (
        `[data-mirror-layout-panel="${panelId}"] { left: ${rect.left}%; top: ${rect.top}%; width: ${rect.width}%; height: ${rect.height}%; z-index: ${panelId === 'nowPlaying' ? 2 : 1}; }`
      ))
      .join('\n')
  }, [layoutEditMode, mirrorLayoutState])

  if (loading) {
    return (
      <div className="mirror-shell">
        <p className="mirror-loading">Connecting to stage…</p>
      </div>
    )
  }

  if (!hasCheckedMirrorNetworkAccess) {
    return (
      <div className="mirror-shell">
        <p className="mirror-loading">Checking secure mirror access…</p>
      </div>
    )
  }

  if (!isMirrorNetworkAllowed) {
    return (
      <div className="mirror-shell mirror-shell-paused" aria-label="Mirror access restricted">
        <section className="mirror-pre-show" aria-label="Mirror access blocked">
          <div className="mirror-pre-show-top">
            <h1 className="mirror-pre-show-title">Skærmen er låst 🔒</h1>
            <p className="mirror-pre-show-subtitle">
              Tilslut denne enhed til <strong>Drifter 5G</strong> eller <strong>Drifter 2,4</strong> for at se scenetavlen.
            </p>
            <p className="mirror-pre-show-subtitle mirror-pre-show-subtitle-secondary">
              Screen locked — connect to <strong>Drifter 5G</strong> or <strong>Drifter 2,4</strong> to view the mirror display.
            </p>
            <div className="mirror-countdown-card mirror-countdown-card-muted mirror-network-block-card" aria-label="Access rule">
              <p className="mirror-countdown-label">WiFi</p>
              <p className="mirror-countdown-value mirror-countdown-value-compact">Drifter 5G / Drifter 2,4</p>
            </div>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div ref={mirrorShellRef} className={`mirror-shell ${isLive ? 'mirror-shell-live' : 'mirror-shell-paused'} ${highContrastMode ? 'mirror-shell-high-contrast' : ''} ${castClarityMode ? 'mirror-shell-cast-clarity' : ''} ${densityMode === 'cinema' ? 'mirror-shell-density-cinema' : 'mirror-shell-density-medium'} mirror-shell-venue-${venueMode} ${!shouldShowEditorControls ? 'mirror-shell-hide-controls' : ''} ${!activeSong ? 'mirror-shell-no-live-data' : ''} ${(homeMirrorPreviewMode || demoMode) ? 'mirror-shell-home-preview' : ''}`} aria-label="Mirror display screen">
      {showFullscreenPrompt && !isFullscreen && (
        <button
          type="button"
          className="mirror-fullscreen-prompt"
          onClick={async () => {
            try {
              await requestFullscreenSafe(mirrorShellRef.current ?? document.documentElement)
              setShowFullscreenPrompt(false)
            } catch {
              setShowFullscreenPrompt(true)
              setMirrorWarningMessage('Fullscreen was blocked. Tap again or use browser fullscreen (F11).')
            }
          }}
        >
          <span className="mirror-fullscreen-prompt-icon">⛶</span>
          <span className="mirror-fullscreen-prompt-label">Tap to enter fullscreen</span>
        </button>
      )}
      {demoMode ? (
        <div className="mirror-demo-exit-bar">
          <span className="mirror-demo-exit-label">Demo Preview</span>
        </div>
      ) : null}
      <header className="mirror-header">
        <div className="mirror-header-kiosk-row">
          <div className="mirror-header-main">
            <p className="mirror-brand" aria-label="The Human Jukebox title">
              <img src="/the-human-jukebox-logo.svg" alt="The Human Jukebox" className="mirror-brand-logo" />
            </p>
            <p className="mirror-header-event-name">
              {event?.name?.trim() || 'Live Night - Ready to start.'}
            </p>
          </div>

          {event?.venueLogoUrl ? (
            <div className="mirror-venue-logo-slot" aria-label="Venue logo slot">
              <p className="mirror-venue-logo" aria-label="Venue logo">
                <img
                  ref={venueLogoImageRef}
                  src={event.venueLogoUrl}
                  alt={`${event.venue || 'Venue'} logo`}
                  className={`mirror-venue-logo-image ${getVenueLogoAppearanceClassName(venueLogoAppearance)}`}
                />
              </p>
            </div>
          ) : null}

          <div className="mirror-header-live-stack">
            {!hideControlsForAudience ? (
              <p className="mirror-edge-cast-hint" role="note">Edge cast tip: menu (three dots), then Cast media to device, then Sources, then Cast tab.</p>
            ) : null}
            {mirrorWarning ? (
              <p className="mirror-warning" role="status">{mirrorWarning}</p>
            ) : (
              <p className="mirror-warning mirror-warning-hidden" aria-hidden="true">Placeholder</p>
            )}
          </div>
        </div>
        {shouldShowEditorControls ? (
          <div className="mirror-editor-controls" aria-label="Mirror editor controls">
            <button
              type="button"
              className="mirror-fullscreen-button"
              aria-label={isFullscreen ? 'Exit fullscreen mode' : 'Enter fullscreen mode'}
              aria-keyshortcuts="F"
              title="Keyboard shortcut: F"
              onClick={async () => {
                try {
                  if (!getActiveFullscreenElement()) {
                    await requestFullscreenSafe(mirrorShellRef.current ?? document.documentElement)
                  } else {
                    await exitFullscreenSafe()
                  }
                } catch (error) {
                  console.warn('MirrorPage: fullscreen toggle failed', error)
                  setMirrorWarningMessage('Fullscreen was blocked by the browser or iframe policy. Open /mirror in its own tab, then press F11 as fallback.')
                }
              }}
            >
              <span className="mirror-control-button-icon" aria-hidden="true">FS</span>
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
            <button
              type="button"
              className="mirror-contrast-button"
              aria-label="Cast mirror using Edge"
              title="Cast using Edge"
              onClick={() => {
                void launchCastToScreen()
              }}
            >
              <span className="mirror-control-button-icon" aria-hidden="true">CS</span>
              Edge Cast
            </button>
            <button
              type="button"
              className={`mirror-contrast-button ${highContrastMode ? 'mirror-control-button-active' : ''}`.trim()}
              aria-label="Toggle high contrast mode"
              title="High contrast"
              onClick={() => setHighContrastMode((currentMode) => !currentMode)}
            >
              <span className="mirror-control-button-icon" aria-hidden="true">HC</span>
              {highContrastMode ? 'High Contrast: On' : 'High Contrast: Off'}
            </button>
            <button
              type="button"
              className={`mirror-contrast-button ${showSafeMargins ? 'mirror-control-button-active' : ''}`.trim()}
              aria-label="Toggle safe margins overlay"
              title="Safe margins"
              onClick={() => setShowSafeMargins((currentValue) => !currentValue)}
            >
              <span className="mirror-control-button-icon" aria-hidden="true">SM</span>
              {showSafeMargins ? 'Safe Margins: On' : 'Safe Margins: Off'}
            </button>
            <button
              type="button"
              className="mirror-contrast-button"
              aria-label="Cycle venue visual mode"
              title="Cycle venue mode"
              onClick={() => {
                setVenueMode((currentMode) => {
                  if (currentMode === 'club') {
                    return 'lounge'
                  }

                  if (currentMode === 'lounge') {
                    return 'festival'
                  }

                  return 'club'
                })
              }}
            >
              <span className="mirror-control-button-icon" aria-hidden="true">VM</span>
              Venue: {venueMode === 'club' ? 'Club' : venueMode === 'festival' ? 'Festival' : 'Lounge'}
            </button>
            <p className="mirror-control-shortcuts" aria-live="polite">
              Shortcuts: <strong>E</strong> edit mode, <strong>F</strong> fullscreen, <strong>C</strong> Edge cast, <strong>Esc</strong> exit fullscreen, <strong>Space</strong> now playing/quote mode.
            </p>
            <div className="mirror-banner-editor">
              <label className="mirror-banner-label" htmlFor="mirror-banner-input">📢 Scrolling Banner</label>
              <button
                type="button"
                className={`mirror-contrast-button ${isMirrorBannerEnabled ? 'mirror-control-button-active' : ''}`.trim()}
                aria-label="Toggle scrolling banner"
                title="Toggle scrolling banner"
                onClick={async () => {
                  const nextEnabled = !isMirrorBannerEnabled
                  setBannerEnabledOverride(nextEnabled)

                  if (demoMode || !event?.id) {
                    return
                  }

                  const { error } = await supabase
                    .from('events')
                    .update({ mirror_banner_enabled: nextEnabled })
                    .eq('id', event.id)

                  if (error) {
                    setBannerEnabledOverride(!nextEnabled)
                    setMirrorWarningMessage('Could not update mirror banner setting. Please try again.')
                  }
                }}
              >
                <span className="mirror-control-button-icon" aria-hidden="true">BN</span>
                Banner: {isMirrorBannerEnabled ? 'On' : 'Off'}
              </button>
              <input
                id="mirror-banner-input"
                type="text"
                className="mirror-banner-input"
                placeholder="e.g. 🍺 2-for-1 beers - Happy hour - All night! (use - for flash text lines)"
                value={bannerText}
                maxLength={250}
                onChange={(e) => {
                  setBannerText(e.target.value)
                  saveTextToLocalStorage(MIRROR_BANNER_STORAGE_KEY, e.target.value)
                }}
              />
            </div>
          </div>
        ) : null}
      </header>

      {(isMirrorBannerEnabled && bannerText.trim()) ? (
        <div className="mirror-ticker-bar" aria-label="Bar offers and promotions">
          <div className="mirror-ticker-track">
            <span className="mirror-ticker-content">{bannerText.trim()}</span>
            <span className="mirror-ticker-content" aria-hidden="true">{bannerText.trim()}</span>
          </div>
        </div>
      ) : null}

      <main className={`mirror-stage ${(isLive || demoMode) ? 'mirror-stage-live' : ''}`}>
        {shouldShowPreShow ? (
          <section
            className={`mirror-pre-show ${showCountdown ? 'mirror-pre-show-has-countdown' : ''}`.trim()}
            aria-label="Pre-show welcome"
          >

            {showFinalCountdownOverlay ? (
              <div className="mirror-final-countdown-overlay" aria-live="assertive" aria-label="Final countdown">
                <p className="mirror-final-countdown-label">{countdownCopy.startingIn}</p>
                <p className="mirror-final-countdown-number">{finalCountdownSeconds}</p>
                <p className="mirror-final-countdown-subtitle">
                  {countdownStartLabel ? `${countdownCopy.scheduledPrefix} ${countdownStartLabel}` : countdownCopy.scheduledStart}
                </p>
              </div>
            ) : null}

            {/* ── TOP: headline + status ── */}
            <div className="mirror-pre-show-top">
              <h1 className="mirror-pre-show-title">Welcome to The Human Jukebox</h1>
              <p className="mirror-pre-show-subtitle">Get ready to sing, request your favorites, and shape tonight's setlist together.</p>
              {showCountdown ? (
                <div className="mirror-countdown-card" aria-label="Countdown to show start">
                  <p className="mirror-countdown-label">{countdownCopy.startingIn}</p>
                  <p className="mirror-countdown-value">{countdownLabel}</p>
                  {countdownStartLabel ? <p className="mirror-countdown-meta">{countdownCopy.scheduledPrefix} {countdownStartLabel}</p> : null}
                </div>
              ) : (event?.mirrorCountdownEnabled ?? true) && countdownStartLabel ? (
                <div className="mirror-countdown-card mirror-countdown-card-muted" aria-label="Scheduled show start">
                  <p className="mirror-countdown-label">{countdownCopy.scheduledStart}</p>
                  <p className="mirror-countdown-value mirror-countdown-value-compact">{countdownStartLabel}</p>
                </div>
              ) : null}
            </div>

            {/* ── MIDDLE: QR (left) + How it works (right) ── */}
            <div className="mirror-pre-show-middle">
              <div className="mirror-pre-show-qr-col">
                <img src={countdownQrUrl} alt="QR code for the audience request page" className="mirror-qr-image" />
                <p className="mirror-qr-label">Scan for the pints. Log in for the tunes.</p>
                {showCountdownQrLink ? <p className="mirror-qr-url">{countdownQrText}</p> : null}
              </div>
              <div className="mirror-pre-show-steps-col">
                <div className="mirror-how-it-works" aria-label="How it works">
                  <p className="mirror-how-it-works-label">How It Works</p>
                  <p>1. Scan the QR code with your phone.</p>
                  <p>2. Enter your name and join the audience room.</p>
                  <p>3. Open Song List and choose Human Jukebox or Karaoke.</p>
                  <p>4. Add requests and vote in Live Queue to move songs up.</p>
                </div>
              </div>
            </div>

            {/* ── FLASH TEXT: large flashing text block beneath QR ── */}
            {activeQrFlashText ? (
              <div className="mirror-countdown-flash-block" aria-live="polite" aria-label="Rotating prompt text">
                <p className="mirror-countdown-flash-text">{activeQrFlashText}</p>
              </div>
            ) : null}

            {/* ── BOTTOM: reserved for future features ── */}
            <div className="mirror-pre-show-bottom" />

          </section>
        ) : (
          <>
            {layoutEditMode ? <style>{`.mirror-layout-edit-canvas { position: fixed; inset: 0; z-index: 6; overflow: hidden; }\n${mirrorLayoutEditorStyles}`}</style> : null}
            {layoutEditMode ? (
              <div className="mirror-layout-edit-toolbar mirror-layout-edit-toolbar-compact" role="toolbar" aria-label="Mirror layout editor controls">
                <button type="button" className="mirror-layout-edit-button" onClick={resetMirrorLayoutState}>Reset</button>
                <button
                  type="button"
                  className="mirror-layout-edit-button"
                  onClick={() => { void saveMirrorLayoutGlobally() }}
                  disabled={globalMirrorLayoutSaveBusy}
                >
                  {globalMirrorLayoutSaveBusy ? 'Saving…' : 'Save Global'}
                </button>
                <button type="button" className="mirror-layout-edit-button mirror-layout-edit-button-primary" onClick={() => setLayoutEditMode(false)}>Done</button>
              </div>
            ) : null}
            <section
              ref={layoutEditMode ? mirrorLayoutStageRef : undefined}
              className={`mirror-kiosk-columns ${layoutEditMode ? 'mirror-layout-edit-canvas' : ''}`}
              aria-label="Now playing and live queue/feed"
            >
              <section
                className={`mirror-now-playing mirror-frame mirror-frame-now-playing ${isLive ? 'mirror-now-playing-live' : ''} ${isQuoteModeActive ? 'mirror-now-playing-between' : ''} ${layoutEditMode ? 'mirror-layout-edit-panel' : ''}`}
                data-mirror-layout-panel={layoutEditMode ? 'nowPlaying' : undefined}
              >
                {layoutEditMode ? (
                  <button
                    type="button"
                    className="mirror-layout-drag-handle"
                    aria-label="Drag now playing panel"
                    title="Drag to move"
                    onPointerDown={beginMirrorLayoutInteraction('nowPlaying', 'drag')}
                  >
                    Move
                  </button>
                ) : null}
                <p className="mirror-now-playing-band-label">Now Playing / Quote Mode</p>
                {isQuoteModeActive ? (
                  <div className="mirror-now-playing-track mirror-now-playing-track-idle" aria-label="Between songs">
                    <div className="mirror-now-playing-meta">
                      <p className="mirror-between-song-quote">{betweenSongQuoteIndex === 0 ? 'Welcome to the show.' : displayedBetweenSongMessage}</p>
                      {playbackTransitionStatusText || !activeSong ? (
                        <p className="mirror-song-waiting-note">{playbackTransitionStatusText ?? 'Waiting for next song...'}</p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="mirror-now-playing-track">
                    <div className="mirror-now-playing-artwork-slot">
                      {activeSong.cover_url && !failedCoverUrls[activeSong.cover_url] ? (
                        <img
                          src={activeSong.cover_url}
                          alt={`Cover art for ${activeSong.title}`}
                          className="mirror-now-playing-cover"
                          onError={() => onCoverLoadError(activeSong.cover_url)}
                        />
                      ) : activeSong.audience_sings ? (
                        <span className="mirror-now-playing-karaoke-mark" aria-label="Karaoke request">Karaoke</span>
                      ) : (
                        <span className="mirror-now-playing-karaoke-mark" aria-hidden="true">♪</span>
                      )}
                    </div>
                    <div className="mirror-now-playing-meta">
                      <div className="mirror-now-playing-topline">
                        <div className="mirror-now-playing-details">
                          <h1 className="mirror-title">
                            <span className="mirror-title-song">
                              {normalizeMirrorText(activeSong.title, 'Waiting for requests…')}
                            </span>
                          </h1>
                          <p className="mirror-artist">
                            {(() => {
                              const artistText = normalizeMirrorText(activeSong.artist, 'Unknown Artist')
                              return artistText.charAt(0).toUpperCase() + artistText.slice(1)
                            })()}
                          </p>
                        </div>

                        <span
                          className={`mirror-now-playing-signal ${activeSong.audience_sings ? 'mirror-now-playing-signal-karaoke' : 'mirror-now-playing-signal-band'}`.trim()}
                          aria-label={activeSong.audience_sings ? 'Karaoke request' : 'Band performance request'}
                        >
                          {activeSong.audience_sings ? 'Karaoke' : 'Band'}
                        </span>

                        <div className="mirror-now-playing-picker-slot">
                          {activeSongChosenByLine ? (
                            <p className={`mirror-picked-by ${activeSongChosenByAccentClass}`}>
                              {activeSongChosenByLine}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="mirror-song-fact-box" aria-live="polite">
                        <p className="mirror-song-fact-label">Now Playing</p>
                        <p key={`${activeSong.id}-${currentFactIndex}`} className="mirror-song-fact">
                          {currentSongFact}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {!layoutEditMode ? (
                  <a
                    className="mirror-now-playing-qr-panel"
                    href={audienceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label="Audience request page QR link"
                  >
                    <img src={audienceQrUrl} alt="QR code for the audience request page" className="mirror-now-playing-qr" />
                  </a>
                ) : null}
                {layoutEditMode ? (
                  <button
                    type="button"
                    className="mirror-layout-resize-handle"
                    aria-label="Resize now playing panel"
                    title="Drag to resize"
                    onPointerDown={beginMirrorLayoutInteraction('nowPlaying', 'resize')}
                  />
                ) : null}
              </section>

              <section
                className="mirror-kiosk-right"
                aria-label="Queue and community feed"
              >
                <section
                  className={`mirror-live-feed-frame mirror-frame ${layoutEditMode ? 'mirror-layout-edit-panel' : ''}`}
                  aria-label="Live feed frame"
                  data-mirror-layout-panel={layoutEditMode ? 'community' : undefined}
                >
                  {layoutEditMode ? (
                    <button
                      type="button"
                      className="mirror-layout-drag-handle"
                      aria-label="Drag live feed panel"
                      title="Drag to move"
                      onPointerDown={beginMirrorLayoutInteraction('community', 'drag')}
                    >
                      Move
                    </button>
                  ) : null}
                  {layoutEditMode ? (
                    <div className="mirror-layout-edit-feed-preview" aria-label="Live feed preview">
                      <div className="mirror-layout-edit-feed-preview-header">
                        <p className="mirror-layout-edit-feed-preview-eyebrow">Community</p>
                        <h2 className="mirror-layout-edit-feed-preview-title">Live Feed Messages</h2>
                      </div>
                      <div className="mirror-layout-edit-feed-preview-items">
                        <p>Use this block for audience messages.</p>
                        <p>Stretch it taller or wider until the feed feels right.</p>
                        <p>We can make the queue and community area share the bottom row.</p>
                      </div>
                    </div>
                  ) : (
                    <LiveFeedPanel mode="mirror" showComposer={false} title="Live Feed Messages" showModerationControls={shouldShowAdminElements && !hideControlsForAudience} emptyStateText="No messages yet - say hi!" />
                  )}
                  {layoutEditMode ? (
                    <button
                      type="button"
                      className="mirror-layout-resize-handle"
                      aria-label="Resize live feed panel"
                      title="Drag to resize"
                      onPointerDown={beginMirrorLayoutInteraction('community', 'resize')}
                    />
                  ) : null}
                </section>

                <section
                  className={`mirror-song-queue-frame mirror-frame mirror-up-next ${shouldCompactQueue ? 'mirror-up-next-compact' : ''} ${layoutEditMode ? 'mirror-layout-edit-panel' : ''}`}
                  aria-label="Song queue frame"
                  data-mirror-layout-panel={layoutEditMode ? 'queue' : undefined}
                >
                  {layoutEditMode ? (
                    <button
                      type="button"
                      className="mirror-layout-drag-handle"
                      aria-label="Drag song queue panel"
                      title="Drag to move"
                      onPointerDown={beginMirrorLayoutInteraction('queue', 'drag')}
                    >
                      Move
                    </button>
                  ) : null}
                  <p className="mirror-up-next-label">Song Queue</p>
                  {upNext.length > 0 ? (
                    <ol className="mirror-queue">
                      {upNext.map((song, index) => {
                        const queueChosenByLine = song.createdByName
                          ? (getChosenByLine(song.id, song.createdByName) ?? `Picked by ${song.createdByName}`)
                          : null
                        const queuePickedByText = queueChosenByLine ?? (isHostPick(song) ? HOST_PICKED_BY_FALLBACK : 'Picked by audience')
                        const queueChosenByAccentClass = getChosenByAccentClass(song.id)
                        const queuePickerClassName = `mirror-queue-picker mirror-queue-artist-picker${queueChosenByLine ? ` ${queueChosenByAccentClass}` : ''}`

                        return (
                          <li key={song.id} className={`mirror-queue-item ${index === 0 ? 'mirror-queue-item-next' : ''}`.trim()}>
                            <span className="mirror-queue-pos">{index + 1}</span>
                            {song.cover_url && !failedCoverUrls[song.cover_url] ? (
                              <img
                                src={song.cover_url}
                                alt={`Cover art for ${song.title}`}
                                className="mirror-queue-cover"
                                onError={() => onCoverLoadError(song.cover_url)}
                              />
                            ) : null}
                            <div className="mirror-queue-info">
                              <div className="mirror-queue-song-info">
                                <span className="mirror-queue-title">{normalizeMirrorText(song.title, 'Untitled Song')}</span>
                                <span className="mirror-queue-artist">{normalizeMirrorText(song.artist, 'Unknown Artist')}</span>
                              </div>
                              <span
                                className={`mirror-queue-signal ${song.audience_sings ? 'mirror-queue-signal-karaoke' : 'mirror-queue-signal-band'}`}
                                aria-label={song.audience_sings ? 'Karaoke request' : 'Band performance request'}
                              >
                                {song.audience_sings ? 'Karaoke' : 'Band'}
                              </span>
                              <span className={queuePickerClassName}>{queuePickedByText}</span>
                            </div>
                            <span className="mirror-queue-votes">+{song.votes_count}</span>
                          </li>
                        )
                      })}
                    </ol>
                  ) : (
                    <p className="mirror-empty-note">Queue is empty - request a song!</p>
                  )}
                  {layoutEditMode ? (
                    <button
                      type="button"
                      className="mirror-layout-resize-handle"
                      aria-label="Resize song queue panel"
                      title="Drag to resize"
                      onPointerDown={beginMirrorLayoutInteraction('queue', 'resize')}
                    />
                  ) : null}
                </section>
              </section>
            </section>
          </>
        )}
      </main>

      {showEncoreVoteOverlay ? (
        <aside className="mirror-encore-overlay" aria-live="polite" role="status">
          {showEncoreVotePrompt ? (
            <article className="mirror-encore-card mirror-encore-card-vote">
              <p className="mirror-encore-eyebrow">{encoreCopy.voteEyebrow}</p>
              <h2 className="mirror-encore-title">{encoreCopy.voteTitle}</h2>
              <p className="mirror-encore-body">{encoreCopy.voteBody}</p>
              <p className="mirror-encore-hint">{encoreCopy.acceptHint}</p>
              <p className="mirror-encore-candidate">
                {encoreCopy.topCandidateLabel}: <strong>{normalizeMirrorText(encoreCandidateSong?.title, 'Untitled Song')}</strong> - {normalizeMirrorText(encoreCandidateSong?.artist, 'Unknown Artist')} (+{encoreCandidateSong?.votes_count ?? 0})
              </p>
            </article>
          ) : null}

          {showEncoreClosingPrompt ? (
            <article className="mirror-encore-card mirror-encore-card-thanks">
              <p className="mirror-encore-eyebrow">{encoreCopy.closeEyebrow}</p>
              <p className="mirror-encore-thanks-message">{encoreCopy.closeMessage}</p>
              {upcomingEncoreEvent ? (
                <div className="mirror-encore-upcoming">
                  <p className="mirror-encore-upcoming-title">{encoreCopy.upcomingLabel}: {upcomingEncoreEvent.name}</p>
                  {upcomingEncoreStartLabel ? <p className="mirror-encore-upcoming-meta">{encoreCopy.whenLabel}: {upcomingEncoreStartLabel}</p> : null}
                  {upcomingEncoreEvent.venue?.trim() ? <p className="mirror-encore-upcoming-meta">{encoreCopy.whereLabel}: {upcomingEncoreEvent.venue}</p> : null}
                </div>
              ) : (
                <p className="mirror-encore-upcoming-meta">{encoreCopy.noUpcoming}</p>
              )}
              <p className="mirror-encore-see-you">{encoreCopy.seeYouAgain}</p>
            </article>
          ) : null}
        </aside>
      ) : null}

      {playbackState?.brbActive ? (
        <div className="mirror-brb-overlay" aria-live="polite" role="status">
          <div className="mirror-brb-copy">
            <p className="mirror-brb-icon" aria-hidden="true">🍺</p>
            <p className="mirror-brb-heading">On Break</p>
            <p className="mirror-brb-message">{playbackState.brbMessage?.trim() || DEFAULT_BRB_MESSAGE}</p>
          </div>
          <div className="mirror-brb-qr-panel">
            <img src={breakQrUrl} alt="QR code for break screen link" className="mirror-brb-qr-image" />
            <p className="mirror-brb-qr-label">Scan to join the lounge.</p>
            <p className="mirror-brb-qr-url">{breakQrCodeUrl}</p>
            {activeQrFlashText ? <p className="mirror-brb-qr-flash-line">{activeQrFlashText}</p> : null}
          </div>
        </div>
      ) : null}

      {showSpotlight && activeSpotlight ? (
        <aside className="mirror-photo-spotlight" aria-label="Live crowd photo spotlight">
          <figure className="mirror-polaroid" key={activeSpotlight.id}>
            <img src={activeSpotlight.imageDataUrl} alt={`Crowd photo by ${activeSpotlight.authorName}`} className="mirror-polaroid-photo" />
            <figcaption>
              <strong>{activeSpotlight.authorName}</strong>
              <span>{activeSpotlight.caption}</span>
            </figcaption>
          </figure>
          {queuedSpotlightCount > 0 ? (
            <p className="mirror-spotlight-queue-pill">
              {queuedSpotlightCount} more photo{queuedSpotlightCount === 1 ? '' : 's'} coming
            </p>
          ) : null}
        </aside>
      ) : null}

      {showSpotlight && flashActive ? <div className="mirror-spotlight-flash" aria-hidden="true" /> : null}
      {showSpotlight && showShutterFallbackPulse ? <div className="mirror-spotlight-fallback-pulse" aria-hidden="true" /> : null}
      {!isLive && showSafeMargins && shouldShowAdminElements ? <div className="mirror-safe-margins-overlay" aria-hidden="true" /> : null}
      {showMirrorDebugOverlay ? (
        <aside className="mirror-debug-badge" aria-label="Mirror debug telemetry">
          {mirrorDebugRows.map((row) => (
            <p key={row}>{row}</p>
          ))}
        </aside>
      ) : null}
    </div>
  )
}

// --- Welcome Overlay Logic ---

function MirrorPage() {
  const { event } = useQueueStore();
  const [showWelcome, setShowWelcome] = useState(false);
  const [hasShownWelcome, setHasShownWelcome] = useState(false);

  useEffect(() => {
    if (event?.roomOpen && !hasShownWelcome) {
      setShowWelcome(true);
      setHasShownWelcome(true);
      const timer = setTimeout(() => setShowWelcome(false), 15000); // Show for 15 seconds
      return () => clearTimeout(timer);
    }
  }, [event?.roomOpen, hasShownWelcome]);

  if (isMirrorLayoutEditRequest) {
    return <MirrorLayoutEditorPage />
  }
  return <>
    {/* Welcome overlay removed */}
    <MirrorPageContent />
  </>;
}

export default MirrorPage
