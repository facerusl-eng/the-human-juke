/**
 * Centralized save operation handling with consistent error handling, loading states, and feedback.
 * This module provides utilities for safe, validated save operations across the app.
 */

export type SaveResult<T = void> = {
  success: boolean
  data?: T
  error?: string
}

export type SaveOperation<T = void> = () => Promise<T>

/**
 * Options for performing a save operation with consistent error handling
 */
export interface SaveOptions {
  /**
   * Timeout in milliseconds for the save operation (default: 25000ms)
   */
  timeoutMs?: number
  /**
   * Custom error message if operation times out
   */
  timeoutMessage?: string
  /**
   * Whether to throw the error or return it in the result
   */
  throwOnError?: boolean
}

/**
 * Wraps an async save operation with timeout protection
 */
export async function performSaveWithTimeout<T>(
  operation: SaveOperation<T>,
  options: SaveOptions = {},
): Promise<SaveResult<T>> {
  const {
    timeoutMs = 25000,
    timeoutMessage = 'Operation timed out. Please try again.',
    throwOnError = false,
  } = options

  let timeoutId: number | null = null

  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error(timeoutMessage))
      }, timeoutMs)
    })

    const data = await Promise.race([
      Promise.resolve(operation()),
      timeoutPromise,
    ])

    return { success: true, data }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred.'
    if (throwOnError) {
      throw error
    }
    return { success: false, error: errorMessage }
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
    }
  }
}

/**
 * Validates input before save and returns error message if invalid
 */
export function validateSaveInput(
  value: string | null | undefined,
  rules: {
    required?: boolean
    minLength?: number
    maxLength?: number
    pattern?: RegExp
    customValidator?: (val: string) => string | null
  },
): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''

  if (rules.required && !trimmed) {
    return 'This field is required.'
  }

  if (rules.minLength && trimmed.length < rules.minLength) {
    return `Must be at least ${rules.minLength} characters.`
  }

  if (rules.maxLength && trimmed.length > rules.maxLength) {
    return `Must be no more than ${rules.maxLength} characters.`
  }

  if (rules.pattern && !rules.pattern.test(trimmed)) {
    return 'Invalid format.'
  }

  if (rules.customValidator) {
    const customError = rules.customValidator(trimmed)
    if (customError) {
      return customError
    }
  }

  return null
}

/**
 * Prevents double-submit by tracking in-flight operations
 */
export class DoubleSubmitProtection {
  private inFlight: Map<string, boolean> = new Map()

  /**
   * Check if an operation is already in progress
   */
  isInFlight(key: string): boolean {
    return this.inFlight.get(key) ?? false
  }

  /**
   * Mark an operation as in-flight
   */
  markInFlight(key: string): void {
    this.inFlight.set(key, true)
  }

  /**
   * Mark an operation as complete
   */
  markComplete(key: string): void {
    this.inFlight.delete(key)
  }

  /**
   * Clear all in-flight operations
   */
  clear(): void {
    this.inFlight.clear()
  }
}

/**
 * Safely saves to localStorage with error handling
 */
export function saveToLocalStorage(
  key: string,
  value: unknown,
): SaveResult<void> {
  try {
    if (typeof window === 'undefined') {
      return { success: false, error: 'localStorage is not available in this context.' }
    }

    window.localStorage.setItem(key, JSON.stringify(value))
    return { success: true }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to save to local storage.'
    return { success: false, error: errorMessage }
  }
}

/**
 * Safely saves a raw string value to localStorage with error handling.
 */
export function saveTextToLocalStorage(
  key: string,
  value: string,
): SaveResult<void> {
  try {
    if (typeof window === 'undefined') {
      return { success: false, error: 'localStorage is not available in this context.' }
    }

    window.localStorage.setItem(key, value)
    return { success: true }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to save to local storage.'
    return { success: false, error: errorMessage }
  }
}

/**
 * Safely reads from localStorage with error handling
 */
export function readFromLocalStorage<T>(
  key: string,
  fallback?: T,
): T | null | undefined {
  try {
    if (typeof window === 'undefined') {
      return fallback
    }

    const value = window.localStorage.getItem(key)
    if (!value) {
      return fallback
    }

    return JSON.parse(value) as T
  } catch (error) {
    console.warn(`Failed to read from localStorage key "${key}":`, error)
    return fallback
  }
}

/**
 * Safely reads a raw string value from localStorage with error handling.
 */
export function readTextFromLocalStorage(
  key: string,
  fallback: string = '',
): string {
  try {
    if (typeof window === 'undefined') {
      return fallback
    }

    const value = window.localStorage.getItem(key)
    return value ?? fallback
  } catch (error) {
    console.warn(`Failed to read from localStorage key "${key}":`, error)
    return fallback
  }
}

/**
 * Creates a debounced save operation (common pattern for autosave)
 */
export function createDebouncedSave<T>(
  operation: SaveOperation<T>,
  delayMs: number = 2000,
) {
  let timerId: number | null = null

  return {
    /**
     * Trigger a debounced save (cancels previous pending save)
     */
    trigger: (): Promise<SaveResult<T>> => {
      return new Promise((resolve) => {
        if (timerId !== null) {
          window.clearTimeout(timerId)
        }

        timerId = window.setTimeout(async () => {
          timerId = null
          const result = await performSaveWithTimeout(operation)
          resolve(result)
        }, delayMs)
      })
    },

    /**
     * Cancel any pending debounced save
     */
    cancel: (): void => {
      if (timerId !== null) {
        window.clearTimeout(timerId)
        timerId = null
      }
    },

    /**
     * Check if a save is pending
     */
    isPending: (): boolean => {
      return timerId !== null
    },
  }
}
