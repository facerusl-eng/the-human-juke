import { useEffect, useRef, useState } from 'react'
import { SPOTIFY_TOGGLE_BASE_VOLUME } from '../lib/constants'

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js'
const SPOTIFY_PLAYLIST_INPUT_STORAGE_KEY = 'human-jukebox-spotify-playlist-input'
const SPOTIFY_DEVICE_ID_STORAGE_KEY = 'human-jukebox-spotify-device-id'
const SPOTIFY_PLAYER_SINGLETON_KEY = '__humanJukeboxSpotifyPlayerSingleton'
const DEFAULT_BETWEEN_SONGS_PLAYLIST = 'spotify:playlist:4SarKcYGzetJ7AIlqVa1qj'
const DEFAULT_SPOTIFY_PLAYER_STATUS = 'Spotify player is idle.'

function getStoredSpotifyDeviceId() {
  if (typeof window === 'undefined') {
    return null
  }

  const storedDeviceId = window.localStorage.getItem(SPOTIFY_DEVICE_ID_STORAGE_KEY)
  return storedDeviceId && storedDeviceId.trim() ? storedDeviceId : null
}

function storeSpotifyDeviceId(deviceId) {
  if (typeof window === 'undefined') {
    return
  }

  if (!deviceId) {
    window.localStorage.removeItem(SPOTIFY_DEVICE_ID_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(SPOTIFY_DEVICE_ID_STORAGE_KEY, deviceId)
}

function getSpotifyPlayerSingleton() {
  if (typeof window === 'undefined') {
    return null
  }

  return window[SPOTIFY_PLAYER_SINGLETON_KEY] ?? null
}

function setSpotifyPlayerSingleton(player) {
  if (typeof window === 'undefined') {
    return
  }

  window[SPOTIFY_PLAYER_SINGLETON_KEY] = player
}

function ensureSpotifyScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Spotify SDK can only run in the browser.'))
  }

  if (window.Spotify) {
    return Promise.resolve()
  }

  const existing = document.querySelector(`script[src="${SDK_URL}"]`)

  if (existing) {
    return new Promise((resolve, reject) => {
      const previousReadyHandler = window.onSpotifyWebPlaybackSDKReady
      window.onSpotifyWebPlaybackSDKReady = () => {
        if (typeof previousReadyHandler === 'function') {
          previousReadyHandler()
        }
        resolve()
      }

      existing.addEventListener('error', () => reject(new Error('Failed to load Spotify SDK script.')), { once: true })
    })
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true

    const previousReadyHandler = window.onSpotifyWebPlaybackSDKReady
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (typeof previousReadyHandler === 'function') {
        previousReadyHandler()
      }
      resolve()
    }

    script.onerror = () => {
      reject(new Error('Failed to load Spotify SDK script.'))
    }

    document.body.appendChild(script)
  })
}

async function parseJson(response) {
  return response.json().catch(() => ({}))
}

function waitMs(durationMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs)
  })
}

function shouldRetrySpotifyResponse(response) {
  if (!response) {
    return false
  }

  return response.status === 429
    || response.status === 502
    || response.status === 503
    || response.status === 504
}

function normalizeTrackUri(input) {
  const trimmed = input.trim()

  if (!trimmed) {
    return ''
  }

  if (trimmed.startsWith('spotify:track:')) {
    return trimmed
  }

  const trackUrlMatch = trimmed.match(/spotify\.com\/track\/([a-zA-Z0-9]+)/i)
  if (trackUrlMatch?.[1]) {
    return `spotify:track:${trackUrlMatch[1]}`
  }

  return trimmed
}

function normalizePlaylistContextUri(input) {
  const trimmed = input.trim()

  if (!trimmed) {
    return ''
  }

  if (trimmed.startsWith('spotify:playlist:')) {
    return trimmed
  }

  const legacyUriMatch = trimmed.match(/spotify:user:[^:]+:playlist:([a-zA-Z0-9]+)/i)
  if (legacyUriMatch?.[1]) {
    return `spotify:playlist:${legacyUriMatch[1]}`
  }

  const playlistUrlMatch = trimmed.match(/spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/([a-zA-Z0-9]+)/i)
  if (playlistUrlMatch?.[1]) {
    return `spotify:playlist:${playlistUrlMatch[1]}`
  }

  if (/^[a-zA-Z0-9]+$/.test(trimmed)) {
    return `spotify:playlist:${trimmed}`
  }

  return ''
}

