import { expect, test, type Locator, type Page } from '@playwright/test'

const SAFE_INSET = 16
const OUTER_DIAMETER = 677.45

test.beforeEach(async ({ page, browserName }, testInfo) => {
  if (browserName === 'webkit' || browserName === 'firefox') {
    testInfo.setTimeout(90_000)
    await page.bringToFront()
  }
  await page.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem(
      'lifeops:theme-override',
      JSON.stringify({ theme: 'night', expiresAt: Date.now() + 86_400_000 }),
    )
  })
})

async function bounds(locator: Locator) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const box = await locator.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      })
      if (box.width > 0 && box.height > 0) return box
    } catch {
      // The fallback and enhanced orbit may exchange ownership between frames.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Orbit geometry did not reach a measurable frame within 5 seconds')
}

async function expectCompleteInset(page: Page, ring: Locator, viewport: { width: number; height: number }) {
  const box = await bounds(ring)
  const diagnostic = await ring.evaluate((element) => {
    const root = element.closest('[data-public-orbit]') as HTMLElement
    const stage = element.closest('[data-orbit-reference-stage]') as HTMLElement
    const scaler = element.closest('[data-orbit-scaler]') as HTMLElement
    const rootStyle = getComputedStyle(root)
    const stageStyle = getComputedStyle(stage)
    const scalerStyle = getComputedStyle(scaler)
    return {
      centerX: stageStyle.getPropertyValue('--scene-center-x'),
      centerY: stageStyle.getPropertyValue('--scene-center-y'),
      rootTransform: rootStyle.transform,
      rootBox: root.getBoundingClientRect().toJSON(),
      rootPosition: rootStyle.position,
      scale: stageStyle.getPropertyValue('--scene-scale'),
      stageLeft: stageStyle.left,
      stageTop: stageStyle.top,
      stageTransform: stageStyle.transform,
      scalerBox: scaler.getBoundingClientRect().toJSON(),
      scalerLeft: scalerStyle.left,
      scalerTop: scalerStyle.top,
      scalerTransform: scalerStyle.transform,
      viewport: [innerWidth, innerHeight],
    }
  })
  const message = JSON.stringify({ box, diagnostic })
  expect(box.x, message).toBeGreaterThanOrEqual(SAFE_INSET - 0.75)
  expect(box.y, message).toBeGreaterThanOrEqual(SAFE_INSET - 0.75)
  expect(box.x + box.width, message).toBeLessThanOrEqual(viewport.width - SAFE_INSET + 0.75)
  expect(box.y + box.height, message).toBeLessThanOrEqual(viewport.height - SAFE_INSET + 0.75)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
}

test('1440 rest and login compositions keep the locked outer ring fully visible and proportionate', async ({ page }) => {
  const viewport = { width: 1440, height: 900 }
  await page.setViewportSize(viewport)
  await page.goto('/')

  const enhancedOrbit = page.locator('[data-public-orbit][data-motion-enhanced="true"]')
  await expect(enhancedOrbit).toBeAttached()
  const ring = enhancedOrbit.locator('[data-orbit-boundary="orbit-d"]')
  await expect(ring).toBeAttached()
  await expect.poll(async () => {
    const box = await bounds(ring)
    return Math.abs(box.width - OUTER_DIAMETER) < 0.5
      && Math.abs(box.height - OUTER_DIAMETER) < 0.5
  }).toBe(true)
  const rest = await bounds(ring)
  expect(rest.width).toBeCloseTo(OUTER_DIAMETER, 0)
  expect(rest.height).toBeCloseTo(OUTER_DIAMETER, 0)
  await expectCompleteInset(page, ring, viewport)

  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  const dialog = page.getByRole('dialog', { name: 'LifeOps 登录窗口' })
  await expect(dialog).toBeVisible()
  await expect.poll(async () => {
    const [ringBox, panelBox] = await Promise.all([bounds(ring), bounds(dialog)])
    const gap = panelBox.x - (ringBox.x + ringBox.width)
    const centerDelta = Math.abs(
      ringBox.y + ringBox.height / 2 - (panelBox.y + panelBox.height / 2),
    )
    return ringBox.width >= 516
      && ringBox.width <= 524
      && panelBox.width >= 456
      && panelBox.width <= 464
      && gap >= 28
      && gap <= 36
      && centerDelta <= 16
  }, { timeout: 12_000 }).toBe(true)

  const loginRing = await bounds(ring)
  const panel = await bounds(dialog)
  expect(loginRing.width).toBeGreaterThanOrEqual(516)
  expect(loginRing.width).toBeLessThanOrEqual(524)
  expect(panel.width).toBeGreaterThanOrEqual(456)
  expect(panel.width).toBeLessThanOrEqual(464)
  expect(panel.x - (loginRing.x + loginRing.width)).toBeGreaterThanOrEqual(28)
  expect(panel.x - (loginRing.x + loginRing.width)).toBeLessThanOrEqual(36)
  expect(Math.abs((loginRing.y + loginRing.height / 2) - (panel.y + panel.height / 2))).toBeLessThanOrEqual(16)
  await expectCompleteInset(page, ring, viewport)
})

