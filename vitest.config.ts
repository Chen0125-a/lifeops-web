import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Bound jsdom workers so route-level lazy imports keep their unchanged
    // assertion budget on memory-constrained local and hosted CI runners.
    maxWorkers: 2,
    testTimeout: 20_000,
    css: true,
    coverage: {
      reporter: ['text', 'json-summary'],
    },
  },
})
