import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';

const GENIUS_API_BASE = 'https://api.genius.com';
const GENIUS_ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN;

const PROVIDER_BASE_SCORE = {
  genius: 100,
  musixmatch: 95,
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

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeComparable(value: string) {
  return normalizeText(value)
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

function stripArtistNoise(value: string) {
  return normalizeText(
    value
      .replace(/\b(feat\.?|ft\.?)\b.*$/i, ' ')
      .replace(/[,&/].*$/, ' '),
  );
}

function buildVariants(song: string, artist: string) {
  const songBase = normalizeText(song);
  const artistBase = normalizeText(artist);

  const titleVariants = Array.from(
    new Set([
      songBase,
      stripTitleNoise(songBase),
    ].filter(Boolean)),
  );

  const artistVariants = Array.from(
    new Set([
      artistBase,
      stripArtistNoise(artistBase),
    ].filter(Boolean)),
  );

  const pairs: Array<{ title: string; artist: string }> = [];

  for (const titleVariant of titleVariants) {
    for (const artistVariant of artistVariants) {
      pairs.push({ title: titleVariant, artist: artistVariant });
    }
  }

  if (titleVariants[0] && artistVariants[0]) {
    pairs.push({ title: artistVariants[0], artist: titleVariants[0] });
  }

  return Array.from(
    new Map(
      pairs
        .filter((pair) => pair.title && pair.artist)
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
    .replace(/\*\* This Lyrics is NOT for Commercial use \*\*[\s\S]*/g, '')
    .replace(/\r\n/g, '\n')
    .trim();

  return normalized.length > 0 ? normalized : null;
}

async function searchGeniusSong(title: string, artist: string): Promise<string | null> {
  if (!GENIUS_ACCESS_TOKEN) {
    return null;
  }

  const headers = { Authorization: `Bearer ${GENIUS_ACCESS_TOKEN}` };
  const queries = [
    `${title} ${artist}`,
    `${title}`,
    `${artist} ${title}`,
  ];

  for (const query of queries) {
    const url = `${GENIUS_API_BASE}/search?q=${encodeURIComponent(query)}`;

    try {
      const response = await fetchWithRetry(() => axios.get(url, { headers, timeout: 9000 }), 1);
      const hits = response.data?.response?.hits as Array<{
        result?: { url?: string; title?: string; full_title?: string; primary_artist?: { name?: string } };
      }> | undefined;

      let bestMatch: { url: string; score: number } | null = null;

      for (const hit of hits ?? []) {
        const hitUrl = hit.result?.url;
        if (!hitUrl) {
          continue;
        }

        const hitTitle = hit.result?.title ?? hit.result?.full_title ?? '';
        const hitArtist = hit.result?.primary_artist?.name ?? hit.result?.full_title ?? '';
        const titleOverlap = calculateTokenOverlapScore(title, hitTitle);
        const artistOverlap = calculateTokenOverlapScore(artist, hitArtist);
        const score = titleOverlap * 0.7 + artistOverlap * 0.3;

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { url: hitUrl, score };
        }
      }

      if (bestMatch && bestMatch.score >= 0.2) {
        return bestMatch.url;
      }
    } catch {
      // Continue with next query/source.
    }
  }

  return null;
}

async function scrapeGeniusLyrics(songUrl: string): Promise<string | null> {
  try {
    const response = await fetchWithRetry(() => axios.get(songUrl, { timeout: 9000 }), 1);
    const $ = cheerio.load(response.data);
    let lyrics = '';

    $('[data-lyrics-container="true"]').each((_, element: cheerio.Element) => {
      lyrics += `${$(element).text()}\n`;
    });

    return sanitizeLyrics(lyrics);
  } catch {
    return null;
  }
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

  try {
    const searchUrl = `https://api.musixmatch.com/ws/1.1/track.search?q_track=${encodeURIComponent(title)}&q_artist=${encodeURIComponent(artist)}&f_has_lyrics=1&s_track_rating=desc&apikey=${musixmatchApiKey}`;
    const searchResponse = await axios.get(searchUrl, { timeout: 9000 });
    const trackId = searchResponse.data?.message?.body?.track_list?.[0]?.track?.track_id;

    if (!trackId) {
      return null;
    }

    const lyricsUrl = `https://api.musixmatch.com/ws/1.1/track.lyrics.get?track_id=${trackId}&apikey=${musixmatchApiKey}`;
    const lyricsResponse = await axios.get(lyricsUrl, { timeout: 9000 });
    const lyrics = lyricsResponse.data?.message?.body?.lyrics?.lyrics_body;

    return sanitizeLyrics(lyrics);
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const song = normalizeText(String(req.query.song ?? ''));
  const artist = normalizeText(String(req.query.artist ?? ''));

  if (!song || !artist) {
    res.status(400).json({ error: 'Missing song or artist' });
    return;
  }

  const variants = buildVariants(song, artist);
  let bestCandidate: LyricsCandidate | null = null;

  for (const variant of variants) {
    const registerCandidate = (lyrics: string, source: ProviderName, confidenceScore: number) => {
      const candidate: LyricsCandidate = {
        lyrics,
        source,
        variant,
        qualityScore: scoreLyricsQuality(lyrics),
        confidenceScore,
      };

      if (!bestCandidate || scoreCandidate(candidate) > scoreCandidate(bestCandidate)) {
        bestCandidate = candidate;
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

    const geniusUrl = await searchGeniusSong(variant.title, variant.artist);
    if (geniusUrl) {
      const geniusLyrics = await scrapeGeniusLyrics(geniusUrl);
      if (geniusLyrics) {
        if (registerCandidate(geniusLyrics, 'genius', 12)) {
          break;
        }
      }
    }

    const musixmatchLyrics = await fetchMusixmatchLyrics(variant.title, variant.artist);
    if (musixmatchLyrics) {
      if (registerCandidate(musixmatchLyrics, 'musixmatch', 8)) {
        break;
      }
    }

    const auddLyrics = await fetchAudDLyrics(variant.title, variant.artist);
    if (auddLyrics) {
      if (registerCandidate(auddLyrics, 'audd', 7)) {
        break;
      }
    }

    const chartLyrics = await fetchChartLyrics(variant.title, variant.artist);
    if (chartLyrics) {
      if (registerCandidate(chartLyrics, 'chartlyrics', 5)) {
        break;
      }
    }

    const lyricsOvh = await fetchLyricsOvh(variant.title, variant.artist);
    if (lyricsOvh) {
      if (registerCandidate(lyricsOvh, 'lyrics.ovh', 3)) {
        break;
      }
    }
  }

  if (bestCandidate) {
    res.status(200).json({
      lyrics: bestCandidate.lyrics,
      source: bestCandidate.source,
      variant: bestCandidate.variant,
    });
    return;
  }

  res.status(404).json({ error: 'Lyrics not found in any source' });
}
