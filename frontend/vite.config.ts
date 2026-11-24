import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return 'react_vendor'
          }
          if (/node_modules[\\/]katex[\\/]/.test(id)) {
            return 'math_katex'
          }
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8008',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:8008',
        changeOrigin: true,
      },
    },
  },
})
