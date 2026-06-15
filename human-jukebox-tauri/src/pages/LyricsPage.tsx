
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
const LYRICS_NUDGE_STORAGE_KEY = 'human-jukebox:lyrics-nudge-ms';
const LYRICS_NUDGE_MIN_MS = -2500;
const LYRICS_NUDGE_MAX_MS = 2500;

function clampLyricsNudgeMs(value: number) {
  return Math.max(LYRICS_NUDGE_MIN_MS, Math.min(LYRICS_NUDGE_MAX_MS, Math.round(value)));
}

function readLyricsNudgeMs() {
  if (typeof window === 'undefined') {
    return 0;
  }

  try {
    const rawValue = window.localStorage.getItem(LYRICS_NUDGE_STORAGE_KEY);
    if (!rawValue) {
      return 0;
    }

    const parsedValue = Number(rawValue);
    return Number.isFinite(parsedValue) ? clampLyricsNudgeMs(parsedValue) : 0;
  } catch {
    return 0;
  }
}

function saveLyricsNudgeMs(value: number) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(LYRICS_NUDGE_STORAGE_KEY, String(clampLyricsNudgeMs(value)));
  } catch {
    // Ignore storage failures.
  }
}

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

type BridgeLyricsRow = Record<string, unknown>;

function toNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function toComparable(value: unknown) {
  const text = toNonEmptyString(value);
  return text ? normalizeLyricsInput(text).toLowerCase() : null;
}

function toLooseComparable(value: unknown) {
  const text = toComparable(value);
  if (!text) {
    return null;
  }

  return text
    .replace(/[\[\](){}'".,!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function valuesLikelyMatch(left: string | null, right: string | null) {
  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  return left.includes(right) || right.includes(left);
}

function buildImportedLyricsTextFromSections(sections: unknown[]) {
  const blocks: string[] = [];

  sections.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }

    const section = entry as Record<string, unknown>;
    const sectionText = toNonEmptyString(section.text ?? section.lyrics ?? section.content);
    if (!sectionText) {
      return;
    }

    const explicitLabel = toNonEmptyString(section.imported_label ?? section.label ?? section.heading ?? section.name);
    const sectionType = toNonEmptyString(section.type) ?? 'Section';
    const order = typeof section.order === 'number' && Number.isFinite(section.order)
      ? Math.max(1, Math.floor(section.order))
      : index + 1;

    const normalizedLabel = explicitLabel ?? `${sectionType} ${order}`;
    const bracketedLabel = /^\[[^\]]+\]$/.test(normalizedLabel)
      ? normalizedLabel
      : `[${normalizedLabel}]`;

    blocks.push(`${bracketedLabel}\n${sectionText}`);
  });

  return blocks.length > 0 ? blocks.join('\n\n').trim() : null;
}

function extractImportedLyrics(row: BridgeLyricsRow) {
  const importedSections = Array.isArray(row.imported_sections)
    ? row.imported_sections
    : Array.isArray(row.sections)
      ? row.sections
      : null;

  const sectionText = importedSections ? buildImportedLyricsTextFromSections(importedSections) : null;
  if (sectionText) {
    return sectionText;
  }

  return toNonEmptyString(row.imported_raw_lyrics ?? row.raw_lyrics ?? row.lyrics ?? row.manual_lyrics);
}

function rowMatchesSong(row: BridgeLyricsRow, options: { title: string; artist: string; librarySongId: string | null }) {
  const normalizedRowTitle = toComparable(row.title ?? row.song_title);
  const normalizedRowArtist = toComparable(row.artist ?? row.song_artist);
  const looseRowTitle = toLooseComparable(row.title ?? row.song_title);
  const looseRowArtist = toLooseComparable(row.artist ?? row.song_artist);
  const normalizedTitle = normalizeLyricsInput(options.title).toLowerCase();
  const normalizedArtist = normalizeLyricsInput(options.artist).toLowerCase();
  const looseTitle = toLooseComparable(options.title);
  const looseArtist = toLooseComparable(options.artist);

  const rowSongId = toNonEmptyString(row.song_id ?? row.library_song_id ?? row.librarySongId ?? row.songId);
  if (options.librarySongId && rowSongId && options.librarySongId === rowSongId) {
    return true;
  }

  const titleMatched = valuesLikelyMatch(normalizedRowTitle, normalizedTitle)
    || valuesLikelyMatch(looseRowTitle, looseTitle);

  if (!titleMatched) {
    return false;
  }

  if (!normalizedArtist) {
    return true;
  }

  if (!normalizedRowArtist) {
    return true;
  }

  return valuesLikelyMatch(normalizedRowArtist, normalizedArtist)
    || valuesLikelyMatch(looseRowArtist, looseArtist);
}

