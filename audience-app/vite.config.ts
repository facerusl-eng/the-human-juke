import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  envPrefix: ['VITE_', 'SUPABASE_'],
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    host: '0.0.0.0',
  },
})
