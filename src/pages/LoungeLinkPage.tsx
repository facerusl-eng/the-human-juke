import { useMemo } from 'react'

function normalizeHttpUrl(rawUrl: string | null) {
  if (!rawUrl) {
    return null
  }

  const trimmed = rawUrl.trim()

  if (!trimmed) {
    return null
  }

  const normalized = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    const parsed = new URL(normalized)

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }

    return parsed.toString()
  } catch {
    return null
  }
}

function resolveBackToLoungeUrl(rawUrl: string | null) {
  if (typeof window === 'undefined') {
    return '/audience'
  }

  if (!rawUrl) {
    return '/audience'
  }

  try {
    const parsed = new URL(rawUrl, window.location.origin)
    const allowedPath = parsed.pathname.startsWith('/audience') || parsed.pathname.startsWith('/a/') || parsed.pathname.startsWith('/j/')

    if (parsed.origin !== window.location.origin || !allowedPath) {
      return '/audience'
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return '/audience'
  }
}

function LoungeLinkPage() {
  const targetUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return null
    }

    const searchParams = new URLSearchParams(window.location.search)
    return normalizeHttpUrl(searchParams.get('target'))
  }, [])

  const backToLoungeUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return '/audience'
    }

    const searchParams = new URLSearchParams(window.location.search)
    return resolveBackToLoungeUrl(searchParams.get('back'))
  }, [])

  return (
    <section className="lounge-link-shell" aria-label="Lounge link bridge">
      <header className="lounge-link-header">
        <a className="secondary-button" href={backToLoungeUrl}>Back to Lounge</a>
        {targetUrl ? <a className="primary-button" href={targetUrl} target="_blank" rel="noreferrer noopener">Open in new tab</a> : null}
      </header>

      <main className="lounge-link-main" aria-live="polite">
        {targetUrl ? (
          <>
            <iframe
              className="lounge-link-frame"
              src={targetUrl}
              title="External link"
              referrerPolicy="origin-when-cross-origin"
            />
            <p className="lounge-link-note">If this page does not load here, tap Open in new tab and use Back to Lounge when done.</p>
          </>
        ) : (
          <div className="lounge-link-invalid">
            <h1>Link unavailable</h1>
            <p>That link is missing or invalid. Tap Back to Lounge to return to the audience app.</p>
          </div>
        )}
      </main>
    </section>
  )
}

export default LoungeLinkPage
