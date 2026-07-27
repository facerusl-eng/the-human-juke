import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { isTauriDesktopRuntime, resolveTauriWindowUrl } from './routePath'

export type OpenLyricMachineWindowResult = {
  openedInNewTabWindow: boolean
  blockedByPopup: boolean
  errorMessage?: string | null
}

type OpenLyricMachineScreenOptions = {
  title?: string | null
  artist?: string | null
  songId?: string | null
  librarySongId?: string | null
  album?: string | null
  duration?: number | string | null
  locale?: 'en' | 'da' | 'is' | null
}

let _activeLyricMachineWindow: WebviewWindow | null = null

export async function openLyricMachineScreen(options: OpenLyricMachineScreenOptions = {}): Promise<OpenLyricMachineWindowResult> {
  const lyricMachineUrl = new URLSearchParams()
  const normalizedLocale = (() => {
    const explicitLocale = (options.locale ?? '').trim().toLowerCase()
    if (explicitLocale === 'en' || explicitLocale === 'da' || explicitLocale === 'is') {
      return explicitLocale
    }

    if (typeof window !== 'undefined') {
      const storedLocale = (window.localStorage.getItem('human-jukebox-audience-locale') ?? '').trim().toLowerCase()
      if (storedLocale === 'en' || storedLocale === 'da' || storedLocale === 'is') {
        return storedLocale
      }
    }

    return null
  })()

  if (options.title?.trim()) {
    lyricMachineUrl.set('title', options.title.trim())
  }

  if (options.artist?.trim()) {
    lyricMachineUrl.set('artist', options.artist.trim())
  }

  if (options.songId?.trim()) {
    lyricMachineUrl.set('songId', options.songId.trim())
  }

  if (options.librarySongId?.trim()) {
    lyricMachineUrl.set('librarySongId', options.librarySongId.trim())
  }

  if (options.album?.trim()) {
    lyricMachineUrl.set('album', options.album.trim())
  }

  if (typeof options.duration === 'number' && Number.isFinite(options.duration)) {
    lyricMachineUrl.set('duration', String(options.duration))
  } else if (typeof options.duration === 'string' && options.duration.trim()) {
    lyricMachineUrl.set('duration', options.duration.trim())
  }

  if (normalizedLocale) {
    lyricMachineUrl.set('locale', normalizedLocale)
  }

  const lyricMachineRoutePath = `/lyric-machine${lyricMachineUrl.toString() ? `?${lyricMachineUrl.toString()}` : ''}`
  const lyricMachineWindowUrl = isTauriDesktopRuntime()
    ? resolveTauriWindowUrl(lyricMachineRoutePath)
    : lyricMachineRoutePath

  if (isTauriDesktopRuntime()) {
    try {
      if (_activeLyricMachineWindow !== null) {
        try {
          const visible = await _activeLyricMachineWindow.isVisible()
          if (visible) {
            // Ensure reused lyric-machine window always lands on the dedicated route.
            // This prevents stale windows from staying on /lyrics with admin/back controls.
            const windowWithEval = _activeLyricMachineWindow as unknown as { eval?: (script: string) => Promise<unknown> }
            if (windowWithEval.eval) {
              await windowWithEval.eval(`window.location.replace(${JSON.stringify(lyricMachineWindowUrl)});`)
            }
            await _activeLyricMachineWindow.show()
            await _activeLyricMachineWindow.setFocus()
            return {
              openedInNewTabWindow: true,
              blockedByPopup: false,
              errorMessage: null,
            }
          }
        } catch {
          _activeLyricMachineWindow = null
        }
      }

      const windowLabel = `lyric-machine-${Date.now()}`
      const lyricMachineWindow = new WebviewWindow(windowLabel, {
        url: lyricMachineWindowUrl,
        title: 'Lyric Machine',
        width: 1280,
        height: 800,
        resizable: true,
        fullscreen: false,
        decorations: true,
      })

      return await new Promise<OpenLyricMachineWindowResult>(resolve => {
        const timerId = setTimeout(() => {
          _activeLyricMachineWindow = lyricMachineWindow
          resolve({
            openedInNewTabWindow: true,
            blockedByPopup: false,
            errorMessage: null,
          })
        }, 6000)

        lyricMachineWindow.once('tauri://created', () => {
          clearTimeout(timerId)
          _activeLyricMachineWindow = lyricMachineWindow
          lyricMachineWindow.once('tauri://destroyed', () => {
            if (_activeLyricMachineWindow === lyricMachineWindow) {
              _activeLyricMachineWindow = null
            }
          })
          resolve({
            openedInNewTabWindow: true,
            blockedByPopup: false,
            errorMessage: null,
          })
        })

        lyricMachineWindow.once('tauri://error', (err: unknown) => {
          clearTimeout(timerId)
          resolve({
            openedInNewTabWindow: false,
            blockedByPopup: true,
            errorMessage: String(err),
          })
        })
      })
    } catch (error) {
      return {
        openedInNewTabWindow: false,
        blockedByPopup: true,
        errorMessage: error instanceof Error ? error.message : 'Failed to open lyric machine window',
      }
    }
  }

  return {
    openedInNewTabWindow: true,
    blockedByPopup: false,
    errorMessage: null,
  }
}
