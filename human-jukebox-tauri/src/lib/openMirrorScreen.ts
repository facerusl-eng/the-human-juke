import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { isTauriDesktopRuntime, resolveAppPath, resolveTauriWindowUrl } from './routePath'

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

const MIRROR_WINDOW_LABEL = 'mirror-screen'

export async function openMirrorScreen(options: OpenMirrorScreenOptions = {}): Promise<OpenMirrorScreenResult> {
  const mirrorUrl = new URLSearchParams()
  mirrorUrl.set('safeMargins', '1')
  mirrorUrl.set('density', 'medium')
  mirrorUrl.set('cast', '1')
  mirrorUrl.delete('windowed')

  if (options.eventId?.trim()) {
    mirrorUrl.set('event', options.eventId.trim())
  }

  if (options.demo) {
    mirrorUrl.set('demo', 'true')
  }

  const mirrorPath = `${resolveAppPath('/mirror')}?${mirrorUrl.toString()}`

  if (isTauriDesktopRuntime()) {
    const mirrorWindowUrl = resolveTauriWindowUrl(`/mirror?${mirrorUrl.toString()}`)
    const existingWindow = await WebviewWindow.getByLabel(MIRROR_WINDOW_LABEL)

    if (existingWindow) {
      await existingWindow.setDecorations(true).catch(() => undefined)
      await existingWindow.setResizable(true).catch(() => undefined)
      await existingWindow.setFullscreen(false).catch(() => undefined)
      await existingWindow.setAlwaysOnTop(false).catch(() => undefined)
      await existingWindow.show().catch(() => undefined)
      await existingWindow.unminimize().catch(() => undefined)
      await existingWindow.center().catch(() => undefined)
      await existingWindow.setFocus().catch(() => undefined)
      await existingWindow.requestUserAttention(null).catch(() => undefined)
      return {
        navigatedInCurrentWindow: false,
        openedInPopupWindow: false,
        openedInNewTabWindow: true,
        blockedByPopup: false,
      }
    }

    const mirrorWindow = new WebviewWindow(MIRROR_WINDOW_LABEL, {
      url: mirrorWindowUrl,
      title: 'Human Jukebox Mirror',
      decorations: true,
      visible: true,
      center: true,
      width: 1280,
      height: 720,
      resizable: true,
    })

    await new Promise<void>((resolve) => {
      void mirrorWindow.once('tauri://created', async () => {
        await mirrorWindow.show().catch(() => undefined)
        await mirrorWindow.unminimize().catch(() => undefined)
        await mirrorWindow.center().catch(() => undefined)
        await mirrorWindow.setFocus().catch(() => undefined)
        await mirrorWindow.requestUserAttention(null).catch(() => undefined)
        resolve()
      })
    })

    return {
      navigatedInCurrentWindow: false,
      openedInPopupWindow: false,
      openedInNewTabWindow: true,
      blockedByPopup: false,
    }
  }

  const userAgent = window.navigator.userAgent
  const isWindows = /Windows NT/i.test(userAgent)
  const isEdgeBrowser = /Edg\//.test(userAgent)
  const preferEdgeOnWindows = options.preferEdgeOnWindows ?? true

  if (preferEdgeOnWindows && isWindows && !isEdgeBrowser) {
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