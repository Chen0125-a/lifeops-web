import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { screenshotToPath, writeBufferToPath } from './helpers/screenshotToPath'
import { traceToPath } from './helpers/traceToPath'

const evidenceDirectory = resolve('outputs/evidence/browser/p2-t3')
const viewports = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
] as const

test.use({ trace: 'off' })

async function prepare(page: Page, theme: 'day' | 'night') {
  await page.goto('/')
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
  await expect(page.locator('.public-home')).toHaveAttribute('data-public-theme', theme)
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
}

async function screenshot(
  page: Page,
  name: string,
  mask: ReturnType<Page['locator']>[] = [],
) {
  await screenshotToPath(page, {
    animations: 'allow',
    mask,
    maskColor: '#CCD9D3',
    path: resolve(evidenceDirectory, `${name}.png`),
  })
}

test('capture the P2-T3 login golden-slice evidence set', async ({ browser, context, page }) => {
  test.setTimeout(180_000)
  mkdirSync(evidenceDirectory, { recursive: true })
  const viewportChecks: Array<Record<string, unknown>> = []

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })

    for (const theme of ['day', 'night'] as const) {
      await prepare(page, theme)
      await expect(page.locator('#hero-title')).toHaveAttribute('data-title-state', 'complete')
      await expect(page.locator('.public-orbit__count')).toHaveText('05')
      await page.getByRole('button', { name: '暂停星盘动画' }).click()
      await screenshot(page, `${viewport.name}-${theme}-home-paused`)
      await page.getByRole('button', { name: '继续星盘动画' }).click()
      await page.getByRole('button', { name: '登录 LifeOps' }).click()
      await expect(page.locator('[data-login-phase="open"]')).toBeVisible()
      await page.waitForTimeout(720)

      const dialog = page.getByRole('dialog', { name: 'LifeOps 登录窗口' })
      const bounds = await dialog.boundingBox()
      const diagnostics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        fonts: document.fonts.status,
        innerWidth,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        orbitRate: document.querySelector('[data-public-orbit]')?.getAttribute('data-motion-rate'),
      }))
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1)
      expect(diagnostics.overflow).toBeLessThanOrEqual(1)
      expect(diagnostics.orbitRate).toBe(String(1 / 3))
      viewportChecks.push({ ...viewport, theme, bounds, ...diagnostics })
      await screenshot(page, `${viewport.name}-${theme}-login-open`)
    }
  }

  const zoomContext = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 320, height: 720 },
  })
  const zoomPage = await zoomContext.newPage()
  await prepare(zoomPage, 'night')
  await zoomPage.getByRole('button', { name: '登录 LifeOps' }).click()
  await expect(zoomPage.locator('[data-login-phase="open"]')).toBeVisible()
  await zoomPage.waitForTimeout(720)
  expect(await zoomPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await screenshot(zoomPage, '320x720-dpr2-night-login-reflow')
  const zoomEvidence = await zoomPage.evaluate(() => ({
    devicePixelRatio,
    innerHeight,
    innerWidth,
    screenHeight: screen.height,
    screenWidth: screen.width,
  }))
  await zoomContext.close()

  await page.setViewportSize({ width: 1440, height: 900 })
  await prepare(page, 'night')
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  const openingTimes = [0, 170, 340, 510, 680]
  for (let index = 0; index < openingTimes.length; index += 1) {
    if (index > 0) await page.waitForTimeout(openingTimes[index] - openingTimes[index - 1])
    await screenshot(page, `filmstrip-normal-open-${String(openingTimes[index]).padStart(3, '0')}ms`)
  }
  await page.getByRole('button', { name: '关闭登录窗口' }).click()
  const closingTimes = [0, 170, 340, 510, 680]
  for (let index = 0; index < closingTimes.length; index += 1) {
    if (index > 0) await page.waitForTimeout(closingTimes[index] - closingTimes[index - 1])
    await screenshot(page, `filmstrip-normal-close-${String(closingTimes[index]).padStart(3, '0')}ms`)
  }
  await expect(page.locator('[data-login-phase="closed"]')).toBeVisible()
  await traceToPath(context, resolve(evidenceDirectory, 'login-open-close-no-credentials-trace.zip'))

  await prepare(page, 'night')
  const frameTelemetry = await page.evaluate(async () => {
    const trigger = document.querySelector<HTMLButtonElement>('[aria-label="登录 LifeOps"]')
    if (!trigger) throw new Error('missing login trigger')
    const intervals: number[] = []
    let previous = performance.now()
    const started = previous
    trigger.click()
    await new Promise<void>((resolveFrameSampling) => {
      const sample = (now: number) => {
        intervals.push(now - previous)
        previous = now
        if (now - started < 850) requestAnimationFrame(sample)
        else resolveFrameSampling()
      }
      requestAnimationFrame(sample)
    })
    return intervals.slice(2)
  })
  const orderedIntervals = [...frameTelemetry].sort((left, right) => left - right)
  const motionTiming = {
    frames: frameTelemetry.length,
    maxMs: Math.max(...frameTelemetry),
    p95Ms: orderedIntervals[Math.floor(orderedIntervals.length * 0.95)] ?? null,
  }
  expect(motionTiming.p95Ms ?? Infinity).toBeLessThanOrEqual(34)
  expect(motionTiming.maxMs).toBeLessThanOrEqual(100)

  await prepare(page, 'night')
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  const account = page.getByLabel('账号')
  const password = page.getByRole('textbox', { name: '密码', exact: true })
  await account.fill('local-evidence@example.invalid')
  await password.fill('local-evidence-value')
  await page.getByRole('button', { name: '进入 LifeOps' }).click({ noWaitAfter: true })
  await expect(page.locator('.entry-transition')).toBeVisible()
  const entryStartedAt = Date.now()
  const entryTimes = [0, 100, 250, 430, 620, 760, 1000]
  const entrySamples: Array<Record<string, unknown>> = []
  for (let index = 0; index < entryTimes.length; index += 1) {
    const remaining = entryTimes[index] - (Date.now() - entryStartedAt)
    if (remaining > 0) await page.waitForTimeout(remaining)
    entrySamples.push({
      ...await page.evaluate(() => {
      const entry = document.querySelector<HTMLElement>('.entry-transition')
      const privateShell = document.querySelector<HTMLElement>('[data-private-shell]')
      const sampled = entry ?? privateShell ?? document.body
      return {
        backgroundColor: getComputedStyle(sampled).backgroundColor,
        entryActive: Boolean(entry),
        path: location.pathname,
        surface: entry?.dataset.entrySurface ?? privateShell?.dataset.workspaceTheme ?? 'document',
      }
      }),
      actualElapsedMs: Date.now() - entryStartedAt,
      requestedDelayMs: entryTimes[index],
    })
    await screenshot(
      page,
      `filmstrip-entry-normal-${String(entryTimes[index]).padStart(3, '0')}ms`,
      [account, password],
    )
  }
  expect(entrySamples.some((sample) => sample.entryActive)).toBe(true)
  expect(entrySamples.at(-1)).toMatchObject({
    entryActive: false,
    path: '/app/overview',
    surface: 'daylight',
  })
  expect(entrySamples.map((sample) => sample.backgroundColor)).not.toContain('rgb(255, 255, 255)')
  await expect(page.locator('[data-private-shell]')).toBeVisible()
  await expect(page.locator('.route-gate')).toHaveCount(0)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await prepare(page, 'night')
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  const reducedAccount = page.getByLabel('账号')
  const reducedPassword = page.getByRole('textbox', { name: '密码', exact: true })
  await reducedAccount.fill('local-reduced@example.invalid')
  await reducedPassword.fill('local-reduced-value')
  await page.getByRole('button', { name: '进入 LifeOps' }).click({ noWaitAfter: true })
  await expect(page.locator('.entry-transition')).toBeVisible()
  const reducedStartedAt = Date.now()
  const reducedTimes = [0, 40, 90]
  const reducedEntrySamples: Array<Record<string, unknown>> = []
  for (let index = 0; index < reducedTimes.length; index += 1) {
    const remaining = reducedTimes[index] - (Date.now() - reducedStartedAt)
    if (remaining > 0) await page.waitForTimeout(remaining)
    const captureStartedAtMs = Date.now() - reducedStartedAt
    const pathAtCaptureStart = new URL(page.url()).pathname
    await screenshot(
      page,
      `filmstrip-entry-reduced-${String(reducedTimes[index]).padStart(3, '0')}ms`,
      [reducedAccount, reducedPassword],
    )
    reducedEntrySamples.push({
      captureCompletedAtMs: Date.now() - reducedStartedAt,
      captureStartedAtMs,
      pathAtCaptureEnd: new URL(page.url()).pathname,
      pathAtCaptureStart,
      requestedDelayMs: reducedTimes[index],
    })
  }
  await expect(page).toHaveURL(/\/app\/overview$/)

  const metadata = {
    browser: context.browser()?.browserType().name(),
    browserVersion: context.browser()?.version(),
    capturedAt: new Date().toISOString(),
    commands: [
      'npm.cmd run test:e2e -- tests/p2-t3-evidence.spec.ts',
    ],
    entrySamples,
    fixtureSha256: createHash('sha256')
      .update('local-demo:no-network-evidence:no-secret-material')
      .digest('hex')
      .toUpperCase(),
    font: await page.evaluate(() => ({
      family: getComputedStyle(document.body).fontFamily,
      status: document.fonts.status,
    })),
    motionTiming,
    reducedEntrySamples,
    reducedMotion: 'reduce',
    themes: ['day', 'night'],
    viewportChecks,
    zoomEvidence: {
      ...zoomEvidence,
      interpretation: '320 CSS px reflow captured at DPR 2',
    },
  }
  await writeBufferToPath(
    resolve(evidenceDirectory, 'metadata.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
  )
})
