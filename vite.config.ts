import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/signal': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
})
