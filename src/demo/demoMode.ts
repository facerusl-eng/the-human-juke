/**
 * Demo Mode flag — true when the URL contains ?demo=true.
 * Evaluated once at module load time so it is stable for the full session.
 * All components and providers that gate real Supabase calls import this flag.
 */
export const demoMode: boolean =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('demo') === 'true'

export const homeMirrorPreviewMode: boolean =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('preview') === 'home'
