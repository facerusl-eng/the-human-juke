
import { useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { demoMode } from '../demo/demoMode';
import { useAuthStore } from '../state/authStore';
import { supabase } from '../lib/supabase';
import { cacheFoundLyrics, getAutoCachedLyrics, getLyricsPrefetchStatus, markLyricsNotFound } from '../lib/lyricsPrefetch';
import { normalizeAudienceLocale, readCommittedAudienceLocale, type AudienceLocale } from '../lib/audienceIdentity';
import {
  PLAYBACK_STATE_BROADCAST_CHANNEL,
  PLAYBACK_STATE_EVENT,
  PLAYBACK_STATE_STORAGE_KEY,
  readSharedPlaybackState,
  type SharedPlaybackState,
} from '../lib/playbackState';
import '../audience-karafun.css';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeLyricsInput(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function buildFallbackLyricsText(title: string, artist: string) {
  return [
    `${title} - ${artist}`,
    '',
    'Lyrics are not available from automatic providers yet.',
    'If you are the host, paste manual lyrics below to save this song for next time.',
  ].join('\n');
}

function getLyricsPageCopy(locale: AudienceLocale) {
  if (locale === 'da') {
    return {
      unknownArtist: 'Ukendt artist',
      missingSongTitle: 'Mangler sangtitel. Ga tilbage og abn sangteksten igen.',
      pasteLyricsFirst: 'Indsaet sangtekst forst.',
      savedLocalNotPersisted: 'Gemt lokalt, men kunne ikke gemmes pa sangen endnu.',
      manualSavedToSong: 'Manuel sangtekst gemt pa denne sang. Naeste gang hentes den automatisk.',
      localSaveFailed: 'Gemt lokalt, men sang-gemning fejlede denne gang.',
      manualSavedLocal: 'Manuel sangtekst gemt lokalt for denne titel/artist.',
      backToLounge: 'Tilbage til lounge',
      playbackUnaffectedHint: 'Tilbage-knappen starter eller stopper ikke Spotify.',
      singAlongTitlePrefix: 'Syng med til',
      lyricsSubtitle: 'Her er sangteksten til sangen, der spiller nu. Hop med nar du er klar.',
      loadingLyrics: 'Indlaeser sangtekst…',
      noLyricsAuto: 'Ingen sangtekst fundet automatisk lige nu.',
      manualFallbackAria: 'Manuel sangtekst fallback',
      manualFallbackTitle: 'Admin fallback: Indsaet sangtekst manuelt',
      manualFallbackCopy: 'API returnerede ikke sangtekst for denne sang. Indsaet og gem for at fortsaette.',
      manualFallbackPlaceholder: 'Indsaet sangtekst her...',
      saving: 'Gemmer…',
      saveManualLyrics: 'Gem manuel sangtekst',
    };
  }

  return {
    unknownArtist: 'Unknown artist',
    missingSongTitle: 'Missing song title. Please go back and open lyrics again.',
    pasteLyricsFirst: 'Paste lyrics first.',
    savedLocalNotPersisted: 'Saved locally, but could not persist to song record yet.',
    manualSavedToSong: 'Manual lyrics saved to this song. Next time it loads automatically.',
    localSaveFailed: 'Saved locally, but song persistence failed this time.',
    manualSavedLocal: 'Manual lyrics saved locally for this title/artist.',
    backToLounge: 'Back to Lounge',
    playbackUnaffectedHint: 'Going back does not start or stop Spotify.',
    singAlongTitlePrefix: 'Sing along with',
    lyricsSubtitle: 'These are the lyrics for the song playing right now. Jump in whenever you are ready.',
    loadingLyrics: 'Loading lyrics…',
    noLyricsAuto: 'No lyrics found automatically right now.',
    manualFallbackAria: 'Manual lyrics fallback',
    manualFallbackTitle: 'Admin fallback: Paste lyrics manually',
    manualFallbackCopy: 'API did not return lyrics for this song. Paste and save to continue.',
    manualFallbackPlaceholder: 'Paste lyrics here...',
    saving: 'Saving…',
    saveManualLyrics: 'Save Manual Lyrics',
  };
}

function normalizeSectionHeading(value: string) {
  const normalized = value.toLowerCase();

  if (normalized.includes('chorus') || normalized.includes('refrain') || normalized.includes('hook')) {
    return 'Chorus';
  }

  if (normalized.includes('verse')) {
    return 'Verse';
  }

  if (normalized.includes('bridge')) {
    return 'Bridge';
  }

  if (normalized.includes('solo') || normalized.includes('instrumental')) {
    return 'Solo';
  }

  return null;
}

function parseHeadingLine(line: string) {
  const trimmedLine = line.trim();

  if (!trimmedLine) {
    return null;
  }

  const bracketHeading = trimmedLine.match(/^\[([^\]]+)\]$/);
  if (bracketHeading) {
    const heading = normalizeSectionHeading(bracketHeading[1]);
    const numberMatch = bracketHeading[1].match(/\b(\d+)\b/);
    return heading ? `${heading}${numberMatch ? ` ${numberMatch[1]}` : ''}:` : null;
  }

  const plainHeading = trimmedLine.match(/^(verse|chorus|bridge|solo|instrumental|hook|refrain)(?:\s+(\d+))?\s*[:\-]?$/i);
  if (plainHeading) {
    const heading = normalizeSectionHeading(plainHeading[0]);
    return heading ? `${heading}${plainHeading[2] ? ` ${plainHeading[2]}` : ''}:` : null;
  }

  return null;
}

function annotateLyricsSections(rawLyrics: string) {
  return rawLyrics
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => parseHeadingLine(line) ?? line)
    .join('\n')
    .trim();
}

