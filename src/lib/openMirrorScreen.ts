export type OpenMirrorScreenResult = {
  openedInPopupWindow: boolean
  openedInNewTabWindow: boolean
}

type PopupFullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void
}

type PopupFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
  webkitRequestFullScreen?: () => Promise<void> | void
  msRequestFullscreen?: () => Promise<void> | void
}

async function requestFullscreenInPopup(popupWindow: Window) {
  const popupDocument = popupWindow.document as PopupFullscreenDocument
  const candidates = [
    popupDocument.documentElement,
    popupDocument.body,
  ].filter((candidate): candidate is HTMLElement => Boolean(candidate))

  for (const candidate of candidates) {
    const fullscreenCandidate = candidate as PopupFullscreenElement

    try {
      if (typeof fullscreenCandidate.requestFullscreen === 'function') {
        await fullscreenCandidate.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions)
        return true
      }

      if (typeof fullscreenCandidate.webkitRequestFullscreen === 'function') {
        await fullscreenCandidate.webkitRequestFullscreen()
        return true
      }

      if (typeof fullscreenCandidate.webkitRequestFullScreen === 'function') {
        await fullscreenCandidate.webkitRequestFullScreen()
        return true
      }

      if (typeof fullscreenCandidate.msRequestFullscreen === 'function') {
        await fullscreenCandidate.msRequestFullscreen()
        return true
      }
    } catch {
      // Browser policy may block fullscreen in popup. Keep the window maximized.
    }
  }

  return false
}

function promotePopupWindow(popupWindow: Window) {
  const runPromotion = async () => {
    try {
      popupWindow.moveTo(0, 0)
      popupWindow.resizeTo(window.screen.availWidth, window.screen.availHeight)
      popupWindow.focus()
      await requestFullscreenInPopup(popupWindow)
    } catch {
      // Ignore popup window manager/fullscreen permission failures.
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
  mirrorUrl.searchParams.set('launchFullscreen', '1')
  mirrorUrl.searchParams.set('cast', '1')
  mirrorUrl.searchParams.set('windowed', '1')

  const popupFeatures = [
    'popup=yes',
    'fullscreen=yes',
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
    promotePopupWindow(mirrorPopup)
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