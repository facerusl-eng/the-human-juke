import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { isTauriDesktopRuntime, resolveTauriWindowUrl } from './routePath'

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

// Module-level reference to the currently open mirror window.
// We track it ourselves rather than relying on getByLabel so we can always
// tell whether the window is genuinely alive (isVisible) vs. still listed
// in Tauri's registry after the user closed it.
// Using a unique label per creation (timestamp suffix) avoids the "label
// already registered" error that fires when Tauri's backend hasn't yet freed
// the label of a recently-closed window.
let _activeMirrorWindow: WebviewWindow | null = null

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
      // If we have a live reference to the mirror window, focus it
      if (_activeMirrorWindow !== null) {
        try {
          const visible = await _activeMirrorWindow.isVisible()
          if (visible) {
            await _activeMirrorWindow.show()
            await _activeMirrorWindow.setFocus()
            return {
              navigatedInCurrentWindow: false,
              openedInPopupWindow: false,
              openedInNewTabWindow: true,
              blockedByPopup: false,
              errorMessage: null,
            }
          }
        } catch {
          // Window is dead — clear the stale reference and create a fresh one
        }
        _activeMirrorWindow = null
      }

      // Use a unique label so we never collide with a label Tauri hasn't freed yet
      const windowLabel = `mirror-screen-${Date.now()}`
      const mirrorWindow = new WebviewWindow(windowLabel, {
        url: mirrorWindowUrl,
        title: 'Mirror Screen',
        width: 1280,
        height: 720,
        resizable: true,
        fullscreen: false,
        decorations: true,
      })

      // Wait for the window to confirm creation or report an error before returning
      return await new Promise<OpenMirrorScreenResult>(resolve => {
        const timerId = setTimeout(() => {
          // Safety fallback: if no confirmation arrives within 6 s, assume success
          _activeMirrorWindow = mirrorWindow
          resolve({
            navigatedInCurrentWindow: false,
            openedInPopupWindow: false,
            openedInNewTabWindow: true,
            blockedByPopup: false,
            errorMessage: null,
          })
        }, 6000)

        mirrorWindow.once('tauri://created', () => {
          clearTimeout(timerId)
          _activeMirrorWindow = mirrorWindow
          // Auto-clear when the user closes the mirror window
          mirrorWindow.once('tauri://destroyed', () => {
            if (_activeMirrorWindow === mirrorWindow) {
              _activeMirrorWindow = null
            }
          })
          resolve({
            navigatedInCurrentWindow: false,
            openedInPopupWindow: false,
            openedInNewTabWindow: true,
            blockedByPopup: false,
            errorMessage: null,
          })
        })

        mirrorWindow.once('tauri://error', (err: unknown) => {
          clearTimeout(timerId)
          resolve({
            navigatedInCurrentWindow: false,
            openedInPopupWindow: false,
            openedInNewTabWindow: false,
            blockedByPopup: true,
            errorMessage: String(err),
          })
        })
      })
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