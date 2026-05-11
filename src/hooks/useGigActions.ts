import { useCallback, useMemo, useRef, useState } from 'react'
import { registerBackgroundSync } from '../lib/backgroundSync'

type UseGigActionsOptions = {
  setActiveEvent?: (nextEventId: string) => Promise<void>
  toggleRoomOpen?: () => Promise<void>
  toggleExplicitFilter?: () => Promise<void>
  setErrorText?: (message: string | null) => void
  errors?: {
    setActiveEvent?: string
    toggleRoomOpen?: string
    toggleExplicitFilter?: string
  }
}

function resolveErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return fallbackMessage
}

export function useGigActions(options: UseGigActionsOptions) {
  const {
    setActiveEvent,
    toggleRoomOpen,
    toggleExplicitFilter,
    setErrorText,
    errors,
  } = options

  const [activatingEventId, setActivatingEventId] = useState<string | null>(null)
  const [roomToggleBusy, setRoomToggleBusy] = useState(false)
  const [explicitToggleBusy, setExplicitToggleBusy] = useState(false)
  const switchActiveGigLockRef = useRef(false)
  const roomToggleLockRef = useRef(false)
  const explicitToggleLockRef = useRef(false)

  const quickActionBusy = useMemo(
    () => roomToggleBusy || explicitToggleBusy,
    [roomToggleBusy, explicitToggleBusy],
  )

  const switchActiveGig = useCallback(async (nextEventId: string) => {
    if (!setActiveEvent || activatingEventId || switchActiveGigLockRef.current) {
      return false
    }

    switchActiveGigLockRef.current = true
    setErrorText?.(null)
    setActivatingEventId(nextEventId)

    try {
      await setActiveEvent(nextEventId)
      await registerBackgroundSync('jukebox-sync')
      return true
    } catch (error) {
      setErrorText?.(
        resolveErrorMessage(error, errors?.setActiveEvent ?? 'Failed to switch gig. Please try again.'),
      )
      return false
    } finally {
      switchActiveGigLockRef.current = false
      setActivatingEventId(null)
    }
  }, [setActiveEvent, activatingEventId, setErrorText, errors?.setActiveEvent])

  const runToggleRoomOpen = useCallback(async () => {
    if (!toggleRoomOpen || quickActionBusy || roomToggleLockRef.current) {
      return false
    }

    roomToggleLockRef.current = true
    setErrorText?.(null)
    setRoomToggleBusy(true)

    try {
      await toggleRoomOpen()
      await registerBackgroundSync('jukebox-sync')
      return true
    } catch (error) {
      setErrorText?.(
        resolveErrorMessage(error, errors?.toggleRoomOpen ?? 'Could not update room status. Please try again.'),
      )
      return false
    } finally {
      roomToggleLockRef.current = false
      setRoomToggleBusy(false)
    }
  }, [toggleRoomOpen, quickActionBusy, setErrorText, errors?.toggleRoomOpen])

  const runToggleExplicitFilter = useCallback(async () => {
    if (!toggleExplicitFilter || quickActionBusy || explicitToggleLockRef.current) {
      return false
    }

    explicitToggleLockRef.current = true
    setErrorText?.(null)
    setExplicitToggleBusy(true)

    try {
      await toggleExplicitFilter()
      await registerBackgroundSync('jukebox-sync')
      return true
    } catch (error) {
      setErrorText?.(
        resolveErrorMessage(
          error,
          errors?.toggleExplicitFilter ?? 'Could not update explicit filter. Please try again.',
        ),
      )
      return false
    } finally {
      explicitToggleLockRef.current = false
      setExplicitToggleBusy(false)
    }
  }, [toggleExplicitFilter, quickActionBusy, setErrorText, errors?.toggleExplicitFilter])

  return {
    activatingEventId,
    roomToggleBusy,
    explicitToggleBusy,
    quickActionBusy,
    switchActiveGig,
    runToggleRoomOpen,
    runToggleExplicitFilter,
  }
}
