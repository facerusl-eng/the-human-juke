let heartbeatTimerId = null
let syncHintTimerId = null
let tickCount = 0

function stopTimers() {
  if (heartbeatTimerId) {
    clearInterval(heartbeatTimerId)
    heartbeatTimerId = null
  }

  if (syncHintTimerId) {
    clearInterval(syncHintTimerId)
    syncHintTimerId = null
  }
}

function startTimers() {
  stopTimers()

  heartbeatTimerId = setInterval(() => {
    tickCount += 1
    self.postMessage({
      type: 'tick',
      tickCount,
      timestamp: Date.now(),
    })
  }, 1000)

  syncHintTimerId = setInterval(() => {
    self.postMessage({
      type: 'sync-hint',
      tag: 'jukebox-sync',
      timestamp: Date.now(),
    })
  }, 15000)
}

self.addEventListener('message', (event) => {
  const message = event.data || {}

  if (message.type === 'start') {
    startTimers()
    return
  }

  if (message.type === 'stop') {
    stopTimers()
    return
  }

  if (message.type === 'reset') {
    tickCount = 0
    return
  }
})
