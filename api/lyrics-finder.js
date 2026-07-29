function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeQuotes(value) {
  return normalizeText(
    String(value ?? '')
      .replace(/[\u2018\u2019\u2032]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-'),
  );
}

function stripDiacritics(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function transliterateNordic(value) {
  return String(value ?? '')
    .replace(/þ/gi, 'th')
    .replace(/ð/gi, 'd')
    .replace(/æ/gi, 'ae')
    .replace(/ø/gi, 'o')
    .replace(/å/gi, 'a')
    .replace(/ö/gi, 'o');
}

function asciiFold(value) {
  return normalizeText(stripDiacritics(transliterateNordic(String(value ?? ''))));
}

function normalizeTitle(value) {
  const cleaned = normalizeQuotes(String(value ?? ''));
  return normalizeText(
    cleaned
      .replace(/\s*\([^)]*\)/g, ' ')
      .replace(/\s*\[[^\]]*\]/g, ' ')
      .replace(/\s*[-|–]\s*(official|lyrics?|video|audio|live|acoustic|remaster(?:ed)?(?:\s*\d{2,4})?|radio\s*edit|mono|stereo)\b.*$/i, ' ')
      .replace(/\b(feat\.?|ft\.?|featuring)\b.*$/i, ' ')
      .replace(/\b(live|acoustic|remix|remastered|radio edit|instrumental|karaoke|mono|stereo|version)\b/gi, ' ')
      .replace(/\s+/g, ' '),
  );
}

function normalizeArtist(value) {
  const cleaned = normalizeQuotes(String(value ?? ''));
  const primary = normalizeText(
    cleaned
      .replace(/\b(feat\.?|ft\.?|featuring)\b.*$/i, ' ')
      .split(/\s*(?:,|&|x|with|and)\s*/i)[0] ?? '',
  );

  return primary.replace(/\s+/g, ' ').trim();
}

