import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
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
    fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`)
      .then(res => res.json())
      .then(data => {
        if (data.lyrics) setLyrics(data.lyrics);
        else setError('Lyrics not found.');
      })
      .catch(() => setError('Failed to fetch lyrics.'))
      .finally(() => setLoading(false));
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
