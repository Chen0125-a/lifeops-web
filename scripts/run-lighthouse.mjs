import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const origin = 'http://127.0.0.1:4173'
const outputDirectory = resolve('outputs/final')
const publicReportPath = resolve(outputDirectory, 'lighthouse-public.json')
const privateReportPath = resolve(outputDirectory, 'private-performance.json')
const lighthouseCli = resolve('node_modules/lighthouse/cli/index.js')
const viteCli = resolve('node_modules/vite/bin/vite.js')

function waitForExit(child, label) {
  return new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolveExit() : reject(new Error(`${label} exited ${code}`)))
  })
}

async function waitForServer(url) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The production preview is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 120))
  }
  throw new Error(`Production preview did not start at ${url}`)
}

async function main() {
  await mkdir(outputDirectory, { recursive: true })
  const preview = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  preview.stdout.pipe(process.stdout)
  preview.stderr.pipe(process.stderr)
  try {
    await waitForServer(origin)
    const lighthouse = spawn(process.execPath, [
      lighthouseCli,
      `${origin}/`,
      '--chrome-flags=--headless --no-sandbox --disable-gpu --disable-dev-shm-usage',
      '--config-path=lighthouse.config.cjs',
      '--output=json',
      `--output-path=${publicReportPath}`,
      '--quiet',
    ], {
      env: { ...process.env, CHROME_PATH: chromium.executablePath() },
      stdio: 'inherit',
      windowsHide: true,
    })
    await waitForExit(lighthouse, 'Lighthouse')

    const report = JSON.parse(await readFile(publicReportPath, 'utf8'))
    const scores = Object.fromEntries(['performance', 'accessibility', 'best-practices', 'seo'].map((category) => [
      category,
      report.categories?.[category]?.score ?? 0,
    ]))
    const required = { performance: .85, accessibility: .95, 'best-practices': .95, seo: .90 }
    for (const [category, threshold] of Object.entries(required)) {
      if (scores[category] < threshold) throw new Error(`LIGHTHOUSE_BUDGET_FAILED:${category}:${scores[category]}<${threshold}`)
    }

    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
      await page.route('**/api/v1/**', async (route) => {
        const path = new URL(route.request().url()).pathname
        if (path === '/api/v1/auth/session') {
          await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ user: { id: 'p6-performance', account: 'performance@lifeops.local', displayName: 'Performance Fixture' }, csrfToken: 'controlled-fixture' }),
            status: 200,
          })
          return
        }
        if (path === '/api/v1/state') {
          await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] }), status: 200 })
          return
        }
        if (path === '/api/v1/habits') {
          await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ from: '2026-08-17', to: '2026-08-23', habits: [], entries: [] }), status: 200 })
          return
        }
        if (path === '/api/v1/life/shopping') {
          await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ suggestions: [], list: [], purchases: [], returns: [] }), status: 200 })
          return
        }
        if (/\/api\/v1\/life\/day-plans\/[^/]+\/projection$/.test(path)) {
          await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ date: '2026-08-23', status: 'incomplete', plannedNutrition: null, actualNutrition: {}, plannedCostMinor: null, actualCostMinor: null, plannedEnergyKcal: 0, actualEnergyKcal: 0, inventory: [], items: [], sourceIds: [] }), status: 200 })
          return
        }
        if (/\/api\/v1\/life\/day-plans\/[^/]+$/.test(path)) {
          await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: null, date: '2026-08-23', mealSlots: [], items: [], entityVersion: 0 }), status: 200 })
          return
        }
        if (/\/api\/v1\/life\/timeline\/[^/]+$/.test(path)) {
          await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ date: '2026-08-23', timelineItems: [] }), status: 200 })
          return
        }
        if (path === '/api/v1/life/budgets') {
          await route.fulfill({ contentType: 'application/json', body: '[]', status: 200 })
          return
        }
        await route.fulfill({ contentType: 'application/json', body: '[]', status: 200 })
      })
      const startedAt = Date.now()
      await page.goto(`${origin}/app/overview`, { waitUntil: 'networkidle' })
      await page.locator('[data-private-shell]').waitFor({ state: 'visible' })
      const navigationMs = Date.now() - startedAt
      const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => {
        const resource = entry
        return { name: resource.name.replace(location.origin, ''), duration: Math.round(resource.duration), transferSize: 'transferSize' in resource ? resource.transferSize : 0 }
      }))
      await writeFile(privateReportPath, `${JSON.stringify({ route: '/app/overview', authSetupExcluded: true, fixture: 'controlled-production-auth-session', navigationMs, resources }, null, 2)}\n`)
    } finally {
      await browser.close()
    }
    process.stdout.write(`${JSON.stringify({ ok: true, scores, reports: [publicReportPath, privateReportPath] })}\n`)
  } finally {
    preview.kill('SIGTERM')
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