function renderKaraokeLyrics(text: string) {
  return text.split('\n').map((line, index) => {
    if (line.trim() === '') {
      return <br key={`br-${index}`} />;
    }
    const isHeading = line.trim().endsWith(':') && line.length < 40;
    return (
      <div key={`line-${index}`} className={isHeading ? 'karaoke-heading' : 'karaoke-line'}>
        {line}
      </div>
    );
  });
}

type TimedKaraokeWord = {
  text: string
  startMs: number | null
}

type TimedKaraokeLine = {
  text: string
  isHeading: boolean
  headingText: string | null
  lineStartMs: number | null
  words: TimedKaraokeWord[]
}

function parseTimestampToMs(rawValue: string | null | undefined) {
  const normalizedValue = (rawValue ?? '').trim()
  if (!normalizedValue) {
    return null
  }

  const match = normalizedValue.match(/^(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?$/)
  if (!match) {
    return null
  }

  const minutes = Number(match[1])
  const seconds = Number(match[2])
  const fractionalRaw = match[3] ?? '0'
  const fractionMultiplier = fractionalRaw.length === 3 ? 1 : 10
  const fractionMs = Number(fractionalRaw) * fractionMultiplier

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || !Number.isFinite(fractionMs)) {
    return null
  }

  return Math.max(0, Math.round((minutes * 60 + seconds) * 1000 + fractionMs))
}

