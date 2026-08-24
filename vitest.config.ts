import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 20_000,
    css: true,
    coverage: {
      reporter: ['text', 'json-summary'],
    },
  },
})
