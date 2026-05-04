import { readTextFromLocalStorage, saveTextToLocalStorage } from './saveHandling'

export const AUDIENCE_NAME_STORAGE_KEY = 'human-jukebox-audience-name'
export const AUDIENCE_LOCALE_STORAGE_KEY = 'human-jukebox-audience-locale'
export const FEED_AUTHOR_NAME_STORAGE_KEY = 'human-jukebox-feed-author-name'
export const AUDIENCE_NAME_COMMITTED_EVENT = 'human-jukebox-audience-name-committed'

export type AudienceLocale = 'en' | 'da' | 'is'

export function normalizeAudienceLocale(value: string | null | undefined): AudienceLocale {
  const normalizedValue = value?.trim().toLowerCase()

  if (normalizedValue === 'da') {
    return 'da'
  }

  if (normalizedValue === 'is') {
    return 'is'
  }

  return 'en'
}

export function readCommittedAudienceLocale() {
  if (typeof window === 'undefined') {
    return 'en' satisfies AudienceLocale
  }

  try {
    return normalizeAudienceLocale(readTextFromLocalStorage(AUDIENCE_LOCALE_STORAGE_KEY, 'en'))
  } catch {
    return 'en'
  }
}

export function readCommittedAudienceName() {
  if (typeof window === 'undefined') {
    return ''
  }

  try {
    return (
      readTextFromLocalStorage(AUDIENCE_NAME_STORAGE_KEY, '').trim() ||
      readTextFromLocalStorage(FEED_AUTHOR_NAME_STORAGE_KEY, '').trim() ||
      ''
    )
  } catch {
    return ''
  }
}

export function commitAudienceName(nextName: string) {
  commitAudienceIdentity({ name: nextName, locale: readCommittedAudienceLocale() })
}

export function commitAudienceLocale(nextLocale: AudienceLocale) {
  if (typeof window === 'undefined') return
  const normalizedLocale = normalizeAudienceLocale(nextLocale)
  saveTextToLocalStorage(AUDIENCE_LOCALE_STORAGE_KEY, normalizedLocale)
}

export function commitAudienceIdentity({
  name,
  locale,
}: {
  name: string
  locale: AudienceLocale
}) {
  if (typeof window === 'undefined') {
    return
  }

  const normalizedName = name.trim()
  const normalizedLocale = normalizeAudienceLocale(locale)

  if (!normalizedName) {
    return
  }

  const audienceNameSaveResult = saveTextToLocalStorage(AUDIENCE_NAME_STORAGE_KEY, normalizedName)
  const audienceLocaleSaveResult = saveTextToLocalStorage(AUDIENCE_LOCALE_STORAGE_KEY, normalizedLocale)
  const feedAuthorSaveResult = saveTextToLocalStorage(FEED_AUTHOR_NAME_STORAGE_KEY, normalizedName)

  if (!audienceNameSaveResult.success || !audienceLocaleSaveResult.success || !feedAuthorSaveResult.success) {
    // Ignore storage failures in restricted webviews.
  }

  window.dispatchEvent(new Event(AUDIENCE_NAME_COMMITTED_EVENT))
}

export function clearAudienceIdentity() {
  if (typeof window === 'undefined') {
    return
  }

  localStorage.removeItem(AUDIENCE_NAME_STORAGE_KEY)
  localStorage.removeItem(AUDIENCE_LOCALE_STORAGE_KEY)
  localStorage.removeItem(FEED_AUTHOR_NAME_STORAGE_KEY)

  window.dispatchEvent(new Event(AUDIENCE_NAME_COMMITTED_EVENT))
}