function parseTimedKaraokeLines(text: string) {
  return text.split('\n').map<TimedKaraokeLine>((rawLine) => {
    const headingText = parseHeadingLine(rawLine)
    const normalizedRawLine = rawLine.replace(/\r/g, '')

    if (headingText) {
      return {
        text: headingText,
        isHeading: true,
        headingText,
        lineStartMs: null,
        words: [],
      }
    }

    let workingLine = normalizedRawLine
    let lineStartMs: number | null = null
    const leadingTimeMatches = Array.from(workingLine.matchAll(/^\[([^\]]+)\]/g))

    if (leadingTimeMatches.length > 0) {
      const firstLeadingTimestamp = parseTimestampToMs(leadingTimeMatches[0][1])
      if (firstLeadingTimestamp !== null) {
        lineStartMs = firstLeadingTimestamp
      }

      workingLine = workingLine.replace(/^(\[[^\]]+\])+\s*/, '')
    }

    const wordsWithTiming: TimedKaraokeWord[] = []
    const inlineTimedWordPattern = /<(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)>\s*([^<]+)/g
    const inlineTimedWords = Array.from(workingLine.matchAll(inlineTimedWordPattern))

    if (inlineTimedWords.length > 0) {
      for (const timedWord of inlineTimedWords) {
        const timestampMs = parseTimestampToMs(timedWord[1])
        const wordText = timedWord[2].trim()
        if (!wordText) {
          continue
        }
        wordsWithTiming.push({
          text: wordText,
          startMs: timestampMs,
        })
      }

      if (lineStartMs === null) {
        lineStartMs = wordsWithTiming[0]?.startMs ?? null
      }

      const cleanLineText = wordsWithTiming.map((word) => word.text).join(' ').trim()
      return {
        text: cleanLineText,
        isHeading: false,
        headingText: null,
        lineStartMs,
        words: wordsWithTiming,
      }
    }

    const plainWords = workingLine.trim().split(/\s+/).filter(Boolean).map((word) => ({
      text: word,
      startMs: null,
    }))

    return {
      text: workingLine.trim(),
      isHeading: false,
      headingText: null,
      lineStartMs,
      words: plainWords,
    }
  })
}

function getActiveTimedLyricsLineIndex(lines: TimedKaraokeLine[], elapsedMs: number) {
  const lyricLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !line.isHeading && line.text.length > 0)

  if (lyricLines.length === 0) {
    return -1
  }

  const timedLyricsLines = lyricLines.filter(({ line }) => Number.isFinite(line.lineStartMs))
  if (timedLyricsLines.length === 0) {
    return lyricLines[0].index
  }

  for (let index = timedLyricsLines.length - 1; index >= 0; index -= 1) {
    const currentLine = timedLyricsLines[index]
    const currentStart = currentLine.line.lineStartMs ?? 0
    const nextStart = timedLyricsLines[index + 1]?.line.lineStartMs ?? Number.POSITIVE_INFINITY

    if (elapsedMs >= currentStart && elapsedMs < nextStart) {
      return currentLine.index
    }
  }

  return elapsedMs < (timedLyricsLines[0].line.lineStartMs ?? 0)
    ? timedLyricsLines[0].index
    : timedLyricsLines[timedLyricsLines.length - 1].index
}

function renderTimedWords(line: TimedKaraokeLine, elapsedMs: number) {
  const hasWordTiming = line.words.some((word) => Number.isFinite(word.startMs))

  if (!hasWordTiming) {
    return line.text
  }

  return line.words.map((word, index) => {
    const wordStart = word.startMs ?? Number.POSITIVE_INFINITY
    const nextWordStart = line.words[index + 1]?.startMs ?? Number.POSITIVE_INFINITY
    const isSung = elapsedMs >= wordStart
    const isCurrent = elapsedMs >= wordStart && elapsedMs < nextWordStart

    return (
      <span
        key={`timed-word-${index}-${word.text}`}
        className={`lyrics-word${isSung ? ' is-sung' : ''}${isCurrent ? ' is-current' : ''}`}
      >
        {word.text}
        {index < line.words.length - 1 ? ' ' : ''}
      </span>
    )
  })
}

type KaraokeFocusBlock =
  | { kind: 'heading'; heading: string }
  | { kind: 'lyrics'; nowLine: string; nextLine: string | null }

function buildKaraokeFocusBlocks(text: string): KaraokeFocusBlock[] {
  const lines = text.split('\n')
  const blocks: KaraokeFocusBlock[] = []
  let pairBuffer: string[] = []

  const flushPairBuffer = () => {
    if (pairBuffer.length === 0) {
      return
    }

    for (let index = 0; index < pairBuffer.length; index += 2) {
      const nowLine = pairBuffer[index]
      const nextLine = pairBuffer[index + 1] ?? null
      blocks.push({ kind: 'lyrics', nowLine, nextLine })
    }

    pairBuffer = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      flushPairBuffer()
      continue
    }

    const isHeading = line.endsWith(':') && line.length < 40
    if (isHeading) {
      flushPairBuffer()
      blocks.push({ kind: 'heading', heading: line })
      continue
    }

    pairBuffer.push(rawLine)
  }

  flushPairBuffer()
  return blocks
}

