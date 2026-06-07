import { useEffect, useRef, useState } from 'react'
import { SPOTIFY_TOGGLE_BASE_VOLUME } from '../lib/constants'

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js'
const SPOTIFY_PLAYLIST_INPUT_STORAGE_KEY = 'human-jukebox-spotify-playlist-input'
const SPOTIFY_PLAYLIST_META_STORAGE_KEY = 'human-jukebox-spotify-playlist-meta'
const SPOTIFY_SAVED_PLAYLISTS_STORAGE_KEY = 'human-jukebox-spotify-saved-playlists'
const SPOTIFY_DEVICE_ID_STORAGE_KEY = 'human-jukebox-spotify-device-id'
const SPOTIFY_PLAYER_SINGLETON_KEY = '__humanJukeboxSpotifyPlayerSingleton'
const DEFAULT_BETWEEN_SONGS_PLAYLIST = 'spotify:playlist:4SarKcYGzetJ7AIlqVa1qj'
const DEFAULT_SPOTIFY_PLAYER_STATUS = 'Spotify player is idle.'
const SPOTIFY_SHORT_LINK_HOSTS = ['spotify.link', 'spoti.fi']

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

  try {
    const parsedUrl = new URL(trimmed)
    const hostname = parsedUrl.hostname.toLowerCase()

    if (hostname.endsWith('spotify.com')) {
      const pathSegments = parsedUrl.pathname.split('/').filter(Boolean)
      const playlistSegmentIndex = pathSegments.findIndex((segment) => segment.toLowerCase() === 'playlist')

      if (playlistSegmentIndex >= 0) {
        const playlistId = pathSegments[playlistSegmentIndex + 1]

        if (playlistId && /^[a-zA-Z0-9]+$/.test(playlistId)) {
          return `spotify:playlist:${playlistId}`
        }
      }
    }
  } catch {
    // Not a URL; continue with regex and plain-id parsing.
  }

  const playlistUrlMatch = trimmed.match(/spotify\.com\/(?:intl-[a-z]{2}\/)?(?:embed\/)?playlist\/([a-zA-Z0-9]+)/i)
  if (playlistUrlMatch?.[1]) {
    return `spotify:playlist:${playlistUrlMatch[1]}`
  }

  if (/^[a-zA-Z0-9]+$/.test(trimmed)) {
    return `spotify:playlist:${trimmed}`
  }

  return ''
}

function isLikelySpotifyShortLink(input) {
  const trimmed = input.trim()

  if (!trimmed) {
    return false
  }

  try {
    const parsedUrl = new URL(trimmed)
    const hostname = parsedUrl.hostname.toLowerCase()
    return SPOTIFY_SHORT_LINK_HOSTS.some((shortHost) => hostname === shortHost || hostname.endsWith(`.${shortHost}`))
  } catch {
    return false
  }
}

async function resolvePlaylistContextUri(input) {
  const normalizedContextUri = normalizePlaylistContextUri(input)
  if (normalizedContextUri) {
    return normalizedContextUri
  }

  if (!isLikelySpotifyShortLink(input)) {
    return ''
  }

  const trimmed = input.trim()
  const attempts = [
    { method: 'GET', redirect: 'follow', cache: 'no-store' },
    { method: 'HEAD', redirect: 'follow', cache: 'no-store' },
  ]

  for (const attempt of attempts) {
    try {
      const response = await fetch(trimmed, attempt)
      const resolvedFromRedirect = normalizePlaylistContextUri(response?.url || '')

      if (resolvedFromRedirect) {
        return resolvedFromRedirect
      }
    } catch {
      // Continue trying alternative request methods.
    }
  }

  return ''
}

function getPlaylistIdFromContextUri(contextUri) {
  const normalizedContextUri = normalizePlaylistContextUri(contextUri)
  const contextUriMatch = normalizedContextUri.match(/^spotify:playlist:([a-zA-Z0-9]+)$/i)
  return contextUriMatch?.[1] ?? ''
}

