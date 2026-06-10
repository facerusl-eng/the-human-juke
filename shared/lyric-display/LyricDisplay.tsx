import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useSharedLyricState } from './state'
import type { LyricSongRef } from './types'
import './dark-neon-karaoke.css'

const PEDAL_ACTION_DEBOUNCE_MS = 180
const PEDAL_SAME_ACTION_COALESCE_MS = 520

type LyricPedalAction = 'next' | 'previous'

type BluetoothRequestDevice = (options: {
  acceptAllDevices?: boolean
  optionalServices?: string[]
}) => Promise<{
  name?: string
  gatt?: {
    connected?: boolean
    connect?: () => Promise<unknown>
  }
}>

function resolveLyricActionFromKey(keyEvent: KeyboardEvent): LyricPedalAction | null {
  if (keyEvent.altKey || keyEvent.ctrlKey || keyEvent.metaKey) {
    return null
  }

  const key = keyEvent.key
  const code = keyEvent.code

  if (code === 'Space') {
    return keyEvent.shiftKey ? 'previous' : 'next'
  }

  if (
    key === 'Enter' ||
    code === 'NumpadEnter' ||
    key === 'ArrowRight' ||
    key === 'ArrowDown' ||
    key === 'PageDown' ||
    key === 'MediaTrackNext'
  ) {
    return 'next'
  }

  if (
    key === 'ArrowLeft' ||
    key === 'ArrowUp' ||
    key === 'PageUp' ||
    key === 'MediaTrackPrevious'
  ) {
    return 'previous'
  }

  return null
}

type LyricDisplayProps = {
  supabase: SupabaseClient
  activeSong: LyricSongRef | null
  returnToPath: string
  autoOpenOnMount?: boolean
}

