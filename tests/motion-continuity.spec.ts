import { expect, test } from '@playwright/test'
import { installPrivateCoreFixture } from './private-core-fixtures'
import { probeVerticalScrollOwners, recordMotionFrames } from './helpers/motionProbe'

test.beforeEach(async ({ page, browserName }, testInfo) => {
  if (browserName === 'webkit') {
    testInfo.setTimeout(90_000)
    await page.bringToFront()
  }
})

test('orbit suspends for explicit pause and document-hidden state with one declared transform owner', async ({ page }) => {
  await page.goto('/')
  const orbit = page.locator('[data-public-orbit]')
  await expect(orbit).toHaveAttribute('data-motion-enhanced', 'true')
  await expect(orbit).toHaveAttribute('data-motion-suspended', 'false')
  await page.getByRole('button', { name: '暂停星盘动画' }).click()
  await expect(orbit).toHaveAttribute('data-motion-suspended', 'true')
  await page.getByRole('button', { name: '继续星盘动画' }).click()
  await expect(orbit).toHaveAttribute('data-motion-suspended', 'false')
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(orbit).toHaveAttribute('data-motion-suspended', 'true')
  await expect(page.locator('[data-public-motion-owner]')).toHaveCount(1)
  await expect(orbit.locator('[data-public-motion-owner]')).toHaveCount(0)
})

test('detail return restores focus, theme and live playheads from the desktop single viewport without a document flash', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('lifeops:theme-override', JSON.stringify({ theme: 'night', expiresAt: Date.now() + 86_400_000 }))
  })
  await page.goto('/')
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
  const beforeScrollOwners = await probeVerticalScrollOwners(page)
  expect(beforeScrollOwners).toEqual([])
  const source = page.locator('[data-public-object="learning"]')
  await source.focus()
  await expect(source).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/learning$/)
  await expect(page.getByRole('heading', { name: '最近在学', level: 1 })).toBeFocused()
  await page.getByRole('button', { name: '返回公开星盘', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('[data-public-theme="night"]')).toBeVisible()
  await expect(page.locator('[data-public-object="learning"]')).toBeFocused()
  await expect.poll(() => probeVerticalScrollOwners(page)).toEqual(beforeScrollOwners)
  const playheads = await page.locator('[data-public-object]').evaluateAll((objects) => objects.map((object) => Number(object.getAttribute('data-restored-playhead'))))
  expect(playheads.every((value) => Number.isFinite(value))).toBe(true)
})

test('interrupted login reverses from the live frame and leaves a fixed usable exit', async ({ page, browserName }) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: '登录 LifeOps' })
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
  await trigger.click()
  await expect(page.getByLabel('账号')).toBeFocused()
  await page.waitForTimeout(140)
  const sceneWitness = () => page.locator('[data-public-orbit]').evaluate((element) => JSON.stringify({
    stageLeft: getComputedStyle(element.querySelector('[data-orbit-reference-stage]')!).left,
    stageOpacity: getComputedStyle(element.querySelector('[data-orbit-reference-stage]')!).opacity,
    stageTransform: getComputedStyle(element.querySelector('[data-orbit-reference-stage]')!).transform,
  }))
  const before = await sceneWitness()
  await page.keyboard.press('Escape')
  if (browserName === 'webkit') {
    await expect.poll(sceneWitness, { timeout: 12_000 }).not.toBe(before)
  } else {
    await page.waitForTimeout(80)
  }
  const after = await sceneWitness()
  expect(after).not.toBe(before)
  await expect(trigger).toBeFocused()
  await expect(page.locator('[data-login-phase="closed"]')).toBeVisible({ timeout: browserName === 'webkit' ? 12_000 : 5_000 })

  const detailTrigger = page.locator('[data-public-object="doing"]')
  await detailTrigger.focus()
  await page.keyboard.press('Enter')
  const exit = page.locator('[data-fixed-return]')
  await expect(exit).toBeVisible()
  expect(await exit.evaluate((element) => ['fixed', 'sticky'].includes(getComputedStyle(element).position))).toBe(true)
})

test('private routing keeps the shell and outgoing panel, restores focus and never paints white', async ({ page }) => {
  await installPrivateCoreFixture(page)
  await page.goto('/app/overview')
  const navigation = page.getByRole('region', { name: '最近记录' }).getByRole('link', { name: '全部记录' })
  await navigation.focus()
  const framePromise = recordMotionFrames(page, 360)
  await navigation.click()
  const frames = await framePromise
  await expect(page.getByRole('heading', { name: '记录', level: 1 })).toBeFocused()
  expect(frames.length).toBeGreaterThanOrEqual(10)
  expect(frames.every((frame) => frame.main && frame.shell && frame.routePanels >= 1 && !frame.whiteFrame), JSON.stringify(frames)).toBe(true)
  await page.goBack()
  await expect(page.getByRole('region', { name: '最近记录' }).getByRole('link', { name: '全部记录' })).toBeFocused()
})

test('reduced-motion aperture preserves authenticated entry semantics within 80ms', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '把日子，慢慢看清。' })).toHaveAttribute(
    'data-title-state',
    'complete',
  )
  await expect(page.locator('[data-testid="public-title-cursor"]')).toHaveCount(0)
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await page.getByLabel('账号').fill('motion@lifeops.local')
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('local-preview')
  await page.evaluate(() => {
    type Probe = { startedAt?: number; completedAt?: number }
    const runtime = window as typeof window & { __reducedEntryProbe?: Probe }
    runtime.__reducedEntryProbe = {}
    const originalPushState = history.pushState.bind(history)
    history.pushState = ((...args: Parameters<History['pushState']>) => {
      if (String(args[2] ?? '').startsWith('/app')) runtime.__reducedEntryProbe!.completedAt = performance.now()
      return originalPushState(...args)
    }) as History['pushState']
    const observer = new MutationObserver(() => {
      if (!runtime.__reducedEntryProbe!.startedAt && document.querySelector('[data-entry-motion="reduced"]')) {
        runtime.__reducedEntryProbe!.startedAt = performance.now()
      }
      if (runtime.__reducedEntryProbe!.completedAt) observer.disconnect()
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
  await page.getByRole('button', { name: '进入 LifeOps' }).click()
  await expect(page).toHaveURL(/\/app\/overview$/, { timeout: 2_000 })
  const elapsed = await page.evaluate(() => {
    const probe = (window as typeof window & { __reducedEntryProbe?: { startedAt?: number; completedAt?: number } }).__reducedEntryProbe
    if (!probe?.startedAt || !probe.completedAt) throw new Error('Reduced-motion entry probe did not observe both boundaries')
    return probe.completedAt - probe.startedAt
  })
  expect(elapsed).toBeLessThanOrEqual(80)
  await expect(page.locator('[data-private-shell]')).toBeVisible()
})
