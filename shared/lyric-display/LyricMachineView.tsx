import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import AudienceLyricView, { type LyricMachineDisplayPreset } from './AudienceLyricView'
import { useSharedLyricState } from './state'
import type { LyricSongRef } from './types'

type LyricMachineViewProps = {
  supabase: SupabaseClient
  activeSong: LyricSongRef | null
  eventId?: string | null
  showLogoScreen?: boolean
  returnToPath?: string
  onOpenExternalUrl?: (url: string) => Promise<boolean>
}

const DISPLAY_PRESET_STORAGE_KEY = 'human-jukebox-lyric-machine-display-preset-v1'
const ROTATION_DEGREES_STORAGE_KEY = 'human-jukebox-lyric-machine-rotation-degrees-v1'
const TOOLBAR_AUTO_HIDE_MS = 5_000
const ROTATION_DEGREES_OPTIONS = [0, 90, 180, 270] as const
const BROWSER_CAST_ORIGIN = 'https://www.the-human-jukebox.org'
const DISPLAY_PRESETS: Array<{ id: LyricMachineDisplayPreset; label: string; description: string }> = [
  { id: 'tight', label: 'Compact', description: 'Fits more lines with tighter spacing' },
  { id: 'balanced', label: 'Balanced', description: 'Best all-around fit for the frame' },
  { id: 'wide', label: 'Spread', description: 'Uses more of the screen width' },
  { id: 'max', label: 'Full', description: 'Pushes the lyric to use the full tab' },
]

function isFullscreenActive() {
  if (typeof document === 'undefined') {
    return false
  }

  const fullscreenDocument = document as Document & {
    webkitFullscreenElement?: Element | null
  }

  return Boolean(document.fullscreenElement || fullscreenDocument.webkitFullscreenElement)
}

function isBrowserWindowFullscreen() {
  if (typeof window === 'undefined') {
    return false
  }

  const nearlyEqual = (left: number, right: number, tolerance = 2) => Math.abs(left - right) <= tolerance
  const matchesWindowBounds = nearlyEqual(window.innerWidth, window.screen.width)
    && nearlyEqual(window.innerHeight, window.screen.height)
  const displayModeFullscreen = typeof window.matchMedia === 'function'
    ? window.matchMedia('(display-mode: fullscreen)').matches
    : false

  return matchesWindowBounds || displayModeFullscreen
}

function isLyricMachineFullscreen() {
  return isFullscreenActive() || isBrowserWindowFullscreen()
}

function isTauriRuntime() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.location.protocol === 'tauri:'
    || window.location.protocol === 'file:'
    || '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>)
}

function readStoredDisplayPreset(): LyricMachineDisplayPreset {
  if (typeof window === 'undefined') {
    return 'max'
  }

  const stored = window.localStorage.getItem(DISPLAY_PRESET_STORAGE_KEY)?.trim() as LyricMachineDisplayPreset | null
  if (stored && DISPLAY_PRESETS.some((preset) => preset.id === stored)) {
    return stored
  }

  return 'max'
}

function readStoredRotationDegrees() {
  if (typeof window === 'undefined') {
    return 0
  }

  const stored = Number(window.localStorage.getItem(ROTATION_DEGREES_STORAGE_KEY) ?? '0')
  if (ROTATION_DEGREES_OPTIONS.includes(stored as (typeof ROTATION_DEGREES_OPTIONS)[number])) {
    return stored
  }

  return 0
}

