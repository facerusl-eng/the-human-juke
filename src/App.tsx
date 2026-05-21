/* eslint-disable react-refresh/only-export-components */
import './App.css'
import './setlist-library.css'
import './gig-settings.css'
import './admin-settings.css'
import './components/ui/ui.css'
import './styles/mirror.css'
import './styles/qr-landing.css'
import { Suspense, lazy, useEffect, useState } from 'react'
import { Navigate, createBrowserRouter, isRouteErrorResponse, useNavigate, useRouteError, useParams } from 'react-router-dom'
import AppCrashBoundary from './components/AppCrashBoundary'
import RequireHost from './components/RequireHost'
import ShellLayout from './components/ShellLayout'
import { logCrashTelemetry } from './lib/crashTelemetry'
import EventPage from './pages/EventPage'
import AudienceSongListPage from './pages/AudienceSongListPage'
import { AuthProvider } from './state/authStore'
import { QueueProvider } from './state/queueStore'
import { demoMode } from './demo/demoMode'
import { DemoAuthProvider } from './demo/DemoAuthProvider'
import { DemoQueueProvider } from './demo/DemoQueueProvider'

const CHUNK_RELOAD_STORAGE_KEY = 'human-jukebox-chunk-reload-attempted'
const ROUTE_LOADING_STARTED_AT_STORAGE_KEY = 'human-jukebox-route-loading-started-at'
const ROUTE_LOADING_RECOVERY_TIMEOUT_MS = 12_000
const ROUTE_IMPORT_TIMEOUT_MS = 18_000

function isChunkLoadFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /chunk|loading css chunk|failed to fetch dynamically imported module|importing a module script failed/i.test(message)
}

function importWithTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  if (typeof window === 'undefined') {
    return promise
  }

  let timeoutId: number | null = null

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error('Route module import timed out.'))
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
    }
  }) as Promise<T>
}

async function importWithChunkReloadRecovery<T>(loader: () => Promise<T>) {
  try {
    const module = await importWithTimeout(loader(), ROUTE_IMPORT_TIMEOUT_MS)

    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY)
      window.sessionStorage.removeItem(ROUTE_LOADING_STARTED_AT_STORAGE_KEY)
    }

    return module
  } catch (error) {
    if (!isChunkLoadFailure(error) || typeof window === 'undefined') {
      throw error
    }

    const alreadyRetried = window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY) === '1'

    if (!alreadyRetried) {
      window.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, '1')
      window.location.reload()
      return new Promise<T>(() => {
        // Keep suspense pending while the page reloads.
      })
    }

    window.sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY)
    throw error
  }
}

function lazyWithChunkReload<T extends { default: React.ComponentType<unknown> }>(loader: () => Promise<T>) {
  return lazy(() => importWithChunkReloadRecovery(loader))
}

const AdminPage = lazyWithChunkReload(() => import('./pages/AdminPage'))
const CreateGigPage = lazyWithChunkReload(() => import('./pages/CreateGigPage'))
const CrashTelemetryPage = lazyWithChunkReload(() => import('./pages/CrashTelemetryPage'))
const ComingGigsPage = lazyWithChunkReload(() => import('./pages/ComingGigsPage'))
const FeedPage = lazyWithChunkReload(() => import('./pages/FeedPage'))
const GigControlPage = lazyWithChunkReload(() => import('./pages/GigControlPage'))
const GigSettingsPage = lazyWithChunkReload(() => import('./pages/GigSettingsPage'))
const GigsPage = lazyWithChunkReload(() => import('./pages/GigsPage'))
const HealthCheckPage = lazyWithChunkReload(() => import('./pages/HealthCheckPage'))
const HomePage = lazyWithChunkReload(() => import('./pages/HomePage'))
const LoungeLinkPage = lazyWithChunkReload(() => import('./pages/LoungeLinkPage'))
const QrLandingPage = lazyWithChunkReload(() => import('./pages/QrLandingPage'))
const ReadinessPage = lazyWithChunkReload(() => import('./pages/ReadinessPage'))
const MirrorPage = lazyWithChunkReload(() => import('./pages/MirrorPage'))
const SetlistLibraryPage = lazyWithChunkReload(() => import('./pages/SetlistLibraryPage'))
const SettingsPage = lazyWithChunkReload(() => import('./pages/SettingsPage'))
const SpotifyCallbackPage = lazyWithChunkReload(() => import('./pages/SpotifyCallbackPage'))

