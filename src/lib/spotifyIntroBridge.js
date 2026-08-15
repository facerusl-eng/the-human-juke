export function shouldStartIntroAudioNow({ countdownRemainingMs, isNowPlayingStarted }) {
  if (isNowPlayingStarted) {
    return false
  }

  return countdownRemainingMs === null || countdownRemainingMs <= 0
}

export function shouldPauseSpotifyWhenSongStarts({ introAudioUrl, introBridgeActive }) {
  const hasIntroAudio = typeof introAudioUrl === 'string' && introAudioUrl.trim().length > 0
  return Boolean(introBridgeActive || hasIntroAudio)
}

export function shouldResumeSpotifyAfterIntro({ introBridgeActive, introPlaybackComplete, isNowPlayingStarted }) {
  return Boolean(introBridgeActive && introPlaybackComplete && !isNowPlayingStarted)
}
