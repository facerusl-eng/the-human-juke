import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import LiveFeedPanel from '../components/LiveFeedPanel'
import { readCommittedAudienceLocale, type AudienceLocale } from '../lib/audienceIdentity'
import { getAudienceUrl } from '../lib/audienceUrl'
import { logCrashTelemetry } from '../lib/crashTelemetry'
import {
  PLAYBACK_STATE_BROADCAST_CHANNEL,
  PLAYBACK_STATE_EVENT,
  PLAYBACK_STATE_STORAGE_KEY,
  readSharedPlaybackState,
  writeSharedPlaybackState,
  type SharedPlaybackState,
  BETWEEN_SONG_QUOTES,
} from '../lib/playbackState'
import { supabase } from '../lib/supabase'
import { useQueueStore, type QueueSong } from '../state/queueStore'
import { useAuthStore } from '../state/authStore'
import { setGigOGTags, resetOGTags } from '../lib/metaTags'
import { readTextFromLocalStorage, saveTextToLocalStorage } from '../lib/saveHandling'
import { demoMode, homeMirrorPreviewMode } from '../demo/demoMode'
import { DEMO_NOW_PLAYING_FACTS } from '../demo/demoNowPlaying'

type FeedImageSpotlight = {
  id: string
  eventId: string
  imageDataUrl: string
  authorName: string
  caption: string
}

const SPOTLIGHT_CAPTION_BUILDERS = [
  (authorName: string) => `📸 ${authorName}, you just made the show 10× more beautiful ✨`,
  (authorName: string) => `🌟 ${authorName} with the VIP shot — we see you! 🎉`,
  (authorName: string) => `❤️ ${authorName}, thanks for sharing — you absolute legend!`,
  (authorName: string) => `🎶 ${authorName} came, vibed, and left photographic evidence. Love it!`,
  (authorName: string) => `🥳 ${authorName}, this pic just became the cover of tonight's album!`,
  (authorName: string) => `🔥 ${authorName} proving once again that the audience steals the show!`,
  (authorName: string) => `😍 ${authorName}, this photo deserves a standing ovation. Respect.`,
  (authorName: string) => `🎤 ${authorName} dropping evidence of a great night — we love this!`,
  (authorName: string) => `✨ ${authorName}, you made the feed instantly classier. No debate.`,
  (authorName: string) => `🎸 ${authorName} with the snap heard around the room! 📸`,
]

const CHOSEN_BY_BUILDERS = [
  (name: string) => `Chosen by ${name} - excellent taste, no notes.`,
  (name: string) => `Chosen by ${name} - a cracking pick, frankly.`,
  (name: string) => `Chosen by ${name} - proper tune, that one.`,
  (name: string) => `Chosen by ${name} - bold, brilliant, and slightly dangerous.`,
  (name: string) => `Chosen by ${name} - the crowd approves with nods and pints.`,
  (name: string) => `Chosen by ${name} - certified banger behaviour.`,
  (name: string) => `Chosen by ${name} - top shelf decision-making.`,
  (name: string) => `Chosen by ${name} - absolutely spot on, mate.`,
]

const CHOSEN_BY_ACCENT_CLASSES = [
  'mirror-picker-accent-1',
  'mirror-picker-accent-2',
  'mirror-picker-accent-3',
  'mirror-picker-accent-4',
  'mirror-picker-accent-5',
  'mirror-picker-accent-6',
  'mirror-picker-accent-7',
  'mirror-picker-accent-8',
]

const SPOTLIGHT_DURATION_MS = 7000
const SPOTLIGHT_POLL_INTERVAL_MS = 2000
const QUOTE_ROTATE_INTERVAL_MS = 20000
const SONG_INFO_ROTATE_INTERVAL_MS = 20000
const SONG_FACT_MAX_LENGTH = 180
const MIRROR_FUN_FACTS_CACHE_STORAGE_KEY = 'human-jukebox-mirror-fun-facts-cache-v3'
const MIRROR_HIGH_CONTRAST_STORAGE_KEY = 'human-jukebox-mirror-high-contrast'
const MIRROR_PLAYBACK_STORAGE_KEY = PLAYBACK_STATE_STORAGE_KEY
const MIRROR_PLAYBACK_BROADCAST_CHANNEL = PLAYBACK_STATE_BROADCAST_CHANNEL
const MIRROR_SAFE_MARGINS_STORAGE_KEY = 'human-jukebox-mirror-safe-margins'
const MIRROR_VENUE_MODE_STORAGE_KEY = 'human-jukebox-mirror-venue-mode'
const MIRROR_BANNER_STORAGE_KEY = 'human-jukebox-mirror-banner-text'
const MIRROR_LAYOUT_EDIT_STORAGE_KEY = 'human-jukebox-mirror-layout-edit-mode'
const MIRROR_LAYOUT_STATE_STORAGE_KEY = 'human-jukebox-mirror-layout-state'
const MIRROR_LAYOUT_STATE_PROFILE_COLUMN = 'default_mirror_layout_state'
const MIRROR_WARNING_MIN_VISIBLE_MS = 2600
const MIRROR_AUTO_FULLSCREEN_QUERY_PARAM = 'launchFullscreen'
const MIRROR_LAYOUT_EDIT_QUERY_PARAM = 'layoutEdit'
const SPOTIFY_ACCESS_TOKEN_STORAGE_KEY = 'human-jukebox-spotify-access-token'
const SPOTIFY_AUTO_TRANSPORT_STORAGE_KEY = 'human-jukebox-spotify-auto-transport'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isMirrorLayoutEditRequest = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get(MIRROR_LAYOUT_EDIT_QUERY_PARAM) === '1'

type MirrorDensityMode = 'medium' | 'cinema'
type MirrorVenueMode = 'club' | 'lounge' | 'festival'
type MirrorLayoutPanelId = 'brandLogo' | 'venueLogo' | 'status' | 'nowPlaying' | 'community' | 'queue' | 'joinQr'
type MirrorLayoutRect = {
  left: number
  top: number
  width: number
  height: number
}
type MirrorLayoutState = Record<MirrorLayoutPanelId, MirrorLayoutRect>
type MirrorLayoutVisibilityState = Record<MirrorLayoutPanelId, boolean>
type NowPlayingInfoSong = Pick<QueueSong, 'title' | 'artist' | 'is_explicit'>
type FunFactsCache = Record<string, string[]>
type SongWithMirrorFacts = QueueSong & { mirrorFunFacts?: string[] }

function mergeMirrorLayoutState(rawState: unknown): MirrorLayoutState {
  if (!rawState || typeof rawState !== 'object') {
    return DEFAULT_MIRROR_LAYOUT_STATE
  }

  const parsedState = rawState as Partial<MirrorLayoutState>

  return {
    brandLogo: { ...DEFAULT_MIRROR_LAYOUT_STATE.brandLogo, ...parsedState.brandLogo },
    venueLogo: { ...DEFAULT_MIRROR_LAYOUT_STATE.venueLogo, ...parsedState.venueLogo },
    status: { ...DEFAULT_MIRROR_LAYOUT_STATE.status, ...parsedState.status },
    nowPlaying: { ...DEFAULT_MIRROR_LAYOUT_STATE.nowPlaying, ...parsedState.nowPlaying },
    community: { ...DEFAULT_MIRROR_LAYOUT_STATE.community, ...parsedState.community },
    queue: { ...DEFAULT_MIRROR_LAYOUT_STATE.queue, ...parsedState.queue },
    joinQr: { ...DEFAULT_MIRROR_LAYOUT_STATE.joinQr, ...parsedState.joinQr },
  }
}

function isMissingMirrorLayoutProfileColumnError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }

  const normalizedError = error as {
    code?: unknown
    message?: unknown
    details?: unknown
    hint?: unknown
  }

  const code = typeof normalizedError.code === 'string' ? normalizedError.code : ''
  const text = [normalizedError.message, normalizedError.details, normalizedError.hint]
    .map((value) => (typeof value === 'string' ? value.toLowerCase() : ''))
    .join(' ')

  return (code === '42703' || code === 'PGRST204') && text.includes(MIRROR_LAYOUT_STATE_PROFILE_COLUMN)
}

async function loadGlobalMirrorLayoutState(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select(MIRROR_LAYOUT_STATE_PROFILE_COLUMN)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    if (isMissingMirrorLayoutProfileColumnError(error)) {
      return null
    }

    throw error
  }

  const rawState = (data as Record<string, unknown> | null)?.[MIRROR_LAYOUT_STATE_PROFILE_COLUMN]

  if (!rawState) {
    return null
  }

  return mergeMirrorLayoutState(rawState)
}

async function saveGlobalMirrorLayoutState(userId: string, layoutState: MirrorLayoutState) {
  const { error } = await supabase
    .from('profiles')
    .upsert({
      user_id: userId,
      [MIRROR_LAYOUT_STATE_PROFILE_COLUMN]: layoutState,
    }, { onConflict: 'user_id' })

  if (error) {
    throw error
  }
}

const DEFAULT_MIRROR_LAYOUT_STATE: MirrorLayoutState = {
  brandLogo: {
    left: 2,
    top: 2,
    width: 22,
    height: 10,
  },
  venueLogo: {
    left: 39,
    top: 2,
    width: 22,
    height: 10,
  },
  status: {
    left: 78,
    top: 2,
    width: 18,
    height: 10,
  },
  nowPlaying: {
    left: 2,
    top: 15,
    width: 58,
    height: 32,
  },
  community: {
    left: 2,
    top: 50,
    width: 30,
    height: 46,
  },
  queue: {
    left: 34,
    top: 50,
    width: 32,
    height: 46,
  },
  joinQr: {
    left: 69,
    top: 50,
    width: 27,
    height: 46,
  },
}

const DEFAULT_MIRROR_LAYOUT_VISIBILITY: MirrorLayoutVisibilityState = {
  brandLogo: true,
  venueLogo: true,
  status: true,
  nowPlaying: true,
  community: true,
  queue: true,
  joinQr: true,
}

const MIRROR_LAYOUT_EDITOR_STORAGE_KEY = 'human-jukebox-mirror-layout-editor-state-v1'
const MIRROR_LAYOUT_EDITOR_PREFS_KEY = 'human-jukebox-mirror-layout-editor-prefs-v1'
const MIRROR_LAYOUT_BLOCKS: Array<{ id: MirrorLayoutPanelId; label: string }> = [
  { id: 'brandLogo', label: 'Brand logo' },
  { id: 'venueLogo', label: 'Venue logo' },
  { id: 'status', label: 'Status badge' },
  { id: 'nowPlaying', label: 'Now playing' },
  { id: 'community', label: 'Community' },
  { id: 'queue', label: 'Song queue' },
  { id: 'joinQr', label: 'Join QR' },
]

const MIRROR_LAYOUT_MIN_WIDTH = 12
const MIRROR_LAYOUT_MIN_HEIGHT = 14
const MIRROR_LAYOUT_MIN_VISIBLE = 6

function clampMirrorLayoutRect(rect: MirrorLayoutRect): MirrorLayoutRect {
  const width = Math.min(Math.max(rect.width, MIRROR_LAYOUT_MIN_WIDTH), 100)
  const height = Math.min(Math.max(rect.height, MIRROR_LAYOUT_MIN_HEIGHT), 100)
  const left = Math.min(Math.max(rect.left, MIRROR_LAYOUT_MIN_VISIBLE - width), 100 - MIRROR_LAYOUT_MIN_VISIBLE)
  const top = Math.min(Math.max(rect.top, MIRROR_LAYOUT_MIN_VISIBLE - height), 100 - MIRROR_LAYOUT_MIN_VISIBLE)

  return {
    left,
    top,
    width,
    height,
  }
}