function normalizeStoredPlaylistMeta(rawMeta) {
  if (!rawMeta || typeof rawMeta !== 'object') {
    return null
  }

  const normalizedUri = normalizePlaylistContextUri(typeof rawMeta.uri === 'string' ? rawMeta.uri : '')
  if (!normalizedUri) {
    return null
  }

  const normalizedName = typeof rawMeta.name === 'string' && rawMeta.name.trim()
    ? rawMeta.name.trim()
    : normalizedUri

  return {
    id: typeof rawMeta.id === 'string' ? rawMeta.id : getPlaylistIdFromContextUri(normalizedUri),
    uri: normalizedUri,
    name: normalizedName,
    ownerName: typeof rawMeta.ownerName === 'string' ? rawMeta.ownerName.trim() : '',
    imageUrl: typeof rawMeta.imageUrl === 'string' ? rawMeta.imageUrl.trim() : '',
    savedAt: typeof rawMeta.savedAt === 'number' && Number.isFinite(rawMeta.savedAt) ? rawMeta.savedAt : Date.now(),
  }
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

function SpotifyPlayerWithSDK({ accessToken, onRefreshToken, transportCommand, onStatusTextChange, onPlaylistMetaChange }) {
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
  const [playlistMeta, setPlaylistMeta] = useState(null)
  const [playlistMetaBusy, setPlaylistMetaBusy] = useState(false)
  const [playlistMetaError, setPlaylistMetaError] = useState(null)
  const [savedPlaylists, setSavedPlaylists] = useState([])
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

  useEffect(() => {
    if (!onPlaylistMetaChange) {
      return
    }

    onPlaylistMetaChange(playlistMeta)
  }, [onPlaylistMetaChange, playlistMeta])

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
    const storedPlaylistMetaRaw = window.localStorage.getItem(SPOTIFY_PLAYLIST_META_STORAGE_KEY)

    if (storedPlaylistInput) {
      setPlaylistInput(storedPlaylistInput)
    } else {
      setPlaylistInput(DEFAULT_BETWEEN_SONGS_PLAYLIST)
    }

    if (!storedPlaylistMetaRaw) {
      const storedSavedPlaylistsRaw = window.localStorage.getItem(SPOTIFY_SAVED_PLAYLISTS_STORAGE_KEY)

      if (!storedSavedPlaylistsRaw) {
        return
      }

      try {
        const parsedSavedPlaylists = JSON.parse(storedSavedPlaylistsRaw)

        if (Array.isArray(parsedSavedPlaylists)) {
          const normalizedSavedPlaylists = parsedSavedPlaylists
            .map(normalizeStoredPlaylistMeta)
            .filter(Boolean)
            .sort((left, right) => (right.savedAt ?? 0) - (left.savedAt ?? 0))

          setSavedPlaylists(normalizedSavedPlaylists)
        }
      } catch {
        window.localStorage.removeItem(SPOTIFY_SAVED_PLAYLISTS_STORAGE_KEY)
      }

      return
    }

    try {
      const parsedPlaylistMeta = JSON.parse(storedPlaylistMetaRaw)
      const normalizedStoredPlaylistMeta = normalizeStoredPlaylistMeta(parsedPlaylistMeta)

      if (normalizedStoredPlaylistMeta) {
        setPlaylistMeta(normalizedStoredPlaylistMeta)
      }
    } catch {
      window.localStorage.removeItem(SPOTIFY_PLAYLIST_META_STORAGE_KEY)
    }

    const storedSavedPlaylistsRaw = window.localStorage.getItem(SPOTIFY_SAVED_PLAYLISTS_STORAGE_KEY)

    if (!storedSavedPlaylistsRaw) {
      return
    }

    try {
      const parsedSavedPlaylists = JSON.parse(storedSavedPlaylistsRaw)

      if (!Array.isArray(parsedSavedPlaylists)) {
        return
      }

      const normalizedSavedPlaylists = parsedSavedPlaylists
        .map(normalizeStoredPlaylistMeta)
        .filter(Boolean)
        .sort((left, right) => (right.savedAt ?? 0) - (left.savedAt ?? 0))

      setSavedPlaylists(normalizedSavedPlaylists)
    } catch {
      window.localStorage.removeItem(SPOTIFY_SAVED_PLAYLISTS_STORAGE_KEY)
    }
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
    if (typeof window === 'undefined') {
      return
    }

    if (!playlistMeta) {
      window.localStorage.removeItem(SPOTIFY_PLAYLIST_META_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(SPOTIFY_PLAYLIST_META_STORAGE_KEY, JSON.stringify(playlistMeta))
  }, [playlistMeta])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (!savedPlaylists.length) {
      window.localStorage.removeItem(SPOTIFY_SAVED_PLAYLISTS_STORAGE_KEY)
      return
    }

    window.localStorage.setItem(SPOTIFY_SAVED_PLAYLISTS_STORAGE_KEY, JSON.stringify(savedPlaylists))
  }, [savedPlaylists])

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

  const canControlPlayback = Boolean(deviceId || accessToken)

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

  useEffect(() => {
    const rawPlaylistInput = playlistInput.trim()
    const canResolvePlaylistInput = Boolean(normalizePlaylistContextUri(rawPlaylistInput) || isLikelySpotifyShortLink(rawPlaylistInput))

    if (!rawPlaylistInput) {
      setPlaylistMeta(null)
      setPlaylistMetaError(null)
      setPlaylistMetaBusy(false)
      return
    }

    if (!canResolvePlaylistInput) {
      setPlaylistMeta(null)
      setPlaylistMetaError('Provide a valid Spotify playlist ID, URI, or URL.')
      setPlaylistMetaBusy(false)
      return
    }

    if (playlistMeta?.uri === normalizePlaylistContextUri(rawPlaylistInput)) {
      setPlaylistMetaError(null)
      setPlaylistMetaBusy(false)
      return
    }

    let cancelled = false
    setPlaylistMetaBusy(true)
    setPlaylistMetaError(null)

    const timer = window.setTimeout(() => {
      void (async () => {
        const resolvedContextUri = await resolvePlaylistContextUri(rawPlaylistInput)

        if (!resolvedContextUri) {
          throw new Error('Provide a valid Spotify playlist ID, URI, or URL.')
        }

        if (cancelled) {
          return
        }

        await withRefreshRetry(async (token) => {
          const playlistId = getPlaylistIdFromContextUri(resolvedContextUri)

          if (!playlistId) {
            throw new Error('Provide a valid Spotify playlist ID, URI, or URL.')
          }

          const response = await requestWithSpotifyRetry(() => fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}?fields=id,name,uri,owner(display_name),images(url,height,width)`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }))

          if (response.status === 401) {
            throw new Error('Spotify access token expired.')
          }

          if (response.status === 403) {
            throw new Error('Spotify denied access to this playlist. Reconnect Spotify and ensure your account can access that playlist (private/collab playlists require granted access).')
          }

          if (response.status === 404) {
            throw new Error('Playlist not found. Check the link/ID and confirm this Spotify account has access. If needed, reconnect Spotify to refresh permissions.')
          }

          if (!response.ok) {
            const payload = await parseJson(response)
            const message = payload?.error?.message || payload?.error_description || 'Failed to load playlist details.'
            throw new Error(mapSpotifyApiError(message))
          }

          const payload = await parseJson(response)
          const images = Array.isArray(payload?.images) ? payload.images : []
          const firstImageWithUrl = images.find((image) => typeof image?.url === 'string' && image.url.trim())

          if (cancelled) {
            return
          }

          setPlaylistMeta({
            id: typeof payload?.id === 'string' ? payload.id : playlistId,
            uri: typeof payload?.uri === 'string' ? payload.uri : resolvedContextUri,
            name: typeof payload?.name === 'string' && payload.name.trim() ? payload.name.trim() : resolvedContextUri,
            ownerName: typeof payload?.owner?.display_name === 'string' ? payload.owner.display_name.trim() : '',
            imageUrl: typeof firstImageWithUrl?.url === 'string' ? firstImageWithUrl.url : '',
          })
          setPlaylistMetaError(null)
        })
      }).catch((error) => {
        if (cancelled) {
          return
        }

        const message = error instanceof Error ? error.message : 'Failed to load playlist details.'

        // Keep a lightweight fallback meta so valid links can still be saved even if
        // Spotify metadata fetch fails (token/permissions/network/transient API issues).
        setPlaylistMeta({
          id: getPlaylistIdFromContextUri(normalizePlaylistContextUri(rawPlaylistInput)),
          uri: normalizePlaylistContextUri(rawPlaylistInput),
          name: normalizePlaylistContextUri(rawPlaylistInput),
          ownerName: '',
          imageUrl: '',
        })
        setPlaylistMetaError(`Could not load playlist details right now (${message}). You can still save this playlist link.`)
      }).finally(() => {
        if (cancelled) {
          return
        }

        setPlaylistMetaBusy(false)
      })
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [playlistInput, playlistMeta?.uri])

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

  // Prevent concurrent toggle actions
  let syncToggleLock = false
  const syncTogglePlayState = async (shouldPlay) => {
    if (syncToggleLock) return
    syncToggleLock = true
    try {
      if (!playerRef.current) return
      const currentState = await playerRef.current.getCurrentState?.()
      if (!currentState) {
        if (shouldPlay) throw new Error('Cannot perform operation; no list was loaded.')
        return
      }
      const isPaused = currentState.paused
      if ((shouldPlay && isPaused) || (!shouldPlay && !isPaused)) {
        await playerRef.current.togglePlay()
      }
    } finally {
      syncToggleLock = false
    }
  }

  // Prevent concurrent toggles
  let togglePlayLock = false
  const togglePlay = async () => {
    if (togglePlayLock) return
    togglePlayLock = true
    setActionBusy(true)
    try {
      if (playerRef.current && deviceId) {
        const currentState = await playerRef.current.getCurrentState?.()
        if (!currentState) {
          try {
            const resumed = await resumePlayback()
            if (resumed) {
              setPlayerStatus('Spotify playback resumed from where it stopped.')
              return
            }
          } catch {}
          if (playlistInput.trim()) {
            await startPlaylistPlayback(playlistInput)
            return
          }
          setPlayerStatus('No track loaded yet. Set a Between Songs Playlist and press Play Playlist Between Songs first.')
          return
        }
        await playerRef.current.togglePlay()
        setPlayerStatus('Toggled play/pause.')
        return
      }

      const isPlaying = await getPlaybackIsPlaying()
      if (isPlaying === true) {
        const paused = await pausePlayback()
        if (paused) {
          setPlayerStatus('Spotify playback paused on the active device.')
          return
        }
      }

      const resumed = await resumePlayback()
      if (resumed) {
        setPlayerStatus('Spotify playback resumed on the active device.')
        return
      }

      if (playlistInput.trim()) {
        await startPlaylistPlayback(playlistInput)
        return
      }

      setPlayerStatus('No active Spotify device/context. Open Spotify on a device, then try Toggle Play again.')
    } catch (error) {
      if (isNoListError(error)) {
        try {
          const resumed = await resumePlayback()
          if (resumed) {
            setPlayerStatus('Spotify playback resumed from where it stopped.')
            return
          }
        } catch {}
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
      togglePlayLock = false
    }
  }

  const nextTrack = async () => {
    setActionBusy(true)
    try {
      if (playerRef.current && deviceId) {
        await playerRef.current.nextTrack()
        setPlayerStatus('Skipped to next track.')
        return
      }

      const skipped = await skipPlayback('next')
      if (skipped) {
        setPlayerStatus('Skipped to next track on the active Spotify device.')
      } else {
        setPlayerStatus('No active Spotify device/context for Next. Start Spotify on a device first.')
      }
    } catch (error) {
      setPlayerStatus(error instanceof Error ? error.message : 'Next track failed.')
    } finally {
      setActionBusy(false)
    }
  }

  const previousTrack = async () => {
    setActionBusy(true)
    try {
      if (playerRef.current && deviceId) {
        await playerRef.current.previousTrack()
        setPlayerStatus('Moved to previous track.')
        return
      }

      const skipped = await skipPlayback('previous')
      if (skipped) {
        setPlayerStatus('Moved to previous track on the active Spotify device.')
      } else {
        setPlayerStatus('No active Spotify device/context for Previous. Start Spotify on a device first.')
      }
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
      if (playlistInput.trim()) {
        await startPlaylistPlayback(playlistInput)
        return
      }

      setPlayerStatus('Provide a valid Spotify track URI, URL, or ID, or set a Between Songs Playlist.')
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
      const sdkDeviceWasReady = Boolean(deviceId)
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

      if (sdkDeviceWasReady) {
        setPlayerStatus(`Started playlist playback for ${contextUri}.`)
      } else {
        setPlayerStatus(`Started playlist playback for ${contextUri} on your active Spotify device. This browser Web SDK device is not ready yet (Device ID still waiting).`)
      }
    } catch (error) {
      setPlayerStatus(error instanceof Error ? mapSpotifyApiError(error.message) : 'Start playlist playback failed.')
    } finally {
      setActionBusy(false)
    }
  }

  const saveCurrentPlaylist = async () => {
    try {
      const normalizedMeta = normalizeStoredPlaylistMeta(playlistMeta)
      let uriToSave = normalizedMeta?.uri || normalizePlaylistContextUri(playlistInput)

      if (!uriToSave && isLikelySpotifyShortLink(playlistInput)) {
        setPlaylistMetaBusy(true)
        uriToSave = await resolvePlaylistContextUri(playlistInput)
        setPlaylistMetaBusy(false)
      }

      if (!uriToSave) {
        setPlayerStatus('Paste a valid playlist link first, then save it.')
        return
      }

      const playlistToSave = {
        id: normalizedMeta?.id || getPlaylistIdFromContextUri(uriToSave),
        uri: uriToSave,
        name: normalizedMeta?.name || uriToSave,
        ownerName: normalizedMeta?.ownerName || '',
        imageUrl: normalizedMeta?.imageUrl || '',
        savedAt: Date.now(),
      }

      setSavedPlaylists((currentPlaylists) => {
        const withoutExisting = currentPlaylists.filter((playlist) => playlist.uri !== playlistToSave.uri)
        return [playlistToSave, ...withoutExisting]
      })

      setPlaylistInput(playlistToSave.uri)
      setPlaylistMeta(playlistToSave)
      setPlaylistMetaError(null)
      setPlayerStatus(`Saved playlist "${playlistToSave.name}" for quick Spotify toggle use.`)
    } catch {
      setPlaylistMetaBusy(false)
      setPlayerStatus('Could not resolve that short Spotify link. Open the playlist in Spotify and paste the full playlist URL.')
    }
  }

  const selectSavedPlaylist = (savedPlaylist) => {
    const normalizedPlaylist = normalizeStoredPlaylistMeta(savedPlaylist)

    if (!normalizedPlaylist) {
      return
    }

    setPlaylistInput(normalizedPlaylist.uri)
    setPlaylistMeta(normalizedPlaylist)
    setPlaylistMetaError(null)
    setPlayerStatus(`Selected playlist "${normalizedPlaylist.name}".`)
  }

  const removeSavedPlaylist = (uriToRemove) => {
    setSavedPlaylists((currentPlaylists) => currentPlaylists.filter((playlist) => playlist.uri !== uriToRemove))

    if (normalizePlaylistContextUri(playlistInput) === uriToRemove) {
      setPlayerStatus('Removed current saved playlist. Paste or choose another playlist.')
    }
  }

  const selectedPlaylistUri = normalizePlaylistContextUri(playlistInput)
  const canAttemptPlaylistImport = Boolean(normalizePlaylistContextUri(playlistInput) || isLikelySpotifyShortLink(playlistInput))

  useEffect(() => {
    if (!transportCommand) {
      return
    }

    const executeTransportCommand = async (nextTransportCommand) => {
      if (!nextTransportCommand) {
        return
      }

      const hasSdkPlaybackDevice = Boolean(playerRef.current && deviceId)

      try {
        if (nextTransportCommand.mode === 'toggle') {
          if (!hasSdkPlaybackDevice) {
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
          if (!hasSdkPlaybackDevice) {
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

          if (!hasSdkPlaybackDevice) {
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

        if (!hasSdkPlaybackDevice) {
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
          className="secondary-button"
          disabled={playlistMetaBusy || !canAttemptPlaylistImport}
          onClick={saveCurrentPlaylist}
        >
          Import & Save Playlist Link
        </button>
      </div>
      {playlistMetaBusy ? <p className="subcopy no-margin">Loading playlist details…</p> : null}
      {playlistMeta ? (
        <article className="gig-spotify-playlist-preview" aria-label="Selected Spotify playlist details">
          {playlistMeta.imageUrl ? (
            <img
              src={playlistMeta.imageUrl}
              alt={`Cover for ${playlistMeta.name}`}
              className="gig-spotify-playlist-preview-cover"
            />
          ) : (
            <span className="gig-spotify-playlist-preview-cover gig-spotify-playlist-preview-cover-fallback" aria-hidden="true">♪</span>
          )}
          <div className="gig-spotify-playlist-preview-copy">
            <p className="gig-spotify-playlist-preview-title">{playlistMeta.name}</p>
            {playlistMeta.ownerName ? <p className="gig-spotify-playlist-preview-owner">by {playlistMeta.ownerName}</p> : null}
          </div>
        </article>
      ) : null}
      {playlistMetaError ? <p className="subcopy no-margin">{playlistMetaError}</p> : null}

      {savedPlaylists.length > 0 ? (
        <div className="gig-spotify-saved-playlists" aria-label="Saved Spotify playlists">
          <p className="gig-spotify-saved-playlists-label">Saved playlists</p>
          <div className="gig-spotify-saved-playlists-grid">
            {savedPlaylists.map((savedPlaylist) => {
              const isSelected = selectedPlaylistUri === savedPlaylist.uri

              return (
                <article
                  key={savedPlaylist.uri}
                  className={`gig-spotify-saved-playlist-card${isSelected ? ' is-selected' : ''}`}
                >
                  <button
                    type="button"
                    className="gig-spotify-saved-playlist-select"
                    onClick={() => {
                      selectSavedPlaylist(savedPlaylist)
                    }}
                  >
                    {savedPlaylist.imageUrl ? (
                      <img
                        src={savedPlaylist.imageUrl}
                        alt={`Cover for ${savedPlaylist.name}`}
                        className="gig-spotify-saved-playlist-cover"
                      />
                    ) : (
                      <span className="gig-spotify-saved-playlist-cover gig-spotify-saved-playlist-cover-fallback" aria-hidden="true">♪</span>
                    )}
                    <span className="gig-spotify-saved-playlist-copy">
                      <strong className="gig-spotify-saved-playlist-title">{savedPlaylist.name}</strong>
                      {savedPlaylist.ownerName ? <span className="gig-spotify-saved-playlist-owner">by {savedPlaylist.ownerName}</span> : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ghost-button gig-spotify-saved-playlist-remove"
                    onClick={() => {
                      removeSavedPlaylist(savedPlaylist.uri)
                    }}
                    aria-label={`Remove saved playlist ${savedPlaylist.name}`}
                  >
                    Remove
                  </button>
                </article>
              )
            })}
          </div>
        </div>
      ) : null}

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
