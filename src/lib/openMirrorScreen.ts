export function openMirrorScreen() {
  const mirrorUrl = new URL('/mirror', window.location.origin)
  mirrorUrl.searchParams.set('launchFullscreen', '1')
  mirrorUrl.searchParams.set('cast', '1')
  mirrorUrl.searchParams.set('safeMargins', '1')
  mirrorUrl.searchParams.set('density', 'medium')

  const newWindow = window.open(mirrorUrl.toString(), '_blank', 'noopener,noreferrer')

  if (!newWindow) {
    window.location.assign(mirrorUrl.toString())
    return
  }

  newWindow.focus()
}