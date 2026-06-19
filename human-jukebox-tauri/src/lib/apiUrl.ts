import { isTauriDesktopRuntime } from './routePath'

const DEFAULT_API_ORIGIN = 'https://www.the-human-jukebox.org'
const TAURI_LOCAL_API_ORIGIN = 'http://localhost:3001'

function resolveConfiguredApiOrigin() {
  const preferredOrigin = import.meta.env.VITE_API_ORIGIN?.trim()
  const spotifyFallbackOrigin = import.meta.env.VITE_SPOTIFY_API_ORIGIN?.trim()
  return (preferredOrigin || spotifyFallbackOrigin || DEFAULT_API_ORIGIN).replace(/\/$/, '')
}

function isLocalDevOrigin() {
  if (typeof window === 'undefined') {
    return false
  }

  const localHosts = new Set(['localhost', '127.0.0.1'])
  return localHosts.has(window.location.hostname) && (window.location.protocol === 'http:' || window.location.protocol === 'https:')
}

export function resolveApiUrl(path: `/api/${string}`) {
  // In Tauri dev, route API calls to local Express. In packaged desktop builds,
  // use the configured/public API origin so OAuth and callbacks do not hit localhost.
  if (isTauriDesktopRuntime()) {
    const explicitOrigin = import.meta.env.VITE_API_ORIGIN?.trim() || import.meta.env.VITE_SPOTIFY_API_ORIGIN?.trim()
    if (explicitOrigin) {
      return `${explicitOrigin.replace(/\/$/, '')}${path}`
    }

    if (import.meta.env.DEV) {
      return `${TAURI_LOCAL_API_ORIGIN}${path}`
    }

    return `${resolveConfiguredApiOrigin()}${path}`
  }

  if (isLocalDevOrigin()) {
    return path
  }

  return `${resolveConfiguredApiOrigin()}${path}`
}
