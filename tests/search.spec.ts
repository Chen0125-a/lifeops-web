import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const evidenceDir = resolve('outputs/evidence/browser/p5-t4')

const results = [{
  type: 'task', id: 'task-search', title: '平台验收', excerpt: '关闭 P5 搜索工作包', context: '项目 · LifeOps',
  updatedAt: '2026-08-23T00:00:00.000Z', route: '/app/schedule?task=task-search',
}, {
  type: 'recipe', id: 'recipe-search', title: '平台恢复餐', excerpt: '鸡胸肉 西兰花 糙米', context: '食谱 · 2 人份',
  updatedAt: '2026-08-22T00:00:00.000Z', route: '/app/life/recipes?recipe=recipe-search',
}]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.clear()
    sessionStorage.setItem('lifeops:session:v1', JSON.stringify({ mode: 'local-preview', account: 'search@lifeops.local' }))
  })
  await page.route('**/api/v1/search?**', async (route) => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('q')).toBe('平台')
    expect(url.searchParams.get('limit')).toBe('50')
    expect(url.searchParams.get('types')).toBeNull()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: results }) })
  })
})

test('personal command search is grouped, keyboard-operable, private and responsive', async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true })
  await page.goto('/app/overview')
  const opener = page.getByRole('button', { name: '打开全局搜索' })
  await opener.focus()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  const dialog = page.getByRole('dialog', { name: '全局搜索' })
  const searchbox = page.getByRole('searchbox', { name: '搜索 LifeOps' })
  await expect(dialog).toBeVisible()
  await expect(searchbox).toBeFocused()
  await searchbox.fill('平台')
  await expect(page.getByRole('group', { name: '工作推进' })).toBeVisible()
  await expect(page.getByRole('group', { name: '生活管理' })).toBeVisible()
  await expect(page.getByRole('option', { name: '任务 平台验收' })).toBeVisible()
  await expect(page.getByRole('option', { name: '食谱 平台恢复餐' })).toBeVisible()
  await expect(dialog).not.toContainText(/日志|告警|平台状态/)

  for (const viewport of [
    { width: 1440, height: 900, name: 'search-1440x900.png' },
    { width: 1024, height: 768, name: 'search-1024x768.png' },
    { width: 768, height: 1024, name: 'search-768x1024.png' },
    { width: 390, height: 844, name: 'search-390x844.png' },
    { width: 320, height: 900, name: 'search-320x900-reflow.png' },
  ]) {
    await page.setViewportSize(viewport)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${viewport.width} CSS px`).toBe(true)
    await page.screenshot({ path: resolve(evidenceDir, viewport.name), fullPage: true })
  }

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: resolve(evidenceDir, 'search-390x844-reduced-motion.png'), fullPage: true })

  await searchbox.press('ArrowDown')
  await searchbox.press('ArrowDown')
  await searchbox.press('Enter')
  await expect(page).toHaveURL(/\/app\/life\/recipes\?recipe=recipe-search$/)
  await expect(dialog).toHaveCount(0)

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
  await expect(page.getByRole('heading', { name: '最近访问' })).toBeVisible()
  await expect(page.getByRole('link', { name: '食谱 平台恢复餐' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(opener).toBeFocused()
})
