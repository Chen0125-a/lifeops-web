import { expect, test, type Page } from '@playwright/test'

const account = process.env.LIFEOPS_SMOKE_ACCOUNT ?? ''
const password = process.env.LIFEOPS_SMOKE_PASSWORD ?? ''
const prefix = process.env.LIFEOPS_SMOKE_PREFIX ?? ''

async function login(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '登录 LifeOps' }).click()
  await page.getByLabel('账号').fill(account)
  await page.getByRole('textbox', { name: '密码', exact: true }).fill(password)
  await page.getByRole('button', { name: '进入 LifeOps' }).click()
  await expect(page).toHaveURL(/\/app\/overview$/)
}

test('record reload and Life transaction retry preserve one effect with bounded cleanup', async ({ page }) => {
  test.setTimeout(60_000)
  await login(page)
  const result = await page.evaluate(async ({ smokePrefix }) => {
    const sessionResponse = await fetch('/api/v1/auth/session', { credentials: 'include' })
    if (!sessionResponse.ok) throw new Error('SMOKE_AUTH_FAILED')
    const { csrfToken } = await sessionResponse.json() as { csrfToken: string }
    const headers = (key?: string) => ({
      'content-type': 'application/json', 'x-csrf-token': csrfToken, ...(key ? { 'idempotency-key': key } : {}),
    })
    const recordResponse = await fetch('/api/v1/records', {
      method: 'POST', credentials: 'include', headers: headers(`${smokePrefix}persist-record`),
      body: JSON.stringify({ title: `${smokePrefix}persistence`, body: 'Reload persistence sentinel', tags: ['lifeops-smoke'] }),
    })
    if (recordResponse.status !== 201) throw new Error('SMOKE_PERSISTENCE_FAILED')
    const record = await recordResponse.json() as { id: string; version: number }
    const read = await fetch(`/api/v1/records/${encodeURIComponent(record.id)}`, { credentials: 'include', cache: 'no-store' })
    if (!read.ok || (await read.json() as { id: string }).id !== record.id) throw new Error('SMOKE_PERSISTENCE_FAILED')

    const catalogResponse = await fetch('/api/v1/life/catalog', {
      method: 'POST', credentials: 'include', headers: headers(`${smokePrefix}catalog`),
      body: JSON.stringify({ kind: 'ingredient', name: `${smokePrefix}item`, baseUnit: 'gram', aliases: [], tagIds: [] }),
    })
    if (catalogResponse.status !== 201) throw new Error('SMOKE_LIFE_SENTINEL_FAILED')
    const catalog = await catalogResponse.json() as { id: string; version: number }
    const transactionPayload = { itemId: catalog.id, kind: 'purchase', quantity: 1, unit: 'gram', occurredAt: new Date().toISOString(), note: smokePrefix }
    const transactionKey = `${smokePrefix}life-transaction`
    const createTransaction = () => fetch('/api/v1/life/inventory/transactions', {
      method: 'POST', credentials: 'include', headers: headers(transactionKey), body: JSON.stringify(transactionPayload),
    })
    const firstResponse = await createTransaction()
    const retryResponse = await createTransaction()
    if (firstResponse.status !== 201 || retryResponse.status !== 201) throw new Error('SMOKE_LIFE_SENTINEL_FAILED')
    const first = await firstResponse.json() as { id: string }
    const retry = await retryResponse.json() as { id: string }
    const ledgerResponse = await fetch(`/api/v1/life/inventory/transactions?itemId=${encodeURIComponent(catalog.id)}`, { credentials: 'include', cache: 'no-store' })
    const ledger = await ledgerResponse.json() as Array<{ id: string }>
    if (first.id !== retry.id || ledger.filter((row) => row.id === first.id).length !== 1) throw new Error('SMOKE_LIFE_SENTINEL_FAILED')

    const reverse = await fetch(`/api/v1/life/inventory/transactions/${encodeURIComponent(first.id)}/reverse`, {
      method: 'POST', credentials: 'include', headers: headers(`${smokePrefix}life-reverse`), body: JSON.stringify({ note: 'Smoke cleanup reversal' }),
    })
    const deleteCatalog = await fetch(`/api/v1/life/catalog/${encodeURIComponent(catalog.id)}`, {
      method: 'DELETE', credentials: 'include', headers: headers(), body: JSON.stringify({ version: catalog.version }),
    })
    const deleteRecord = await fetch(`/api/v1/records/${encodeURIComponent(record.id)}`, {
      method: 'DELETE', credentials: 'include', headers: headers(), body: JSON.stringify({ version: record.version }),
    })
    if (reverse.status !== 201 || deleteCatalog.status !== 204 || deleteRecord.status !== 204) throw new Error('SMOKE_CLEANUP_SCOPE_VIOLATION')
    return { firstEffectId: first.id, retryEffectId: retry.id, effectCount: ledger.filter((row) => row.id === first.id).length }
  }, { smokePrefix: prefix })

  expect(result).toMatchObject({ effectCount: 1 })
  expect(result.firstEffectId).toBe(result.retryEffectId)
})
