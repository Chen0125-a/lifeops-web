import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page, browserName }, testInfo) => {
  if (browserName === 'webkit' || browserName === 'firefox') {
    testInfo.setTimeout(90_000)
  }
  if (browserName === 'webkit' || browserName === 'firefox') {
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

async function readDesktopComposition(page: Page) {
  const [ring, panel] = await Promise.all([
    page.locator('[data-orbit-boundary="orbit-d"]').boundingBox(),
    page.getByRole('dialog', { name: 'LifeOps 登录窗口' }).boundingBox(),
  ])
  return { ring, panel }
}

async function waitForDesktopLoginComposition(page: Page, browserName: string) {
  await expect.poll(async () => {
    const { ring, panel } = await readDesktopComposition(page)
    if (!ring || !panel) return false
    const gap = panel.x - (ring.x + ring.width)
    const centerDelta = Math.abs(
      ring.y + ring.height / 2 - (panel.y + panel.height / 2),
    )
    return ring.width >= 516
      && ring.width <= 524
      && panel.width >= 456
      && panel.width <= 464
      && gap >= 28
      && gap <= 36
      && centerDelta <= 16
  }, { timeout: browserName === 'webkit' ? 12_000 : 5_000 }).toBe(true)
}

function webkitTransitionTimeout(browserName: string) {
  return browserName === 'webkit' ? 12_000 : 5_000
}

test('default night, explicit day and one-shot title survive login close and reopen with live playheads', async ({ page, browserName }) => {
  await page.addInitScript(() => localStorage.clear())
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/', { waitUntil: 'commit' })

  const home = page.locator('[data-public-theme]')
  const title = page.getByRole('heading', { name: '把日子，慢慢看清。' })
  const object = page.locator('[data-public-object="now"]')
  await title.waitFor({ state: 'attached' })
  await expect(title).toHaveAccessibleName('把日子，慢慢看清。')
  expect(await title.getAttribute('data-title-state')).toBe('typing')
  await expect(home).toHaveAttribute('data-public-theme', 'night')
  await expect(title).toHaveAttribute('data-title-play-count', '1')
  await expect(title).toHaveAttribute('data-title-state', 'complete', { timeout: 3_000 })
  const firstPosition = await object.boundingBox()

  await page.getByRole('button', { name: '切换为日间主题' }).click()
  await expect(home).toHaveAttribute('data-public-theme', 'day')
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await expect(page.locator('[data-login-phase="open"]')).toBeVisible()
  await page.getByRole('button', { name: '关闭登录窗口' }).click()
  await expect(page.locator('[data-login-phase="closed"]')).toBeVisible({ timeout: webkitTransitionTimeout(browserName) })
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await expect(page.locator('[data-login-phase="open"]')).toBeVisible()

  expect(await object.boundingBox()).not.toBeNull()
  const reopenedPosition = await object.boundingBox()
  expect(Math.hypot(
    reopenedPosition!.x - firstPosition!.x,
    reopenedPosition!.y - firstPosition!.y,
  )).toBeGreaterThan(2)
  await expect(title).toHaveAttribute('data-title-state', 'complete')
  await expect(title).toHaveAttribute('data-title-play-count', '1')
  await expect(home).toHaveAttribute('data-public-theme', 'day')
})

test('explicit public day stays separate from the authenticated private daylight prepaint', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '切换为日间主题' }).click()
  await expect(page.locator('[data-public-theme]')).toHaveAttribute('data-public-theme', 'day')
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await page.getByLabel('账号').fill('owner@example.com')
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('local-preview')
  await page.getByRole('button', { name: '进入 LifeOps' }).click()

  await expect(page.getByTestId('private-daylight-prepaint')).toHaveAttribute(
    'data-workspace-theme',
    'daylight',
  )
})