function RouteLoading() {
  const [showRecoveryOptions, setShowRecoveryOptions] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    const storedStartAt = Number(window.sessionStorage.getItem(ROUTE_LOADING_STARTED_AT_STORAGE_KEY) ?? '0')
    return Number.isFinite(storedStartAt) && storedStartAt > 0
      ? Date.now() - storedStartAt >= ROUTE_LOADING_RECOVERY_TIMEOUT_MS
      : false
  })

  useEffect(() => {
    const existingStartAt = Number(window.sessionStorage.getItem(ROUTE_LOADING_STARTED_AT_STORAGE_KEY) ?? '0')
    const routeLoadingStartedAt = Number.isFinite(existingStartAt) && existingStartAt > 0
      ? existingStartAt
      : Date.now()

    if (!(Number.isFinite(existingStartAt) && existingStartAt > 0)) {
      window.sessionStorage.setItem(ROUTE_LOADING_STARTED_AT_STORAGE_KEY, String(routeLoadingStartedAt))
    }

    const elapsedMs = Date.now() - routeLoadingStartedAt
    const remainingMs = Math.max(0, ROUTE_LOADING_RECOVERY_TIMEOUT_MS - elapsedMs)

    const timerId = window.setTimeout(() => {
      setShowRecoveryOptions(true)
    }, remainingMs)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [])

  return (
    <section className="page-logo-loader-shell" role="status" aria-live="polite" aria-label="Loading page">
      <img className="page-logo-loader" src="/the-human-jukebox-logo.png" alt="" width="80" height="80" />
      {showRecoveryOptions ? (
        <section className="queue-panel route-loading-recovery" aria-live="polite">
          <p className="eyebrow">Still loading</p>
          <h2>Page load is taking longer than expected</h2>
          <p className="subcopy">
            This can happen during network hiccups or after a fresh deploy.
          </p>
          <div className="hero-actions no-margin-bottom">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                window.sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY)
                window.sessionStorage.removeItem(ROUTE_LOADING_STARTED_AT_STORAGE_KEY)
                window.location.reload()
              }}
            >
              Retry Loading
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                window.location.assign('/audience')
              }}
            >
              Open Audience
            </button>
          </div>
        </section>
      ) : null}
    </section>
  )
}

function RouteErrorFallback() {
  const navigate = useNavigate()
  const routeError = useRouteError()
  const fallbackMessage = isRouteErrorResponse(routeError)
    ? routeError.statusText || 'This page could not be loaded.'
    : routeError instanceof Error
      ? routeError.message
      : 'This page could not be loaded.'

  useEffect(() => {
    logCrashTelemetry({
      route: typeof window === 'undefined' ? 'route-error' : window.location.pathname,
      error: routeError instanceof Error ? routeError : new Error(fallbackMessage),
      extra: {
        source: 'route-error-fallback',
      },
    })
  }, [fallbackMessage, routeError])

    return <div>Error: {fallbackMessage}</div>
}

function AudienceShortcutRedirect() {
  const { eventId } = useParams<{ eventId: string }>()

  if (!eventId) {
    return <Navigate to="/audience" replace />
  }

  return <Navigate to={`/audience?event=${encodeURIComponent(eventId)}`} replace />
}

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<RouteLoading />}>{element}</Suspense>
}

function withCrashBoundary(areaLabel: string, element: React.ReactNode) {
  return <AppCrashBoundary areaLabel={areaLabel}>{element}</AppCrashBoundary>
}

