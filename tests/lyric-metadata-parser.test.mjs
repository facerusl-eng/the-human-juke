import test from 'node:test'
import assert from 'node:assert/strict'

import { extractSongTitleAndArtistFromText } from '../shared/lyric-display/songMetadataParser.js'

test('extractSongTitleAndArtistFromText strips prefixes and keeps title and artist separate', () => {
  assert.deepEqual(
    extractSongTitleAndArtistFromText('Now playing: The Weeknd - Starboy (Official Video)'),
    { title: 'Starboy', artist: 'The Weeknd' },
  )

  assert.deepEqual(
    extractSongTitleAndArtistFromText('Daft Punk - Around the World (Lyrics)'),
    { title: 'Around the World', artist: 'Daft Punk' },
  )

  assert.deepEqual(
    extractSongTitleAndArtistFromText('Ariana Grande by Dangerous Woman'),
    { title: 'Dangerous Woman', artist: 'Ariana Grande' },
  )
})
