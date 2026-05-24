type BuildQrLandingUrlOptions = {
  origin: string
  eventId?: string | null
  isTestGig?: boolean
  countdownTargetMs?: number | null
  audienceLinkVersion?: string | null
  clockOffsetMs?: number | null
  customUrl?: string | null
  qrContext?: 'countdown' | 'break' | null
}

function normalizeCustomUrl(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim()

  if (!trimmedValue) {
    return null
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    return trimmedValue
  }

  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(trimmedValue)) {
    return `https://${trimmedValue}`
  }

  return trimmedValue
}

export function buildQrLandingUrl(options: BuildQrLandingUrlOptions): string {
  const queryParams = new URLSearchParams()

  if (options.eventId) {
    queryParams.set('event', options.eventId)
  }

  if (options.isTestGig) {
    queryParams.set('test', '1')
  }

  if (typeof options.countdownTargetMs === 'number' && Number.isFinite(options.countdownTargetMs)) {
    queryParams.set('ct', String(Math.round(options.countdownTargetMs)))
  }

  if (options.audienceLinkVersion) {
    queryParams.set('v', options.audienceLinkVersion)
  }

  if (typeof options.clockOffsetMs === 'number' && Number.isFinite(options.clockOffsetMs)) {
    queryParams.set('co', String(Math.round(options.clockOffsetMs)))
  }

  const normalizedCustomUrl = normalizeCustomUrl(options.customUrl)
  if (normalizedCustomUrl) {
    const hasEventScopedContext = Boolean(options.eventId && (options.qrContext === 'countdown' || options.qrContext === 'break'))

    if (hasEventScopedContext) {
      queryParams.set('qc', options.qrContext === 'break' ? 'b' : 'c')
    } else {
      queryParams.set('url', normalizedCustomUrl)
    }

    queryParams.set('visual', '1')
  }

  return `${options.origin}/qr-landing?${queryParams.toString()}`
}
