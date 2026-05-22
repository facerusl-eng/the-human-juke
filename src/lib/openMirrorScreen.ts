export type OpenMirrorScreenResult = {
  navigatedInCurrentWindow: boolean
  openedInPopupWindow: boolean
  openedInNewTabWindow: boolean
}

export function openMirrorScreen(): OpenMirrorScreenResult {
  const mirrorUrl = new URL('/mirror', window.location.origin)
  mirrorUrl.searchParams.set('safeMargins', '1')
  mirrorUrl.searchParams.set('density', 'medium')
  mirrorUrl.searchParams.set('launchFullscreen', '1')
  mirrorUrl.searchParams.set('cast', '1')
  mirrorUrl.searchParams.delete('windowed')

  window.location.assign(mirrorUrl.toString())

  return {
    navigatedInCurrentWindow: true,
    openedInPopupWindow: false,
    openedInNewTabWindow: false,
  }
}