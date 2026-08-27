import { defineConfig, devices } from '@playwright/test'

const p3T13Focused = process.argv.some((argument) => /life-(today-calendar|catalog-recipes|planning-completion|shopping-budget|data-recovery)\.spec\.ts$/i.test(argument))
const themeFrameBudgetTest = /the day-night transition stays inside the interaction frame budget/

export default defineConfig({
  testDir: './tests',
  testIgnore: [
    'life-workspace.spec.ts',
    'life-catalog-p3-t9.spec.ts',
    'life-recipes-p3-t10.spec.ts',
    'life-planning-p3-t11.spec.ts',
    'life-commerce-p3-t12.spec.ts',
    ...p3T13Focused ? [] : [
      'life-today-calendar.spec.ts',
      'life-catalog-recipes.spec.ts',
      'life-planning-completion.spec.ts',
      'life-shopping-budget.spec.ts',
      'life-data-recovery.spec.ts',
    ],
  ],
  globalSetup: './tests/globalSetup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    actionTimeout: 15_000,
    baseURL: 'http://127.0.0.1:4193',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'chromium-1024-acceptance',
      testMatch: /(?:responsive-accessibility|accessibility-full|motion-continuity|orbit-geometry|complete-product)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } },
    },
    {
      name: 'chromium-768-acceptance',
      testMatch: /(?:responsive-accessibility|accessibility-full|motion-continuity|orbit-geometry|complete-product)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'chromium-390-acceptance',
      testMatch: /(?:responsive-accessibility|accessibility-full|motion-continuity|orbit-geometry|complete-product)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'firefox-critical',
      testMatch: /(?:adr029-login-orbit|public-home|public-login|private-overview|motion-continuity)\.spec\.ts/,
      grepInvert: themeFrameBudgetTest,
      timeout: 90_000,
      // Firefox 153 cannot create an SWGL draw target in this Windows headless session.
      // Headed mode exercises the same product paths and keeps headless CI on other platforms.
      use: { ...devices['Desktop Firefox'], headless: process.platform !== 'win32', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'firefox-theme-performance',
      testMatch: /public-home\.spec\.ts/,
      grep: themeFrameBudgetTest,
      timeout: 90_000,
      // Keep this timing-sensitive sample in a fresh Firefox worker/browser process.
      use: { ...devices['Desktop Firefox'], headless: process.platform !== 'win32', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'webkit-critical',
      testMatch: /(?:adr029-login-orbit|public-home|public-login|private-overview|motion-continuity)\.spec\.ts/,
      grepInvert: themeFrameBudgetTest,
      timeout: 90_000,
      // The Windows WebKit port throttles rAF when its headless page is backgrounded.
      // Headed mode plus explicit page foregrounding keeps timing and resize evidence valid.
      use: { ...devices['Desktop Safari'], headless: process.platform !== 'win32', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'webkit-theme-performance',
      testMatch: /public-home\.spec\.ts/,
      grep: themeFrameBudgetTest,
      timeout: 90_000,
      // Keep this timing-sensitive sample in a fresh WebKit worker/browser process.
      use: { ...devices['Desktop Safari'], headless: process.platform !== 'win32', viewport: { width: 1440, height: 900 } },
    },
  ],
})
