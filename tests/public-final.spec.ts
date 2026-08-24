import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { screenshotToPath } from './helpers/screenshotToPath'

const viewports = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1024', width: 1024, height: 768 },
  { name: '768', width: 768, height: 1024 },
  { name: '390', width: 390, height: 844 },
] as const
const categories = ['now', 'doing', 'learning', 'moments', 'archive'] as const
const evidenceDirectory = resolve('outputs/evidence/browser/p2-t5')

test.use({ trace: 'off' })

function publicFixture(category: typeof categories[number]) {
  const label = category === 'now' ? '此刻' : category === 'doing' ? '行动' : category === 'learning' ? '学习' : category === 'moments' ? '切片' : '档案'
  return [1, 2, 3].map((index) => ({
    id: `${category}-${index}`,
    slug: `${category}-published-${index}`,
    category,
    title: `${label} · ${index}`,
    excerpt: `这是经过明确发布的${category}摘要 ${index}，不包含私人原文。`,
    coverUrl: null,
    publishedAt: `2026-08-${String(16 - index).padStart(2, '0')}T09:30:00.000Z`,
    featured: index === 1,
  }))
}

async function installPublicReadFixture(page: Page) {
  await page.route('**/api/v1/public/content?*', (route) => {
    const category = new URL(route.request().url()).searchParams.get('category') as typeof categories[number]
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(publicFixture(category)),
    })
  })
}

async function preparePublicHome(page: Page) {
  await installPublicReadFixture(page)
  await page.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('lifeops:theme-override', JSON.stringify({
      theme: 'day',
      expiresAt: Date.now() + 86_400_000,
    }))

    const instrumentedWindow = window as Window & { __lifeopsWheelListeners?: number }
    instrumentedWindow.__lifeopsWheelListeners = 0
    const originalAddEventListener = EventTarget.prototype.addEventListener
    EventTarget.prototype.addEventListener = function instrumentedAddEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === 'wheel' && (this === window || this === document)) {
        instrumentedWindow.__lifeopsWheelListeners = (instrumentedWindow.__lifeopsWheelListeners ?? 0) + 1
      }
      return originalAddEventListener.call(this, type, listener, options)
    }
  })
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
}

async function inspectVisibleLabels(page: Page) {
  return page.evaluate(() => {
    const labels = [...document.querySelectorAll<HTMLElement>('.public-object__label')]
      .filter((label) => {
        const style = getComputedStyle(label)
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0
      })
      .map((label) => ({
        rect: label.getBoundingClientRect().toJSON(),
        slug: label.closest('[data-public-object]')?.getAttribute('data-public-object') ?? '',
      }))
    const overlaps: string[] = []

    for (let left = 0; left < labels.length; left += 1) {
      for (let right = left + 1; right < labels.length; right += 1) {
        const a = labels[left]
        const b = labels[right]
        if (a.rect.left < b.rect.right && a.rect.right > b.rect.left && a.rect.top < b.rect.bottom && a.rect.bottom > b.rect.top) {
          overlaps.push(`${a.slug}:${b.slug}`)
        }
      }
    }

    return {
      clipped: labels.filter(({ rect }) => rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight).map(({ slug }) => slug),
      count: labels.length,
      overlaps,
    }
  })
}

async function openZoomEquivalent(browser: Browser) {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 320, height: 720 },
  })
  const page = await context.newPage()
  await preparePublicHome(page)
  return { context, page }
}

async function setPublicTheme(page: Page, theme: 'day' | 'night') {
  await page.goto('/')
  await page.evaluate((nextTheme) => {
    localStorage.setItem('lifeops:theme-override', JSON.stringify({
      theme: nextTheme,
      expiresAt: Date.now() + 86_400_000,
    }))
  }, theme)
  await page.reload()
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('.public-home')).toHaveAttribute('data-public-theme', theme)
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
}

async function capture(page: Page, filename: string, fullPage = false, animations: 'allow' | 'disabled' = 'disabled') {
  await screenshotToPath(page, {
    animations,
    fullPage,
    path: resolve(evidenceDirectory, filename),
  })
}

