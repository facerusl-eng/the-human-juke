import { isTauriDesktopRuntime, resolveAppPath } from './routePath'

export type OpenMirrorScreenResult = {
  navigatedInCurrentWindow: boolean
  openedInPopupWindow: boolean
  openedInNewTabWindow: boolean
  blockedByPopup: boolean
}

type OpenMirrorScreenOptions = {
  eventId?: string | null
  preferEdgeOnWindows?: boolean
}

export function openMirrorScreen(options: OpenMirrorScreenOptions = {}): OpenMirrorScreenResult {
  const mirrorUrl = new URLSearchParams()
  mirrorUrl.set('safeMargins', '1')
  mirrorUrl.set('density', 'medium')
  mirrorUrl.set('launchFullscreen', '1')
  mirrorUrl.set('cast', '1')
  mirrorUrl.delete('windowed')

  if (options.eventId?.trim()) {
    mirrorUrl.set('event', options.eventId.trim())
  }

  const mirrorPath = `${resolveAppPath('/mirror')}?${mirrorUrl.toString()}`

  const userAgent = window.navigator.userAgent
  const isWindows = /Windows NT/i.test(userAgent)
  const isEdgeBrowser = /Edg\//.test(userAgent)
  const preferEdgeOnWindows = options.preferEdgeOnWindows ?? true
  const isTauriRuntime = isTauriDesktopRuntime()

  if (preferEdgeOnWindows && isWindows && !isEdgeBrowser && !isTauriRuntime) {
    const edgeProtocolUrl = `microsoft-edge:${mirrorPath}`
    const edgeTab = window.open(edgeProtocolUrl, '_blank', 'noopener,noreferrer')

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

  const mirrorTab = window.open(mirrorPath, '_blank', 'noopener,noreferrer')

  if (mirrorTab) {
    mirrorTab.focus()
    return {
      navigatedInCurrentWindow: false,
      openedInPopupWindow: false,
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