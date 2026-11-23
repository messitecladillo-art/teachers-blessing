import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react_vendor: ['react', 'react-dom'],
          math_katex: ['katex'],
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
