import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { installLifeFixture } from './life-fixtures'

const outputDir = resolve('outputs', 'evidence', 'browser', 'p3-t8')

async function expectNoUncontainedHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => {
    const root = document.documentElement
    const offenders = Array.from(document.body.querySelectorAll<HTMLElement>('*')).flatMap((element) => {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0 || (rect.left >= -1 && rect.right <= root.clientWidth + 1)) return []
      let ancestor = element.parentElement
      while (ancestor && ancestor !== document.body) {
        const overflow = getComputedStyle(ancestor).overflowX
        if (['auto', 'scroll', 'hidden', 'clip'].includes(overflow)) return []
        ancestor = ancestor.parentElement
      }
      return [{ tag: element.tagName.toLowerCase(), className: String(element.className), left: Math.round(rect.left), right: Math.round(rect.right) }]
    }).slice(0, 12)
    return { fits: root.scrollWidth <= root.clientWidth + 1, clientWidth: root.clientWidth, scrollWidth: root.scrollWidth, offenders }
  })
  expect(geometry.fits, JSON.stringify(geometry)).toBe(true)
}

test.beforeEach(async ({ page }) => installLifeFixture(page))

test('life today and calendar preserve the approved facts, focus and browser history', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/app/life?date=2026-08-21')

  await expect(page.getByRole('heading', { name: '今日生活', level: 1 })).toBeFocused()
  await expect(page.getByRole('navigation', { name: '私人空间导航' })).toContainText('总览目标与项目日程习惯记录回顾知识生活发布平台')
  await expect(page.getByRole('navigation', { name: '生活工作台导航' })).toContainText('今日计划食谱库存健身采购分析数据')
  await expect(page.getByRole('region', { name: '今日时间线' })).toContainText('燕麦与鸡蛋早餐')
  await expect(page.getByRole('region', { name: '营养事实' })).toContainText('2180 kcal')
  await expect(page.getByRole('region', { name: '成本与预算' })).toContainText('现金支出 ¥684.00')
  await expect(page.getByRole('region', { name: '库存与采购提醒' })).toContainText('燕麦预计短缺 40 g')
  await expect(page.locator('.private-orrery, [data-private-sidebar], [class*="universe"]')).toHaveCount(0)
  await expectNoUncontainedHorizontalOverflow(page)

  const header = page.locator('.workspace-header')
  await header.evaluate((element) => element.setAttribute('data-life-stable-header', 'true'))
  const trigger = page.getByRole('link', { name: '打开生活日历' })
  await trigger.click()
  await expect(page).toHaveURL(/\/app\/life\/calendar\?date=2026-08-21$/)
  await expect(page.getByRole('dialog', { name: '生活日历' })).toBeVisible()
  await expect(page.getByRole('button', { name: '关闭生活日历' })).toBeFocused()
  await expect(header).toHaveAttribute('data-life-stable-header', 'true')
  const selectedDay = page.getByRole('button', { name: /8月21日.*今天.*已选中.*过去未完成/ })
  const conflictedDay = page.getByRole('button', { name: /8月22日.*有冲突/ })
  await expect(selectedDay).toHaveAttribute('data-state', 'past-incomplete')
  await expect(conflictedDay).toHaveAttribute('data-state', 'conflicted')

  await selectedDay.focus()
  await page.keyboard.press('ArrowRight')
  await expect(conflictedDay).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/date=2026-08-22$/)
  await expect(page.getByRole('region', { name: '2026年8月22日摘要' })).toContainText('实际营养：数据不完整')
  await page.goBack()
  await expect(page).toHaveURL(/\/app\/life\?date=2026-08-21$/)
  await expect(page.getByRole('heading', { name: '今日生活', level: 1 })).toBeVisible()
  await expect(trigger).toBeFocused()

  await trigger.click()
  await expect(page.getByRole('dialog', { name: '生活日历' })).toBeVisible()
  await expect(page.getByRole('button', { name: '关闭生活日历' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/app\/life\?date=2026-08-21$/)
  await expect(trigger).toBeFocused()
})

test('calendar copy submits only a source date and explicit target date', async ({ page }) => {
  await page.goto('/app/life/calendar?date=2026-08-21')
  await expect(page.getByRole('dialog', { name: '生活日历' })).toBeVisible()
  await page.getByRole('button', { name: '复制计划' }).click()
  const confirmation = page.getByRole('dialog', { name: '复制 2026年8月21日的计划' })
  await expect(confirmation).toContainText('只复制计划，不复制完成状态、实际记录、历史快照或库存事务')
  await confirmation.getByLabel('目标日期').fill('2026-08-24')
  const requestPromise = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/api/v1/life/day-plans/2026-08-21/copy'))
  await confirmation.getByRole('button', { name: '确认复制计划' }).click()
  const request = await requestPromise
  expect(request.postDataJSON()).toEqual({ targetDate: '2026-08-24' })
  expect(request.headers()['x-csrf-token']).toBe('csrf-life-p3-t8')
  expect(request.postData()).not.toContain('actual')
  expect(request.postData()).not.toContain('completion')
})

