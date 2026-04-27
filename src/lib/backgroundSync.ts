const DEFAULT_SYNC_TAG = 'jukebox-sync'

export async function registerBackgroundSync(tag: string = DEFAULT_SYNC_TAG): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false
  }

  try {
    const registration = await navigator.serviceWorker.ready

    if (!('sync' in registration)) {
      return false
    }

    const syncRegistration = registration as ServiceWorkerRegistration & {
      sync: { register: (syncTag: string) => Promise<void> }
    }

    await syncRegistration.sync.register(tag)
    return true
  } catch (error) {
    console.warn('registerBackgroundSync: unable to register background sync', error)
    return false
  }
}
