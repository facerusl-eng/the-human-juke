import { useCallback, useEffect, useRef, useState } from 'react'

type UseClipboardCopyOptions = {
  successDurationMs?: number
}

export function useClipboardCopy(options: UseClipboardCopyOptions = {}) {
  const { successDurationMs = 1400 } = options
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const copiedResetTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copiedResetTimerRef.current !== null) {
        window.clearTimeout(copiedResetTimerRef.current)
      }
    }
  }, [])

  const copyText = useCallback(async (text: string, fallbackErrorMessage: string) => {
    setCopyError(null)

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)

      if (copiedResetTimerRef.current !== null) {
        window.clearTimeout(copiedResetTimerRef.current)
      }

      copiedResetTimerRef.current = window.setTimeout(() => {
        setCopied(false)
        copiedResetTimerRef.current = null
      }, successDurationMs)
      return true
    } catch {
      // Fallback to legacy copy method.
    }

    try {
      const fallbackInput = document.createElement('textarea')
      fallbackInput.value = text
      fallbackInput.setAttribute('readonly', '')
      fallbackInput.style.position = 'fixed'
      fallbackInput.style.left = '-9999px'
      document.body.appendChild(fallbackInput)
      fallbackInput.select()
      const copiedWithFallback = document.execCommand('copy')
      document.body.removeChild(fallbackInput)

      if (!copiedWithFallback) {
        throw new Error('copy-failed')
      }

      setCopied(true)

      if (copiedResetTimerRef.current !== null) {
        window.clearTimeout(copiedResetTimerRef.current)
      }

      copiedResetTimerRef.current = window.setTimeout(() => {
        setCopied(false)
        copiedResetTimerRef.current = null
      }, successDurationMs)
      return true
    } catch {
      setCopyError(fallbackErrorMessage)
      return false
    }
  }, [successDurationMs])

  return {
    copied,
    copyError,
    setCopyError,
    copyText,
  }
}
