
import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { demoMode } from '../demo/demoMode';
import '../audience-karafun.css';

function normalizeLyricsInput(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function buildLyricsQueries(title: string, artist: string) {
  const stripTitle = (value: string) => value
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/\b(feat\.?|ft\.?)\b.*$/i, ' ')
    .replace(/\s*-\s*(official|lyrics?|video).*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const stripArtist = (value: string) => value
    .replace(/\b(feat\.?|ft\.?)\b.*$/i, ' ')
    .replace(/[,&/].*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const titleVariants = Array.from(new Set([
    title,
    stripTitle(title),
  ].filter(Boolean)));

  const artistVariants = Array.from(new Set([
    artist,
    stripArtist(artist),
  ].filter(Boolean)));

  const queries: Array<{ t: string; a: string }> = [];
  for (const t of titleVariants) {
    for (const a of artistVariants) {
      queries.push({ t, a });
    }
  }

  if (titleVariants[0] && artistVariants[0]) {
    queries.push({ t: artistVariants[0], a: titleVariants[0] });
  }

  return queries;
}

export default function LyricsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const stateTitle = (location.state as { title?: string } | null)?.title;
  const stateArtist = (location.state as { artist?: string } | null)?.artist;
  const title = normalizeLyricsInput(stateTitle || searchParams.get('title'));
  const artist = normalizeLyricsInput(stateArtist || searchParams.get('artist'));
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!title || !artist) {
      setError('Missing song information. Please go back and tap Sing Along again.');
      return;
    }
    setLoading(true);
    setError(null);
    setLyrics(null);

    const tryAllSources = async () => {
      const queries = buildLyricsQueries(title, artist);

      for (const q of queries) {
        try {
          const res = await fetch(`/api/lyrics-genius?song=${encodeURIComponent(q.t)}&artist=${encodeURIComponent(q.a)}`);

          if (!res.ok) {
            continue;
          }

          const data = await res.json();
          const resolvedLyrics = typeof data?.lyrics === 'string' ? data.lyrics.trim() : '';

          if (resolvedLyrics.length > 0) {
            setLyrics(resolvedLyrics);
            setLoading(false);
            return;
          }
        } catch {
          // Continue trying variants.
        }
      }

      setLyrics('No lyrics found for this song right now. Try another version/title spelling or try again in a moment.');
      setLoading(false);
    };

    tryAllSources();
  }, [title, artist]);

  return (
    <div className="audience-lyrics-page">
      <button className="primary-button" onClick={() => navigate(-1)}>
        Back to Lounge
      </button>
      <h1 className="audience-lyrics-title">Sing Along: {title} – {artist}</h1>
      {loading && <p>Loading lyrics…</p>}
      {error && <p className="error-text">{error}</p>}
      {lyrics && <pre className="audience-lyrics-text">{lyrics}</pre>}
    </div>
  );
}
