import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { hashPassword } from '../security/password.js'
import { MemoryLifeStore } from '../store/memoryLifeStore.js'

interface Client {
  get(url: string): ReturnType<FastifyInstance['inject']>
  write(options: InjectOptions, idempotencyKey?: string): ReturnType<FastifyInstance['inject']>
}

function cookieFrom(headers: Record<string, string | string[] | undefined>) {
  const value = headers['set-cookie']
  return (Array.isArray(value) ? value[0] : value)?.split(';')[0] ?? ''
}

describe('life catalog routes', () => {
  let app: FastifyInstance
  let store: MemoryLifeStore

  beforeEach(async () => {
    let sequence = 0
    store = new MemoryLifeStore({
      createId: () => `catalog-test-${++sequence}`,
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
    }
  }

  async function createCategory(subject: Client, name: string, parentId: string | null = null) {
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/life/taxonomy/categories',
      payload: { name, parentId },
    })
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string; version: number }>()
  }

  async function createTag(subject: Client, name: string) {
    const response = await subject.write({ method: 'POST', url: '/api/v1/life/taxonomy/tags', payload: { name } })
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string; version: number }>()
  }

  async function createLocation(subject: Client, name: string) {
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/life/taxonomy/locations',
      payload: { name, parentId: null },
    })
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string; version: number }>()
  }

  async function createIngredient(subject: Client, input: Record<string, unknown>, key: string) {
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/life/catalog',
      payload: {
        kind: 'ingredient',
        name: 'Egg',
        baseUnit: 'gram',
        aliases: [],
        tagIds: [],
        ...input,
      },
    }, key)
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string; version: number; categoryId: string | null; tagIds: string[]; deletedAt: string | null }>()
  }

  it('keeps taxonomy identities stable and isolates catalog rows by user', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const category = await createCategory(owner, 'Fresh food')
    const tag = await createTag(owner, 'High protein')
    const location = await createLocation(owner, 'Refrigerator')

    const renamed = await owner.write({
      method: 'PATCH',
      url: `/api/v1/life/taxonomy/categories/${category.id}`,
      payload: { name: 'Fresh ingredients', version: category.version },
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json()).toMatchObject({ id: category.id, name: 'Fresh ingredients', version: 2 })

    const item = await createIngredient(owner, {
      categoryId: category.id,
      tagIds: [tag.id],
      locationId: location.id,
      nutrition: {
        basisQuantity: 100,
        basisUnit: 'gram',
        values: { energyKcal: 143, proteinGrams: 13, fatGrams: 9.5, carbohydrateGrams: 0.7 },
      },
    }, 'catalog-owner-egg')

    const ownerList = await owner.get('/api/v1/life/catalog')
    expect(ownerList.statusCode).toBe(200)
    expect(ownerList.json()).toEqual([expect.objectContaining({ id: item.id, categoryId: category.id, tagIds: [tag.id] })])

    const otherList = await other.get('/api/v1/life/catalog')
    expect(otherList.statusCode).toBe(200)
    expect(otherList.json()).toEqual([])
    expect((await other.get(`/api/v1/life/catalog/${item.id}`)).statusCode).toBe(404)
  })

  it('applies category and tag changes as one version-checked batch', async () => {
    const owner = await client()
    const pantry = await createCategory(owner, 'Pantry')
    const chilled = await createCategory(owner, 'Chilled')
    const staple = await createTag(owner, 'Staple')
    const first = await createIngredient(owner, { name: 'Rice', categoryId: pantry.id }, 'catalog-rice')
    const second = await createIngredient(owner, { name: 'Milk', categoryId: pantry.id }, 'catalog-milk')

    const changed = await owner.write({
      method: 'POST',
      url: '/api/v1/life/catalog/batch',
      payload: {
        items: [{ id: first.id, version: first.version }, { id: second.id, version: second.version }],
        patch: { categoryId: chilled.id, addTagIds: [staple.id] },
      },
    })
    expect(changed.statusCode).toBe(200)
    expect(changed.json()).toEqual([
      expect.objectContaining({ id: first.id, categoryId: chilled.id, tagIds: [staple.id], version: 2 }),
      expect.objectContaining({ id: second.id, categoryId: chilled.id, tagIds: [staple.id], version: 2 }),
    ])

    const stale = await owner.write({
      method: 'POST',
      url: '/api/v1/life/catalog/batch',
      payload: {
        items: [{ id: first.id, version: 1 }, { id: second.id, version: 2 }],
        patch: { categoryId: pantry.id, removeTagIds: [staple.id] },
      },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })

    const unchanged = await owner.get('/api/v1/life/catalog')
    expect(unchanged.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, categoryId: chilled.id, tagIds: [staple.id], version: 2 }),
      expect.objectContaining({ id: second.id, categoryId: chilled.id, tagIds: [staple.id], version: 2 }),
    ]))
  })

  it('previews delete impact, soft-deletes, and restores the same item with its relationships', async () => {
    const owner = await client()
    const category = await createCategory(owner, 'Produce')
    const tag = await createTag(owner, 'Seasonal')
    const item = await createIngredient(owner, { name: 'Tomato', categoryId: category.id, tagIds: [tag.id] }, 'catalog-tomato')

    const impact = await owner.get(`/api/v1/life/catalog/${item.id}/delete-impact`)
    expect(impact.statusCode).toBe(200)
    expect(impact.json()).toEqual({ recipeIds: [], templateIds: [], futurePlanIds: [] })

    const removed = await owner.write({ method: 'DELETE', url: `/api/v1/life/catalog/${item.id}`, payload: { version: 1 } })
    expect(removed.statusCode).toBe(204)
    expect((await owner.get(`/api/v1/life/catalog/${item.id}`)).statusCode).toBe(404)

    const trash = await owner.get('/api/v1/life/trash/catalog')
    expect(trash.statusCode).toBe(200)
    expect(trash.json()).toEqual([expect.objectContaining({ id: item.id, deletedAt: '2026-08-13T09:00:00.000Z', version: 2 })])

    const restored = await owner.write({
      method: 'POST',
      url: `/api/v1/life/trash/catalog/${item.id}/restore`,
      payload: { version: 2 },
    })
    expect(restored.statusCode).toBe(200)
    expect(restored.json()).toMatchObject({
      id: item.id,
      categoryId: category.id,
      tagIds: [tag.id],
      deletedAt: null,
      version: 3,
    })
  })

  it('rejects a medicine recommendation field instead of accepting medical advice content', async () => {
    const owner = await client()
    const response = await owner.write({
      method: 'POST',
      url: '/api/v1/life/catalog',
      payload: {
        kind: 'medicine',
        name: 'User-entered medicine',
        baseUnit: 'tablet',
        aliases: [],
        tagIds: [],
        medicine: {
          tradeName: 'User-entered trade name',
          specification: 'User-entered package facts',
          userScheduleText: 'User-authored reminder text',
          recommendation: 'Take twice daily',
        },
      },
    }, 'catalog-medicine-recommendation')

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } })
  })

  it('accepts and returns the discriminated supplement and household factual profiles', async () => {
    const owner = await client()
    const fixtures = [
      {
        key: 'catalog-profile-supplement',
        payload: {
          kind: 'supplement', name: 'Supplement facts', baseUnit: 'capsule',
          profile: {
            kind: 'supplement', servingQuantity: 2, servingUnit: 'capsule',
            ingredients: ['magnesium glycinate'], defaultFrequency: 'evening', userInstructions: 'My note',
            reminder: { enabled: true, localTimes: ['19:30'], note: 'My reminder' },
          },
        },
      },
      {
        key: 'catalog-profile-consumable',
        payload: {
          kind: 'household_consumable', name: 'Dish soap', baseUnit: 'bottle',
          profile: {
            kind: 'household_consumable', defaultPurchaseQuantity: 2, defaultPurchaseUnit: 'bottle',
            consumptionCycleDays: 45, estimatedDepletionDate: '2026-10-05',
          },
        },
      },
      {
        key: 'catalog-profile-durable',
        payload: {
          kind: 'household_durable', name: 'Vacuum cleaner', baseUnit: 'each',
          profile: {
            kind: 'household_durable', valueMinor: 129_900, currency: 'CNY', valueAsOfDate: '2026-08-21',
            lifecycleStatus: 'maintenance', acquiredOn: '2025-03-01', warrantyExpiresOn: '2027-03-01',
            maintenanceRecords: [{ id: 'maintenance-1', performedOn: '2026-08-20', summary: 'Filter replaced', costMinor: 4_500, currency: 'CNY' }],
            retiredOn: null, retirementReason: null, setItemIds: ['attachment-1'],
          },
        },
      },
    ]

    for (const fixture of fixtures) {
      const response = await owner.write({ method: 'POST', url: '/api/v1/life/catalog', payload: fixture.payload }, fixture.key)
      expect(response.statusCode, JSON.stringify(response.json())).toBe(201)
      expect(response.json()).toMatchObject({ kind: fixture.payload.kind, profile: fixture.payload.profile })
    }
  })

  it('rejects kind-incompatible and advice-like profile payloads', async () => {
    const owner = await client()
    const incompatible = await owner.write({
      method: 'POST', url: '/api/v1/life/catalog',
      payload: {
        kind: 'household_consumable', name: 'Wrong branch', baseUnit: 'each',
        profile: { kind: 'supplement', servingQuantity: 1, servingUnit: 'capsule' },
      },
    }, 'catalog-profile-wrong-kind')
    expect(incompatible.statusCode).toBe(400)

    const advice = await owner.write({
      method: 'POST', url: '/api/v1/life/catalog',
      payload: {
        kind: 'household_durable', name: 'Advice is forbidden', baseUnit: 'each',
        profile: { kind: 'household_durable', replacementAdvice: 'Replace it now' },
      },
    }, 'catalog-profile-advice')
    expect(advice.statusCode).toBe(400)
  })
})