export default function LyricMachineView({
  supabase,
  activeSong,
  eventId = null,
  showLogoScreen = false,
  returnToPath = '/admin/gig-control',
  onOpenExternalUrl,
}: LyricMachineViewProps) {
  const [hasOpened, setHasOpened] = useState(false)
  const [displayPreset, setDisplayPreset] = useState<LyricMachineDisplayPreset>(() => readStoredDisplayPreset())
  const [rotationDegrees, setRotationDegrees] = useState<number>(() => readStoredRotationDegrees())
  const [isToolbarVisible, setIsToolbarVisible] = useState(true)
  const [isInFullscreen, setIsInFullscreen] = useState(() => isLyricMachineFullscreen())
  const [browserCastStatus, setBrowserCastStatus] = useState('')
  const autoHideTimeoutRef = useRef<number | null>(null)
  const toolbarVisibilityBeforeFullscreenRef = useRef(true)
  const wasInFullscreenRef = useRef(isLyricMachineFullscreen())
  const lyricStateController = useSharedLyricState(supabase, 'lyric-machine')

  const clearToolbarAutoHide = useCallback(() => {
    if (autoHideTimeoutRef.current !== null) {
      clearTimeout(autoHideTimeoutRef.current)
      autoHideTimeoutRef.current = null
    }
  }, [])

  const scheduleToolbarAutoHide = useCallback(() => {
    if (showLogoScreen || isInFullscreen || typeof window === 'undefined') {
      return
    }

    clearToolbarAutoHide()
    autoHideTimeoutRef.current = window.setTimeout(() => {
      setIsToolbarVisible(false)
    }, TOOLBAR_AUTO_HIDE_MS)
  }, [clearToolbarAutoHide, isInFullscreen, showLogoScreen])

  const revealToolbar = useCallback(() => {
    if (showLogoScreen || isInFullscreen) {
      return
    }

    setIsToolbarVisible(true)
    scheduleToolbarAutoHide()
  }, [isInFullscreen, scheduleToolbarAutoHide, showLogoScreen])

  const openInBrowserForCast = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }

    const searchParams = new URLSearchParams()
    if (activeSong?.title?.trim()) {
      searchParams.set('title', activeSong.title.trim())
    }
    if (activeSong?.artist?.trim()) {
      searchParams.set('artist', activeSong.artist.trim())
    }
    if (activeSong?.id?.trim()) {
      searchParams.set('songId', activeSong.id.trim())
    }
    if (activeSong?.librarySongId?.trim()) {
      searchParams.set('librarySongId', activeSong.librarySongId.trim())
    }
    if (activeSong?.album?.trim()) {
      searchParams.set('album', activeSong.album.trim())
    }
    if (typeof activeSong?.duration === 'number' && Number.isFinite(activeSong.duration)) {
      searchParams.set('duration', String(activeSong.duration))
    }
    if (eventId?.trim()) {
      searchParams.set('event', eventId.trim())
    }

    const appOrigin = import.meta.env.VITE_PUBLIC_APP_ORIGIN?.trim()
      || import.meta.env.VITE_WEB_APP_ORIGIN?.trim()
      || import.meta.env.VITE_DEV_PUBLIC_ORIGIN?.trim()
      || BROWSER_CAST_ORIGIN
    const normalizedOrigin = appOrigin.replace(/\/$/, '')
    const castUrl = `${normalizedOrigin}/lyric-machine${searchParams.toString() ? `?${searchParams.toString()}` : ''}`

    const openViaWindow = () => {
      const openedWindow = window.open(castUrl, '_blank', 'noopener,noreferrer')
      if (openedWindow) {
        openedWindow.focus()
        setBrowserCastStatus('Opened browser. Use the browser cast menu (three dots) to cast.')
        scheduleToolbarAutoHide()
        return true
      }

      return false
    }

    if (isTauriRuntime() && onOpenExternalUrl) {
      void onOpenExternalUrl(castUrl)
        .then((openedByTauri) => {
          if (openedByTauri) {
            setBrowserCastStatus('Opened browser. Use the browser cast menu (three dots) to cast.')
            scheduleToolbarAutoHide()
            return
          }

          const opened = openViaWindow()
          if (!opened) {
            setBrowserCastStatus('Browser could not be opened. Please allow pop-ups and try again.')
          }
        })
        .catch(() => {
          const opened = openViaWindow()
          if (!opened) {
            setBrowserCastStatus('Browser could not be opened. Please allow pop-ups and try again.')
          }
        })
      return
    }

    const opened = openViaWindow()
    if (!opened) {
      setBrowserCastStatus('Browser could not be opened. Please allow pop-ups and try again.')
    }
  }, [activeSong, eventId, onOpenExternalUrl, scheduleToolbarAutoHide])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsInFullscreen(isLyricMachineFullscreen())
    }

    onFullscreenChange()
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('webkitfullscreenchange', onFullscreenChange as EventListener)
    window.addEventListener('resize', onFullscreenChange)
    window.addEventListener('focus', onFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange as EventListener)
      window.removeEventListener('resize', onFullscreenChange)
      window.removeEventListener('focus', onFullscreenChange)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const intervalId = window.setInterval(() => {
      const fullscreenNow = isLyricMachineFullscreen()
      setIsInFullscreen((currentFullscreen) => (currentFullscreen === fullscreenNow ? currentFullscreen : fullscreenNow))
    }, 350)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (isInFullscreen && !wasInFullscreenRef.current) {
      toolbarVisibilityBeforeFullscreenRef.current = isToolbarVisible
      clearToolbarAutoHide()
      setIsToolbarVisible(false)
      wasInFullscreenRef.current = true
      return
    }

    if (isInFullscreen) {
      return
    }

    if (wasInFullscreenRef.current) {
      wasInFullscreenRef.current = false
      const nextVisibility = toolbarVisibilityBeforeFullscreenRef.current
      setIsToolbarVisible(nextVisibility)
      if (nextVisibility && !showLogoScreen) {
        scheduleToolbarAutoHide()
      }
    }
  }, [clearToolbarAutoHide, isInFullscreen, isToolbarVisible, scheduleToolbarAutoHide, showLogoScreen])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(DISPLAY_PRESET_STORAGE_KEY, displayPreset)
  }, [displayPreset])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(ROTATION_DEGREES_STORAGE_KEY, String(rotationDegrees))
  }, [rotationDegrees])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (showLogoScreen || isInFullscreen) {
      clearToolbarAutoHide()
      setIsToolbarVisible(false)
      return
    }

    if (isToolbarVisible) {
      scheduleToolbarAutoHide()
    }

    const onInteraction = () => {
      revealToolbar()
    }

    window.addEventListener('mousemove', onInteraction, { passive: true })
    window.addEventListener('pointerdown', onInteraction, { passive: true })
    window.addEventListener('keydown', onInteraction)

    return () => {
      window.removeEventListener('mousemove', onInteraction)
      window.removeEventListener('pointerdown', onInteraction)
      window.removeEventListener('keydown', onInteraction)
      clearToolbarAutoHide()
    }
  }, [clearToolbarAutoHide, isInFullscreen, isToolbarVisible, revealToolbar, scheduleToolbarAutoHide, showLogoScreen])

  useEffect(() => {
    if (showLogoScreen || !activeSong || hasOpened) {
      return
    }

    setHasOpened(true)
    void lyricStateController.openLyricForSong(activeSong, returnToPath)
  }, [activeSong, hasOpened, lyricStateController, returnToPath, showLogoScreen])

  const rotateDisplay = useCallback(() => {
    setRotationDegrees((currentRotationDegrees) => {
      const currentIndex = ROTATION_DEGREES_OPTIONS.indexOf(
        currentRotationDegrees as (typeof ROTATION_DEGREES_OPTIONS)[number],
      )
      const nextIndex = currentIndex < 0
        ? 0
        : (currentIndex + 1) % ROTATION_DEGREES_OPTIONS.length
      return ROTATION_DEGREES_OPTIONS[nextIndex]
    })
    scheduleToolbarAutoHide()
  }, [scheduleToolbarAutoHide])

  useEffect(() => {
    if (showLogoScreen || !activeSong || !hasOpened) {
      return
    }

    const sameSongById = lyricStateController.state.song?.id === activeSong.id
    const sameSongByTitleArtist = (
      (lyricStateController.state.song?.title ?? '').trim().toLowerCase() === activeSong.title.trim().toLowerCase()
      && (lyricStateController.state.song?.artist ?? '').trim().toLowerCase() === activeSong.artist.trim().toLowerCase()
    )

    if (sameSongById || sameSongByTitleArtist) {
      return
    }

    void lyricStateController.openLyricForSong(activeSong, returnToPath)
  }, [activeSong, hasOpened, lyricStateController, returnToPath, showLogoScreen])

  return (
    <main style={{ minHeight: '100vh', minWidth: '100vw' }}>
      {showLogoScreen ? (
        <div className={`lyric-machine-viewport lyric-machine-viewport-rot-${rotationDegrees}`}>
          <section className="lyric-dark-neon-shell lyric-machine-logo-shell" aria-label="Lyric machine intermission screen">
            <div className="lyric-machine-logo-card">
              <img src="/the-human-jukebox-logo.svg" alt="The Human Jukebox" className="lyric-machine-logo-mark" />
              <p className="lyric-machine-logo-title">The Human Jukebox</p>
              <p className="lyric-machine-logo-caption">Waiting for the next song</p>
            </div>
          </section>
        </div>
      ) : (
        <>
          <div
            className={`lyric-machine-display-toolbar${isToolbarVisible ? '' : ' lyric-machine-display-toolbar-hidden'}${isInFullscreen ? ' lyric-machine-display-toolbar-fullscreen-hidden' : ''}`}
            role="toolbar"
            aria-label="Lyric display presets"
            aria-hidden={!isToolbarVisible || isInFullscreen}
          >
            <button
              type="button"
              className="lyric-machine-display-btn"
              onClick={rotateDisplay}
              title="Rotate lyric display"
              aria-label="Rotate lyric display"
            >
              Rotate {rotationDegrees}°
            </button>
            {DISPLAY_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`lyric-machine-display-btn${displayPreset === preset.id ? ' lyric-machine-display-btn-active' : ''}`}
                onClick={() => {
                  setDisplayPreset(preset.id)
                  scheduleToolbarAutoHide()
                }}
                aria-pressed={displayPreset === preset.id}
                title={preset.description}
              >
                {preset.label}
              </button>
            ))}
            {isTauriRuntime() ? (
              <button
                type="button"
                className="lyric-machine-display-btn"
                onClick={openInBrowserForCast}
                title="Open LyricMachine in browser for native cast menu"
                aria-label="Open LyricMachine in browser for native cast menu"
              >
                Open Browser Cast
              </button>
            ) : null}
            {browserCastStatus ? <p className="lyric-machine-browser-cast-status">{browserCastStatus}</p> : null}
          </div>
          <div className={`lyric-machine-viewport lyric-machine-viewport-rot-${rotationDegrees}`}>
            <AudienceLyricView state={lyricStateController.state} layoutMode="fit-16-9" fitPreset={displayPreset} />
          </div>
        </>
      )}
    </main>
  )
}
