import type { JamzoneBridge } from '../lib/jamzoneBridge'
import { initializeJamzoneBridgeRuntime, setJamzoneBridge } from '../lib/jamzoneBridge'

type ExternalJamzoneApi = {
  getCurrentTime: () => number
  getCurrentSong: () => { id: string; title: string; artist: string } | null
}

export function registerJamzoneBridgeFromApi(api: ExternalJamzoneApi) {
  initializeJamzoneBridgeRuntime()

  const bridge: JamzoneBridge = {
    getCurrentTime: () => api.getCurrentTime(),
    getCurrentSong: () => api.getCurrentSong(),
  }

  setJamzoneBridge(bridge)
}
