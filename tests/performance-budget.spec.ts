import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const budgets = {
  initialJavaScriptGzipBytes: 350 * 1024,
  initialCssGzipBytes: 120 * 1024,
} as const

function initialAssets() {
  const dist = resolve('dist')
  const html = readFileSync(resolve(dist, 'index.html'), 'utf8')
  const paths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1]!)
  const unique = [...new Set(paths)]
  const total = (extension: '.js' | '.css') => unique
    .filter((path) => path.endsWith(extension))
    .reduce((sum, path) => sum + gzipSync(readFileSync(resolve(dist, path.slice(1)))).byteLength, 0)
  return { files: unique, javascript: total('.js'), css: total('.css') }
}

test('production entry assets stay inside the approved compressed budgets', async () => {
  const assets = initialAssets()
  expect(assets.javascript, JSON.stringify(assets)).toBeLessThanOrEqual(budgets.initialJavaScriptGzipBytes)
  expect(assets.css, JSON.stringify(assets)).toBeLessThanOrEqual(budgets.initialCssGzipBytes)
})

test('private authentication setup is excluded from the timed overview navigation', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    sessionStorage.setItem('lifeops:session:v1', JSON.stringify({ mode: 'local-preview', account: 'performance@lifeops.local' }))
  })
  const started = Date.now()
  await page.goto('/app/overview')
  await page.locator('[data-private-shell]').waitFor({ state: 'visible' })
  const elapsed = Date.now() - started
  expect(elapsed).toBeLessThan(5_000)
})
