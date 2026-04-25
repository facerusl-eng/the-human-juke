/*
  Service worker cleanup script.
  This replaces any legacy worker and immediately unregisters itself.
*/

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cacheKeys = await caches.keys()
        await Promise.all(cacheKeys.map((key) => caches.delete(key)))
      } catch {
        // Ignore cache cleanup issues.
      }

      await self.registration.unregister()

      const clientsList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })

      for (const client of clientsList) {
        client.navigate(client.url)
      }
    })(),
  )
})
