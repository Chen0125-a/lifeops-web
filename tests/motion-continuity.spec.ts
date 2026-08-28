import { expect, test } from '@playwright/test'
import { installPrivateCoreFixture } from './private-core-fixtures'
import { probeVerticalScrollOwners, recordMotionFrames, waitForStableFrameCadence } from './helpers/motionProbe'

test.use({ trace: 'off' })

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
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  const trigger = page.getByRole('button', { name: '登录 LifeOps' })
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
  if (browserName === 'webkit') await waitForStableFrameCadence(page, 420, 12)
  await trigger.click()
  await expect(page.getByLabel('账号')).toBeFocused()
  await page.waitForTimeout(140)
  const before = await page.locator('[data-public-orbit]').evaluate((element) => {
    const stage = element.querySelector<HTMLElement>('[data-orbit-reference-stage]')!
    const bounds = stage.getBoundingClientRect()
    return {
      layoutResizing: stage.dataset.layoutResizing ?? null,
      width: bounds.width,
      y: bounds.y,
    }
  })
  const reverseMetrics = await page.evaluate(async (initialState) => {
    type ReverseFrame = {
      elapsedMs: number
      layoutResizing: string | null
      phase: string | null
      sceneScale: string
      sceneState: string | null
      stageTransform: string
      width: number
      y: number
    }
    const readStage = () => {
      const orbit = document.querySelector<HTMLElement>('[data-public-orbit]')!
      const stage = orbit.querySelector<HTMLElement>('[data-orbit-reference-stage]')!
      const bounds = stage.getBoundingClientRect()
      const stageStyle = getComputedStyle(stage)
      return {
        layoutResizing: stage.dataset.layoutResizing ?? null,
        sceneScale: stageStyle.getPropertyValue('--scene-scale').trim(),
        sceneState: orbit.dataset.sceneState ?? null,
        stageTransform: stageStyle.transform,
        width: bounds.width,
        y: bounds.y,
      }
    }
    const startedAt = performance.now()
    const frames: ReverseFrame[] = []
    const mediaReduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const orbitReduced = document.querySelector<HTMLElement>('[data-public-orbit]')?.dataset.reducedMotion ?? null
    const historyState = { ...(window.history.state ?? {}) }
    delete historyState['lifeops-login-task']
    window.history.replaceState(historyState, '', window.location.href)
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    const immediatePhase = document.querySelector<HTMLElement>('.public-home')?.dataset.loginPhase ?? null
    while (performance.now() - startedAt < 1_200) {
      const now = await new Promise<number>((resolveFrame) => {
        const fallback = window.setTimeout(() => resolveFrame(performance.now()), 16)
        requestAnimationFrame((frameTime) => {
          window.clearTimeout(fallback)
          resolveFrame(frameTime)
        })
      })
      const phase = document.querySelector<HTMLElement>('.public-home')?.dataset.loginPhase ?? null
      frames.push({
        elapsedMs: now - startedAt,
        phase,
        ...readStage(),
      })
      if (phase === 'closed') break
    }
    const closingStarted = frames.find((frame) => frame.phase === 'closing')
    const firstMovement = frames.find((frame) => frame.phase === 'closing' && (
      innerWidth >= 900
        ? frame.width > initialState.width + 0.1
        : frame.y > initialState.y + 0.1
    ))
    const closed = frames.find((frame) => frame.phase === 'closed')
    return {
      closedMs: closingStarted && closed ? closed.elapsedMs - closingStarted.elapsedMs : null,
      finalWidth: closed?.width ?? null,
      finalY: closed?.y ?? null,
      finalSceneScale: closed?.sceneScale ?? null,
      finalSceneState: closed?.sceneState ?? null,
      finalStageTransform: closed?.stageTransform ?? null,
      firstPhase: frames[0]?.phase ?? null,
      firstLayoutResizing: frames[0]?.layoutResizing ?? null,
      firstSceneScale: frames[0]?.sceneScale ?? null,
      firstSceneState: frames[0]?.sceneState ?? null,
      firstStageTransform: frames[0]?.stageTransform ?? null,
      firstMovementMs: closingStarted && firstMovement ? firstMovement.elapsedMs - closingStarted.elapsedMs : null,
      immediatePhase,
      initialWidth: initialState.width,
      initialY: initialState.y,
      initialLayoutResizing: initialState.layoutResizing,
      intermediateFrames: frames.filter((frame) => frame.phase === 'closing').length,
      layoutResizingFrames: frames.filter((frame) => frame.layoutResizing === 'true').length,
      mediaReduced,
      orbitReduced,
    }
  }, before)
  const reverseTimeout = browserName === 'webkit' ? 12_000 : 5_000
  await expect(trigger).toBeFocused()
  await expect(page.locator('[data-login-phase="closed"]')).toBeVisible({ timeout: reverseTimeout })
  expect(reverseMetrics.firstMovementMs, JSON.stringify(reverseMetrics)).not.toBeNull()
  expect(reverseMetrics.firstMovementMs!).toBeLessThanOrEqual(360)
  expect(reverseMetrics.intermediateFrames).toBeGreaterThan(0)
  expect(reverseMetrics.closedMs).not.toBeNull()
  expect(reverseMetrics.closedMs!).toBeGreaterThanOrEqual(300)
  expect(reverseMetrics.closedMs!).toBeLessThanOrEqual(900)
  if (browserName === 'webkit') {
    if (await page.evaluate(() => innerWidth >= 900)) {
      expect(reverseMetrics.finalWidth!).toBeGreaterThan(reverseMetrics.initialWidth)
    } else {
      expect(reverseMetrics.finalY!).toBeGreaterThan(reverseMetrics.initialY)
    }
  }

  const detailTrigger = page.locator('[data-public-object="doing"]')
  await detailTrigger.focus()
  await page.keyboard.press('Enter')
  const exit = page.locator('[data-fixed-return]')
  await expect(exit).toBeVisible()
  expect(await exit.evaluate((element) => ['fixed', 'sticky'].includes(getComputedStyle(element).position))).toBe(true)
})

test('private routing keeps the shell and outgoing panel, restores focus and never paints white', async ({ page, browserName }) => {
  await installPrivateCoreFixture(page)
  await page.goto('/app/overview')
  const navigation = page.getByRole('region', { name: '最近记录' }).getByRole('link', { name: '全部记录' })
  await navigation.focus()
  await expect(navigation, 'Keyboard intent should evaluate the Records route before the transition sample.')
    .toHaveAttribute('data-route-preload-state', 'ready')
  if (browserName === 'webkit') await waitForStableFrameCadence(page, 360, 10)
  const framePromise = recordMotionFrames(page, 360)
  await navigation.click()
  const frames = await framePromise
  await expect(page.getByRole('heading', { name: '记录', level: 1 })).toBeFocused()
  const routeResources = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry) => entry.name.includes('RecordsPage'))
    .map((entry) => ({ duration: Math.round(entry.duration), name: entry.name, startTime: Math.round(entry.startTime) })))
  expect(frames.length, JSON.stringify({ frames, routeResources })).toBeGreaterThanOrEqual(10)
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
