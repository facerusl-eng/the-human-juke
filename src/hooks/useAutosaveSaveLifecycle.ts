import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveLifecycleStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error'

type UseAutosaveSaveLifecycleOptions = {
  autosaveDelayMs?: number
  savedResetDelayMs?: number
}

export function useAutosaveSaveLifecycle(options: UseAutosaveSaveLifecycleOptions = {}) {
  const {
    autosaveDelayMs = 2000,
    savedResetDelayMs = 2000,
  } = options

  const [saveStatus, setSaveStatus] = useState<SaveLifecycleStatus>('idle')
  const autosaveTimerRef = useRef<number | null>(null)
  const savedResetTimerRef = useRef<number | null>(null)

  const cancelSavedReset = useCallback(() => {
    if (savedResetTimerRef.current !== null) {
      window.clearTimeout(savedResetTimerRef.current)
      savedResetTimerRef.current = null
    }
  }, [])

  const cancelAutosave = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      cancelAutosave()
      cancelSavedReset()
    }
  }, [cancelAutosave, cancelSavedReset])

  const markUnsaved = useCallback(() => {
    cancelSavedReset()
    setSaveStatus('unsaved')
  }, [cancelSavedReset])

  const markSaving = useCallback(() => {
    cancelSavedReset()
    setSaveStatus('saving')
  }, [cancelSavedReset])

  const markSaved = useCallback((resetDelayMs = savedResetDelayMs) => {
    cancelSavedReset()
    setSaveStatus('saved')
    savedResetTimerRef.current = window.setTimeout(() => {
      setSaveStatus('idle')
      savedResetTimerRef.current = null
    }, resetDelayMs)
  }, [cancelSavedReset, savedResetDelayMs])

  const markError = useCallback(() => {
    cancelSavedReset()
    setSaveStatus('error')
  }, [cancelSavedReset])

  const scheduleAutosave = useCallback((operation: () => Promise<void>) => {
    cancelAutosave()
    markSaving()
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null
      void operation()
    }, autosaveDelayMs)
  }, [autosaveDelayMs, cancelAutosave, markSaving])

  return {
    saveStatus,
    setSaveStatus,
    cancelAutosave,
    markUnsaved,
    markSaving,
    markSaved,
    markError,
    scheduleAutosave,
  }
}
