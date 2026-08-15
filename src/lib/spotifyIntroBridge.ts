export type SpotifyIntroBridgeState = {
  introBridgeActive: boolean
  introPlaybackComplete: boolean
  isNowPlayingStarted: boolean
}

export function shouldResumeSpotifyAfterIntro({
  introBridgeActive,
  introPlaybackComplete,
  isNowPlayingStarted,
}: SpotifyIntroBridgeState) {
  return Boolean(introBridgeActive && introPlaybackComplete && !isNowPlayingStarted)
}
