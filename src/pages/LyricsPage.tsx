
import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { demoMode } from '../demo/demoMode';
import { getAutoCachedLyrics, getLyricsPrefetchStatus } from '../lib/lyricsPrefetch';
import '../audience-karafun.css';

const LYRICS_OVERRIDE_STORAGE_KEY = 'lyrics_manual_overrides_v1';

type LyricsOverridesMap = Record<string, string>;

function buildLyricsOverrideKey(title: string, artist: string) {
  return `${normalizeLyricsInput(title).toLowerCase()}::${normalizeLyricsInput(artist).toLowerCase()}`;
}

function readLyricsOverrides(): LyricsOverridesMap {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(LYRICS_OVERRIDE_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as LyricsOverridesMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLyricsOverrides(nextValue: LyricsOverridesMap) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(LYRICS_OVERRIDE_STORAGE_KEY, JSON.stringify(nextValue));
  } catch {
    // Non-blocking: user can still read fetched lyrics.
  }
}

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
  const [manualLyricsDraft, setManualLyricsDraft] = useState('');
  const [showManualEditor, setShowManualEditor] = useState(false);
  const [hasManualOverride, setHasManualOverride] = useState(false);
  const [manualSaveStatus, setManualSaveStatus] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!title || !artist) {
      setError('Missing song information. Please go back and tap Sing Along again.');
      return;
    }

    setLoading(true);
    setError(null);
    setLyrics(null);
    setManualSaveStatus(null);

    const overrideMap = readLyricsOverrides();
    const primaryOverrideKey = buildLyricsOverrideKey(title, artist);
    const fallbackKeys = buildLyricsQueries(title, artist).map((query) => buildLyricsOverrideKey(query.t, query.a));
    const manualOverride = [primaryOverrideKey, ...fallbackKeys]
      .map((key) => overrideMap[key])
      .find((value) => typeof value === 'string' && value.trim().length > 0);

    if (manualOverride) {
      setHasManualOverride(true);
      setLyrics(manualOverride.trim());
      setLoading(false);
      return;
    }

    setHasManualOverride(false);

    // Check lyrics that were pre-fetched when the song was added to the queue.
    const autoCached = getAutoCachedLyrics(title, artist);
    if (autoCached) {
      setLyrics(autoCached.trim());
      setLoading(false);
      return;
    }

    // If the prefetch already determined no lyrics exist, skip the slow API
    // calls and open the manual editor so the host can paste lyrics now.
    const prefetchStatus = getLyricsPrefetchStatus(title, artist);
    if (prefetchStatus === 'not_found') {
      setLyrics(null);
      setShowManualEditor(true);
      setManualSaveStatus('No lyrics were found automatically for this song. Paste lyrics below to enable sing-along.');
      setLoading(false);
      return;
    }

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
  }, [title, artist, reloadNonce]);

  const saveManualLyricsOverride = () => {
    const normalizedLyrics = manualLyricsDraft.trim();

    if (!title || !artist) {
      setManualSaveStatus('Missing song context. Go back and open Sing Along again.');
      return;
    }

    if (!normalizedLyrics) {
      setManualSaveStatus('Paste lyrics before saving.');
      return;
    }

    const nextOverrides = readLyricsOverrides();
    const key = buildLyricsOverrideKey(title, artist);
    nextOverrides[key] = normalizedLyrics;
    writeLyricsOverrides(nextOverrides);

    setHasManualOverride(true);
    setLyrics(normalizedLyrics);
    setShowManualEditor(false);
    setManualSaveStatus('Saved. These lyrics will always be used for this song.');
  };

  const removeManualLyricsOverride = () => {
    if (!title || !artist) {
      return;
    }

    const key = buildLyricsOverrideKey(title, artist);
    const nextOverrides = readLyricsOverrides();
    delete nextOverrides[key];
    writeLyricsOverrides(nextOverrides);

    setHasManualOverride(false);
    setManualLyricsDraft('');
    setManualSaveStatus('Removed saved override. Re-checking online lyrics...');
    setReloadNonce((current) => current + 1);
  };

  return (
    <div className="audience-lyrics-page">
      <button className="primary-button" onClick={() => navigate(-1)}>
        Back to Lounge
      </button>
      <h1 className="audience-lyrics-title">Sing Along: {title} – {artist}</h1>
      {loading && <p>Loading lyrics…</p>}
      {error && <p className="error-text">{error}</p>}
      {lyrics && <pre className="audience-lyrics-text">{lyrics}</pre>}
      {!loading && title && artist ? (
        <div style={{ display: 'grid', gap: '0.5rem', marginTop: '1rem' }}>
          <button
            type="button"
            className="primary-button"
            onClick={() => setShowManualEditor((current) => !current)}
          >
            {showManualEditor ? 'Hide manual lyrics editor' : 'Paste manual lyrics'}
          </button>
          {hasManualOverride ? (
            <button
              type="button"
              className="primary-button"
              onClick={removeManualLyricsOverride}
            >
              Remove saved lyrics override
            </button>
          ) : null}
          {showManualEditor ? (
            <>
              <textarea
                value={manualLyricsDraft}
                onChange={(event) => setManualLyricsDraft(event.target.value)}
                rows={12}
                placeholder="Paste lyrics here. Saved lyrics override API results for this song."
                style={{ width: '100%', resize: 'vertical' }}
              />
              <button
                type="button"
                className="primary-button"
                onClick={saveManualLyricsOverride}
              >
                Save manual lyrics for this song
              </button>
            </>
          ) : null}
          {manualSaveStatus ? <p>{manualSaveStatus}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