async function loadImportedBridgeLyrics(params: {
  title: string;
  artist: string;
  librarySongId: string | null;
}) {
  const candidateTables = ['human_jukebox_lyrics', 'human_jukebox_ready_lyrics'];

  for (const tableName of candidateTables) {
    try {
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1000);

      if (error || !Array.isArray(data)) {
        continue;
      }

      const matchingRow = data.find((row) => rowMatchesSong(row as BridgeLyricsRow, params)) as BridgeLyricsRow | undefined;
      if (!matchingRow) {
        continue;
      }

      const importedLyrics = extractImportedLyrics(matchingRow);
      if (importedLyrics) {
        return importedLyrics;
      }
    } catch {
      // Try next candidate table.
    }
  }

  return null;
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
      manualEditTitle: 'Rediger sangtekst',
      manualEditCopy: 'Som host kan du redigere/tilfoje sangtekst her og gemme til senere.',
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
    manualEditTitle: 'Edit lyrics',
    manualEditCopy: 'As host, you can edit or add lyrics here and save them for later.',
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
    const headingText = bracketHeading[1].trim();
    return headingText.length > 0 ? `[${headingText}]` : null;
  }

  const plainHeading = trimmedLine.match(/^(verse|chorus|bridge|solo|instrumental|hook|refrain)(?:\s+(\d+))?\s*[:\-]?$/i);
  if (plainHeading) {
    const heading = normalizeSectionHeading(plainHeading[0]);
    return heading ? `[${heading}${plainHeading[2] ? ` ${plainHeading[2]}` : ''}]` : null;
  }

  return null;
}

