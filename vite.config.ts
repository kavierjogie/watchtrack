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
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
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
      // Libraries change less often than the app, so returning visitors re-download less.
      output: { codeSplitting: { groups: [{ name: 'vendor', test: /node_modules/ }] } },
    },
  },
  test: {
    environment: 'node',
  },
})
