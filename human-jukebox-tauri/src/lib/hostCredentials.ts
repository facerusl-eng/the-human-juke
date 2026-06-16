const HOST_LOGIN_EMAIL_STORAGE_KEY = 'human-jukebox-host-login-email'
const HOST_LOGIN_PASSWORD_STORAGE_KEY = 'human-jukebox-host-login-password'

type StoredHostCredentials = {
  email: string
  password: string
}

export function readStoredHostCredentials(): StoredHostCredentials | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const email = (window.localStorage.getItem(HOST_LOGIN_EMAIL_STORAGE_KEY) ?? '').trim()
    const password = window.localStorage.getItem(HOST_LOGIN_PASSWORD_STORAGE_KEY) ?? ''

    if (!email || !password) {
      return null
    }

    return { email, password }
  } catch {
    return null
  }
}

export function storeHostCredentials(email: string, password: string) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(HOST_LOGIN_EMAIL_STORAGE_KEY, email.trim())
    window.localStorage.setItem(HOST_LOGIN_PASSWORD_STORAGE_KEY, password)
  } catch {
    // Ignore localStorage failures.
  }
}

export function clearStoredHostCredentials() {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.removeItem(HOST_LOGIN_EMAIL_STORAGE_KEY)
    window.localStorage.removeItem(HOST_LOGIN_PASSWORD_STORAGE_KEY)
  } catch {
    // Ignore localStorage failures.
  }
}
