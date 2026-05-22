import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchAppDataset } from '../data/mockApi'
import type { AppDataset } from '../types/domain'

type AppDataContextValue = {
  data: AppDataset | null
  isLoading: boolean
  errorMessage: string | null
  refresh: () => Promise<void>
}

const AppDataContext = createContext<AppDataContextValue | null>(null)

type AppDataProviderProps = {
  children: ReactNode
}

export function AppDataProvider({ children }: AppDataProviderProps) {
  const [data, setData] = useState<AppDataset | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const dataset = await fetchAppDataset()
      setData(dataset)
    } catch {
      setErrorMessage('Could not load app dataset. Try again.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<AppDataContextValue>(() => {
    return {
      data,
      isLoading,
      errorMessage,
      refresh,
    }
  }, [data, errorMessage, isLoading, refresh])

  return (
    <AppDataContext.Provider value={value}>
      {children}
    </AppDataContext.Provider>
  )
}

export function useAppData() {
  const context = useContext(AppDataContext)

  if (!context) {
    throw new Error('useAppData must be used within AppDataProvider.')
  }

  return context
}
