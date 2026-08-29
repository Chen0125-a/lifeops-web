import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Bound jsdom workers so route-level lazy imports keep their 5s assertion
    // budget on high-core, memory-constrained runners as well as in CI.
    maxWorkers: 4,
    testTimeout: 20_000,
    css: true,
    coverage: {
      reporter: ['text', 'json-summary'],
    },
  },
})
