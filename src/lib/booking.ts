const DEFAULT_BOOKING_MANAGER_URL = 'https://book-jukebox.base44.app/'

export function getBookingManagerUrl() {
  return import.meta.env.VITE_BOOKING_URL?.trim() || DEFAULT_BOOKING_MANAGER_URL
}
