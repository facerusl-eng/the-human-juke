export type SpotifyIntroBridgeState = {
  introBridgeActive: boolean
  introPlaybackComplete: boolean
  isNowPlayingStarted: boolean
}

export function shouldStartIntroAudioNow({
  countdownRemainingMs,
  isNowPlayingStarted,
}: {
  countdownRemainingMs: number | null
  isNowPlayingStarted: boolean
}) {
  if (isNowPlayingStarted) {
    return false
  }

  return countdownRemainingMs === null || countdownRemainingMs <= 0
}

export function shouldPauseSpotifyWhenSongStarts({
  introAudioUrl,
  introBridgeActive,
}: {
  introAudioUrl?: string | null
  introBridgeActive?: boolean
}) {
  const hasIntroAudio = typeof introAudioUrl === 'string' && introAudioUrl.trim().length > 0
  return Boolean(introBridgeActive || hasIntroAudio)
}

export function shouldResumeSpotifyAfterIntro({
  introBridgeActive,
  introPlaybackComplete,
  isNowPlayingStarted,
}: SpotifyIntroBridgeState) {
  return Boolean(introBridgeActive && introPlaybackComplete && !isNowPlayingStarted)
}