function normalizeComparable(value) {
  return normalizeText(stripDiacritics(value))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTitleNoise(value) {
  return normalizeText(
    String(value ?? '')
      .replace(/\(.*?\)/g, ' ')
      .replace(/\[.*?\]/g, ' ')
      .replace(/\b(feat\.?|ft\.?|featuring)\b.*$/i, ' ')
      .replace(/\s*-\s*(official|lyrics?|video).*$/i, ' '),
  );
}

function stripCommonTitleSuffixes(value) {
  return normalizeText(
    String(value ?? '')
      .replace(/\s*-\s*(live|acoustic|karaoke|instrumental|remaster(?:ed)?(?:\s*\d{2,4})?|radio\s*edit|mono|stereo)\b.*$/i, ' ')
      .replace(/\b(live|acoustic|karaoke|instrumental|remaster(?:ed)?(?:\s*\d{2,4})?|radio\s*edit)\b/gi, ' ')
      .replace(/\b(from|original\s+motion\s+picture|motion\s+picture\s+soundtrack)\b.*$/i, ' '),
  );
}

function stripArtistNoise(value) {
  return normalizeText(
    String(value ?? '')
      .replace(/\b(feat\.?|ft\.?|featuring)\b.*$/i, ' ')
      .replace(/[,&/].*$/, ' '),
  );
}

function normalizeTrackMetadata(track = {}) {
  const rawTitle = normalizeQuotes(normalizeText(track.title ?? ''));
  const rawArtist = normalizeQuotes(normalizeText(track.artist ?? ''));
  const album = normalizeQuotes(normalizeText(track.album ?? ''));
  const durationValue = Number(track.duration ?? '');
  const duration = Number.isFinite(durationValue) ? Math.round(durationValue / 5) * 5 : undefined;
  const durationBucket = duration === undefined
    ? 'unknown'
    : duration >= 240
      ? 'long'
      : duration >= 150
        ? 'medium'
        : 'short';

  return {
    title: normalizeTitle(rawTitle),
    artist: normalizeArtist(rawArtist),
    album,
    duration,
    durationBucket,
  };
}

function buildTrackLookupVariants(track = {}) {
  const metadata = normalizeTrackMetadata(track);
  const normalizedTitle = metadata.title;
  const normalizedArtist = metadata.artist;
  const normalizedAlbum = metadata.album;
  const asciiTitle = asciiFold(normalizedTitle);
  const asciiArtist = asciiFold(normalizedArtist);
  const asciiAlbum = asciiFold(normalizedAlbum);

  const titleVariants = Array.from(
    new Set([
      normalizedTitle,
      asciiTitle,
      stripTitleNoise(normalizedTitle),
      stripCommonTitleSuffixes(normalizedTitle),
      stripCommonTitleSuffixes(stripTitleNoise(normalizedTitle)),
      normalizedTitle.replace(/[.,!?:;]/g, ' '),
    ].filter(Boolean)),
  );

  const artistVariants = Array.from(
    new Set([
      normalizedArtist,
      asciiArtist,
      stripArtistNoise(normalizedArtist),
      normalizedArtist.split(/\s*(?:&|x|with|and)\s*/i)[0] || '',
    ].filter(Boolean)),
  );

  if (artistVariants.length === 0) {
    artistVariants.push('');
  }

  const variants = [];
  const seen = new Set();
  const addVariant = (title, artist, query, albumValue = '', durationBucketValue = metadata.durationBucket) => {
    const key = `${normalizeComparable(title)}::${normalizeComparable(artist)}::${normalizeComparable(albumValue)}::${durationBucketValue}::${normalizeText(String(query ?? '')).toLowerCase()}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    variants.push({
      title,
      artist,
      album: albumValue,
      durationBucket: durationBucketValue,
      query,
      key,
    });
  };

  for (const titleVariant of titleVariants) {
    for (const artistVariant of artistVariants) {
      addVariant(titleVariant, artistVariant, titleVariant && artistVariant ? `${titleVariant} ${artistVariant}` : titleVariant || artistVariant, '');
      if (normalizedAlbum) {
        addVariant(
          titleVariant,
          artistVariant,
          `${titleVariant} ${artistVariant} ${normalizedAlbum}`,
          normalizedAlbum,
          metadata.durationBucket,
        );
        addVariant(
          titleVariant,
          artistVariant,
          `${titleVariant} ${normalizedAlbum}`,
          normalizedAlbum,
          metadata.durationBucket,
        );

        if (asciiAlbum && asciiAlbum !== normalizedAlbum) {
          addVariant(
            titleVariant,
            artistVariant,
            `${titleVariant} ${artistVariant} ${asciiAlbum}`,
            asciiAlbum,
            metadata.durationBucket,
          );
          addVariant(
            titleVariant,
            artistVariant,
            `${titleVariant} ${asciiAlbum}`,
            asciiAlbum,
            metadata.durationBucket,
          );
        }
      }
      if (normalizedAlbum && metadata.durationBucket !== 'unknown') {
        addVariant(
          titleVariant,
          artistVariant,
          `${titleVariant} ${artistVariant} ${normalizedAlbum} ${metadata.durationBucket}`,
          normalizedAlbum,
          metadata.durationBucket,
        );
        addVariant(
          titleVariant,
          artistVariant,
          `${titleVariant} ${normalizedAlbum} ${metadata.durationBucket}`,
          normalizedAlbum,
          metadata.durationBucket,
        );
      }
      if (metadata.durationBucket !== 'unknown') {
        addVariant(
          titleVariant,
          artistVariant,
          `${titleVariant} ${artistVariant} ${metadata.durationBucket}`,
          '',
          metadata.durationBucket,
        );
        addVariant(
          titleVariant,
          artistVariant,
          `${titleVariant} ${metadata.durationBucket}`,
          '',
          metadata.durationBucket,
        );
      }
      if (!artistVariant) {
        addVariant(titleVariant, artistVariant, titleVariant, '', metadata.durationBucket);
      }
    }
  }

  const fallbackQuery = metadata.album
    ? `${metadata.title} ${metadata.artist} ${metadata.album}`
    : `${metadata.title} ${metadata.artist}`;

  const asciiFallbackQuery = asciiAlbum
    ? `${asciiTitle || metadata.title} ${asciiArtist || metadata.artist} ${asciiAlbum}`
    : `${asciiTitle || metadata.title} ${asciiArtist || metadata.artist}`;

  if (metadata.title) {
    addVariant(metadata.title, metadata.artist, fallbackQuery, metadata.album, metadata.durationBucket);
    if (asciiTitle && (asciiTitle !== metadata.title || asciiArtist !== metadata.artist || asciiAlbum !== metadata.album)) {
      addVariant(asciiTitle, asciiArtist || metadata.artist, asciiFallbackQuery, asciiAlbum || metadata.album, metadata.durationBucket);
    }
  }

  return variants;
}

function buildTrackCacheKey(track = {}, locale = 'en') {
  const metadata = normalizeTrackMetadata(track);
  const parts = [
    normalizeText(locale || 'en').toLowerCase(),
    normalizeComparable(metadata.title),
    normalizeComparable(metadata.artist),
    normalizeComparable(metadata.album),
    metadata.durationBucket,
  ];

  return parts.join('::');
}

function createNotFoundResult(source = 'none') {
  return {
    lyric: 'Lyric not available',
    source,
  };
}

function findLyricForTrack(track = {}, options = {}) {
  const metadata = normalizeTrackMetadata(track);
  const variants = buildTrackLookupVariants(metadata);
  const providerOrder = options.providerOrder ?? ['lyricfind', 'musixmatch', 'fallback'];
  const fallbackResult = createNotFoundResult('none');

  if (providerOrder.length === 0) {
    return fallbackResult;
  }

  return {
    lyric: '',
    source: providerOrder[0] ?? 'none',
    variants,
    metadata,
  };
}

export { buildTrackLookupVariants, buildTrackCacheKey, createNotFoundResult, findLyricForTrack, normalizeTrackMetadata };
export default { buildTrackLookupVariants, buildTrackCacheKey, createNotFoundResult, findLyricForTrack, normalizeTrackMetadata };
