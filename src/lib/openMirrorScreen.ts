export type OpenMirrorScreenResult = {
  navigatedInCurrentWindow: boolean
  openedInPopupWindow: boolean
  openedInNewTabWindow: boolean
  blockedByPopup: boolean
}

type OpenMirrorScreenOptions = {
  eventId?: string | null
  demo?: boolean
  preferEdgeOnWindows?: boolean
}

export function openMirrorScreen(options: OpenMirrorScreenOptions = {}): OpenMirrorScreenResult {
  const mirrorUrl = new URL('/mirror', window.location.origin)
  mirrorUrl.searchParams.set('safeMargins', '1')
  mirrorUrl.searchParams.set('density', 'medium')
  mirrorUrl.searchParams.delete('launchFullscreen')
  mirrorUrl.searchParams.set('cast', '1')
  mirrorUrl.searchParams.delete('windowed')
  const mirrorWindowFeatures = 'width=1280,height=720,noopener,noreferrer'
  const mirrorWindowTarget = '_blank'

  if (options.eventId?.trim()) {
    mirrorUrl.searchParams.set('event', options.eventId.trim())
  }

  if (options.demo) {
    mirrorUrl.searchParams.set('demo', 'true')
  }

  const userAgent = window.navigator.userAgent
  const isWindows = /Windows NT/i.test(userAgent)
  const isEdgeBrowser = /Edg\//.test(userAgent)
  const preferEdgeOnWindows = options.preferEdgeOnWindows ?? false

  if (preferEdgeOnWindows && isWindows && !isEdgeBrowser) {
    const edgeProtocolUrl = `microsoft-edge:${mirrorUrl.toString()}`
    const edgeTab = window.open(edgeProtocolUrl, mirrorWindowTarget, mirrorWindowFeatures)

    if (edgeTab) {
      edgeTab.focus()
      return {
        navigatedInCurrentWindow: false,
        openedInPopupWindow: false,
        openedInNewTabWindow: true,
        blockedByPopup: false,
      }
    }
  }

  const mirrorTab = window.open(mirrorUrl.toString(), mirrorWindowTarget, mirrorWindowFeatures)

  if (mirrorTab) {
    mirrorTab.focus()
    return {
      navigatedInCurrentWindow: false,
      openedInPopupWindow: true,
      openedInNewTabWindow: true,
      blockedByPopup: false,
    }
  }

  return {
    navigatedInCurrentWindow: false,
    openedInPopupWindow: false,
    openedInNewTabWindow: false,
    blockedByPopup: true,
  }
}