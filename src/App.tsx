import './App.css'
import { Suspense, lazy } from 'react'
import type { ReactNode } from 'react'
import { Navigate, createBrowserRouter } from 'react-router-dom'
import RequireHost from './components/RequireHost'
import ShellLayout from './components/ShellLayout'
import { AuthProvider } from './state/authStore'
import { QueueProvider } from './state/queueStore'

const HomePage = lazy(() => import('./pages/HomePage'))
const EventPage = lazy(() => import('./pages/EventPage'))
const FeedPage = lazy(() => import('./pages/FeedPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const CreateGigPage = lazy(() => import('./pages/CreateGigPage'))
const GigsPage = lazy(() => import('./pages/GigsPage'))
const GigControlPage = lazy(() => import('./pages/GigControlPage'))
const GigSettingsPage = lazy(() => import('./pages/GigSettingsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const SetlistLibraryPage = lazy(() => import('./pages/SetlistLibraryPage'))
const MirrorPage = lazy(() => import('./pages/MirrorPage'))

function RouteFallback() {
  return (
    <section className="admin-shell" aria-label="Loading page">
      <section className="queue-panel">Loading...</section>
    </section>
  )
}

function LazyRoute({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<RouteFallback />}>
      {children}
    </Suspense>
  )
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
    children: [
      {
        index: true,
        element: (
          <LazyRoute>
            <HomePage />
          </LazyRoute>
        ),
      },
      {
        path: 'audience',
        element: (
          <LazyRoute>
            <EventPage />
          </LazyRoute>
        ),
      },
      {
        path: 'feed',
        element: (
          <LazyRoute>
            <FeedPage />
          </LazyRoute>
        ),
      },
      {
        path: 'event',
        element: <Navigate to="/audience" replace />,
      },
      {
        path: 'admin',
        element: (
          <RequireHost>
            <LazyRoute>
              <AdminPage />
            </LazyRoute>
          </RequireHost>
        ),
      },
      {
        path: 'admin/create-gig',
        element: (
          <RequireHost>
            <LazyRoute>
              <CreateGigPage />
            </LazyRoute>
          </RequireHost>
        ),
      },
      {
        path: 'admin/gigs',
        element: (
          <RequireHost>
            <LazyRoute>
              <GigsPage />
            </LazyRoute>
          </RequireHost>
        ),
      },
      {
        path: 'admin/gig-control',
        element: (
          <RequireHost>
            <LazyRoute>
              <GigControlPage />
            </LazyRoute>
          </RequireHost>
        ),
      },
      {
        path: 'admin/gig-settings',
        element: (
          <RequireHost>
            <LazyRoute>
              <GigSettingsPage />
            </LazyRoute>
          </RequireHost>
        ),
      },
      {
        path: 'admin/settings',
        element: (
          <RequireHost>
            <LazyRoute>
              <SettingsPage />
            </LazyRoute>
          </RequireHost>
        ),
      },
      {
        path: 'admin/setlist-library',
        element: (
          <RequireHost>
            <LazyRoute>
              <SetlistLibraryPage />
            </LazyRoute>
          </RequireHost>
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
    element: (
      <AuthProvider>
        <QueueProvider>
          <LazyRoute>
            <MirrorPage />
          </LazyRoute>
        </QueueProvider>
      </AuthProvider>
    ),
  },
])

export default router

