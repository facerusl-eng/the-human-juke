/**
 * Demo Mode flag — true when the URL contains ?demo=true.
 * Evaluated once at module load time so it is stable for the full session.
 * All components and providers that gate real Supabase calls import this flag.
 */
function getParamValue(paramName: string): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const searchParams = new URLSearchParams(window.location.search)
  const directValue = searchParams.get(paramName)
  if (directValue !== null) {
    return directValue
  }

  const hash = window.location.hash || ''
  const queryIndex = hash.indexOf('?')
  if (queryIndex === -1) {
    return null
  }

  const hashQuery = hash.slice(queryIndex + 1)
  return new URLSearchParams(hashQuery).get(paramName)
}

export const demoMode: boolean = getParamValue('demo') === 'true'

export const homeMirrorPreviewMode: boolean = getParamValue('preview') === 'home'
