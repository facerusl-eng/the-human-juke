export type OpenMirrorScreenResult = {
  openedInPopupWindow: boolean
  openedInNewTabWindow: boolean
}

function promotePopupWindow(popupWindow: Window) {
  const runPromotion = async () => {
    try {
      popupWindow.moveTo(0, 0)
      popupWindow.resizeTo(window.screen.availWidth, window.screen.availHeight)
      popupWindow.focus()
    } catch {
      // Ignore popup window manager permission failures.
    }
  }

  try {
    if (popupWindow.document.readyState === 'complete') {
      void runPromotion()
      return
    }

    popupWindow.addEventListener('load', () => {
      void runPromotion()
    }, { once: true })
  } catch {
    void runPromotion()
  }
}

export function openMirrorScreen(): OpenMirrorScreenResult {
  const mirrorUrl = new URL('/mirror', window.location.origin)
  mirrorUrl.searchParams.set('safeMargins', '1')
  mirrorUrl.searchParams.set('density', 'medium')
  mirrorUrl.searchParams.set('launchFullscreen', '0')
  mirrorUrl.searchParams.set('cast', '1')
  mirrorUrl.searchParams.set('windowed', '1')

  const mirrorTab = window.open(mirrorUrl.toString(), '_blank', 'noopener,noreferrer')

  if (mirrorTab) {
    mirrorTab.focus()
    return {
      openedInPopupWindow: false,
      openedInNewTabWindow: true,
    }
  }

  const popupFeatures = [
    'resizable=yes',
    'scrollbars=yes',
    'toolbar=yes',
    'menubar=yes',
    'location=yes',
    'status=yes',
    `left=0`,
    `top=0`,
    `width=${window.screen.availWidth}`,
    `height=${window.screen.availHeight}`,
  ].join(',')

  const mirrorPopup = window.open(mirrorUrl.toString(), 'human-jukebox-mirror-window', popupFeatures)

  if (mirrorPopup) {
    promotePopupWindow(mirrorPopup)
    return {
      openedInPopupWindow: true,
      openedInNewTabWindow: false,
    }
  }

  return {
    openedInPopupWindow: false,
    openedInNewTabWindow: false,
  }
}