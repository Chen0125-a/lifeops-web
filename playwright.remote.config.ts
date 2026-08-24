import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests-remote',
  globalSetup: './tests-remote/globalSetup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-remote', open: 'never' }]],
  use: {
    actionTimeout: 15_000,
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'desktop-firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1440, height: 900 },
        // Playwright Firefox on Windows can fail before newPage in headless mode;
        // the same product journey is stable in a real foreground browser.
        headless: process.platform !== 'win32',
      },
    },
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ],
})
