import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import config from '../playwright.config'
import viteConfig from '../vite.config'

const workspaceRoot = resolve(import.meta.dirname, '..')
const globalSetupSource = readFileSync(resolve(workspaceRoot, 'tests/globalSetup.ts'), 'utf8')
const obsidianSettingsSpecSource = readFileSync(resolve(workspaceRoot, 'tests/obsidian-settings.spec.ts'), 'utf8')
const publicFinalSpecSource = readFileSync(resolve(workspaceRoot, 'tests/public-final.spec.ts'), 'utf8')
const packageScripts = JSON.parse(readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8')).scripts as Record<string, string>
const applicationTsConfig = JSON.parse(readFileSync(resolve(workspaceRoot, 'tsconfig.app.json'), 'utf8')) as { exclude?: string[] }
const webDockerfileSource = readFileSync(resolve(workspaceRoot, 'Dockerfile'), 'utf8')

describe('Playwright acceptance environment', () => {
  it('uses the product timezone consistently on every runner OS', () => {
    expect(config.use).toMatchObject({ timezoneId: 'Asia/Shanghai' })
  })

  it('keeps external browser-harness contracts outside the production TypeScript graph', () => {
    expect(applicationTsConfig.exclude).toEqual([
      'src/playwrightConfig.test.ts',
      'src/motionProbeContract.test.ts',
    ])
  })

  it('copies public runtime assets before the production image build', () => {
    const publicCopyIndex = webDockerfileSource.indexOf('COPY public ./public')
    const productionBuildIndex = webDockerfileSource.indexOf('RUN npm run build')

    expect(publicCopyIndex).toBeGreaterThan(-1)
    expect(productionBuildIndex).toBeGreaterThan(publicCopyIndex)
  })

  it('serves the ordinary acceptance suite from one isolated static bundle', () => {
    expect(globalSetupSource).toContain("import { build, preview } from 'vite'")
    expect(globalSetupSource).toContain("const playwrightOutputDirectory = '.playwright-dist'")
    expect(globalSetupSource).toContain("'import.meta.env.DEV': 'true'")
    expect(globalSetupSource).toContain('emptyOutDir: true')
    expect(globalSetupSource).not.toContain('createServer')
    expect(config).toMatchObject({ workers: 1, retries: 0 })
  })

  it('keeps the API proxy contract identical for development and static acceptance', () => {
    expect(viteConfig).toMatchObject({
      server: { proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false } } },
      preview: { proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false } } },
    })
  })

  it('bundles the standalone Obsidian browser harness without dev-module URLs', () => {
    expect(globalSetupSource).toContain("'obsidian-browser-harness':")
    expect(obsidianSettingsSpecSource).toContain('/assets/obsidian-browser-harness.js')
    expect(obsidianSettingsSpecSource).not.toContain('/node_modules/.vite/')
    expect(obsidianSettingsSpecSource).not.toContain('/src/features/')
  })

  it('applies the existing 90-second critical-browser budget before page fixtures start', () => {
    const firefox = config.projects?.find((project) => project.name === 'firefox-critical')
    const webkit = config.projects?.find((project) => project.name === 'webkit-critical')
    expect(firefox?.timeout).toBe(90_000)
    expect(webkit?.timeout).toBe(90_000)
  })

  it('isolates each non-Chromium theme frame budget without weakening the gate', () => {
    const sharedFirefox = config.projects?.find((project) => project.name === 'firefox-critical')
    const sharedWebkit = config.projects?.find((project) => project.name === 'webkit-critical')
    const performanceFirefox = config.projects?.find((project) => project.name === 'firefox-theme-performance')
    const performanceWebkit = config.projects?.find((project) => project.name === 'webkit-theme-performance')
    const exactTitle = 'the day-night transition stays inside the interaction frame budget'

    expect(config).toMatchObject({ workers: 1, retries: 0 })
    expect(sharedFirefox?.grepInvert).toBeInstanceOf(RegExp)
    expect((sharedFirefox?.grepInvert as RegExp).source).toBe(exactTitle)
    expect(sharedWebkit?.grepInvert).toBeInstanceOf(RegExp)
    expect((sharedWebkit?.grepInvert as RegExp).source).toBe(exactTitle)
    for (const performanceProject of [performanceFirefox, performanceWebkit]) {
      expect(performanceProject).toMatchObject({ timeout: 90_000 })
      expect(performanceProject?.testMatch).toBeInstanceOf(RegExp)
      expect((performanceProject?.testMatch as RegExp).source).toBe('public-home\\.spec\\.ts')
      expect(performanceProject?.grep).toBeInstanceOf(RegExp)
      expect((performanceProject?.grep as RegExp).source).toBe(exactTitle)
      expect(performanceProject?.grepInvert).toBeUndefined()
    }
  })

  it('runs the ordinary browser matrix and WebKit theme budget in separate Playwright processes', () => {
    expect(packageScripts['test:e2e']).toBe('npm run test:e2e:webkit-theme && npm run test:e2e:firefox-theme && npm run test:e2e:matrix')
    expect(packageScripts['test:e2e:matrix']).toBe([
      'playwright test',
      '--project=chromium',
      '--project=chromium-1024-acceptance',
      '--project=chromium-768-acceptance',
      '--project=chromium-390-acceptance',
      '--project=firefox-critical',
      '--project=webkit-critical',
    ].join(' '))
    expect(packageScripts['test:e2e:webkit-theme']).toBe('playwright test --project=webkit-theme-performance')
    expect(packageScripts['test:e2e:firefox-theme']).toBe('playwright test --project=firefox-theme-performance')
  })

  it('routes every canonical trace through the bounded write helper', () => {
    const directTraceWrites = readdirSync(resolve(workspaceRoot, 'tests'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.ts'))
      .filter((entry) => readFileSync(resolve(workspaceRoot, 'tests', entry.name), 'utf8').includes('tracing.stop({ path:'))
      .map((entry) => entry.name)

    expect(directTraceWrites).toEqual([])
  })

  it('waits for the real public detail shell before writing final evidence', () => {
    expect(publicFinalSpecSource).toContain("page.getByTestId('public-detail-shell')")
    expect(publicFinalSpecSource).toContain("page.locator('.route-gate')")
  })
})
