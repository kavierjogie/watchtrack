// Loaded into the generated service worker (vite.config.ts → workbox.importScripts).
// Clicking a WatchTrack alert focuses an open window and asks it to show the title, or opens a new one there.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = event.notification.data && event.notification.data.url
  // Only our own pages: the data comes from the app, but never follow anything else.
  const url = typeof path === 'string' && /^\/(title\/[^/?#]+|notifications|upcoming)$/.test(path) ? path : '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin)
      if (!win) return self.clients.openWindow(url)
      win.postMessage({ type: 'watchtrack:open', url })
      return win.focus()
    }),
  )
})
