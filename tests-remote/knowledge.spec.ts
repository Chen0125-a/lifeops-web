import { expect, test } from '@playwright/test'

async function login(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await page.getByLabel('账号').fill('owner@lifeops.local')
  await page.getByRole('textbox', { name: '密码', exact: true }).fill('LifeOps-V1-Remote-Test!')
  await page.getByRole('button', { name: '进入 LifeOps' }).click()
  await expect(page).toHaveURL(/\/app\/overview$/)
}

test('real Fastify session creates, edits, relates and reloads private knowledge', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await login(page)
  await page.goto('/app/knowledge')
  await expect(page.getByRole('heading', { name: '知识', level: 1 })).toBeVisible()

  const suffix = Date.now().toString(36)
  const sourceTitle = `真实来源知识 ${suffix}`
  await page.locator('.knowledge-page__heading').getByRole('button', { name: '新建知识', exact: true }).click()
  await page.getByLabel('知识标题').fill(sourceTitle)
  await page.getByLabel('Markdown 正文').fill('# 真实来源\n\n由 Fastify Memory store 持久化。')
  await page.getByRole('textbox', { name: '标签', exact: true }).fill('真实服务，来源')
  await page.getByRole('button', { name: '创建知识' }).click()
  await expect(page.getByRole('heading', { name: sourceTitle })).toBeVisible()

  const relatedTitle = `真实关系知识 ${suffix}`
  await page.locator('.knowledge-page__heading').getByRole('button', { name: '新建知识', exact: true }).click()
  await page.getByLabel('知识标题').fill(relatedTitle)
  await page.getByLabel('Markdown 正文').fill('# 关系验证\n\n页面只写知识，不反向修改来源对象。')
  await page.getByRole('button', { name: '创建知识' }).click()
  await expect(page.getByRole('heading', { name: relatedTitle })).toBeVisible()

  await page.getByRole('combobox', { name: '添加相关知识' }).selectOption({ label: sourceTitle })
  await page.getByRole('button', { name: '建立知识关系' }).click()
  await expect(page.getByRole('button', { name: `相关知识 ${sourceTitle}` })).toBeVisible()

  await page.getByRole('button', { name: '编辑知识' }).click()
  await page.getByLabel('Markdown 正文').fill('# 关系验证\n\n真实服务端自动保存后仍可回读。')
  await expect(page.getByRole('status').filter({ hasText: /已保存 ·/ })).toBeVisible({ timeout: 4_000 })
  await page.reload()
  await expect(page.getByRole('heading', { name: relatedTitle })).toBeVisible()
  await expect(page.getByText('真实服务端自动保存后仍可回读。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: `相关知识 ${sourceTitle}` })).toBeVisible()
  expect(consoleErrors.filter((message) => /same key|Encountered two children/i.test(message))).toEqual([])
})
