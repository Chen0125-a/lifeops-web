import { expect, test } from '@playwright/test'

test('rejected credentials and transport failure stay in a recoverable login task', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await page.getByLabel('账号').fill('owner@lifeops.local')
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('incorrect-test-value')
  await page.getByRole('button', { name: '进入 LifeOps' }).click()

  await expect(page.getByRole('alert')).toHaveText('账号或密码不正确')
  await expect(page.locator('[data-login-phase="open"]')).toBeVisible()

  await page.route('**/api/v1/auth/login', (route) => route.abort('connectionfailed'))
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('retry-test-value')
  await page.getByRole('button', { name: '进入 LifeOps' }).click()

  await expect(page.getByRole('alert')).toHaveText('网络暂时不可用，请检查连接后重试。')
  await expect(page.locator('[data-login-phase="open"]')).toBeVisible()
})

test('browser Back reverses the login task layer without leaving the public home', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await expect(page.getByRole('dialog', { name: 'LifeOps 登录窗口' })).toBeVisible()

  await page.goBack()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('dialog', { name: 'LifeOps 登录窗口' })).toBeHidden()
  await expect(page.getByRole('button', { name: '登录 LifeOps' })).toBeFocused()
})

test('real API login enters the daylight workspace and persists work', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as typeof window & { __lifeopsTransitions?: number }).__lifeopsTransitions = 0
    const start = document.startViewTransition?.bind(document)
    if (start) {
      document.startViewTransition = ((callback) => {
        ;(window as typeof window & { __lifeopsTransitions?: number }).__lifeopsTransitions =
          ((window as typeof window & { __lifeopsTransitions?: number }).__lifeopsTransitions ?? 0) + 1
        return start(callback)
      }) as typeof document.startViewTransition
    }
  })
  await page.goto('/')

  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await page.getByLabel('账号').fill('owner@lifeops.local')
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('LifeOps-V1-Remote-Test!')
  await page.getByRole('button', { name: '进入 LifeOps' }).click()

  await expect(page).toHaveURL(/\/app\/overview$/)
  await expect(page.locator('[data-private-shell]')).toHaveAttribute('data-workspace-theme', 'daylight')
  await expect(page.getByRole('heading', { name: '总览', level: 1 })).toBeVisible()
  await expect(page.locator('.public-home')).toHaveCount(0)
  await expect(page.locator('.private-orrery')).toHaveCount(0)

  await page.getByRole('link', { name: '日程', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/schedule$/)
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __lifeopsTransitions?: number }).__lifeopsTransitions ?? 0)).toBe(0)

  const title = `验证真实服务端会话与数据持久化 ${Date.now()}`
  await page.getByRole('button', { name: '新建任务' }).click()
  const editor = page.getByRole('dialog', { name: '把行动放进时间里' })
  await editor.getByLabel('标题').fill(title)
  await editor.getByRole('button', { name: '保存任务' }).click()
  await expect(page.getByText(title)).toBeVisible()
  await page.reload()
  await expect(page.getByText(title)).toBeVisible()

  await page.getByRole('button', { name: '打开账户与设置' }).click()
  await page.getByRole('button', { name: '退出 LifeOps' }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/app')
  await expect(page).toHaveURL(/\/$/)
})
