import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.remote.config'

const baseURL = process.env.LIFEOPS_IMAGE_BROWSER_REMOTE_BASE_URL ?? 'http://127.0.0.1:4174'

export default defineConfig({
  ...baseConfig,
  globalSetup: undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-remote-image', open: 'never' }]],
  use: {
    ...baseConfig.use,
    baseURL,
  },
})