function MirrorLayoutEditorPage() {
  const editorShellRef = useRef<HTMLDivElement | null>(null)
  const interactionRef = useRef<{
    panelId: MirrorLayoutPanelId
    mode: 'drag' | 'resize'
    pointerId: number
    startX: number
    startY: number
    startRect: MirrorLayoutRect
    startState: MirrorLayoutState
    shellWidth: number
    shellHeight: number
  } | null>(null)
  const [layoutState, setLayoutState] = useState<MirrorLayoutState>(() => {
    const savedText = readTextFromLocalStorage(MIRROR_LAYOUT_EDITOR_STORAGE_KEY)

    if (!savedText) {
      return DEFAULT_MIRROR_LAYOUT_STATE
    }

    try {
      const savedState = JSON.parse(savedText) as Partial<MirrorLayoutState>
      return {
        brandLogo: { ...DEFAULT_MIRROR_LAYOUT_STATE.brandLogo, ...savedState.brandLogo },
        venueLogo: { ...DEFAULT_MIRROR_LAYOUT_STATE.venueLogo, ...savedState.venueLogo },
        status: { ...DEFAULT_MIRROR_LAYOUT_STATE.status, ...savedState.status },
        nowPlaying: { ...DEFAULT_MIRROR_LAYOUT_STATE.nowPlaying, ...savedState.nowPlaying },
        community: { ...DEFAULT_MIRROR_LAYOUT_STATE.community, ...savedState.community },
        queue: { ...DEFAULT_MIRROR_LAYOUT_STATE.queue, ...savedState.queue },
        joinQr: { ...DEFAULT_MIRROR_LAYOUT_STATE.joinQr, ...savedState.joinQr },
      }
    } catch {
      return DEFAULT_MIRROR_LAYOUT_STATE
    }
  })
  const [visibleBlocks, setVisibleBlocks] = useState<MirrorLayoutVisibilityState>(() => {
    const savedText = readTextFromLocalStorage(MIRROR_LAYOUT_EDITOR_PREFS_KEY)

    if (!savedText) {
      return DEFAULT_MIRROR_LAYOUT_VISIBILITY
    }

    try {
      const savedPrefs = JSON.parse(savedText) as { visibleBlocks?: Partial<MirrorLayoutVisibilityState> }
      return {
        ...DEFAULT_MIRROR_LAYOUT_VISIBILITY,
        ...savedPrefs.visibleBlocks,
      }
    } catch {
      return DEFAULT_MIRROR_LAYOUT_VISIBILITY
    }
  })
  const [snapToGrid, setSnapToGrid] = useState(() => {
    const savedText = readTextFromLocalStorage(MIRROR_LAYOUT_EDITOR_PREFS_KEY)

    if (!savedText) {
      return false
    }

    try {
      const savedPrefs = JSON.parse(savedText) as { snapToGrid?: boolean }
      return savedPrefs.snapToGrid ?? false
    } catch {
      return false
    }
  })
  const [showGrid, setShowGrid] = useState(() => {
    const savedText = readTextFromLocalStorage(MIRROR_LAYOUT_EDITOR_PREFS_KEY)

    if (!savedText) {
      return true
    }

    try {
      const savedPrefs = JSON.parse(savedText) as { showGrid?: boolean }
      return savedPrefs.showGrid ?? true
    } catch {
      return true
    }
  })
  const [showBlockPicker, setShowBlockPicker] = useState(true)
  const [activePanelId, setActivePanelId] = useState<MirrorLayoutPanelId | null>(null)

  useEffect(() => {
    void saveTextToLocalStorage(MIRROR_LAYOUT_EDITOR_STORAGE_KEY, JSON.stringify(layoutState))
  }, [layoutState])

  useEffect(() => {
    void saveTextToLocalStorage(MIRROR_LAYOUT_EDITOR_PREFS_KEY, JSON.stringify({
      visibleBlocks,
      snapToGrid,
      showGrid,
    }))
  }, [showGrid, snapToGrid, visibleBlocks])

  useEffect(() => {
    const onPointerMove = (pointerEvent: PointerEvent) => {
      const interaction = interactionRef.current

      if (!interaction || pointerEvent.pointerId !== interaction.pointerId) {
        return
      }

      const deltaX = ((pointerEvent.clientX - interaction.startX) / interaction.shellWidth) * 100
      const deltaY = ((pointerEvent.clientY - interaction.startY) / interaction.shellHeight) * 100

      setLayoutState((currentState) => {
        const startRect = interaction.startState[interaction.panelId]
        const rawRect = interaction.mode === 'resize'
          ? clampMirrorLayoutRect({
            left: startRect.left,
            top: startRect.top,
            width: startRect.width + deltaX,
            height: startRect.height + deltaY,
          })
          : clampMirrorLayoutRect({
            left: startRect.left + deltaX,
            top: startRect.top + deltaY,
            width: startRect.width,
            height: startRect.height,
          })

        const nextRect = snapToGrid
          ? {
            left: Math.round(rawRect.left),
            top: Math.round(rawRect.top),
            width: Math.round(rawRect.width),
            height: Math.round(rawRect.height),
          }
          : rawRect

        return {
          ...currentState,
          [interaction.panelId]: nextRect,
        }
      })
    }

    const endInteraction = (pointerEvent?: PointerEvent) => {
      const interaction = interactionRef.current

      if (!interaction) {
        return
      }

      if (!pointerEvent || pointerEvent.pointerId === interaction.pointerId) {
        interactionRef.current = null
        setActivePanelId(null)
      }
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endInteraction)
    window.addEventListener('pointercancel', endInteraction)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endInteraction)
      window.removeEventListener('pointercancel', endInteraction)
    }
  }, [snapToGrid])

  const startInteraction = useCallback((panelId: MirrorLayoutPanelId, mode: 'drag' | 'resize', pointerEvent: React.PointerEvent<HTMLElement>) => {
    if (!editorShellRef.current) {
      return
    }

    const shellRect = editorShellRef.current.getBoundingClientRect()

    if (shellRect.width <= 0 || shellRect.height <= 0) {
      return
    }

    pointerEvent.preventDefault()
    pointerEvent.stopPropagation()
    setActivePanelId(panelId)

    interactionRef.current = {
      panelId,
      mode,
      pointerId: pointerEvent.pointerId,
      startX: pointerEvent.clientX,
      startY: pointerEvent.clientY,
      startRect: layoutState[panelId],
      startState: layoutState,
      shellWidth: shellRect.width,
      shellHeight: shellRect.height,
    }

    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId)
  }, [layoutState])

  const beginInteraction = useCallback((panelId: MirrorLayoutPanelId, mode: 'drag' | 'resize') => (pointerEvent: React.PointerEvent<HTMLElement>) => {
    startInteraction(panelId, mode, pointerEvent)
  }, [startInteraction])

  const beginPanelDrag = useCallback((panelId: MirrorLayoutPanelId) => (pointerEvent: React.PointerEvent<HTMLElement>) => {
    const target = pointerEvent.target as HTMLElement

    if (target.closest('.mirror-layout-resize-handle')) {
      return
    }

    startInteraction(panelId, 'drag', pointerEvent)
  }, [layoutState])

  const layoutStyles = useMemo(() => (
    (Object.entries(layoutState) as Array<[MirrorLayoutPanelId, MirrorLayoutRect]>)
      .map(([panelId, rect]) => (
        `[data-mirror-layout-panel="${panelId}"] { left: ${rect.left}%; top: ${rect.top}%; width: ${rect.width}%; height: ${rect.height}%; z-index: ${panelId === activePanelId ? 8 : 1}; }`
      ))
      .join('\n')
  ), [activePanelId, layoutState])

  const resetLayout = useCallback(() => {
    setLayoutState(DEFAULT_MIRROR_LAYOUT_STATE)
    setVisibleBlocks(DEFAULT_MIRROR_LAYOUT_VISIBILITY)
    setSnapToGrid(false)
    setShowGrid(true)
    setShowBlockPicker(true)
    setActivePanelId(null)
  }, [])

  return (
    <div ref={editorShellRef} className="mirror-shell mirror-shell-live mirror-shell-bg-human-jukebox mirror-layout-editor-shell" aria-label="Mirror layout editor">
      <style>{`.mirror-layout-editor-shell { position: fixed; inset: 0; overflow: hidden; }\n${layoutStyles}`}</style>
      <div className="mirror-layout-edit-toolbar mirror-layout-edit-toolbar-compact" role="toolbar" aria-label="Mirror layout editor controls">
        <button type="button" className={`mirror-layout-edit-button ${showBlockPicker ? 'mirror-layout-edit-button-primary' : ''}`.trim()} onClick={() => setShowBlockPicker((currentValue) => !currentValue)}>{showBlockPicker ? 'Blocks On' : 'Blocks Off'}</button>
        <button type="button" className={`mirror-layout-edit-button ${snapToGrid ? 'mirror-layout-edit-button-primary' : ''}`.trim()} onClick={() => setSnapToGrid((currentValue) => !currentValue)}>{snapToGrid ? 'Snap On' : 'Snap Off'}</button>
        <button type="button" className={`mirror-layout-edit-button ${showGrid ? 'mirror-layout-edit-button-primary' : ''}`.trim()} onClick={() => setShowGrid((currentValue) => !currentValue)}>{showGrid ? 'Grid On' : 'Grid Off'}</button>
        <button type="button" className="mirror-layout-edit-button" onClick={resetLayout}>Reset</button>
        <button type="button" className="mirror-layout-edit-button mirror-layout-edit-button-primary" onClick={() => window.location.href = '/mirror?demo=true'}>Done</button>
      </div>

      {showBlockPicker ? (
        <aside className="mirror-layout-block-picker" aria-label="Available blocks">
          <p className="mirror-layout-block-picker-title">Available blocks</p>
          <div className="mirror-layout-block-picker-list">
            {MIRROR_LAYOUT_BLOCKS.map((block) => (
              <button
                key={block.id}
                type="button"
                className={`mirror-layout-block-chip ${visibleBlocks[block.id] ? 'mirror-layout-block-chip-active' : ''}`.trim()}
                onClick={() => {
                  setVisibleBlocks((currentBlocks) => ({
                    ...currentBlocks,
                    [block.id]: !currentBlocks[block.id],
                  }))
                }}
              >
                {block.label}
              </button>
            ))}
          </div>
        </aside>
      ) : null}

      {showGrid ? <div className="mirror-layout-grid" aria-hidden="true" /> : null}

      <section className="mirror-layout-editor-panels">
        {visibleBlocks.brandLogo ? (
          <section className="mirror-frame mirror-layout-edit-panel mirror-layout-edit-simple-panel" data-mirror-layout-panel="brandLogo" onPointerDown={beginPanelDrag('brandLogo')}>
            <button type="button" className="mirror-layout-drag-handle" aria-label="Drag brand logo panel" onPointerDown={beginInteraction('brandLogo', 'drag')}>Move</button>
            <div className="mirror-layout-edit-simple-panel-body">
              <img src="/the-human-jukebox-logo.svg" alt="The Human Jukebox" className="mirror-brand-logo" />
            </div>
            <button type="button" className="mirror-layout-resize-handle" aria-label="Resize brand logo panel" onPointerDown={beginInteraction('brandLogo', 'resize')} />
          </section>
        ) : null}

        {visibleBlocks.venueLogo ? (
          <section className="mirror-frame mirror-layout-edit-panel mirror-layout-edit-simple-panel" data-mirror-layout-panel="venueLogo" onPointerDown={beginPanelDrag('venueLogo')}>
            <button type="button" className="mirror-layout-drag-handle" aria-label="Drag venue logo panel" onPointerDown={beginInteraction('venueLogo', 'drag')}>Move</button>
            <div className="mirror-layout-edit-simple-panel-body mirror-layout-edit-logo-placeholder">
              <p>Venue logo</p>
            </div>
            <button type="button" className="mirror-layout-resize-handle" aria-label="Resize venue logo panel" onPointerDown={beginInteraction('venueLogo', 'resize')} />
          </section>
        ) : null}

        {visibleBlocks.status ? (
          <section className="mirror-frame mirror-layout-edit-panel mirror-layout-edit-simple-panel" data-mirror-layout-panel="status" onPointerDown={beginPanelDrag('status')}>
            <button type="button" className="mirror-layout-drag-handle" aria-label="Drag status panel" onPointerDown={beginInteraction('status', 'drag')}>Move</button>
            <div className="mirror-layout-edit-simple-panel-body">
              <span className="mirror-status mirror-open">● Live</span>
            </div>
            <button type="button" className="mirror-layout-resize-handle" aria-label="Resize status panel" onPointerDown={beginInteraction('status', 'resize')} />
          </section>
        ) : null}

        {visibleBlocks.nowPlaying ? (
          <section className="mirror-now-playing mirror-frame mirror-frame-now-playing mirror-layout-edit-panel" data-mirror-layout-panel="nowPlaying" onPointerDown={beginPanelDrag('nowPlaying')}>
          <button type="button" className="mirror-layout-drag-handle" aria-label="Drag now playing panel" onPointerDown={beginInteraction('nowPlaying', 'drag')}>Move</button>
          <p className="mirror-now-playing-band-label">Now Playing</p>
          <div className="mirror-now-playing-track">
            <div className="mirror-now-playing-meta">
              <h1 className="mirror-title">Now playing block</h1>
              <p className="mirror-artist">Drag this anywhere on the screen</p>
              <div className="mirror-song-fact-box">
                <p className="mirror-song-fact-label">Fact</p>
                <p className="mirror-song-fact">Stretch this box bigger or smaller to match the look you want.</p>
              </div>
            </div>
          </div>
          <button type="button" className="mirror-layout-resize-handle" aria-label="Resize now playing panel" onPointerDown={beginInteraction('nowPlaying', 'resize')} />
          </section>
        ) : null}

        {visibleBlocks.community ? (
          <section className="mirror-live-feed-frame mirror-frame mirror-layout-edit-panel" data-mirror-layout-panel="community" onPointerDown={beginPanelDrag('community')}>
          <button type="button" className="mirror-layout-drag-handle" aria-label="Drag live feed panel" onPointerDown={beginInteraction('community', 'drag')}>Move</button>
          <div className="mirror-layout-edit-feed-preview">
            <div className="mirror-layout-edit-feed-preview-header">
              <p className="mirror-layout-edit-feed-preview-eyebrow">Community</p>
              <h2 className="mirror-layout-edit-feed-preview-title">Live Feed Messages</h2>
            </div>
            <div className="mirror-layout-edit-feed-preview-items">
              <p>Drag, stretch, and place this block where you want it.</p>
              <p>Use it as the community / messages area.</p>
            </div>
          </div>
          <button type="button" className="mirror-layout-resize-handle" aria-label="Resize live feed panel" onPointerDown={beginInteraction('community', 'resize')} />
          </section>
        ) : null}

        {visibleBlocks.queue ? (
          <section className="mirror-song-queue-frame mirror-frame mirror-up-next mirror-layout-edit-panel" data-mirror-layout-panel="queue" onPointerDown={beginPanelDrag('queue')}>
          <button type="button" className="mirror-layout-drag-handle" aria-label="Drag song queue panel" onPointerDown={beginInteraction('queue', 'drag')}>Move</button>
          <p className="mirror-up-next-label">Song Queue</p>
          <ol className="mirror-queue">
            <li className="mirror-queue-item mirror-queue-item-next">
              <span className="mirror-queue-pos">1</span>
              <div className="mirror-queue-info">
                <span className="mirror-queue-title">Queue item</span>
                <span className="mirror-queue-artist">Resize this block to fit the queue</span>
              </div>
              <span className="mirror-queue-votes">+0</span>
            </li>
          </ol>
          <button type="button" className="mirror-layout-resize-handle" aria-label="Resize song queue panel" onPointerDown={beginInteraction('queue', 'resize')} />
          </section>
        ) : null}

        {visibleBlocks.joinQr ? (
          <section className="mirror-frame mirror-layout-edit-panel mirror-layout-edit-simple-panel" data-mirror-layout-panel="joinQr" onPointerDown={beginPanelDrag('joinQr')}>
            <button type="button" className="mirror-layout-drag-handle" aria-label="Drag join QR panel" onPointerDown={beginInteraction('joinQr', 'drag')}>Move</button>
            <div className="mirror-layout-edit-simple-panel-body mirror-layout-edit-qr-panel">
              <div className="mirror-layout-edit-qr-box" />
              <p className="mirror-now-playing-qr-label">Join QR</p>
              <p className="mirror-now-playing-qr-url">Place this where the audience should scan</p>
            </div>
            <button type="button" className="mirror-layout-resize-handle" aria-label="Resize join QR panel" onPointerDown={beginInteraction('joinQr', 'resize')} />
          </section>
        ) : null}
      </section>
    </div>
  )
}

function countCharactersWithoutSpaces(text: string) {
  return text.replace(/\s+/g, '').length
}

function buildInitials(text: string) {
  const initials = text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((chunk) => chunk.charAt(0).toUpperCase())
    .join('')

  return initials || '?'
}

function containsFeatToken(text: string) {
  return /\b(feat\.?|ft\.?)\b/i.test(text)
}

function isUuidLikeEventId(eventId: string | null) {
  return Boolean(eventId && UUID_PATTERN.test(eventId.trim()))
}

