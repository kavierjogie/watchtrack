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
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['icon.svg', 'favicon.svg', 'apple-touch-icon.png', 'badge-96.png'],
      manifest: {
        name: 'WatchTrack',
        short_name: 'WatchTrack',
        description: 'Track anime, TV series and movies — always know the next episode.',
        theme_color: '#15120f',
        background_color: '#15120f',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        // Long-press / right-click the installed app's icon (Android, desktop Chrome/Edge; iOS ignores it).
        shortcuts: [
          { name: 'Continue watching', short_name: 'Continue', url: '/continue' },
          { name: 'Upcoming releases', short_name: 'Upcoming', url: '/upcoming' },
          { name: 'Add title', short_name: 'Add', url: '/?add=1' },
        ],
        // Installed app shows up in Android's share sheet; Layout turns what's shared into a search (see sharedQuery).
        share_target: { action: '/', method: 'GET', params: { title: 'share_title', text: 'share_text', url: 'share_url' } },
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
        // Only link previews ask for this, and they don't run the app: no reason for every device to download it.
        globIgnores: ['og-image.png'],
        // vite-plugin-pwa 2.0.0 still sets the deprecated inlineDynamicImports on the worker's build.
        buildPlugins: {
          vite: [
            {
              name: 'sw-code-splitting',
              outputOptions: ({ inlineDynamicImports: _, ...output }) => ({ ...output, codeSplitting: false }),
            },
          ],
        },
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
      // Libraries change less often than the app, so returning visitors re-download less. React gets its own chunk because
      // tree-shaking changes the rest: using one new icon would otherwise re-download all of them. Motion is left out of
      // the groups so its drag/layout features (src/lib/motionFeatures.ts) stay in a chunk loaded after first paint.
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/, priority: 2 },
            { name: 'vendor', test: /node_modules[\\/](?!framer-motion|motion-dom|motion-utils)/, priority: 1 },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
  },
})
