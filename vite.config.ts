import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vite.dev/config/
export default defineConfig({
  define: {
    __HUMAN_JUKEBOX_BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')),
  },
  resolve: {
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
    },
  },
  plugins: [
    basicSsl(),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'generateSW',
      filename: 'pwa-worker.js',
      // We register manually in main.tsx — don't inject a script tag.
      injectRegister: null,
      registerType: 'autoUpdate',
      workbox: {
        // Precache immutable build artifacts, but never HTML app shell.
        // This prevents stale startup versions when users reopen the site.
        globPatterns: ['**/*.{js,css,ico,png,svg,webp,woff,woff2}'],
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
              cacheName: 'vite-immutable-assets-v4',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // Static images and icons — cache for a week, revalidate in background.
            urlPattern: /\.(png|svg|webp|ico|woff2?)$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'static-assets-v4',
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
    https: process.env.VITE_DEV_HTTPS === '1',
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
