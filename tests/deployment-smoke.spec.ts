import { expect, test, type Page } from '@playwright/test'

const account = process.env.LIFEOPS_SMOKE_ACCOUNT ?? ''
const password = process.env.LIFEOPS_SMOKE_PASSWORD ?? ''
const prefix = process.env.LIFEOPS_SMOKE_PREFIX ?? ''

async function login(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '登录 LifeOps' })).toBeVisible()
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await page.getByLabel('账号').fill(account)
  await page.getByRole('textbox', { name: '密码', exact: true }).fill(password)
  await page.getByRole('button', { name: '进入 LifeOps' }).click()
  await expect(page).toHaveURL(/\/app\/overview$/)
  await expect(page.locator('[data-private-shell]')).toBeVisible()
}

test.beforeAll(() => {
  expect(account, 'SMOKE_AUTH_FAILED: account is required').not.toBe('')
  expect(password, 'SMOKE_AUTH_FAILED: password is required').not.toBe('')
  expect(prefix, 'SMOKE_CLEANUP_SCOPE_VIOLATION: a unique smoke prefix is required').toMatch(/^lifeops-smoke-\d{14}-$/)
})

test('public entry, authentication and idempotent record write are healthy', async ({ page }) => {
  await login(page)
  const result = await page.evaluate(async ({ smokePrefix }) => {
    const sessionResponse = await fetch('/api/v1/auth/session', { credentials: 'include' })
    if (!sessionResponse.ok) throw new Error('SMOKE_AUTH_FAILED')
    const session = await sessionResponse.json() as { csrfToken: string }
    const title = `${smokePrefix}record`
    const key = `${smokePrefix}record-create`
    const payload = { title, body: 'LifeOps deployment smoke record', tags: ['lifeops-smoke'] }
    const write = () => fetch('/api/v1/records', {
      method: 'POST', credentials: 'include', headers: {
        'content-type': 'application/json', 'x-csrf-token': session.csrfToken, 'idempotency-key': key,
      }, body: JSON.stringify(payload),
    })
    const firstResponse = await write()
    const retryResponse = await write()
    if (firstResponse.status !== 201 || retryResponse.status !== 201) throw new Error('SMOKE_PERSISTENCE_FAILED')
    const first = await firstResponse.json() as { id: string; version: number; title: string }
    const retry = await retryResponse.json() as { id: string; version: number }
    if (first.id !== retry.id || first.title !== title) throw new Error('SMOKE_PERSISTENCE_FAILED')
    const cleanup = await fetch(`/api/v1/records/${encodeURIComponent(first.id)}`, {
      method: 'DELETE', credentials: 'include', headers: {
        'content-type': 'application/json', 'x-csrf-token': session.csrfToken,
      }, body: JSON.stringify({ version: first.version }),
    })
    if (cleanup.status !== 204) throw new Error('SMOKE_CLEANUP_SCOPE_VIOLATION')
    return { firstId: first.id, retryId: retry.id }
  }, { smokePrefix: prefix })

  expect(result.firstId).toBe(result.retryId)
})
