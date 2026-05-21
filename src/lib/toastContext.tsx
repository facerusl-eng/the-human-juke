/* eslint-disable react-refresh/only-export-components */
/**
 * Toast notification system for user feedback on save operations
 */

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: string
  message: string
  type: ToastType
  duration?: number // milliseconds, 0 = never auto-dismiss
}

export interface ToastContextValue {
  toasts: Toast[]
  showToast: (message: string, type?: ToastType, duration?: number) => string
  showSuccess: (message: string, duration?: number) => string
  showError: (message: string, duration?: number) => string
  showInfo: (message: string, duration?: number) => string
  showWarning: (message: string, duration?: number) => string
  dismissToast: (id: string) => void
  dismissAll: () => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toastTimeoutsRef = useRef<Map<string, number>>(new Map())

  const generateId = useCallback(() => `toast-${Date.now()}-${Math.random()}`, [])

  const dismissToast = useCallback((id: string) => {
    const timeoutId = toastTimeoutsRef.current.get(id)
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId)
      toastTimeoutsRef.current.delete(id)
    }
    setToasts((current: Toast[]) => current.filter((t: Toast) => t.id !== id))
  }, [])

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration: number = 4000) => {
      const id = generateId()
      const toast: Toast = { id, message, type, duration }

      setToasts((current: Toast[]) => [...current, toast])

      if (duration > 0) {
        const timeoutId = window.setTimeout(() => {
          dismissToast(id)
        }, duration)
        toastTimeoutsRef.current.set(id, timeoutId)
      }

      return id
    },
    [generateId, dismissToast],
  )

  const showSuccess = useCallback(
    (message: string, duration?: number) => showToast(message, 'success', duration),
    [showToast],
  )

  const showError = useCallback(
    (message: string, duration?: number) => showToast(message, 'error', duration ?? 6000),
    [showToast],
  )

  const showInfo = useCallback(
    (message: string, duration?: number) => showToast(message, 'info', duration),
    [showToast],
  )

  const showWarning = useCallback(
    (message: string, duration?: number) => showToast(message, 'warning', duration),
    [showToast],
  )

  const dismissAll = useCallback(() => {
    toastTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    toastTimeoutsRef.current.clear()
    setToasts([])
  }, [])

  const value: ToastContextValue = {
    toasts,
    showToast,
    showSuccess,
    showError,
    showInfo,
    showWarning,
    dismissToast,
    dismissAll,
  }

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
