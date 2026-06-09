export type JamzoneSong = {
  id: string
  title: string
  artist: string
}

export type JamzoneBridge = {
  getCurrentTime: () => number
  getCurrentSong?: () => JamzoneSong | null
  currentSong?: JamzoneSong | null
}

export type JamzoneSnapshot = {
  currentTimeSeconds: number
  currentSong: JamzoneSong | null
}

const JAMZONE_BRIDGE_EVENT = 'human-jukebox:jamzone-bridge'
const JAMZONE_SNAPSHOT_EVENT = 'human-jukebox:jamzone-snapshot'

type JamzoneBridgeApi = {
  setBridge: (bridge: JamzoneBridge | null) => void
  pushSnapshot: (snapshot: Partial<JamzoneSnapshot>) => void
  clear: () => void
}

type WindowWithJamzoneBridge = Window & {
  jamzoneBridge?: JamzoneBridge
  HumanJukeboxJamzone?: JamzoneBridge
  HumanJukeboxJamzoneApi?: JamzoneBridgeApi
}

let activeBridge: JamzoneBridge | null = null
let activeSnapshot: JamzoneSnapshot = {
  currentTimeSeconds: 0,
  currentSong: null,
}
let listenersBound = false

function normalizeSong(input: Partial<JamzoneSong> | null | undefined): JamzoneSong | null {
  if (!input) {
    return null
  }

  const title = (input.title ?? '').trim()
  const artist = (input.artist ?? '').trim()
  const idSeed = (input.id ?? `${artist}-${title}`).trim()

  if (!title || !artist || !idSeed) {
    return null
  }

  return {
    id: idSeed,
    title,
    artist,
  }
}

function createSnapshotBackedBridge(): JamzoneBridge {
  return {
    getCurrentTime: () => activeSnapshot.currentTimeSeconds,
    getCurrentSong: () => activeSnapshot.currentSong,
  }
}

function mirrorBridgeOnWindow(nextBridge: JamzoneBridge | null) {
  if (typeof window === 'undefined') {
    return
  }

  const runtimeWindow = window as WindowWithJamzoneBridge

  if (nextBridge) {
    runtimeWindow.jamzoneBridge = nextBridge
    runtimeWindow.HumanJukeboxJamzone = nextBridge
    return
  }

  delete runtimeWindow.jamzoneBridge
  delete runtimeWindow.HumanJukeboxJamzone
}

export function setJamzoneBridge(nextBridge: JamzoneBridge | null) {
  activeBridge = nextBridge
  mirrorBridgeOnWindow(nextBridge)
}

export function pushJamzoneSnapshot(snapshot: Partial<JamzoneSnapshot>) {
  const nextSong = normalizeSong(snapshot.currentSong)

  activeSnapshot = {
    currentTimeSeconds: Number.isFinite(snapshot.currentTimeSeconds)
      ? Math.max(0, Number(snapshot.currentTimeSeconds))
      : activeSnapshot.currentTimeSeconds,
    currentSong: nextSong ?? activeSnapshot.currentSong,
  }

  if (!activeBridge) {
    setJamzoneBridge(createSnapshotBackedBridge())
  }
}

export function clearJamzoneBridge() {
  activeSnapshot = {
    currentTimeSeconds: 0,
    currentSong: null,
  }
  setJamzoneBridge(null)
}

export function getJamzoneBridge() {
  if (activeBridge) {
    return activeBridge
  }

  if (typeof window !== 'undefined') {
    const runtimeWindow = window as WindowWithJamzoneBridge
    const fallbackBridge = runtimeWindow.jamzoneBridge ?? runtimeWindow.HumanJukeboxJamzone ?? null

    if (fallbackBridge) {
      activeBridge = fallbackBridge
      return fallbackBridge
    }
  }

  return null
}

export function getJamzoneCurrentSong() {
  const bridge = getJamzoneBridge()
  if (!bridge) {
    return null
  }

  if (typeof bridge.getCurrentSong === 'function') {
    return normalizeSong(bridge.getCurrentSong())
  }

  return normalizeSong(bridge.currentSong)
}

export function getJamzoneCurrentTimeSeconds() {
  const bridge = getJamzoneBridge()
  if (!bridge) {
    return 0
  }

  const currentTime = Number(bridge.getCurrentTime())
  return Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0
}

function bindJamzoneBridgeEvents() {
  if (listenersBound || typeof window === 'undefined') {
    return
  }

  listenersBound = true

  window.addEventListener(JAMZONE_BRIDGE_EVENT, (event: Event) => {
    const customEvent = event as CustomEvent<JamzoneBridge | null>
    setJamzoneBridge(customEvent.detail ?? null)
  })

  window.addEventListener(JAMZONE_SNAPSHOT_EVENT, (event: Event) => {
    const customEvent = event as CustomEvent<Partial<JamzoneSnapshot>>
    if (!customEvent.detail) {
      return
    }
    pushJamzoneSnapshot(customEvent.detail)
  })
}

export function initializeJamzoneBridgeRuntime() {
  if (typeof window === 'undefined') {
    return
  }

  bindJamzoneBridgeEvents()

  const runtimeWindow = window as WindowWithJamzoneBridge
  runtimeWindow.HumanJukeboxJamzoneApi = {
    setBridge: setJamzoneBridge,
    pushSnapshot: pushJamzoneSnapshot,
    clear: clearJamzoneBridge,
  }
}
