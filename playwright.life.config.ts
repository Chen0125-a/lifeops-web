import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: ['life-workspace.spec.ts', 'life-catalog-p3-t9.spec.ts', 'life-recipes-p3-t10.spec.ts', 'life-planning-p3-t11.spec.ts', 'life-commerce-p3-t12.spec.ts'],
  globalSetup: './tests/life-globalSetup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4194',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
