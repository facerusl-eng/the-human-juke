import test from 'node:test'
import assert from 'node:assert/strict'

import { shouldResumeSpotifyAfterIntro } from '../src/lib/spotifyIntroBridge.js'

test('resumes Spotify only after intro finishes and the queue is still waiting', () => {
  assert.equal(shouldResumeSpotifyAfterIntro({
    introBridgeActive: true,
    introPlaybackComplete: true,
    isNowPlayingStarted: false,
  }), true)

  assert.equal(shouldResumeSpotifyAfterIntro({
    introBridgeActive: true,
    introPlaybackComplete: false,
    isNowPlayingStarted: false,
  }), false)

  assert.equal(shouldResumeSpotifyAfterIntro({
    introBridgeActive: true,
    introPlaybackComplete: true,
    isNowPlayingStarted: true,
  }), false)
})
