/* eslint-disable react-refresh/only-export-components */
import './App.css'
import './setlist-library.css'
import './gig-settings.css'
import './admin-settings.css'
import { Suspense, lazy, useEffect } from 'react'
import { Navigate, createBrowserRouter, isRouteErrorResponse, useNavigate, useRouteError, useParams } from 'react-router-dom'
import AppCrashBoundary from './components/AppCrashBoundary'
import RequireHost from './components/RequireHost'
import ShellLayout from './components/ShellLayout'
import { logCrashTelemetry } from './lib/crashTelemetry'
import { AuthProvider } from './state/authStore'
import { QueueProvider } from './state/queueStore'

const AdminPage = lazy(() => import('./pages/AdminPage'))
const CreateGigPage = lazy(() => import('./pages/CreateGigPage'))
const CrashTelemetryPage = lazy(() => import('./pages/CrashTelemetryPage'))
const EventPage = lazy(() => import('./pages/EventPage'))
const AudienceSongListPage = lazy(() => import('./pages/AudienceSongListPage'))
const FeedPage = lazy(() => import('./pages/FeedPage'))
const GigControlPage = lazy(() => import('./pages/GigControlPage'))
const GigSettingsPage = lazy(() => import('./pages/GigSettingsPage'))
const GigsPage = lazy(() => import('./pages/GigsPage'))
const HealthCheckPage = lazy(() => import('./pages/HealthCheckPage'))
const HomePage = lazy(() => import('./pages/HomePage'))
const MirrorPage = lazy(() => import('./pages/MirrorPage'))
const SetlistLibraryPage = lazy(() => import('./pages/SetlistLibraryPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const SpotifyCallbackPage = lazy(() => import('./pages/SpotifyCallbackPage'))

function RouteLoading() {
  return (
    <section className="app-shell page-loading-shell" role="status" aria-live="polite" aria-label="Loading page">
      <section className="queue-panel page-loading-panel">
        <p className="eyebrow">The Human Jukebox</p>
        <div className="loading-skeleton loading-skeleton-title" aria-hidden="true"></div>
        <div className="loading-skeleton loading-skeleton-line" aria-hidden="true"></div>
        <div className="loading-skeleton loading-skeleton-line loading-skeleton-line-short" aria-hidden="true"></div>
      </section>
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

  return (
    <section className="app-shell" aria-label="Page error">
      <section className="queue-panel">
        <p className="eyebrow">Temporary issue</p>
        <h1>We hit a loading error</h1>
        <p className="subcopy">{fallbackMessage}</p>
        <div className="hero-actions no-margin-bottom">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              navigate('/', { replace: true })
            }}
          >
            Go Home
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              navigate(0)
            }}
          >
            Retry
          </button>
        </div>
      </section>
    </section>
  )
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
      <AuthProvider>
        <QueueProvider>
          <ShellLayout />
        </QueueProvider>
      </AuthProvider>,
    ),
    errorElement: <RouteErrorFallback />,
    children: [
      {
        index: true,
        element: withSuspense(<HomePage />),
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
    element: withSuspense(
      withCrashBoundary(
        'Mirror',
        <AuthProvider>
          <QueueProvider>
            <MirrorPage />
          </QueueProvider>
        </AuthProvider>,
      ),
    ),
    errorElement: <RouteErrorFallback />,
  },
])

export default router

