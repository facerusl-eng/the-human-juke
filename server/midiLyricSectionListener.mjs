import { EventEmitter } from 'node:events'

const MIDI_NOTE_ON = 0x90
const NOTE_NEXT_SECTION = 60
const NOTE_PREVIOUS_SECTION = 61
const NOTE_PLAY_PAUSE = 62

/**
 * @typedef {Object} LyricSection
 * @property {string} id
 * @property {string=} label
 * @property {number=} startTimeSeconds
 * @property {number=} order
 */

/**
 * @typedef {Object} LyricSectionActions
 * @property {(context: LyricSectionActionContext) => void | Promise<void>=} nextSection
 * @property {(context: LyricSectionActionContext) => void | Promise<void>=} previousSection
 * @property {(context: LyricSectionActionContext) => void | Promise<void>=} togglePlayPause
 */

/**
 * @typedef {Object} LyricSectionActionContext
 * @property {LyricSection | null} currentSection
 * @property {LyricSection | null} nextSection
 * @property {LyricSection | null} previousSection
 * @property {readonly LyricSection[]} sections
 * @property {number} currentIndex
 * @property {boolean} isPlaying
 */

/**
 * @typedef {Object} MidiLyricSectionListenerOptions
 * @property {string=} inputName
 * @property {number=} inputPortIndex
 * @property {number=} channel
 * @property {number=} noteVelocityThreshold
 * @property {number=} queueBatchDelayMs
 */

const emitter = new EventEmitter()
let registeredSections = /** @type {LyricSection[]} */ ([])
let currentIndex = -1
let isPlaying = false
let registeredActions = /** @type {LyricSectionActions} */ ({})
let activeInput = null
let activeMidiModule = null
let running = false
let queuedActions = []
let queueScheduled = false
let queueTimerId = null

function normalizeSection(section, fallbackOrder) {
  if (!section || typeof section !== 'object') {
    return null
  }

  const id = typeof section.id === 'string' ? section.id.trim() : ''
  if (!id) {
    return null
  }

  const label = typeof section.label === 'string' && section.label.trim().length > 0
    ? section.label.trim()
    : id
  const startTimeSeconds = typeof section.startTimeSeconds === 'number' && Number.isFinite(section.startTimeSeconds)
    ? Math.max(0, section.startTimeSeconds)
    : null
  const order = typeof section.order === 'number' && Number.isFinite(section.order)
    ? section.order
    : fallbackOrder

  return { id, label, startTimeSeconds, order }
}

function sortSections(sections) {
  return [...sections].sort((left, right) => {
    const leftOrder = typeof left.order === 'number' ? left.order : Number.MAX_SAFE_INTEGER
    const rightOrder = typeof right.order === 'number' ? right.order : Number.MAX_SAFE_INTEGER

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder
    }

    const leftStart = typeof left.startTimeSeconds === 'number' ? left.startTimeSeconds : Number.MAX_SAFE_INTEGER
    const rightStart = typeof right.startTimeSeconds === 'number' ? right.startTimeSeconds : Number.MAX_SAFE_INTEGER

    if (leftStart !== rightStart) {
      return leftStart - rightStart
    }

    return left.id.localeCompare(right.id, undefined, { sensitivity: 'base' })
  })
}

function clampIndex(index) {
  if (registeredSections.length === 0) {
    return -1
  }

  return Math.min(registeredSections.length - 1, Math.max(0, index))
}

function buildActionContext(nextIndex = currentIndex) {
  const resolvedIndex = clampIndex(nextIndex)
  const currentSection = resolvedIndex >= 0 ? registeredSections[resolvedIndex] ?? null : null
  const previousSection = resolvedIndex > 0 ? registeredSections[resolvedIndex - 1] ?? null : null
  const nextSection = resolvedIndex >= 0 && resolvedIndex < registeredSections.length - 1
    ? registeredSections[resolvedIndex + 1] ?? null
    : null

  return {
    currentSection,
    nextSection,
    previousSection,
    sections: [...registeredSections],
    currentIndex: resolvedIndex,
    isPlaying,
  }
}

function emitStateChange() {
  emitter.emit('state', getLyricSectionState())
}

function getLyricSectionState() {
  const resolvedIndex = clampIndex(currentIndex)

  return {
    sections: [...registeredSections],
    currentIndex: resolvedIndex,
    currentSection: resolvedIndex >= 0 ? registeredSections[resolvedIndex] ?? null : null,
    isPlaying,
  }
}