function isNoListError(error) {
  const normalized = String(error?.message || error || '').toLowerCase()
  return normalized.includes('no list') || normalized.includes('cannot perform operation')
}

function getSpotifyDisconnectHint(message) {
  const normalized = String(message || '').toLowerCase()

  if (!normalized) {
    return null
  }

  if (
    normalized.includes('keysystem') ||
    normalized.includes('eme') ||
    normalized.includes('protected content') ||
    normalized.includes('drm')
  ) {
    return 'This browser session cannot run Spotify DRM playback (EME/Widevine). Use Chrome or Edge with protected content enabled, then reconnect Spotify.'
  }

  if (normalized.includes('token') || normalized.includes('authentication')) {
    return 'Spotify auth/session issue. Reconnect Spotify and keep this tab signed in as Admin.'
  }

  if (normalized.includes('premium')) {
    return 'Spotify Premium is required for remote playback controls.'
  }

  if (normalized.includes('no active device') || normalized.includes('not found') || normalized.includes('restricted')) {
    return 'No usable Spotify Connect device found. Open Spotify on phone/desktop, start a song there once, then retry.'
  }

  if (normalized.includes('initialization error')) {
    return 'Spotify SDK failed to initialize in this environment. Reconnect Spotify or switch browser/device.'
  }

  if (normalized.includes('no list') || normalized.includes('no list was loaded')) {
    return 'No track is loaded in the player yet. Set a Between Songs Playlist below and press "Play Playlist Between Songs" once to load it, then Toggle Play will work.'
  }

  return null
}

