/// <reference lib="webworker" />
// The service worker (vite.config.ts → injectManifest). App shell and poster caching, alert clicks and background checks.
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { BACKGROUND_CHECK_TAG, notifyAlerts, recordAlerts } from './lib/alerts'
import { normalizeTitle } from './lib/backup'
import { listTitles, updateTitle } from './lib/db'
import { readMirroredPrefs } from './lib/prefs'
import { foundEvents, syncLibrary } from './lib/sync'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] }

void self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()

// App shell only. Personal data stays in IndexedDB, never in the SW cache.
precacheAndRoute(self.__WB_MANIFEST)
// Static public pages are real HTML files (precached), not app routes.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/about/, /^\/guides/, /^\/privacy/, /^\/terms/] }))

// Public poster artwork from metadata providers, so saved titles show posters offline.
// Fetched with CORS: browsers count each opaque (no-CORS) response as about 7 MB, which made 600 posters look like 4 GB.
// Kitsu doesn't send CORS headers, so its images aren't cached here; api/poster.ts lets titles save a copy instead.
registerRoute(
  ({ url }) => ['static.tvmaze.com', 'image.tmdb.org'].includes(url.hostname),
  new CacheFirst({
    cacheName: 'poster-art',
    fetchOptions: { mode: 'cors', credentials: 'omit' },
    plugins: [new ExpirationPlugin({ maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 180 }), new CacheableResponsePlugin({ statuses: [200] })],
  }),
)

// Frees the old poster cache, whose opaque responses inflated "Storage used" by gigabytes.
self.addEventListener('activate', (event) => event.waitUntil(caches.delete('posters')))

// Clicking a WatchTrack alert focuses an open window and asks it to show the title, or opens a new one there.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = event.notification.data?.url
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

/** The same refresh the open app runs, on the library saved on this device. An open app checks for itself. */
async function backgroundCheck() {
  if ((await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).length) return
  const prefs = await readMirroredPrefs()
  if (!prefs?.alertsOn || !prefs.browserNotify || Notification.permission !== 'granted') return
  const results = await syncLibrary((await listTitles()).map(normalizeTitle), updateTitle)
  await notifyAlerts(await recordAlerts(foundEvents(results), undefined, prefs))
}

// Not in TypeScript's libs yet: only Chromium browsers have Periodic Background Sync.
self.addEventListener('periodicsync' as keyof ServiceWorkerGlobalScopeEventMap, (event) => {
  const e = event as ExtendableEvent & { tag: string }
  if (e.tag === BACKGROUND_CHECK_TAG) e.waitUntil(backgroundCheck())
})
