export function shouldResumeSpotifyAfterIntro({ introBridgeActive, introPlaybackComplete, isNowPlayingStarted }) {
  return Boolean(introBridgeActive && introPlaybackComplete && !isNowPlayingStarted)
}
