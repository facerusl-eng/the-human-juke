const DEV_PUBLIC_ORIGIN = import.meta.env.VITE_DEV_PUBLIC_ORIGIN?.trim()

function isLocalHostName(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function getAudienceUrl() {
  if (typeof window === 'undefined') {
    return ''
  }

  if (import.meta.env.DEV && DEV_PUBLIC_ORIGIN && isLocalHostName(window.location.hostname)) {
    try {
      return new URL('/audience', DEV_PUBLIC_ORIGIN).toString()
    } catch {
      // Fall back to current origin when the override value is invalid.
    }
  }

  return new URL('/audience', window.location.origin).toString()
}
