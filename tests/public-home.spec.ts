import { expect, test } from '@playwright/test'
import { waitForStableFrameCadence } from './helpers/motionProbe'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/public/content?*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]',
  }))
  await page.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('lifeops:theme-override', JSON.stringify({ theme: 'day', expiresAt: Date.now() + 86_400_000 }))
  })
  await page.goto('/')
  await page.bringToFront()
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
})

test('five semantic objects follow four layered orbit tracks and keep moving', async ({ page }) => {
  const objects = page.locator('[data-public-object]')
  await expect(objects).toHaveCount(5)
  await expect(page.locator('[data-orbit-track]')).toHaveCount(0)
  await expect(page.locator('[data-orbit-path]')).toHaveCount(4)
  await expect(page.locator('a[href^="/explore/"]')).toHaveCount(0)

  for (const [slug, path] of [
    ['now', '/now'],
    ['doing', '/doing'],
    ['learning', '/learning'],
    ['moments', '/moments'],
    ['archive', '/archive'],
  ] as const) {
    const destination = page.locator(`[data-public-object="${slug}"]`)
    await expect(destination).toHaveAttribute('href', path)
    await expect(destination).toHaveAttribute('data-orbit-id', /^orbit-[a-d]$/)
    await expect(destination).toHaveAttribute('data-object-paused', 'false')
  }

  await page.waitForTimeout(2_250)

  const doing = page.locator('[data-public-object="doing"]')
  const before = await doing.boundingBox()
  await page.waitForTimeout(900)
  const after = await doing.boundingBox()
  expect(Math.hypot((after?.x ?? 0) - (before?.x ?? 0), (after?.y ?? 0) - (before?.y ?? 0))).toBeGreaterThan(3)

  await page.getByRole('button', { name: '暂停星盘动画' }).click()
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-suspended', 'true')
  const pausedBefore = await doing.boundingBox()
  await page.waitForTimeout(450)
  const pausedAfter = await doing.boundingBox()
  expect(Math.hypot((pausedAfter?.x ?? 0) - (pausedBefore?.x ?? 0), (pausedAfter?.y ?? 0) - (pausedBefore?.y ?? 0))).toBeLessThanOrEqual(0.5)

  await page.getByRole('button', { name: '继续星盘动画' }).click()
  await doing.focus()
  await expect(doing).toHaveAttribute('data-object-paused', 'true')
  const focusedBefore = await doing.boundingBox()
  await page.waitForTimeout(450)
  const focusedAfter = await doing.boundingBox()
  expect(Math.hypot((focusedAfter?.x ?? 0) - (focusedBefore?.x ?? 0), (focusedAfter?.y ?? 0) - (focusedBefore?.y ?? 0))).toBeLessThanOrEqual(0.5)

  await page.keyboard.press('Tab')
  await expect(doing).toHaveAttribute('data-object-paused', 'false')
  await expect(page.locator('[data-orbit-label="always"]')).toHaveCount(5)
  for (const label of await page.locator('[data-orbit-label="always"]').all()) {
    await expect(label).toBeVisible()
  }
})

