import './App.css'
import { Navigate, createBrowserRouter } from 'react-router-dom'
import RequireHost from './components/RequireHost'
import ShellLayout from './components/ShellLayout'
import AdminPage from './pages/AdminPage'
import CreateGigPage from './pages/CreateGigPage'
import EventPage from './pages/EventPage'
import FeedPage from './pages/FeedPage'
import GigControlPage from './pages/GigControlPage'
import GigSettingsPage from './pages/GigSettingsPage'
import HomePage from './pages/HomePage'
import MirrorPage from './pages/MirrorPage'
import SetlistLibraryPage from './pages/SetlistLibraryPage'
import SettingsPage from './pages/SettingsPage'
import { AuthProvider } from './state/authStore'
import { QueueProvider } from './state/queueStore'

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
        element: <HomePage />,
      },
      {
        path: 'audience',
        element: <EventPage />,
      },
      {
        path: 'feed',
        element: <FeedPage />,
      },
      {
        path: 'event',
        element: <Navigate to="/audience" replace />,
      },
      {
        path: 'admin',
        element: (
          <RequireHost>
            <AdminPage />
          </RequireHost>
        ),
      },
      {
        path: 'admin/create-gig',
        element: (
          <RequireHost>
            <CreateGigPage />
          </RequireHost>
        ),
      },
      {
        path: 'admin/gig-control',
        element: (
          <RequireHost>
            <GigControlPage />
          </RequireHost>
        ),
      },
      {
        path: 'admin/gig-settings',
        element: (
          <RequireHost>
            <GigSettingsPage />
          </RequireHost>
        ),
      },
      {
        path: 'admin/settings',
        element: (
          <RequireHost>
            <SettingsPage />
          </RequireHost>
        ),
      },
      {
        path: 'admin/setlist-library',
        element: (
          <RequireHost>
            <SetlistLibraryPage />
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
          <MirrorPage />
        </QueueProvider>
      </AuthProvider>
    ),
  },
])

export default router

