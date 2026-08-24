import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { hashPassword } from '../security/password.js'
import { MemoryLifeStore } from '../store/memoryLifeStore.js'

interface Client {
  get(url: string): ReturnType<FastifyInstance['inject']>
  write(options: InjectOptions, idempotencyKey?: string): ReturnType<FastifyInstance['inject']>
  writeWithoutCsrf(options: InjectOptions, idempotencyKey?: string): ReturnType<FastifyInstance['inject']>
}

function cookieFrom(headers: Record<string, string | string[] | undefined>) {
  const value = headers['set-cookie']
  return (Array.isArray(value) ? value[0] : value)?.split(';')[0] ?? ''
}

describe('life inventory routes', () => {
  let app: FastifyInstance
  let store: MemoryLifeStore

  beforeEach(async () => {
    let sequence = 0
    store = new MemoryLifeStore({
      createId: () => `inventory-test-${++sequence}`,
      now: () => '2026-08-13T09:00:00.000Z',
    })
    await store.createUser({ account: 'owner@example.com', displayName: 'Owner', passwordHash: await hashPassword('owner-safe-password') })
    await store.createUser({ account: 'other@example.com', displayName: 'Other', passwordHash: await hashPassword('other-safe-password') })
    app = buildApp({ store, config: { cookieName: 'lifeops_session', sessionTtlSeconds: 3_600, secureCookies: false } })
    await app.ready()
  })

  afterEach(async () => app.close())

  async function client(account = 'owner@example.com', password = 'owner-safe-password'): Promise<Client> {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { account, password } })
    expect(login.statusCode).toBe(200)
    const cookie = cookieFrom(login.headers)
    const csrf = login.json<{ csrfToken: string }>().csrfToken
    return {
      get: (url) => app.inject({ method: 'GET', url, headers: { cookie } }),
      write: (options, idempotencyKey) => app.inject({
        ...options,
        headers: {
          ...options.headers,
          cookie,
          'x-csrf-token': csrf,
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
      }),
      writeWithoutCsrf: (options, idempotencyKey) => app.inject({
        ...options,
        headers: {
          ...options.headers,
          cookie,
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
      }),
    }
  }

  async function createItem(subject: Client, name = 'Rice') {
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/life/catalog',
      payload: {
        kind: 'ingredient',
        name,
        baseUnit: 'gram',
        availableUnits: ['gram', 'package'],
        itemConversions: [{ itemId: 'pending', fromUnit: 'package', toUnit: 'gram', factor: 500 }],
      },
    }, `catalog-${name}`)
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string }>()
  }

  async function createTransaction(
    subject: Client,
    itemId: string,
    payload: Record<string, unknown>,
    key: string,
  ) {
    return subject.write({
      method: 'POST',
      url: '/api/v1/life/inventory/transactions',
      payload: { itemId, unit: 'gram', occurredAt: '2026-08-13T09:00:00.000Z', ...payload },
    }, key)
  }

  it('persists every inventory mutation kind as an append-only transaction', async () => {
    const owner = await client()
    const item = await createItem(owner)
    const inputs = [
      { kind: 'purchase', quantity: 10, batch: { purchasedOn: '2026-08-13', expiresOn: '2026-12-31' } },
      { kind: 'consume', quantity: 2 },
      { kind: 'return', quantity: 1 },
      { kind: 'waste', quantity: 1 },
      { kind: 'adjustment', quantity: -2, note: 'Physical count reconciliation' },
    ]

    for (const [index, input] of inputs.entries()) {
      const response = await createTransaction(owner, item.id, input, `inventory-kind-${index}`)
      expect(response.statusCode).toBe(201)
    }

    const transactions = await owner.get(`/api/v1/life/inventory/transactions?itemId=${encodeURIComponent(item.id)}`)
    expect(transactions.statusCode).toBe(200)
    expect(transactions.json()).toHaveLength(5)
    expect(transactions.json()).toEqual(expect.arrayContaining(inputs.map(({ kind }) => expect.objectContaining({ kind }))))
  })

  it('allocates consumption from the earliest non-expired batch and reports the resulting balance', async () => {
    const owner = await client()
    const item = await createItem(owner, 'Milk')
    expect((await createTransaction(owner, item.id, {
      kind: 'purchase', quantity: 6, batch: { purchasedOn: '2026-08-01', expiresOn: '2026-08-30' },
    }, 'inventory-batch-later')).statusCode).toBe(201)
    expect((await createTransaction(owner, item.id, {
      kind: 'purchase', quantity: 4, batch: { purchasedOn: '2026-08-02', expiresOn: '2026-08-15' },
    }, 'inventory-batch-soon')).statusCode).toBe(201)

    const consumed = await createTransaction(owner, item.id, { kind: 'consume', quantity: 7 }, 'inventory-consume-fefo')
    expect(consumed.statusCode).toBe(201)
    expect(consumed.json()).toMatchObject({
      kind: 'consume',
      allocations: [
        { quantity: 4, expiresOn: '2026-08-15' },
        { quantity: 3, expiresOn: '2026-08-30' },
      ],
    })

    const balances = await owner.get(`/api/v1/life/inventory/balances?itemId=${encodeURIComponent(item.id)}`)
    expect(balances.statusCode).toBe(200)
    expect(balances.json()).toEqual([expect.objectContaining({ itemId: item.id, onHand: 3, warnings: [] })])
  })

  it('returns the original event for the same user, operation and idempotency key', async () => {
    const owner = await client()
    const item = await createItem(owner, 'Eggs')
    const first = await createTransaction(owner, item.id, { kind: 'purchase', quantity: 12 }, 'inventory-retry')
    const replay = await createTransaction(owner, item.id, { kind: 'purchase', quantity: 12 }, 'inventory-retry')

    expect(first.statusCode).toBe(201)
    expect(replay.statusCode).toBe(201)
    expect(replay.json()).toEqual(first.json())
    expect((await owner.get(`/api/v1/life/inventory/transactions?itemId=${encodeURIComponent(item.id)}`)).json()).toHaveLength(1)
  })

  it('creates one linked reversal, replays its key, and rejects a distinct second reversal', async () => {
    const owner = await client()
    const item = await createItem(owner, 'Supplement')
    const original = await createTransaction(owner, item.id, { kind: 'consume', quantity: 3 }, 'inventory-consume')
    expect(original.statusCode).toBe(201)
    const originalId = original.json<{ id: string }>().id

    const reverse = (key: string) => owner.write({
      method: 'POST',
      url: `/api/v1/life/inventory/transactions/${encodeURIComponent(originalId)}/reverse`,
      payload: { note: 'Undo mistaken confirmation' },
    }, key)
    const first = await reverse('inventory-reverse')
    const replay = await reverse('inventory-reverse')
    const duplicate = await reverse('inventory-reverse-other-key')

    expect(first.statusCode).toBe(201)
    expect(first.json()).toMatchObject({ kind: 'reversal', reversesTransactionId: originalId })
    expect(replay.statusCode).toBe(201)
    expect(replay.json()).toEqual(first.json())
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json()).toMatchObject({ error: { code: 'TRANSACTION_ALREADY_REVERSED' } })
    const ledger = await owner.get(`/api/v1/life/inventory/transactions?itemId=${encodeURIComponent(item.id)}`)
    expect(ledger.json<Array<{ id: string; reversedByTransactionId: string | null }>>()
      .find((entry) => entry.id === originalId)?.reversedByTransactionId).toBe(first.json<{ id: string }>().id)
  })

  it('requires authentication and never exposes another user inventory', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/life/inventory/balances' })).statusCode).toBe(401)
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const item = await createItem(owner, 'Private stock')
    expect((await createTransaction(owner, item.id, { kind: 'purchase', quantity: 5 }, 'inventory-private')).statusCode).toBe(201)
    expect((await other.get('/api/v1/life/inventory/balances')).json()).toEqual([])
    expect((await other.get(`/api/v1/life/inventory/transactions?itemId=${encodeURIComponent(item.id)}`)).json()).toEqual([])
  })

  it('rejects another user batch location and releases the failed idempotency key for retry', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const item = await createItem(owner, 'Location-scoped stock')
    const foreignLocationResponse = await other.write({
      method: 'POST',
      url: '/api/v1/life/taxonomy/locations',
      payload: { name: 'Other pantry', parentId: null },
    })
    expect(foreignLocationResponse.statusCode).toBe(201)
    const foreignLocation = foreignLocationResponse.json<{ id: string }>()

    const failed = await createTransaction(owner, item.id, {
      kind: 'purchase', quantity: 5, batch: { locationId: foreignLocation.id },
    }, 'inventory-location-retry')
    expect(failed.statusCode).toBe(404)
    expect(failed.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })

    const retried = await createTransaction(owner, item.id, {
      kind: 'purchase', quantity: 5,
    }, 'inventory-location-retry')
    expect(retried.statusCode).toBe(201)
    expect((await owner.get(`/api/v1/life/inventory/transactions?itemId=${encodeURIComponent(item.id)}`)).json()).toHaveLength(1)
  })

  it('requires CSRF and idempotency boundaries and rejects key reuse with different input', async () => {
    const owner = await client()
    const item = await createItem(owner, 'Protected stock')
    const input = {
      method: 'POST' as const,
      url: '/api/v1/life/inventory/transactions',
      payload: { itemId: item.id, kind: 'purchase', quantity: 1, unit: 'gram', occurredAt: '2026-08-13T09:00:00.000Z' },
    }
    expect((await owner.write(input)).statusCode).toBe(400)
    expect((await owner.writeWithoutCsrf(input, 'inventory-protected')).statusCode).toBe(403)
    expect((await owner.write(input, 'inventory-protected')).statusCode).toBe(201)
    const conflicting = await owner.write({
      ...input,
      payload: { ...input.payload, quantity: 2 },
    }, 'inventory-protected')
    expect(conflicting.statusCode).toBe(409)
    expect(conflicting.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } })
  })
})
