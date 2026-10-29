/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'favicon.svg', 'apple-touch-icon.png', 'badge-96.png'],
      manifest: {
        name: 'WatchTrack',
        short_name: 'WatchTrack',
        description: 'Track anime, TV series and movies — always know the next episode.',
        theme_color: '#0b0b12',
        background_color: '#0b0b12',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. Personal data stays in IndexedDB, never in the SW cache.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        // Static public pages are real HTML files (precached), not app routes.
        navigateFallbackDenylist: [/^\/api\//, /^\/about/, /^\/guides/, /^\/privacy/, /^\/terms/],
        // Opens the right title when a WatchTrack alert notification is clicked.
        importScripts: ['sw-notifications.js'],
        runtimeCaching: [
          {
            // Public poster artwork from metadata providers, so saved titles show posters offline.
            urlPattern: ({ url }) => ['media.kitsu.app', 'static.tvmaze.com', 'image.tmdb.org'].includes(url.hostname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'posters',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 700,
    // Public pages are plain HTML (no JS) so every crawler can read them. Add new guides here and to public/sitemap.xml.
    rollupOptions: {
      input: Object.fromEntries(
        ['index', 'about', 'privacy', 'terms', 'guides', 'guides/track-anime-and-tv-episodes', 'guides/organise-your-watchlist', 'guides/watchlist-local-storage'].map((p) => [p, `${p}.html`]),
      ),
    },
  },
  test: {
    environment: 'node',
  },
})
