import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const evidenceDir = resolve('outputs/evidence/browser/p4-t3')

async function mountSettings(page: Page, mode: 'fallback' | 'granted' | 'denied') {
  await page.goto('/')
  await page.evaluate(async (selectedMode) => {
    await import('/assets/obsidian-browser-harness.js')
    const values = window as unknown as {
      __mountObsidianSettings(mode: typeof selectedMode): void
    }
    values.__mountObsidianSettings(selectedMode)
  }, mode)
  await expect(page.getByRole('heading', { name: 'Obsidian 人工同步' })).toBeVisible()
  await page.evaluate(() => scrollTo(0, 0))
}

test('standalone Obsidian settings preserves preview-before-apply, fallback, permission and responsive contracts', async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true })
  await mountSettings(page, 'fallback')
  await expect(page.getByText(/浏览器不支持文件夹连接/)).toBeVisible()
  await page.getByRole('button', { name: '导出 ZIP' }).focus()
  await expect(page.getByRole('button', { name: '导出 ZIP' })).toBeFocused()
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__obsidianExportCount)).toBe(1)
  await expect(page.getByRole('link', { name: '在 Obsidian 中打开' })).toHaveAttribute(
    'href',
    'obsidian://open?vault=%E6%88%91%E7%9A%84%20Vault&file=LifeOps%2FKnowledge%2F%E8%AF%81%E6%8D%AE%201.md',
  )

  for (const viewport of [
    { width: 1440, height: 900, file: 'settings-fallback-1440x900.png' },
    { width: 1024, height: 768, file: 'settings-fallback-1024x768.png' },
    { width: 768, height: 1024, file: 'settings-fallback-768x1024.png' },
    { width: 390, height: 844, file: 'settings-fallback-390x844.png' },
  ]) {
    await page.setViewportSize(viewport)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: resolve(evidenceDir, viewport.file), fullPage: true })
  }

  await page.setViewportSize({ width: 320, height: 900 })
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: resolve(evidenceDir, 'settings-fallback-320x900-200pct.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => { document.documentElement.style.fontSize = '' })
  await mountSettings(page, 'granted')
  await page.getByRole('button', { name: '连接文件夹' }).click()
  await expect(page.getByText('已连接 · Life vault')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('2 项 · 1 个冲突')
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__obsidianApplyCount)).toBe(0)
  await expect(page.getByRole('button', { name: '确认并应用' })).toBeDisabled()
  await page.getByRole('group', { name: 'note-2 冲突处理' }).getByRole('button', { name: '保留 Web 版本' }).click()
  await page.screenshot({ path: resolve(evidenceDir, 'settings-preview-390x844.png'), fullPage: true })
  await page.getByRole('button', { name: '确认并应用' }).click()
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__obsidianApplyCount)).toBe(1)

  await mountSettings(page, 'denied')
  await page.getByRole('button', { name: '连接文件夹' }).click()
  await expect(page.getByRole('alert')).toContainText('权限被拒绝')
  await expect(page.getByText(/已连接/)).toHaveCount(0)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mountSettings(page, 'fallback')
  expect(await page.locator('#obsidian-browser-harness').evaluate((root) => root.getAnimations().length)).toBe(0)
  await page.screenshot({ path: resolve(evidenceDir, 'settings-fallback-390x844-reduced-motion.png'), fullPage: true })
})