test('390 rest gives the title and complete outer ring separate breathing zones', async ({ page }) => {
  const viewport = { width: 390, height: 844 }
  await page.setViewportSize(viewport)
  await page.goto('/')

  const title = page.getByRole('heading', { name: '把日子，慢慢看清。' })
  const copy = page.getByTestId('public-copy')
  const ring = page.locator('[data-orbit-boundary="orbit-d"]')
  await expect(title).toBeVisible()
  await expect(ring).toBeAttached()

  const [titleFontSize, copyBox, ringBox] = await Promise.all([
    title.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    bounds(copy),
    bounds(ring),
  ])

  expect(titleFontSize).toBeGreaterThanOrEqual(58)
  expect(titleFontSize).toBeLessThanOrEqual(60)
  expect(ringBox.width).toBeGreaterThanOrEqual(300)
  expect(ringBox.width).toBeLessThanOrEqual(308)
  expect(ringBox.y - (copyBox.y + copyBox.height)).toBeGreaterThanOrEqual(16)
  await expectCompleteInset(page, ring, viewport)
})

test('the center keeps its semantic count without rendering a light orb', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const center = page.locator('[data-orbit-center]')
  const aperture = page.locator('[data-daylight-aperture]')
  await expect(center).toContainText('05')
  await expect(center).toContainText('此刻正在发生')

  await expect.poll(async () => aperture.evaluateAll((elements) => {
    const element = elements.find((candidate) => candidate.isConnected)
    if (!element) return null
    const style = getComputedStyle(element)
    const before = getComputedStyle(element, '::before')
    const after = getComputedStyle(element, '::after')
    if (!style.backgroundImage) return null
    return {
      backgroundImage: style.backgroundImage,
      borderTopWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
      beforeContent: before.content,
      afterContent: after.content,
    }
  }), { timeout: 5_000 }).toEqual({
    backgroundImage: 'none',
    borderTopWidth: '0px',
    boxShadow: 'none',
    beforeContent: 'none',
    afterContent: 'none',
  })
})

test('desktop login lets the astrolabe lead while the title recedes on compositor motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await expect(page.getByRole('dialog', { name: 'LifeOps 登录窗口' })).toBeVisible()
  await expect.poll(async () => {
    const width = (await bounds(page.locator('[data-orbit-boundary="orbit-d"]'))).width
    return width >= 516 && width <= 524
  }).toBe(true)
  await expect.poll(async () => page.getByTestId('public-copy').evaluate(async (element) => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    return element.getAnimations().length === 0
      && Number.parseFloat(getComputedStyle(element).opacity) <= 0.24
  })).toBe(true)

  const depth = await page.locator('[data-public-scene="login"]').evaluate((home) => {
    const copy = home.querySelector<HTMLElement>('.public-hero__copy')!
    const stage = home.querySelector<HTMLElement>('.public-hero__stage')!
    const reference = home.querySelector<HTMLElement>('[data-orbit-reference-stage]')!
    const backdrop = home.querySelector<HTMLElement>('.login-backdrop')!
    const dialog = home.querySelector<HTMLElement>('[role="dialog"]')!
    const copyStyle = getComputedStyle(copy)
    const stageStyle = getComputedStyle(stage)
    const referenceStyle = getComputedStyle(reference)
    const backdropStyle = getComputedStyle(backdrop)
    const dialogStyle = getComputedStyle(dialog)
    return {
      backdropFilter: backdropStyle.backdropFilter,
      copyOpacity: Number.parseFloat(copyStyle.opacity),
      copyTransform: copyStyle.transform,
      copyZ: Number.parseInt(copyStyle.zIndex, 10),
      dialogBackdropFilter: dialogStyle.backdropFilter,
      stageZ: Number.parseInt(stageStyle.zIndex, 10),
      transitionProperties: referenceStyle.transitionProperty.split(',').map((value) => value.trim()),
      willChangeProperties: referenceStyle.willChange.split(',').map((value) => value.trim()),
    }
  })

  expect(depth.copyOpacity).toBeGreaterThanOrEqual(0.12)
  expect(depth.copyOpacity).toBeLessThanOrEqual(0.24)
  expect(depth.copyTransform).not.toBe('none')
  expect(depth.stageZ).toBeGreaterThan(depth.copyZ)
  expect(depth.backdropFilter).toBe('none')
  expect(depth.dialogBackdropFilter).toBe('none')
  expect(depth.willChangeProperties).toContain('transform')
  expect(depth.transitionProperties).not.toContain('top')
  expect(depth.transitionProperties).not.toContain('left')
})

test('night login is dark and themed while explicit day keeps a compatible light surface', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  const dialog = page.getByRole('dialog', { name: 'LifeOps 登录窗口' })
  await expect(dialog).toBeVisible()

  const night = await dialog.evaluate((element) => {
    const style = getComputedStyle(element)
    return { backgroundColor: style.backgroundColor, color: style.color, surface: element.getAttribute('data-theme-surface') }
  })
  expect(night.surface).toBe('adaptive')
  expect(night.backgroundColor).toMatch(/^rgba?\((?:[0-2]?\d),\s*(?:[0-2]?\d),\s*(?:[0-3]?\d)/)
  expect(night.color).not.toBe('rgb(23, 33, 30)')

  await page.getByRole('button', { name: '关闭登录窗口' }).click()
  await page.getByRole('button', { name: '切换为日间主题' }).click()
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveCSS('color-scheme', 'light')
})

test('the complete outer ring stays inside every required rest and login viewport', async ({ page }) => {
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 720 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/')
    const ring = page.locator('[data-orbit-boundary="orbit-d"]')
    await expect(ring).toBeAttached()
    await expectCompleteInset(page, ring, viewport)

    await page.getByRole('button', { name: '登录 LifeOps' }).click()
    await expect(page.getByRole('dialog', { name: 'LifeOps 登录窗口' })).toBeVisible()
    await page.waitForTimeout(750)
    await expectCompleteInset(page, ring, viewport)
    await expect(page.getByRole('button', { name: '关闭登录窗口' })).toBeInViewport()
    await expect(page.getByRole('button', { name: '进入 LifeOps' })).toBeInViewport()
  }
})
