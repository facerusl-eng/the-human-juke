export type OpenMirrorScreenResult = {
  navigatedInCurrentWindow: boolean
  openedInPopupWindow: boolean
  openedInNewTabWindow: boolean
}

type OpenMirrorScreenOptions = {
  eventId?: string | null
}

export function openMirrorScreen(options: OpenMirrorScreenOptions = {}): OpenMirrorScreenResult {
  const mirrorUrl = new URL('/mirror', window.location.origin)
  mirrorUrl.searchParams.set('safeMargins', '1')
  mirrorUrl.searchParams.set('density', 'medium')
  mirrorUrl.searchParams.set('launchFullscreen', '1')
  mirrorUrl.searchParams.set('cast', '1')
  mirrorUrl.searchParams.delete('windowed')

  if (options.eventId?.trim()) {
    mirrorUrl.searchParams.set('event', options.eventId.trim())
  }

  const mirrorTab = window.open(mirrorUrl.toString(), '_blank', 'noopener,noreferrer')

  if (mirrorTab) {
    mirrorTab.focus()
    return {
      navigatedInCurrentWindow: false,
      openedInPopupWindow: false,
      openedInNewTabWindow: true,
    }
  }

  window.location.assign(mirrorUrl.toString())

  return {
    navigatedInCurrentWindow: true,
    openedInPopupWindow: false,
    openedInNewTabWindow: false,
  }
}