function truncateFact(value: string, maxLength = SONG_FACT_MAX_LENGTH) {
  const normalizedValue = value.trim()

  if (normalizedValue.length <= maxLength) {
    return normalizedValue
  }

  return `${normalizedValue.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}
function buildFunFactsCacheKey(title: string, artist: string) {
  return `${title.trim().toLowerCase()}::${artist.trim().toLowerCase()}`
}

function extractInterestingSentences(extract: string) {
  const sentenceMatches = extract.match(/[^.!?]+[.!?]+/g) ?? []

  const normalizedSentences = sentenceMatches
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 40 && sentence.length <= SONG_FACT_MAX_LENGTH)
    .filter((sentence) => !/^coordinates?:?/i.test(sentence))

  const uniqueSentences = Array.from(new Set(normalizedSentences))
  return uniqueSentences.slice(0, 10)
}

function normalizeFunFacts(facts: string[]) {
  const normalizedFacts = facts
    .map((fact) => truncateFact(fact))
    .map((fact) => fact.replace(/\s+/g, ' ').trim())
    .filter((fact) => !isLowValueFact(fact))
    .filter(Boolean)

  return Array.from(new Set(normalizedFacts))
}

function isLowValueFact(fact: string) {
  const normalizedFact = fact.trim().toLowerCase()

  return /has\s+\d+\s+word/.test(normalizedFact)
    || /uses\s+\d+\s+characters?/.test(normalizedFact)
    || /title initials/.test(normalizedFact)
    || /artist name\s+"?.+"?\s+has\s+\d+\s+word/.test(normalizedFact)
}

async function fetchItunesSongFacts(title: string, artist: string, signal: AbortSignal) {
  void title
  void artist
  void signal
  return []
}

function isSpotifyAutoTransportEnabled() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(SPOTIFY_AUTO_TRANSPORT_STORAGE_KEY) !== '0'
}

async function sendSpotifyWebApiTransportCommand(mode: 'play' | 'pause') {
  if (typeof window === 'undefined') {
    return false
  }

  const accessToken = window.localStorage.getItem(SPOTIFY_ACCESS_TOKEN_STORAGE_KEY)?.trim()
  if (!accessToken) {
    return false
  }

  const endpoint = mode === 'pause'
    ? 'https://api.spotify.com/v1/me/player/pause'
    : 'https://api.spotify.com/v1/me/player/play'

  try {
    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    return response.ok
  } catch {
    return false
  }
}

async function playIntroAudioWithSpotifyBridge(introAudioUrl: string) {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    return
  }

  const shouldBridgeSpotify = isSpotifyAutoTransportEnabled()

  if (shouldBridgeSpotify) {
    await sendSpotifyWebApiTransportCommand('pause')
  }

  const introAudio = new Audio(introAudioUrl)
  introAudio.preload = 'auto'

  try {
    await introAudio.play()
  } catch (error) {
    if (shouldBridgeSpotify) {
      await sendSpotifyWebApiTransportCommand('play')
    }
    throw error
  }

  await new Promise<void>((resolve) => {
    const cleanup = () => {
      introAudio.removeEventListener('ended', onEnded)
      introAudio.removeEventListener('error', onError)
    }

    const onEnded = () => {
      cleanup()
      if (shouldBridgeSpotify) {
        void sendSpotifyWebApiTransportCommand('play')
      }
      resolve()
    }

    const onError = () => {
      cleanup()
      if (shouldBridgeSpotify) {
        void sendSpotifyWebApiTransportCommand('play')
      }
      resolve()
    }

    introAudio.addEventListener('ended', onEnded, { once: true })
    introAudio.addEventListener('error', onError, { once: true })
  })
}

async function fetchWikipediaSummarySentences(title: string, artist: string, signal: AbortSignal) {
  const candidateTitles = [
    `${title} (song)`,
    title,
    `${title} (${artist} song)`,
    `${title} ${artist}`,
  ]

  for (const candidateTitle of candidateTitles) {
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidateTitle)}`

    try {
      const summaryResponse = await fetch(summaryUrl, { signal })

      if (!summaryResponse.ok) {
        continue
      }

      const summaryPayload = await summaryResponse.json() as {
        extract?: string
      }

      const extract = summaryPayload.extract?.trim()

      if (!extract) {
        continue
      }

      const sentenceFacts = extractInterestingSentences(extract)

      if (sentenceFacts.length >= 3) {
        return sentenceFacts
      }
    } catch {
      // Try next title candidate.
    }
  }

  return []
}

async function fetchMusicBrainzFallbackFacts(title: string, artist: string, signal: AbortSignal) {
  const query = `recording:${JSON.stringify(title)} AND artist:${JSON.stringify(artist)}`
  const searchUrl = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=1`

  try {
    const response = await fetch(searchUrl, {
      signal,
      headers: {
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      return []
    }

    const payload = await response.json() as {
      recordings?: Array<{
        title?: string
        score?: number
        length?: number
        'first-release-date'?: string
        releases?: Array<{ title?: string }>
        'artist-credit'?: Array<{ name?: string }>
      }>
    }

    const recording = payload.recordings?.[0]

    if (!recording) {
      return []
    }

    const releaseTitle = recording.releases?.[0]?.title?.trim()
    const firstReleaseDate = recording['first-release-date']?.trim()
    const artistCredit = recording['artist-credit']?.map((credit) => credit.name?.trim()).filter(Boolean).join(', ')

    const fallbackFacts = [
      recording.score ? `MusicBrainz match confidence is ${recording.score}% for this track.` : null,
      firstReleaseDate ? `MusicBrainz lists the first release date as ${firstReleaseDate}.` : null,
      releaseTitle ? `This track appears on the release "${releaseTitle}" in MusicBrainz.` : null,
      artistCredit ? `MusicBrainz artist credit: ${artistCredit}.` : null,
      recording.length ? `MusicBrainz duration is about ${Math.round(recording.length / 1000)} seconds.` : null,
    ].filter((fact): fact is string => Boolean(fact))

    return fallbackFacts.slice(0, 5)
  } catch {
    return []
  }
}

const SONG_INFO_BUILDERS = [
  (song: NowPlayingInfoSong) => /\//.test(song.title)
    ? `This title looks like a medley set — multiple songs woven into one performance.`
    : `Tonight's crowd voted "${song.title}" to the top of the queue.`,
  (song: NowPlayingInfoSong) => /[()[\]]/.test(song.title)
    ? `Bracketed title detected - this is often a remix, edit, or live version.`
    : `No remix/live tags in the title - this is presented as a straight version.`,
  (song: NowPlayingInfoSong) => /\b(live|acoustic|remix|edit|version)\b/i.test(song.title)
    ? `Version keyword found in title - this cut likely has a distinct arrangement.`
    : `No version keyword found - likely the standard studio-style listing.`,
  (song: NowPlayingInfoSong) => containsFeatToken(song.title)
    ? 'Featured artist tag detected (feat./ft.) - this is a collaboration track.'
    : 'No featured artist tag in the title - this reads like a solo billing.',
  (song: NowPlayingInfoSong) => song.is_explicit
    ? 'Library flag: this track is marked explicit.'
    : 'Library flag: this track is marked clean.',
  (song: NowPlayingInfoSong) => {
    const initials = buildInitials(song.title)
    return initials.length > 1
      ? `Shortcode for hosts: "${song.title}" can be referenced as ${initials}.`
      : `Short title detected - easy to call out quickly in a live room.`
  },
  (song: NowPlayingInfoSong) => {
    const compactLength = countCharactersWithoutSpaces(song.title)
    return compactLength >= 24
      ? `Long-form title (${compactLength} letters without spaces) - built for dramatic mirror presence.`
      : `Compact title (${compactLength} letters without spaces) - quick to read from a distance.`
  },
]

function ensureRotatingFacts(song: NowPlayingInfoSong, facts: string[], minimumCount = 2) {
  const normalizedFacts = normalizeFunFacts(facts)

  if (normalizedFacts.length >= minimumCount) {
    return normalizedFacts.slice(0, 10)
  }

  const localFacts = normalizeFunFacts(SONG_INFO_BUILDERS.map((songInfoBuilder) => songInfoBuilder(song)))
  return normalizeFunFacts([...normalizedFacts, ...localFacts]).slice(0, 10)
}

function resolveMirrorVenueMode(value: string | null | undefined): MirrorVenueMode | null {
  if (!value) {
    return null
  }

  const normalizedValue = value.trim().toLowerCase()

  if (normalizedValue === 'club' || normalizedValue === 'tight') {
    return 'club'
  }

  if (normalizedValue === 'festival' || normalizedValue === 'big-stage' || normalizedValue === 'arena') {
    return 'festival'
  }

  if (normalizedValue === 'lounge' || normalizedValue === 'balanced') {
    return 'lounge'
  }

  return null
}

function normalizeMirrorText(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback
  }

  const trimmedValue = value.trim()
  return trimmedValue || fallback
}

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

type FullscreenElement = HTMLElement & {
  msRequestFullscreen?: () => Promise<void> | void
  webkitRequestFullscreen?: () => Promise<void> | void
  webkitRequestFullScreen?: () => Promise<void> | void
}

function getActiveFullscreenElement() {
  const fullscreenDocument = document as FullscreenDocument
  return document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null
}

