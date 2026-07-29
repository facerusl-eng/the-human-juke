import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrackLookupVariants, buildTrackCacheKey, normalizeTrackMetadata } from './lyrics-finder.js';

test('buildTrackLookupVariants expands searches with album and duration cues', () => {
  const variants = buildTrackLookupVariants({
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    album: 'A Night at the Opera',
    duration: 354,
  });

  assert.ok(variants.length >= 4);
  assert.ok(variants.some((variant) => variant.query.includes('A Night at the Opera')));
  assert.ok(variants.some((variant) => variant.durationBucket === 'long'));
});

test('buildTrackLookupVariants adds combined album and duration search hints', () => {
  const variants = buildTrackLookupVariants({
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    album: 'A Night at the Opera',
    duration: 354,
  });

  assert.ok(variants.some((variant) => variant.query.includes('A Night at the Opera') && variant.query.includes('long')));
});

test('normalizeTrackMetadata strips version tags and rounds duration to the nearest 5 seconds', () => {
  const metadata = normalizeTrackMetadata({
    title: 'Bohemian Rhapsody (Live) [Remastered] (feat. Queen)',
    artist: 'Queen & David Bowie, feat. John',
    album: 'A Night at the Opera',
    duration: 353,
  });

  assert.equal(metadata.title, 'Bohemian Rhapsody');
  assert.equal(metadata.artist, 'Queen');
  assert.equal(metadata.duration, 355);
});

test('buildTrackCacheKey stays stable for the same track metadata', () => {
  const first = buildTrackCacheKey({ title: 'Imagine', artist: 'John Lennon', album: 'Imagine', duration: 183 }, 'en');
  const second = buildTrackCacheKey({ title: 'Imagine', artist: 'John Lennon', album: 'Imagine', duration: 183 }, 'en');

  assert.equal(first, second);
});

test('buildTrackLookupVariants includes ASCII-folded search variants for international metadata', () => {
  const variants = buildTrackLookupVariants({
    title: 'Þú ert sólin',
    artist: 'Ásgeir',
    album: 'Í kvöld',
    duration: 181,
  });

  assert.ok(variants.some((variant) => variant.query.toLowerCase().includes('thu ert solin')));
  assert.ok(variants.some((variant) => variant.query.toLowerCase().includes('asgeir')));
});
