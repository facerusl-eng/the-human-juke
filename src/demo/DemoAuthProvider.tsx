import type { PropsWithChildren } from 'react'
import { AuthContext } from '../state/authStore'

/**
 * DemoAuthProvider — provides the same AuthContext as AuthProvider but with
 * no real user session. Used when demoMode is active.
 *
 * - isHost is always false (bar-owner preview)
 * - All auth operations are no-ops
 * - loading is immediately false so the UI renders without waiting
 */
export function DemoAuthProvider({ children }: PropsWithChildren) {
  const value = {
    user: null,
    session: null,
    profile: null,
    isHost: false,
    loading: false,
    authError: null,
    signInHost: async () => {
      // No-op in demo mode — login is hidden in the UI
    },
    isPasskeySupported: false,
    signInHostWithPasskey: async () => {
      // No-op in demo mode
    },
    registerHostPasskey: async () => {
      // No-op in demo mode
    },
    refreshProfile: async () => {
      // No-op in demo mode
    },
    signOut: async () => {
      // No-op in demo mode
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
