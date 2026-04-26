import { useCallback, useMemo, useState } from 'react'

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

  const quickActionBusy = useMemo(
    () => roomToggleBusy || explicitToggleBusy,
    [roomToggleBusy, explicitToggleBusy],
  )

  const switchActiveGig = useCallback(async (nextEventId: string) => {
    if (!setActiveEvent || activatingEventId) {
      return false
    }

    setErrorText?.(null)
    setActivatingEventId(nextEventId)

    try {
      await setActiveEvent(nextEventId)
      return true
    } catch (error) {
      setErrorText?.(
        resolveErrorMessage(error, errors?.setActiveEvent ?? 'Failed to switch gig. Please try again.'),
      )
      return false
    } finally {
      setActivatingEventId(null)
    }
  }, [setActiveEvent, activatingEventId, setErrorText, errors?.setActiveEvent])

  const runToggleRoomOpen = useCallback(async () => {
    if (!toggleRoomOpen || quickActionBusy) {
      return false
    }

    setErrorText?.(null)
    setRoomToggleBusy(true)

    try {
      await toggleRoomOpen()
      return true
    } catch (error) {
      setErrorText?.(
        resolveErrorMessage(error, errors?.toggleRoomOpen ?? 'Could not update room status. Please try again.'),
      )
      return false
    } finally {
      setRoomToggleBusy(false)
    }
  }, [toggleRoomOpen, quickActionBusy, setErrorText, errors?.toggleRoomOpen])

  const runToggleExplicitFilter = useCallback(async () => {
    if (!toggleExplicitFilter || quickActionBusy) {
      return false
    }

    setErrorText?.(null)
    setExplicitToggleBusy(true)

    try {
      await toggleExplicitFilter()
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
