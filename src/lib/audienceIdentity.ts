import { readTextFromLocalStorage, saveTextToLocalStorage } from './saveHandling'

export const AUDIENCE_NAME_STORAGE_KEY = 'human-jukebox-audience-name'
export const FEED_AUTHOR_NAME_STORAGE_KEY = 'human-jukebox-feed-author-name'
export const AUDIENCE_NAME_COMMITTED_EVENT = 'human-jukebox-audience-name-committed'

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
  if (typeof window === 'undefined') {
    return
  }

  const normalizedName = nextName.trim()

  if (!normalizedName) {
    return
  }

  const audienceNameSaveResult = saveTextToLocalStorage(AUDIENCE_NAME_STORAGE_KEY, normalizedName)
  const feedAuthorSaveResult = saveTextToLocalStorage(FEED_AUTHOR_NAME_STORAGE_KEY, normalizedName)

  if (!audienceNameSaveResult.success || !feedAuthorSaveResult.success) {
    // Ignore storage failures in restricted webviews.
  }

  window.dispatchEvent(new Event(AUDIENCE_NAME_COMMITTED_EVENT))
}
