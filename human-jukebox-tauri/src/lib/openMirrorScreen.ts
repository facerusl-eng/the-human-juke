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
      // If the mirror window is already open and visible, just focus it
      const existing = await WebviewWindow.getByLabel('mirror-screen')
      if (existing) {
        try {
          const visible = await existing.isVisible()
          if (visible) {
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
        } catch {
          // Window is dead — fall through to close and recreate
        }
        // Window is registered but not visible (was closed) — destroy it so we can recreate
        try { await existing.close() } catch { /* ignore */ }
        // Brief pause to let Tauri clean up the label in the backend
        await new Promise<void>(resolve => setTimeout(resolve, 200))
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

      // Wait for the window to confirm creation or report an error before returning
      return await new Promise<OpenMirrorScreenResult>(resolve => {
        const timerId = setTimeout(() => {
          // Safety fallback: if no event fires within 6 s, assume success
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
          resolve({
            navigatedInCurrentWindow: false,
            openedInPopupWindow: false,
            openedInNewTabWindow: true,
            blockedByPopup: false,
            errorMessage: null,
          })
        })

        mirrorWindow.once('tauri://error', async (err) => {
          clearTimeout(timerId)
          // Label collision — a ghost window is still registered; try to focus it
          try {
            const ghost = await WebviewWindow.getByLabel('mirror-screen')
            if (ghost) {
              await ghost.show()
              await ghost.setFocus()
              resolve({
                navigatedInCurrentWindow: false,
                openedInPopupWindow: false,
                openedInNewTabWindow: true,
                blockedByPopup: false,
                errorMessage: null,
              })
              return
            }
          } catch { /* ignore */ }
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