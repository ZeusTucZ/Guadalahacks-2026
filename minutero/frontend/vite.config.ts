import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/static/',
  build: {
    outDir: '../static',
    emptyOutDir: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/estado': 'http://127.0.0.1:8000',
      '/indexar': 'http://127.0.0.1:8000',
      '/resumir': 'http://127.0.0.1:8000',
      '/mapa': 'http://127.0.0.1:8000',
      '/preguntar': 'http://127.0.0.1:8000',
      '/chat': 'http://127.0.0.1:8000',
      '/calentar': 'http://127.0.0.1:8000',
    },
  },
})
