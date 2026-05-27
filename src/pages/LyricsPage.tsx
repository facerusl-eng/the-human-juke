
import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { demoMode } from '../demo/demoMode';
import '../audience-karafun.css';

export default function LyricsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { title, artist } = location.state || {};
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!title || !artist) return;
    setLoading(true);
    setError(null);

    // Helper: try all sources and fuzzy queries
    const tryAllSources = async () => {
      const queries = [
        { t: title, a: artist },
        { t: title.replace(/\(.*?\)/g, '').trim(), a: artist },
        { t: title, a: artist.replace(/feat\..*$/i, '').trim() },
        { t: artist, a: title },
      ];
      // Try backend proxy first (which now does fuzzy + ChartLyrics + AudD)
      for (const q of queries) {
        try {
          const res = await fetch(`/api/lyrics-genius?song=${encodeURIComponent(q.t)}&artist=${encodeURIComponent(q.a)}`);
          const data = await res.json();
          if (data.lyrics) {
            setLyrics(data.lyrics);
            setLoading(false);
            return;
          }
        } catch {}
      }
      // Fallback: try lyrics.ovh
      for (const q of queries) {
        try {
          const res2 = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(q.a)}/${encodeURIComponent(q.t)}`);
          const data2 = await res2.json();
          if (data2.lyrics) {
            setLyrics(data2.lyrics);
            setLoading(false);
            return;
          }
        } catch {}
      }
      // Fallback: try ChartLyrics directly
      for (const q of queries) {
        try {
          const url = `https://api.chartlyrics.com/apiv1.asmx/SearchLyricDirect?artist=${encodeURIComponent(q.a)}&song=${encodeURIComponent(q.t)}`;
          const res3 = await fetch(url);
          const text = await res3.text();
          const match = text.match(/<Lyric>([\s\S]*?)<\/Lyric>/);
          if (match && match[1] && match[1].trim().length > 0) {
            setLyrics(match[1].trim());
            setLoading(false);
            return;
          }
        } catch {}
      }
      setLyrics('🎤 Sorry, no lyrics found for this song. Try another song or check back later.');
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
