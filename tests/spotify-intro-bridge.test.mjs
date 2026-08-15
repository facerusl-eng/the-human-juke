import test from 'node:test'
import assert from 'node:assert/strict'

import {
  shouldPauseSpotifyWhenSongStarts,
  shouldResumeSpotifyAfterIntro,
  shouldStartIntroAudioNow,
} from '../src/lib/spotifyIntroBridge.js'

test('only pauses Spotify for a song start when actual intro audio exists', () => {
  assert.equal(shouldPauseSpotifyWhenSongStarts({ introAudioUrl: null }), false)
  assert.equal(shouldPauseSpotifyWhenSongStarts({ introAudioUrl: '' }), false)
  assert.equal(shouldPauseSpotifyWhenSongStarts({ introAudioUrl: 'https://example.com/intro.mp3' }), true)
})

test('never starts intro audio while the countdown is still active', () => {
  assert.equal(shouldStartIntroAudioNow({ countdownRemainingMs: 5000, isNowPlayingStarted: false }), false)
  assert.equal(shouldStartIntroAudioNow({ countdownRemainingMs: 0, isNowPlayingStarted: false }), true)
  assert.equal(shouldStartIntroAudioNow({ countdownRemainingMs: null, isNowPlayingStarted: false }), true)
  assert.equal(shouldStartIntroAudioNow({ countdownRemainingMs: 5000, isNowPlayingStarted: true }), false)
})

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