test('night theme restores a near-black deep-sky surface with layered stars', async ({ page }) => {
  await page.getByRole('button', { name: '切换为夜间主题' }).click()
  await expect(page.locator('.public-home')).toHaveAttribute('data-public-theme', 'night')

  const starField = page.locator('[data-star-field]')
  await expect(starField).toHaveCount(1)
  await expect(page.locator('.public-home')).toHaveCSS('background-color', 'rgb(2, 3, 6)')
  const night = await page.locator('.public-home').evaluate(async (element) => {
    const surface = getComputedStyle(element)
    const stars = element.querySelector<HTMLImageElement>('[data-star-field]')!
    const starAsset = await fetch('/public-stars.svg').then((response) => response.text())
    const tracks = [...element.querySelectorAll<HTMLElement>('[data-orbit-ring]')]
    return {
      backgroundColor: surface.backgroundColor,
      skyBackgroundImage: getComputedStyle(element.querySelector('.public-sky')!).backgroundImage,
      starFieldOpacity: Number(getComputedStyle(element.querySelector('.public-sky__stars')!).opacity),
      starLayers: [...starAsset.matchAll(/id="layer-(far|middle|near)"/g)].map((match) => match[1]),
      starSource: new URL(stars.currentSrc || stars.src).pathname,
      starsLoaded: stars.complete && stars.naturalWidth === 1440 && stars.naturalHeight === 900,
      trackPaint: tracks.map((track) => ({
        legacyContent: getComputedStyle(track, '::before').content,
        markerBackground: getComputedStyle(track.querySelector('[data-orbit-track-motion]')!).backgroundColor,
      })),
      trackStrokes: [...element.querySelectorAll<HTMLElement>('[data-orbit-track-static]')]
        .map((track) => getComputedStyle(track).borderTopColor),
    }
  })

  expect(night.backgroundColor).toBe('rgb(2, 3, 6)')
  expect(night.skyBackgroundImage).toContain('/public-stars-raster.png')
  expect(night.starFieldOpacity).toBeGreaterThanOrEqual(0.99)
  expect(night.starLayers).toEqual(['far', 'middle', 'near'])
  expect(night.starSource).toBe('/public-stars-raster.png')
  expect(night.starsLoaded).toBe(true)
  expect(night.trackPaint).toHaveLength(4)
  expect(night.trackPaint.every(({ legacyContent }) => legacyContent === 'none')).toBe(true)
  expect(night.trackPaint.every(({ markerBackground }) => markerBackground === 'rgba(217, 161, 255, 0.92)')).toBe(true)
  expect(night.trackStrokes).toEqual(Array(4).fill('rgba(217, 161, 255, 0.38)'))
})

test('the desktop homepage is one viewport scene and object details provide an exit', async ({ page }) => {
  await expect(page.locator('.public-home')).toHaveAttribute('data-public-scene', 'rest')
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 2)).toBe(true)
  await expect(page.getByRole('navigation', { name: '公开内容导航' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '一条从计划到理解的生活闭环' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '正在建设的 LifeOps' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '最近留下的三条线索' })).toHaveCount(0)

  const learning = page.getByRole('link', { name: '探索最近在学' })
  await learning.focus()
  await learning.press('Enter')
  await expect(page).toHaveURL(/\/learning$/)
  await expect(page.getByRole('heading', { name: '最近在学', level: 1 })).toBeFocused()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(page.locator('[data-sticky-exit]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/$/)
})

test('the day-night transition stays inside the interaction frame budget', async ({ page, browserName }) => {
  await expect(page.getByRole('heading', { name: '把日子，慢慢看清。' })).toHaveAttribute(
    'data-title-state',
    'complete',
  )
  const sampleFrames = (duration: number) => page.evaluate(async (sampleDuration) => {
    const durations: number[] = []
    let previous = performance.now()
    const started = previous
    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        durations.push(now - previous)
        previous = now
        const progress = Math.min(1, (now - started) / sampleDuration)
        if (progress < 1) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
    return durations.slice(2)
  }, duration)
  const percentile95 = (samples: number[]) => {
    const sorted = [...samples].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length * 0.95)] ?? Infinity
  }

  if (browserName === 'firefox' || browserName === 'webkit') {
    await waitForStableFrameCadence(page, 600, 10)
  }
  const baseline = await sampleFrames(600)
  await page.getByRole('button', { name: '切换为夜间主题' }).click()
  const transition = await sampleFrames(1_200)
  const baselineP95 = percentile95(baseline)
  const transitionP95 = percentile95(transition)
  const p95Budget = Math.max(34, baselineP95 + 17)
  const baselineMax = Math.max(...baseline)
  const transitionMax = Math.max(...transition)
  const maxBudget = Math.max(100, baselineMax + 50)
  const cadenceEvidence = JSON.stringify({
    baseline,
    baselineP95,
    baselineMax,
    transition,
    transitionP95,
    transitionMax,
    p95Budget,
    maxBudget,
  })
  expect(baseline.length).toBeGreaterThan(0)
  expect(transition.length).toBeGreaterThan(0)
  expect(transitionP95, cadenceEvidence).toBeLessThanOrEqual(p95Budget)
  expect(transitionMax, cadenceEvidence).toBeLessThanOrEqual(maxBudget)
})

