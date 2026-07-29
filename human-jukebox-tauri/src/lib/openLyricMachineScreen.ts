import { invoke } from '@tauri-apps/api/core'
import { isTauriDesktopRuntime } from './routePath'

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

  const resolvedBrowserOrigin = (
    import.meta.env.VITE_PUBLIC_APP_ORIGIN?.trim()
    || import.meta.env.VITE_WEB_APP_ORIGIN?.trim()
    || import.meta.env.VITE_DEV_PUBLIC_ORIGIN?.trim()
    || 'https://www.the-human-jukebox.org'
  ).replace(/\/$/, '')

  const lyricMachineBrowserUrl = `${resolvedBrowserOrigin}${lyricMachineRoutePath}`

  if (isTauriDesktopRuntime()) {
    try {
      await invoke('open_external_url', { url: lyricMachineBrowserUrl })
      return {
        openedInNewTabWindow: true,
        blockedByPopup: false,
        errorMessage: null,
      }
    } catch (error) {
      return {
        openedInNewTabWindow: false,
        blockedByPopup: true,
        errorMessage: error instanceof Error ? error.message : 'Failed to open lyric machine in browser',
      }
    }
  }

  const lyricMachineTab = window.open(lyricMachineBrowserUrl, 'lyric-machine-window', 'width=1280,height=800,noopener,noreferrer')
  if (lyricMachineTab) {
    lyricMachineTab.focus()
    return {
      openedInNewTabWindow: true,
      blockedByPopup: false,
      errorMessage: null,
    }
  }

  return {
    openedInNewTabWindow: false,
    blockedByPopup: true,
    errorMessage: 'Pop-up blocked. Please allow pop-ups for this site and try again.',
  }
}
