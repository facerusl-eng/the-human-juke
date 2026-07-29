import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { buildTrackCacheKey, buildTrackLookupVariants } from './lyrics-finder.js';

const GENIUS_API_BASE = 'https://api.genius.com';
const GENIUS_ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN;
const MUSIXMATCH_API_BASE = 'https://api.musixmatch.com/ws/1.1';

const PROVIDER_BASE_SCORE = {
  lyricfind: 104,
  musixmatch: 100,
  azlyrics: 88,
  lyricscom: 84,
  lyricwiki: 76,
  lrclib: 90,
  audd: 80,
  chartlyrics: 72,
  'lyrics.ovh': 65,
} as const;

type ProviderName = keyof typeof PROVIDER_BASE_SCORE;
type VariantPair = { title: string; artist: string };
type LyricsCandidate = {
  lyrics: string;
  source: ProviderName;
  variant: VariantPair;
  qualityScore: number;
  confidenceScore: number;
  matchedTitle?: string;
  matchedArtist?: string;
};

type ProviderAttempt = {
  variant: VariantPair;
  provider: ProviderName;
  ok: boolean;
  reason?: string;
};

type GeniusSearchHit = {
  type?: string;
  result?: {
    id?: number;
    url?: string;
    title?: string;
    full_title?: string;
    primary_artist?: { name?: string };
  };
};

type GeniusLyricsResult = {
  lyrics: string;
  songUrl: string;
  query: string;
  score: number;
  matchedTitle: string;
  matchedArtist: string;
};

type ResolvedLyricsResponse = {
  statusCode: 200;
  body: {
    lyrics: string;
    source: ProviderName;
    variant: VariantPair;
    track?: {
      title?: string;
      artist?: string;
    };
    debug?: {
      attemptedVariants: number;
      attemptedProviders: number;
      attempts: ProviderAttempt[];
    };
  };
};

type MissingLyricsResponse = {
  statusCode: 404;
  body: {
    error: string;
    debug?: {
      attemptedVariants: number;
      attemptedProviders: number;
      env: {
        hasGeniusToken: boolean;
        hasMusixmatchKey: boolean;
        hasAuddToken: boolean;
      };
      attempts: ProviderAttempt[];
    };
  };
};

type LyricsHandlerResult = ResolvedLyricsResponse | MissingLyricsResponse;
type SupportedLyricsLocale = 'en' | 'da' | 'is';
type DetectedLyricsLocale = SupportedLyricsLocale | 'es';

type LyricsCacheEntry = {
  expiresAt: number;
  result: LyricsHandlerResult;
};

const LYRICS_FOUND_CACHE_TTL_MS = 12 * 60 * 1000;
const LYRICS_NOT_FOUND_CACHE_TTL_MS = 2 * 60 * 1000;
// Overall budget for a single lyrics resolution. Vercel serverless functions
// have their own ceiling; we stop launching new work past this point and
// return the best candidate gathered so far instead of timing out empty.
const LYRICS_RESOLUTION_BUDGET_MS = 18 * 1000;
const lyricsResponseCache = new Map<string, LyricsCacheEntry>();
const inFlightLyricsLookups = new Map<string, Promise<LyricsHandlerResult>>();

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeLyricsWithLineBreaks(value: string) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasUsableLyricSignal(lyrics: string) {
  const normalized = normalizeLyricsWithLineBreaks(lyrics);
  if (!normalized) {
    return false;
  }

  const lower = normalized.toLowerCase();
  const htmlDocumentSignals = [
    '<!doctype html',
    '<html',
    '<head>',
    '<meta ',
    '<script',
    '<link rel=',
    '<body',
    'id="root"',
  ];

  if (htmlDocumentSignals.some((signal) => lower.includes(signal))) {
    return false;
  }

  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const wordCount = (normalized.match(/[\p{L}\p{N}']+/gu) ?? []).length;
  const alphaCount = (normalized.match(/[\p{L}]/gu) ?? []).length;
  const punctuationCount = (normalized.match(/[\[\]{}<>]/g) ?? []).length;

  if (normalized.length < 24) {
    return false;
  }

  if (lines.length < 2 && wordCount < 8) {
    return false;
  }

  if (alphaCount < 16) {
    return false;
  }

  // Reject mostly-markup payloads that occasionally slip through scrapers.
  if (punctuationCount > alphaCount * 0.25) {
    return false;
  }

  return true;
}

function hasStructuredSectionHeadings(lyrics: string) {
  return /\[(verse|chorus|pre[- ]?chorus|post[- ]?chorus|bridge|hook|refrain|intro|outro|solo|instrumental)\b[^\]]*\]/i.test(lyrics);
}

function normalizeLyricsLocale(value: unknown): SupportedLyricsLocale {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'da') {
    return 'da';
  }

  if (normalized === 'is') {
    return 'is';
  }

  return 'en';
}

function cacheKeyForLyricsRequest(song: string, artist: string, locale: SupportedLyricsLocale) {
  return `${normalizeComparable(song)}::${normalizeComparable(artist)}::${locale}`;
}

function cacheKeyForTrackRequest(track: { title?: string; artist?: string; album?: string; duration?: number }, locale: SupportedLyricsLocale) {
  return buildTrackCacheKey({ title: track.title, artist: track.artist, album: track.album, duration: track.duration }, locale);
}

function countMatches(haystack: string, pattern: RegExp) {
  const matches = haystack.match(pattern);
  return matches ? matches.length : 0;
}

function detectLyricsLocale(lyrics: string): { locale: DetectedLyricsLocale; confidence: number } {
  const lower = lyrics.toLowerCase();

  const daSignals =
    countMatches(lower, /\b(og|jeg|det|du|ikke|der|har|med|for|til|den|de)\b/g)
    + (countMatches(lower, /[æøå]/g) * 1.5);

  const isSignals =
    countMatches(lower, /\b(og|eg|er|ekki|sem|med|til|thetta|thad|hja|vid)\b/g)
    + (countMatches(lower, /[ðþæö]/g) * 1.8);

  const enSignals = countMatches(lower, /\b(the|and|you|i|we|to|for|with|that|this|is|are)\b/g);

  const esSignals =
    countMatches(lower, /\b(el|la|los|las|que|de|del|y|con|por|para|sin|eres|soy|siempre|lluvia)\b/g)
    + (countMatches(lower, /[áéíóúñü]/g) * 1.6);

  const scores: Array<{ locale: DetectedLyricsLocale; score: number }> = [
    { locale: 'en', score: enSignals },
    { locale: 'da', score: daSignals },
    { locale: 'is', score: isSignals },
    { locale: 'es', score: esSignals },
  ];

  scores.sort((left, right) => right.score - left.score);
  const best = scores[0];
  const total = scores[0].score + scores[1].score + scores[2].score;

  if (best.score <= 0 || total <= 0) {
    return { locale: 'en', confidence: 0 };
  }

  return {
    locale: best.locale,
    confidence: Math.min(1, best.score / total),
  };
}

function cloneLyricsHandlerResult(result: LyricsHandlerResult): LyricsHandlerResult {
  if (result.statusCode === 200) {
    const debug = result.body.debug
      ? {
          attemptedVariants: result.body.debug.attemptedVariants,
          attemptedProviders: result.body.debug.attemptedProviders,
          attempts: [...result.body.debug.attempts],
        }
      : undefined;

    return {
      statusCode: 200,
      body: {
        lyrics: result.body.lyrics,
        source: result.body.source,
        variant: { ...result.body.variant },
        ...(debug ? { debug } : {}),
      },
    };
  }

  const debug = result.body.debug
    ? {
        attemptedVariants: result.body.debug.attemptedVariants,
        attemptedProviders: result.body.debug.attemptedProviders,
        env: { ...result.body.debug.env },
        attempts: [...result.body.debug.attempts],
      }
    : undefined;

  return {
    statusCode: 404,
    body: {
      error: result.body.error,
      ...(debug ? { debug } : {}),
    },
  };
}

function readLyricsResponseCache(cacheKey: string): LyricsHandlerResult | null {
  const cached = lyricsResponseCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    lyricsResponseCache.delete(cacheKey);
    return null;
  }

  return cloneLyricsHandlerResult(cached.result);
}

