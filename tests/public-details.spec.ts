import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { screenshotToPath } from './helpers/screenshotToPath'

const categories = ['now', 'doing', 'learning', 'moments', 'archive'] as const
const layouts = {
  now: 'status-rhythm',
  doing: 'project-ledger',
  learning: 'learning-notebook',
  moments: 'moment-stream',
  archive: 'archive-index',
} as const
const viewports = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1024', width: 1024, height: 768 },
  { name: '768', width: 768, height: 1024 },
  { name: '390', width: 390, height: 844 },
] as const
const evidenceDir = resolve('outputs/evidence/browser/p2-t4')

function fixture(category: typeof categories[number]) {
  return [1, 2, 3].map((index) => ({
    id: `${category}-${index}`,
    slug: `${category}-published-${index}`,
    category,
    title: `${category === 'now' ? '此刻' : category === 'doing' ? '行动' : category === 'learning' ? '学习' : category === 'moments' ? '切片' : '档案'} · ${index}`,
    excerpt: `这是经过明确发布的${category}摘要 ${index}，不包含私人原文。`,
    coverUrl: null,
    publishedAt: `2026-08-${String(16 - index).padStart(2, '0')}T09:30:00.000Z`,
    featured: index === 1,
  }))
}

async function installPublicContentFixtures(page: Page, overrides: Partial<Record<typeof categories[number], 'error' | []>> = {}) {
  await page.route('**/api/v1/public/content?*', async (route) => {
    const category = new URL(route.request().url()).searchParams.get('category') as typeof categories[number]
    if (overrides[category] === 'error') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '公开内容暂时不可用' } }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overrides[category] ?? fixture(category)) })
  })
}

test.beforeEach(async ({ page }) => {
  await mkdir(evidenceDir, { recursive: true })
  await page.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('lifeops:theme-override', JSON.stringify({ theme: 'night', expiresAt: Date.now() + 86_400_000 }))
  })
})

test('all five page-native details pass the four approved breakpoints', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await installPublicContentFixtures(page)
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const category of categories) {
      await page.goto(`/${category}`)
      const detail = page.locator('[data-public-detail-layout]')
      await expect(detail).toHaveAttribute('data-public-detail-layout', layouts[category])
      await expect(page.getByText('正在读取已发布内容…')).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByRole('button', { name: '返回公开星盘', exact: true })).toBeVisible()
      expect(await page.locator('[data-fixed-return]').evaluate((node) => node.getBoundingClientRect().height)).toBe(64)
      expect(await page.getByTestId('public-detail-related').locator(':scope > *').count()).toBeGreaterThanOrEqual(2)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
      if (viewport.width === 390) await expect(page.getByRole('button', { name: '返回公开星盘（底部）' })).toBeVisible()
      else await expect(page.getByRole('button', { name: '返回公开星盘（底部）' })).toBeHidden()
      await screenshotToPath(page, { path: resolve(evidenceDir, `detail-${category}-${viewport.name}.png`), fullPage: true })
    }
  }
  expect(browserErrors).toEqual([])
})

test('browser Back, fixed return and Escape restore exact public context', async ({ page }) => {
  await installPublicContentFixtures(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
  const learning = page.getByRole('link', { name: '探索最近在学' })
  const sourceScroll = await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto'
    document.body.style.minHeight = '1400px'
    window.scrollTo(0, 210)
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()))
    const capturedScroll = window.scrollY
    document.getElementById('public-object-learning')?.click()
    return capturedScroll
  })
  expect(sourceScroll).toBeGreaterThan(150)
  await expect(page).toHaveURL(/\/learning$/)
  const captured = await page.evaluate(() => JSON.parse(sessionStorage.getItem('lifeops:public-return:v1') ?? 'null'))
  expect(Object.keys(captured.objectPlayheads).sort()).toEqual(['archive', 'doing', 'learning', 'moments', 'now'])
  expect(captured).toMatchObject({ sourceObjectId: 'learning', theme: 'night', sourceFocusId: 'public-object-learning' })
  await expect(page.locator('[data-flip-id="public-object-learning"]')).toHaveCount(1)
  await page.waitForTimeout(380)
  await expect(page.locator('[data-flip-id]')).toHaveCount(0)

  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: '探索最近在学' })).toBeFocused()
  await expect(page.locator('.public-home')).toHaveAttribute('data-public-theme', 'night')
  expect(await page.evaluate(() => sessionStorage.getItem('lifeops:public-return:v1'))).toBeNull()
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(150)

  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
  await page.getByRole('link', { name: '探索最近在学' }).press('Enter')
  await page.getByRole('button', { name: '返回公开星盘', exact: true }).click()
  await expect(page.getByRole('link', { name: '探索最近在学' })).toBeFocused()

  await expect(page.locator('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true')
  await page.getByRole('link', { name: '探索最近在学' }).press('Enter')
  await expect(page).toHaveURL(/\/learning$/)
  await expect(page.getByRole('heading', { name: '最近在学', level: 1 })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: '探索最近在学' })).toBeFocused()
})

test('direct entry, reduced motion, empty and error states remain truthful', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await installPublicContentFixtures(page, { archive: [], moments: 'error' })

  await page.goto('/archive')
  await expect(page.getByTestId('public-detail-shell')).toHaveAttribute('data-direct-entry', 'true')
  await expect(page.locator('[data-flip-id]')).toHaveCount(0)
  await expect(page.getByText('这个栏目暂时没有已发布内容。')).toBeVisible()
  expect(await page.getByTestId('public-detail-related').locator(':scope > *').count()).toBeGreaterThanOrEqual(2)
  await screenshotToPath(page, { path: resolve(evidenceDir, 'detail-archive-empty-390.png'), fullPage: true })

  await page.goto('/moments')
  await expect(page.getByRole('alert')).toContainText('暂时无法读取公开内容')
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await screenshotToPath(page, { path: resolve(evidenceDir, 'detail-moments-error-390.png'), fullPage: true })
})