test('public home and details keep the final responsive, target, focus and navigation contract', async ({ browser, page }) => {
  await preparePublicHome(page)

  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)
    await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
    await page.getByRole('button', { name: '暂停星盘动画' }).click()

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${viewport.width}px overflow`).toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => (window as Window & { __lifeopsWheelListeners?: number }).__lifeopsWheelListeners ?? 0)).toBe(0)
    expect(await page.locator('[data-public-orbit]').evaluate((orbit) => {
      const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 })
      orbit.dispatchEvent(wheel)
      return wheel.defaultPrevented
    })).toBe(false)
    await expect(page).toHaveURL(/\/$/)
    expect(await inspectVisibleLabels(page)).toEqual({ clipped: [], count: 5, overlaps: [] })

    for (const target of await page.locator('[data-public-object], .theme-switch, .login-trigger, .public-orbit__motion-control').all()) {
      const bounds = await target.boundingBox()
      expect(Math.min(bounds?.width ?? 0, bounds?.height ?? 0)).toBeGreaterThanOrEqual(44)
    }

    const learning = page.getByRole('link', { name: '探索最近在学' })
    await learning.focus()
    await learning.press('Enter')
    await expect(page).toHaveURL(/\/learning$/)
    await expect(page.locator('[data-fixed-return]')).toHaveCSS('height', '64px')
    await expect(page.getByRole('heading', { name: '最近在学', level: 1 })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('link', { name: '探索最近在学' })).toBeFocused()
    await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
  }

  const zoom = await openZoomEquivalent(browser)
  try {
    expect(await zoom.page.evaluate(() => ({ dpr: devicePixelRatio, innerWidth, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }))).toEqual({
      dpr: 2,
      innerWidth: 320,
      overflow: 0,
    })
    await zoom.page.getByRole('button', { name: '暂停星盘动画' }).click()
    expect(await inspectVisibleLabels(zoom.page)).toEqual({ clipped: [], count: 5, overlaps: [] })
    const leaders = await zoom.page.locator('.public-object__label').evaluateAll((labels) => labels.map((label) => {
      const leader = getComputedStyle(label, '::before')
      return { content: leader.content, width: Number.parseFloat(leader.width) || 0 }
    }))
    expect(leaders.every((leader) => leader.content !== 'none' && leader.width > 0)).toBe(true)
    await zoom.page.getByRole('button', { name: '继续星盘动画' }).click()
    const movingLabelFrames = await zoom.page.evaluate(async () => {
      const failures: Array<{ clipped: string[]; overlaps: string[] }> = []
      for (let frame = 0; frame < 20; frame += 1) {
        await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()))
        const labels = [...document.querySelectorAll<HTMLElement>('.public-object__label')].map((label) => ({
          rect: label.getBoundingClientRect(),
          slug: label.closest('[data-public-object]')?.getAttribute('data-public-object') ?? '',
        }))
        const overlaps: string[] = []
        for (let left = 0; left < labels.length; left += 1) {
          for (let right = left + 1; right < labels.length; right += 1) {
            const a = labels[left]
            const b = labels[right]
            if (a.rect.left < b.rect.right && a.rect.right > b.rect.left && a.rect.top < b.rect.bottom && a.rect.bottom > b.rect.top) {
              overlaps.push(`${a.slug}:${b.slug}`)
            }
          }
        }
        const clipped = labels.filter(({ rect }) => rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight).map(({ slug }) => slug)
        if (clipped.length || overlaps.length) failures.push({ clipped, overlaps })
      }
      return failures
    })
    expect(movingLabelFrames).toEqual([])
  } finally {
    await zoom.context.close()
  }
})

test('pause, hidden suspension and reduced motion preserve equivalent public meaning', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await preparePublicHome(page)
  const objects = page.locator('[data-public-object]')
  const normalSemantics = await objects.evaluateAll((nodes) => nodes.map((node) => ({
    href: node.getAttribute('href'),
    label: node.getAttribute('aria-label'),
    slug: node.getAttribute('data-public-object'),
  })))

  await page.getByRole('button', { name: '暂停星盘动画' }).click()
  const pausedBefore = await objects.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()))
  await page.waitForTimeout(350)
  const pausedAfter = await objects.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()))
  expect(pausedAfter).toEqual(pausedBefore)
  await page.getByRole('button', { name: '继续星盘动画' }).click()

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-suspended', 'true')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-suspended', 'false')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-reduced-motion', 'true')
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-suspended', 'true')
  const reducedSemantics = await page.locator('[data-public-object]').evaluateAll((nodes) => nodes.map((node) => ({
    href: node.getAttribute('href'),
    label: node.getAttribute('aria-label'),
    slug: node.getAttribute('data-public-object'),
  })))
  expect(reducedSemantics).toEqual(normalSemantics)

  await page.getByRole('link', { name: '探索生活切片' }).press('Enter')
  await expect(page).toHaveURL(/\/moments$/)
  await expect(page.locator('[data-flip-id]')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '生活切片', level: 1 })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('link', { name: '探索生活切片' })).toBeFocused()
})

test('fifty animation frames keep root anchors path-attached under the scoped GSAP owner', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await preparePublicHome(page)
  await expect(page.locator('.public-orbit__count')).toHaveText('05', { timeout: 6_000 })

  const result = await page.evaluate(async () => {
    const mutatedOutsideOwner = new Set<string>()
    const mutatedTargets = new Set<string>()
    const motionOwner = document.querySelector<HTMLElement>('[data-public-motion-owner="public-orbit"]')
    if (!motionOwner) throw new Error('Public orbit motion owner is missing')
    const ownedTransformElements = new WeakSet<Element>([
      motionOwner,
      ...motionOwner.querySelectorAll('*'),
    ])
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target
        if (!(target instanceof HTMLElement) || !target.style.transform) continue
        const identity = target.getAttribute('data-public-object') ?? target.className
        mutatedTargets.add(String(identity))
        if (!ownedTransformElements.has(target)) mutatedOutsideOwner.add(String(identity))
      }
    })
    observer.observe(motionOwner, { attributes: true, attributeFilter: ['style'], subtree: true })

    const frameErrors: number[][] = []
    for (let frame = 0; frame < 50; frame += 1) {
      await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()))
      const errors: number[] = []
      for (const object of document.querySelectorAll<HTMLElement>('[data-public-object]')) {
        const path = document.querySelector<SVGPathElement>(`[data-orbit-path="${object.dataset.orbitId}"]`)
        const anchor = object.querySelector<HTMLElement>('.public-object__anchor')
        const matrix = path?.getScreenCTM()
        const bounds = anchor?.getBoundingClientRect()
        if (!path || !anchor || !matrix || !bounds?.width || !bounds.height) {
          errors.push(Number.POSITIVE_INFINITY)
          continue
        }
        const center = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
        const length = path.getTotalLength()
        let nearest = Number.POSITIVE_INFINITY
        for (let sample = 0; sample <= 1024; sample += 1) {
          const point = path.getPointAtLength((length * sample) / 1024)
          const rendered = new DOMPoint(point.x, point.y).matrixTransform(matrix)
          nearest = Math.min(nearest, Math.hypot(rendered.x - center.x, rendered.y - center.y))
        }
        errors.push(nearest)
      }
      frameErrors.push(errors)
    }
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()))
    observer.disconnect()

    return {
      maxPathError: Math.max(...frameErrors.flat()),
      mutatedOutsideOwner: [...mutatedOutsideOwner],
      mutatedTargets: [...mutatedTargets],
      ownerCount: document.querySelectorAll('[data-public-motion-owner="public-orbit"]').length,
      samples: frameErrors.length,
      samplesPerFrame: frameErrors.map((frame) => frame.length),
    }
  })

  expect(result.ownerCount).toBe(1)
  expect(result.samples).toBe(50)
  expect(result.samplesPerFrame).toEqual(Array(50).fill(5))
  expect(result.mutatedTargets.length).toBeGreaterThanOrEqual(5)
  expect(result.mutatedOutsideOwner).toEqual([])
  expect(result.maxPathError).toBeLessThanOrEqual(4)
})

test('login task content remains visible and unobscured in both public themes', async ({ page }) => {
  await installPublicReadFixture(page)

  for (const theme of ['day', 'night'] as const) {
    await setPublicTheme(page, theme)
    await page.getByRole('button', { name: '登录 LifeOps' }).click()
    await expect(page.locator('[data-login-phase="open"]')).toBeVisible()
    await page.waitForTimeout(720)

    const heading = page.getByRole('heading', { name: '欢迎回来', level: 2 })
    const account = page.getByLabel('账号')
    const submit = page.getByRole('button', { name: '进入 LifeOps' })
    await expect(heading).toBeVisible()
    await expect(account).toBeVisible()
    await expect(submit).toBeVisible()

    for (const locator of [heading, account, submit]) {
      expect(await locator.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return hit === element || element.contains(hit) || Boolean(hit?.contains(element))
      })).toBe(true)
    }
  }
})

test('capture the final public screenshot, filmstrip, trace and performance manifest', async ({ browser, context, page }) => {
  test.setTimeout(120_000)
  mkdirSync(evidenceDirectory, { recursive: true })
  await installPublicReadFixture(page)

  const viewportDiagnostics: Array<Record<string, unknown>> = []
  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    for (const theme of ['day', 'night'] as const) {
      await setPublicTheme(page, theme)
      await page.getByRole('button', { name: '暂停星盘动画' }).click()
      await capture(page, `public-home-${theme}-${viewport.name}.png`)
      await page.getByRole('button', { name: '继续星盘动画' }).click()
      await page.getByRole('button', { name: '登录 LifeOps' }).click()
      await expect(page.locator('[data-login-phase="open"]')).toBeVisible()
      await page.waitForTimeout(720)
      await capture(page, `public-login-${theme}-${viewport.name}.png`)
      viewportDiagnostics.push(await page.evaluate(({ name, width, height, theme: currentTheme }) => ({
        name,
        width,
        height,
        theme: currentTheme,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        labels: document.querySelectorAll('[data-orbit-label="always"]').length,
        loginBounds: document.querySelector('[data-login-phase="open"]')?.getBoundingClientRect().toJSON(),
      }), { ...viewport, theme }))
    }

    await setPublicTheme(page, 'day')
    for (const category of categories) {
      await page.goto(`/${category}`)
      await expect(page.getByText('正在读取已发布内容…')).toHaveCount(0)
      await expect(page.locator('[data-public-detail-layout]')).toBeVisible()
      await capture(page, `public-detail-${category}-${viewport.name}.png`, true)
    }
  }

  const zoom = await openZoomEquivalent(browser)
  try {
    await zoom.page.getByRole('button', { name: '暂停星盘动画' }).click()
    await zoom.page.evaluate(() => window.scrollTo(0, 0))
    await capture(zoom.page, 'public-home-day-320-dpr2.png')
    await zoom.page.getByRole('button', { name: '继续星盘动画' }).click()
    await zoom.page.getByRole('button', { name: '登录 LifeOps' }).click()
    await expect(zoom.page.locator('[data-login-phase="open"]')).toBeVisible()
    await zoom.page.waitForTimeout(720)
    await zoom.page.evaluate(() => window.scrollTo(0, 0))
    await capture(zoom.page, 'public-login-day-320-dpr2.png')
  } finally {
    await zoom.context.close()
  }

  const filmstripTimes = [0, 170, 340, 510, 680]
  const captureIsolatedFilmstripFrame = async (
    filename: string,
    elapsed: number,
    reducedMotion: 'no-preference' | 'reduce',
  ) => {
    const framePage = await context.newPage()
    try {
      await framePage.setViewportSize({ width: 1440, height: 900 })
      await framePage.emulateMedia({ reducedMotion })
      await installPublicReadFixture(framePage)
      await setPublicTheme(framePage, 'night')
      await framePage.waitForTimeout(960 + elapsed)
      await framePage.getByRole('button', { name: '暂停星盘动画' }).click()
      await expect(framePage.locator('[data-public-orbit]')).toHaveAttribute('data-motion-paused', 'true')
      await framePage.evaluate(() => new Promise<void>((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))
      }))
      await capture(framePage, filename)
    } finally {
      await framePage.close()
    }
  }
  for (const elapsed of filmstripTimes) {
    await captureIsolatedFilmstripFrame(
      `filmstrip-public-normal-${String(elapsed).padStart(3, '0')}ms.png`,
      elapsed,
      'no-preference',
    )
  }

  for (const elapsed of filmstripTimes) {
    await captureIsolatedFilmstripFrame(
      `filmstrip-public-reduced-${String(elapsed).padStart(3, '0')}ms.png`,
      elapsed,
      'reduce',
    )
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await setPublicTheme(page, 'night')
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
  await page.getByRole('link', { name: '探索最近在学' }).press('Enter')
  await expect(page.getByRole('heading', { name: '最近在学', level: 1 })).toBeFocused()
  await page.getByRole('button', { name: '返回公开星盘', exact: true }).click()
  await expect(page.getByRole('link', { name: '探索最近在学' })).toBeFocused()
  await context.tracing.stop({ path: resolve(evidenceDirectory, 'public-home-detail-return-trace.zip') })

  await setPublicTheme(page, 'night')
  const frameIntervals = await page.evaluate(async () => {
    const intervals: number[] = []
    let previous = performance.now()
    const started = previous
    await new Promise<void>((resolveSampling) => {
      const sample = (now: number) => {
        intervals.push(now - previous)
        previous = now
        if (now - started < 1_200) requestAnimationFrame(sample)
        else resolveSampling()
      }
      requestAnimationFrame(sample)
    })
    return intervals.slice(2)
  })
  const orderedIntervals = [...frameIntervals].sort((left, right) => left - right)
  const performance = {
    frames: frameIntervals.length,
    maxMs: Math.max(...frameIntervals),
    p95Ms: orderedIntervals[Math.floor(orderedIntervals.length * 0.95)] ?? null,
  }
  expect(performance.p95Ms ?? Infinity).toBeLessThanOrEqual(34)
  expect(performance.maxMs).toBeLessThanOrEqual(100)

  const indexCss = readFileSync('src/styles/index.css', 'utf8')
  expect(indexCss).toBe("@import './tokens.css';\n@import './base.css';\n@import './public.css';\n@import './motion.css';\n")
  const privateCss = readFileSync('src/styles/private.css', 'utf8')
  expect(privateCss).toBe("@import '@fontsource-variable/noto-sans-sc/wght.css';\n@import './private-shell.css';\n@import './overview.css';\n@import './goals.css';\n@import './schedule.css';\n@import './habits.css';\n@import './records.css';\n@import './reviews.css';\n@import './knowledge.css';\n@import './publishing.css';\n@import './platform.css';\n@import './settings.css';\n@import './life-shell.css';\n@import './life-catalog.css';\n@import './life-recipes.css';\n@import './life-plans.css';\n@import './life-commerce.css';\n")
  const cssLayers = ['tokens.css', 'base.css', 'public.css', 'motion.css', 'private-shell.css', 'overview.css', 'goals.css', 'schedule.css', 'habits.css', 'records.css', 'reviews.css', 'knowledge.css', 'publishing.css', 'platform.css', 'settings.css', 'life-shell.css', 'life-catalog.css', 'life-recipes.css', 'life-plans.css', 'life-commerce.css'].map((name) => ({
    bytes: statSync(resolve('src/styles', name)).size,
    name,
  }))
  const artifacts = readdirSync(evidenceDirectory)
    .filter((name) => name !== 'public-browser-performance-manifest.json')
    .sort()
    .map((name) => {
      const path = resolve(evidenceDirectory, name)
      const contents = readFileSync(path)
      return {
        bytes: contents.length,
        name,
        sha256: createHash('sha256').update(contents).digest('hex').toUpperCase(),
      }
    })
  const manifest = {
    artifacts,
    browser: context.browser()?.browserType().name(),
    browserVersion: context.browser()?.version(),
    cssLayers,
    generatedAt: new Date().toISOString(),
    performance,
    viewportDiagnostics,
    zoomEquivalent: { devicePixelRatio: 2, height: 720, width: 320 },
  }
  writeFileSync(resolve(evidenceDirectory, 'public-browser-performance-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  expect(artifacts.filter((artifact) => artifact.name.endsWith('.png'))).toHaveLength(48)
  expect(artifacts.filter((artifact) => artifact.name.endsWith('.zip'))).toHaveLength(1)
  const normalFilmstripHashes = artifacts
    .filter((artifact) => artifact.name.startsWith('filmstrip-public-normal-'))
    .map((artifact) => artifact.sha256)
  const reducedFilmstripHashes = artifacts
    .filter((artifact) => artifact.name.startsWith('filmstrip-public-reduced-'))
    .map((artifact) => artifact.sha256)
  expect(normalFilmstripHashes).toHaveLength(5)
  expect(new Set(normalFilmstripHashes).size).toBe(5)
  expect(reducedFilmstripHashes).toHaveLength(5)
  expect(new Set(reducedFilmstripHashes).size).toBe(1)
  expect(viewportDiagnostics.every((diagnostic) => diagnostic.overflow === 0 && diagnostic.labels === 5)).toBe(true)
})