function normalizeSectionLineBreaks(rawLyrics: string) {
  return rawLyrics
    .replace(/\r\n/g, '\n')
    .replace(/\]\s*\[/g, ']\n\n[')
    .replace(/(\[[^\]]+\])\s+(?=[^\n\[])/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function annotateLyricsSections(rawLyrics: string) {
  return normalizeSectionLineBreaks(rawLyrics)
    .split('\n')
    .map((line) => parseHeadingLine(line) ?? line)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderKaraokeLyrics(text: string) {
  return text.split('\n').map((line, index) => {
    if (line.trim() === '') {
      return <br key={`br-${index}`} />;
    }
    const trimmedLine = line.trim();
    const isHeading = (trimmedLine.endsWith(':') || /^\[[^\]]+\]$/.test(trimmedLine)) && trimmedLine.length < 60;
    return (
      <div key={`line-${index}`} className={isHeading ? 'karaoke-heading' : 'karaoke-line'}>
        {line}
      </div>
    );
  });
}

type LyricsSectionBlock = {
  heading: string | null
  lines: string[]
}

function buildLyricsSectionBlocks(text: string): LyricsSectionBlock[] {
  const blocks: LyricsSectionBlock[] = []
  let currentHeading: string | null = null
  let currentLines: string[] = []

  const flush = () => {
    if (currentLines.length === 0) {
      return
    }
    blocks.push({ heading: currentHeading, lines: [...currentLines] })
    currentLines = []
  }

  for (const rawLine of text.split('\n')) {
    const heading = parseHeadingLine(rawLine)
    if (heading) {
      flush()
      currentHeading = heading
      continue
    }
    currentLines.push(rawLine)
  }

  flush()
  return blocks
}

function renderLyricsSections(text: string) {
  const blocks = buildLyricsSectionBlocks(text)

  if (blocks.length <= 1) {
    return renderKaraokeLyrics(text)
  }

  return (
    <div className="lyrics-sections" aria-label="Lyrics sections">
      {blocks.map((block, index) => (
        <section key={`lyrics-section-${index}`} className="lyrics-section">
          {block.heading ? <h3 className="lyrics-section-heading">{block.heading}</h3> : null}
          <div className="lyrics-section-body">
            {block.lines.map((line, lineIndex) => (
              line.trim().length === 0
                ? <br key={`lyrics-section-${index}-line-${lineIndex}`} />
                : <p key={`lyrics-section-${index}-line-${lineIndex}`} className="lyrics-section-line">{line}</p>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
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

    const isHeading = (line.endsWith(':') || /^\[[^\]]+\]$/.test(line)) && line.length < 60
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
  const { user, isHost } = useAuthStore();
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
  const [lyricsNudgeMs, setLyricsNudgeMs] = useState(() => readLyricsNudgeMs());
  const [pedalConnected, setPedalConnected] = useState(false);
  const [pedalDeviceName, setPedalDeviceName] = useState<string | null>(null);
  const [pedalStatusText, setPedalStatusText] = useState<string | null>(null);
  const [pedalConnecting, setPedalConnecting] = useState(false);

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

  const effectiveTimedElapsedMs = useMemo(
    () => Math.max(0, timedElapsedMs + lyricsNudgeMs),
    [timedElapsedMs, lyricsNudgeMs],
  );

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

  useEffect(() => {
    saveLyricsNudgeMs(lyricsNudgeMs);
  }, [lyricsNudgeMs]);

  const applyLyricsNudge = useCallback((deltaMs: number) => {
    setLyricsNudgeMs((currentValue) => clampLyricsNudgeMs(currentValue + deltaMs));
  }, []);

  const resetLyricsNudge = useCallback(() => {
    setLyricsNudgeMs(0);
  }, []);

  const tapSyncLyrics = useCallback(() => {
    setPlaybackStartedAtMs(Date.now());
    setPlaybackIsStarted(true);
    setPedalStatusText('Lyrics synced to now.');
  }, []);

  useEffect(() => {
    if (!isStageMode) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const normalizedKey = (event.key ?? '').toLowerCase().trim();

      if (normalizedKey === 'arrowleft' || normalizedKey === 'j') {
        event.preventDefault();
        applyLyricsNudge(-100);
        return;
      }

      if (normalizedKey === 'arrowright' || normalizedKey === 'l') {
        event.preventDefault();
        applyLyricsNudge(100);
        return;
      }

      if (normalizedKey === 'arrowdown' || normalizedKey === 'k') {
        event.preventDefault();
        tapSyncLyrics();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [applyLyricsNudge, isStageMode, tapSyncLyrics]);

  const connectBluetoothPedal = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('hid' in navigator)) {
      setPedalStatusText('WebHID not available. Pair pedal as keyboard and use ArrowLeft/ArrowRight/Tap-Sync hotkeys.');
      return;
    }

    const hidApi = (navigator as unknown as { hid: { requestDevice: (options: { filters: Array<Record<string, unknown>> }) => Promise<Array<{ productName?: string; opened?: boolean; open?: () => Promise<void> }>> } }).hid;
    setPedalConnecting(true);

    try {
      const devices = await hidApi.requestDevice({ filters: [] });
      const firstDevice = devices[0];

      if (!firstDevice) {
        setPedalStatusText('No pedal selected.');
        return;
      }

      if (!firstDevice.opened && typeof firstDevice.open === 'function') {
        await firstDevice.open();
      }

      setPedalConnected(true);
      setPedalDeviceName(firstDevice.productName ?? 'Bluetooth pedal');
      setPedalStatusText('Pedal connected. Use pedal keys (ArrowLeft / ArrowRight / ArrowDown) to control lyric timing.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not connect pedal.';
      setPedalStatusText(message);
      setPedalConnected(false);
      setPedalDeviceName(null);
    } finally {
      setPedalConnecting(false);
    }
  }, []);

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
      // Prefer imported, sectioned lyrics synced from LyricStudio/Base44 if available.
      if (!demoMode && title) {
        const importedLyrics = await loadImportedBridgeLyrics({
          title,
          artist,
          librarySongId: librarySongId || null,
        });

        if (importedLyrics) {
          cacheFoundLyrics(title, artist, importedLyrics);
          setLyrics(importedLyrics);
          setManualLyricsInput(importedLyrics);
          setLyricsNotFound(false);
          setLoading(false);
          return;
        }
      }

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
            setManualLyricsInput(songManualLyrics);
            setLoading(false);
            return;
          }
        } catch {
          // Continue with cache/API fallback.
        }
      }

      // Then look for any previously saved manual lyrics for matching song metadata.
      if (!demoMode && title) {
        try {
          let metadataQuery = supabase
            .from('library_songs')
            .select('manual_lyrics')
            .not('manual_lyrics', 'is', null)
            .ilike('title', `%${title}%`)
            .limit(1)

          if (artist) {
            metadataQuery = metadataQuery.ilike('artist', `%${artist}%`)
          }

          const { data: metadataRows, error: metadataError } = await metadataQuery
          const metadataManualLyrics = typeof metadataRows?.[0]?.manual_lyrics === 'string'
            ? metadataRows[0].manual_lyrics.trim()
            : ''

          if (!metadataError && metadataManualLyrics) {
            cacheFoundLyrics(title, artist, metadataManualLyrics)
            setLyrics(metadataManualLyrics)
            setManualLyricsInput(metadataManualLyrics)
            setLyricsNotFound(false)
            setLoading(false)
            return
          }
        } catch {
          // Continue with cache/API fallback.
        }
      }

      // Check lyrics that were pre-fetched when the song was added to the queue.
    const autoCached = getAutoCachedLyrics(title, artist);
    if (autoCached) {
      const normalizedAutoCached = autoCached.trim();
      setLyrics(normalizedAutoCached);
      setManualLyricsInput(normalizedAutoCached);
      setLyricsNotFound(false);
      setLoading(false);
      return;
    }

    // If prefetch previously failed, still retry now because provider/API
    // availability can change between queue-time and sing-along-time.
    const prefetchStatus = getLyricsPrefetchStatus(title, artist);
    void prefetchStatus;

      const fetchLyricsCandidate = async (query: { t: string; a: string }) => {
        const params = new URLSearchParams({ song: query.t })
        if (query.a) {
          params.set('artist', query.a)
        }

        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(), 7000)

        try {
          const response = await fetch(`/api/lyrics-genius?${params.toString()}`, {
            signal: controller.signal,
            cache: 'no-store',
          })

          if (!response.ok) {
            return null
          }

          const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
          if (!contentType.includes('application/json')) {
            return null
          }

          const data = await response.json().catch(() => null)
          const resolvedLyrics = typeof data?.lyrics === 'string' ? data.lyrics.trim() : ''
          return resolvedLyrics.length > 0 ? resolvedLyrics : null
        } catch {
          return null
        } finally {
          window.clearTimeout(timeoutId)
        }
      }

      const tryAllSources = async () => {
      const queries = buildLyricsQueries(title, artist);

      for (let startIndex = 0; startIndex < queries.length; startIndex += 3) {
        const batch = queries.slice(startIndex, startIndex + 3)
        const results = await Promise.all(batch.map((query) => fetchLyricsCandidate(query)))
        const resolvedLyrics = results.find((result): result is string => typeof result === 'string' && result.trim().length > 0)

        if (resolvedLyrics) {
          cacheFoundLyrics(title, artist, resolvedLyrics);
          setLyrics(resolvedLyrics);
          setManualLyricsInput(resolvedLyrics);
          setLyricsNotFound(false);
          setLoading(false);
          return;
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

    try {
      let persistedSongId: string | null = librarySongId || null

      if (!persistedSongId && !demoMode && title) {
        let findSongQuery = supabase
          .from('library_songs')
          .select('id')
          .ilike('title', `%${title}%`)
          .limit(1)

        if (artist) {
          findSongQuery = findSongQuery.ilike('artist', `%${artist}%`)
        }

        if (user?.id) {
          findSongQuery = findSongQuery.eq('host_id', user.id)
        }

        const { data: songRows } = await findSongQuery
        persistedSongId = typeof songRows?.[0]?.id === 'string' ? songRows[0].id : null
      }

      if (persistedSongId && !demoMode) {
        const { error: updateSongError } = await supabase
          .from('library_songs')
          .update({ manual_lyrics: normalizedLyrics })
          .eq('id', persistedSongId)

        if (updateSongError) {
          setManualSaveMessage(copy.savedLocalNotPersisted)
        } else {
          setManualSaveMessage(copy.manualSavedToSong)
        }
      } else {
        setManualSaveMessage(copy.manualSavedLocal)
      }
    } catch {
      setManualSaveMessage(copy.localSaveFailed)
    } finally {
      setLyrics(normalizedLyrics)
      setLyricsNotFound(false)
      setSavingManualLyrics(false)
    }
  };

  return (
    <div className={`audience-lyrics-page${isStageMode ? ' lyrics-stage-view' : ''}`}>
      {isStageMode ? (
        <div className="lyrics-stage-toolbar">
          {isHost ? (
            <div className="lyrics-stage-back-block">
              <button className="primary-button lyrics-stage-back-button" onClick={handleBackNavigation}>
                {backButtonLabel}
              </button>
              {backButtonHint ? <p className="lyrics-back-hint">{backButtonHint}</p> : null}
            </div>
          ) : null}
          <div className="lyrics-stage-heading-block">
            <h1 className="audience-lyrics-title">{title} - {displayArtist}</h1>
            <p className="audience-lyrics-subtitle">Stage lyrics view</p>
            {isHost ? (
              <div className="lyrics-pedal-controls" aria-label="Lyrics pedal controls">
                <div className="lyrics-pedal-row">
                  <button type="button" className="primary-button lyrics-pedal-connect" onClick={() => { void connectBluetoothPedal(); }} disabled={pedalConnecting}>
                    {pedalConnecting ? 'Connecting pedal...' : 'Connect Bluetooth Pedal'}
                  </button>
                  <span className={`lyrics-pedal-state${pedalConnected ? ' is-connected' : ''}`}>
                    {pedalConnected ? `Connected: ${pedalDeviceName ?? 'Pedal'}` : 'Not connected'}
                  </span>
                </div>
                <div className="lyrics-pedal-row lyrics-nudge-row">
                  <button type="button" className="primary-button lyrics-nudge-btn" onClick={() => applyLyricsNudge(-250)}>-250ms</button>
                  <button type="button" className="primary-button lyrics-nudge-btn" onClick={() => applyLyricsNudge(-100)}>-100ms</button>
                  <button type="button" className="primary-button lyrics-nudge-btn" onClick={tapSyncLyrics}>Tap Sync</button>
                  <button type="button" className="primary-button lyrics-nudge-btn" onClick={() => applyLyricsNudge(100)}>+100ms</button>
                  <button type="button" className="primary-button lyrics-nudge-btn" onClick={() => applyLyricsNudge(250)}>+250ms</button>
                  <button type="button" className="primary-button lyrics-nudge-btn" onClick={resetLyricsNudge}>Reset</button>
                </div>
                <p className="lyrics-pedal-hint">
                  Offset: {lyricsNudgeMs >= 0 ? '+' : ''}{lyricsNudgeMs}ms. Hotkeys: ArrowLeft/ArrowRight nudge, ArrowDown tap sync.
                </p>
                {pedalStatusText ? <p className="lyrics-pedal-hint">{pedalStatusText}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <h1 className="audience-lyrics-title">{copy.singAlongTitlePrefix} {title} - {displayArtist}</h1>
          <p className="audience-lyrics-subtitle">{copy.lyricsSubtitle}</p>
        </>
      )}
      {loading && <p>{copy.loadingLyrics}</p>}
      {error && <p className="error-text">{error}</p>}
      {lyricsNotFound ? (
        <p className="error-text">{copy.noLyricsAuto}</p>
      ) : null}

      {isHost && (lyricsNotFound || lyrics) ? (
        <section className="lyrics-manual-entry" aria-label={copy.manualFallbackAria}>
          <h2>{lyricsNotFound ? copy.manualFallbackTitle : copy.manualEditTitle}</h2>
          <p className="subcopy">{lyricsNotFound ? copy.manualFallbackCopy : copy.manualEditCopy}</p>
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
        <div className={`audience-lyrics-text${isStageMode ? ` lyrics-stage-text${stageLyricsDensityClass}${hasTimedKaraoke ? ' lyrics-stage-text-timed' : ''}` : ' audience-lyrics-text-sections'}`}>
          {isStageMode ? (() => {
            if (!hasTimedKaraoke) {
              return <div className="lyrics-stage-focus">{renderKaraokeFocusBlocks(formattedLyrics)}</div>
            }

            const activeLineIndex = getActiveTimedLyricsLineIndex(timedKaraokeLines, effectiveTimedElapsedMs)
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
                  <p className="lyrics-focus-primary is-timed">{renderTimedWords(activeLine, effectiveTimedElapsedMs)}</p>
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
                        {isActive ? renderTimedWords(line, effectiveTimedElapsedMs) : line.text}
                      </p>
                    )
                  })}
                </section>
              </div>
            )
          })() : renderLyricsSections(formattedLyrics)}
        </div>
      ) : null}
    </div>
  );
}
