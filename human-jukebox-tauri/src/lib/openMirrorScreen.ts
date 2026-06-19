import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { isTauriDesktopRuntime, resolveAppPath, resolveTauriWindowUrl } from './routePath'

export type OpenMirrorScreenResult = {
  navigatedInCurrentWindow: boolean
  openedInPopupWindow: boolean
  openedInNewTabWindow: boolean
  blockedByPopup: boolean
  errorMessage?: string | null
}

type OpenMirrorScreenOptions = {
  eventId?: string | null
  demo?: boolean
  preferEdgeOnWindows?: boolean
}

export async function openMirrorScreen(options: OpenMirrorScreenOptions = {}): Promise<OpenMirrorScreenResult> {
  const mirrorUrl = new URLSearchParams()
  mirrorUrl.set('safeMargins', '1')
  mirrorUrl.set('density', 'medium')
  mirrorUrl.delete('windowed')

  if (options.eventId?.trim()) {
    mirrorUrl.set('event', options.eventId.trim())
  }

  if (options.demo) {
    mirrorUrl.set('demo', 'true')
  }

  const mirrorRoutePath = `/mirror?${mirrorUrl.toString()}`
  const mirrorWindowUrl = isTauriDesktopRuntime()
    ? resolveTauriWindowUrl(mirrorRoutePath)
    : mirrorRoutePath

  if (isTauriDesktopRuntime()) {
    try {
      // If the mirror window is already open, just focus it
      const existing = await WebviewWindow.getByLabel('mirror-screen')
      if (existing) {
        await existing.show()
        await existing.setFocus()
        return {
          navigatedInCurrentWindow: false,
          openedInPopupWindow: false,
          openedInNewTabWindow: true,
          blockedByPopup: false,
          errorMessage: null,
        }
      }

      const mirrorWindow = new WebviewWindow('mirror-screen', {
        url: mirrorWindowUrl,
        title: 'Mirror Screen',
        width: 1280,
        height: 720,
        resizable: true,
        fullscreen: false,
        decorations: true,
      })

      mirrorWindow.once('tauri://created', () => {
        console.log('Mirror Screen window created')
      })

      mirrorWindow.once('tauri://error', (error) => {
        console.error('Mirror Screen failed:', error)
      })

      return {
        navigatedInCurrentWindow: false,
        openedInPopupWindow: false,
        openedInNewTabWindow: true,
        blockedByPopup: false,
        errorMessage: null,
      }
    } catch (error) {
      return {
        navigatedInCurrentWindow: false,
        openedInPopupWindow: false,
        openedInNewTabWindow: false,
        blockedByPopup: true,
        errorMessage: error instanceof Error ? error.message : 'Failed to open mirror window',
      }
    }
  }

  const userAgent = window.navigator.userAgent
  const isWindows = /Windows NT/i.test(userAgent)
  const isEdgeBrowser = /Edg\//.test(userAgent)
  const preferEdgeOnWindows = options.preferEdgeOnWindows ?? false

  if (preferEdgeOnWindows && isWindows && !isEdgeBrowser) {
    const edgeProtocolUrl = `microsoft-edge:${mirrorRoutePath}`
    const edgeTab = window.open(edgeProtocolUrl, '_blank', 'noopener,noreferrer')

    if (edgeTab) {
      edgeTab.focus()
      return {
        navigatedInCurrentWindow: false,
        openedInPopupWindow: false,
        openedInNewTabWindow: true,
        blockedByPopup: false,
        errorMessage: null,
      }
    }
  }

  const mirrorTab = window.open(mirrorRoutePath, '_blank', 'noopener,noreferrer')

  if (mirrorTab) {
    mirrorTab.focus()
    return {
      navigatedInCurrentWindow: false,
      openedInPopupWindow: false,
      openedInNewTabWindow: true,
      blockedByPopup: false,
      errorMessage: null,
    }
  }

  return {
    navigatedInCurrentWindow: false,
    openedInPopupWindow: false,
    openedInNewTabWindow: false,
    blockedByPopup: true,
    errorMessage: null,
  }
}