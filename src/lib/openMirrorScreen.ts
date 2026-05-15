export type OpenMirrorScreenResult = {
  openedInPopupWindow: boolean
}

export function openMirrorScreen(): OpenMirrorScreenResult {
  const mirrorUrl = new URL('/mirror', window.location.origin)
  mirrorUrl.searchParams.set('launchFullscreen', '1')
  mirrorUrl.searchParams.set('cast', '1')
  mirrorUrl.searchParams.set('safeMargins', '1')
  mirrorUrl.searchParams.set('density', 'medium')

  const targetWidth = window.screen?.availWidth ?? window.outerWidth ?? 1600
  const targetHeight = window.screen?.availHeight ?? window.outerHeight ?? 900

  const mirrorWindow = window.open(
    mirrorUrl.toString(),
    'human-jukebox-mirror',
    [
      'popup=yes',
      'noopener=yes',
      'noreferrer=yes',
      'resizable=yes',
      'scrollbars=no',
      'toolbar=no',
      'location=no',
      'menubar=no',
      'status=no',
      `left=0`,
      `top=0`,
      `width=${targetWidth}`,
      `height=${targetHeight}`,
    ].join(','),
  )

  if (!mirrorWindow) {
    window.location.assign(mirrorUrl.toString())
    return { openedInPopupWindow: false }
  }

  const maximizeMirrorWindow = () => {
    try {
      mirrorWindow.moveTo(0, 0)
      mirrorWindow.resizeTo(targetWidth, targetHeight)
    } catch {
      // Some browsers block window geometry APIs for user safety.
    }
  }

  maximizeMirrorWindow()
  window.setTimeout(maximizeMirrorWindow, 80)
  window.setTimeout(maximizeMirrorWindow, 250)
  mirrorWindow.focus()

  return { openedInPopupWindow: true }
}