function SpotifyPlayerWithSDK({ accessToken, onRefreshToken, transportCommand, onStatusTextChange }) {
  const playerRef = useRef(null)
  const accessTokenRef = useRef(accessToken)
  const playlistInputRef = useRef('')
  const lastStartedPlaylistContextRef = useRef('')
  const transportInFlightRef = useRef(false)
  const noListRecoveryInFlightRef = useRef(false)
  const pendingTransportCommandRef = useRef(null)
  const lastProcessedTransportNonceRef = useRef(0)

  const [isSdkReady, setIsSdkReady] = useState(false)
  const [deviceId, setDeviceId] = useState(null)
  const [playerStatus, setPlayerStatus] = useState(DEFAULT_SPOTIFY_PLAYER_STATUS)
  const [spotifyUriInput, setSpotifyUriInput] = useState('')
  const [playlistInput, setPlaylistInput] = useState(DEFAULT_BETWEEN_SONGS_PLAYLIST)
  const [actionBusy, setActionBusy] = useState(false)
  const [transportStatusText, setTransportStatusText] = useState(null)
  const disconnectHint = !deviceId ? getSpotifyDisconnectHint(playerStatus) : null

  useEffect(() => {
    if (!onStatusTextChange) {
      return
    }

    const nextStatusText = transportStatusText ?? playerStatus

    if (!transportStatusText && nextStatusText === DEFAULT_SPOTIFY_PLAYER_STATUS) {
      return
    }

    onStatusTextChange(nextStatusText ?? null)
  }, [onStatusTextChange, playerStatus, transportStatusText])

  accessTokenRef.current = accessToken

  const mapSpotifyApiError = (message) => {
    const normalized = String(message || '').toLowerCase()

    if (normalized.includes('premium')) {
      return 'Spotify Premium is required for remote playback controls.'
    }

    if (normalized.includes('no active device') || normalized.includes('not found')) {
      return 'No available Spotify playback device found. Open Spotify on your phone/desktop and start playback once.'
    }

    if (normalized.includes('restricted')) {
      return 'Spotify rejected that device. Try another active device in your Spotify app.'
    }

    if (normalized.includes('no list') || normalized.includes('no list was loaded')) {
      return 'No track is loaded in the player yet. Set a Between Songs Playlist below and press "Play Playlist Between Songs" once to load it, then Toggle Play will work.'
    }

    return message
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const storedPlaylistInput = window.localStorage.getItem(SPOTIFY_PLAYLIST_INPUT_STORAGE_KEY)
    if (storedPlaylistInput) {
      setPlaylistInput(storedPlaylistInput)
      return
    }

    setPlaylistInput(DEFAULT_BETWEEN_SONGS_PLAYLIST)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const normalizedValue = playlistInput.trim()
    if (!normalizedValue) {
      window.localStorage.removeItem(SPOTIFY_PLAYLIST_INPUT_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(SPOTIFY_PLAYLIST_INPUT_STORAGE_KEY, normalizedValue)
  }, [playlistInput])

  useEffect(() => {
    playlistInputRef.current = playlistInput
  }, [playlistInput])

  useEffect(() => {
    let cancelled = false
    let player = null

    const cleanupListeners = []

    const initialize = async () => {
      try {
        await ensureSpotifyScript()

        if (cancelled || !window.Spotify) {
          return
        }

        setIsSdkReady(true)

        player = getSpotifyPlayerSingleton()

        if (!player) {
          player = new window.Spotify.Player({
            name: 'Human Jukebox Gig Control',
            getOAuthToken: (cb) => {
              cb(accessTokenRef.current)
            },
            volume: SPOTIFY_TOGGLE_BASE_VOLUME,
          })
          setSpotifyPlayerSingleton(player)
        }

        const rememberedDeviceId = getStoredSpotifyDeviceId()
        if (rememberedDeviceId) {
          setDeviceId(rememberedDeviceId)
          setPlayerStatus('Reusing Spotify device session in background.')
        }

        const onReady = ({ device_id: readyDeviceId }) => {
          setDeviceId(readyDeviceId)
          storeSpotifyDeviceId(readyDeviceId)
          setPlayerStatus('Spotify device is ready.')
        }

        const onNotReady = ({ device_id: offlineDeviceId }) => {
          if (offlineDeviceId) {
            storeSpotifyDeviceId(null)
          }
          setPlayerStatus(`Spotify device went offline: ${offlineDeviceId}`)
        }

        player.addListener('ready', onReady)
        player.addListener('not_ready', onNotReady)
        player.addListener('initialization_error', ({ message }) => {
          const normalizedMessage = String(message || '')
          setPlayerStatus(`Initialization error: ${normalizedMessage}. You can still play playlists on another active Spotify device.`)
        })
        player.addListener('authentication_error', ({ message }) => {
          setPlayerStatus(`Authentication error: ${message}`)

          if (onRefreshToken) {
            void onRefreshToken()
              .then((newToken) => {
                accessTokenRef.current = newToken
                setPlayerStatus('Spotify token refreshed after authentication error.')
              })
              .catch((refreshError) => {
                setPlayerStatus(
                  refreshError instanceof Error
                    ? refreshError.message
                    : 'Spotify token refresh failed after authentication error.',
                )
              })
          }
        })
        player.addListener('account_error', ({ message }) => {
          setPlayerStatus(`Account error: ${message}`)
        })
        player.addListener('playback_error', ({ message }) => {
          if (isNoListError(message)) {
            if (noListRecoveryInFlightRef.current) {
              return
            }

            noListRecoveryInFlightRef.current = true

            void (async () => {
              try {
                // Step 1: try to resume the last paused context via REST API.
                // Swallow any throw (e.g. no active device) and fall through to playlist.
                let resumed = false
                try {
                  resumed = await resumePlayback()
                } catch {
                  // No resumable context — fall through to playlist start.
                }

                if (resumed) {
                  setPlayerStatus('Spotify playback resumed from where it stopped.')
                  return
                }

                // Step 2: try the configured between-songs playlist.
                const configuredPlaylist = playlistInputRef.current.trim()

                if (configuredPlaylist) {
                  await startPlaylistPlayback(configuredPlaylist)
                  setPlayerStatus('Started between-song playlist automatically.')
                  return
                }

                // Step 3: nothing we can do — guide the user.
                setPlayerStatus('No track loaded yet. Set a Between Songs Playlist and press "Play Playlist Between Songs" once.')
              } catch {
                // startPlaylistPlayback failed — don't surface a raw error; just guide the user.
                setPlayerStatus('No track loaded yet. Set a Between Songs Playlist and press "Play Playlist Between Songs" once.')
              } finally {
                noListRecoveryInFlightRef.current = false
              }
            })()

            return
          }

          const mappedMessage = mapSpotifyApiError(message)

          if (isNoListError(mappedMessage)) {
            setPlayerStatus('No track loaded yet. Set a Between Songs Playlist and press "Play Playlist Between Songs" once.')
            return
          }

          setPlayerStatus(`Playback error: ${mappedMessage}`)
        })

        cleanupListeners.push(() => {
          player.removeListener('ready', onReady)
          player.removeListener('not_ready', onNotReady)
          player.removeListener('initialization_error')
          player.removeListener('authentication_error')
          player.removeListener('account_error')
          player.removeListener('playback_error')
        })

        await player.connect()
        try {
          await player.setVolume(SPOTIFY_TOGGLE_BASE_VOLUME)
        } catch {
          // Volume writes can fail for restricted/remote sessions. Safe to ignore.
        }
        playerRef.current = player
      } catch (error) {
        setPlayerStatus(error instanceof Error ? error.message : 'Spotify SDK setup failed.')
      }
    }

    void initialize()

    return () => {
      cancelled = true
      cleanupListeners.forEach((cleanup) => {
        try {
          cleanup()
        } catch {
          // Ignore listener cleanup errors.
        }
      })
      playerRef.current = null
    }
  }, [])

  const canControlPlayback = Boolean(deviceId)

  const withRefreshRetry = async (action) => {
    try {
      return await action(accessTokenRef.current)
    } catch (error) {
      if (!onRefreshToken) {
        throw error
      }

      const refreshedToken = await onRefreshToken()
      accessTokenRef.current = refreshedToken
      return action(refreshedToken)
    }
  }

  const requestWithSpotifyRetry = async (requestFactory) => {
    let response = await requestFactory()

    if (shouldRetrySpotifyResponse(response)) {
      const retryAfterHeader = response.headers.get('retry-after')
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : 0
      const retryDelayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, 2000)
        : 350

      await waitMs(retryDelayMs)
      response = await requestFactory()
    }

    return response
  }

  const resolvePlaybackDeviceId = async () => {
    if (deviceId) {
      return deviceId
    }

    return withRefreshRetry(async (token) => {
      const response = await requestWithSpotifyRetry(() => fetch('https://api.spotify.com/v1/me/player/devices', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }))

      if (response.status === 401) {
        throw new Error('Spotify access token expired.')
      }

      if (!response.ok) {
        const payload = await parseJson(response)
        const message = payload?.error?.message || payload?.error_description || 'Failed to fetch Spotify devices.'
        throw new Error(message)
      }

      const payload = await parseJson(response)
      const devices = Array.isArray(payload?.devices) ? payload.devices : []
      const activeDevice = devices.find((device) => device?.is_active && !device?.is_restricted)
      const availableDevice = devices.find((device) => !device?.is_restricted)
      const fallbackDeviceId = activeDevice?.id || availableDevice?.id || null

      if (!fallbackDeviceId) {
        throw new Error('No active device found')
      }

      return fallbackDeviceId
    })
  }

  const syncTogglePlayState = async (shouldPlay) => {
    if (!playerRef.current) {
      return
    }

    const currentState = await playerRef.current.getCurrentState?.()

    if (!currentState) {
      // No track loaded in the SDK player — calling togglePlay() here would throw
      // "no list was loaded". Throw so callers fall through to REST API recovery.
      if (shouldPlay) {
        throw new Error('Cannot perform operation; no list was loaded.')
      }
      return
    }

    const isPaused = currentState.paused

    if ((shouldPlay && isPaused) || (!shouldPlay && !isPaused)) {
      await playerRef.current.togglePlay()
    }
  }

  const togglePlay = async () => {
    if (!playerRef.current) return

    setActionBusy(true)
    try {
      // Check state first — if nothing is loaded, go straight to REST recovery
      // instead of calling togglePlay() which would trigger a no-list SDK error.
      const currentState = await playerRef.current.getCurrentState?.()
      if (!currentState) {
        try {
          const resumed = await resumePlayback()
          if (resumed) {
            setPlayerStatus('Spotify playback resumed from where it stopped.')
            return
          }
        } catch {
          // fall through to playlist start
        }
        if (playlistInput.trim()) {
          await startPlaylistPlayback(playlistInput)
          return
        }
        setPlayerStatus('No track loaded yet. Set a Between Songs Playlist and press Play Playlist Between Songs first.')
        return
      }
      await playerRef.current.togglePlay()
      setPlayerStatus('Toggled play/pause.')
    } catch (error) {
      if (isNoListError(error)) {
        try {
          const resumed = await resumePlayback()
          if (resumed) {
            setPlayerStatus('Spotify playback resumed from where it stopped.')
            return
          }
        } catch {
          // fall through to playlist start
        }
        if (playlistInput.trim()) {
          await startPlaylistPlayback(playlistInput)
          return
        }
        setPlayerStatus('No track loaded yet. Set a Between Songs Playlist and press Play Playlist Between Songs first.')
        return
      }
      setPlayerStatus(error instanceof Error ? error.message : 'Toggle play failed.')
    } finally {
      setActionBusy(false)
    }
  }

  const nextTrack = async () => {
    if (!playerRef.current) return

    setActionBusy(true)
    try {
      await playerRef.current.nextTrack()
      setPlayerStatus('Skipped to next track.')
    } catch (error) {
      setPlayerStatus(error instanceof Error ? error.message : 'Next track failed.')
    } finally {
      setActionBusy(false)
    }
  }

  const previousTrack = async () => {
    if (!playerRef.current) return

    setActionBusy(true)
    try {
      await playerRef.current.previousTrack()
      setPlayerStatus('Moved to previous track.')
    } catch (error) {
      setPlayerStatus(error instanceof Error ? error.message : 'Previous track failed.')
    } finally {
      setActionBusy(false)
    }
  }

  // Resumes the last active playback context on the device (no body = resume where stopped).
  // Returns true if successful, false if there was nothing to resume.
  const resumePlayback = async () => {
    const playbackDeviceId = await resolvePlaybackDeviceId()

    return withRefreshRetry(async (token) => {
      const response = await requestWithSpotifyRetry(() => fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(playbackDeviceId)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        // No body — tells Spotify to resume the current context/position
      }))

      if (response.status === 401) {
        throw new Error('Spotify access token expired.')
      }

      // 403 means "Player command failed: not found / no active context" — nothing to resume
      if (response.status === 403 || response.status === 404) {
        return false
      }

      if (!response.ok) {
        const payload = await parseJson(response)
        const message = payload?.error?.message || payload?.error_description || 'Resume playback failed.'
        throw new Error(mapSpotifyApiError(message))
      }

      return true
    })
  }

  const pausePlayback = async () => {
    const playbackDeviceId = await resolvePlaybackDeviceId()

    return withRefreshRetry(async (token) => {
      const response = await requestWithSpotifyRetry(() => fetch(`https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(playbackDeviceId)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }))

      if (response.status === 401) {
        throw new Error('Spotify access token expired.')
      }

      if (response.status === 403 || response.status === 404) {
        return false
      }

      if (!response.ok) {
        const payload = await parseJson(response)
        const message = payload?.error?.message || payload?.error_description || 'Pause playback failed.'
        throw new Error(mapSpotifyApiError(message))
      }

      return true
    })
  }

  const skipPlayback = async (direction) => {
    const playbackDeviceId = await resolvePlaybackDeviceId()

    return withRefreshRetry(async (token) => {
      const response = await requestWithSpotifyRetry(() => fetch(`https://api.spotify.com/v1/me/player/${direction}?device_id=${encodeURIComponent(playbackDeviceId)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }))

      if (response.status === 401) {
        throw new Error('Spotify access token expired.')
      }

      if (response.status === 403 || response.status === 404) {
        return false
      }

      if (!response.ok) {
        const payload = await parseJson(response)
        const message = payload?.error?.message || payload?.error_description || `Spotify ${direction} track failed.`
        throw new Error(mapSpotifyApiError(message))
      }

      return true
    })
  }

  const getPlaybackIsPlaying = async () => {
    return withRefreshRetry(async (token) => {
      const response = await requestWithSpotifyRetry(() => fetch('https://api.spotify.com/v1/me/player', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }))

      if (response.status === 401) {
        throw new Error('Spotify access token expired.')
      }

      if (response.status === 204 || response.status === 404) {
        return null
      }

      if (!response.ok) {
        const payload = await parseJson(response)
        const message = payload?.error?.message || payload?.error_description || 'Failed to read playback state.'
        throw new Error(mapSpotifyApiError(message))
      }

      const payload = await parseJson(response)

      if (typeof payload?.is_playing === 'boolean') {
        return payload.is_playing
      }

      return null
    })
  }

  const startPlayback = async (spotifyUri) => {
    const normalizedTrackUri = normalizeTrackUri(spotifyUri)

    if (!normalizedTrackUri) {
      setPlayerStatus('Provide a valid Spotify track URI, URL, or ID.')
      return
    }

    setActionBusy(true)

    try {
      const playbackDeviceId = await resolvePlaybackDeviceId()

      await withRefreshRetry(async (token) => {
        const response = await requestWithSpotifyRetry(() => fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(playbackDeviceId)}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ uris: [normalizedTrackUri] }),
        }))

        if (response.status === 401) {
          throw new Error('Spotify access token expired.')
        }

        if (!response.ok) {
          const payload = await parseJson(response)
          const message = payload?.error?.message || payload?.error_description || 'Start playback failed.'
          throw new Error(mapSpotifyApiError(message))
        }
      })

      setPlayerStatus(`Started playback for ${normalizedTrackUri}.`)
    } catch (error) {
      setPlayerStatus(error instanceof Error ? mapSpotifyApiError(error.message) : 'Start playback failed.')
    } finally {
      setActionBusy(false)
    }
  }

  const startPlaylistPlayback = async (playlistIdOrUri) => {
    const contextUri = normalizePlaylistContextUri(playlistIdOrUri)

    if (!contextUri) {
      setPlayerStatus('Provide a valid Spotify playlist ID, URI, or URL.')
      return
    }

    setActionBusy(true)

    try {
      const playbackDeviceId = await resolvePlaybackDeviceId()

      await withRefreshRetry(async (token) => {
        const response = await requestWithSpotifyRetry(() => fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(playbackDeviceId)}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ context_uri: contextUri }),
        }))

        if (response.status === 401) {
          throw new Error('Spotify access token expired.')
        }

        if (!response.ok) {
          const payload = await parseJson(response)
          const message = payload?.error?.message || payload?.error_description || 'Start playlist playback failed.'
          throw new Error(mapSpotifyApiError(message))
        }
      })

      lastStartedPlaylistContextRef.current = contextUri
      setPlayerStatus(`Started playlist playback for ${contextUri}.`)
    } catch (error) {
      setPlayerStatus(error instanceof Error ? mapSpotifyApiError(error.message) : 'Start playlist playback failed.')
    } finally {
      setActionBusy(false)
    }
  }

  useEffect(() => {
    if (!transportCommand) {
      return
    }

    const executeTransportCommand = async (nextTransportCommand) => {
      if (!nextTransportCommand) {
        return
      }

      try {
        if (nextTransportCommand.mode === 'toggle') {
          if (!playerRef.current) {
            const isPlayingViaApi = await getPlaybackIsPlaying()

            if (isPlayingViaApi) {
              const paused = await pausePlayback()

              if (paused) {
                setPlayerStatus('Spotify playback paused from Gig Control toggle shortcut.')
                return
              }
            }

            const resumed = await resumePlayback()

            if (resumed) {
              setPlayerStatus('Spotify playback resumed from where it stopped.')
              return
            }

            if (playlistInput.trim()) {
              await startPlaylistPlayback(playlistInput)
              setPlayerStatus('Spotify playlist playback started from Gig Control toggle shortcut.')
              return
            }

            throw new Error('Set a Between Songs Playlist first, then use Toggle Spotify Playlist.')
          }

          const currentState = await playerRef.current.getCurrentState?.()

          if (!currentState) {
            try {
              const resumed = await resumePlayback()
              if (resumed) {
                setPlayerStatus('Spotify playback resumed from where it stopped.')
                return
              }
            } catch {
              // Fall through to playlist start when there is no resumable context.
            }

            if (playlistInput.trim()) {
              await startPlaylistPlayback(playlistInput)
              setPlayerStatus('Spotify playlist playback started from Gig Control toggle shortcut.')
              return
            }

            throw new Error('Set a Between Songs Playlist first, then use Toggle Spotify Playlist.')
          }

          try {
            await playerRef.current.togglePlay()
            setPlayerStatus('Spotify playlist play/pause toggled from Gig Control.')
          } catch (toggleError) {
            if (isNoListError(toggleError)) {
              try {
                const resumed = await resumePlayback()
                if (resumed) {
                  setPlayerStatus('Spotify playback resumed from where it stopped.')
                  return
                }
              } catch {
                // fall through to playlist start
              }
              if (playlistInput.trim()) {
                await startPlaylistPlayback(playlistInput)
                setPlayerStatus('Started playlist (no previous context to resume).')
                return
              }
              throw new Error('No track loaded yet. Set a Between Songs Playlist and press Play Playlist Between Songs first.')
            }
            throw toggleError
          }
          return
        }

        if (nextTransportCommand.mode === 'play') {
          if (!playerRef.current) {
            const resumed = await resumePlayback()

            if (resumed) {
              setPlayerStatus('Between-song Spotify playback resumed from Gig Control.')
              return
            }

            if (playlistInput.trim()) {
              await startPlaylistPlayback(playlistInput)
              setPlayerStatus('Started between-song playlist (no paused context was available).')
              return
            }

            throw new Error('No paused Spotify context found. Set a Between Songs Playlist first.')
          }

          const normalizedConfiguredPlaylist = normalizePlaylistContextUri(playlistInput)

          // If the configured playlist changed, force playback to start from the new playlist
          // instead of resuming an older paused context.
          if (
            lastStartedPlaylistContextRef.current
            &&
            normalizedConfiguredPlaylist
            && normalizedConfiguredPlaylist !== lastStartedPlaylistContextRef.current
          ) {
            await startPlaylistPlayback(playlistInput)
            setPlayerStatus('Started the newly selected between-song playlist.')
            return
          }

          try {
            await syncTogglePlayState(true)
            setPlayerStatus('Between-song Spotify playback resumed from Gig Control.')
            return
          } catch (playError) {
            if (!isNoListError(playError)) {
              throw playError
            }

            try {
              const resumed = await resumePlayback()
              if (resumed) {
                setPlayerStatus('Between-song Spotify playback resumed from last position.')
                return
              }
            } catch {
              // Fall through to playlist start when there is no resumable context.
            }

            if (playlistInput.trim()) {
              await startPlaylistPlayback(playlistInput)
              setPlayerStatus('Started between-song playlist (no paused context was available).')
              return
            }

            throw new Error('No paused Spotify context found. Set a Between Songs Playlist first.')
          }
        }

        if (nextTransportCommand.mode === 'next' || nextTransportCommand.mode === 'previous') {
          const isNextCommand = nextTransportCommand.mode === 'next'
          const successMessage = isNextCommand
            ? 'Skipped to next Spotify track from Gig Control.'
            : 'Moved to previous Spotify track from Gig Control.'

          if (!playerRef.current) {
            const skipped = await skipPlayback(isNextCommand ? 'next' : 'previous')

            if (skipped) {
              setPlayerStatus(successMessage)
              return
            }

            setPlayerStatus('No active Spotify playback was available to skip.')
            return
          }

          try {
            if (isNextCommand) {
              await playerRef.current.nextTrack()
            } else {
              await playerRef.current.previousTrack()
            }

            setPlayerStatus(successMessage)
            return
          } catch {
            const skipped = await skipPlayback(isNextCommand ? 'next' : 'previous')

            if (skipped) {
              setPlayerStatus(successMessage)
              return
            }

            setPlayerStatus('No active Spotify playback was available to skip.')
            return
          }
        }

        if (!playerRef.current) {
          const isPlayingViaApi = await getPlaybackIsPlaying()

          if (isPlayingViaApi === false) {
            setPlayerStatus('Between-song Spotify playback is already paused.')
            return
          }

          const paused = await pausePlayback()

          if (paused) {
            setPlayerStatus('Between-song Spotify playback paused for now playing track.')
            return
          }

          setPlayerStatus('No active Spotify playback was available to pause.')
          return
        }

        await syncTogglePlayState(false)
        setPlayerStatus('Between-song Spotify playback paused for now playing track.')
      } catch (error) {
        setPlayerStatus(error instanceof Error ? error.message : 'Spotify transport command failed.')
      }
    }

    const processTransportQueue = async () => {
      if (transportInFlightRef.current) {
        pendingTransportCommandRef.current = transportCommand
        setTransportStatusText('Spotify command queued...')
        return
      }

      transportInFlightRef.current = true
      setTransportStatusText('Spotify command running...')

      try {
        let commandToRun = transportCommand

        while (commandToRun) {
          if ((commandToRun?.nonce ?? 0) <= lastProcessedTransportNonceRef.current) {
            const pendingCommand = pendingTransportCommandRef.current
            pendingTransportCommandRef.current = null
            commandToRun = pendingCommand
            continue
          }

          await executeTransportCommand(commandToRun)
          lastProcessedTransportNonceRef.current = commandToRun.nonce ?? Date.now()

          const pendingCommand = pendingTransportCommandRef.current
          pendingTransportCommandRef.current = null
          commandToRun = pendingCommand
        }
      } finally {
        transportInFlightRef.current = false
        if (pendingTransportCommandRef.current) {
          setTransportStatusText('Spotify command queued...')
        } else {
          setTransportStatusText(null)
        }
      }
    }

    void processTransportQueue()
  }, [deviceId, playlistInput, transportCommand])

  return (
    <section className="queue-panel" aria-label="Spotify playback controls">
      <div className="panel-head">
        <h2>Spotify Web Playback SDK</h2>
        <span className="meta-badge">{deviceId ? 'Connected' : 'Disconnected'}</span>
      </div>

      <p className="subcopy">
        SDK status: {isSdkReady ? 'Loaded' : 'Loading'}
      </p>
      <p className="subcopy">Device ID: {deviceId ?? 'Waiting for ready event...'}</p>
      <p className="subcopy">{playerStatus}</p>
      {transportStatusText ? <p className="meta-badge" role="status" aria-live="polite">{transportStatusText}</p> : null}
      {disconnectHint ? <p className="subcopy">Disconnect reason: {disconnectHint}</p> : null}

      <div className="hero-actions">
        <button type="button" className="secondary-button" disabled={actionBusy || !canControlPlayback} onClick={togglePlay}>
          Toggle Play
        </button>
        <button type="button" className="secondary-button" disabled={actionBusy || !canControlPlayback} onClick={previousTrack}>
          Previous
        </button>
        <button type="button" className="secondary-button" disabled={actionBusy || !canControlPlayback} onClick={nextTrack}>
          Next
        </button>
      </div>

      <label htmlFor="spotify-uri-input" className="gig-switcher-label">Spotify URI (spotify:track:...)</label>
      <input
        id="spotify-uri-input"
        type="text"
        value={spotifyUriInput}
        onChange={(event) => setSpotifyUriInput(event.target.value)}
        placeholder="spotify:track:3n3Ppam7vgaVa1iaRUc9Lp"
        className="gig-switcher-select"
      />
      <div className="hero-actions no-margin-bottom">
        <button
          type="button"
          className="primary-button"
          disabled={actionBusy || !accessToken}
          onClick={async () => {
            await startPlayback(spotifyUriInput.trim())
          }}
        >
          Start Playback
        </button>
      </div>

      <label htmlFor="spotify-playlist-input" className="gig-switcher-label">Between Songs Playlist (ID, URI, or URL)</label>
      <input
        id="spotify-playlist-input"
        type="text"
        value={playlistInput}
        onChange={(event) => setPlaylistInput(event.target.value)}
        placeholder="spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"
        className="gig-switcher-select"
      />
      <div className="hero-actions no-margin-bottom">
        <button
          type="button"
          className="primary-button"
          disabled={actionBusy || !accessToken}
          onClick={async () => {
            await startPlaylistPlayback(playlistInput)
          }}
        >
          Play Playlist Between Songs
        </button>
      </div>
    </section>
  )
}

export default SpotifyPlayerWithSDK
