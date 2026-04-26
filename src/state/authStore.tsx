import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsWithChildren } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

const ALLOWED_HOST_EMAIL = import.meta.env.VITE_ALLOWED_HOST_EMAIL?.trim().toLowerCase()
const AUTH_REQUEST_TIMEOUT_MS = 12_000
const AUTH_TRANSIENT_RETRY_COUNT = 2

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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: number | null = null

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
    }
  }) as Promise<T>
}

function getErrorText(error: unknown) {
  if (!error) {
    return ''
  }

  if (error instanceof Error) {
    return error.message.toLowerCase()
  }

  return String(error).toLowerCase()
}

function isTransientAuthError(error: unknown) {
  const text = getErrorText(error)

  return text.includes('network')
    || text.includes('fetch')
    || text.includes('timeout')
    || text.includes('temporar')
    || text.includes('rate limit')
    || text.includes('503')
    || text.includes('504')
}

function mapHostSignInError(error: unknown) {
  const text = getErrorText(error)

  if (text.includes('invalid login credentials')) {
    return 'Invalid email or password.'
  }

  if (text.includes('email not confirmed')) {
    return 'Email not confirmed. Open your inbox and click the confirmation link.'
  }

  if (isTransientAuthError(error)) {
    return 'Sign-in is taking too long or network is unstable. Please try again.'
  }

  return error instanceof Error ? error.message : 'Admin sign-in failed.'
}

async function retryTransientAuthOperation<T>(operation: () => Promise<T>, attempts = AUTH_TRANSIENT_RETRY_COUNT) {
  let lastError: unknown = null

  for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error

      const isFinalAttempt = attemptIndex === attempts - 1

      if (!isTransientAuthError(error) || isFinalAttempt) {
        throw error
      }

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 350 * (attemptIndex + 1))
      })
    }
  }

  throw lastError
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
  const isHostSignInInProgressRef = useRef(false)

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
        } catch (error) {
          console.warn('authStore: failed to refresh profile for active session', error)
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
    const { data, error } = await retryTransientAuthOperation(() => withTimeout(
      supabase.auth.signInAnonymously(),
      AUTH_REQUEST_TIMEOUT_MS,
      'Audience sign-in timed out. Retrying...',
    ))

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
          console.warn('authStore: getSession failed', error)
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
          console.warn('authStore: failed to create initial audience session', error)
          setAuthError(error instanceof Error ? error.message : 'Audience sign-in is currently unavailable.')
          await applySessionState(null)
        }
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        console.warn('authStore: unexpected getSession exception', error)

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

      if (isHostSignInInProgressRef.current) {
        return
      }

      try {
        const guestSession = await ensureAudienceSession()
        await applySessionState(guestSession)
      } catch (error) {
        console.warn('authStore: failed to restore audience session after auth change', error)
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
    if (session || user || isHostSignInInProgressRef.current) {
      return
    }

    let isCancelled = false
    let retryTimerId: number | null = null

    const retryEnsureAudienceSession = async () => {
      if (isCancelled) {
        return
      }

      if (isHostSignInInProgressRef.current) {
        return
      }

      try {
        const guestSession = await ensureAudienceSession()

        if (!isCancelled) {
          await applySessionState(guestSession)
        }
      } catch (error) {
        console.warn('authStore: retrying audience session after failure', error)
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

        isHostSignInInProgressRef.current = true

        let signInResult: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>

        try {
          signInResult = await retryTransientAuthOperation(() => withTimeout(
            supabase.auth.signInWithPassword({
              email: normalizedEmail,
              password,
            }),
            AUTH_REQUEST_TIMEOUT_MS,
            'Admin sign-in timed out. Please try again.',
          ))
        } finally {
          isHostSignInInProgressRef.current = false
        }

        if (!signInResult.error) {
          const returnedSession = signInResult.data.session

          if (returnedSession) {
            await applySessionState(returnedSession)
          } else {
            const { data: sessionData } = await supabase.auth.getSession()
            await applySessionState(sessionData.session ?? null)
          }

          return
        }

        const signInErrorMessage = signInResult.error.message.toLowerCase()
        const isInvalidCredentials = signInErrorMessage.includes('invalid login credentials')

        if (!isInvalidCredentials) {
          throw new Error(mapHostSignInError(signInResult.error))
        }

        throw new Error(mapHostSignInError(signInResult.error))
      },
      refreshProfile,
      signOut: async () => {
        const { error } = await supabase.auth.signOut()
        if (error) {
          throw error
        }

        await applySessionState(null)
      },
    }),
    [user, session, profile, loading, authError, refreshProfile, applySessionState],
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
