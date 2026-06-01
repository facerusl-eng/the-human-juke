
import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { demoMode } from '../demo/demoMode';
import { useAuthStore } from '../state/authStore';
import { supabase } from '../lib/supabase';
import { cacheFoundLyrics, getAutoCachedLyrics, getLyricsPrefetchStatus, markLyricsNotFound } from '../lib/lyricsPrefetch';
import { normalizeAudienceLocale, readCommittedAudienceLocale, type AudienceLocale } from '../lib/audienceIdentity';
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

function getLyricsPageCopy(locale: AudienceLocale) {
  if (locale === 'da') {
    return {
      unknownArtist: 'Ukendt artist',
      missingSongTitle: 'Mangler sangtitel. Ga tilbage og abn sangteksten igen.',
      pasteLyricsFirst: 'Indsaet sangtekst forst.',
      savedLocalNotPersisted: 'Gemt lokalt, men kunne ikke gemmes pa sangen endnu.',
      manualSavedToSong: 'Manuel sangtekst gemt pa denne sang. Naeste gang hentes den automatisk.',
      localSaveFailed: 'Gemt lokalt, men sang-gemning fejlede denne gang.',
      manualSavedLocal: 'Manuel sangtekst gemt lokalt for denne titel/artist.',
      backToLounge: 'Tilbage til lounge',
      singAlongTitlePrefix: 'Syng med til',
      lyricsSubtitle: 'Her er sangteksten til sangen, der spiller nu. Hop med nar du er klar.',
      loadingLyrics: 'Indlaeser sangtekst…',
      noLyricsAuto: 'Ingen sangtekst fundet automatisk lige nu.',
      manualFallbackAria: 'Manuel sangtekst fallback',
      manualFallbackTitle: 'Admin fallback: Indsaet sangtekst manuelt',
      manualFallbackCopy: 'API returnerede ikke sangtekst for denne sang. Indsaet og gem for at fortsaette.',
      manualFallbackPlaceholder: 'Indsaet sangtekst her...',
      saving: 'Gemmer…',
      saveManualLyrics: 'Gem manuel sangtekst',
    };
  }

  return {
    unknownArtist: 'Unknown artist',
    missingSongTitle: 'Missing song title. Please go back and open lyrics again.',
    pasteLyricsFirst: 'Paste lyrics first.',
    savedLocalNotPersisted: 'Saved locally, but could not persist to song record yet.',
    manualSavedToSong: 'Manual lyrics saved to this song. Next time it loads automatically.',
    localSaveFailed: 'Saved locally, but song persistence failed this time.',
    manualSavedLocal: 'Manual lyrics saved locally for this title/artist.',
    backToLounge: 'Back to Lounge',
    singAlongTitlePrefix: 'Sing along with',
    lyricsSubtitle: 'These are the lyrics for the song playing right now. Jump in whenever you are ready.',
    loadingLyrics: 'Loading lyrics…',
    noLyricsAuto: 'No lyrics found automatically right now.',
    manualFallbackAria: 'Manual lyrics fallback',
    manualFallbackTitle: 'Admin fallback: Paste lyrics manually',
    manualFallbackCopy: 'API did not return lyrics for this song. Paste and save to continue.',
    manualFallbackPlaceholder: 'Paste lyrics here...',
    saving: 'Saving…',
    saveManualLyrics: 'Save Manual Lyrics',
  };
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

  const normalizedArtist = normalizeQuotes(artist);
  const artistVariants = normalizedArtist
    ? Array.from(new Set([
        normalizedArtist,
        stripArtist(normalizedArtist),
        splitPrimary(stripArtist(normalizedArtist)),
      ].filter(Boolean)))
    : [''];

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
  const routeState = (location.state as {
    title?: string;
    artist?: string;
    audienceLocale?: AudienceLocale;
    librarySongId?: string | null;
  } | null) ?? null;
  const stateTitle = routeState?.title;
  const stateArtist = routeState?.artist;
  const localeFromQuery = normalizeLyricsInput(searchParams.get('locale'));
  const audienceLocale = normalizeAudienceLocale(routeState?.audienceLocale || localeFromQuery || readCommittedAudienceLocale());
  const copy = getLyricsPageCopy(audienceLocale);
  const stateLibrarySongId = routeState?.librarySongId ?? null;
  const title = normalizeLyricsInput(stateTitle || searchParams.get('title'));
  const artist = normalizeLyricsInput(stateArtist || searchParams.get('artist'));
  const displayArtist = artist || copy.unknownArtist;
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
    if (!title) {
      setError(copy.missingSongTitle);
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
          const params = new URLSearchParams({ song: q.t });
          if (q.a) {
            params.set('artist', q.a);
          }

          const res = await fetch(`/api/lyrics-genius?${params.toString()}`);

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
  }, [title, artist, librarySongId, copy.missingSongTitle]);

  const saveManualLyrics = async () => {
    const normalizedLyrics = manualLyricsInput.trim();

    if (!normalizedLyrics) {
      setManualSaveMessage(copy.pasteLyricsFirst);
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
          setManualSaveMessage(copy.savedLocalNotPersisted);
        } else {
          setManualSaveMessage(copy.manualSavedToSong);
        }
      } catch {
        setManualSaveMessage(copy.localSaveFailed);
      }
    } else {
      setManualSaveMessage(copy.manualSavedLocal);
    }

    setLyrics(normalizedLyrics);
    setLyricsNotFound(false);
    setSavingManualLyrics(false);
  };

  return (
    <div className="audience-lyrics-page">
      <button className="primary-button" onClick={() => navigate(-1)}>
        {copy.backToLounge}
      </button>
      <h1 className="audience-lyrics-title">{copy.singAlongTitlePrefix} {title} - {displayArtist}</h1>
      <p className="audience-lyrics-subtitle">{copy.lyricsSubtitle}</p>
      {loading && <p>{copy.loadingLyrics}</p>}
      {error && <p className="error-text">{error}</p>}
      {lyricsNotFound ? (
        <p className="error-text">{copy.noLyricsAuto}</p>
      ) : null}

      {isHost && lyricsNotFound ? (
        <section className="lyrics-manual-entry" aria-label={copy.manualFallbackAria}>
          <h2>{copy.manualFallbackTitle}</h2>
          <p className="subcopy">{copy.manualFallbackCopy}</p>
          <textarea
            className="lyrics-manual-entry-input"
            value={manualLyricsInput}
            onChange={(event) => setManualLyricsInput(event.target.value)}
            placeholder={copy.manualFallbackPlaceholder}
            rows={10}
          />
          <button type="button" className="primary-button" onClick={() => { void saveManualLyrics(); }} disabled={savingManualLyrics}>
            {savingManualLyrics ? copy.saving : copy.saveManualLyrics}
          </button>
          {manualSaveMessage ? <p className="subcopy">{manualSaveMessage}</p> : null}
        </section>
      ) : null}

      {lyrics && <pre className="audience-lyrics-text">{lyrics}</pre>}
    </div>
  );
}
