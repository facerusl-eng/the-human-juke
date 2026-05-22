// Shared constants for Human Jukebox

export const INTRO_AUDIO_LOCK_STORAGE_KEY = 'human-jukebox-intro-audio-play-lock';
export const INTRO_AUDIO_LOCK_TTL_MS = 30000;
export const SPOTIFY_ACCESS_TOKEN_STORAGE_KEY = 'human-jukebox-spotify-access-token';
export const GIG_CONTROL_AUTO_REDIRECT_SECONDS = 10;
export const GIG_CONTROL_LOADING_RECOVERY_MS = 8000;
export const GIG_CONTROL_NOW_PLAYING_STORAGE_KEY = 'human-jukebox-gig-control-now-playing';
export const GIG_CONTROL_NOW_PLAYING_MAX_AGE_MS = 60000;
export const ROOM_STATE_ENSURE_MAX_ATTEMPTS = 5;
export const ROOM_STATE_ENSURE_RETRY_DELAY_MS = 2000;
export const MIRROR_PREVIEW_TRANSITION_MS = 1200;
export const SPACEBAR_ACTION_COOLDOWN_MS = 1200;
export const MIRROR_LAUNCH_STATUS_DURATION_MS = 3000;
export const AUTO_LIVE_RETRY_DELAY_MS = 5000;
export const BACKGROUND_SYNC_TAG = 'human-jukebox-background-sync';
export const SPOTIFY_AUTO_TRANSPORT_STORAGE_KEY = 'human-jukebox-spotify-auto-transport';
export const SPOTIFY_TOGGLE_BASE_VOLUME = 0.8;
export const INTRO_AUDIO_SPOTIFY_VOLUME_MULTIPLIER = 1.2;
export const INTRO_AUDIO_PLAYBACK_VOLUME = Math.min(1, SPOTIFY_TOGGLE_BASE_VOLUME * INTRO_AUDIO_SPOTIFY_VOLUME_MULTIPLIER);

