// Genius Lyrics Proxy API (Node.js/Express)
// Usage: /api/lyrics-genius?song=TITLE&artist=ARTIST
// Requires GENIUS_ACCESS_TOKEN in environment variables

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const router = express.Router();

const GENIUS_API_BASE = 'https://api.genius.com';
const GENIUS_ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN;

// Helper: Search Genius for a song
async function searchGeniusSong(title, artist) {
  const query = encodeURIComponent(`${title} ${artist}`);
  const url = `${GENIUS_API_BASE}/search?q=${query}`;
  const headers = { Authorization: `Bearer ${GENIUS_ACCESS_TOKEN}` };
  const res = await axios.get(url, { headers });
  const hits = res.data.response.hits;
  if (!hits.length) return null;
  // Return the first hit's song page URL
  return hits[0].result.url;
}

// Helper: Scrape lyrics from Genius song page
async function scrapeGeniusLyrics(songUrl) {
  const res = await axios.get(songUrl);
  const $ = cheerio.load(res.data);
  // Genius lyrics are in <div data-lyrics-container="true">
  let lyrics = '';
  $('[data-lyrics-container="true"]').each((_, el) => {
    lyrics += $(el).text() + '\n';
  });
  return lyrics.trim();
}

// API endpoint
router.get('/', async (req, res) => {
  const { song, artist } = req.query;
  if (!song || !artist) {
    return res.status(400).json({ error: 'Missing song or artist' });
  }
  try {
    const songUrl = await searchGeniusSong(song, artist);
    if (!songUrl) {
      return res.status(404).json({ error: 'Song not found on Genius' });
    }
    const lyrics = await scrapeGeniusLyrics(songUrl);
    if (!lyrics) {
      return res.status(404).json({ error: 'Lyrics not found on Genius' });
    }
    res.json({ lyrics });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch lyrics', details: err.message });
  }
});

module.exports = router;