async function requestFullscreenSafe(targetElement: HTMLElement) {
  const fullscreenTargets = [
    targetElement,
    document.documentElement,
    document.body,
  ].filter((candidate): candidate is HTMLElement => Boolean(candidate))

  let lastError: unknown = null

  for (const candidate of fullscreenTargets) {
    const fullscreenTarget = candidate as FullscreenElement

    try {
      if (typeof fullscreenTarget.requestFullscreen === 'function') {
        await fullscreenTarget.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions)
        return
      }

      if (typeof fullscreenTarget.webkitRequestFullscreen === 'function') {
        await fullscreenTarget.webkitRequestFullscreen()
        return
      }

      if (typeof fullscreenTarget.webkitRequestFullScreen === 'function') {
        await fullscreenTarget.webkitRequestFullScreen()
        return
      }

      if (typeof fullscreenTarget.msRequestFullscreen === 'function') {
        await fullscreenTarget.msRequestFullscreen()
        return
      }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Fullscreen API is unavailable in this browser.')
}

async function exitFullscreenSafe() {
  const fullscreenDocument = document as FullscreenDocument

  if (typeof document.exitFullscreen === 'function') {
    await document.exitFullscreen()
    return
  }

  if (typeof fullscreenDocument.webkitExitFullscreen === 'function') {
    await fullscreenDocument.webkitExitFullscreen()
    return
  }

  throw new Error('Exiting fullscreen is unavailable in this browser.')
}

type SpotlightQueueItem = {
  id: string
  eventId: string
  imageDataUrl: string
  authorName: string
}

function pickSpotlightCaption(authorName: string) {
  const captionBuilder = SPOTLIGHT_CAPTION_BUILDERS[Math.floor(Math.random() * SPOTLIGHT_CAPTION_BUILDERS.length)]
  return captionBuilder(authorName)
}

function buildChosenByLine(name: string | null | undefined, phraseIndex: number) {
  const normalizedName = name?.trim()

  if (!normalizedName) {
    return null
  }

  const chosenByBuilder = CHOSEN_BY_BUILDERS[phraseIndex]
  return chosenByBuilder(normalizedName)
}

function getMirrorCountdownTarget(gigDate: string | null | undefined, gigStartTime: string | null | undefined) {
  const normalizedDate = gigDate?.trim()

  if (!normalizedDate) {
    return null
  }

  const rawTime = gigStartTime?.trim() ?? ''
  // Postgres may return 'HH:MM:SS'; strip seconds so we don't double-append ':00'
  const baseTime = rawTime.length > 5 && rawTime[2] === ':' && rawTime[5] === ':' ? rawTime.slice(0, 5) : rawTime
  const normalizedTime = baseTime ? `${baseTime}:00` : '19:00:00'
  const scheduledStart = new Date(`${normalizedDate}T${normalizedTime}`)

  if (Number.isNaN(scheduledStart.getTime())) {
    return null
  }

  return scheduledStart
}

function formatMirrorCountdownLabel(remainingMs: number) {
  const safeRemainingMs = Math.max(0, remainingMs)
  const totalSeconds = Math.floor(safeRemainingMs / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const segments = [
    days > 0 ? `${days.toString().padStart(2, '0')}d` : null,
    `${hours.toString().padStart(2, '0')}h`,
    `${minutes.toString().padStart(2, '0')}m`,
    `${seconds.toString().padStart(2, '0')}s`,
  ].filter((segment): segment is string => Boolean(segment))

  return segments.join(' ')
}

function formatMirrorCountdownStartTime(date: Date, locale: AudienceLocale) {
  const resolvedLocale = locale === 'da' ? 'da-DK' : locale === 'is' ? 'is-IS' : undefined

  return new Intl.DateTimeFormat(resolvedLocale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function playShutterSound() {
  try {
    const audioContext = new window.AudioContext()

    if (audioContext.state === 'suspended') {
      void audioContext.close()
      return false
    }

    const gainNode = audioContext.createGain()
    const oscillator = audioContext.createOscillator()

    oscillator.type = 'square'
    oscillator.frequency.setValueAtTime(1560, audioContext.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(720, audioContext.currentTime + 0.06)

    gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.065, audioContext.currentTime + 0.012)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.09)

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.1)

    window.setTimeout(() => {
      void audioContext.close()
    }, 160)

    return true
  } catch {
    // Some browsers block autoplay audio; visual flash still runs.
    return false
  }
}

function MirrorPageContent() {
  const { event, songs, loading, toggleRoomOpen } = useQueueStore()
  const { user, isHost } = useAuthStore()
  const [spotlight, setSpotlight] = useState<FeedImageSpotlight | null>(null)
  const [funFacts, setFunFacts] = useState<string[]>([])
  const [currentFactIndex, setCurrentFactIndex] = useState(0)
  const lastSpacebarActionAtRef = useRef(0)
  const [flashActive, setFlashActive] = useState(false)
  const [queuedSpotlightCount, setQueuedSpotlightCount] = useState(0)
  const [playbackState, setPlaybackState] = useState<SharedPlaybackState | null>(null)
  const [mirrorWarning, setMirrorWarning] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(
    () => new URLSearchParams(window.location.search).get(MIRROR_AUTO_FULLSCREEN_QUERY_PARAM) === '1',
  )
  const [highContrastMode, setHighContrastMode] = useState(false)
  const [castClarityMode, setCastClarityMode] = useState(false)
  const [densityMode, setDensityMode] = useState<MirrorDensityMode>('medium')
  const [venueMode, setVenueMode] = useState<MirrorVenueMode>('lounge')
  const [showSafeMargins, setShowSafeMargins] = useState(false)
  const [bannerText, setBannerText] = useState<string>(() => readTextFromLocalStorage(MIRROR_BANNER_STORAGE_KEY) ?? '')
  const [bannerEnabledOverride, setBannerEnabledOverride] = useState<boolean | null>(null)
  const [, setStorageError] = useState<string | null>(null)
  const [hideControlsForAudience, setHideControlsForAudience] = useState(false)
  const [globalMirrorLayoutSaveBusy, setGlobalMirrorLayoutSaveBusy] = useState(false)
  const [layoutEditMode, setLayoutEditMode] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    const searchParams = new URLSearchParams(window.location.search)
    const queryEnabled = searchParams.get(MIRROR_LAYOUT_EDIT_QUERY_PARAM) === '1'
    const persistedEnabled = readTextFromLocalStorage(MIRROR_LAYOUT_EDIT_STORAGE_KEY) === '1'
    return queryEnabled || persistedEnabled
  })
  const [mirrorLayoutState, setMirrorLayoutState] = useState<MirrorLayoutState>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_MIRROR_LAYOUT_STATE
    }

    const persistedStateText = readTextFromLocalStorage(MIRROR_LAYOUT_STATE_STORAGE_KEY)

    if (!persistedStateText) {
      return DEFAULT_MIRROR_LAYOUT_STATE
    }

    try {
      return mergeMirrorLayoutState(JSON.parse(persistedStateText) as Partial<MirrorLayoutState>)
    } catch {
      return DEFAULT_MIRROR_LAYOUT_STATE
    }
  })
  const [showShutterFallbackPulse, setShowShutterFallbackPulse] = useState(false)
  const [failedCoverUrls, setFailedCoverUrls] = useState<Record<string, true>>({})
  const [audienceLocale, setAudienceLocale] = useState<AudienceLocale>(() => readCommittedAudienceLocale())
  const [isMirrorNetworkAllowed, setIsMirrorNetworkAllowed] = useState(false)
  const [hasCheckedMirrorNetworkAccess, setHasCheckedMirrorNetworkAccess] = useState(false)
  const [countdownNow, setCountdownNow] = useState(() => Date.now())
  const [betweenSongQuoteIndex, setBetweenSongQuoteIndex] = useState(0)
  const [forceQuoteMode, setForceQuoteMode] = useState(false)
  const quoteIndexRef = useRef(0)
  const autoLiveAttemptedEventIdRef = useRef<string | null>(null)
  const autoLiveInFlightRef = useRef(false)
  const spotlightTimerRef = useRef<number | null>(null)
  const shutterFallbackPulseTimerRef = useRef<number | null>(null)
  const mirrorWarningClearTimerRef = useRef<number | null>(null)
  const mirrorWarningLastShownAtRef = useRef<number>(0)
  const spotlightQueueRef = useRef<SpotlightQueueItem[]>([])
  const spotlightBusyRef = useRef(false)
  const seenSpotlightPostIdsRef = useRef<Set<string>>(new Set())
  const mirrorShellRef = useRef<HTMLDivElement | null>(null)
  const autoFullscreenAttemptedRef = useRef(false)
  const mirrorLayoutStageRef = useRef<HTMLDivElement | null>(null)
  const layoutInteractionRef = useRef<{
    panelId: MirrorLayoutPanelId
    mode: 'drag' | 'resize'
    pointerId: number
    startX: number
    startY: number
    startRect: MirrorLayoutRect
    startState: MirrorLayoutState
    stageWidth: number
    stageHeight: number
  } | null>(null)
  const chosenByPhraseIndexBySongIdRef = useRef<Record<string, number>>({})
  const lastChosenByPhraseIndexRef = useRef<number | null>(null)
  const funFactsCacheRef = useRef<FunFactsCache>({})
  const funFactsInFlightRef = useRef<Partial<Record<string, Promise<string[]>>>>({})
  const mirrorLayoutStateRef = useRef(mirrorLayoutState)

  const setMirrorWarningMessage = (message: string) => {
    if (demoMode) return  // suppress all warnings in demo — reconnects are expected and not real
    if (mirrorWarningClearTimerRef.current !== null) {
      window.clearTimeout(mirrorWarningClearTimerRef.current)
      mirrorWarningClearTimerRef.current = null
    }

    mirrorWarningLastShownAtRef.current = Date.now()
    setMirrorWarning((currentWarning) => (currentWarning === message ? currentWarning : message))
  }

  const clearMirrorWarningSmoothly = () => {
    const elapsedMs = Date.now() - mirrorWarningLastShownAtRef.current
    const delayMs = Math.max(0, MIRROR_WARNING_MIN_VISIBLE_MS - elapsedMs)

    if (mirrorWarningClearTimerRef.current !== null) {
      window.clearTimeout(mirrorWarningClearTimerRef.current)
      mirrorWarningClearTimerRef.current = null
    }

    mirrorWarningClearTimerRef.current = window.setTimeout(() => {
      setMirrorWarning(null)
      mirrorWarningClearTimerRef.current = null
    }, delayMs)
  }

  useEffect(() => {
    mirrorLayoutStateRef.current = mirrorLayoutState
  }, [mirrorLayoutState])

  useEffect(() => {
    const result = saveTextToLocalStorage(MIRROR_LAYOUT_STATE_STORAGE_KEY, JSON.stringify(mirrorLayoutState))

    if (result.success) {
      setStorageError(null)
      return
    }

    setStorageError(result.error ?? 'Could not save mirror layout locally')
  }, [mirrorLayoutState])

  // Keep the screen awake while the mirror is open
  useEffect(() => {
    if (!('wakeLock' in navigator)) {
      return
    }

    let lock: WakeLockSentinel | null = null

    const acquire = async () => {
      if (document.visibilityState !== 'visible') {
        return
      }

      try {
        lock = await (navigator as Navigator & { wakeLock: { request(type: string): Promise<WakeLockSentinel> } }).wakeLock.request('screen')
      } catch {
        // Wake lock request can be silently denied (e.g. low battery). Safe to ignore.
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void acquire()
      }
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      lock?.release().catch(() => {})
    }
  }, [])

  useEffect(() => {
    return () => {
      if (mirrorWarningClearTimerRef.current !== null) {
        window.clearTimeout(mirrorWarningClearTimerRef.current)
        mirrorWarningClearTimerRef.current = null
      }
    }
  }, [])

  const safeSongs = useMemo(() => songs.filter((song) => (
    song
    && typeof song.id === 'string'
    && typeof song.title === 'string'
    && typeof song.artist === 'string'
  )), [songs])
  const nowPlaying = safeSongs[0]
  const isLive = event?.roomOpen ?? false
  const isKaraokeEvent = event?.eventType === 'karaoke'
  const isBuildSelfEvent = event?.eventType === 'build-self'
  const isHaraldLiveEvent = event?.eventType === 'halli-live'
  const audienceVotingEnabled = event?.audienceVotingEnabled ?? true
  const mirrorKarafunUrl = event?.karafunUrl?.trim() || null
  const mirrorKarafunLink = mirrorKarafunUrl
    ? (mirrorKarafunUrl.startsWith('http') ? mirrorKarafunUrl : `https://${mirrorKarafunUrl}`)
    : null
  const isEmbeddedPreview =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1'
  const eventId = event?.id ?? null
  const mirrorLayoutOwnerId = event?.hostId ?? (isHost ? user?.id ?? null : null)
  const audienceUrl = useMemo(() => {
    try {
      const audienceUrlResolver = getAudienceUrl as (...args: unknown[]) => string
      return audienceUrlResolver(eventId, { compact: true, includeVersion: false })
    } catch (error) {
      logCrashTelemetry({
        route: '/mirror',
        error,
        extra: {
          source: 'mirror-audience-url-resolver',
        },
      })
      console.warn('MirrorPage: audience URL resolution failed', error)
      return '/audience'
    }
  }, [eventId])
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=1400x1400&ecc=M&margin=8&data=${encodeURIComponent(audienceUrl)}`
  const playbackSong = playbackState?.currentSongId
    ? safeSongs.find((song) => song.id === playbackState.currentSongId) ?? null
    : null
  const activeSong = playbackSong ?? nowPlaying
  const useLiveSongCardsInDemo = demoMode
  // In demo mode, treat the first song as already playing so the now-playing
  // card shows album art + title instead of the "between songs" quote.
  const liveSessionIsNowPlaying = Boolean(isLive && nowPlaying)
  const isNowPlayingStarted = demoMode
    ? Boolean(nowPlaying)
    : liveSessionIsNowPlaying || Boolean(playbackState?.isStarted && playbackState.currentSongId)
  const isQuoteModeActive = forceQuoteMode || !isNowPlayingStarted || !activeSong
  const shouldCompactQueue = safeSongs.length > 6
  const upNext = isNowPlayingStarted
    ? safeSongs.filter((song) => song.id !== (playbackSong?.id ?? nowPlaying?.id))
    : safeSongs
  const normalizedBetweenSongQuoteIndex = Number.isFinite(betweenSongQuoteIndex)
    ? Math.abs(Math.trunc(betweenSongQuoteIndex)) % BETWEEN_SONG_QUOTES.length
    : 0
  const currentBetweenSongQuote = BETWEEN_SONG_QUOTES[normalizedBetweenSongQuoteIndex]
    ?? 'Remain calm. The next song is loading.'
  const currentSongFact = funFacts.length > 0
    ? funFacts[currentFactIndex % funFacts.length]
    : 'No fun facts available for this song yet.'

  const getChosenByLine = (songId: string, name: string | null | undefined) => {
    const normalizedName = name?.trim()

    if (!normalizedName) {
      return null
    }

    const phraseBuildersCount = CHOSEN_BY_BUILDERS.length

    if (phraseBuildersCount <= 0) {
      return `Chosen by ${normalizedName}`
    }

    const cachedPhraseIndex = chosenByPhraseIndexBySongIdRef.current[songId]
    let phraseIndex = typeof cachedPhraseIndex === 'number' ? cachedPhraseIndex : -1

    if (phraseIndex < 0 || phraseIndex >= phraseBuildersCount) {
      if (phraseBuildersCount === 1) {
        phraseIndex = 0
      } else {
        const lastPhraseIndex = lastChosenByPhraseIndexRef.current
        phraseIndex = Math.floor(Math.random() * phraseBuildersCount)

        if (phraseIndex === lastPhraseIndex) {
          phraseIndex = (phraseIndex + 1 + Math.floor(Math.random() * (phraseBuildersCount - 1))) % phraseBuildersCount
        }
      }

      chosenByPhraseIndexBySongIdRef.current[songId] = phraseIndex
      lastChosenByPhraseIndexRef.current = phraseIndex
    }

    return buildChosenByLine(normalizedName, phraseIndex) ?? `Chosen by ${normalizedName}`
  }

  const getChosenByAccentClass = (songId: string) => {
    const phraseIndex = chosenByPhraseIndexBySongIdRef.current[songId]

    if (typeof phraseIndex !== 'number' || phraseIndex < 0) {
      return CHOSEN_BY_ACCENT_CLASSES[0]
    }

    return CHOSEN_BY_ACCENT_CLASSES[phraseIndex % CHOSEN_BY_ACCENT_CLASSES.length]
  }

  const activeSongChosenByLine = activeSong?.createdByName
    ? (activeSong.audience_sings
      ? `Picked by ${activeSong.createdByName}`
      : getChosenByLine(activeSong.id, activeSong.createdByName) ?? `Chosen by ${activeSong.createdByName}`)
    : null
  const activeSongChosenByAccentClass = activeSong?.id
    ? getChosenByAccentClass(activeSong.id)
    : CHOSEN_BY_ACCENT_CLASSES[0]

  useEffect(() => {
    const activeSongIds = new Set(safeSongs.map((song) => song.id))
    const phraseCache = chosenByPhraseIndexBySongIdRef.current

    Object.keys(phraseCache).forEach((songId) => {
      if (!activeSongIds.has(songId)) {
        delete phraseCache[songId]
      }
    })
  }, [safeSongs])

  const showSpotlight = (event?.mirrorPhotoSpotlightEnabled ?? true) && !isEmbeddedPreview
  const shouldShowEditorControls = false
  const shouldShowAdminElements = false
  const isMirrorBannerEnabled = bannerEnabledOverride ?? (event?.mirrorBannerEnabled ?? true)
  const liveBadgeLabel = demoMode ? '● Demo' : event?.roomOpen ? '● Live' : '● Paused'

  useEffect(() => {
    let isCurrent = true

    const runAccessCheck = () => {
      if (!isCurrent) {
        return
      }

      // Network gate removed — mirror is accessible from any connection.
      setIsMirrorNetworkAllowed(true)
      setHasCheckedMirrorNetworkAccess(true)
    }

    runAccessCheck()

    const onOnlineOrFocus = () => {
      void runAccessCheck()
    }

    window.addEventListener('online', onOnlineOrFocus)
    window.addEventListener('focus', onOnlineOrFocus)

    return () => {
      isCurrent = false
      window.removeEventListener('online', onOnlineOrFocus)
      window.removeEventListener('focus', onOnlineOrFocus)
    }
  }, [])

  const countdownCopy = audienceLocale === 'da'
    ? {
        live: '● Live',
        paused: '● Pause',
        startingIn: 'Starter om',
        scheduledStart: 'Planlagt start',
        scheduledPrefix: 'Planlagt start:',
      }
    : audienceLocale === 'is'
    ? {
        live: '● Live',
        paused: '● I pusu',
        startingIn: 'Hefst eftir',
        scheduledStart: 'Aetlud byrjun',
        scheduledPrefix: 'Aetlud byrjun:',
      }
    : {
        live: '● Live',
        paused: '● Paused',
        startingIn: 'Starting In',
        scheduledStart: 'Scheduled Start',
        scheduledPrefix: 'Scheduled start:',
      }
  const countdownTarget = useMemo(
    () => getMirrorCountdownTarget(event?.gigDate ?? null, event?.gigStartTime ?? null),
    [event?.gigDate, event?.gigStartTime],
  )
  const countdownRemainingMs = countdownTarget ? countdownTarget.getTime() - countdownNow : null
  const showCountdown = !isLive
    && (event?.mirrorCountdownEnabled ?? true)
    && Boolean(countdownTarget)
    && Boolean(countdownRemainingMs && countdownRemainingMs > 0)
  const countdownLabel = showCountdown && countdownRemainingMs !== null
    ? formatMirrorCountdownLabel(countdownRemainingMs)
    : null
  const countdownStartLabel = countdownTarget ? formatMirrorCountdownStartTime(countdownTarget, audienceLocale) : null

  const onCoverLoadError = (coverUrl: string | null | undefined) => {
    if (!coverUrl) {
      return
    }

    setFailedCoverUrls((currentUrls) => {
      if (currentUrls[coverUrl]) {
        return currentUrls
      }

      return { ...currentUrls, [coverUrl]: true }
    })
  }

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    if (!event?.id) {
      autoLiveAttemptedEventIdRef.current = null
      return
    }

    if (!event.autoLiveEnabled || event.roomOpen) {
      autoLiveAttemptedEventIdRef.current = null
    }
  }, [event?.id, event?.autoLiveEnabled, event?.roomOpen])

  useEffect(() => {
    const runMirrorAutoLive = async () => {
      if (!isHost || !event?.id || !event.autoLiveEnabled || event.roomOpen || autoLiveInFlightRef.current) {
        return
      }

      if (!countdownTarget || countdownRemainingMs === null || countdownRemainingMs > 0) {
        return
      }

      if (autoLiveAttemptedEventIdRef.current === event.id) {
        return
      }

      autoLiveAttemptedEventIdRef.current = event.id
      autoLiveInFlightRef.current = true

      try {
        await toggleRoomOpen()

        if (event.introAudioUrl) {
          try {
            await playIntroAudioWithSpotifyBridge(event.introAudioUrl)
          } catch {
            setMirrorWarningMessage('Auto Live intro audio was blocked by browser autoplay settings.')
          }
        }

        if (nowPlaying?.id) {
          await writeSharedPlaybackState(event.id, {
            currentSongId: nowPlaying.id,
            currentSongCoverUrl: nowPlaying.cover_url ?? null,
            isStarted: true,
            quoteIndex: quoteIndexRef.current,
          })
        }

        setMirrorWarningMessage('Auto Live started from scheduled countdown.')
      } catch {
        setMirrorWarningMessage('Countdown ended, but Auto Live could not open the room. Use Gig Control to go live manually.')
      } finally {
        autoLiveInFlightRef.current = false
      }
    }

    void runMirrorAutoLive()
  }, [
    countdownRemainingMs,
    countdownTarget,
    event?.id,
    event?.autoLiveEnabled,
    event?.introAudioUrl,
    event?.roomOpen,
    isHost,
    nowPlaying?.cover_url,
    nowPlaying?.id,
    toggleRoomOpen,
    layoutEditMode,
  ])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(getActiveFullscreenElement()))
    }

    syncFullscreenState()
    document.addEventListener('fullscreenchange', syncFullscreenState)
    document.addEventListener('webkitfullscreenchange', syncFullscreenState)
    window.addEventListener('fullscreenchange', syncFullscreenState)
    window.addEventListener('webkitfullscreenchange', syncFullscreenState)

    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState)
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState)
      window.removeEventListener('fullscreenchange', syncFullscreenState)
      window.removeEventListener('webkitfullscreenchange', syncFullscreenState)
    }
  }, [])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    if (autoFullscreenAttemptedRef.current) {
      return
    }

    const searchParams = new URLSearchParams(window.location.search)

    if (searchParams.get(MIRROR_AUTO_FULLSCREEN_QUERY_PARAM) !== '1') {
      return
    }

    autoFullscreenAttemptedRef.current = true

    void requestFullscreenSafe(mirrorShellRef.current ?? document.documentElement)
      .then(() => { setShowFullscreenPrompt(false) })
      .catch(() => {
        // Browser blocked auto-fullscreen — prompt overlay stays visible so user can click.
      })
  }, [])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    const syncPresentationState = () => {
      const fullscreenActive = Boolean(getActiveFullscreenElement())
      const fullscreenDisplayMode = window.matchMedia('(display-mode: fullscreen)').matches
      const projectedMode = fullscreenActive || fullscreenDisplayMode

      setHideControlsForAudience(projectedMode)
    }

    syncPresentationState()
    document.addEventListener('fullscreenchange', syncPresentationState)
    document.addEventListener('webkitfullscreenchange', syncPresentationState)
    window.addEventListener('fullscreenchange', syncPresentationState)
    window.addEventListener('webkitfullscreenchange', syncPresentationState)
    window.addEventListener('resize', syncPresentationState)

    return () => {
      document.removeEventListener('fullscreenchange', syncPresentationState)
      document.removeEventListener('webkitfullscreenchange', syncPresentationState)
      window.removeEventListener('fullscreenchange', syncPresentationState)
      window.removeEventListener('webkitfullscreenchange', syncPresentationState)
      window.removeEventListener('resize', syncPresentationState)
    }
  }, [layoutEditMode])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    const syncAudienceLocale = () => {
      setAudienceLocale(readCommittedAudienceLocale())
    }

    syncAudienceLocale()
    window.addEventListener('storage', syncAudienceLocale)

    return () => {
      window.removeEventListener('storage', syncAudienceLocale)
    }
  }, [layoutEditMode])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    if (typeof window === 'undefined') {
      return
    }

    const persistedCacheText = readTextFromLocalStorage(MIRROR_FUN_FACTS_CACHE_STORAGE_KEY)

    if (!persistedCacheText) {
      return
    }

    try {
      const persistedCache = JSON.parse(persistedCacheText) as FunFactsCache

      if (persistedCache && typeof persistedCache === 'object') {
        funFactsCacheRef.current = persistedCache
      }
    } catch {
      // Corrupt cache should not block playback; overwrite on next write.
    }
  }, [layoutEditMode])

  const persistFunFactsCache = useCallback(() => {
    const serializedCache = JSON.stringify(funFactsCacheRef.current)
    const result = saveTextToLocalStorage(MIRROR_FUN_FACTS_CACHE_STORAGE_KEY, serializedCache)

    if (!result.success) {
      console.warn('MirrorPage: failed to persist fun facts cache', result.error)
    }
  }, [])

  const ensureSongFunFacts = useCallback(async (song: QueueSong, signal: AbortSignal) => {
    const songWithMirrorFacts = song as SongWithMirrorFacts
    const songInfoContext: NowPlayingInfoSong = {
      title: song.title,
      artist: song.artist,
      is_explicit: song.is_explicit,
    }
    const embeddedFacts = normalizeFunFacts(songWithMirrorFacts.mirrorFunFacts ?? [])

    if (embeddedFacts.length > 0) {
      const rotatingFacts = ensureRotatingFacts(songInfoContext, embeddedFacts)
      songWithMirrorFacts.mirrorFunFacts = rotatingFacts
      return rotatingFacts
    }

    const cacheKey = buildFunFactsCacheKey(song.title, song.artist)
    const existingFacts = funFactsCacheRef.current[cacheKey]

    if (existingFacts?.length) {
      const rotatingFacts = ensureRotatingFacts(songInfoContext, existingFacts)
      funFactsCacheRef.current[cacheKey] = rotatingFacts
      songWithMirrorFacts.mirrorFunFacts = rotatingFacts
      return rotatingFacts
    }

    if (funFactsInFlightRef.current[cacheKey]) {
      return funFactsInFlightRef.current[cacheKey]
    }

    const fetchPromise = (async () => {
      const wikipediaFacts = await fetchWikipediaSummarySentences(song.title, song.artist, signal)
      const itunesFacts = await fetchItunesSongFacts(song.title, song.artist, signal)
      const fallbackFacts = wikipediaFacts.length + itunesFacts.length >= 3
        ? []
        : await fetchMusicBrainzFallbackFacts(song.title, song.artist, signal)

      const localFacts = SONG_INFO_BUILDERS.map((songInfoBuilder) => songInfoBuilder(songInfoContext))

      const mergedFacts = normalizeFunFacts([
        ...wikipediaFacts,
        ...itunesFacts,
        ...fallbackFacts,
        ...localFacts,
      ]).slice(0, 10)
      const guaranteedFacts = mergedFacts.length >= 3
        ? mergedFacts
        : normalizeFunFacts([...mergedFacts, ...localFacts]).slice(0, 10)
      const rotatingFacts = ensureRotatingFacts(songInfoContext, guaranteedFacts)

      funFactsCacheRef.current[cacheKey] = rotatingFacts
      songWithMirrorFacts.mirrorFunFacts = rotatingFacts
      persistFunFactsCache()

      return rotatingFacts
    })()

    funFactsInFlightRef.current[cacheKey] = fetchPromise

    try {
      return await fetchPromise
    } finally {
      delete funFactsInFlightRef.current[cacheKey]
    }
  }, [persistFunFactsCache])

  useEffect(() => {
    const abortController = new AbortController()

    const prefetchFacts = async () => {
      for (const song of safeSongs) {
        if (abortController.signal.aborted) {
          return
        }

        try {
          await ensureSongFunFacts(song, abortController.signal)
        } catch {
          // Fact prefetch is best effort only.
        }
      }
    }

    void prefetchFacts()

    return () => {
      abortController.abort()
    }
  }, [ensureSongFunFacts, safeSongs])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    if (!isNowPlayingStarted || !activeSong) {
      setFunFacts([])
      setCurrentFactIndex(0)
      return
    }

    if (demoMode) {
      setFunFacts(DEMO_NOW_PLAYING_FACTS)
      setCurrentFactIndex(0)
      return
    }

    const abortController = new AbortController()
    const activeSongWithMirrorFacts = activeSong as SongWithMirrorFacts
    const songInfoContext: NowPlayingInfoSong = {
      title: activeSong.title,
      artist: activeSong.artist,
      is_explicit: activeSong.is_explicit,
    }
    const embeddedFacts = normalizeFunFacts(activeSongWithMirrorFacts.mirrorFunFacts ?? [])

    if (embeddedFacts.length > 0) {
      const rotatingFacts = ensureRotatingFacts(songInfoContext, embeddedFacts)
      activeSongWithMirrorFacts.mirrorFunFacts = rotatingFacts
      setFunFacts(rotatingFacts)
      setCurrentFactIndex(0)
      return
    }

    const cacheKey = buildFunFactsCacheKey(activeSong.title, activeSong.artist)
    const cachedFacts = funFactsCacheRef.current[cacheKey]

    if (cachedFacts?.length) {
      const rotatingFacts = ensureRotatingFacts(songInfoContext, cachedFacts)
      funFactsCacheRef.current[cacheKey] = rotatingFacts
      activeSongWithMirrorFacts.mirrorFunFacts = rotatingFacts
      setFunFacts(rotatingFacts)
      setCurrentFactIndex(0)
      return
    }

    const loadSongFunFacts = async () => {
      try {
        const fetchedFacts = await ensureSongFunFacts(activeSong, abortController.signal)

        if (abortController.signal.aborted) {
          return
        }

        setFunFacts(fetchedFacts)
        setCurrentFactIndex(0)
      } catch (error) {
        if (abortController.signal.aborted) {
          return
        }

        console.warn('MirrorPage: failed to load song fun facts', error)
        setFunFacts([])
        setCurrentFactIndex(0)
      }
    }

    void loadSongFunFacts()

    return () => {
      abortController.abort()
    }
  }, [activeSong, ensureSongFunFacts, isNowPlayingStarted, layoutEditMode])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    if (funFacts.length <= 1) {
      setCurrentFactIndex(0)
      return
    }

    const intervalId = window.setInterval(() => {
      setCurrentFactIndex((currentIndex) => (currentIndex + 1) % funFacts.length)
    }, SONG_INFO_ROTATE_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [funFacts, layoutEditMode])

  const setQuoteIndex = (nextQuoteIndex: number) => {
    quoteIndexRef.current = nextQuoteIndex
    setBetweenSongQuoteIndex(nextQuoteIndex)
  }

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    const normalizedQuoteIndex = Number.isFinite(playbackState?.quoteIndex)
      ? (playbackState?.quoteIndex as number) % BETWEEN_SONG_QUOTES.length
      : 0

    if (normalizedQuoteIndex !== quoteIndexRef.current) {
      setQuoteIndex(normalizedQuoteIndex)
    }
  }, [playbackState?.quoteIndex, layoutEditMode])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    if (!isQuoteModeActive) {
      return
    }

    const intervalId = window.setInterval(() => {
      const nextQuoteIndex = (quoteIndexRef.current + 1) % BETWEEN_SONG_QUOTES.length
      setQuoteIndex(nextQuoteIndex)
    }, QUOTE_ROTATE_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isQuoteModeActive, layoutEditMode])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (!keyEvent.isTrusted || keyEvent.defaultPrevented) {
        return
      }

      const target = keyEvent.target as HTMLElement | null
      const activeElement = document.activeElement as HTMLElement | null
      const interactiveTarget = target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="button"], [role="textbox"], [data-spacebar-ignore="true"]')
      const isTypingTarget = Boolean(interactiveTarget || activeElement?.isContentEditable)

      if (isTypingTarget) {
        return
      }

      if (keyEvent.key === 'Escape') {
        if (!getActiveFullscreenElement()) {
          return
        }

        keyEvent.preventDefault()
        void exitFullscreenSafe().catch((error) => {
          console.warn('MirrorPage: keyboard fullscreen exit failed', error)
          setMirrorWarningMessage('Could not exit fullscreen from keyboard shortcut.')
        })
        return
      }

      if (keyEvent.key.toLowerCase() === 'f' && !keyEvent.altKey && !keyEvent.ctrlKey && !keyEvent.metaKey) {
        keyEvent.preventDefault()
        void (async () => {
          try {
            if (!getActiveFullscreenElement()) {
              await requestFullscreenSafe(mirrorShellRef.current ?? document.documentElement)
            } else {
              await exitFullscreenSafe()
            }
          } catch (error) {
            console.warn('MirrorPage: keyboard fullscreen toggle failed', error)
            setMirrorWarningMessage('Could not toggle fullscreen from keyboard shortcut.')
          }
        })()
        return
      }

      if (keyEvent.code !== 'Space') {
        return
      }

      if (keyEvent.altKey || keyEvent.ctrlKey || keyEvent.metaKey || keyEvent.shiftKey) {
        return
      }

      if (keyEvent.repeat) {
        keyEvent.preventDefault()
        return
      }

      const now = Date.now()
      if (now - lastSpacebarActionAtRef.current < 500) {
        keyEvent.preventDefault()
        return
      }

      keyEvent.preventDefault()
      lastSpacebarActionAtRef.current = now
      setForceQuoteMode((currentMode) => !currentMode)
    }

    window.addEventListener('keydown', onKeyDown as unknown as EventListener)
    return () => window.removeEventListener('keydown', onKeyDown as unknown as EventListener)
  }, [layoutEditMode])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    if (isLive || !countdownTarget) {
      return
    }

    setCountdownNow(Date.now())

    const timerId = window.setInterval(() => {
      setCountdownNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [countdownTarget, isLive, layoutEditMode])

  useEffect(() => {
    const onRuntimeError = (event: ErrorEvent) => {
      logCrashTelemetry({
        route: '/mirror',
        error: event.error ?? event.message,
        extra: {
          source: 'mirror-runtime-error',
        },
      })
      setMirrorWarningMessage('Mirror recovered from a runtime issue. Showing last known state.')
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      logCrashTelemetry({
        route: '/mirror',
        error: event.reason,
        extra: {
          source: 'mirror-unhandled-rejection',
        },
      })
      setMirrorWarningMessage('Mirror sync is retrying in the background. Display remains live.')
    }

    window.addEventListener('error', onRuntimeError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      window.removeEventListener('error', onRuntimeError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const searchParams = new URLSearchParams(window.location.search)
    const contrastParam = searchParams.get('contrast')?.trim().toLowerCase()
      ?? searchParams.get('hc')?.trim().toLowerCase()
    const densityParam = searchParams.get('density')?.trim().toLowerCase()
      ?? searchParams.get('dm')?.trim().toLowerCase()
    const venueParam = searchParams.get('venue')?.trim().toLowerCase()
      ?? searchParams.get('vm')?.trim().toLowerCase()
    const safeMarginsParam = searchParams.get('safeMargins')?.trim().toLowerCase()
      ?? searchParams.get('safe')?.trim().toLowerCase()
    const castParam = searchParams.get('cast')?.trim().toLowerCase()
      ?? searchParams.get('quality')?.trim().toLowerCase()

    const hasContrastQuery = contrastParam === '1' || contrastParam === 'high' || contrastParam === 'true'
    const hasCastBlurQuery = castParam === '0' || castParam === 'false' || castParam === 'off' || castParam === 'blur'
    const persistedContrastPreference = readTextFromLocalStorage(MIRROR_HIGH_CONTRAST_STORAGE_KEY) === '1'
    const hasSafeMarginsQuery = safeMarginsParam === '1' || safeMarginsParam === 'on' || safeMarginsParam === 'true'
    const persistedSafeMarginsPreference = readTextFromLocalStorage(MIRROR_SAFE_MARGINS_STORAGE_KEY) === '1'
    const persistedVenueMode = resolveMirrorVenueMode(readTextFromLocalStorage(MIRROR_VENUE_MODE_STORAGE_KEY))
    const resolvedVenueMode = resolveMirrorVenueMode(venueParam) ?? persistedVenueMode ?? 'lounge'
    const resolvedDensityMode: MirrorDensityMode = densityParam === 'cinema' || densityParam === 'xl' || densityParam === 'large'
      ? 'cinema'
      : 'medium'

    setHighContrastMode(hasContrastQuery || persistedContrastPreference)
    const resolvedCastClarityMode = !hasCastBlurQuery

    // Keep mirror output crisp by default, including after hard refresh.
    setCastClarityMode(resolvedCastClarityMode)
    setDensityMode(resolvedDensityMode)
    setVenueMode(resolvedVenueMode)
    setShowSafeMargins(hasSafeMarginsQuery || persistedSafeMarginsPreference)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const result = saveTextToLocalStorage(MIRROR_HIGH_CONTRAST_STORAGE_KEY, highContrastMode ? '1' : '0')
    if (result.success) {
      setStorageError(null)
      return
    }

    setStorageError(result.error ?? 'Could not save contrast preference')
    console.warn('MirrorPage: failed to save high contrast mode', result.error)
  }, [highContrastMode])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const result = saveTextToLocalStorage(MIRROR_SAFE_MARGINS_STORAGE_KEY, showSafeMargins ? '1' : '0')
    if (result.success) {
      setStorageError(null)
      return
    }

    setStorageError(result.error ?? 'Could not save safe margins preference')
    console.warn('MirrorPage: failed to save safe margins', result.error)
  }, [showSafeMargins])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const result = saveTextToLocalStorage(MIRROR_VENUE_MODE_STORAGE_KEY, venueMode)
    if (result.success) {
      setStorageError(null)
      return
    }

    setStorageError(result.error ?? 'Could not save venue mode preference')
    console.warn('MirrorPage: failed to save venue mode', result.error)
  }, [venueMode])

  // Update OG meta tags for social media sharing
  useEffect(() => {
    if (!event) {
      resetOGTags()
      return
    }

    const gigUrl = typeof window !== 'undefined' ? window.location.href : undefined
    setGigOGTags(event.name, event.venue ?? null, event.name, undefined, gigUrl)
  }, [event, event?.id, event?.name, event?.venue])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    if (!eventId) {
      setPlaybackState(null)
      return
    }

    let isCurrent = true
    let subscription: ReturnType<typeof supabase.channel> | null = null
    let playbackBroadcastChannel: BroadcastChannel | null = null
    let playbackHealthTimerId: number | null = null
    let reconnectTimerId: number | null = null
    let reconnectAttempt = 0
    let playbackChannelState: 'idle' | 'subscribed' | 'reconnecting' = 'idle'

    const stopPlaybackHealthTimer = () => {
      if (playbackHealthTimerId) {
        window.clearInterval(playbackHealthTimerId)
        playbackHealthTimerId = null
      }
    }

    const startPlaybackHealthTimer = () => {
      stopPlaybackHealthTimer()

      playbackHealthTimerId = window.setInterval(() => {
        // Mirror is displayed on a TV/projector — always poll regardless of
        // document visibility so state stays current even when the browser
        // reports the page as "hidden" (e.g. some casting scenarios).
        void syncPlaybackState()
      }, 15000)
    }

    const clearReconnectTimer = () => {
      if (reconnectTimerId !== null) {
        window.clearTimeout(reconnectTimerId)
        reconnectTimerId = null
      }
    }

    const disconnectSubscription = () => {
      if (subscription) {
        void subscription.unsubscribe()
        subscription = null
      }

      playbackChannelState = 'idle'
    }

    const syncPlaybackState = async () => {
      if (!isCurrent) return

      try {
        const state = await readSharedPlaybackState(eventId)

        if (isCurrent) {
          if (state) {
            setPlaybackState(state)
            clearMirrorWarningSmoothly()
            return
          }

          setMirrorWarningMessage('Realtime playback sync is reconnecting. Using queue fallback.')
        }
      } catch {
        if (isCurrent) {
          setMirrorWarningMessage('Realtime playback sync is reconnecting. Using queue fallback.')
        }
      }
    }

    const reconnectSubscription = () => {
      if (!isCurrent) {
        return
      }

      clearReconnectTimer()
      disconnectSubscription()
      playbackChannelState = 'reconnecting'

      subscription = supabase
        .channel(`playback_state:${eventId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'playback_state',
            filter: `event_id=eq.${eventId}`,
          },
          (payload: {
            eventType?: 'INSERT' | 'UPDATE' | 'DELETE'
            new?: {
              current_song_id?: string | null
              current_song_cover_url?: string | null
              is_started?: boolean | null
              quote_index?: number | null
            } | null
          }) => {
            const nextRow = payload?.new

            if (payload?.eventType === 'DELETE') {
              void syncPlaybackState()
              return
            }

            if (nextRow) {
              setPlaybackState({
                currentSongId: nextRow.current_song_id ?? null,
                currentSongCoverUrl: nextRow.current_song_cover_url ?? null,
                isStarted: Boolean(nextRow.is_started),
                quoteIndex: Number.isFinite(nextRow.quote_index)
                  ? (nextRow.quote_index as number)
                  : 0,
              })
              clearMirrorWarningSmoothly()
              return
            }

            void syncPlaybackState()
          },
        )
        .subscribe((status) => {
          if (!isCurrent) {
            return
          }

          if (status === 'SUBSCRIBED') {
            playbackChannelState = 'subscribed'
            reconnectAttempt = 0
            clearMirrorWarningSmoothly()
            void syncPlaybackState()
            return
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            playbackChannelState = 'reconnecting'
            setMirrorWarningMessage('Mirror realtime channel reconnecting. Display remains active.')

            if (reconnectTimerId !== null) {
              return
            }

            // Mirror on a TV/projector must recover quickly, but avoid churn.
            const retryDelayMs = Math.min(1500 * (2 ** reconnectAttempt), 10000)
            reconnectAttempt += 1
            reconnectTimerId = window.setTimeout(() => {
              reconnectTimerId = null
              reconnectSubscription()
              void syncPlaybackState()
            }, retryDelayMs)
          }
        })
    }

    const recoverMirrorSync = () => {
      if (!isCurrent) {
        return
      }

      if (playbackChannelState === 'subscribed' && subscription) {
        void syncPlaybackState()
        return
      }

      if (reconnectTimerId !== null) {
        void syncPlaybackState()
        return
      }

      reconnectSubscription()
      void syncPlaybackState()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Mirror is a persistent display (TV/projector). Never disconnect on
        // visibility change — the WebSocket must stay alive regardless.
        return
      }

      recoverMirrorSync()
      startPlaybackHealthTimer()
    }

    const onWindowFocus = () => {
      recoverMirrorSync()
    }

    const onOnline = () => {
      recoverMirrorSync()
    }

    const onPageShow = () => {
      recoverMirrorSync()
    }

    const onPlaybackStateEvent = (nextEvent: Event) => {
      const detail = (nextEvent as CustomEvent<{ eventId: string; state: SharedPlaybackState }>).detail

      if (detail?.eventId === eventId) {
        setPlaybackState(detail.state)
        clearMirrorWarningSmoothly()
      }
    }

    const onStoragePlaybackState = (nextEvent: StorageEvent) => {
      if (nextEvent.key !== MIRROR_PLAYBACK_STORAGE_KEY || !nextEvent.newValue) {
        return
      }

      try {
        const detail = JSON.parse(nextEvent.newValue) as { eventId?: string; state?: SharedPlaybackState }
        if (detail.eventId === eventId && detail.state) {
          setPlaybackState(detail.state)
          clearMirrorWarningSmoothly()
        }
      } catch {
        // Ignore malformed storage payloads.
      }
    }

    void syncPlaybackState()
    reconnectSubscription()
    window.addEventListener(PLAYBACK_STATE_EVENT, onPlaybackStateEvent as EventListener)
    window.addEventListener('storage', onStoragePlaybackState)
    window.addEventListener('focus', onWindowFocus)
    window.addEventListener('online', onOnline)
    window.addEventListener('pageshow', onPageShow)

    if ('BroadcastChannel' in window) {
      playbackBroadcastChannel = new BroadcastChannel(MIRROR_PLAYBACK_BROADCAST_CHANNEL)
      playbackBroadcastChannel.onmessage = (messageEvent: MessageEvent<{ eventId?: string; state?: SharedPlaybackState }>) => {
        const detail = messageEvent.data
        if (detail?.eventId === eventId && detail.state) {
          setPlaybackState(detail.state)
          clearMirrorWarningSmoothly()
        }
      }
    }

    startPlaybackHealthTimer()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      isCurrent = false
      clearReconnectTimer()
      disconnectSubscription()
      stopPlaybackHealthTimer()
      window.removeEventListener(PLAYBACK_STATE_EVENT, onPlaybackStateEvent as EventListener)
      window.removeEventListener('storage', onStoragePlaybackState)
      window.removeEventListener('focus', onWindowFocus)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      playbackBroadcastChannel?.close()
    }
  }, [eventId, layoutEditMode])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    return () => {
      if (spotlightTimerRef.current) {
        window.clearTimeout(spotlightTimerRef.current)
      }
      if (shutterFallbackPulseTimerRef.current) {
        window.clearTimeout(shutterFallbackPulseTimerRef.current)
      }
      spotlightBusyRef.current = false
      spotlightQueueRef.current = []
    }
  }, [layoutEditMode])

  useEffect(() => {
    if (layoutEditMode) {
      return
    }

    if (!eventId || !showSpotlight || !isUuidLikeEventId(eventId)) {
      spotlightQueueRef.current = []
      spotlightBusyRef.current = false
      seenSpotlightPostIdsRef.current = new Set()

      if (spotlightTimerRef.current) {
        window.clearTimeout(spotlightTimerRef.current)
        spotlightTimerRef.current = null
      }
      return
    }

    const startSpotlight = (nextItem: SpotlightQueueItem) => {
      spotlightBusyRef.current = true
      setFlashActive(true)
      const shutterSoundPlayed = playShutterSound()

      if (!shutterSoundPlayed) {
        setShowShutterFallbackPulse(true)

        if (shutterFallbackPulseTimerRef.current) {
          window.clearTimeout(shutterFallbackPulseTimerRef.current)
        }

        shutterFallbackPulseTimerRef.current = window.setTimeout(() => {
          setShowShutterFallbackPulse(false)
          shutterFallbackPulseTimerRef.current = null
        }, 840)
      }

      setQueuedSpotlightCount(spotlightQueueRef.current.length)

      window.setTimeout(() => {
        setFlashActive(false)
      }, 220)

      setSpotlight({
        id: nextItem.id,
        eventId: nextItem.eventId,
        imageDataUrl: nextItem.imageDataUrl,
        authorName: nextItem.authorName,
        caption: pickSpotlightCaption(nextItem.authorName),
      })

      if (spotlightTimerRef.current) {
        window.clearTimeout(spotlightTimerRef.current)
      }

      spotlightTimerRef.current = window.setTimeout(() => {
        setSpotlight(null)
        spotlightBusyRef.current = false
        spotlightTimerRef.current = null

        const queuedItem = spotlightQueueRef.current.shift()
        setQueuedSpotlightCount(spotlightQueueRef.current.length)

        if (queuedItem) {
          startSpotlight(queuedItem)
        }
      }, SPOTLIGHT_DURATION_MS)
    }

    const enqueueSpotlight = (nextItem: SpotlightQueueItem) => {
      if (spotlightBusyRef.current) {
        spotlightQueueRef.current.push(nextItem)
        setQueuedSpotlightCount(spotlightQueueRef.current.length)
        return
      }

      startSpotlight(nextItem)
    }

    const trackAndEnqueueSpotlight = (nextPost: {
      id?: string
      image_data_url?: string | null
      author_name?: string | null
    }) => {
      if (!nextPost.image_data_url || !nextPost.id) {
        return
      }

      if (seenSpotlightPostIdsRef.current.has(nextPost.id)) {
        return
      }

      seenSpotlightPostIdsRef.current.add(nextPost.id)

      enqueueSpotlight({
        id: nextPost.id,
        eventId,
        imageDataUrl: nextPost.image_data_url,
        authorName: nextPost.author_name?.trim() || 'Guest',
      })
    }

    let isCurrent = true
    let channel: ReturnType<typeof supabase.channel> | null = null
    let reconnectTimerId: number | null = null
    let reconnectAttempt = 0

    const clearReconnectTimer = () => {
      if (reconnectTimerId !== null) {
        window.clearTimeout(reconnectTimerId)
        reconnectTimerId = null
      }
    }

    const disconnectSpotlightChannel = () => {
      if (!channel) {
        return
      }

      void supabase.removeChannel(channel)
      channel = null
    }

    const loadRecentImagePosts = async (seedOnly: boolean) => {
      const { data, error } = await supabase
        .from('feed_posts')
        .select('id, image_data_url, author_name, created_at')
        .eq('event_id', eventId)
        .not('image_data_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(15)

      if (!isCurrent) {
        return
      }

      if (error) {
        console.warn('MirrorPage: failed to load spotlight feed posts', error)
        // Only show warning on initial seed load with no prior posts
        if (seedOnly && seenSpotlightPostIdsRef.current.size === 0) {
          setMirrorWarningMessage('Crowd spotlight sync is reconnecting.')
        }
        return
      }

      if (!data?.length) {
        return
      }

      const orderedPosts = [...data].reverse()

      if (seedOnly) {
        // Seed seen IDs only. Do not replay old photos when opening the mirror.
        // Spotlights should trigger only for newly inserted feed photos.
        for (const nextPost of orderedPosts) {
          if (nextPost.id) {
            seenSpotlightPostIdsRef.current.add(nextPost.id)
          }
        }

        return
      }

      for (const nextPost of orderedPosts) {
        if (!nextPost.id) {
          continue
        }

        trackAndEnqueueSpotlight(nextPost)
      }
    }

    const reconnectSpotlightChannel = () => {
      if (!isCurrent) {
        return
      }

      clearReconnectTimer()
      disconnectSpotlightChannel()

      channel = supabase
        .channel(`mirror-feed-spotlight-${eventId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'feed_posts',
            filter: `event_id=eq.${eventId}`,
          },
          (payload) => {
            const nextPost = payload.new as { id?: string; image_data_url?: string | null; author_name?: string | null }
            trackAndEnqueueSpotlight(nextPost)
          },
        )
        .subscribe((status) => {
          if (!isCurrent) {
            return
          }

          if (status === 'SUBSCRIBED') {
            reconnectAttempt = 0
            clearMirrorWarningSmoothly()
            return
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setMirrorWarningMessage('Crowd spotlight sync is reconnecting.')

            if (reconnectTimerId !== null) {
              return
            }

            const retryDelayMs = Math.min(1000 * (2 ** reconnectAttempt), 8000)
            reconnectAttempt += 1
            reconnectTimerId = window.setTimeout(() => {
              reconnectTimerId = null
              reconnectSpotlightChannel()
              void loadRecentImagePosts(false)
            }, retryDelayMs)
          }
        })
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearReconnectTimer()
        disconnectSpotlightChannel()
        return
      }

      if (document.visibilityState === 'visible') {
        reconnectSpotlightChannel()
        void loadRecentImagePosts(false)
      }
    }

    const onWindowFocus = () => {
      reconnectSpotlightChannel()
      void loadRecentImagePosts(false)
    }

    const onOnline = () => {
      reconnectSpotlightChannel()
      void loadRecentImagePosts(false)
    }

    const onPageShow = () => {
      reconnectSpotlightChannel()
      void loadRecentImagePosts(false)
    }

    void loadRecentImagePosts(true)
    reconnectSpotlightChannel()

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onWindowFocus)
    window.addEventListener('online', onOnline)
    window.addEventListener('pageshow', onPageShow)

    const pollTimerId = window.setInterval(() => {
      if (document.hidden) {
        return
      }

      if (isCurrent) {
        void loadRecentImagePosts(false)
      }
    }, SPOTLIGHT_POLL_INTERVAL_MS)

    return () => {
      isCurrent = false
      clearReconnectTimer()
      window.clearInterval(pollTimerId)
      if (spotlightTimerRef.current) {
        window.clearTimeout(spotlightTimerRef.current)
        spotlightTimerRef.current = null
      }
      if (shutterFallbackPulseTimerRef.current) {
        window.clearTimeout(shutterFallbackPulseTimerRef.current)
        shutterFallbackPulseTimerRef.current = null
      }
      seenSpotlightPostIdsRef.current = new Set()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onWindowFocus)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pageshow', onPageShow)
      disconnectSpotlightChannel()
    }
  }, [eventId, showSpotlight, layoutEditMode])

  const activeSpotlight = useMemo(() => {
    if (!eventId || !spotlight || spotlight.eventId !== eventId) {
      return null
    }

    return spotlight
  }, [eventId, spotlight])

  const mirrorBackgroundClass = useMemo(() => {
    // Demo mode always uses Human Jukebox background
    if (demoMode) {
      return 'mirror-shell-bg-human-jukebox'
    }

    if (!event?.eventType) {
      return 'mirror-shell-bg-human-jukebox'
    }

    if (event.eventType === 'karaoke') {
      return 'mirror-shell-bg-karaoke'
    }

    if (event.eventType === 'halli-live') {
      return 'mirror-shell-bg-harald-live'
    }

    if (event.eventType === 'build-self') {
      return 'mirror-shell-bg-build-self'
    }

    return 'mirror-shell-bg-human-jukebox'
  }, [event?.eventType])

  useEffect(() => {
    const onPointerMove = (pointerEvent: PointerEvent) => {
      const interaction = layoutInteractionRef.current

      if (!interaction || pointerEvent.pointerId !== interaction.pointerId) {
        return
      }

      const deltaX = ((pointerEvent.clientX - interaction.startX) / interaction.stageWidth) * 100
      const deltaY = ((pointerEvent.clientY - interaction.startY) / interaction.stageHeight) * 100

      setMirrorLayoutState((currentState) => {
        const startRect = interaction.startState[interaction.panelId]
        const nextRect = interaction.mode === 'resize'
          ? clampMirrorLayoutRect({
            left: startRect.left,
            top: startRect.top,
            width: startRect.width + deltaX,
            height: startRect.height + deltaY,
          })
          : clampMirrorLayoutRect({
            left: startRect.left + deltaX,
            top: startRect.top + deltaY,
            width: startRect.width,
            height: startRect.height,
          })

        return {
          ...currentState,
          [interaction.panelId]: nextRect,
        }
      })
    }

    const endInteraction = (pointerEvent?: PointerEvent) => {
      const interaction = layoutInteractionRef.current

      if (!interaction) {
        return
      }

      if (!pointerEvent || pointerEvent.pointerId === interaction.pointerId) {
        layoutInteractionRef.current = null
      }
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endInteraction)
    window.addEventListener('pointercancel', endInteraction)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endInteraction)
      window.removeEventListener('pointercancel', endInteraction)
    }
  }, [])

  const beginMirrorLayoutInteraction = useCallback((panelId: MirrorLayoutPanelId, mode: 'drag' | 'resize') => (pointerEvent: React.PointerEvent<HTMLButtonElement>) => {
    if (!layoutEditMode || !mirrorShellRef.current) {
      return
    }

    const stageRect = mirrorShellRef.current.getBoundingClientRect()

    if (stageRect.width <= 0 || stageRect.height <= 0) {
      return
    }

    pointerEvent.preventDefault()
    pointerEvent.stopPropagation()

    layoutInteractionRef.current = {
      panelId,
      mode,
      pointerId: pointerEvent.pointerId,
      startX: pointerEvent.clientX,
      startY: pointerEvent.clientY,
      startRect: mirrorLayoutStateRef.current[panelId],
      startState: mirrorLayoutStateRef.current,
      stageWidth: stageRect.width,
      stageHeight: stageRect.height,
    }

    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId)
  }, [layoutEditMode])

  const resetMirrorLayoutState = useCallback(() => {
    setMirrorLayoutState(DEFAULT_MIRROR_LAYOUT_STATE)
  }, [])

  const saveMirrorLayoutGlobally = useCallback(async () => {
    if (!isHost || !user?.id) {
      setMirrorWarningMessage('Sign in as host to hard-save the mirror layout globally.')
      return
    }

    setGlobalMirrorLayoutSaveBusy(true)

    try {
      await saveGlobalMirrorLayoutState(user.id, mirrorLayoutStateRef.current)
      setMirrorWarningMessage('Mirror layout hard-saved globally for this host.')
    } catch (error) {
      console.warn('MirrorPage: failed to save mirror layout globally', error)

      if (isMissingMirrorLayoutProfileColumnError(error)) {
        setMirrorWarningMessage('Global mirror layout save needs the latest profile migration.')
      } else {
        setMirrorWarningMessage('Could not hard-save the mirror layout globally. Please try again.')
      }
    } finally {
      setGlobalMirrorLayoutSaveBusy(false)
    }
  }, [isHost, user?.id])

  useEffect(() => {
    if (!mirrorLayoutOwnerId) {
      return
    }

    let isCurrent = true

    const hydrateGlobalMirrorLayout = async () => {
      try {
        const globalLayoutState = await loadGlobalMirrorLayoutState(mirrorLayoutOwnerId)

        if (!isCurrent || !globalLayoutState) {
          return
        }

        setMirrorLayoutState(globalLayoutState)
      } catch (error) {
        console.warn('MirrorPage: failed to load global mirror layout', error)
      }
    }

    void hydrateGlobalMirrorLayout()

    return () => {
      isCurrent = false
    }
  }, [mirrorLayoutOwnerId])

  const mirrorLayoutEditorStyles = useMemo(() => {
    if (!layoutEditMode) {
      return ''
    }

    return (Object.entries(mirrorLayoutState) as Array<[MirrorLayoutPanelId, MirrorLayoutRect]>)
      .map(([panelId, rect]) => (
        `[data-mirror-layout-panel="${panelId}"] { left: ${rect.left}%; top: ${rect.top}%; width: ${rect.width}%; height: ${rect.height}%; z-index: ${panelId === 'nowPlaying' ? 2 : 1}; }`
      ))
      .join('\n')
  }, [layoutEditMode, mirrorLayoutState])

  if (loading) {
    return (
      <div className="mirror-shell">
        <p className="mirror-loading">Connecting to stage…</p>
      </div>
    )
  }

  if (!hasCheckedMirrorNetworkAccess) {
    return (
      <div className="mirror-shell">
        <p className="mirror-loading">Checking secure mirror access…</p>
      </div>
    )
  }

  if (!isMirrorNetworkAllowed) {
    return (
      <div className="mirror-shell mirror-shell-paused" aria-label="Mirror access restricted">
        <section className="mirror-pre-show" aria-label="Mirror access blocked">
          <div className="mirror-pre-show-top">
            <h1 className="mirror-pre-show-title">Skærmen er låst 🔒</h1>
            <p className="mirror-pre-show-subtitle">
              Tilslut denne enhed til <strong>Drifter 5G</strong> eller <strong>Drifter 2,4</strong> for at se scenetavlen.
            </p>
            <p className="mirror-pre-show-subtitle mirror-pre-show-subtitle-secondary">
              Screen locked — connect to <strong>Drifter 5G</strong> or <strong>Drifter 2,4</strong> to view the mirror display.
            </p>
            <div className="mirror-countdown-card mirror-countdown-card-muted mirror-network-block-card" aria-label="Access rule">
              <p className="mirror-countdown-label">WiFi</p>
              <p className="mirror-countdown-value mirror-countdown-value-compact">Drifter 5G / Drifter 2,4</p>
            </div>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div ref={mirrorShellRef} className={`mirror-shell ${isLive ? 'mirror-shell-live' : 'mirror-shell-paused'} ${highContrastMode ? 'mirror-shell-high-contrast' : ''} ${castClarityMode ? 'mirror-shell-cast-clarity' : ''} ${densityMode === 'cinema' ? 'mirror-shell-density-cinema' : 'mirror-shell-density-medium'} mirror-shell-venue-${venueMode} ${mirrorBackgroundClass} ${!shouldShowEditorControls ? 'mirror-shell-hide-controls' : ''} ${!activeSong ? 'mirror-shell-no-live-data' : ''} ${homeMirrorPreviewMode ? 'mirror-shell-home-preview' : ''}`} aria-label="Mirror display screen">
      {showFullscreenPrompt && !isFullscreen && (
        <button
          type="button"
          className="mirror-fullscreen-prompt"
          onClick={async () => {
            try {
              await requestFullscreenSafe(mirrorShellRef.current ?? document.documentElement)
              setShowFullscreenPrompt(false)
            } catch {
              setShowFullscreenPrompt(false)
            }
          }}
        >
          <span className="mirror-fullscreen-prompt-icon">⛶</span>
          <span className="mirror-fullscreen-prompt-label">Tap to enter fullscreen</span>
        </button>
      )}
      {demoMode ? (
        <div className="mirror-demo-exit-bar">
          <span className="mirror-demo-exit-label">Demo Preview</span>
        </div>
      ) : null}
      <header className="mirror-header">
        <div className="mirror-header-kiosk-row">
          <div className="mirror-header-main">
            <p className="mirror-brand" aria-label="The Human Jukebox title">
              <img src="/the-human-jukebox-logo.svg" alt="The Human Jukebox" className="mirror-brand-logo" />
            </p>
            <p className="mirror-header-event-name">
              {event?.name?.trim() || 'Live Night - Ready to start.'}
            </p>
          </div>

          <div className="mirror-venue-logo-slot" aria-label="Venue logo slot">
            {event?.venueLogoUrl ? (
              <p className="mirror-venue-logo" aria-label="Venue logo">
                <img
                  src={event.venueLogoUrl}
                  alt={`${event.venue || 'Venue'} logo`}
                  className="mirror-venue-logo-image"
                />
              </p>
            ) : (
              <p className="mirror-venue-logo-placeholder" aria-label="Venue logo placeholder">
                <span className="mirror-venue-logo-placeholder-title">Your Logo</span>
                <span className="mirror-venue-logo-placeholder-copy">Designed to sit here</span>
              </p>
            )}
          </div>

          <div className="mirror-header-live-stack">
            <span className={`mirror-status ${event?.roomOpen ? 'mirror-open live-pulse' : 'mirror-paused'}`.trim()}>
              {liveBadgeLabel}
            </span>
            {mirrorWarning ? (
              <p className="mirror-warning" role="status">{mirrorWarning}</p>
            ) : (
              <p className="mirror-warning mirror-warning-hidden" aria-hidden="true">Placeholder</p>
            )}
          </div>
        </div>
        {shouldShowEditorControls ? (
          <div className="mirror-editor-controls" aria-label="Mirror editor controls">
            <button
              type="button"
              className="mirror-fullscreen-button"
              aria-label={isFullscreen ? 'Exit fullscreen mode' : 'Enter fullscreen mode'}
              aria-keyshortcuts="F"
              title="Keyboard shortcut: F"
              onClick={async () => {
                try {
                  if (!getActiveFullscreenElement()) {
                    await requestFullscreenSafe(mirrorShellRef.current ?? document.documentElement)
                  } else {
                    await exitFullscreenSafe()
                  }
                } catch (error) {
                  console.warn('MirrorPage: fullscreen toggle failed', error)
                  setMirrorWarningMessage('Fullscreen was blocked by the browser or iframe policy. Open /mirror in its own tab, then press F11 as fallback.')
                }
              }}
            >
              <span className="mirror-control-button-icon" aria-hidden="true">FS</span>
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
            <button
              type="button"
              className={`mirror-contrast-button ${highContrastMode ? 'mirror-control-button-active' : ''}`.trim()}
              aria-label="Toggle high contrast mode"
              title="High contrast"
              onClick={() => setHighContrastMode((currentMode) => !currentMode)}
            >
              <span className="mirror-control-button-icon" aria-hidden="true">HC</span>
              {highContrastMode ? 'High Contrast: On' : 'High Contrast: Off'}
            </button>
            <button
              type="button"
              className={`mirror-contrast-button ${showSafeMargins ? 'mirror-control-button-active' : ''}`.trim()}
              aria-label="Toggle safe margins overlay"
              title="Safe margins"
              onClick={() => setShowSafeMargins((currentValue) => !currentValue)}
            >
              <span className="mirror-control-button-icon" aria-hidden="true">SM</span>
              {showSafeMargins ? 'Safe Margins: On' : 'Safe Margins: Off'}
            </button>
            <button
              type="button"
              className="mirror-contrast-button"
              aria-label="Cycle venue visual mode"
              title="Cycle venue mode"
              onClick={() => {
                setVenueMode((currentMode) => {
                  if (currentMode === 'club') {
                    return 'lounge'
                  }

                  if (currentMode === 'lounge') {
                    return 'festival'
                  }

                  return 'club'
                })
              }}
            >
              <span className="mirror-control-button-icon" aria-hidden="true">VM</span>
              Venue: {venueMode === 'club' ? 'Club' : venueMode === 'festival' ? 'Festival' : 'Lounge'}
            </button>
            <p className="mirror-control-shortcuts" aria-live="polite">
              Shortcuts: <strong>F</strong> fullscreen, <strong>Esc</strong> exit fullscreen, <strong>Space</strong> now playing/quote mode.
            </p>
            <div className="mirror-banner-editor">
              <label className="mirror-banner-label" htmlFor="mirror-banner-input">📢 Scrolling Banner</label>
              <button
                type="button"
                className={`mirror-contrast-button ${isMirrorBannerEnabled ? 'mirror-control-button-active' : ''}`.trim()}
                aria-label="Toggle scrolling banner"
                title="Toggle scrolling banner"
                onClick={async () => {
                  const nextEnabled = !isMirrorBannerEnabled
                  setBannerEnabledOverride(nextEnabled)

                  if (demoMode || !event?.id) {
                    return
                  }

                  const { error } = await supabase
                    .from('events')
                    .update({ mirror_banner_enabled: nextEnabled })
                    .eq('id', event.id)

                  if (error) {
                    setBannerEnabledOverride(!nextEnabled)
                    setMirrorWarningMessage('Could not update mirror banner setting. Please try again.')
                  }
                }}
              >
                <span className="mirror-control-button-icon" aria-hidden="true">BN</span>
                Banner: {isMirrorBannerEnabled ? 'On' : 'Off'}
              </button>
              <input
                id="mirror-banner-input"
                type="text"
                className="mirror-banner-input"
                placeholder="e.g. 🍺 2-for-1 beers until 22:00 · Happy hour all night!"
                value={bannerText}
                maxLength={250}
                onChange={(e) => {
                  setBannerText(e.target.value)
                  saveTextToLocalStorage(MIRROR_BANNER_STORAGE_KEY, e.target.value)
                }}
              />
            </div>
          </div>
        ) : null}
      </header>

      {(isMirrorBannerEnabled && bannerText.trim()) ? (
        <div className="mirror-ticker-bar" aria-label="Bar offers and promotions">
          <div className="mirror-ticker-track">
            <span className="mirror-ticker-content">{bannerText.trim()}</span>
            <span className="mirror-ticker-content" aria-hidden="true">{bannerText.trim()}</span>
          </div>
        </div>
      ) : null}

      <main className={`mirror-stage ${(isLive || demoMode) ? 'mirror-stage-live' : ''}`}>
        {!isLive && !nowPlaying && !demoMode ? (
          <section
            className={`mirror-pre-show ${showCountdown ? 'mirror-pre-show-has-countdown' : ''}`.trim()}
            aria-label="Pre-show welcome"
          >

            {/* ── TOP: headline + status ── */}
            <div className="mirror-pre-show-top">
              <h1 className="mirror-pre-show-title">Welcome to the show,<br />legends and troublemakers!</h1>
              <p className="mirror-pre-show-subtitle">Make yourselves comfy — tonight runs on requests, applause, and questionable decisions.</p>
              {showCountdown ? (
                <div className="mirror-countdown-card" aria-label="Countdown to show start">
                  <p className="mirror-countdown-label">{countdownCopy.startingIn}</p>
                  <p className="mirror-countdown-value">{countdownLabel}</p>
                  {countdownStartLabel ? <p className="mirror-countdown-meta">{countdownCopy.scheduledPrefix} {countdownStartLabel}</p> : null}
                </div>
              ) : (event?.mirrorCountdownEnabled ?? true) && countdownStartLabel ? (
                <div className="mirror-countdown-card mirror-countdown-card-muted" aria-label="Scheduled show start">
                  <p className="mirror-countdown-label">{countdownCopy.scheduledStart}</p>
                  <p className="mirror-countdown-value mirror-countdown-value-compact">{countdownStartLabel}</p>
                </div>
              ) : null}
            </div>

            {/* ── MIDDLE: QR (left) + How it works (right) ── */}
            <div className="mirror-pre-show-middle">
              <div className="mirror-pre-show-qr-col">
                <img src={qrUrl} alt="QR code for the audience request page" className="mirror-qr-image" />
                <p className="mirror-qr-label">Scan to join</p>
                <p className="mirror-qr-url">Open the audience app at <strong>{audienceUrl}</strong></p>
              </div>
              <div className="mirror-pre-show-steps-col">
                <div className="mirror-how-it-works" aria-label="How it works">
                  <p className="mirror-how-it-works-label">How It Works</p>
                  <p>1. Scan the QR code with your phone.</p>
                  <p>2. Enter your name and join the audience room.</p>
                  <p>3. Open Song List and choose Human Jukebox or Karaoke.</p>
                  <p>4. Add requests and vote in Live Queue to move songs up.</p>
                </div>
              </div>
            </div>

            {/* ── BOTTOM: reserved for future features ── */}
            <div className="mirror-pre-show-bottom" />

          </section>
        ) : (
          <>
            {layoutEditMode ? <style>{`.mirror-layout-edit-canvas { position: fixed; inset: 0; z-index: 6; overflow: hidden; }\n${mirrorLayoutEditorStyles}`}</style> : null}
            {layoutEditMode ? (
              <div className="mirror-layout-edit-toolbar mirror-layout-edit-toolbar-compact" role="toolbar" aria-label="Mirror layout editor controls">
                <button type="button" className="mirror-layout-edit-button" onClick={resetMirrorLayoutState}>Reset</button>
                <button
                  type="button"
                  className="mirror-layout-edit-button"
                  onClick={() => { void saveMirrorLayoutGlobally() }}
                  disabled={globalMirrorLayoutSaveBusy}
                >
                  {globalMirrorLayoutSaveBusy ? 'Saving…' : 'Save Global'}
                </button>
                <button type="button" className="mirror-layout-edit-button mirror-layout-edit-button-primary" onClick={() => setLayoutEditMode(false)}>Done</button>
              </div>
            ) : null}
            <section
              ref={layoutEditMode ? mirrorLayoutStageRef : undefined}
              className={`mirror-kiosk-columns ${layoutEditMode ? 'mirror-layout-edit-canvas' : ''}`}
              aria-label="Now playing and live queue/feed"
            >
              <section
                className={`mirror-now-playing mirror-frame mirror-frame-now-playing ${isLive ? 'mirror-now-playing-live' : ''} ${isQuoteModeActive ? 'mirror-now-playing-between' : ''} ${layoutEditMode ? 'mirror-layout-edit-panel' : ''}`}
                data-mirror-layout-panel={layoutEditMode ? 'nowPlaying' : undefined}
              >
                {layoutEditMode ? (
                  <button
                    type="button"
                    className="mirror-layout-drag-handle"
                    aria-label="Drag now playing panel"
                    title="Drag to move"
                    onPointerDown={beginMirrorLayoutInteraction('nowPlaying', 'drag')}
                  >
                    Move
                  </button>
                ) : null}
                <p className="mirror-now-playing-band-label">Now Playing / Quote Mode</p>
                {isQuoteModeActive ? (
                  <div className="mirror-now-playing-track mirror-now-playing-track-idle" aria-label="Between songs">
                    <div className="mirror-now-playing-meta">
                      <p className="mirror-between-song-quote">{currentBetweenSongQuote}</p>
                      {!activeSong ? <p className="mirror-song-waiting-note">Waiting for next song...</p> : null}
                    </div>
                  </div>
                ) : !useLiveSongCardsInDemo && isKaraokeEvent ? (
                  <div className="mirror-now-playing-track mirror-now-playing-track-idle" aria-label="Karaoke Night">
                    <div className="mirror-now-playing-meta">
                      <h1 className="mirror-title">🎤 Karaoke Night</h1>
                      <p className="mirror-artist">{event?.name ?? 'Live Karaoke'}</p>
                      {event?.subtitle ? <p className="mirror-picked-by">{event.subtitle}</p> : null}
                      {mirrorKarafunLink ? (
                        <p className="mirror-picked-by">
                          Playlist: <a href={mirrorKarafunLink} target="_blank" rel="noopener noreferrer">{mirrorKarafunLink}</a>
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : !useLiveSongCardsInDemo && isBuildSelfEvent && !audienceVotingEnabled ? (
                  <div className="mirror-now-playing-track mirror-now-playing-track-idle" aria-label="Build Self Gig">
                    <div className="mirror-now-playing-meta">
                      <h1 className="mirror-title">{event?.artistName ?? event?.name ?? 'Live Show'}</h1>
                      {event?.artistName ? <p className="mirror-artist">{event.name}</p> : null}
                      {event?.subtitle ? <p className="mirror-picked-by">{event.subtitle}</p> : null}
                      <p className="mirror-picked-by">🎵 Setlist Show</p>
                    </div>
                  </div>
                ) : !useLiveSongCardsInDemo && isHaraldLiveEvent ? (
                  <div className="mirror-now-playing-track mirror-now-playing-track-idle" aria-label="Harald Live Show">
                    <div className="mirror-now-playing-meta">
                      <h1 className="mirror-title">{event?.artistName ?? event?.name ?? 'Live Show'}</h1>
                      {event?.artistName ? <p className="mirror-artist">{event.name}</p> : null}
                      {event?.subtitle ? <p className="mirror-picked-by">{event.subtitle}</p> : null}
                      <p className="mirror-picked-by">🎸 Harald Live</p>
                    </div>
                  </div>
                ) : (
                  <div className="mirror-now-playing-track">
                    <div className="mirror-now-playing-artwork-slot">
                      {activeSong.cover_url && !failedCoverUrls[activeSong.cover_url] ? (
                        <img
                          src={activeSong.cover_url}
                          alt={`Cover art for ${activeSong.title}`}
                          className="mirror-now-playing-cover"
                          onError={() => onCoverLoadError(activeSong.cover_url)}
                        />
                      ) : activeSong.audience_sings ? (
                        <span className="mirror-now-playing-karaoke-mark" aria-label="Karaoke request">Karaoke</span>
                      ) : (
                        <span className="mirror-now-playing-karaoke-mark" aria-hidden="true">♪</span>
                      )}
                    </div>
                    <div className="mirror-now-playing-meta">
                      <h1 className="mirror-title">
                        {normalizeMirrorText(activeSong.title, 'Waiting for requests…')}
                        <span className="mirror-title-separator"> - </span>
                        <span className="mirror-title-artist">
                          {(() => {
                            const artistText = normalizeMirrorText(activeSong.artist, 'Be first to request a tune.')
                            return artistText.charAt(0).toUpperCase() + artistText.slice(1)
                          })()}
                          {activeSong.audience_sings ? (
                            <span className="mirror-now-playing-karaoke-inline" aria-label="Karaoke request">Karaoke</span>
                          ) : null}
                        </span>
                      </h1>
                      {activeSongChosenByLine ? (
                        <p className={`mirror-picked-by ${activeSongChosenByAccentClass}`}>
                          {activeSongChosenByLine}
                        </p>
                      ) : null}
                      <div className="mirror-song-fact-box" aria-live="polite">
                        <p className="mirror-song-fact-label">Now Playing</p>
                        <p key={`${activeSong.id}-${currentFactIndex}`} className="mirror-song-fact">
                          {currentSongFact}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {!layoutEditMode ? (
                  <a
                    className="mirror-now-playing-qr-panel"
                    href={audienceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label="Audience request page QR link"
                  >
                    <img src={qrUrl} alt="QR code for the audience request page" className="mirror-now-playing-qr" />
                    <p className="mirror-now-playing-qr-label">Scan to request</p>
                    <p className="mirror-now-playing-qr-url">{audienceUrl}</p>
                  </a>
                ) : null}
                {layoutEditMode ? (
                  <button
                    type="button"
                    className="mirror-layout-resize-handle"
                    aria-label="Resize now playing panel"
                    title="Drag to resize"
                    onPointerDown={beginMirrorLayoutInteraction('nowPlaying', 'resize')}
                  />
                ) : null}
              </section>

              <section
                className="mirror-kiosk-right"
                aria-label="Queue and community feed"
              >
                <section
                  className={`mirror-live-feed-frame mirror-frame ${layoutEditMode ? 'mirror-layout-edit-panel' : ''}`}
                  aria-label="Live feed frame"
                  data-mirror-layout-panel={layoutEditMode ? 'community' : undefined}
                >
                  {layoutEditMode ? (
                    <button
                      type="button"
                      className="mirror-layout-drag-handle"
                      aria-label="Drag live feed panel"
                      title="Drag to move"
                      onPointerDown={beginMirrorLayoutInteraction('community', 'drag')}
                    >
                      Move
                    </button>
                  ) : null}
                  {layoutEditMode ? (
                    <div className="mirror-layout-edit-feed-preview" aria-label="Live feed preview">
                      <div className="mirror-layout-edit-feed-preview-header">
                        <p className="mirror-layout-edit-feed-preview-eyebrow">Community</p>
                        <h2 className="mirror-layout-edit-feed-preview-title">Live Feed Messages</h2>
                      </div>
                      <div className="mirror-layout-edit-feed-preview-items">
                        <p>Use this block for audience messages.</p>
                        <p>Stretch it taller or wider until the feed feels right.</p>
                        <p>We can make the queue and community area share the bottom row.</p>
                      </div>
                    </div>
                  ) : (
                    <LiveFeedPanel mode="mirror" showComposer={false} title="Live Feed Messages" showModerationControls={shouldShowAdminElements && !hideControlsForAudience} emptyStateText="No messages yet - say hi!" />
                  )}
                  {layoutEditMode ? (
                    <button
                      type="button"
                      className="mirror-layout-resize-handle"
                      aria-label="Resize live feed panel"
                      title="Drag to resize"
                      onPointerDown={beginMirrorLayoutInteraction('community', 'resize')}
                    />
                  ) : null}
                </section>

                <section
                  className={`mirror-song-queue-frame mirror-frame mirror-up-next ${shouldCompactQueue ? 'mirror-up-next-compact' : ''} ${layoutEditMode ? 'mirror-layout-edit-panel' : ''}`}
                  aria-label="Song queue frame"
                  data-mirror-layout-panel={layoutEditMode ? 'queue' : undefined}
                >
                  {layoutEditMode ? (
                    <button
                      type="button"
                      className="mirror-layout-drag-handle"
                      aria-label="Drag song queue panel"
                      title="Drag to move"
                      onPointerDown={beginMirrorLayoutInteraction('queue', 'drag')}
                    >
                      Move
                    </button>
                  ) : null}
                  <p className="mirror-up-next-label">Song Queue</p>
                  {upNext.length > 0 ? (
                    <ol className="mirror-queue">
                      {upNext.map((song, index) => {
                        const queueChosenByLine = song.createdByName
                          ? (getChosenByLine(song.id, song.createdByName) ?? `Chosen by ${song.createdByName}`)
                          : null
                        const queueChosenByAccentClass = getChosenByAccentClass(song.id)

                        return (
                          <li key={song.id} className={`mirror-queue-item ${index === 0 ? 'mirror-queue-item-next' : ''}`.trim()}>
                            <span className="mirror-queue-pos">{index + (isNowPlayingStarted ? 2 : 1)}</span>
                            {song.cover_url && !failedCoverUrls[song.cover_url] ? (
                              <img
                                src={song.cover_url}
                                alt={`Cover art for ${song.title}`}
                                className="mirror-queue-cover"
                                onError={() => onCoverLoadError(song.cover_url)}
                              />
                            ) : null}
                            <div className="mirror-queue-info">
                              <span className="mirror-queue-title">{normalizeMirrorText(song.title, 'Untitled Song')}</span>
                              <span className="mirror-queue-artist">{normalizeMirrorText(song.artist, 'Unknown Artist')}</span>
                              {queueChosenByLine ? (
                                <span className={`mirror-queue-picker mirror-queue-artist-picker ${queueChosenByAccentClass}`}>{queueChosenByLine}</span>
                              ) : null}
                              {song.audience_sings ? <span className="mirror-karaoke-tag karaoke-badge">Karaoke Request</span> : null}
                            </div>
                            <span className="mirror-queue-votes">+{song.votes_count}</span>
                          </li>
                        )
                      })}
                    </ol>
                  ) : (
                    <p className="mirror-empty-note">Queue is empty - request a song!</p>
                  )}
                  {layoutEditMode ? (
                    <button
                      type="button"
                      className="mirror-layout-resize-handle"
                      aria-label="Resize song queue panel"
                      title="Drag to resize"
                      onPointerDown={beginMirrorLayoutInteraction('queue', 'resize')}
                    />
                  ) : null}
                </section>
              </section>
            </section>
          </>
        )}
      </main>

      {playbackState?.brbActive ? (
        <div className="mirror-brb-overlay" aria-live="polite" role="status">
          <p className="mirror-brb-icon" aria-hidden="true">☕</p>
          <p className="mirror-brb-heading">Be Right Back</p>
          {playbackState.brbMessage ? (
            <p className="mirror-brb-message">{playbackState.brbMessage}</p>
          ) : null}
        </div>
      ) : null}

      {showSpotlight && activeSpotlight ? (
        <aside className="mirror-photo-spotlight" aria-label="Live crowd photo spotlight">
          <figure className="mirror-polaroid" key={activeSpotlight.id}>
            <img src={activeSpotlight.imageDataUrl} alt={`Crowd photo by ${activeSpotlight.authorName}`} className="mirror-polaroid-photo" />
            <figcaption>
              <strong>{activeSpotlight.authorName}</strong>
              <span>{activeSpotlight.caption}</span>
            </figcaption>
          </figure>
          {queuedSpotlightCount > 0 ? (
            <p className="mirror-spotlight-queue-pill">
              {queuedSpotlightCount} more photo{queuedSpotlightCount === 1 ? '' : 's'} coming
            </p>
          ) : null}
        </aside>
      ) : null}

      {showSpotlight && flashActive ? <div className="mirror-spotlight-flash" aria-hidden="true" /> : null}
      {showSpotlight && showShutterFallbackPulse ? <div className="mirror-spotlight-fallback-pulse" aria-hidden="true" /> : null}
      {!isLive && showSafeMargins && shouldShowAdminElements ? <div className="mirror-safe-margins-overlay" aria-hidden="true" /> : null}
    </div>
  )
}

function MirrorPage() {
  if (isMirrorLayoutEditRequest) {
    return <MirrorLayoutEditorPage />
  }
  return <MirrorPageContent />
}

export default MirrorPage