function setCurrentIndex(nextIndex) {
  const resolvedIndex = clampIndex(nextIndex)
  if (resolvedIndex === currentIndex) {
    return false
  }

  currentIndex = resolvedIndex
  emitStateChange()
  return true
}

function setPlaying(nextPlaying) {
  const nextValue = Boolean(nextPlaying)
  if (nextValue === isPlaying) {
    return false
  }

  isPlaying = nextValue
  emitter.emit('playback', isPlaying)
  emitStateChange()
  return true
}

function enqueueAction(actionType) {
  queuedActions.push(actionType)

  if (!queueScheduled) {
    queueScheduled = true
    const delayMs = typeof optionsQueueBatchDelayMs === 'number' && Number.isFinite(optionsQueueBatchDelayMs)
      ? Math.max(0, Math.floor(optionsQueueBatchDelayMs))
      : 0

    if (delayMs > 0) {
      queueTimerId = setTimeout(() => {
        queueTimerId = null
        queueScheduled = false
        void drainQueue()
      }, delayMs)
      return
    }

    queueMicrotask(() => {
      queueScheduled = false
      void drainQueue()
    })
  }
}

let optionsQueueBatchDelayMs = 0

async function runAction(actionType) {
  const context = buildActionContext(currentIndex)

  if (actionType === 'next') {
    const nextIndex = clampIndex(currentIndex < 0 ? 0 : currentIndex + 1)
    if (nextIndex < 0) {
      return
    }

    const handler = registeredActions.nextSection
    if (typeof handler === 'function') {
      await handler({ ...context, currentIndex: nextIndex, currentSection: registeredSections[nextIndex] ?? null })
    }

    setCurrentIndex(nextIndex)
    emitter.emit('section', getLyricSectionState())
    return
  }

  if (actionType === 'previous') {
    const previousIndex = clampIndex(currentIndex <= 0 ? 0 : currentIndex - 1)
    if (previousIndex < 0) {
      return
    }

    const handler = registeredActions.previousSection
    if (typeof handler === 'function') {
      await handler({ ...context, currentIndex: previousIndex, currentSection: registeredSections[previousIndex] ?? null })
    }

    setCurrentIndex(previousIndex)
    emitter.emit('section', getLyricSectionState())
    return
  }

  if (actionType === 'toggle-play-pause') {
    const nextPlaying = !isPlaying
    const handler = registeredActions.togglePlayPause

    if (typeof handler === 'function') {
      await handler({ ...context, isPlaying: nextPlaying })
    }

    setPlaying(nextPlaying)
  }
}

async function drainQueue() {
  while (queuedActions.length > 0) {
    const actionType = queuedActions.shift()
    if (!actionType) {
      continue
    }

    try {
      await runAction(actionType)
    } catch (error) {
      emitter.emit('error', error)
    }
  }
}

export function registerLyricSections(sections = []) {
  const normalized = sections
    .map((section, index) => normalizeSection(section, index))
    .filter(Boolean)

  registeredSections = sortSections(normalized)
  currentIndex = registeredSections.length > 0 ? clampIndex(currentIndex < 0 ? 0 : currentIndex) : -1

  if (registeredSections.length === 0) {
    currentIndex = -1
  }

  emitStateChange()
  return getLyricSectionState()
}

export function restoreLyricSectionNavigatorState(state = {}) {
  const nextSections = Array.isArray(state.sections) ? state.sections : []
  const normalized = nextSections
    .map((section, index) => normalizeSection(section, index))
    .filter(Boolean)

  registeredSections = sortSections(normalized)

  const nextIndex = typeof state.currentIndex === 'number' && Number.isFinite(state.currentIndex)
    ? Math.floor(state.currentIndex)
    : -1

  currentIndex = registeredSections.length > 0 ? clampIndex(nextIndex) : -1
  isPlaying = Boolean(state.isPlaying)

  if (registeredSections.length === 0) {
    currentIndex = -1
  }

  emitStateChange()
  return getLyricSectionState()
}

export function setLyricSectionActions(actions = {}) {
  registeredActions = {
    nextSection: typeof actions.nextSection === 'function' ? actions.nextSection : undefined,
    previousSection: typeof actions.previousSection === 'function' ? actions.previousSection : undefined,
    togglePlayPause: typeof actions.togglePlayPause === 'function' ? actions.togglePlayPause : undefined,
  }

  return registeredActions
}