function renderKaraokeFocusBlocks(text: string) {
  const blocks = buildKaraokeFocusBlocks(text)

  return blocks.map((block, index) => {
    if (block.kind === 'heading') {
      return (
        <div key={`focus-heading-${index}`} className="lyrics-focus-heading" aria-hidden="true">
          {block.heading}
        </div>
      )
    }

    return (
      <article key={`focus-lyrics-${index}`} className="lyrics-focus-card">
        <p className="lyrics-focus-label">Now</p>
        <p className="lyrics-focus-primary">{block.nowLine}</p>
        <p className="lyrics-focus-label">Next</p>
        <p className="lyrics-focus-secondary">{block.nextLine ?? '...'}</p>
      </article>
    )
  })
}

function sanitizeReturnPath(value: string | null | undefined) {
  const trimmedValue = (value ?? '').trim();

  if (!trimmedValue) {
    return null;
  }

  if (!trimmedValue.startsWith('/')) {
    return null;
  }

  if (trimmedValue.startsWith('//')) {
    return null;
  }

  return trimmedValue;
}

function resolveEventIdForLyrics(searchParams: URLSearchParams, returnToPath: string | null) {
  const directEventId = (searchParams.get('event') ?? '').trim();
  if (UUID_PATTERN.test(directEventId)) {
    return directEventId;
  }

  const returnPath = (returnToPath ?? '').trim();
  if (!returnPath.startsWith('/')) {
    return null;
  }

  try {
    const parsedUrl = new URL(returnPath, window.location.origin);
    const returnEventId = (parsedUrl.searchParams.get('event') ?? '').trim();
    return UUID_PATTERN.test(returnEventId) ? returnEventId : null;
  } catch {
    return null;
  }
}

