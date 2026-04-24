import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { PropsWithChildren } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

const ALLOWED_HOST_EMAIL = import.meta.env.VITE_ALLOWED_HOST_EMAIL?.trim().toLowerCase()

type Role = 'guest' | 'host'

type Profile = {
  role: Role
  active_event_id: string | null
}

type AuthContextValue = {
  user: User | null
  session: Session | null
  profile: Profile | null
  isHost: boolean
  loading: boolean
  authError: string | null
  signInHost: (email: string, password: string) => Promise<void>
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function isAllowedHostEmail(email: string | null | undefined) {
  if (!ALLOWED_HOST_EMAIL || !email) {
    return false
  }

  return email.trim().toLowerCase() === ALLOWED_HOST_EMAIL
}

async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('role, active_event_id')
    .eq('user_id', userId)
    .single()

  if (error) {
    throw error
  }

  return data as Profile
}

function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)

  const syncAllowedHostRole = useCallback(
    async (currentUser: User, currentProfile: Profile | null) => {
      if (!isAllowedHostEmail(currentUser.email) || currentProfile?.role === 'host') {
        return currentProfile
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ role: 'host' })
        .eq('user_id', currentUser.id)

      if (updateError) {
        throw updateError
      }

      return getProfile(currentUser.id)
    },
    [],
  )

  const refreshProfile = useCallback(async () => {
    if (!user) {
      setProfile(null)
      return
    }

    const nextProfile = await getProfile(user.id)
    setProfile(nextProfile)
  }, [user])

  const applySessionState = useCallback(
    async (nextSession: Session | null) => {
      setSession(nextSession)
      setUser(nextSession?.user ?? null)

      if (nextSession?.user) {
        setAuthError(null)
      }

      if (nextSession?.user) {
        try {
          const loadedProfile = await getProfile(nextSession.user.id)
          const nextProfile = await syncAllowedHostRole(nextSession.user, loadedProfile)
          setProfile(nextProfile)
        } catch {
          // Keep the current profile when profile reload fails.
        }
      } else {
        setProfile(null)
      }

      setLoading(false)
    },
    [syncAllowedHostRole],
  )

  const ensureAudienceSession = useCallback(async () => {
    const { data, error } = await supabase.auth.signInAnonymously()

    if (error) {
      if (error.message.toLowerCase().includes('anonymous sign-ins are disabled')) {
        throw new Error('Audience guest sign-in is disabled in Supabase. Enable Authentication > Providers > Anonymous to let phones join live.')
      }

      throw error
    }

    return data.session ?? null
  }, [])

  useEffect(() => {
    let isMounted = true

    const loadingFallback = window.setTimeout(() => {
      if (isMounted) {
        setLoading(false)
      }
    }, 4000)

    void supabase.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (!isMounted) {
          return
        }

        if (error) {
          setSession(null)
          setUser(null)
          setProfile(null)
          setLoading(false)
          return
        }

        const currentSession = data.session ?? null

        if (currentSession) {
          await applySessionState(currentSession)
          return
        }

        try {
          const guestSession = await ensureAudienceSession()
          await applySessionState(guestSession)
        } catch (error) {
          setAuthError(error instanceof Error ? error.message : 'Audience sign-in is currently unavailable.')
          await applySessionState(null)
        }
      })
      .catch(() => {
        if (!isMounted) {
          return
        }

        setSession(null)
        setUser(null)
        setProfile(null)
        setLoading(false)
      })

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!isMounted) {
        return
      }

      if (nextSession) {
        await applySessionState(nextSession)
        return
      }

      try {
        const guestSession = await ensureAudienceSession()
        await applySessionState(guestSession)
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'Audience sign-in is currently unavailable.')
        await applySessionState(null)
      }
    })

    return () => {
      isMounted = false
      window.clearTimeout(loadingFallback)
      authListener.subscription.unsubscribe()
    }
  }, [applySessionState, ensureAudienceSession])

  useEffect(() => {
    if (session || user) {
      return
    }

    let isCancelled = false
    let retryTimerId: number | null = null

    const retryEnsureAudienceSession = async () => {
      if (isCancelled) {
        return
      }

      try {
        const guestSession = await ensureAudienceSession()

        if (!isCancelled) {
          await applySessionState(guestSession)
        }
      } catch (error) {
        if (!isCancelled) {
          setAuthError(error instanceof Error ? error.message : 'Audience sign-in is currently unavailable.')
        }

        if (!isCancelled) {
          retryTimerId = window.setTimeout(() => {
            void retryEnsureAudienceSession()
          }, 3000)
        }
      }
    }

    retryTimerId = window.setTimeout(() => {
      void retryEnsureAudienceSession()
    }, 1200)

    return () => {
      isCancelled = true

      if (retryTimerId !== null) {
        window.clearTimeout(retryTimerId)
      }
    }
  }, [session, user, ensureAudienceSession, applySessionState])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      profile,
      isHost: profile?.role === 'host',
      loading,
      authError,
      signInHost: async (email: string, password: string) => {
        const normalizedEmail = email.trim().toLowerCase()

        if (ALLOWED_HOST_EMAIL && normalizedEmail !== ALLOWED_HOST_EMAIL) {
          throw new Error('Use the configured host email for this project.')
        }

        const {
          data: { session: existingSession },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (sessionError) {
          throw sessionError
        }

        if (existingSession?.user?.is_anonymous) {
          const { error: signOutError } = await supabase.auth.signOut()
          if (signOutError) {
            throw signOutError
          }
        }

        const signInResult = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        })

        if (!signInResult.error) {
          return
        }

        const signInErrorMessage = signInResult.error.message.toLowerCase()
        const isInvalidCredentials = signInErrorMessage.includes('invalid login credentials')

        if (!isInvalidCredentials) {
          if (signInErrorMessage.includes('email not confirmed')) {
            throw new Error('Email not confirmed. Open your inbox and click the confirmation link.')
          }

          throw signInResult.error
        }

        const signUpResult = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
        })

        if (signUpResult.error) {
          throw signUpResult.error
        }

        if (!signUpResult.data.session) {
          throw new Error('Account created. Check your email inbox and confirm before signing in.')
        }
      },
      refreshProfile,
      signOut: async () => {
        const { error } = await supabase.auth.signOut()
        if (error) {
          throw error
        }
      },
    }),
    [user, session, profile, loading, authError, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function useAuthStore() {
  const contextValue = useContext(AuthContext)

  if (!contextValue) {
    throw new Error('useAuthStore must be used within an AuthProvider')
  }

  return contextValue
}

export { AuthProvider, useAuthStore }