export default function LyricDisplay({
  supabase,
  activeSong,
  returnToPath,
  autoOpenOnMount = false,
}: LyricDisplayProps) {
  const navigate = useNavigate()
  const lastAutoOpenedSongKeyRef = useRef<string | null>(null)
  const [pedalStatus, setPedalStatus] = useState('Pedal: keyboard fallback ready')
  const [isPairingPedal, setIsPairingPedal] = useState(false)
  const [isEditingLyric, setIsEditingLyric] = useState(false)
  const [draftLyricText, setDraftLyricText] = useState('')
  const lastPedalActionAtRef = useRef(0)
  const lastPedalActionTypeRef = useRef<LyricPedalAction | null>(null)
  const {
    state,
    setActiveView,
    openLyricForSong,
    closeLyric,
    setBlocks,
    setShowOnMirror,
    nextBlock,
    previousBlock,
  } = useSharedLyricState(supabase, 'control')

  const adminControlsVisible = useMemo(() => {
    const isAdminReturnPath = /\/admin\b/i.test(returnToPath)

    if (typeof window === 'undefined') {
      return isAdminReturnPath
    }

    const isAdminRoute = /\/admin\b/i.test(window.location.pathname)
    const isAdminContext = isAdminRoute || isAdminReturnPath

    if (!isAdminContext) {
      return false
    }

    // Gig Control opens lyric mode with stage=1 for performer layout,
    // but this should still keep admin controls visible in admin context.
    if (isAdminReturnPath) {
      return true
    }

    const searchParams = new URLSearchParams(window.location.search)
    const isStageMode = searchParams.get('stage') === '1'
    return !isStageMode
  }, [returnToPath])

  const currentBlock = useMemo(() => {
    if (!state.blocks.length) {
      return 'No lyric loaded.'
    }

    return state.blocks[state.currentBlockIndex] ?? state.blocks[0]
  }, [state.blocks, state.currentBlockIndex])

  const isIntroScreen = state.currentBlockIndex < 0
  const introSongLabel = state.song ? `${state.song.artist} - ${state.song.title}` : 'No song selected'
  const introRequesterLabel = state.song?.audience_sings && state.song.createdByName?.trim()
    ? `Requested by ${state.song.createdByName.trim()}`
    : null

  const goBack = useCallback(() => {
    closeLyric()
    navigate(state.returnToPath || returnToPath, { replace: false })
  }, [closeLyric, navigate, returnToPath, state.returnToPath])

  useEffect(() => {
    if (!autoOpenOnMount || !activeSong) {
      return
    }

    // If lyric state is already live (typically driven by now-playing from Gig Control),
    // do not override it from route query params.
    if (state.song && state.blocks.length > 0) {
      return
    }

    const songKey = `${activeSong.id}::${activeSong.artist.toLowerCase()}::${activeSong.title.toLowerCase()}`
    if (lastAutoOpenedSongKeyRef.current === songKey) {
      return
    }

    lastAutoOpenedSongKeyRef.current = songKey
    void openLyricForSong(activeSong, returnToPath)
  }, [activeSong, autoOpenOnMount, openLyricForSong, returnToPath, state.blocks.length, state.song])

  useEffect(() => {
    if (state.activeView !== 'lyric') {
      return
    }

    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (state.activeView !== 'lyric') {
        return
      }

      const target = keyEvent.target as HTMLElement | null
      const textEntryTarget = target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
      if (textEntryTarget) {
        return
      }

      if (adminControlsVisible) {
        const backKey = keyEvent.key === 'ArrowLeft'
          || keyEvent.key === 'PageUp'
          || keyEvent.key === 'MediaTrackPrevious'

        if (backKey && !keyEvent.repeat) {
          keyEvent.preventDefault()
          keyEvent.stopPropagation()
          goBack()
          return
        }
      }

      const action = resolveLyricActionFromKey(keyEvent)
      if (!action) {
        return
      }

      if (keyEvent.repeat) {
        return
      }

      const now = Date.now()
      if (now - lastPedalActionAtRef.current < PEDAL_ACTION_DEBOUNCE_MS) {
        return
      }

      if (
        lastPedalActionTypeRef.current === action
        && now - lastPedalActionAtRef.current < PEDAL_SAME_ACTION_COALESCE_MS
      ) {
        return
      }

      lastPedalActionAtRef.current = now
      lastPedalActionTypeRef.current = action

      // Pedals commonly emit Enter/Space that can also trigger focused buttons.
      // Block default behavior early so lyric controls do not reopen stale route songs.
      keyEvent.preventDefault()
      keyEvent.stopPropagation()

      if (action === 'previous') {
        previousBlock()
      } else {
        nextBlock()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [adminControlsVisible, goBack, nextBlock, previousBlock, state.activeView])

  const openLyric = async () => {
    if (state.activeView === 'lyric' && state.blocks.length > 0) {
      return
    }

    const songToOpen = state.song ?? activeSong
    if (!songToOpen) {
      return
    }

    setActiveView('lyric')
    await openLyricForSong(songToOpen, returnToPath)
  }

  const connectBluetoothPedal = async () => {
    if (typeof navigator === 'undefined') {
      setPedalStatus('Pedal: browser does not expose device pairing here')
      return
    }

    const bluetooth = (navigator as Navigator & {
      bluetooth?: {
        requestDevice?: BluetoothRequestDevice
      }
    }).bluetooth

    if (!bluetooth?.requestDevice) {
      setPedalStatus('Pedal: Bluetooth pairing unavailable in this browser')
      return
    }

    setIsPairingPedal(true)
    setPedalStatus('Pedal: pairing... use your browser chooser')

    try {
      const device = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['battery_service', 'device_information'],
      })

      if (device.gatt?.connect && !device.gatt.connected) {
        try {
          await device.gatt.connect()
        } catch {
          // Some pedals pair at OS level and do not expose GATT data.
        }
      }

      const label = device.name?.trim() || 'Pedal connected'
      setPedalStatus(`Pedal: ${label}`)
    } catch {
      setPedalStatus('Pedal: pairing canceled or failed')
    } finally {
      setIsPairingPedal(false)
    }
  }

  const openLyricEditor = () => {
    setDraftLyricText(state.blocks.join('\n\n'))
    setIsEditingLyric(true)
  }

  const cancelLyricEditor = () => {
    setIsEditingLyric(false)
    setDraftLyricText('')
  }

  const saveEditedLyric = () => {
    const normalized = draftLyricText.replace(/\r\n/g, '\n')
    const nextBlocks = normalized
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)

    if (nextBlocks.length === 0) {
      return
    }

    setBlocks(nextBlocks)
    setIsEditingLyric(false)
  }

  return (
    <section className="lyric-dark-neon-shell" aria-label="Lyric display">
      {adminControlsVisible ? (
      <div className="lyric-dark-neon-controls" data-spacebar-ignore="true">
        <button type="button" className="lyric-dark-neon-button" onClick={openLyric}>
          Show Lyric
        </button>
        {state.blocks.length > 0 ? (
          <button
            type="button"
            className="lyric-dark-neon-button"
            onClick={() => setShowOnMirror(!state.showOnMirror)}
          >
            Show in Mirror Screen
          </button>
        ) : null}
        <button type="button" className="lyric-dark-neon-button" onClick={openLyricEditor}>
          Edit Lyric
        </button>
        <button
          type="button"
          className="lyric-dark-neon-button"
          onClick={connectBluetoothPedal}
          disabled={isPairingPedal}
        >
          {isPairingPedal ? 'Pairing Pedal...' : 'Connect Bluetooth Pedal'}
        </button>
        <button type="button" className="lyric-dark-neon-button" onClick={goBack}>
          Back to Control Room / Gig Control
        </button>
        <p className="lyric-dark-neon-pedal-status">{pedalStatus}</p>
      </div>
      ) : null}

      {adminControlsVisible && isEditingLyric ? (
        <section className="lyric-dark-neon-editor" data-spacebar-ignore="true" aria-label="Edit lyric">
          <p className="lyric-dark-neon-editor-title">Edit lyric text (separate sections with blank lines)</p>
          <textarea
            className="lyric-dark-neon-editor-textarea"
            value={draftLyricText}
            onChange={(event) => setDraftLyricText(event.target.value)}
            spellCheck={false}
            aria-label="Lyric editor"
            placeholder="Paste or edit full lyric text here"
          />
          <div className="lyric-dark-neon-editor-actions">
            <button type="button" className="lyric-dark-neon-button" onClick={saveEditedLyric}>Save Lyric</button>
            <button type="button" className="lyric-dark-neon-button" onClick={cancelLyricEditor}>Cancel</button>
          </div>
        </section>
      ) : null}

      <article className="lyric-dark-neon-stage" aria-live="polite" aria-atomic="true">
        {isIntroScreen ? (
          <div className="lyric-dark-neon-intro">
            <p className="lyric-dark-neon-copy lyric-dark-neon-copy-control lyric-dark-neon-copy-active lyric-dark-neon-copy-intro-title">
              {introSongLabel}
            </p>
            {introRequesterLabel ? (
              <p className="lyric-dark-neon-meta lyric-dark-neon-meta-intro">{introRequesterLabel}</p>
            ) : null}
            <p className="lyric-dark-neon-meta lyric-dark-neon-meta-intro">
              Press the foot pedal to start the lyric
            </p>
          </div>
        ) : (
          <>
            <p className="lyric-dark-neon-copy lyric-dark-neon-copy-control lyric-dark-neon-copy-active">{currentBlock}</p>
            <p className="lyric-dark-neon-meta">
              {introSongLabel}
              {adminControlsVisible ? (
                <>
                  {' • '}
                  Block {Math.min(state.currentBlockIndex + 1, Math.max(1, state.blocks.length))}/{Math.max(1, state.blocks.length)}
                  {' • '}
                  Space/Enter/PageDown next, Shift/Space/PageUp previous
                </>
              ) : null}
            </p>
          </>
        )}
      </article>
    </section>
  )
}