function buildLyricsQueries(title: string, artist: string) {
  const normalizeQuotes = (value: string) => value
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const stripTitle = (value: string) => normalizeQuotes(value)
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/\b(feat\.?|ft\.?)\b.*$/i, ' ')
    .replace(/\b(remix|version|edit|live|acoustic)\b/gi, ' ')
    .replace(/\s*-\s*(official|lyrics?|video).*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const stripArtist = (value: string) => normalizeQuotes(value)
    .replace(/\b(feat\.?|ft\.?)\b.*$/i, ' ')
    .split(/\s(?:&|x|with|and)\s|,|\//i)[0]
    .replace(/\s+/g, ' ')
    .trim();

  const splitPrimary = (value: string) => normalizeQuotes(value)
    .split(/\s\/\s|\s-\s|\s\|\s|\//)[0]
    .replace(/\s+/g, ' ')
    .trim();

  const stripPunctuation = (value: string) => normalizeQuotes(value)
    .replace(/[.,!?:;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const titleVariants = Array.from(new Set([
    normalizeQuotes(title),
    stripTitle(title),
    splitPrimary(stripTitle(title)),
    stripPunctuation(stripTitle(title)),
  ].filter(Boolean)));

  const normalizedArtist = normalizeQuotes(artist);
  const artistVariants = normalizedArtist
    ? Array.from(new Set([
        normalizedArtist,
        stripArtist(normalizedArtist),
        splitPrimary(stripArtist(normalizedArtist)),
      ].filter(Boolean)))
    : [''];

  const queries: Array<{ t: string; a: string }> = [];
  for (const t of titleVariants) {
    for (const a of artistVariants) {
      queries.push({ t, a });
    }
  }

  if (titleVariants[0] && artistVariants[0]) {
    queries.push({ t: artistVariants[0], a: titleVariants[0] });
  }

  return Array.from(new Map(queries.map((query) => [`${query.t}::${query.a}`, query])).values());
}

export default function LyricsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const routeState = (location.state as {
    title?: string;
    artist?: string;
    audienceLocale?: AudienceLocale;
    returnTo?: string;
    librarySongId?: string | null;
  } | null) ?? null;
  const stateTitle = routeState?.title;
  const stateArtist = routeState?.artist;
  const returnToPath = sanitizeReturnPath(routeState?.returnTo || searchParams.get('returnTo'));
  const localeFromQuery = normalizeLyricsInput(searchParams.get('locale'));
  const audienceLocale = normalizeAudienceLocale(routeState?.audienceLocale || localeFromQuery || readCommittedAudienceLocale());
  const isGigControlReturnPath = Boolean(returnToPath?.startsWith('/admin/gig-control'));
  const isStageMode = searchParams.get('stage') === '1' || isGigControlReturnPath;
  const copy = getLyricsPageCopy(audienceLocale);
  const stateLibrarySongId = routeState?.librarySongId ?? null;
  const title = normalizeLyricsInput(stateTitle || searchParams.get('title'));
  const artist = normalizeLyricsInput(stateArtist || searchParams.get('artist'));
  const displayArtist = artist || copy.unknownArtist;
  const librarySongId = normalizeLyricsInput(stateLibrarySongId || searchParams.get('songId'));
  const { isHost } = useAuthStore();
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lyricsNotFound, setLyricsNotFound] = useState(false);
  const [manualLyricsInput, setManualLyricsInput] = useState('');
  const [manualSaveMessage, setManualSaveMessage] = useState<string | null>(null);
  const [savingManualLyrics, setSavingManualLyrics] = useState(false);
  const [timedElapsedMs, setTimedElapsedMs] = useState(0);
  const [playbackIsStarted, setPlaybackIsStarted] = useState<boolean | null>(null);
  const [playbackStartedAtMs, setPlaybackStartedAtMs] = useState<number | null>(null);

  const formattedLyrics = useMemo(() => {
    if (!lyrics) {
      return null;
    }

    return annotateLyricsSections(lyrics);
  }, [lyrics]);

  const timedKaraokeLines = useMemo(() => {
    if (!formattedLyrics) {
      return [] as TimedKaraokeLine[]
    }

    return parseTimedKaraokeLines(formattedLyrics)
  }, [formattedLyrics])

  const hasTimedKaraoke = useMemo(() => (
    timedKaraokeLines.some((line) => Number.isFinite(line.lineStartMs))
  ), [timedKaraokeLines])

  const stageLyricsDensityClass = useMemo(() => {
    if (!isStageMode || !formattedLyrics) {
      return '';
    }

    const nonEmptyLines = formattedLyrics.split('\n').filter((line) => line.trim().length > 0).length;
    const characterCount = formattedLyrics.replace(/\s+/g, ' ').trim().length;

    if (nonEmptyLines > 120 || characterCount > 5200) {
      return ' lyrics-stage-text-auto-fit-max';
    }

    if (nonEmptyLines > 88 || characterCount > 3600) {
      return ' lyrics-stage-text-auto-fit-more';
    }

    if (nonEmptyLines > 64 || characterCount > 2400) {
      return ' lyrics-stage-text-auto-fit';
    }

    return '';
  }, [formattedLyrics, isStageMode]);

  const lyricsEventId = useMemo(
    () => resolveEventIdForLyrics(searchParams, returnToPath),
    [returnToPath, searchParams],
  );

  useEffect(() => {
    if (!isStageMode || !lyricsEventId) {
      setPlaybackIsStarted(null);
      setPlaybackStartedAtMs(null);
      return;
    }

    let isCurrent = true;
    let playbackChannel: BroadcastChannel | null = null;

    const applyPlaybackState = (nextState: SharedPlaybackState | null | undefined) => {
      if (!isCurrent || !nextState) {
        return;
      }

      if (nextState.isStarted) {
        setPlaybackIsStarted(true);
        setPlaybackStartedAtMs((previousValue) => previousValue ?? Date.now());
      } else {
        setPlaybackIsStarted(false);
        setPlaybackStartedAtMs(null);
      }
    };

    const syncFromDb = async () => {
      const nextState = await readSharedPlaybackState(lyricsEventId);
      applyPlaybackState(nextState);
    };

    const onPlaybackStateEvent = (nextEvent: Event) => {
      const detail = (nextEvent as CustomEvent<{ eventId?: string; state?: SharedPlaybackState }>).detail;
      if (!detail || detail.eventId !== lyricsEventId) {
        return;
      }
      applyPlaybackState(detail.state ?? null);
    };

    const onStorageEvent = (nextEvent: StorageEvent) => {
      if (nextEvent.key !== PLAYBACK_STATE_STORAGE_KEY || !nextEvent.newValue) {
        return;
      }

      try {
        const detail = JSON.parse(nextEvent.newValue) as { eventId?: string; state?: SharedPlaybackState };
        if (detail.eventId !== lyricsEventId) {
          return;
        }
        applyPlaybackState(detail.state ?? null);
      } catch {
        // Ignore malformed cross-tab playback sync payloads.
      }
    };

    void syncFromDb();
    window.addEventListener(PLAYBACK_STATE_EVENT, onPlaybackStateEvent as EventListener);
    window.addEventListener('storage', onStorageEvent);

    if ('BroadcastChannel' in window) {
      playbackChannel = new BroadcastChannel(PLAYBACK_STATE_BROADCAST_CHANNEL);
      playbackChannel.onmessage = (messageEvent: MessageEvent<{ eventId?: string; state?: SharedPlaybackState }>) => {
        const detail = messageEvent.data;
        if (detail?.eventId !== lyricsEventId) {
          return;
        }
        applyPlaybackState(detail.state ?? null);
      };
    }

    return () => {
      isCurrent = false;
      window.removeEventListener(PLAYBACK_STATE_EVENT, onPlaybackStateEvent as EventListener);
      window.removeEventListener('storage', onStorageEvent);
      playbackChannel?.close();
    };
  }, [isStageMode, lyricsEventId]);

  useEffect(() => {
    if (!isStageMode || !hasTimedKaraoke) {
      setTimedElapsedMs(0)
      return
    }

    const firstTimedLineStartMs = timedKaraokeLines.find((line) => Number.isFinite(line.lineStartMs))?.lineStartMs ?? 0
    const startedAt = Date.now()

    setTimedElapsedMs(firstTimedLineStartMs)

    const timerId = window.setInterval(() => {
      if (playbackIsStarted === false) {
        setTimedElapsedMs(firstTimedLineStartMs)
        return
      }

      if (playbackIsStarted === true && playbackStartedAtMs) {
        setTimedElapsedMs(firstTimedLineStartMs + (Date.now() - playbackStartedAtMs))
        return
      }

      setTimedElapsedMs(firstTimedLineStartMs + (Date.now() - startedAt))
    }, 120)

    return () => {
      window.clearInterval(timerId)
    }
  }, [hasTimedKaraoke, isStageMode, timedKaraokeLines, playbackIsStarted, playbackStartedAtMs])

  const backButtonLabel = useMemo(() => {
    if (!isGigControlReturnPath) {
      return copy.backToLounge;
    }

    if (returnToPath?.includes('fullscreen=1') || returnToPath?.includes('view=focus')) {
      return 'Back to Control Board';
    }

    return 'Back to Gig Control';
  }, [copy.backToLounge, isGigControlReturnPath, returnToPath]);

  const backButtonHint = isGigControlReturnPath ? copy.playbackUnaffectedHint : null;

  const handleBackNavigation = useCallback(() => {
    if (returnToPath) {
      navigate(returnToPath);
      return;
    }

    navigate(-1);
  }, [navigate, returnToPath]);

  useEffect(() => {
    if (!title) {
      setError(copy.missingSongTitle);
      return;
    }

    setLoading(true);
    setError(null);
    setLyrics(null);
    setLyricsNotFound(false);
    setManualSaveMessage(null);
    setManualLyricsInput('');

    // First, check if host already saved manual lyrics directly on this library song.
    const loadLyrics = async () => {
      if (librarySongId && !demoMode) {
        try {
          const { data, error: fetchSongError } = await supabase
            .from('library_songs')
            .select('manual_lyrics')
            .eq('id', librarySongId)
            .maybeSingle();

          const songManualLyrics = typeof data?.manual_lyrics === 'string' ? data.manual_lyrics.trim() : '';

          if (!fetchSongError && songManualLyrics) {
            cacheFoundLyrics(title, artist, songManualLyrics);
            setLyrics(songManualLyrics);
            setLoading(false);
            return;
          }
        } catch {
          // Continue with cache/API fallback.
        }
      }

      // Check lyrics that were pre-fetched when the song was added to the queue.
    const autoCached = getAutoCachedLyrics(title, artist);
    if (autoCached) {
      setLyrics(autoCached.trim());
      setLyricsNotFound(false);
      setLoading(false);
      return;
    }

    // If prefetch previously failed, still retry now because provider/API
    // availability can change between queue-time and sing-along-time.
    const prefetchStatus = getLyricsPrefetchStatus(title, artist);
    void prefetchStatus;

      const tryAllSources = async () => {
      const queries = buildLyricsQueries(title, artist);

      for (const q of queries) {
        try {
          const params = new URLSearchParams({ song: q.t });
          if (q.a) {
            params.set('artist', q.a);
          }

          const res = await fetch(`/api/lyrics-genius?${params.toString()}`);

          if (!res.ok) {
            continue;
          }

          const data = await res.json();
          const resolvedLyrics = typeof data?.lyrics === 'string' ? data.lyrics.trim() : '';

          if (resolvedLyrics.length > 0) {
            cacheFoundLyrics(title, artist, resolvedLyrics);
            setLyrics(resolvedLyrics);
            setLyricsNotFound(false);
            setLoading(false);
            return;
          }
        } catch {
          // Continue trying variants.
        }
      }

      markLyricsNotFound(title, artist);
      setLyrics(buildFallbackLyricsText(title, artist));
      setLyricsNotFound(true);
      setLoading(false);
    };

      await tryAllSources();
    };

    void loadLyrics();
  }, [title, artist, librarySongId, copy.missingSongTitle]);

  const saveManualLyrics = async () => {
    const normalizedLyrics = manualLyricsInput.trim();

    if (!normalizedLyrics) {
      setManualSaveMessage(copy.pasteLyricsFirst);
      return;
    }

    setSavingManualLyrics(true);

    cacheFoundLyrics(title, artist, normalizedLyrics);

    if (librarySongId && !demoMode) {
      try {
        const { error: updateSongError } = await supabase
          .from('library_songs')
          .update({ manual_lyrics: normalizedLyrics })
          .eq('id', librarySongId);

        if (updateSongError) {
          setManualSaveMessage(copy.savedLocalNotPersisted);
        } else {
          setManualSaveMessage(copy.manualSavedToSong);
        }
      } catch {
        setManualSaveMessage(copy.localSaveFailed);
      }
    } else {
      setManualSaveMessage(copy.manualSavedLocal);
    }

    setLyrics(normalizedLyrics);
    setLyricsNotFound(false);
    setSavingManualLyrics(false);
  };

  return (
    <div className={`audience-lyrics-page${isStageMode ? ' lyrics-stage-view' : ''}`}>
      {isStageMode ? (
        <div className="lyrics-stage-toolbar">
          <div className="lyrics-stage-back-block">
            <button className="primary-button lyrics-stage-back-button" onClick={handleBackNavigation}>
              {backButtonLabel}
            </button>
            {backButtonHint ? <p className="lyrics-back-hint">{backButtonHint}</p> : null}
          </div>
          <div className="lyrics-stage-heading-block">
            <h1 className="audience-lyrics-title">{title} - {displayArtist}</h1>
            <p className="audience-lyrics-subtitle">Stage lyrics view</p>
          </div>
        </div>
      ) : (
        <>
          <button className="primary-button" onClick={handleBackNavigation}>
            {backButtonLabel}
          </button>
          {backButtonHint ? <p className="lyrics-back-hint">{backButtonHint}</p> : null}
          <h1 className="audience-lyrics-title">{copy.singAlongTitlePrefix} {title} - {displayArtist}</h1>
          <p className="audience-lyrics-subtitle">{copy.lyricsSubtitle}</p>
        </>
      )}
      {loading && <p>{copy.loadingLyrics}</p>}
      {error && <p className="error-text">{error}</p>}
      {lyricsNotFound ? (
        <p className="error-text">{copy.noLyricsAuto}</p>
      ) : null}

      {isHost && lyricsNotFound ? (
        <section className="lyrics-manual-entry" aria-label={copy.manualFallbackAria}>
          <h2>{copy.manualFallbackTitle}</h2>
          <p className="subcopy">{copy.manualFallbackCopy}</p>
          <textarea
            className="lyrics-manual-entry-input"
            value={manualLyricsInput}
            onChange={(event) => setManualLyricsInput(event.target.value)}
            placeholder={copy.manualFallbackPlaceholder}
            rows={10}
          />
          <button type="button" className="primary-button" onClick={() => { void saveManualLyrics(); }} disabled={savingManualLyrics}>
            {savingManualLyrics ? copy.saving : copy.saveManualLyrics}
          </button>
          {manualSaveMessage ? <p className="subcopy">{manualSaveMessage}</p> : null}
        </section>
      ) : null}

      {formattedLyrics ? (
        <div className={`audience-lyrics-text${isStageMode ? ` lyrics-stage-text${stageLyricsDensityClass}${hasTimedKaraoke ? ' lyrics-stage-text-timed' : ''}` : ''}`}>
          {isStageMode ? (() => {
            if (!hasTimedKaraoke) {
              return <div className="lyrics-stage-focus">{renderKaraokeFocusBlocks(formattedLyrics)}</div>
            }

            const activeLineIndex = getActiveTimedLyricsLineIndex(timedKaraokeLines, timedElapsedMs)
            const activeLine = activeLineIndex >= 0 ? timedKaraokeLines[activeLineIndex] : null

            const nextLine = activeLineIndex >= 0
              ? timedKaraokeLines.slice(activeLineIndex + 1).find((line) => !line.isHeading && line.text.length > 0) ?? null
              : null

            const headingForActiveLine = activeLineIndex > 0
              ? [...timedKaraokeLines.slice(0, activeLineIndex)].reverse().find((line) => line.isHeading)?.headingText ?? null
              : null

            if (!activeLine || activeLine.isHeading) {
              return <div className="lyrics-stage-focus">{renderKaraokeFocusBlocks(formattedLyrics)}</div>
            }

            return (
              <div className="lyrics-stage-focus lyrics-stage-focus-timed">
                {headingForActiveLine ? <div className="lyrics-focus-heading">{headingForActiveLine}</div> : null}
                <article className="lyrics-focus-card is-active">
                  <p className="lyrics-focus-label">Now</p>
                  <p className="lyrics-focus-primary is-timed">{renderTimedWords(activeLine, timedElapsedMs)}</p>
                  <p className="lyrics-focus-label">Next</p>
                  <p className="lyrics-focus-secondary">{nextLine?.text ?? '...'}</p>
                </article>
                <section className="lyrics-stage-full-timeline" aria-label="Full lyrics timeline">
                  {timedKaraokeLines.map((line, index) => {
                    if (line.isHeading) {
                      return (
                        <p key={`timeline-heading-${index}`} className="lyrics-timeline-heading">{line.headingText}</p>
                      )
                    }

                    const isActive = index === activeLineIndex
                    const isSung = index < activeLineIndex

                    return (
                      <p
                        key={`timeline-line-${index}`}
                        className={`lyrics-timeline-line${isActive ? ' is-active' : ''}${isSung ? ' is-sung' : ''}`}
                      >
                        {isActive ? renderTimedWords(line, timedElapsedMs) : line.text}
                      </p>
                    )
                  })}
                </section>
              </div>
            )
          })() : (
            renderKaraokeLyrics(formattedLyrics)
          )}
        </div>
      ) : null}
    </div>
  );
}
