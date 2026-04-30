const STATIC_CACHE_NAME = 'human-jukebox-static-v6'
const SYNC_DB_NAME = 'human-jukebox-sync-db'
const SYNC_DB_STORE = 'failed-requests'
const SYNC_TAG = 'jukebox-sync'

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/the-human-jukebox-logo.png',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (cacheKeys) => {
      await Promise.all(
        cacheKeys
          .filter((cacheKey) => cacheKey !== STATIC_CACHE_NAME)
          .map((cacheKey) => caches.delete(cacheKey)),
      )

      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable()
      }

      await self.clients.claim()
    }),
  )
})

function isSameOriginStaticAsset(requestUrl) {
  return requestUrl.origin === self.location.origin && (
    requestUrl.pathname.startsWith('/assets/')
    || requestUrl.pathname.startsWith('/icons/')
    || requestUrl.pathname.endsWith('.js')
    || requestUrl.pathname.endsWith('.css')
    || requestUrl.pathname.endsWith('.png')
    || requestUrl.pathname.endsWith('.svg')
    || requestUrl.pathname.endsWith('.jpg')
    || requestUrl.pathname.endsWith('.jpeg')
    || requestUrl.pathname.endsWith('.webp')
  )
}

async function networkFirstNavigation(event) {
  const cache = await caches.open(STATIC_CACHE_NAME)
  const cachedShell = await cache.match('/index.html')

  const networkPromise = (async () => {
    const preloadResponse = await event.preloadResponse

    if (preloadResponse) {
      await cache.put('/index.html', preloadResponse.clone())
      return preloadResponse
    }

    const networkShell = await fetch('/index.html', { cache: 'no-store' })
    if (networkShell?.ok) {
      await cache.put('/index.html', networkShell.clone())
    }
    return networkShell
  })().catch(() => null)

  const networkShell = await networkPromise
  if (networkShell) {
    return networkShell
  }

  if (cachedShell) {
    return cachedShell
  }

  return new Response('Offline', { status: 503 })
}

async function staleWhileRevalidateAsset(request) {
  const cache = await caches.open(STATIC_CACHE_NAME)
  const cachedResponse = await cache.match(request)

  const networkPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.ok) {
        cache.put(request, networkResponse.clone())
      }

      return networkResponse
    })
    .catch(() => null)

  if (cachedResponse) {
    void networkPromise
    return cachedResponse
  }

  const networkResponse = await networkPromise
  if (networkResponse) {
    return networkResponse
  }

  if (cachedResponse) {
    return cachedResponse
  }

  return new Response('Asset unavailable', { status: 504 })
}

function openSyncDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SYNC_DB_NAME, 1)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SYNC_DB_STORE)) {
        db.createObjectStore(SYNC_DB_STORE, { keyPath: 'id', autoIncrement: true })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function queueFailedRequest(request) {
  const requestClone = request.clone()
  const bodyText = ['GET', 'HEAD'].includes(requestClone.method) ? null : await requestClone.text().catch(() => null)
  const headers = {}

  requestClone.headers.forEach((value, key) => {
    headers[key] = value
  })

  const db = await openSyncDb()

  await new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_DB_STORE, 'readwrite')
    const store = tx.objectStore(SYNC_DB_STORE)

    store.add({
      url: requestClone.url,
      method: requestClone.method,
      headers,
      bodyText,
      mode: requestClone.mode,
      credentials: requestClone.credentials,
      cache: requestClone.cache,
      redirect: requestClone.redirect,
      referrer: requestClone.referrer,
      referrerPolicy: requestClone.referrerPolicy,
      createdAt: Date.now(),
    })

    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })

  try {
    if (self.registration.sync) {
      await self.registration.sync.register(SYNC_TAG)
    }
  } catch {
    // Some browsers do not support sync registration from the service worker context.
  }
}

async function readQueuedRequests() {
  const db = await openSyncDb()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_DB_STORE, 'readonly')
    const store = tx.objectStore(SYNC_DB_STORE)
    const request = store.getAll()

    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error)
  })
}

async function removeQueuedRequest(id) {
  const db = await openSyncDb()

  await new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_DB_STORE, 'readwrite')
    tx.objectStore(SYNC_DB_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function replayQueuedRequests() {
  const queuedRequests = await readQueuedRequests()

  for (const queuedRequest of queuedRequests) {
    const headers = new Headers(queuedRequest.headers || {})

    try {
      const response = await fetch(queuedRequest.url, {
        method: queuedRequest.method,
        headers,
        body: queuedRequest.bodyText,
        mode: queuedRequest.mode,
        credentials: queuedRequest.credentials,
        cache: queuedRequest.cache,
        redirect: queuedRequest.redirect,
        referrer: queuedRequest.referrer,
        referrerPolicy: queuedRequest.referrerPolicy,
      })

      if (response.ok) {
        await removeQueuedRequest(queuedRequest.id)
      }
    } catch {
      // Keep queued request for next sync retry.
    }
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(replayQueuedRequests())
  }
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const requestUrl = new URL(request.url)

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event))
    return
  }

  if (request.method === 'GET' && isSameOriginStaticAsset(requestUrl)) {
    event.respondWith(staleWhileRevalidateAsset(request))
    return
  }

  event.respondWith((async () => {
    try {
      return await fetch(request)
    } catch {
      await queueFailedRequest(request)

      return new Response(JSON.stringify({ queued: true, reason: 'offline' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  })())
})

self.addEventListener('push', (_event) => {
  // Placeholder for future push notification behavior.
})
