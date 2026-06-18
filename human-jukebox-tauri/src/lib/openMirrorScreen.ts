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

const MIRROR_WINDOW_LABEL_PREFIX = 'mirror-screen'

function createMirrorWindowLabel() {
  return `${MIRROR_WINDOW_LABEL_PREFIX}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function lockMirrorWindow(mirrorWindow: WebviewWindow) {
  await mirrorWindow.setAlwaysOnTop(true).catch(() => undefined)
  await mirrorWindow.setFullscreen(true).catch(() => undefined)
  await mirrorWindow.setResizable(false).catch(() => undefined)
  await mirrorWindow.show().catch(() => undefined)
  await mirrorWindow.unminimize().catch(() => undefined)
  await mirrorWindow.setFocus().catch(() => undefined)
  await mirrorWindow.requestUserAttention(null).catch(() => undefined)
}

async function createTauriMirrorWindow(urlCandidates: string[], windowLabel: string): Promise<WebviewWindow> {
  let lastError: unknown = null

  for (const url of urlCandidates) {
    try {
      const mirrorWindow = new WebviewWindow(windowLabel, {
        url,
        title: 'Human Jukebox Mirror',
        decorations: true,
        visible: true,
        center: true,
        width: 1280,
        height: 720,
        resizable: false,
        fullscreen: true,
        alwaysOnTop: true,
      })

      await new Promise<void>((resolve, reject) => {
        void mirrorWindow.once('tauri://created', () => {
          resolve()
        })

        void mirrorWindow.once('tauri://error', (errorPayload) => {
          reject(new Error(`Failed to create mirror window for url: ${url}. ${String(errorPayload ?? '')}`))
        })
      })

      return mirrorWindow
    } catch (error) {
      lastError = error
      console.warn('openMirrorScreen: tauri mirror window attempt failed', { url, error })
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to create mirror window')
}

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
    const withQueryUrl = resolveTauriWindowUrl(`/mirror?${mirrorUrl.toString()}`)
    const withoutQueryUrl = resolveTauriWindowUrl('/mirror')
    const hashRouterUrl = `${window.location.origin}/#/mirror?${mirrorUrl.toString()}`
    const mirrorWindowLabel = createMirrorWindowLabel()

    try {
      const mirrorWindow = await createTauriMirrorWindow([
        withQueryUrl,
        hashRouterUrl,
        withoutQueryUrl,
      ], mirrorWindowLabel)

      await mirrorWindow.center().catch(() => undefined)
      await lockMirrorWindow(mirrorWindow)

      return {
        navigatedInCurrentWindow: false,
        openedInPopupWindow: false,
        openedInNewTabWindow: true,
        blockedByPopup: false,
      }
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Failed to create mirror window'

      console.error('openMirrorScreen: tauri mirror launch failed after retries', error)

      const fallbackTab = window.open(mirrorPath, '_blank', 'noopener,noreferrer')

      if (fallbackTab) {
        fallbackTab.focus()
        return {
          navigatedInCurrentWindow: false,
          openedInPopupWindow: true,
          openedInNewTabWindow: false,
          blockedByPopup: false,
          errorMessage,
        }
      }

      return {
        navigatedInCurrentWindow: false,
        openedInPopupWindow: false,
        openedInNewTabWindow: false,
        blockedByPopup: true,
        errorMessage,
      }
    }
  }

  const userAgent = window.navigator.userAgent
  const isWindows = /Windows NT/i.test(userAgent)
  const isEdgeBrowser = /Edg\//.test(userAgent)
  const preferEdgeOnWindows = options.preferEdgeOnWindows ?? false

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
        errorMessage: null,
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