const router = createBrowserRouter([
  {
    path: '/',
    element: withCrashBoundary(
      'App Shell',
      demoMode
        ? <DemoAuthProvider><DemoQueueProvider><ShellLayout /></DemoQueueProvider></DemoAuthProvider>
        : <AuthProvider><QueueProvider><ShellLayout /></QueueProvider></AuthProvider>,
    ),
    errorElement: <RouteErrorFallback />,
    children: [
      {
        index: true,
        element: withSuspense(<HomePage />),
      },
      {
        path: 'home',
        element: <Navigate to="/" replace />,
      },
      {
        path: 'coming-gigs',
        element: withSuspense(<ComingGigsPage />),
      },
      {
        path: 'audience',
        element: withSuspense(withCrashBoundary('Audience', <EventPage />)),
      },
      {
        path: 'audience/song-list',
        element: withSuspense(withCrashBoundary('Audience', <AudienceSongListPage />)),
      },
      {
        path: 'feed',
        element: withSuspense(withCrashBoundary('Audience', <FeedPage />)),
      },
      {
        path: 'event',
        element: <Navigate to="/audience" replace />,
      },
      {
        path: 'events',
        element: <Navigate to="/audience" replace />,
      },
      {
        path: 'login',
        element: <Navigate to="/admin" replace />,
      },
      {
        path: 'a/:eventId',
        element: <AudienceShortcutRedirect />,
      },
      {
        path: 'callback',
        element: withSuspense(withCrashBoundary('Spotify', <SpotifyCallbackPage />)),
      },
      {
        path: 'admin',
        element: withSuspense(
          withCrashBoundary(
            'Admin',
            <RequireHost>
              <AdminPage />
            </RequireHost>,
          ),
        ),
      },
      {
        path: 'admin/create-gig',
        element: withSuspense(
          withCrashBoundary(
            'Admin',
            <RequireHost>
              <CreateGigPage />
            </RequireHost>,
          ),
        ),
      },
      {
        path: 'admin/gigs',
        element: withSuspense(
          withCrashBoundary(
            'Admin',
            <RequireHost>
              <GigsPage />
            </RequireHost>,
          ),
        ),
      },
      {
        path: 'admin/gig-control',
        element: withSuspense(
          withCrashBoundary(
            'Admin',
            <RequireHost>
              <GigControlPage />
            </RequireHost>,
          ),
        ),
      },
      {
        path: 'admin/gig-settings',
        element: withSuspense(
          withCrashBoundary(
            'Admin',
            <RequireHost>
              <GigSettingsPage />
            </RequireHost>,
          ),
        ),
      },
      {
        path: 'admin/settings',
        element: withSuspense(
          withCrashBoundary(
            'Admin',
            <RequireHost>
              <SettingsPage />
            </RequireHost>,
          ),
        ),
      },
      {
        path: 'admin/health-check',
        element: withSuspense(
          withCrashBoundary(
            'Admin',
            <RequireHost>
              <HealthCheckPage />
            </RequireHost>,
          ),
        ),
      },
      {
        path: 'admin/readiness',
        element: withSuspense(
          withCrashBoundary(
            'Admin',
            <RequireHost>
              <ReadinessPage />
            </RequireHost>,
          ),
        ),
      },
      {
        path: 'admin/crash-telemetry',
        element: withSuspense(
          withCrashBoundary(
            'Admin',
            <RequireHost>
              <CrashTelemetryPage />
            </RequireHost>,
          ),
        ),
      },
      {
        path: 'admin/setlist-library',
        element: withSuspense(
          withCrashBoundary(
            'Admin',
            <RequireHost>
              <SetlistLibraryPage />
            </RequireHost>,
          ),
        ),
      },
      {
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
  },
  {
    path: '/mirror',
    element: withCrashBoundary(
      'Mirror',
      demoMode
        ? <DemoAuthProvider><DemoQueueProvider>{withSuspense(<MirrorPage />)}</DemoQueueProvider></DemoAuthProvider>
        : <AuthProvider><QueueProvider>{withSuspense(<MirrorPage />)}</QueueProvider></AuthProvider>,
    ),
    errorElement: <RouteErrorFallback />,
  },
  {
    path: '/lounge-link',
    element: withCrashBoundary('Lounge Link', withSuspense(<LoungeLinkPage />)),
    errorElement: <RouteErrorFallback />,
  },
  {
    path: '/qr-landing',
    element: withCrashBoundary('QR Landing', withSuspense(<QrLandingPage />)),
    errorElement: <RouteErrorFallback />,
  },
])

export default router

