import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

const tileCache = (name: string, pattern: RegExp) => ({
  urlPattern: pattern,
  handler: 'CacheFirst' as const,
  options: {
    cacheName: name,
    expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 90 },
    cacheableResponse: { statuses: [0, 200] },
  },
})

// base './' lets the same build run from GitHub Pages, a sub-folder, or inside the desktop app.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered in main.tsx, only on http(s)
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Spoor – trails, offline maps & wildlife',
        short_name: 'Spoor',
        description: 'Find walking, hiking and trail-running routes, keep maps and wildlife offline, and share where you are.',
        theme_color: '#ffffff',
        background_color: '#f3eee3',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          // Map tiles you have looked at stay available offline (downloaded areas live in their own cache).
          tileCache('viewed-tiles', /^https:\/\/([a-c]\.)?tile\.(opentopomap|openstreetmap|thunderforest)\.(org|com)\/.*/),
          // Wildlife photos.
          tileCache('wildlife-photos', /^https:\/\/(inaturalist-open-data\.s3\.amazonaws\.com|static\.inaturalist\.org)\/.*/),
        ],
      },
    }),
  ],
})
