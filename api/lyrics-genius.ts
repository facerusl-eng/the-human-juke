// Musixmatch fallback (requires MUSIXMATCH_API_KEY in env)
async function fetchMusixmatchLyrics(title: string, artist: string): Promise<string | null> {
  const MUSIXMATCH_API_KEY = process.env.MUSIXMATCH_API_KEY;
  if (!MUSIXMATCH_API_KEY) return null;
  try {
    // Step 1: Search for track ID
    const searchUrl = `https://api.musixmatch.com/ws/1.1/track.search?q_track=${encodeURIComponent(title)}&q_artist=${encodeURIComponent(artist)}&f_has_lyrics=1&s_track_rating=desc&apikey=${MUSIXMATCH_API_KEY}`;
    const searchRes = await axios.get(searchUrl);
    const trackList = searchRes.data?.message?.body?.track_list;
    if (!trackList || trackList.length === 0) return null;
    const trackId = trackList[0].track.track_id;
    // Step 2: Fetch lyrics by track ID
    const lyricsUrl = `https://api.musixmatch.com/ws/1.1/track.lyrics.get?track_id=${trackId}&apikey=${MUSIXMATCH_API_KEY}`;
    const lyricsRes = await axios.get(lyricsUrl);
    const lyrics = lyricsRes.data?.message?.body?.lyrics?.lyrics_body;
    if (lyrics && lyrics.trim().length > 0) {
      // Remove Musixmatch copyright footer if present
      return lyrics.replace(/\*\* This Lyrics is NOT for Commercial use \*\*[\s\S]*/g, '').trim();
    }
  } catch {}
  return null;
}
// Vercel Serverless Function for Genius Lyrics
import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';

const GENIUS_API_BASE = 'https://api.genius.com';
const GENIUS_ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN;


async function fetchWithRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function searchGeniusSong(title: string, artist: string): Promise<string | null> {
  const queries = [
    `${title} ${artist}`,
    `${title.replace(/\(.*?\)/g, '').trim()} ${artist}`,
    `${title} ${artist.replace(/feat\..*$/i, '').trim()}`,
    `${artist} ${title}`
  ];
  const headers = { Authorization: `Bearer ${GENIUS_ACCESS_TOKEN}` };
  for (const query of queries) {
    const url = `${GENIUS_API_BASE}/search?q=${encodeURIComponent(query)}`;
    try {
      const res = await fetchWithRetry(() => axios.get(url, { headers }), 2);
      const hits = res.data.response.hits;
      if (hits && hits.length) return hits[0].result.url;
    } catch {}
  }
  return null;
}
// ChartLyrics fallback
async function fetchChartLyrics(title: string, artist: string): Promise<string | null> {
  const url = `https://api.chartlyrics.com/apiv1.asmx/SearchLyricDirect?artist=${encodeURIComponent(artist)}&song=${encodeURIComponent(title)}`;
  try {
    const res = await axios.get(url);
    const match = res.data.match(/<Lyric>([\s\S]*?)<\/Lyric>/);
    if (match && match[1] && match[1].trim().length > 0) {
      return match[1].trim();
    }
  } catch {}
  return null;
}

// AudD fallback (requires AUDD_API_TOKEN in env)
async function fetchAudD(title: string, artist: string): Promise<string | null> {
  const AUDD_API_TOKEN = process.env.AUDD_API_TOKEN;
  if (!AUDD_API_TOKEN) return null;
  const url = `https://api.audd.io/findLyrics/?q=${encodeURIComponent(title + ' ' + artist)}&api_token=${AUDD_API_TOKEN}`;
  try {
    const res = await axios.get(url);
    if (res.data && res.data.result && res.data.result.length > 0 && res.data.result[0].lyrics) {
      return res.data.result[0].lyrics;
    }
  } catch {}
  return null;
}

async function scrapeGeniusLyrics(songUrl: string): Promise<string> {
  const res = await fetchWithRetry(() => axios.get(songUrl), 2);
  const $ = cheerio.load(res.data);
  let lyrics = '';
  $('[data-lyrics-container="true"]').each((_: number, el: cheerio.Element) => {
    lyrics += $(el).text() + '\n';
  });
  return lyrics.trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { song, artist } = req.query;
  if (!song || !artist) {
    res.status(400).json({ error: 'Missing song or artist' });
    return;
  }
  try {
    // Try Genius (with fuzzy search)
    const songUrl = await searchGeniusSong(String(song), String(artist));
    if (songUrl) {
      const lyrics = await scrapeGeniusLyrics(songUrl);
      if (lyrics) {
        res.json({ lyrics });
        return;
      }
    }
    // Try ChartLyrics
    const chartLyrics = await fetchChartLyrics(String(song), String(artist));
    if (chartLyrics) {
      res.json({ lyrics: chartLyrics });
      return;
    }
    // Try AudD
    const auddLyrics = await fetchAudD(String(song), String(artist));
    if (auddLyrics) {
      res.json({ lyrics: auddLyrics });
      return;
    }
    // Try Musixmatch
    const musixmatchLyrics = await fetchMusixmatchLyrics(String(song), String(artist));
    if (musixmatchLyrics) {
      res.json({ lyrics: musixmatchLyrics });
      return;
    }
    res.status(404).json({ error: 'Lyrics not found in any source' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch lyrics', details: err.message });
  }
}
