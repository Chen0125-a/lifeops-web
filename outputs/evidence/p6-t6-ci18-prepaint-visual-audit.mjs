import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const outputDirectory = resolve('outputs/evidence/browser/p6-t6-ci18-prepaint-final')
const origin = 'http://127.0.0.1:4173'
const captures = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]

async function prepare(page, theme) {
  await page.goto(origin)
  await page.evaluate((nextTheme) => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem(
      'lifeops:theme-override',
      JSON.stringify({ theme: nextTheme, expiresAt: Date.now() + 86_400_000 }),
    )
  }, theme)
  await page.reload()
  await page.evaluate(() => document.fonts.ready)
  await page.locator('.public-home').waitFor({ state: 'visible' })
  await page.waitForFunction((nextTheme) => (
    document.querySelector('.public-home')?.getAttribute('data-public-theme') === nextTheme
    && document.querySelector('#hero-title')?.getAttribute('data-title-state') === 'complete'
    && document.querySelector('[data-public-orbit]')?.getAttribute('data-motion-enhanced') === 'true'
    && !document.querySelector('.theme-switch')?.hasAttribute('disabled')
  ), theme)
  await page.waitForTimeout(900)
}

async function inspect(page, capture, theme, state) {
  return page.evaluate(({ captureName, captureWidth, captureHeight, selectedTheme, selectedState }) => {
    const rectangle = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return null
      const box = element.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }
    return {
      capture: captureName,
      viewport: { width: captureWidth, height: captureHeight },
      theme: selectedTheme,
      state: selectedState,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      centerText: [
        document.querySelector('[data-public-orbit][data-motion-enhanced="true"] .public-orbit__count')?.textContent,
        document.querySelector('[data-public-orbit][data-motion-enhanced="true"] .public-orbit__count-label')?.textContent,
      ].filter(Boolean).join(''),
      visibleLabels: [...document.querySelectorAll('[data-orbit-label]')]
        .filter((element) => {
          const style = getComputedStyle(element)
          const box = element.getBoundingClientRect()
          return style.visibility !== 'hidden' && Number.parseFloat(style.opacity) > 0 && box.width > 0 && box.height > 0
        }).length,
      outerRing: rectangle('[data-orbit-boundary="orbit-d"]'),
      dialog: rectangle('[role="dialog"]'),
      publicTheme: document.querySelector('.public-home')?.getAttribute('data-public-theme') ?? null,
      dayOverlayOpacity: getComputedStyle(document.querySelector('.public-sky'), '::before').opacity,
      preloadedStarFieldSource: document.querySelector('[data-star-field]')?.getAttribute('src') ?? null,
      preloadedStarFieldVisibility: getComputedStyle(document.querySelector('[data-star-field]')).visibility,
      preloadedStarFieldComplete: document.querySelector('[data-star-field]')?.complete ?? false,
      preloadedStarFieldNaturalSize: {
        width: document.querySelector('[data-star-field]')?.naturalWidth ?? 0,
        height: document.querySelector('[data-star-field]')?.naturalHeight ?? 0,
      },
      loginPhase: document.querySelector('[data-login-phase]')?.getAttribute('data-login-phase') ?? null,
    }
  }, {
    captureName: capture.name,
    captureWidth: capture.width,
    captureHeight: capture.height,
    selectedTheme: theme,
    selectedState: state,
  })
}

async function main() {
  await mkdir(outputDirectory, { recursive: true })
  const vite = await createServer({
    configFile: 'vite.config.ts',
    server: { host: '127.0.0.1', port: 4173, strictPort: true },
  })
  await vite.listen()
  const browser = await chromium.launch({ headless: true })
  const results = []
  try {
    for (const capture of captures) {
      const context = await browser.newContext({
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        viewport: { width: capture.width, height: capture.height },
      })
      const page = await context.newPage()
      try {
        for (const theme of ['day', 'night']) {
          await prepare(page, theme)
          results.push(await inspect(page, capture, theme, 'rest'))

          await page.getByRole('button', { name: '登录 LifeOps' }).click()
          await page.locator('[data-login-phase="open"]').waitFor({ state: 'visible' })
          await page.waitForTimeout(850)
          results.push(await inspect(page, capture, theme, 'login'))
        }
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
    await vite.close()
  }

  const failures = results.filter((result) => (
    result.overflowX > 1
    || result.centerText !== '05此刻正在发生'
    || result.visibleLabels !== 5
    || !result.outerRing
    || result.outerRing.x < 15
    || result.outerRing.y < 15
    || result.outerRing.x + result.outerRing.width > result.viewport.width - 15
    || result.outerRing.y + result.outerRing.height > result.viewport.height - 15
    || (result.state === 'login' && (!result.dialog || result.loginPhase !== 'open'))
    || result.preloadedStarFieldSource !== '/public-stars-raster.png'
    || result.preloadedStarFieldVisibility !== 'visible'
    || !result.preloadedStarFieldComplete
    || result.preloadedStarFieldNaturalSize.width !== 1440
    || result.preloadedStarFieldNaturalSize.height !== 900
    || (result.theme === 'night' && result.dayOverlayOpacity !== '0')
    || (result.theme === 'day' && result.dayOverlayOpacity !== '1')
  ))
  await writeFile(
    resolve(outputDirectory, 'metrics.json'),
    `${JSON.stringify({ ok: failures.length === 0, results, failures }, null, 2)}\n`,
  )
  if (failures.length > 0) throw new Error(`VISUAL_AUDIT_METRICS_FAILED:${failures.length}`)
  process.stdout.write(`visual-audit: ok; states=${results.length}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
