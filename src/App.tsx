import './App.css'
import { Suspense, lazy } from 'react'
import { Navigate, createBrowserRouter, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import RequireHost from './components/RequireHost'
import ShellLayout from './components/ShellLayout'
import { AuthProvider } from './state/authStore'
import { QueueProvider } from './state/queueStore'

const AdminPage = lazy(() => import('./pages/AdminPage'))
const CreateGigPage = lazy(() => import('./pages/CreateGigPage'))
const EventPage = lazy(() => import('./pages/EventPage'))
const FeedPage = lazy(() => import('./pages/FeedPage'))
const GigControlPage = lazy(() => import('./pages/GigControlPage'))
const GigSettingsPage = lazy(() => import('./pages/GigSettingsPage'))
const HomePage = lazy(() => import('./pages/HomePage'))
const MirrorPage = lazy(() => import('./pages/MirrorPage'))
const SetlistLibraryPage = lazy(() => import('./pages/SetlistLibraryPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function RouteLoading() {
  return (
    <div className="app-shell" role="status" aria-live="polite">
      <p>Loading page...</p>
    </div>
  )
}

function RouteErrorFallback() {
  const routeError = useRouteError()
  const fallbackMessage = isRouteErrorResponse(routeError)
    ? routeError.statusText || 'This page could not be loaded.'
    : routeError instanceof Error
      ? routeError.message
      : 'This page could not be loaded.'

  return (
    <section className="app-shell" aria-label="Page error">
      <section className="queue-panel">
        <p className="eyebrow">Temporary issue</p>
        <h1>We hit a loading error</h1>
        <p className="subcopy">{fallbackMessage}</p>
        <div className="hero-actions no-margin-bottom">
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              window.location.reload()
            }}
          >
            Retry
          </button>
        </div>
      </section>
    </section>
  )
}

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<RouteLoading />}>{element}</Suspense>
}

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <AuthProvider>
        <QueueProvider>
          <ShellLayout />
        </QueueProvider>
      </AuthProvider>
    ),
    errorElement: <RouteErrorFallback />,
    children: [
      {
        index: true,
        element: withSuspense(<HomePage />),
      },
      {
        path: 'audience',
        element: withSuspense(<EventPage />),
      },
      {
        path: 'feed',
        element: withSuspense(<FeedPage />),
      },
      {
        path: 'event',
        element: <Navigate to="/audience" replace />,
      },
      {
        path: 'admin',
        element: withSuspense(
          <RequireHost>
            <AdminPage />
          </RequireHost>,
        ),
      },
      {
        path: 'admin/create-gig',
        element: withSuspense(
          <RequireHost>
            <CreateGigPage />
          </RequireHost>,
        ),
      },
      {
        path: 'admin/gig-control',
        element: withSuspense(
          <RequireHost>
            <GigControlPage />
          </RequireHost>,
        ),
      },
      {
        path: 'admin/gig-settings',
        element: withSuspense(
          <RequireHost>
            <GigSettingsPage />
          </RequireHost>,
        ),
      },
      {
        path: 'admin/settings',
        element: withSuspense(
          <RequireHost>
            <SettingsPage />
          </RequireHost>,
        ),
      },
      {
        path: 'admin/setlist-library',
        element: withSuspense(
          <RequireHost>
            <SetlistLibraryPage />
          </RequireHost>,
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
      <AuthProvider>
        <QueueProvider>
          <MirrorPage />
        </QueueProvider>
      </AuthProvider>,
    ),
    errorElement: <RouteErrorFallback />,
  },
])

export default router

