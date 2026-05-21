export type OpenMirrorScreenResult = {
  openedInPopupWindow: boolean
  openedInNewTabWindow: boolean
}

export function openMirrorScreen(): OpenMirrorScreenResult {
  const mirrorUrl = new URL('/mirror', window.location.origin)
  mirrorUrl.searchParams.set('safeMargins', '1')
  mirrorUrl.searchParams.set('density', 'medium')
  mirrorUrl.searchParams.set('launchFullscreen', '1')
  mirrorUrl.searchParams.set('windowed', '1')

  const popupFeatures = [
    'popup=yes',
    'noopener=yes',
    'noreferrer=yes',
    'resizable=yes',
    'scrollbars=no',
    'toolbar=no',
    'menubar=no',
    'location=no',
    'status=no',
    `left=0`,
    `top=0`,
    `width=${window.screen.availWidth}`,
    `height=${window.screen.availHeight}`,
  ].join(',')

  const mirrorPopup = window.open(mirrorUrl.toString(), 'human-jukebox-mirror', popupFeatures)

  if (mirrorPopup) {
    try {
      mirrorPopup.moveTo(0, 0)
      mirrorPopup.resizeTo(window.screen.availWidth, window.screen.availHeight)
    } catch {
      // Some browsers block move/resize calls. Continue with focused window.
    }

    mirrorPopup.focus()
    return {
      openedInPopupWindow: true,
      openedInNewTabWindow: false,
    }
  }

  const mirrorTab = window.open(mirrorUrl.toString(), '_blank', 'noopener,noreferrer')

  if (mirrorTab) {
    mirrorTab.focus()
    return {
      openedInPopupWindow: false,
      openedInNewTabWindow: true,
    }
  }

  return {
    openedInPopupWindow: false,
    openedInNewTabWindow: false,
  }
}