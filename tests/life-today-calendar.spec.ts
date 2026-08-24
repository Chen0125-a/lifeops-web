import { expect, test } from '@playwright/test'

import './life-workspace.spec'

test('calendar copy keeps one risky mutation pending until the server confirms it', async ({ page }) => {
  let copyCalls = 0
  let releaseCopy: (() => void) | null = null
  await page.route('**/api/v1/life/day-plans/2026-08-21/copy', async (route) => {
    copyCalls += 1
    await new Promise<void>((resolve) => { releaseCopy = resolve })
    await route.abort('internetdisconnected')
  })

  await page.goto('/app/life/calendar?date=2026-08-21')
  await page.getByRole('button', { name: '复制计划' }).click()
  const dialog = page.getByRole('dialog', { name: '复制 2026年8月21日的计划' })
  await dialog.getByLabel('目标日期').fill('2026-08-24')
  const submit = dialog.getByRole('button', { name: '确认复制计划' })
  await submit.click()

  await expect(dialog).toBeVisible()
  await expect(submit).toBeDisabled()
  await submit.evaluate((button: HTMLButtonElement) => button.click())
  expect(copyCalls).toBe(1)

  releaseCopy?.()
  await expect(dialog.getByRole('alert')).toContainText('尚未提交')
  await expect(dialog.getByLabel('目标日期')).toHaveValue('2026-08-24')
})