export function onLyricSectionState(listener) {
  emitter.on('state', listener)
  return () => emitter.off('state', listener)
}

export function onLyricSectionError(listener) {
  emitter.on('error', listener)
  return () => emitter.off('error', listener)
}

export function getRegisteredLyricSections() {
  return [...registeredSections]
}

export function getCurrentLyricSection() {
  const state = getLyricSectionState()
  return state.currentSection
}

export function getLyricSectionNavigatorState() {
  return getLyricSectionState()
}

async function loadMidiInputModule() {
  if (activeMidiModule) {
    return activeMidiModule
  }

  try {
    activeMidiModule = await import('midi')
    return activeMidiModule
  } catch (error) {
    const wrapped = new Error('The optional midi package is not available. Install dependencies on the backend host to enable MIDI input.')
    wrapped.cause = error
    throw wrapped
  }
}

function resolveInputPortIndex(input, options) {
  if (typeof options.inputPortIndex === 'number' && Number.isFinite(options.inputPortIndex)) {
    return Math.max(0, Math.floor(options.inputPortIndex))
  }

  if (typeof options.inputName === 'string' && options.inputName.trim().length > 0) {
    const targetName = options.inputName.trim().toLowerCase()
    const portCount = input.getPortCount()
    for (let index = 0; index < portCount; index += 1) {
      if (String(input.getPortName(index)).toLowerCase() === targetName) {
        return index
      }
    }

    throw new Error(`MIDI input '${options.inputName}' was not found.`)
  }

  return 0
}

function parseMidiNoteMessage(message, options) {
  if (!Array.isArray(message) || message.length < 3) {
    return null
  }

  const status = Number(message[0]) || 0
  const command = status & 0xf0
  if (command !== MIDI_NOTE_ON) {
    return null
  }

  const channel = status & 0x0f
  if (typeof options.channel === 'number' && Number.isFinite(options.channel) && channel !== (options.channel & 0x0f)) {
    return null
  }

  const note = Number(message[1]) || 0
  const velocity = Number(message[2]) || 0
  const velocityThreshold = typeof options.noteVelocityThreshold === 'number' && Number.isFinite(options.noteVelocityThreshold)
    ? Math.max(1, Math.floor(options.noteVelocityThreshold))
    : 1

  if (velocity < velocityThreshold) {
    return null
  }

  if (note === NOTE_NEXT_SECTION) {
    return 'next'
  }

  if (note === NOTE_PREVIOUS_SECTION) {
    return 'previous'
  }

  if (note === NOTE_PLAY_PAUSE) {
    return 'toggle-play-pause'
  }

  return null
}

export async function createMidiLyricSectionListener(options = {}) {
  const midi = await loadMidiInputModule()
  const input = new midi.Input()
  optionsQueueBatchDelayMs = typeof options.queueBatchDelayMs === 'number' && Number.isFinite(options.queueBatchDelayMs)
    ? Math.max(0, Math.floor(options.queueBatchDelayMs))
    : 0
  const listener = {
    isRunning: false,
    start: async () => {
      if (listener.isRunning) {
        return listener
      }

      const portIndex = resolveInputPortIndex(input, options)
      input.ignoreTypes(false, false, false)
      input.openPort(portIndex)
      listener.isRunning = true
      running = true
      emitter.emit('running', true)

      input.on('message', (_deltaTime, message) => {
        const actionType = parseMidiNoteMessage(message, options)
        if (!actionType) {
          return
        }

        enqueueAction(actionType)
      })

      return listener
    },
    stop: async () => {
      if (!listener.isRunning) {
        return listener
      }

      try {
        input.closePort()
      } catch {
        // Ignore close failures during shutdown.
      }

      queuedActions = []
      if (queueTimerId !== null) {
        clearTimeout(queueTimerId)
        queueTimerId = null
      }
      queueScheduled = false
      listener.isRunning = false
      running = false
      emitter.emit('running', false)
      return listener
    },
    getState: getLyricSectionState,
    getSections: getRegisteredLyricSections,
    setActions: setLyricSectionActions,
    onState: onLyricSectionState,
    onError: onLyricSectionError,
  }

  return listener
}

export function isMidiLyricSectionListenerRunning() {
  return running
}