function writeLyricsResponseCache(cacheKey: string, result: LyricsHandlerResult) {
  const ttlMs = result.statusCode === 200 ? LYRICS_FOUND_CACHE_TTL_MS : LYRICS_NOT_FOUND_CACHE_TTL_MS;
  lyricsResponseCache.set(cacheKey, {
    expiresAt: Date.now() + ttlMs,
    result: cloneLyricsHandlerResult(result),
  });
}

function normalizeQuotes(value: string) {
  return normalizeText(
    value
      .replace(/[\u2018\u2019\u2032]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-'),
  );
}

function stripDiacritics(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeComparable(value: string) {
  return normalizeText(stripDiacritics(value))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateTokenOverlapScore(expected: string, actual: string) {
  const expectedTokens = new Set(normalizeComparable(expected).split(' ').filter(Boolean));
  const actualTokens = new Set(normalizeComparable(actual).split(' ').filter(Boolean));

  if (expectedTokens.size === 0 || actualTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of expectedTokens) {
    if (actualTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(expectedTokens.size, actualTokens.size);
}

function scoreLyricsQuality(lyrics: string) {
  const lineCount = lyrics.split(/\n+/).filter((line) => line.trim().length > 0).length;
  const lengthScore = Math.min(30, lyrics.length / 45);
  const lineScore = Math.min(22, lineCount * 1.6);
  const structureBonus = hasStructuredSectionHeadings(lyrics) ? 14 : 0;

  return Math.round(lengthScore + lineScore + structureBonus);
}

function scoreCandidate(candidate: LyricsCandidate) {
  return PROVIDER_BASE_SCORE[candidate.source] + candidate.qualityScore + candidate.confidenceScore;
}

function stripTitleNoise(value: string) {
  return normalizeText(
    value
      .replace(/\(.*?\)/g, ' ')
      .replace(/\[.*?\]/g, ' ')
      .replace(/\b(feat\.?|ft\.?)\b.*$/i, ' ')
      .replace(/\s*-\s*(official|lyrics?|video).*$/i, ' '),
  );
}

function stripCommonTitleSuffixes(value: string) {
  return normalizeText(
    value
      .replace(/\s*-\s*(live|acoustic|karaoke|instrumental|remaster(?:ed)?(?:\s*\d{2,4})?|radio\s*edit|mono|stereo)\b.*$/i, ' ')
      .replace(/\b(live|acoustic|karaoke|instrumental|remaster(?:ed)?(?:\s*\d{2,4})?|radio\s*edit)\b/gi, ' ')
      .replace(/\b(from|original\s+motion\s+picture|motion\s+picture\s+soundtrack)\b.*$/i, ' '),
  );
}

function stripArtistNoise(value: string) {
  return normalizeText(
    value
      .replace(/\b(feat\.?|ft\.?)\b.*$/i, ' ')
      .replace(/[,&/].*$/, ' '),
  );
}

function buildVariants(song: string, artist: string) {
  const songBase = normalizeQuotes(song);
  const artistBase = normalizeQuotes(artist);

  const aliasMap: Record<string, VariantPair[]> = {
    "blowing in the wind:::mike denver": [{ title: "Blowin' in the Wind", artist: 'Bob Dylan' }],
    "seasons in the sun:::mike denver": [{ title: 'Seasons in the Sun', artist: 'Terry Jacks' }],
    "peaceful easy feeling:::johnny brady": [{ title: 'Peaceful Easy Feeling', artist: 'Eagles' }],
    "walk of life:::mike denver": [{ title: 'Walk of Life', artist: 'Dire Straits' }],
    "the gambler:::johnny brady": [{ title: 'The Gambler', artist: 'Kenny Rogers' }],
    "the streets of london:::mike denver": [{ title: 'Streets of London', artist: 'Ralph McTell' }],
    "whiskey in the jar:::mike denver": [{ title: 'Whiskey in the Jar', artist: 'Traditional' }],
    "who'll stop the rain:::john fogerty": [{ title: "Who'll Stop the Rain", artist: 'Creedence Clearwater Revival' }],
    "blinding lights:::tebey": [{ title: 'Blinding Lights', artist: 'The Weeknd' }],
    "summer of 69:::max jackson": [{ title: "Summer of '69", artist: 'Bryan Adams' }],
    "i'll make a man out of you:::mulan": [{ title: "I'll Make a Man Out of You", artist: 'Donny Osmond' }],
    "i'll make a man out of you:::mulan donny osmond": [{ title: "I'll Make a Man Out of You", artist: 'Donny Osmond' }],
    "pokemon theme:::pokemon": [{ title: 'Pokemon Theme', artist: 'Jason Paige' }],
    "shallow:::a star is born": [{ title: 'Shallow', artist: 'Lady Gaga' }],
    "shallow:::a star is born 2018 film lady gaga": [{ title: 'Shallow', artist: 'Lady Gaga' }],
    "shallow:::lady gaga": [{ title: 'Shallow', artist: 'Lady Gaga' }],
    "the grease mega mix:::grease": [{ title: 'The Grease Megamix', artist: 'Grease' }],
    "the grease mega mix:::grease film": [{ title: 'The Grease Megamix', artist: 'Grease' }],
    "blue moon of kentucky:::dwight yoakam": [{ title: 'Blue Moon of Kentucky', artist: 'Bill Monroe' }],
    "the wild rover:::the dubliners": [{ title: 'The Wild Rover', artist: 'Traditional' }],
    "you've got to hide your love away:::the beatles": [{ title: "You've Got to Hide Your Love Away", artist: 'Beatles' }],
    "the gambler:::mike denver": [{ title: 'The Gambler', artist: 'Kenny Rogers' }],
    "tie a yellow ribbon round the ole oak tree:::dean martin": [{ title: 'Tie a Yellow Ribbon Round the Ole Oak Tree', artist: 'Tony Orlando' }],
    "walk of life live mike denver the late late country special:::mike denver": [{ title: 'Walk of Life', artist: 'Dire Straits' }],
    "whiskey in the jar live:::mike denver": [{ title: 'Whiskey in the Jar', artist: 'Traditional' }],
    "medley the beatles rock:::medley covers": [{ title: 'Medley The Beatles', artist: 'The Beatles' }],
    "boing:::nik": [{ title: 'Boing', artist: 'Nik & Jay' }],
    "despacito:::luis fonsi": [{ title: 'Despacito', artist: 'Luis Fonsi' }],
    "det er mig der star herude og banker pa:::thomas helmig": [{ title: 'Det er mig der star herude og banker pa', artist: 'Thomas Helmig' }],
    "dick in my nightstand:::danae hays": [{ title: 'Dick in My Nightstand', artist: 'Danae Hays' }],
    "every day i have the blues:::joe williams": [{ title: 'Every Day I Have the Blues', artist: 'Joe Williams' }],
    "hvorfor gar louise til bal:::bamses venner": [{ title: 'Hvorfor gar Louise til bal', artist: 'Bamses Venner' }],
    "i en lille bad der gynger:::bamses venner": [{ title: 'I en lille bad der gynger', artist: 'Bamses Venner' }],
    "taender pa dig:::jakob sveistrup": [{ title: 'Taender pa dig', artist: 'Jakob Sveistrup' }],
    "vagner i natten:::dodo": [{ title: 'Vagner i natten', artist: 'Dodo & The Dodos' }],
    "will you still love me tomorrow:::carole king": [{ title: 'Will You Still Love Me Tomorrow', artist: 'Carole King' }],
    "you've got a friend:::carole king": [{ title: "You've Got a Friend", artist: 'Carole King' }],
    "you've got a friend:::james taylor": [{ title: "You've Got a Friend", artist: 'James Taylor' }],
    "ferdalok:::odinn valdimarsson": [{ title: 'Ferdalok', artist: 'Odinn Valdimarsson' }],
    "fram a nott:::nydonsk": [{ title: 'Fram a nott', artist: 'Nydonsk' }],
    "husid og eg:::sssol": [{ title: 'Husid Og Eg', artist: 'Sssol' }],
    "komdu i parti:::mannakorn": [{ title: 'Komdu I parti', artist: 'Mannakorn' }],
    "manst ekki eftir mer:::studmenn": [{ title: 'Manst ekki eftir mer', artist: 'Studmenn' }],
    "my way:::frank sinatra": [{ title: 'My Way', artist: 'Frank Sinatra' }, { title: 'My Way', artist: '' }],
    "my way live:::frank sinatra": [{ title: 'My Way', artist: 'Frank Sinatra' }, { title: 'My Way', artist: '' }],
    "reyndu aftur:::mannakorn": [{ title: 'Reyndu aftur', artist: 'Mannakorn' }],
    "taetum og tryllum:::studmenn": [{ title: 'Taetum og tryllum', artist: 'Studmenn' }],
    "vegbui:::kk": [{ title: 'Vegbui', artist: 'KK' }],
  };

  const aliasPairs: VariantPair[] = [];
  const aliasKey = `${normalizeComparable(songBase)}:::${normalizeComparable(artistBase)}`;
  const normalizedTitleOnly = normalizeComparable(stripTitleNoise(songBase));
  const normalizedArtistOnly = normalizeComparable(stripArtistNoise(artistBase));
  const relaxedAliasKey = `${normalizedTitleOnly}:::${normalizedArtistOnly}`;

  if (aliasMap[aliasKey]) {
    aliasPairs.push(...aliasMap[aliasKey]);
  }

  if (relaxedAliasKey !== aliasKey && aliasMap[relaxedAliasKey]) {
    aliasPairs.push(...aliasMap[relaxedAliasKey]);
  }

  const stripBrackets = (value: string) => normalizeText(
    value
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\[[^\]]*\]/g, ' '),
  );

  const splitPrimary = (value: string) => normalizeText(
    value
      .split(/\s\/\s|\s-\s|\s\|\s|\//)[0] ?? value,
  );

  const titleVariants = Array.from(
    new Set([
      songBase,
      stripTitleNoise(songBase),
      stripCommonTitleSuffixes(songBase),
      stripCommonTitleSuffixes(stripTitleNoise(songBase)),
      stripBrackets(songBase),
      splitPrimary(stripTitleNoise(songBase)),
    ].filter(Boolean)),
  );

  const artistVariants = Array.from(
    new Set([
      artistBase,
      stripArtistNoise(artistBase),
      stripBrackets(artistBase),
      splitPrimary(stripArtistNoise(artistBase)),
    ].filter(Boolean)),
  );

  if (artistVariants.length === 0) {
    artistVariants.push('');
  }

  const pairs: Array<{ title: string; artist: string }> = [];

  for (const titleVariant of titleVariants) {
    for (const artistVariant of artistVariants) {
      pairs.push({ title: titleVariant, artist: artistVariant });
    }
  }

  if (titleVariants[0] && artistVariants[0]) {
    pairs.push({ title: artistVariants[0], artist: titleVariants[0] });
  }

  pairs.push(...aliasPairs);

  return Array.from(
    new Map(
      pairs
        .filter((pair) => pair.title)
        .map((pair) => [`${pair.title}:::${pair.artist}`, pair]),
    ).values(),
  );
}

async function fetchWithRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function sanitizeLyrics(value: string | null | undefined) {
  const normalized = (value ?? '')
    .replace(/\*+\s*This Lyrics is NOT for Commercial use\s*\*+[\s\S]*/gi, '')
    .replace(/\r\n/g, '\n')
    .trim();

  const compactNormalized = normalizeLyricsWithLineBreaks(normalized);

  if (!hasUsableLyricSignal(compactNormalized)) {
    return null;
  }

  return compactNormalized.length > 0 ? compactNormalized : null;
}

export function cleanTitle(title: string): string {
  return normalizeText(
    String(title ?? '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\b(feat\.?|ft\.?|featuring)\b/gi, ' ')
      .replace(/\b(remix|version|edit|live|acoustic)\b/gi, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' '),
  );
}

export function cleanArtist(artist: string): string {
  const base = normalizeText(
    String(artist ?? '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\b(feat\.?|ft\.?|featuring)\b.*$/gi, ' '),
  );

  const primary = base
    .split(/\s(?:&|x|with|and)\s|,|\//i)
    .map((part) => normalizeText(part))
    .find(Boolean);

  return primary ?? '';
}

export function buildGeniusQueries(title: string, artist: string, queryHint?: string, album?: string): string[] {
  const normalizedTitle = normalizeText(title);
  const normalizedArtist = normalizeText(artist);
  const cleanedTitle = cleanTitle(title);
  const cleanedArtist = cleanArtist(artist);
  const normalizedHint = normalizeText(queryHint ?? '');
  const normalizedAlbum = normalizeText(album ?? '');

  const queries = [cleanedTitle, normalizedTitle];

  if (normalizedHint) {
    queries.push(normalizedHint);
  }

  if (normalizedArtist) {
    queries.push(`"${normalizedTitle}" "${normalizedArtist}"`);
    queries.push(`${normalizedTitle} ${normalizedArtist}`);
  }

  if (cleanedArtist) {
    queries.push(`${cleanedTitle} ${cleanedArtist}`);
  }

  if (normalizedAlbum) {
    queries.push(`${cleanedTitle} ${cleanedArtist} ${normalizedAlbum}`.trim());
    queries.push(`${normalizedTitle} ${normalizedAlbum}`.trim());
  }

  return Array.from(new Set(queries.map((query) => normalizeText(query)).filter(Boolean)));
}

export async function searchGenius(query: string): Promise<GeniusSearchHit[]> {
  if (!GENIUS_ACCESS_TOKEN) {
    return [];
  }

  const headers = { Authorization: `Bearer ${GENIUS_ACCESS_TOKEN}` };
  const url = `${GENIUS_API_BASE}/search?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetchWithRetry(() => axios.get(url, { headers, timeout: 9000 }), 1);
    const hits = response.data?.response?.hits as GeniusSearchHit[] | undefined;
    return Array.isArray(hits) ? hits : [];
  } catch {
    return [];
  }
}

function levenshteinDistance(left: string, right: string): number {
  const a = normalizeComparable(left);
  const b = normalizeComparable(right);

  if (a === b) {
    return 0;
  }

  if (!a.length) {
    return b.length;
  }

  if (!b.length) {
    return a.length;
  }

  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }

    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = curr[j];
    }
  }

  return prev[b.length];
}

function similarityScore(left: string, right: string): number {
  const normalizedLeft = normalizeComparable(left);
  const normalizedRight = normalizeComparable(right);

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  const distance = levenshteinDistance(normalizedLeft, normalizedRight);
  const longest = Math.max(normalizedLeft.length, normalizedRight.length);

  return longest > 0 ? 1 - (distance / longest) : 0;
}

function isVersionLikeTitle(value: string) {
  const normalized = normalizeComparable(value);
  if (!normalized) {
    return false;
  }

  return /(live|karaoke|tribute|cover|remix|remaster|sped up|slowed|acoustic|instrumental|translation|romanized)/i.test(normalized);
}

export function scoreGeniusResult(result: GeniusSearchHit, cleanedTitle: string, cleanedArtist: string, queryHint?: string): number {
  if (result.type !== 'song') {
    return -1000;
  }

  const candidateTitle = cleanTitle(result.result?.title ?? result.result?.full_title ?? '');
  const candidateArtist = cleanArtist(result.result?.primary_artist?.name ?? '');
  const titleSimilarity = similarityScore(candidateTitle, cleanedTitle);
  const artistSimilarity = similarityScore(candidateArtist, cleanedArtist);
  const titleOverlap = calculateTokenOverlapScore(cleanedTitle, candidateTitle);
  const artistOverlap = calculateTokenOverlapScore(cleanedArtist, candidateArtist);
  const queryHintOverlap = queryHint ? calculateTokenOverlapScore(queryHint, `${candidateTitle} ${candidateArtist}`) : 0;
  const url = result.result?.url ?? '';
  const exactTitleMatch = normalizeComparable(candidateTitle) === normalizeComparable(cleanedTitle);
  const exactArtistMatch = cleanedArtist ? normalizeComparable(candidateArtist) === normalizeComparable(cleanedArtist) : false;

  let score = 0;
  score += titleSimilarity * 62;
  score += artistSimilarity * 54;
  score += titleOverlap * 16;
  score += artistOverlap * 12;
  score += queryHintOverlap * 18;

  if (exactTitleMatch) {
    score += 14;
  }

  if (exactArtistMatch) {
    score += 10;
  }

  if (isVersionLikeTitle(candidateTitle) && !isVersionLikeTitle(cleanedTitle)) {
    score -= 12;
  }

  if (/\/lyrics(?:$|[?#])/i.test(url)) {
    score += 8;
  }

  return score;
}

export function extractLyricsFromHtml(html: string): string {
  const $ = cheerio.load(html);
  const lines: string[] = [];

  $('[data-lyrics-container="true"]').each((_, element) => {
    const containerHtml = $(element).html() ?? '';
    if (!containerHtml) {
      return;
    }

    const text = normalizeLyricsWithLineBreaks(
      cheerio.load(`<div>${containerHtml.replace(/<br\s*\/?>(\n)?/gi, '\\n')}</div>`)('div').text(),
    );

    if (text) {
      lines.push(text);
    }
  });

  if (lines.length === 0) {
    const fallback = normalizeLyricsWithLineBreaks($('.lyrics').text());
    if (fallback) {
      lines.push(fallback);
    }
  }

  return sanitizeLyrics(normalizeLyricsWithLineBreaks(lines.join('\n'))) ?? '';
}

export async function findLyrics(title: string, artist: string, searchHint: { query?: string; album?: string } = {}): Promise<GeniusLyricsResult | null> {
  if (!GENIUS_ACCESS_TOKEN) {
    return null;
  }

  const cleanedTitle = cleanTitle(title);
  const cleanedArtist = cleanArtist(artist);
  const queries = buildGeniusQueries(title, artist, searchHint.query, searchHint.album);
  const scoredHits: Array<{ hit: GeniusSearchHit; score: number; query: string; queryIndex: number }> = [];

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const query = queries[queryIndex];
    const hits = await searchGenius(query);

    for (const hit of hits) {
      const weightedScore = scoreGeniusResult(hit, cleanedTitle, cleanedArtist, query) - (queryIndex * 2.5);
      scoredHits.push({ hit, score: weightedScore, query, queryIndex });
    }
  }

  const bestCandidates = scoredHits
    .sort((left, right) => right.score - left.score)
    .filter((candidate) => candidate.score >= 22);

  if (bestCandidates.length === 0) {
    return null;
  }

  const uniqueCandidates: Array<{ hit: GeniusSearchHit; score: number; query: string; queryIndex: number }> = [];
  const seenUrls = new Set<string>();

  for (const candidate of bestCandidates) {
    const songUrl = candidate.hit.result?.url;
    if (!songUrl || seenUrls.has(songUrl)) {
      continue;
    }

    seenUrls.add(songUrl);
    uniqueCandidates.push(candidate);

    if (uniqueCandidates.length >= 4) {
      break;
    }
  }

  // Fetch the top candidate song pages in parallel instead of strictly
  // sequentially. This keeps latency low while still preferring the
  // highest-scored candidate that actually returns usable lyrics.
  const fetchedCandidates = await Promise.all(
    uniqueCandidates.map(async (candidate) => {
      const songUrl = candidate.hit.result?.url;
      if (!songUrl) {
        return null;
      }

      try {
        const response = await fetchWithRetry(() => axios.get(songUrl, { timeout: 8000 }), 1);
        const lyrics = extractLyricsFromHtml(String(response.data ?? ''));

        if (!lyrics) {
          return null;
        }

        return {
          lyrics,
          songUrl,
          query: candidate.query,
          score: candidate.score,
          matchedTitle: String(candidate.hit.result?.title ?? candidate.hit.result?.full_title ?? ''),
          matchedArtist: String(candidate.hit.result?.primary_artist?.name ?? ''),
        } satisfies GeniusLyricsResult;
      } catch {
        return null;
      }
    }),
  );

  // uniqueCandidates is already sorted best-first, so the first non-null
  // result is the highest-confidence match.
  for (const result of fetchedCandidates) {
    if (result) {
      return result;
    }
  }

  return null;
}

async function fetchLyricsOvh(title: string, artist: string): Promise<string | null> {
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;

  try {
    const response = await axios.get(url, { timeout: 9000 });
    return sanitizeLyrics(response.data?.lyrics);
  } catch {
    return null;
  }
}

async function fetchAzLyrics(title: string, artist: string): Promise<string | null> {
  const url = `https://search.azlyrics.com/search.php?q=${encodeURIComponent(`${title} ${artist}`)}`;

  try {
    const response = await axios.get(url, { timeout: 9000 });
    const match = String(response.data ?? '').match(/href="([^"]+)"[^>]*>[^<]*<b>[^<]*${escapeRegExp(title)}[^<]*<\/b>/i);
    const lyricUrl = match?.[1];
    if (!lyricUrl) {
      return null;
    }

    const lyricPage = await axios.get(lyricUrl, { timeout: 9000 });
    const lyricsMatch = String(lyricPage.data ?? '').match(/<div[^>]*class="[^"]*lyrics[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    return sanitizeLyrics(lyricsMatch?.[1]?.replace(/<br\s*\/?>/gi, '\n'));
  } catch {
    return null;
  }
}

async function fetchLyricsCom(title: string, artist: string): Promise<string | null> {
  const url = `https://www.lyrics.com/lyric/${encodeURIComponent(`${artist}/${title}`)}`;

  try {
    const response = await axios.get(url, { timeout: 9000 });
    const lyricsMatch = String(response.data ?? '').match(/<pre[^>]*class="[^"]*lyric-body[^"]*"[^>]*>([\s\S]*?)<\/pre>/i);
    return sanitizeLyrics(lyricsMatch?.[1]);
  } catch {
    return null;
  }
}

async function fetchLyricWiki(title: string, artist: string): Promise<string | null> {
  const url = `https://lyricwiki.org/${encodeURIComponent(artist)}:${encodeURIComponent(title)}`;

  try {
    const response = await axios.get(url, { timeout: 9000 });
    const lyricsMatch = String(response.data ?? '').match(/<div[^>]*id="lyric"[^>]*>([\s\S]*?)<\/div>/i);
    return sanitizeLyrics(lyricsMatch?.[1]?.replace(/<br\s*\/?>/gi, '\n'));
  } catch {
    return null;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchChartLyrics(title: string, artist: string): Promise<string | null> {
  const url = `https://api.chartlyrics.com/apiv1.asmx/SearchLyricDirect?artist=${encodeURIComponent(artist)}&song=${encodeURIComponent(title)}`;

  try {
    const response = await axios.get(url, { timeout: 9000 });
    const match = String(response.data ?? '').match(/<Lyric>([\s\S]*?)<\/Lyric>/);
    return sanitizeLyrics(match?.[1]);
  } catch {
    return null;
  }
}

async function fetchAudDLyrics(title: string, artist: string): Promise<string | null> {
  const auddToken = process.env.AUDD_API_TOKEN;

  if (!auddToken) {
    return null;
  }

  const url = `https://api.audd.io/findLyrics/?q=${encodeURIComponent(`${title} ${artist}`)}&api_token=${auddToken}`;

  try {
    const response = await axios.get(url, { timeout: 9000 });
    const lyrics = response.data?.result?.[0]?.lyrics;
    return sanitizeLyrics(lyrics);
  } catch {
    return null;
  }
}

async function fetchMusixmatchLyrics(title: string, artist: string): Promise<string | null> {
  const musixmatchApiKey = process.env.MUSIXMATCH_API_KEY;

  if (!musixmatchApiKey) {
    return null;
  }

  const cleanTimestampedLyrics = (value: string | null | undefined) => {
    if (!value) {
      return null;
    }

    const withoutTimestamps = value
      .replace(/\[\d{1,2}:\d{2}(?:\.\d{1,2})?\]/g, '')
      .replace(/\r\n/g, '\n');

    return sanitizeLyrics(withoutTimestamps);
  };

  const pickBestTrack = (tracks: Array<{ track?: { track_id?: number; track_name?: string; artist_name?: string } }> | undefined) => {
    let bestTrackId: number | null = null;
    let bestScore = -1;

    for (const trackWrapper of tracks ?? []) {
      const track = trackWrapper.track;
      const trackId = track?.track_id;
      if (!trackId) {
        continue;
      }

      const titleOverlap = calculateTokenOverlapScore(title, track.track_name ?? '');
      const artistOverlap = calculateTokenOverlapScore(artist, track.artist_name ?? '');
      const score = titleOverlap * 0.65 + artistOverlap * 0.35;

      if (score > bestScore) {
        bestScore = score;
        bestTrackId = trackId;
      }
    }

    return bestTrackId;
  };

  try {
    const matcherLyricsUrl = `${MUSIXMATCH_API_BASE}/matcher.lyrics.get?q_track=${encodeURIComponent(title)}&q_artist=${encodeURIComponent(artist)}&apikey=${musixmatchApiKey}`;
    const matcherLyricsResponse = await axios.get(matcherLyricsUrl, { timeout: 9000 });
    const matcherLyrics = matcherLyricsResponse.data?.message?.body?.lyrics?.lyrics_body;

    const directLyrics = sanitizeLyrics(matcherLyrics);
    if (directLyrics) {
      return directLyrics;
    }

    const searchUrl = `${MUSIXMATCH_API_BASE}/track.search?q_track=${encodeURIComponent(title)}&q_artist=${encodeURIComponent(artist)}&f_has_lyrics=1&s_track_rating=desc&page_size=8&apikey=${musixmatchApiKey}`;
    const searchResponse = await axios.get(searchUrl, { timeout: 9000 });
    const initialTrackId = pickBestTrack(searchResponse.data?.message?.body?.track_list);

    let trackId = initialTrackId;

    if (!trackId) {
      const trackOnlySearchUrl = `${MUSIXMATCH_API_BASE}/track.search?q_track=${encodeURIComponent(title)}&f_has_lyrics=1&s_track_rating=desc&page_size=8&apikey=${musixmatchApiKey}`;
      const trackOnlyResponse = await axios.get(trackOnlySearchUrl, { timeout: 9000 });
      trackId = pickBestTrack(trackOnlyResponse.data?.message?.body?.track_list);
    }

    if (!trackId) {
      const matcherSubtitleUrl = `${MUSIXMATCH_API_BASE}/matcher.subtitle.get?q_track=${encodeURIComponent(title)}&q_artist=${encodeURIComponent(artist)}&apikey=${musixmatchApiKey}`;
      const matcherSubtitleResponse = await axios.get(matcherSubtitleUrl, { timeout: 9000 });
      const subtitleBody = matcherSubtitleResponse.data?.message?.body?.subtitle?.subtitle_body;
      const subtitleLyrics = cleanTimestampedLyrics(subtitleBody);
      return subtitleLyrics;
    }

    const lyricsUrl = `${MUSIXMATCH_API_BASE}/track.lyrics.get?track_id=${trackId}&apikey=${musixmatchApiKey}`;
    const lyricsResponse = await axios.get(lyricsUrl, { timeout: 9000 });
    const lyrics = lyricsResponse.data?.message?.body?.lyrics?.lyrics_body;

    const resolvedLyrics = sanitizeLyrics(lyrics);
    if (resolvedLyrics) {
      return resolvedLyrics;
    }

    const subtitleUrl = `${MUSIXMATCH_API_BASE}/track.subtitle.get?track_id=${trackId}&apikey=${musixmatchApiKey}`;
    const subtitleResponse = await axios.get(subtitleUrl, { timeout: 9000 });
    const subtitleBody = subtitleResponse.data?.message?.body?.subtitle?.subtitle_body;

    return cleanTimestampedLyrics(subtitleBody);
  } catch {
    return null;
  }
}

async function fetchLrcLibLyrics(title: string, artist: string): Promise<string | null> {
  const directUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
  const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;

  const pickLyrics = (entry: { plainLyrics?: string; syncedLyrics?: string } | null | undefined) => {
    return sanitizeLyrics(entry?.plainLyrics ?? entry?.syncedLyrics ?? null);
  };

  try {
    const directResponse = await axios.get(directUrl, { timeout: 9000 });
    const directLyrics = pickLyrics(directResponse.data);
    if (directLyrics) {
      return directLyrics;
    }
  } catch {
    // Fallback to search endpoint below.
  }

  try {
    const searchResponse = await axios.get(searchUrl, { timeout: 9000 });
    const candidates = Array.isArray(searchResponse.data) ? searchResponse.data : [];

    let bestLyrics: string | null = null;
    let bestScore = -1;

    for (const candidate of candidates) {
      const candidateTitle = String(candidate?.trackName ?? '');
      const candidateArtist = String(candidate?.artistName ?? '');
      const candidateLyrics = pickLyrics(candidate);

      if (!candidateLyrics) {
        continue;
      }

      const titleOverlap = calculateTokenOverlapScore(title, candidateTitle);
      const artistOverlap = calculateTokenOverlapScore(artist, candidateArtist);
      const score = (titleOverlap * 0.65) + (artistOverlap * 0.35);

      if (score > bestScore) {
        bestScore = score;
        bestLyrics = candidateLyrics;
      }
    }

    return bestLyrics;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const song = normalizeText(String(req.query.song ?? ''));
  const artist = normalizeText(String(req.query.artist ?? ''));
  const album = normalizeText(String(req.query.album ?? ''));
  const duration = Number(req.query.duration ?? '');
  const locale = normalizeLyricsLocale(req.query.locale);
  const debug = String(req.query.debug ?? '').toLowerCase();
  const includeDebug = debug === '1' || debug === 'true' || debug === 'yes';

  if (!song) {
    res.status(400).json({ error: 'Missing song' });
    return;
  }

  const trackMetadata = { title: song, artist, album: album || undefined, duration: Number.isFinite(duration) ? duration : undefined };
  const cacheKey = cacheKeyForTrackRequest(trackMetadata, locale) || cacheKeyForLyricsRequest(song, artist, locale);

  if (!includeDebug) {
    const cachedResult = readLyricsResponseCache(cacheKey);
    if (cachedResult) {
      res.status(cachedResult.statusCode).json(cachedResult.body);
      return;
    }
  }

  const resolveLyrics = async (): Promise<LyricsHandlerResult> => {
    const deadline = Date.now() + LYRICS_RESOLUTION_BUDGET_MS;
    const attempts: ProviderAttempt[] = [];
    const metadataVariants = buildTrackLookupVariants(trackMetadata);
    const legacyVariants = buildVariants(song, artist);
    const variants = Array.from(new Map([...metadataVariants.map((variant) => [`variant:${variant.key}`, variant] as const), ...legacyVariants.map((variant) => [`legacy:${normalizeComparable(variant.title)}::${normalizeComparable(variant.artist)}`, variant] as const)]).values());
    const bestCandidateRef: { current: LyricsCandidate | null } = { current: null };

    for (const variant of variants) {
      // Respect the overall budget: if we are out of time, stop launching new
      // provider work and return the best candidate gathered so far.
      if (Date.now() >= deadline && bestCandidateRef.current) {
        break;
      }

      const markAttempt = (provider: ProviderName, ok: boolean, reason?: string) => {
        if (!includeDebug) {
          return;
        }

        attempts.push({
          variant: {
            title: variant.title ?? song,
            artist: variant.artist ?? artist,
          },
          provider,
          ok,
          reason,
        });
      };

      const registerCandidate = (
        lyrics: string,
        source: ProviderName,
        confidenceScore: number,
        context?: { titleOverlap?: number; artistOverlap?: number; matchedTitle?: string; matchedArtist?: string },
      ) => {
        const titleOverlap = context?.titleOverlap ?? calculateTokenOverlapScore(song, variant.title ?? song);
        const artistOverlap = context?.artistOverlap ?? (artist ? calculateTokenOverlapScore(artist, variant.artist ?? artist) : 1);

      const detectedLocale = detectLyricsLocale(lyrics);
      let localeBoost = 0;
      const sectionHeadingBoost = hasStructuredSectionHeadings(lyrics) ? 16 : 0;
      if (detectedLocale.locale === locale) {
        localeBoost += detectedLocale.confidence >= 0.48 ? 11 : 6;
      } else if (detectedLocale.confidence >= 0.58) {
        localeBoost -= 30;

        // Strong language mismatch: reject wrong-language candidate outright.
        if (detectedLocale.confidence >= 0.66) {
          return false;
        }
      }

      const relevanceBoost = Math.round((titleOverlap * 22) + (artistOverlap * 14));
      const candidate: LyricsCandidate = {
        lyrics,
        source,
        variant,
        qualityScore: scoreLyricsQuality(lyrics),
        confidenceScore: confidenceScore + relevanceBoost + localeBoost + sectionHeadingBoost,
        matchedTitle: context?.matchedTitle,
        matchedArtist: context?.matchedArtist,
      };

      if (!bestCandidateRef.current || scoreCandidate(candidate) > scoreCandidate(bestCandidateRef.current)) {
        bestCandidateRef.current = candidate;
      }

      // High-confidence winner: stop searching to keep latency low.
      if (source === 'lyricfind' && candidate.qualityScore >= 25) {
        return true;
      }

      if (scoreCandidate(candidate) >= 135) {
        return true;
      }

      return false;
      };

      const registerCandidateWithMatch = (
        lyrics: string,
        source: ProviderName,
        confidenceScore: number,
        matched?: { title?: string; artist?: string },
      ) => {
        const matchedTitle = normalizeText(String(matched?.title ?? ''));
        const matchedArtist = normalizeText(String(matched?.artist ?? ''));
        const referenceTitle = matchedTitle || variant.title || song;
        const referenceArtist = matchedArtist || variant.artist || artist;
        const titleOverlap = calculateTokenOverlapScore(song, referenceTitle);
        const artistOverlap = artist ? calculateTokenOverlapScore(artist, referenceArtist) : 1;

        // Reject weak title matches early; these are usually unrelated songs.
        if (titleOverlap < 0.54) {
          return false;
        }

        // When artist is provided, require stronger artist support unless title is near-exact.
        if (artist && artistOverlap < 0.36 && titleOverlap < 0.9) {
          return false;
        }

        return registerCandidate(
          lyrics,
          source,
          confidenceScore + Math.round((titleOverlap * 10) + (artistOverlap * 8)),
          { titleOverlap, artistOverlap, matchedTitle, matchedArtist },
        );
      };

      // Run every provider for this variant concurrently. Previously these were
      // awaited one-by-one with an early break, so a single slow/missing
      // provider delayed the whole chain and could exhaust the time budget
      // before faster, higher-quality providers were even tried.
      const providerFetchers: Array<{
        provider: ProviderName;
        confidence: number;
        fetch: () => Promise<{ lyrics: string | null; matchedTitle?: string; matchedArtist?: string }>;
      }> = [
        {
          provider: 'lyricfind',
          confidence: 12,
          fetch: async () => {
            const found = await findLyrics(variant.title ?? song, variant.artist ?? artist, { query: variant.query, album: variant.album });
            if (!found) {
              return { lyrics: null };
            }

            return {
              lyrics: found.lyrics,
              matchedTitle: found.matchedTitle,
              matchedArtist: found.matchedArtist,
            };
          },
        },
        { provider: 'musixmatch', confidence: 8, fetch: async () => ({ lyrics: await fetchMusixmatchLyrics(variant.title ?? song, variant.artist ?? artist) }) },
        { provider: 'azlyrics', confidence: 7, fetch: async () => ({ lyrics: await fetchAzLyrics(variant.title ?? song, variant.artist ?? artist) }) },
        { provider: 'lyricscom', confidence: 6, fetch: async () => ({ lyrics: await fetchLyricsCom(variant.title ?? song, variant.artist ?? artist) }) },
        { provider: 'lyricwiki', confidence: 5, fetch: async () => ({ lyrics: await fetchLyricWiki(variant.title ?? song, variant.artist ?? artist) }) },
        { provider: 'lrclib', confidence: 10, fetch: async () => ({ lyrics: await fetchLrcLibLyrics(variant.title ?? song, variant.artist ?? artist) }) },
        { provider: 'audd', confidence: 7, fetch: async () => ({ lyrics: await fetchAudDLyrics(variant.title ?? song, variant.artist ?? artist) }) },
        { provider: 'chartlyrics', confidence: 5, fetch: async () => ({ lyrics: await fetchChartLyrics(variant.title ?? song, variant.artist ?? artist) }) },
        { provider: 'lyrics.ovh', confidence: 3, fetch: async () => ({ lyrics: await fetchLyricsOvh(variant.title ?? song, variant.artist ?? artist) }) },
      ];

      const providerResults = await Promise.all(
        providerFetchers.map(async ({ provider, confidence, fetch }) => {
          try {
            const result = await fetch();
            return {
              provider,
              confidence,
              lyrics: result.lyrics,
              matchedTitle: result.matchedTitle,
              matchedArtist: result.matchedArtist,
            };
          } catch {
            return {
              provider,
              confidence,
              lyrics: null as string | null,
              matchedTitle: undefined,
              matchedArtist: undefined,
            };
          }
        }),
      );

      // Evaluate providers in priority order so that, on ties, the higher-rated
      // source wins and the confident-winner short circuit stays deterministic.
      let foundConfidentWinner = false;
      for (const { provider, confidence, lyrics, matchedTitle, matchedArtist } of providerResults) {
        if (lyrics) {
          markAttempt(provider, true);
          if (registerCandidateWithMatch(lyrics, provider, confidence, { title: matchedTitle, artist: matchedArtist })) {
            foundConfidentWinner = true;
          }
        } else {
          markAttempt(provider, false, 'No lyrics returned');
        }
      }

      if (foundConfidentWinner) {
        break;
      }
    }

    const resolvedBestCandidate = bestCandidateRef.current;

    if (resolvedBestCandidate) {
      return {
        statusCode: 200,
        body: {
          lyrics: resolvedBestCandidate.lyrics,
          source: resolvedBestCandidate.source,
          variant: resolvedBestCandidate.variant,
          track: {
            title: resolvedBestCandidate.matchedTitle || resolvedBestCandidate.variant.title,
            artist: resolvedBestCandidate.matchedArtist || resolvedBestCandidate.variant.artist,
          },
          ...(includeDebug
            ? {
                debug: {
                  attemptedVariants: variants.length,
                  attemptedProviders: attempts.length,
                  attempts,
                },
              }
            : {}),
        },
      };
    }

    return {
      statusCode: 404,
      body: {
        error: 'Lyrics not found in any source',
        ...(includeDebug
          ? {
              debug: {
                attemptedVariants: variants.length,
                attemptedProviders: attempts.length,
                env: {
                  hasGeniusToken: Boolean(GENIUS_ACCESS_TOKEN),
                  hasMusixmatchKey: Boolean(process.env.MUSIXMATCH_API_KEY),
                  hasAuddToken: Boolean(process.env.AUDD_API_TOKEN),
                },
                attempts,
              },
            }
          : {}),
      },
    };
  };

  const resultPromise = includeDebug
    ? resolveLyrics()
    : (() => {
        const existingInFlight = inFlightLyricsLookups.get(cacheKey);
        if (existingInFlight) {
          return existingInFlight;
        }

        const createdPromise = resolveLyrics()
          .then((result) => {
            writeLyricsResponseCache(cacheKey, result);
            return result;
          })
          .finally(() => {
            inFlightLyricsLookups.delete(cacheKey);
          });

        inFlightLyricsLookups.set(cacheKey, createdPromise);
        return createdPromise;
      })();

  const result = await resultPromise;
  res.status(result.statusCode).json(result.body);
}
