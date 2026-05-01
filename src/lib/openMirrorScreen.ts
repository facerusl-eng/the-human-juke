export function openMirrorScreen() {
  const mirrorUrl = new URL('/mirror', window.location.origin)
  mirrorUrl.searchParams.set('launchFullscreen', '1')
  mirrorUrl.searchParams.set('cast', '1')

  const newTab = window.open(mirrorUrl.toString(), '_blank', 'noopener,noreferrer')

  if (newTab) {
    newTab.focus()
  }
}