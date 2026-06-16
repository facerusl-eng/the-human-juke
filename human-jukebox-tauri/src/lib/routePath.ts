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