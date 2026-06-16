export function isTauriDesktopRuntime() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.location.protocol === 'tauri:'
    || window.location.protocol === 'file:'
    || '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>)
}

export function resolveAppPath(path: string) {
  if (!isTauriDesktopRuntime()) {
    return path
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `#${normalizedPath}`
}

export function resolveTauriWindowUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  if (!isTauriDesktopRuntime()) {
    return normalizedPath
  }

  const appUrl = new URL(window.location.href)
  appUrl.hash = normalizedPath
  appUrl.search = ''
  return appUrl.toString()
}