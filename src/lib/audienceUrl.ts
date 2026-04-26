const DEV_PUBLIC_ORIGIN = import.meta.env.VITE_DEV_PUBLIC_ORIGIN?.trim()
const AUDIENCE_LINK_VERSION = import.meta.env.VITE_AUDIENCE_LINK_VERSION?.trim() || '20260426'

type AudienceUrlOptions = {
  compact?: boolean
}

function isLocalHostName(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function getAudienceUrl(eventId?: string | null, options: AudienceUrlOptions = {}) {
  if (typeof window === 'undefined') {
    return ''
  }

  const normalizedEventId = eventId?.trim()
  const useCompactPath = options.compact ?? false

  const buildAudienceUrl = (origin: string) => {
    const audiencePath = useCompactPath && normalizedEventId
      ? `/j/${encodeURIComponent(normalizedEventId)}`
      : '/audience'
    const audienceUrl = new URL(audiencePath, origin)

    if (normalizedEventId && !useCompactPath) {
      audienceUrl.searchParams.set('event', normalizedEventId)
    }

    audienceUrl.searchParams.set('v', AUDIENCE_LINK_VERSION)

    return audienceUrl.toString()
  }

  if (import.meta.env.DEV && DEV_PUBLIC_ORIGIN && isLocalHostName(window.location.hostname)) {
    try {
      return buildAudienceUrl(DEV_PUBLIC_ORIGIN)
    } catch {
      // Fall back to current origin when the override value is invalid.
    }
  }

  return buildAudienceUrl(window.location.origin)
}
