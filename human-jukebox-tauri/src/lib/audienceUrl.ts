const DEV_PUBLIC_ORIGIN = import.meta.env.VITE_DEV_PUBLIC_ORIGIN?.trim()
const AUDIENCE_LINK_VERSION = import.meta.env.VITE_AUDIENCE_LINK_VERSION?.trim() || __HUMAN_JUKEBOX_BUILD_ID__
const DEFAULT_PUBLIC_ORIGIN = 'https://www.the-human-jukebox.org'

type AudienceUrlOptions = {
  compact?: boolean
  includeVersion?: boolean
  mode?: 'public' | 'test'
}

function isLocalHostName(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === 'tauri.localhost'
}

function resolveAudienceOrigin() {
  if (typeof window === 'undefined') {
    return DEFAULT_PUBLIC_ORIGIN
  }

  // Tauri v2 on Windows (WebView2) maps the internal tauri:// protocol to
  // https://tauri.localhost — that hostname is not reachable from other devices,
  // so treat it the same as a non-browser origin.
  if (window.location.hostname === 'tauri.localhost') {
    return DEV_PUBLIC_ORIGIN || DEFAULT_PUBLIC_ORIGIN
  }

  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    return window.location.origin
  }

  return DEV_PUBLIC_ORIGIN || DEFAULT_PUBLIC_ORIGIN
}

export function getAudienceUrl(eventId?: string | null, options: AudienceUrlOptions = {}) {
  if (typeof window === 'undefined') {
    return ''
  }

  const normalizedEventId = eventId?.trim()
  const useCompactPath = options.compact ?? false
  const includeVersion = options.includeVersion ?? !useCompactPath
  const mode = options.mode ?? 'public'

  const buildAudienceUrl = (origin: string) => {
    const audiencePath = useCompactPath && normalizedEventId
      ? `/j/${encodeURIComponent(normalizedEventId)}`
      : '/audience'
    const audienceUrl = new URL(audiencePath, origin)

    if (normalizedEventId && !useCompactPath) {
      audienceUrl.searchParams.set('event', normalizedEventId)
    }

    if (mode === 'test') {
      audienceUrl.searchParams.set('test', '1')
    }

    if (includeVersion) {
      audienceUrl.searchParams.set('v', AUDIENCE_LINK_VERSION)
    }

    return audienceUrl.toString()
  }

  if (import.meta.env.DEV && DEV_PUBLIC_ORIGIN && isLocalHostName(window.location.hostname)) {
    try {
      return buildAudienceUrl(DEV_PUBLIC_ORIGIN)
    } catch {
      // Fall back to current origin when the override value is invalid.
    }
  }

  return buildAudienceUrl(resolveAudienceOrigin())
}
