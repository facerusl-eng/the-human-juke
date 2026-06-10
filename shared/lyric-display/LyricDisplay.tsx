import { useEffect, useMemo, useRef, useState } from 'react'
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
  const lastPedalActionAtRef = useRef(0)
  const lastPedalActionTypeRef = useRef<LyricPedalAction | null>(null)
  const {
    state,
    setActiveView,
    openLyricForSong,
    closeLyric,
    setShowOnMirror,
    nextBlock,
    previousBlock,
  } = useSharedLyricState(supabase, 'control')

  const currentBlock = useMemo(() => {
    if (!state.blocks.length) {
      return 'No lyric loaded.'
    }

    return state.blocks[state.currentBlockIndex] ?? state.blocks[0]
  }, [state.blocks, state.currentBlockIndex])

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
      const interactiveTarget = target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="button"], [role="textbox"]')
      if (interactiveTarget) {
        return
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

      keyEvent.preventDefault()

      if (action === 'previous') {
        previousBlock()
      } else {
        nextBlock()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [nextBlock, previousBlock, state.activeView])

  const openLyric = async () => {
    if (!activeSong) {
      return
    }

    setActiveView('lyric')
    await openLyricForSong(activeSong, returnToPath)
  }

  const goBack = () => {
    closeLyric()
    navigate(state.returnToPath || returnToPath, { replace: false })
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

  return (
    <section className="lyric-dark-neon-shell" aria-label="Lyric display">
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

      <article className="lyric-dark-neon-stage" aria-live="polite" aria-atomic="true">
        <p className="lyric-dark-neon-copy lyric-dark-neon-copy-control lyric-dark-neon-copy-active">{currentBlock}</p>
        <p className="lyric-dark-neon-meta">
          {state.song ? `${state.song.artist} - ${state.song.title}` : 'No song selected'}
          {' • '}
          Block {Math.min(state.currentBlockIndex + 1, Math.max(1, state.blocks.length))}/{Math.max(1, state.blocks.length)}
          {' • '}
          Space/Enter/PageDown next, Shift+Space/PageUp previous
        </p>
      </article>
    </section>
  )
}
