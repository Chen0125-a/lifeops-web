import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import config from '../playwright.config'
import viteConfig from '../vite.config'

const workspaceRoot = resolve(import.meta.dirname, '..')
const globalSetupSource = readFileSync(resolve(workspaceRoot, 'tests/globalSetup.ts'), 'utf8')
const obsidianSettingsSpecSource = readFileSync(resolve(workspaceRoot, 'tests/obsidian-settings.spec.ts'), 'utf8')
const publicFinalSpecSource = readFileSync(resolve(workspaceRoot, 'tests/public-final.spec.ts'), 'utf8')

describe('Playwright acceptance environment', () => {
  it('uses the product timezone consistently on every runner OS', () => {
    expect(config.use).toMatchObject({ timezoneId: 'Asia/Shanghai' })
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
