import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('/react/')
              || id.includes('/react-dom/')
              || id.includes('/react-router-dom/')
            ) {
              return 'framework'
            }

            if (id.includes('/@supabase/')) {
              return 'supabase'
            }

            return 'vendor'
          }

          if (id.includes('/src/state/')) {
            return 'state'
          }

          if (id.includes('/src/lib/')) {
            return 'lib'
          }

          return undefined
        },
      },
    },
  },
})
