import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'generateSW',
      filename: 'pwa-worker.js',
      // We register manually in main.tsx — don't inject a script tag.
      injectRegister: null,
      registerType: 'autoUpdate',
      workbox: {
        // Precache every Vite build artifact so returning users get instant load.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
        // SPA navigation fallback: unknown paths return the app shell.
        navigateFallback: '/index.html',
        // Don't intercept API, join-redirect, or Vercel edge routes.
        navigateFallbackDenylist: [/^\/api\//, /^\/join\//, /^\/a\//, /^\/j\//],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Take control of all clients immediately — no waiting for old tabs to close.
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // Immutable hashed Vite chunks — safe to cache forever.
            urlPattern: /\/assets\/.+\.[0-9a-f]{8,}\.(js|css)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vite-immutable-assets-v3',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // Static images and icons — cache for a week, revalidate in background.
            urlPattern: /\.(png|svg|webp|ico|woff2?)$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'static-assets-v3',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
      // Our own manifest.json already lives in public/ — no need to generate one.
      manifest: false,
    }),
  ],
  server: {
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '.lhr.life',
      '.loca.lt',
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
})
