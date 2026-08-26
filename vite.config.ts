import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxy = {
  '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false },
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: apiProxy,
  },
  preview: {
    proxy: apiProxy,
  },
  build: {
    sourcemap: false,
    target: 'es2022',
  },
})
