import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.LIFEOPS_DEPLOYMENT_BASE_URL
if (!baseURL || !/^https:\/\//.test(baseURL)) {
  throw new Error('LIFEOPS_DEPLOYMENT_BASE_URL must be an explicit HTTPS origin.')
}

export default defineConfig({
  testDir: './tests',
  testMatch: /deployment-(?:smoke|persistence)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    actionTimeout: 15_000,
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'deployment-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
})