test('desktop login is a 460px live-playhead task layer beside a fully inset 520px astrolabe', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const orbit = page.locator('[data-public-orbit]')
  await expect(orbit).toHaveAttribute('data-motion-enhanced', 'true')
  const object = page.locator('[data-public-object="now"]')
  const trigger = page.getByRole('button', { name: '登录 LifeOps' })

  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'LifeOps 登录窗口' })
  await expect(dialog).toBeVisible()
  await expect(orbit).toHaveAttribute('data-motion-rate', String(1 / 3))
  await waitForDesktopLoginComposition(page, browserName)

  const { panel, ring } = await readDesktopComposition(page)
  expect(panel).not.toBeNull()
  expect(ring).not.toBeNull()
  expect(panel!.width).toBeGreaterThanOrEqual(456)
  expect(panel!.width).toBeLessThanOrEqual(464)
  expect(panel!.y).toBeGreaterThanOrEqual(0)
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(900)
  expect(ring!.width).toBeGreaterThanOrEqual(516)
  expect(ring!.width).toBeLessThanOrEqual(524)
  expect(panel!.x - (ring!.x + ring!.width)).toBeGreaterThanOrEqual(28)
  expect(panel!.x - (ring!.x + ring!.width)).toBeLessThanOrEqual(36)
  expect(ring!.x).toBeGreaterThanOrEqual(16)
  expect(ring!.y).toBeGreaterThanOrEqual(16)
  expect(ring!.x + ring!.width).toBeLessThanOrEqual(1424)
  expect(ring!.y + ring!.height).toBeLessThanOrEqual(884)

  const movingFrom = await object.boundingBox()
  await page.waitForTimeout(420)
  const movingTo = await object.boundingBox()
  expect(Math.hypot(movingTo!.x - movingFrom!.x, movingTo!.y - movingFrom!.y)).toBeGreaterThan(1)

  const beforeClose = await object.boundingBox()
  await page.getByRole('button', { name: '关闭登录窗口' }).click()
  await page.waitForTimeout(40)
  const afterClose = await object.boundingBox()
  expect(Math.hypot(afterClose!.x - beforeClose!.x, afterClose!.y - beforeClose!.y)).toBeLessThan(80)
  await expect(trigger).toBeFocused()
  if (browserName !== 'webkit') await page.waitForTimeout(760)
  await expect(page.locator('[data-public-scene="rest"]')).toBeVisible()
  await expect(page.locator('[data-login-phase="closed"]')).toBeVisible({ timeout: webkitTransitionTimeout(browserName) })

  await expect.poll(async () => {
    const box = await page.locator('[data-orbit-boundary="orbit-d"]').boundingBox()
    return box?.width ?? 0
  }, { timeout: webkitTransitionTimeout(browserName) }).toBeCloseTo(677.45, 0)

  const restored = await page.locator('[data-orbit-boundary="orbit-d"]').boundingBox()
  expect(restored).not.toBeNull()
  expect(restored!.width).toBeCloseTo(677.45, 0)
  expect(restored!.x).toBeGreaterThanOrEqual(16)
  expect(restored!.y).toBeGreaterThanOrEqual(16)
  expect(restored!.x + restored!.width).toBeLessThanOrEqual(1424)
  expect(restored!.y + restored!.height).toBeLessThanOrEqual(884)
})

test('390px login is a full-screen task layer over an unchanged astrolabe frame', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const orbit = page.locator('[data-public-orbit]')
  await expect(orbit).toHaveAttribute('data-motion-enhanced', 'true')
  const before = await orbit.boundingBox()

  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  const dialog = page.getByRole('dialog', { name: 'LifeOps 登录窗口' })
  await expect(dialog).toBeVisible()
  const panel = await dialog.boundingBox()
  const after = await orbit.boundingBox()

  expect(panel).not.toBeNull()
  expect(panel!.x).toBeCloseTo(0, 0)
  expect(panel!.y).toBeCloseTo(0, 0)
  expect(panel!.width).toBeCloseTo(390, 0)
  expect(panel!.height).toBeCloseTo(844, 0)
  expect(after!.x).toBeCloseTo(before!.x, 0)
  expect(after!.y).toBeCloseTo(before!.y, 0)
  expect(after!.width).toBeCloseTo(before!.width, 0)
  expect(after!.height).toBeCloseTo(before!.height, 0)
  await expect(page.getByRole('button', { name: '关闭登录窗口' })).toBeInViewport()
  await expect(page.getByRole('button', { name: '进入 LifeOps' })).toBeInViewport()
  await expect(page.getByLabel('账号')).toBeFocused()

  const password = page.getByRole('textbox', { name: '密码', exact: true })
  await password.fill('visible-check')
  await page.getByRole('button', { name: '显示密码' }).click()
  await expect(password).toHaveAttribute('type', 'text')
})

test('login motion reverses and reopens from the live interrupted playhead', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const trigger = page.getByRole('button', { name: '登录 LifeOps' })
  const orbit = page.locator('[data-public-orbit]')
  await expect(orbit).toHaveAttribute('data-motion-enhanced', 'true')

  await trigger.click()
  await page.waitForTimeout(180)
  await page.getByRole('button', { name: '关闭登录窗口' }).click()
  await page.waitForTimeout(90)
  await trigger.click()
  await waitForDesktopLoginComposition(page, browserName)

  await expect(page.locator('[data-login-phase="open"]')).toBeVisible()
  const { ring, panel } = await readDesktopComposition(page)
  expect(ring).not.toBeNull()
  expect(panel).not.toBeNull()
  expect(ring!.width).toBeGreaterThanOrEqual(516)
  expect(ring!.width).toBeLessThanOrEqual(524)
  expect(panel!.x - (ring!.x + ring!.width)).toBeGreaterThanOrEqual(28)
  expect(panel!.x - (ring!.x + ring!.width)).toBeLessThanOrEqual(36)

  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(page.locator('[data-login-phase="closed"]')).toBeVisible({ timeout: webkitTransitionTimeout(browserName) })
})

test('login task fits 1024, 768 and 320 CSS px without overflow or hidden actions', async ({ page }) => {
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 320, height: 720 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
    await page.getByRole('button', { name: '登录 LifeOps' }).click()
    const dialog = page.getByRole('dialog', { name: 'LifeOps 登录窗口' })
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(720)

    const bounds = await dialog.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await expect(page.getByRole('button', { name: '关闭登录窗口' })).toBeInViewport()
    await expect(page.getByRole('button', { name: '进入 LifeOps' })).toBeInViewport()
  }
})
