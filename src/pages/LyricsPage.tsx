
import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { demoMode } from '../demo/demoMode';
import { useAuthStore } from '../state/authStore';
import { supabase } from '../lib/supabase';
import { cacheFoundLyrics, getAutoCachedLyrics, getLyricsPrefetchStatus, markLyricsNotFound } from '../lib/lyricsPrefetch';
import '../audience-karafun.css';

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

  const artistVariants = Array.from(new Set([
    normalizeQuotes(artist),
    stripArtist(artist),
    splitPrimary(stripArtist(artist)),
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

  return Array.from(new Map(queries.map((query) => [`${query.t}::${query.a}`, query])).values());
}

export default function LyricsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const routeState = (location.state as { title?: string; artist?: string; librarySongId?: string | null } | null) ?? null;
  const stateTitle = routeState?.title;
  const stateArtist = routeState?.artist;
  const stateLibrarySongId = routeState?.librarySongId ?? null;
  const title = normalizeLyricsInput(stateTitle || searchParams.get('title'));
  const artist = normalizeLyricsInput(stateArtist || searchParams.get('artist'));
  const librarySongId = normalizeLyricsInput(stateLibrarySongId || searchParams.get('songId'));
  const { isHost } = useAuthStore();
  const [lyrics, setLyrics] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lyricsNotFound, setLyricsNotFound] = useState(false);
  const [manualLyricsInput, setManualLyricsInput] = useState('');
  const [manualSaveMessage, setManualSaveMessage] = useState<string | null>(null);
  const [savingManualLyrics, setSavingManualLyrics] = useState(false);

  useEffect(() => {
    if (!title || !artist) {
      setError('Missing song information. Please go back and tap Sing Along again.');
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
            setLoading(false);
            return;
          }
        } catch {
          // Continue with cache/API fallback.
        }
      }

      // Check lyrics that were pre-fetched when the song was added to the queue.
    const autoCached = getAutoCachedLyrics(title, artist);
    if (autoCached) {
      setLyrics(autoCached.trim());
      setLyricsNotFound(false);
      setLoading(false);
      return;
    }

    // If prefetch previously failed, still retry now because provider/API
    // availability can change between queue-time and sing-along-time.
    const prefetchStatus = getLyricsPrefetchStatus(title, artist);
    void prefetchStatus;

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
            cacheFoundLyrics(title, artist, resolvedLyrics);
            setLyrics(resolvedLyrics);
            setLyricsNotFound(false);
            setLoading(false);
            return;
          }
        } catch {
          // Continue trying variants.
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
  }, [title, artist, librarySongId]);

  const saveManualLyrics = async () => {
    const normalizedLyrics = manualLyricsInput.trim();

    if (!normalizedLyrics) {
      setManualSaveMessage('Paste lyrics first.');
      return;
    }

    setSavingManualLyrics(true);

    cacheFoundLyrics(title, artist, normalizedLyrics);

    if (librarySongId && !demoMode) {
      try {
        const { error: updateSongError } = await supabase
          .from('library_songs')
          .update({ manual_lyrics: normalizedLyrics })
          .eq('id', librarySongId);

        if (updateSongError) {
          setManualSaveMessage('Saved locally, but could not persist to song record yet.');
        } else {
          setManualSaveMessage('Manual lyrics saved to this song. Next time it loads automatically.');
        }
      } catch {
        setManualSaveMessage('Saved locally, but song persistence failed this time.');
      }
    } else {
      setManualSaveMessage('Manual lyrics saved locally for this title/artist.');
    }

    setLyrics(normalizedLyrics);
    setLyricsNotFound(false);
    setSavingManualLyrics(false);
  };

  return (
    <div className="audience-lyrics-page">
      <button className="primary-button" onClick={() => navigate(-1)}>
        Back to Lounge
      </button>
      <h1 className="audience-lyrics-title">Sing Along: {title} – {artist}</h1>
      {loading && <p>Loading lyrics…</p>}
      {error && <p className="error-text">{error}</p>}
      {lyricsNotFound ? (
        <p className="error-text">No lyrics found automatically right now.</p>
      ) : null}

      {isHost && lyricsNotFound ? (
        <section className="lyrics-manual-entry" aria-label="Manual lyrics fallback">
          <h2>Admin fallback: Paste lyrics manually</h2>
          <p className="subcopy">API did not return lyrics for this song. Paste and save to continue.</p>
          <textarea
            className="lyrics-manual-entry-input"
            value={manualLyricsInput}
            onChange={(event) => setManualLyricsInput(event.target.value)}
            placeholder="Paste lyrics here..."
            rows={10}
          />
          <button type="button" className="primary-button" onClick={() => { void saveManualLyrics(); }} disabled={savingManualLyrics}>
            {savingManualLyrics ? 'Saving…' : 'Save Manual Lyrics'}
          </button>
          {manualSaveMessage ? <p className="subcopy">{manualSaveMessage}</p> : null}
        </section>
      ) : null}

      {lyrics && <pre className="audience-lyrics-text">{lyrics}</pre>}
    </div>
  );
}