test('life overview summary and four breakpoints keep one continuous responsive workbench', async ({ page }) => {
  test.setTimeout(90_000)
  mkdirSync(outputDir, { recursive: true })
  const viewports = [
    { name: 'desktop-1440', width: 1440, height: 900 },
    { name: 'tablet-1024', width: 1024, height: 768 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'mobile-390', width: 390, height: 844 },
  ] as const

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/app/life?date=2026-08-21')
    await expect(page.getByRole('heading', { name: '今日生活', level: 1 })).toBeVisible()
    await expectNoUncontainedHorizontalOverflow(page)
    const stripBox = await page.locator('.life-command-strip').boundingBox()
    const headingRegionBox = await page.locator('.life-today__heading').boundingBox()
    const headingBox = await page.getByRole('heading', { name: '今日生活', level: 1 }).boundingBox()
    expect(stripBox).not.toBeNull()
    expect(headingRegionBox).not.toBeNull()
    expect(headingBox).not.toBeNull()
    expect(headingRegionBox!.y, JSON.stringify({ viewport, stripBox, headingRegionBox, headingBox })).toBeGreaterThanOrEqual(stripBox!.y + stripBox!.height - 1)
    if (viewport.width <= 860) {
      const order = await page.evaluate(() => ['.life-next-action', '.life-timeline', '.life-nutrition', '.life-inventory-notices', '.life-budget'].map((selector) => document.querySelector(selector)?.getBoundingClientRect().top ?? -1))
      expect(order, JSON.stringify(order)).toEqual([...order].sort((left, right) => left - right))
    }
    await page.screenshot({ path: resolve(outputDir, `p3-t8-life-today-${viewport.name}.png`), fullPage: false, animations: 'disabled' })

    await page.getByRole('link', { name: '打开生活日历' }).click()
    await expect(page.getByRole('dialog', { name: '生活日历' })).toBeVisible()
    await page.waitForTimeout(320)
    await expectNoUncontainedHorizontalOverflow(page)
    const month = await page.getByRole('region', { name: '2026年8月', exact: true }).boundingBox()
    const summary = await page.getByRole('region', { name: '2026年8月21日摘要' }).boundingBox()
    expect(month).not.toBeNull()
    expect(summary).not.toBeNull()
    if (viewport.width > 860) expect(summary!.x).toBeGreaterThan(month!.x + month!.width * .7)
    else expect(summary!.y).toBeGreaterThan(month!.y + month!.height * .8)
    await page.screenshot({ path: resolve(outputDir, `p3-t8-life-calendar-${viewport.name}.png`), fullPage: false, animations: 'disabled' })
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/app/life?date=2026-08-21')
  await expect(page.getByRole('heading', { name: '今日生活', level: 1 })).toBeVisible()
  await page.screenshot({ path: resolve(outputDir, 'p3-t8-life-today-desktop-full.png'), fullPage: true, animations: 'disabled' })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/life?date=2026-08-21')
  await expect(page.getByRole('heading', { name: '今日生活', level: 1 })).toBeVisible()
  await page.screenshot({ path: resolve(outputDir, 'p3-t8-life-today-mobile-full.png'), fullPage: true, animations: 'disabled' })
  await page.goto('/app/life/calendar?date=2026-08-21')
  await expect(page.getByRole('dialog', { name: '生活日历' })).toBeVisible()
  await page.waitForTimeout(320)
  const mobilePanelCoverage = await page.locator('.life-calendar-panel').evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(
    mobilePanelCoverage.clientHeight,
    `移动端日历面板背景必须覆盖全部顺序内容：${JSON.stringify(mobilePanelCoverage)}`,
  ).toBeGreaterThanOrEqual(mobilePanelCoverage.scrollHeight - 1)
  await page.locator('.life-calendar-overlay').evaluate((element) => { element.scrollTop = element.scrollHeight })
  const persistentCloseBox = await page.getByRole('button', { name: '关闭生活日历' }).boundingBox()
  expect(persistentCloseBox).not.toBeNull()
  expect(persistentCloseBox!.y, JSON.stringify(persistentCloseBox)).toBeGreaterThanOrEqual(112)
  expect(persistentCloseBox!.y + persistentCloseBox!.height, JSON.stringify(persistentCloseBox)).toBeLessThanOrEqual(844)
  await page.screenshot({ path: resolve(outputDir, 'p3-t8-life-calendar-mobile-summary.png'), fullPage: false, animations: 'disabled' })

  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/app/life/calendar?date=2026-08-21')
  await expect(page.getByRole('dialog', { name: '生活日历' })).toBeVisible()
  await page.waitForTimeout(320)
  await page.screenshot({ path: resolve(outputDir, 'p3-t8-life-calendar-desktop-tall.png'), fullPage: false, animations: 'disabled' })

  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/app/overview')
  const summary = page.getByRole('region', { name: '今日生活摘要' })
  await expect(summary).toContainText('1 / 4 已完成')
  await expect(summary).toContainText('下一步：用户记录的维生素 D3')
  await expect(summary.getByRole('link', { name: '打开今日生活' })).toHaveAttribute('href', '/app/life')
  await expect(page.locator('[data-overview-card]')).toHaveCount(0)
})
