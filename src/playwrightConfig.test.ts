import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import config from '../playwright.config'
import imageConfig from '../playwright.image.config'
import viteConfig from '../vite.config'

const workspaceRoot = resolve(import.meta.dirname, '..')
const globalSetupSource = readFileSync(resolve(workspaceRoot, 'tests/globalSetup.ts'), 'utf8')
const remoteGlobalSetupSource = readFileSync(resolve(workspaceRoot, 'tests-remote/globalSetup.ts'), 'utf8')
const remoteProductionAuthSource = readFileSync(resolve(workspaceRoot, 'tests-remote/production-auth.spec.ts'), 'utf8')
const motionContinuitySpecSource = readFileSync(resolve(workspaceRoot, 'tests/motion-continuity.spec.ts'), 'utf8')
const obsidianSettingsSpecSource = readFileSync(resolve(workspaceRoot, 'tests/obsidian-settings.spec.ts'), 'utf8')
const publicFinalSpecSource = readFileSync(resolve(workspaceRoot, 'tests/public-final.spec.ts'), 'utf8')
const publicDetailsSpecSource = readFileSync(resolve(workspaceRoot, 'tests/public-details.spec.ts'), 'utf8')
const screenshotToPathSource = readFileSync(resolve(workspaceRoot, 'tests/helpers/screenshotToPath.ts'), 'utf8')
const packageScripts = JSON.parse(readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8')).scripts as Record<string, string>
const applicationTsConfig = JSON.parse(readFileSync(resolve(workspaceRoot, 'tsconfig.app.json'), 'utf8')) as { exclude?: string[] }
const webDockerfileSource = readFileSync(resolve(workspaceRoot, 'Dockerfile'), 'utf8')
const imageConfigPath = resolve(workspaceRoot, 'playwright.image.config.ts')
const remoteImageConfigPath = resolve(workspaceRoot, 'playwright.remote.image.config.ts')
const imageBrowserSmokePath = resolve(workspaceRoot, 'scripts/smoke-image-browsers.ps1')
const loopbackImageProxyPath = resolve(workspaceRoot, 'scripts/loopback-image-proxy.mjs')
const imageConfigSource = existsSync(imageConfigPath) ? readFileSync(imageConfigPath, 'utf8') : ''
const remoteImageConfigSource = existsSync(remoteImageConfigPath) ? readFileSync(remoteImageConfigPath, 'utf8') : ''
const imageBrowserSmokeSource = existsSync(imageBrowserSmokePath) ? readFileSync(imageBrowserSmokePath, 'utf8') : ''
const loopbackImageProxySource = existsSync(loopbackImageProxyPath) ? readFileSync(loopbackImageProxyPath, 'utf8') : ''
const releaseWorkflowSource = readFileSync(resolve(workspaceRoot, '.github/workflows/release.yml'), 'utf8')

describe('Playwright acceptance environment', () => {
  it('uses the product timezone consistently on every runner OS', () => {
    expect(config.use).toMatchObject({ timezoneId: 'Asia/Shanghai' })
  })

  it('keeps external browser-harness contracts outside the production TypeScript graph', () => {
    expect(applicationTsConfig.exclude).toEqual([
      'src/playwrightConfig.test.ts',
      'src/lighthouseRunner.test.ts',
      'src/motionProbeContract.test.ts',
      'src/publicThemeCompositor.test.ts',
    ])
  })

  it('copies public runtime assets before the production image build', () => {
    const publicCopyIndex = webDockerfileSource.indexOf('COPY public ./public')
    const productionBuildIndex = webDockerfileSource.indexOf('RUN npm run build')

    expect(publicCopyIndex).toBeGreaterThan(-1)
    expect(productionBuildIndex).toBeGreaterThan(publicCopyIndex)
  })

  it('copies every root TypeScript config required by the production image build', () => {
    const productionBuildIndex = webDockerfileSource.indexOf('RUN npm run build')
    const requiredRootConfigs = [
      'vite.config.ts',
      'vitest.config.ts',
      'playwright.config.ts',
      'playwright.image.config.ts',
      'playwright.remote.config.ts',
      'playwright.remote.image.config.ts',
    ]

    for (const configPath of requiredRootConfigs) {
      const configCopyIndex = webDockerfileSource.indexOf(configPath)
      expect(configCopyIndex, `${configPath} must be copied into the builder`).toBeGreaterThan(-1)
      expect(configCopyIndex, `${configPath} must be copied before npm run build`).toBeLessThan(productionBuildIndex)
    }
  })

  it('serves the ordinary acceptance suite from one isolated static bundle', () => {
    expect(globalSetupSource).toContain("import { build, preview } from 'vite'")
    expect(globalSetupSource).toContain("const playwrightOutputDirectory = '.playwright-dist'")
    expect(globalSetupSource).toContain("'import.meta.env.DEV': 'true'")
    expect(globalSetupSource).toContain('emptyOutDir: true')
    expect(globalSetupSource).not.toContain('createServer')
    expect(config).toMatchObject({ workers: 1, retries: 0 })
  })

  it('serves real Fastify journeys from the prebuilt production bundle', () => {
    expect(packageScripts['test:e2e:remote']).toBe('npm run build && npm run build:server && playwright test --config playwright.remote.config.ts')
    expect(remoteGlobalSetupSource).toContain("import { preview } from 'vite'")
    expect(remoteGlobalSetupSource).not.toContain('createServer')
    expect(remoteGlobalSetupSource).toContain("preview: { host: '127.0.0.1', port: 4174, strictPort: true }")
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

  it('keeps trace screencast work outside the motion frame observer', () => {
    expect(config.use).toMatchObject({ trace: 'retain-on-failure' })
    expect(motionContinuitySpecSource).toContain("test.use({ trace: 'off' })")
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
      expect(performanceProject?.use).toMatchObject({ trace: 'off' })
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

  it('reruns applicable browser paths against the exact released Web and API digests', () => {
    expect(imageConfigSource).toContain("import baseConfig from './playwright.config'")
    expect(imageConfigSource).toContain('globalSetup: undefined')
    expect(imageConfigSource).toContain('LIFEOPS_IMAGE_BROWSER_BASE_URL')
    expect(imageConfigSource).toContain('exactImageProjectTestMatch')
    expect(imageConfigSource).toContain('exactImageInapplicableHarnessTests')
    expect(imageConfigSource).toContain('all five page-native details pass the four approved breakpoints')
    expect(imageConfigSource).toContain('capture the final public screenshot, filmstrip, trace and performance manifest')
    expect(imageConfig.projects?.find((project) => project.name === 'chromium')?.testMatch).toBeInstanceOf(RegExp)
    expect(String(imageConfig.projects?.find((project) => project.name === 'chromium')?.testMatch)).not.toContain('complete-product')
    expect(remoteImageConfigSource).toContain("import baseConfig from './playwright.remote.config'")
    expect(remoteImageConfigSource).toContain('globalSetup: undefined')
    expect(remoteImageConfigSource).toContain('LIFEOPS_IMAGE_BROWSER_REMOTE_BASE_URL')
    expect(packageScripts['test:e2e:image']).toContain('--config playwright.image.config.ts')
    expect(packageScripts['test:e2e:remote:image']).toBe('playwright test --config playwright.remote.image.config.ts')
    expect(imageBrowserSmokeSource).toContain("[switch]$RequireDigest")
    expect(imageBrowserSmokeSource).toContain("[ValidateSet('All', 'Remote')][string]$BrowserScope = 'All'")
    expect(imageBrowserSmokeSource).toContain('Remote scope cannot write final exact-image browser evidence.')
    expect(imageBrowserSmokeSource).toContain("location /api/")
    expect(imageBrowserSmokeSource).toContain("[string]$PlaywrightImage = 'mcr.microsoft.com/playwright:v1.62.1-noble'")
    expect(imageBrowserSmokeSource).toContain("git archive")
    expect(imageBrowserSmokeSource).toContain("'volume', 'create'")
    expect(imageBrowserSmokeSource).toContain("sed -i 's/\\r$//' /work/src/styles/index.css /work/src/styles/private.css")
    expect(imageBrowserSmokeSource).toContain('npm ci --prefix server --no-audit --no-fund')
    expect(imageBrowserSmokeSource).toContain('playwright.image.config.ts --project=webkit-theme-performance')
    expect(imageBrowserSmokeSource).toContain('playwright.remote.image.config.ts')
    expect(imageBrowserSmokeSource).toContain('/tmp/production-auth.spec.ts:ro')
    expect(imageBrowserSmokeSource).toContain('/tmp/loopback-image-proxy.mjs:ro')
    expect(imageBrowserSmokeSource).toContain('LIFEOPS_IMAGE_BROWSER_UPSTREAM')
    expect(imageBrowserSmokeSource).toContain('http://127.0.0.1:8081')
    expect(imageBrowserSmokeSource).toContain("browserOrigin = 'http://127.0.0.1:8081'")
    expect(imageBrowserSmokeSource).toContain("secureContextPrecondition = 'window.isSecureContext=true and crypto.randomUUID=function'")
    expect(imageBrowserSmokeSource).not.toContain('Invoke-NpmScript')
    expect(loopbackImageProxySource).toContain("createServer((request, response) =>")
    expect(loopbackImageProxySource).toContain("hostname: upstream.hostname")
    expect(loopbackImageProxySource).toContain("host: upstream.host")
    expect(loopbackImageProxySource).toContain("listen(8081, '127.0.0.1'")
    expect(remoteProductionAuthSource).toContain("page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/tasks')")
    expect(remoteProductionAuthSource).toContain("expect(createResult).toMatchObject({ status: 201, body: { title } })")
    expect(remoteProductionAuthSource).toContain("expect(await page.evaluate(() => ({ isSecureContext, randomUUID: typeof crypto.randomUUID }))).toEqual({ isSecureContext: true, randomUUID: 'function' })")
    expect(publicDetailsSpecSource).toContain("expect.poll(() => page.evaluate(() => sessionStorage.getItem('lifeops:public-return:v1'))).toBeNull()")

    const resolveIndex = releaseWorkflowSource.indexOf('Resolve registry digests')
    const imageBrowserIndex = releaseWorkflowSource.indexOf('smoke-image-browsers.ps1')
    const updateIndex = releaseWorkflowSource.indexOf('Update GitOps digests')
    expect(resolveIndex).toBeGreaterThan(-1)
    expect(imageBrowserIndex).toBeGreaterThan(resolveIndex)
    expect(updateIndex).toBeGreaterThan(imageBrowserIndex)
  })

  it('routes every canonical trace through the bounded write helper', () => {
    const directTraceWrites = readdirSync(resolve(workspaceRoot, 'tests'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.ts'))
      .filter((entry) => readFileSync(resolve(workspaceRoot, 'tests', entry.name), 'utf8').includes('tracing.stop({ path:'))
      .map((entry) => entry.name)

    expect(directTraceWrites).toEqual([])
  })

  it('routes every path-backed browser artifact through the atomic write helper', () => {
    const directArtifactWrites = readdirSync(resolve(workspaceRoot, 'tests'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.ts'))
      .filter((entry) => {
        const source = readFileSync(resolve(workspaceRoot, 'tests', entry.name), 'utf8')
        return /page\.screenshot\(\s*\{\s*path\s*:/.test(source) || source.includes('writeFileSync(')
      })
      .map((entry) => entry.name)

    expect(directArtifactWrites).toEqual([])
  })

  it('atomically replaces existing evidence on the Windows-backed browser runner', () => {
    expect(screenshotToPathSource).toContain("import { randomUUID } from 'node:crypto'")
    expect(screenshotToPathSource).toContain("import { basename, dirname, resolve } from 'node:path'")
    expect(screenshotToPathSource).toContain("await writeFile(temporaryPath, contents)")
    expect(screenshotToPathSource).toContain("await rename(temporaryPath, path)")
    expect(screenshotToPathSource).toContain("await unlink(temporaryPath).catch(() => undefined)")
    expect(screenshotToPathSource).toContain("'EINVAL'")
    expect(screenshotToPathSource).not.toContain("await writeFile(path, contents)")
  })

  it('waits for the real public detail shell before writing final evidence', () => {
    expect(publicFinalSpecSource).toContain("page.getByTestId('public-detail-shell')")
    expect(publicFinalSpecSource).toContain("page.locator('.route-gate')")
  })
})
