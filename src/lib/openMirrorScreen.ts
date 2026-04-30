export function openMirrorScreen() {
  const mirrorUrl = new URL('/mirror', window.location.origin)
  mirrorUrl.searchParams.set('launchFullscreen', '1')

  const popupWidth = Math.max(window.screen.availWidth || window.innerWidth || 1280, 960)
  const popupHeight = Math.max(window.screen.availHeight || window.innerHeight || 720, 540)
  const left = typeof window.screenX === 'number' ? Math.max(window.screenX, 0) : 0
  const top = typeof window.screenY === 'number' ? Math.max(window.screenY, 0) : 0
  const features = [
    'popup=yes',
    'toolbar=no',
    'location=no',
    'status=no',
    'menubar=no',
    'scrollbars=yes',
    'resizable=yes',
    `width=${popupWidth}`,
    `height=${popupHeight}`,
    `left=${left}`,
    `top=${top}`,
  ].join(',')

  const popupWindow = window.open(mirrorUrl.toString(), 'human-jukebox-mirror', features)

  if (popupWindow) {
    popupWindow.focus()
    return
  }

  const fallbackLink = document.createElement('a')
  fallbackLink.href = mirrorUrl.toString()
  fallbackLink.target = '_blank'
  fallbackLink.rel = 'noopener noreferrer'
  document.body.appendChild(fallbackLink)
  fallbackLink.click()
  document.body.removeChild(fallbackLink)
}