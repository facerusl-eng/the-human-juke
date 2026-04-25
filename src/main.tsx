import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import router from './App.tsx'

function setupBuildUpdateRefresh() {
  if (!import.meta.env.PROD || typeof window === 'undefined') {
    return
  }

  const currentEntryPath = new URL(import.meta.url, window.location.href).pathname
  let checking = false

  const checkForUpdatedBuild = async () => {
    if (checking) {
      return
    }

    checking = true

    try {
      const response = await fetch(`/index.html?build-check=${Date.now()}`, {
        cache: 'no-store',
      })

      if (!response.ok) {
        return
      }

      const html = await response.text()
      const match = html.match(/<script[^>]+src="([^\"]*\/assets\/index-[^\"]+\.js)"/i)

      if (!match?.[1]) {
        return
      }

      const deployedEntryPath = new URL(match[1], window.location.origin).pathname

      if (deployedEntryPath !== currentEntryPath) {
        window.location.reload()
      }
    } catch {
      // Ignore transient network failures and try again on the next trigger.
    } finally {
      checking = false
    }
  }

  const onVisibilityChange = () => {
    if (!document.hidden) {
      void checkForUpdatedBuild()
    }
  }

  window.addEventListener('focus', () => {
    void checkForUpdatedBuild()
  })
  window.addEventListener('online', () => {
    void checkForUpdatedBuild()
  })
  window.addEventListener('pageshow', () => {
    void checkForUpdatedBuild()
  })
  document.addEventListener('visibilitychange', onVisibilityChange)

  window.setInterval(() => {
    if (!document.hidden) {
      void checkForUpdatedBuild()
    }
  }, 60_000)
}

setupBuildUpdateRefresh()

createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />,
)
