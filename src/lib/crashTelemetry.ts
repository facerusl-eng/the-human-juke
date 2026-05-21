import { supabase } from './supabase'

type CrashTelemetryInput = {
  route?: string | null
  error: unknown
  extra?: Record<string, unknown>
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 3)}...`
}

function toErrorParts(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || 'Unknown runtime error',
      stack: error.stack ?? '',
    }
  }

  if (typeof error === 'string') {
    return {
      name: 'Error',
      message: error,
      stack: '',
    }
  }

  return {
    name: 'UnknownError',
    message: 'Unknown runtime error',
    stack: '',
  }
}

function getRouteFallback() {
  if (typeof window === 'undefined') {
    return 'unknown'
  }

  return `${window.location.pathname}${window.location.search}`
}

function getStackSnippet(stack: string, extra?: Record<string, unknown>) {
  const stackSnippet = stack
    .split('\n')
    .slice(0, 4)
    .join('\n')
    .trim()

  const extraSnippet = extra ? JSON.stringify(extra) : ''
  const mergedSnippet = [stackSnippet, extraSnippet].filter(Boolean).join('\nextra: ')
  return truncateText(mergedSnippet, 400)
}

export function logCrashTelemetry({ route, error, extra }: CrashTelemetryInput) {
  if (import.meta.env.DEV) {
    return
  }

  const errorParts = toErrorParts(error)
  const resolvedRoute = route?.trim() || getRouteFallback()
  const errorFingerprint = truncateText(`${errorParts.name}:${errorParts.message}`.toLowerCase(), 180)
  const stackSnippet = getStackSnippet(errorParts.stack, extra)

  void (async () => {
    try {
      await supabase
        .from('crash_telemetry')
        .insert({
          route: resolvedRoute,
          error_fingerprint: errorFingerprint,
          error_message: truncateText(errorParts.message, 300),
          stack_snippet: stackSnippet || null,
        })
    } catch {
      // Telemetry failures should never affect the app experience.
    }
  })()
}