test('visible object labels stay separate at desktop and phone widths', async ({ page }) => {
  await page.getByRole('button', { name: '切换为夜间主题' }).click()
  await expect(page.getByRole('heading', { name: '把日子，慢慢看清。' })).toHaveAttribute('data-title-state', 'complete')
  await page.getByRole('button', { name: '暂停星盘动画' }).click()

  const inspectLabels = () => page.evaluate(() => {
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
        if (
          a.rect.left < b.rect.right
          && a.rect.right > b.rect.left
          && a.rect.top < b.rect.bottom
          && a.rect.bottom > b.rect.top
        ) {
          overlaps.push(`${a.slug}:${b.slug}`)
        }
      }
    }

    return {
      clipped: labels.filter(({ rect }) => (
        rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight
      )).map(({ slug }) => slug),
      overlaps,
    }
  })

  expect(await inspectLabels()).toEqual({ clipped: [], overlaps: [] })

  const layoutRevision = Number(await page.locator('[data-public-orbit]').getAttribute('data-layout-revision'))
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => Number(await page.locator('[data-public-orbit]').getAttribute('data-layout-revision'))).toBeGreaterThan(layoutRevision)
  expect(await inspectLabels()).toEqual({ clipped: [], overlaps: [] })

  await page.evaluate(() => sessionStorage.setItem('lifeops:public-return:v1', JSON.stringify({
    sourceObjectId: 'now',
    objectPlayheads: { now: 0.032, doing: 0.025, learning: 0.022, moments: 0.019, archive: 0.017 },
    homeScrollY: 0,
    theme: 'night',
    sourceFocusId: 'public-object-now',
  })))
  await page.setViewportSize({ width: 320, height: 720 })
  await page.reload()
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
  await page.getByRole('button', { name: '暂停星盘动画' }).click()
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-suspended', 'true')
  expect(await inspectLabels()).toEqual({ clipped: [], overlaps: [] })

  await page.getByRole('button', { name: '继续星盘动画' }).click()
  const movingLabelFrames = await page.evaluate(async () => {
    const failures: Array<{
      clipped: string[]
      frame: number
      labels: Array<{
        angle: string
        bottom: number
        left: number
        objectX?: number
        objectY?: number
        radius: string
        right: number
        slug: string
        top: number
        trackTransform: string
      }>
      overlaps: string[]
    }> = []
    for (let frame = 0; frame < 50; frame += 1) {
      await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()))
      const labels = [...document.querySelectorAll<HTMLElement>('.public-object__label')]
        .filter((label) => {
          const style = getComputedStyle(label)
          return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0
        })
        .map((label) => {
          const object = label.closest<HTMLElement>('[data-public-object]')
          const track = object?.closest<HTMLElement>('[data-object-track]')
          return {
            angle: track ? getComputedStyle(track).getPropertyValue('--arrival-angle') : '',
            objectRect: object?.getBoundingClientRect(),
            radius: track ? getComputedStyle(track).getPropertyValue('--arrival-radius') : '',
            rect: label.getBoundingClientRect(),
            slug: object?.getAttribute('data-public-object') ?? '',
            trackTransform: track ? getComputedStyle(track).transform : '',
          }
        })
      const clipped = labels.filter(({ rect }) => (
        rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight
      )).map(({ slug }) => slug)
      const overlaps: string[] = []
      for (let leftIndex = 0; leftIndex < labels.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < labels.length; rightIndex += 1) {
          const left = labels[leftIndex]
          const right = labels[rightIndex]
          if (
            left.rect.left < right.rect.right
            && left.rect.right > right.rect.left
            && left.rect.top < right.rect.bottom
            && left.rect.bottom > right.rect.top
          ) overlaps.push(`${left.slug}:${right.slug}`)
        }
      }
      if (clipped.length || overlaps.length) failures.push({
        clipped,
        frame,
        labels: labels.map(({ angle, objectRect, radius, rect, slug, trackTransform }) => ({
          angle,
          bottom: rect.bottom,
          left: rect.left,
          objectX: objectRect?.x,
          objectY: objectRect?.y,
          radius,
          right: rect.right,
          slug,
          top: rect.top,
          trackTransform,
        })),
        overlaps,
      })
    }
    return failures
  })
  expect(movingLabelFrames).toEqual([])
})

test('the approved two-line headline survives the 1024px desktop composition', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  const headline = page.getByRole('heading', { name: /把日子/ })
  await expect(headline).toBeVisible()

  const renderedLines = await headline.evaluate((element) => {
    const style = getComputedStyle(element)
    return element.getBoundingClientRect().height / Number.parseFloat(style.lineHeight)
  })

  expect(renderedLines).toBeLessThanOrEqual(2.1)
})
