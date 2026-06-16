const DEFAULT_API_ORIGIN = 'https://www.the-human-jukebox.org'

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
  if (isLocalDevOrigin()) {
    return path
  }

  return `${resolveConfiguredApiOrigin()}${path}`
}
