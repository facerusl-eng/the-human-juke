// Simple stub for /api/autogen-chart
export const config = {
  api: {
    bodyParser: false,
  },
};

export const config = {
  api: {
    bodyParser: false,
  },
};

import formidable from 'formidable';
import fs from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

// Helper to parse Gentle output into your app's format
function gentleToChart(gentleJson, lyrics) {
  // Gentle returns words with start/end, aligned to the transcript
  // We'll group by lines from the original lyrics
  const lyricLines = typeof lyrics === 'string' ? lyrics.split(/\r?\n/).filter(Boolean) : [];
  const words = gentleJson.words || [];
  let wordIdx = 0;
  const lines = lyricLines.map((line, idx) => {
    const lineWords = line.split(/\s+/).filter(Boolean);
    const wordsForLine = [];
    for (let i = 0; i < lineWords.length && wordIdx < words.length; i++, wordIdx++) {
      const w = words[wordIdx];
      wordsForLine.push({
        id: `w${idx+1}_${i+1}`,
        text: w.word,
        startSec: typeof w.start === 'number' ? w.start : null,
        endSec: typeof w.end === 'number' ? w.end : null,
      });
    }
    // Calculate line start/end from first/last word
    const startSec = wordsForLine.length > 0 ? wordsForLine[0].startSec : null;
    const endSec = wordsForLine.length > 0 ? wordsForLine[wordsForLine.length-1].endSec : null;
    return {
      id: `line${idx+1}`,
      startSec,
      endSec,
      words: wordsForLine,
      chords: [],
    };
  });
  return lines;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Parse FormData (audio + lyrics)
  const form = new formidable.IncomingForm();
  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.status(500).json({ error: 'Failed to parse form data' });
      return;
    }

    const lyrics = fields.lyrics || '';
    const audioFile = files.audio;
    if (!audioFile || !lyrics) {
      res.status(400).json({ error: 'Missing audio or lyrics' });
      return;
    }

    try {
      // Prepare FormData for Gentle
      const gentleForm = new FormData();
      gentleForm.append('audio', fs.createReadStream(audioFile.filepath), audioFile.originalFilename);
      gentleForm.append('transcript', lyrics);

      // Call Gentle (local server)
      const gentleRes = await fetch('http://localhost:8765/transcriptions?async=false', {
        method: 'POST',
        body: gentleForm,
        headers: gentleForm.getHeaders(),
      });
      if (!gentleRes.ok) {
        throw new Error('Gentle aligner error');
      }
      const gentleJson = await gentleRes.json();

      // Parse Gentle output
      const lines = gentleToChart(gentleJson, lyrics);
      res.status(200).json({ lines });
    } catch (e) {
      res.status(500).json({ error: 'Forced aligner failed', details: e.message });
    }
  });
}
