import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';

const GENIUS_API_BASE = 'https://api.genius.com';
const GENIUS_ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN;
const MUSIXMATCH_API_BASE = 'https://api.musixmatch.com/ws/1.1';

const PROVIDER_BASE_SCORE = {
  musixmatch: 102,
  genius: 98,
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
};

type ResolvedLyricsResponse = {
  statusCode: 200;
  body: {
    lyrics: string;
    source: ProviderName;
    variant: VariantPair;
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

type LyricsCacheEntry = {
  expiresAt: number;
  result: LyricsHandlerResult;
};

const LYRICS_FOUND_CACHE_TTL_MS = 12 * 60 * 1000;
const LYRICS_NOT_FOUND_CACHE_TTL_MS = 2 * 60 * 1000;
const lyricsResponseCache = new Map<string, LyricsCacheEntry>();
const inFlightLyricsLookups = new Map<string, Promise<LyricsHandlerResult>>();

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
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

function countMatches(haystack: string, pattern: RegExp) {
  const matches = haystack.match(pattern);
  return matches ? matches.length : 0;
}

function detectLyricsLocale(lyrics: string): { locale: SupportedLyricsLocale; confidence: number } {
  const lower = lyrics.toLowerCase();

  const daSignals =
    countMatches(lower, /\b(og|jeg|det|du|ikke|der|har|med|for|til|den|de)\b/g)
    + (countMatches(lower, /[æøå]/g) * 1.5);

  const isSignals =
    countMatches(lower, /\b(og|eg|er|ekki|sem|med|til|thetta|thad|hja|vid)\b/g)
    + (countMatches(lower, /[ðþæö]/g) * 1.8);

  const enSignals = countMatches(lower, /\b(the|and|you|i|we|to|for|with|that|this|is|are)\b/g);

  const scores: Array<{ locale: SupportedLyricsLocale; score: number }> = [
    { locale: 'en', score: enSignals },
    { locale: 'da', score: daSignals },
    { locale: 'is', score: isSignals },
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
  const structureBonus = /\[[^\]]+\]/.test(lyrics) ? 6 : 0;

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

  return normalized.length > 0 ? normalized : null;
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

export function buildGeniusQueries(title: string, artist: string): string[] {
  const normalizedTitle = normalizeText(title);
  const normalizedArtist = normalizeText(artist);
  const cleanedTitle = cleanTitle(title);
  const cleanedArtist = cleanArtist(artist);

  const queries = [cleanedTitle, normalizedTitle];

  if (normalizedArtist) {
    queries.push(`"${normalizedTitle}" "${normalizedArtist}"`);
    queries.push(`${normalizedTitle} ${normalizedArtist}`);
  }

  if (cleanedArtist) {
    queries.push(`${cleanedTitle} ${cleanedArtist}`);
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

export function scoreGeniusResult(result: GeniusSearchHit, cleanedTitle: string, cleanedArtist: string): number {
  if (result.type !== 'song') {
    return -1000;
  }

  const candidateTitle = cleanTitle(result.result?.title ?? result.result?.full_title ?? '');
  const candidateArtist = cleanArtist(result.result?.primary_artist?.name ?? '');
  const titleSimilarity = similarityScore(candidateTitle, cleanedTitle);
  const artistSimilarity = similarityScore(candidateArtist, cleanedArtist);
  const titleOverlap = calculateTokenOverlapScore(cleanedTitle, candidateTitle);
  const artistOverlap = calculateTokenOverlapScore(cleanedArtist, candidateArtist);
  const url = result.result?.url ?? '';

  let score = 0;
  score += titleSimilarity * 62;
  score += artistSimilarity * 54;
  score += titleOverlap * 16;
  score += artistOverlap * 12;

  if (/\/lyrics(?:$|[?#])/i.test(url)) {
    score += 8;
  }

  return score;
}

export function extractLyricsFromHtml(html: string): string {
  const $ = cheerio.load(html);
  const lines: string[] = [];

  $('[data-lyrics-container="true"]').each((_, element) => {
    const text = normalizeText($(element).text());
    if (text) {
      lines.push(text);
    }
  });

  if (lines.length === 0) {
    const fallback = normalizeText($('.lyrics').text());
    if (fallback) {
      lines.push(fallback);
    }
  }

  return sanitizeLyrics(lines.join('\n')) ?? '';
}

export async function findLyrics(title: string, artist: string): Promise<GeniusLyricsResult | null> {
  if (!GENIUS_ACCESS_TOKEN) {
    return null;
  }

  const cleanedTitle = cleanTitle(title);
  const cleanedArtist = cleanArtist(artist);
  const queries = buildGeniusQueries(title, artist);
  const scoredHits: Array<{ hit: GeniusSearchHit; score: number; query: string; queryIndex: number }> = [];

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const query = queries[queryIndex];
    const hits = await searchGenius(query);

    for (const hit of hits) {
      const weightedScore = scoreGeniusResult(hit, cleanedTitle, cleanedArtist) - (queryIndex * 2.5);
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

  for (const candidate of uniqueCandidates) {
    const songUrl = candidate.hit.result?.url;
    if (!songUrl) {
      continue;
    }

    try {
      const response = await fetchWithRetry(() => axios.get(songUrl, { timeout: 9000 }), 1);
      const lyrics = extractLyricsFromHtml(String(response.data ?? ''));

      if (!lyrics) {
        continue;
      }

      return {
        lyrics,
        songUrl,
        query: candidate.query,
        score: candidate.score,
      };
    } catch {
      // Try the next best Genius candidate.
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
  const song = normalizeText(String(req.query.song ?? ''));
  const artist = normalizeText(String(req.query.artist ?? ''));
  const locale = normalizeLyricsLocale(req.query.locale);
  const debug = String(req.query.debug ?? '').toLowerCase();
  const includeDebug = debug === '1' || debug === 'true' || debug === 'yes';

  if (!song) {
    res.status(400).json({ error: 'Missing song' });
    return;
  }

  const cacheKey = cacheKeyForLyricsRequest(song, artist, locale);

  if (!includeDebug) {
    const cachedResult = readLyricsResponseCache(cacheKey);
    if (cachedResult) {
      res.status(cachedResult.statusCode).json(cachedResult.body);
      return;
    }
  }

  const resolveLyrics = async (): Promise<LyricsHandlerResult> => {
    const attempts: ProviderAttempt[] = [];
    const variants = buildVariants(song, artist);
    const bestCandidateRef: { current: LyricsCandidate | null } = { current: null };

    for (const variant of variants) {
      const markAttempt = (provider: ProviderName, ok: boolean, reason?: string) => {
        if (!includeDebug) {
          return;
        }

        attempts.push({
          variant,
          provider,
          ok,
          reason,
        });
      };

      const registerCandidate = (lyrics: string, source: ProviderName, confidenceScore: number) => {
        const titleOverlap = calculateTokenOverlapScore(song, variant.title);
        const artistOverlap = artist ? calculateTokenOverlapScore(artist, variant.artist) : 1;

      // Reject weak title/artist matches early to prevent wrong-song lyric snaps.
      if (titleOverlap < 0.5) {
        return false;
      }

      if (artist && artistOverlap < 0.28 && titleOverlap < 0.75) {
        return false;
      }

      const detectedLocale = detectLyricsLocale(lyrics);
      let localeBoost = 0;
      if (detectedLocale.locale === locale) {
        localeBoost += detectedLocale.confidence >= 0.48 ? 11 : 6;
      } else if (detectedLocale.confidence >= 0.58) {
        localeBoost -= 12;
      }

      const relevanceBoost = Math.round((titleOverlap * 22) + (artistOverlap * 14));
      const candidate: LyricsCandidate = {
        lyrics,
        source,
        variant,
        qualityScore: scoreLyricsQuality(lyrics),
        confidenceScore: confidenceScore + relevanceBoost + localeBoost,
      };

      if (!bestCandidateRef.current || scoreCandidate(candidate) > scoreCandidate(bestCandidateRef.current)) {
        bestCandidateRef.current = candidate;
      }

      // High-confidence winner: stop searching to keep latency low.
      if (source === 'genius' && candidate.qualityScore >= 25) {
        return true;
      }

      if (scoreCandidate(candidate) >= 135) {
        return true;
      }

      return false;
      };

      const musixmatchLyrics = await fetchMusixmatchLyrics(variant.title, variant.artist);
      if (musixmatchLyrics) {
        markAttempt('musixmatch', true);
        if (registerCandidate(musixmatchLyrics, 'musixmatch', 8)) {
          break;
        }
      } else {
        markAttempt('musixmatch', false, 'No lyrics returned');
      }

      const geniusMatch = await findLyrics(variant.title, variant.artist);
      if (geniusMatch?.lyrics) {
        markAttempt('genius', true);
        if (registerCandidate(geniusMatch.lyrics, 'genius', 12)) {
          break;
        }
      } else {
        markAttempt('genius', false, 'No high-confidence Genius match found');
      }

      const lrcLibLyrics = await fetchLrcLibLyrics(variant.title, variant.artist);
      if (lrcLibLyrics) {
        markAttempt('lrclib', true);
        if (registerCandidate(lrcLibLyrics, 'lrclib', 10)) {
          break;
        }
      } else {
        markAttempt('lrclib', false, 'No lyrics returned');
      }

      const auddLyrics = await fetchAudDLyrics(variant.title, variant.artist);
      if (auddLyrics) {
        markAttempt('audd', true);
        if (registerCandidate(auddLyrics, 'audd', 7)) {
          break;
        }
      } else {
        markAttempt('audd', false, 'No lyrics returned');
      }

      const chartLyrics = await fetchChartLyrics(variant.title, variant.artist);
      if (chartLyrics) {
        markAttempt('chartlyrics', true);
        if (registerCandidate(chartLyrics, 'chartlyrics', 5)) {
          break;
        }
      } else {
        markAttempt('chartlyrics', false, 'No lyrics returned');
      }

      const lyricsOvh = await fetchLyricsOvh(variant.title, variant.artist);
      if (lyricsOvh) {
        markAttempt('lyrics.ovh', true);
        if (registerCandidate(lyricsOvh, 'lyrics.ovh', 3)) {
          break;
        }
      } else {
        markAttempt('lyrics.ovh', false, 'No lyrics returned');
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
