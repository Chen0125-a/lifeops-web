import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

const baseURL = process.env.LIFEOPS_IMAGE_BROWSER_BASE_URL ?? 'http://127.0.0.1:4193'
const exactDesktopTestMatch = /(?:accessibility-full|adr029-login-orbit|orbit-geometry|public-details|public-final|public-home)\.spec\.ts/
const exactBreakpointTestMatch = /(?:adr029-login-orbit|orbit-geometry|public-details|public-final)\.spec\.ts/
const exactCriticalTestMatch = /(?:adr029-login-orbit|public-details|public-final|public-home)\.spec\.ts/
const exactImageInapplicableHarnessTests = /(?:all five page-native details pass the four approved breakpoints|capture the final public screenshot, filmstrip, trace and performance manifest)/

function exactImageProjectTestMatch(projectName: string) {
  if (projectName.endsWith('-theme-performance')) return /public-home\.spec\.ts/
  if (projectName === 'chromium') return exactDesktopTestMatch
  if (projectName.includes('-acceptance')) return exactBreakpointTestMatch
  return exactCriticalTestMatch
}

export default defineConfig({
  ...baseConfig,
  globalSetup: undefined,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-image', open: 'never' }]],
  projects: baseConfig.projects?.map((project) => ({
    ...project,
    testMatch: exactImageProjectTestMatch(project.name ?? ''),
    grepInvert: [
      ...(project.grepInvert ? (Array.isArray(project.grepInvert) ? project.grepInvert : [project.grepInvert]) : []),
      exactImageInapplicableHarnessTests,
    ],
  })),
  use: {
    ...baseConfig.use,
    baseURL,
  },
})
