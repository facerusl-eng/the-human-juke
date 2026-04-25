const DEV_PUBLIC_ORIGIN = import.meta.env.VITE_DEV_PUBLIC_ORIGIN?.trim()

function isLocalHostName(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function getAudienceUrl(eventId?: string | null) {
  if (typeof window === 'undefined') {
    return ''
  }

  const normalizedEventId = eventId?.trim()

  const buildAudienceUrl = (origin: string) => {
    const audienceUrl = new URL('/audience', origin)

    if (normalizedEventId) {
      audienceUrl.searchParams.set('event', normalizedEventId)
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

  return buildAudienceUrl(window.location.origin)
}
