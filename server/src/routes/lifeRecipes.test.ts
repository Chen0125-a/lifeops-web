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

describe('life recipe routes', () => {
  let app: FastifyInstance
  let store: MemoryLifeStore
  let currentNow: string

  beforeEach(async () => {
    let sequence = 0
    currentNow = '2026-08-13T09:00:00.000Z'
    store = new MemoryLifeStore({
      createId: () => `recipe-test-${++sequence}`,
      now: () => currentNow,
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
        headers: { ...options.headers, cookie, ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
      }),
    }
  }

  async function createIngredient(subject: Client, name: string, baseUnit: string, input: Record<string, unknown> = {}) {
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/life/catalog',
      payload: {
        kind: 'ingredient',
        name,
        baseUnit,
        availableUnits: [baseUnit],
        aliases: [],
        tagIds: [],
        ...input,
      },
    }, `catalog-${name}`)
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string }>()
  }

  async function seedIngredients(subject: Client) {
    const rice = await createIngredient(subject, 'Rice', 'gram', {
      availableUnits: ['gram', 'kilogram'],
      nutrition: { basisQuantity: 100, basisUnit: 'gram', values: { energyKcal: 130, proteinGrams: 2.7, fatGrams: 0.3, carbohydrateGrams: 28 } },
      pricePoints: [{ amountMinor: 1_000, currency: 'CNY', purchaseQuantity: 1, purchaseUnit: 'kilogram', effectiveFrom: '2026-08-01' }],
    })
    const egg = await createIngredient(subject, 'Egg', 'each', {
      nutrition: { basisQuantity: 1, basisUnit: 'each', values: { energyKcal: 70, proteinGrams: 6, fatGrams: 5, carbohydrateGrams: 0.5 } },
      pricePoints: [{ amountMinor: 600, currency: 'CNY', purchaseQuantity: 12, purchaseUnit: 'each', effectiveFrom: '2026-08-01' }],
    })
    return { rice, egg }
  }

  const recipePayload = (riceId: string, eggId: string, servings = 4) => ({
    name: 'Rice and egg',
    description: 'A traceable meal.',
    servings,
    yieldQuantity: servings,
    yieldUnit: 'portion',
    prepMinutes: 5,
    cookMinutes: 10,
    difficulty: 'easy',
    categoryId: null,
    tagIds: [],
    storageNotes: 'Refrigerate leftovers.',
    components: [
      { itemId: riceId, quantity: 200, unit: 'gram', role: 'ingredient', position: 0 },
      { itemId: eggId, quantity: 2, unit: 'each', role: 'ingredient', position: 1 },
    ],
    steps: [{ instruction: 'Cook together.', ingredientItemIds: [riceId, eggId], durationSeconds: 600, imageMediaId: null, caution: '', position: 0 }],
  })

  async function createRecipe(subject: Client, riceId: string, eggId: string, key = 'recipe-create') {
    return subject.write({ method: 'POST', url: '/api/v1/life/recipes', payload: recipePayload(riceId, eggId) }, key)
  }

  it('rejects another user\'s step media, category and tags independently', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const { rice, egg } = await seedIngredients(owner)
    const otherUser = await store.findUserByAccount('other@example.com')
    const foreignMedia = await store.createMediaAsset(otherUser!.id, {
      originalName: 'foreign-step.png',
      mimeType: 'image/png',
      sizeBytes: 67,
      storageKey: 'foreign/recipe-step.png',
      checksum: 'A'.repeat(64),
      width: 1,
      height: 1,
    }, 'foreign-recipe-step-media')
    const foreignCategory = await other.write({
      method: 'POST', url: '/api/v1/life/taxonomy/categories', payload: { name: 'Foreign category', parentId: null },
    })
    const foreignTag = await other.write({
      method: 'POST', url: '/api/v1/life/taxonomy/tags', payload: { name: 'Foreign tag' },
    })
    expect(foreignCategory.statusCode).toBe(201)
    expect(foreignTag.statusCode).toBe(201)

    const attempts = [
      {
        key: 'recipe-foreign-step-media',
        payload: {
          ...recipePayload(rice.id, egg.id),
          steps: [{ ...recipePayload(rice.id, egg.id).steps[0], imageMediaId: foreignMedia.id }],
        },
      },
      {
        key: 'recipe-foreign-cover-media',
        payload: { ...recipePayload(rice.id, egg.id), coverMediaId: foreignMedia.id },
      },
      {
        key: 'recipe-foreign-category',
        payload: { ...recipePayload(rice.id, egg.id), categoryId: foreignCategory.json<{ id: string }>().id },
      },
      {
        key: 'recipe-foreign-tag',
        payload: { ...recipePayload(rice.id, egg.id), tagIds: [foreignTag.json<{ id: string }>().id] },
      },
    ]

    for (const attempt of attempts) {
      const response = await owner.write({ method: 'POST', url: '/api/v1/life/recipes', payload: attempt.payload }, attempt.key)
      expect(response.statusCode).toBe(404)
      expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    }
    expect((await owner.get('/api/v1/life/recipes')).json()).toEqual([])
  })

  it('requires authentication and CSRF while keeping recipe lists owner scoped', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/life/recipes' })).statusCode).toBe(401)
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const { rice, egg } = await seedIngredients(owner)
    const input = { method: 'POST' as const, url: '/api/v1/life/recipes', payload: recipePayload(rice.id, egg.id) }

    expect((await owner.writeWithoutCsrf(input, 'recipe-protected')).statusCode).toBe(403)
    expect((await owner.write(input, 'recipe-protected')).statusCode).toBe(201)
    expect((await owner.get('/api/v1/life/recipes')).json()).toHaveLength(1)
    expect((await other.get('/api/v1/life/recipes')).json()).toEqual([])
  })

  it('creates one immutable initial version and replays only an identical idempotent request', async () => {
    const owner = await client()
    const { rice, egg } = await seedIngredients(owner)
    const first = await createRecipe(owner, rice.id, egg.id, 'recipe-retry')
    const replay = await createRecipe(owner, rice.id, egg.id, 'recipe-retry')
    const conflict = await owner.write({
      method: 'POST', url: '/api/v1/life/recipes', payload: { ...recipePayload(rice.id, egg.id), name: 'Different recipe' },
    }, 'recipe-retry')

    expect(first.statusCode).toBe(201)
    expect(first.json()).toMatchObject({ name: 'Rice and egg', entityVersion: 1, currentVersion: { number: 1, servings: 4 } })
    expect(replay.statusCode).toBe(201)
    expect(replay.json()).toEqual(first.json())
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } })
    expect((await owner.get(`/api/v1/life/recipes/${encodeURIComponent(first.json<{ id: string }>().id)}/versions`)).json()).toHaveLength(1)
  })

  it('persists same-owner cover media and previews impact before latest and pinned versions diverge', async () => {
    const owner = await client()
    const { rice, egg } = await seedIngredients(owner)
    const ownerUser = await store.findUserByAccount('owner@example.com')
    const cover = await store.createMediaAsset(ownerUser!.id, {
      originalName: 'recipe-cover.png', mimeType: 'image/png', sizeBytes: 67,
      storageKey: 'owner/recipe-cover.png', checksum: 'C'.repeat(64), width: 1, height: 1,
    }, 'owner-recipe-cover')
    const created = await owner.write({
      method: 'POST', url: '/api/v1/life/recipes', payload: { ...recipePayload(rice.id, egg.id), coverMediaId: cover.id },
    }, 'recipe-create-with-cover')
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ coverMediaId: cover.id })
    const recipe = created.json<{ id: string; entityVersion: number; currentVersion: { id: string } }>()
    const metadataOnly = { ...recipePayload(rice.id, egg.id), coverMediaId: cover.id, description: 'Metadata only.' }
    const metadataPreview = await owner.write({
      method: 'POST', url: `/api/v1/life/recipes/${encodeURIComponent(recipe.id)}/impact-preview`,
      payload: { entityVersion: recipe.entityVersion, ...metadataOnly },
    })
    expect(metadataPreview.statusCode).toBe(200)
    expect(metadataPreview.json()).toMatchObject({ createsVersion: false, nextVersionNumber: 1 })
    const metadataUpdate = await owner.write({
      method: 'PATCH', url: `/api/v1/life/recipes/${encodeURIComponent(recipe.id)}`,
      payload: { entityVersion: recipe.entityVersion, ...metadataOnly },
    })
    expect(metadataUpdate.statusCode).toBe(200)
    expect(metadataUpdate.json()).toMatchObject({ entityVersion: 2, description: 'Metadata only.', currentVersion: { id: recipe.currentVersion.id, number: 1 } })
    expect((await owner.get(`/api/v1/life/recipes/${encodeURIComponent(recipe.id)}/versions`)).json()).toHaveLength(1)
    const proposed = {
      ...recipePayload(rice.id, egg.id, 6),
      coverMediaId: cover.id,
      components: [{ itemId: rice.id, quantity: 350, unit: 'gram', role: 'ingredient', position: 0 }],
      steps: [{ instruction: 'Cook the rice.', ingredientItemIds: [rice.id], durationSeconds: 600, imageMediaId: null, caution: '', position: 0 }],
    }

    const preview = await owner.write({
      method: 'POST', url: `/api/v1/life/recipes/${encodeURIComponent(recipe.id)}/impact-preview`, payload: { entityVersion: 2, ...proposed },
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({ writesApplied: false, createsVersion: true, nextVersionNumber: 2, futurePlansAffected: 0 })
    expect((await owner.get(`/api/v1/life/recipes/${encodeURIComponent(recipe.id)}/versions`)).json()).toHaveLength(1)

    const updated = await owner.write({
      method: 'PATCH', url: `/api/v1/life/recipes/${encodeURIComponent(recipe.id)}`, payload: { entityVersion: 2, ...proposed },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({ entityVersion: 3, currentVersion: { number: 2, servings: 6 } })
    const latest = await owner.get(`/api/v1/life/recipes/${encodeURIComponent(recipe.id)}/calculation?mode=latest&asOf=2026-08-13`)
    const pinned = await owner.get(`/api/v1/life/recipes/${encodeURIComponent(recipe.id)}/calculation?mode=pinned&versionId=${encodeURIComponent(recipe.currentVersion.id)}&asOf=2026-08-13`)
    expect(latest.json()).toMatchObject({ recipeVersionNumber: 2, servings: 6 })
    expect(pinned.json()).toMatchObject({ recipeVersionNumber: 1, servings: 4 })
  })

  it('uses the current store date when previewing newly effective catalog prices', async () => {
    currentNow = '2026-09-02T09:00:00.000Z'
    const owner = await client()
    const seasonal = await createIngredient(owner, 'Seasonal produce', 'gram', {
      nutrition: { basisQuantity: 100, basisUnit: 'gram', values: { energyKcal: 50, proteinGrams: 1, fatGrams: 0, carbohydrateGrams: 12 } },
      pricePoints: [{ amountMinor: 300, currency: 'CNY', purchaseQuantity: 100, purchaseUnit: 'gram', effectiveFrom: '2026-09-01' }],
    })
    const payload = {
      ...recipePayload(seasonal.id, seasonal.id),
      components: [{ itemId: seasonal.id, quantity: 100, unit: 'gram', role: 'ingredient', position: 0 }],
      steps: [{ instruction: 'Prepare.', ingredientItemIds: [seasonal.id], durationSeconds: null, imageMediaId: null, caution: '', position: 0 }],
    }
    const created = await owner.write({ method: 'POST', url: '/api/v1/life/recipes', payload }, 'seasonal-recipe')
    expect(created.statusCode).toBe(201)

    const recipe = created.json<{ id: string; entityVersion: number }>()
    const preview = await owner.write({
      method: 'POST', url: `/api/v1/life/recipes/${encodeURIComponent(recipe.id)}/impact-preview`,
      payload: { entityVersion: recipe.entityVersion, ...payload },
    })
    expect(preview.statusCode).toBe(200)
    expect(preview.json()).toMatchObject({ calculation: { status: 'complete', totalCostMinor: 300 } })
  })

  it('persists an explicit cooking-oil marker and custom nutrition through recipe calculation', async () => {
    const owner = await client()
    const oil = await createIngredient(owner, 'Sesame oil', 'gram', {
      isCookingOil: true,
      nutrition: {
        basisQuantity: 100,
        basisUnit: 'gram',
        values: { energyKcal: 900, proteinGrams: 0, fatGrams: 100, carbohydrateGrams: 0, custom: { sodiumMilligrams: 2 } },
      },
      pricePoints: [{ amountMinor: 2_000, currency: 'CNY', purchaseQuantity: 1_000, purchaseUnit: 'gram', effectiveFrom: '2026-08-01' }],
    })
    const payload = {
      ...recipePayload(oil.id, oil.id, 2),
      components: [{ itemId: oil.id, quantity: 20, unit: 'gram', role: 'seasoning', position: 0 }],
      steps: [{ instruction: 'Add the oil.', ingredientItemIds: [oil.id], durationSeconds: null, imageMediaId: null, caution: '', position: 0 }],
    }
    const created = await owner.write({ method: 'POST', url: '/api/v1/life/recipes', payload }, 'cooking-oil-recipe')
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ currentVersion: { servings: 2 } })
    const item = await owner.get(`/api/v1/life/catalog/${encodeURIComponent(oil.id)}`)
    expect(item.json()).toMatchObject({ isCookingOil: true, nutrition: { values: { custom: { sodiumMilligrams: 2 } } } })
    const calculation = await owner.get(`/api/v1/life/recipes/${encodeURIComponent(created.json<{ id: string }>().id)}/calculation?mode=latest&asOf=2026-08-13`)
    expect(calculation.json()).toMatchObject({ cookingOilGrams: 20, perServingCookingOilGrams: 10, totalNutrition: { custom: { sodiumMilligrams: 0.4 } } })
    expect((await owner.write({
      method: 'POST', url: '/api/v1/life/inventory/transactions',
      payload: { itemId: oil.id, kind: 'purchase', quantity: 100, unit: 'gram', occurredAt: '2026-08-13T08:00:00.000Z' },
    }, 'oil-stock')).statusCode).toBe(201)
    const session = await owner.write({
      method: 'POST', url: '/api/v1/life/cooking-sessions',
      payload: { recipeId: created.json<{ id: string }>().id, plannedServings: 2, note: '' },
    }, 'oil-session')
    const completed = await owner.write({
      method: 'POST', url: `/api/v1/life/cooking-sessions/${encodeURIComponent(session.json<{ id: string }>().id)}/complete`,
      payload: { madeServings: 2, eatenServings: 0.5, completedAt: '2026-08-13T10:00:00.000Z' },
    }, 'oil-complete')
    expect(completed.statusCode).toBe(201)
    expect(completed.json()).toMatchObject({
      snapshot: { cookingOilGrams: 20, intakeCookingOilGrams: 5 },
      preparedFood: { cookingOilGramsRemaining: 15 },
      intake: { cookingOilGrams: 5 },
    })
  })

  it('returns list-ready bidirectional ingredient relations without leaking another user recipe', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const { rice, egg } = await seedIngredients(owner)
    const created = await createRecipe(owner, rice.id, egg.id)
    expect(created.statusCode).toBe(201)

    const fromIngredient = await owner.get(`/api/v1/life/recipes/relations?itemId=${encodeURIComponent(rice.id)}`)
    expect(fromIngredient.statusCode).toBe(200)
    expect(fromIngredient.json()).toEqual([expect.objectContaining({ recipeId: created.json<{ id: string }>().id, recipeName: 'Rice and egg', itemId: rice.id, quantity: 200, unit: 'gram' })])
    expect((await other.get(`/api/v1/life/recipes/relations?itemId=${encodeURIComponent(rice.id)}`)).json()).toEqual([])
    expect((await owner.get(`/api/v1/life/catalog/${encodeURIComponent(rice.id)}/delete-impact`)).json()).toEqual({
      recipeIds: [created.json<{ id: string }>().id], templateIds: [], futurePlanIds: [],
    })
  })

  it('soft-deletes recipes into an owner-scoped trash view and restores the same recipe with optimistic versions', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const { rice, egg } = await seedIngredients(owner)
    const created = await createRecipe(owner, rice.id, egg.id)
    expect(created.statusCode).toBe(201)
    const recipe = created.json<{ id: string; entityVersion: number }>()

    const removed = await owner.write({
      method: 'DELETE', url: `/api/v1/life/recipes/${encodeURIComponent(recipe.id)}`, payload: { entityVersion: recipe.entityVersion },
    })
    expect(removed.statusCode).toBe(204)
    expect((await owner.get('/api/v1/life/recipes')).json()).toEqual([])
    expect((await owner.get(`/api/v1/life/recipes/${encodeURIComponent(recipe.id)}`)).statusCode).toBe(404)
    expect((await other.get('/api/v1/life/trash/recipes')).json()).toEqual([])
    const trash = await owner.get('/api/v1/life/trash/recipes')
    expect(trash.statusCode).toBe(200)
    expect(trash.json()).toEqual([expect.objectContaining({ id: recipe.id, entityVersion: 2, deletedAt: expect.any(String) })])

    const blockedReference = await owner.write({
      method: 'POST', url: '/api/v1/life/cooking-sessions', payload: { recipeId: recipe.id, plannedServings: 4, note: '' },
    }, 'deleted-recipe-session')
    expect(blockedReference.statusCode).toBe(404)

    const staleRestore = await owner.write({
      method: 'POST', url: `/api/v1/life/trash/recipes/${encodeURIComponent(recipe.id)}/restore`, payload: { entityVersion: 1 },
    })
    expect(staleRestore.statusCode).toBe(409)
    expect(staleRestore.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })
    const restored = await owner.write({
      method: 'POST', url: `/api/v1/life/trash/recipes/${encodeURIComponent(recipe.id)}/restore`, payload: { entityVersion: 2 },
    })
    expect(restored.statusCode).toBe(200)
    expect(restored.json()).toMatchObject({ id: recipe.id, entityVersion: 3, deletedAt: null })
    expect((await owner.get(`/api/v1/life/recipes/${encodeURIComponent(recipe.id)}`)).statusCode).toBe(200)
  })

  it('persists cooking progress, timers, actual quantities and a temporary substitution before completing from those facts', async () => {
    const owner = await client()
    const { rice, egg } = await seedIngredients(owner)
    const tofu = await createIngredient(owner, 'Tofu', 'gram', {
      nutrition: { basisQuantity: 100, basisUnit: 'gram', values: { energyKcal: 80, proteinGrams: 8, fatGrams: 4, carbohydrateGrams: 2 } },
      pricePoints: [{ amountMinor: 300, currency: 'CNY', purchaseQuantity: 100, purchaseUnit: 'gram', effectiveFrom: '2026-08-01' }],
    })
    for (const [itemId, quantity, unit] of [[rice.id, 1_000, 'gram'], [egg.id, 12, 'each'], [tofu.id, 500, 'gram']] as const) {
      const stocked = await owner.write({
        method: 'POST', url: '/api/v1/life/inventory/transactions',
        payload: { itemId, kind: 'purchase', quantity, unit, occurredAt: '2026-08-13T08:00:00.000Z' },
      }, `progress-stock-${itemId}`)
      expect(stocked.statusCode).toBe(201)
    }
    const created = await createRecipe(owner, rice.id, egg.id)
    expect(created.statusCode).toBe(201)
    const recipe = created.json<{ id: string; currentVersion: { id: string; steps: Array<{ id: string }> } }>()
    const stepId = recipe.currentVersion.steps[0]!.id
    const sessionResponse = await owner.write({
      method: 'POST', url: '/api/v1/life/cooking-sessions',
      payload: { recipeId: recipe.id, recipeVersionId: recipe.currentVersion.id, plannedServings: 4, note: 'Use tofu today.' },
    }, 'cooking-progress-session')
    expect(sessionResponse.statusCode).toBe(201)
    const session = sessionResponse.json<{ id: string }>()
    const progress = {
      entityVersion: 1,
      currentStepIndex: 1,
      completedStepIds: [stepId],
      actualIngredients: [
        { itemId: rice.id, quantity: 150, unit: 'gram', replacesItemId: null },
        { itemId: tofu.id, quantity: 100, unit: 'gram', replacesItemId: egg.id },
      ],
      timers: [{ stepId, elapsedSeconds: 45, running: false, startedAt: null }],
    }
    const saved = await owner.write({
      method: 'PATCH', url: `/api/v1/life/cooking-sessions/${encodeURIComponent(session.id)}`, payload: progress,
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toMatchObject({
      entityVersion: 2,
      progress: {
        currentStepIndex: 1,
        completedStepIds: [stepId],
        actualIngredients: progress.actualIngredients,
        timers: progress.timers,
      },
    })
    expect((await owner.get(`/api/v1/life/cooking-sessions/${encodeURIComponent(session.id)}`)).json()).toEqual(saved.json())

    const stale = await owner.write({
      method: 'PATCH', url: `/api/v1/life/cooking-sessions/${encodeURIComponent(session.id)}`,
      payload: { ...progress, currentStepIndex: 0 },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })

    const completed = await owner.write({
      method: 'POST', url: `/api/v1/life/cooking-sessions/${encodeURIComponent(session.id)}/complete`,
      payload: { madeServings: 4, eatenServings: 1, completedAt: '2026-08-13T10:00:00.000Z' },
    }, 'cooking-progress-complete')
    expect(completed.statusCode).toBe(201)
    expect(completed.json()).toMatchObject({
      snapshot: {
        ingredients: expect.arrayContaining([
          expect.objectContaining({ itemId: rice.id, quantity: 150, unit: 'gram' }),
          expect.objectContaining({ itemId: tofu.id, quantity: 100, unit: 'gram', replacesItemId: egg.id }),
        ]),
      },
    })
    const balances = await owner.get('/api/v1/life/inventory/balances')
    expect(balances.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: rice.id, onHand: 850 }),
      expect.objectContaining({ itemId: egg.id, onHand: 12 }),
      expect.objectContaining({ itemId: tofu.id, onHand: 400 }),
    ]))
  })

  it('keeps cooking notes session-only until explicit promotion creates a recipe version', async () => {
    const owner = await client()
    const { rice, egg } = await seedIngredients(owner)
    const created = await createRecipe(owner, rice.id, egg.id)
    expect(created.statusCode).toBe(201)
    const recipe = created.json<{ id: string; currentVersion: { id: string } }>()
    const session = await owner.write({
      method: 'POST', url: '/api/v1/life/cooking-sessions',
      payload: { recipeId: recipe.id, recipeVersionId: recipe.currentVersion.id, plannedServings: 4, note: 'Use lower heat.' },
    }, 'cooking-session-note')
    expect(session.statusCode).toBe(201)
    expect((await owner.get(`/api/v1/life/recipes/${encodeURIComponent(recipe.id)}/versions`)).json()).toHaveLength(1)

    const promoted = await owner.write({
      method: 'POST', url: `/api/v1/life/cooking-sessions/${encodeURIComponent(session.json<{ id: string }>().id)}/promote-note`,
      payload: { expectedRecipeVersion: 1 },
    }, 'cooking-note-promote')
    expect(promoted.statusCode).toBe(201)
    expect(promoted.json()).toMatchObject({ number: 2, promotedNote: 'Use lower heat.' })
    expect((await owner.get(`/api/v1/life/recipes/${encodeURIComponent(recipe.id)}/versions`)).json()).toHaveLength(2)
  })

  it('completes cooking exactly once, consumes ingredients once, counts one eaten portion and stores three prepared portions', async () => {
    const owner = await client()
    const { rice, egg } = await seedIngredients(owner)
    for (const [itemId, quantity, unit] of [[rice.id, 1_000, 'gram'], [egg.id, 12, 'each']] as const) {
      const stocked = await owner.write({
        method: 'POST', url: '/api/v1/life/inventory/transactions',
        payload: { itemId, kind: 'purchase', quantity, unit, occurredAt: '2026-08-13T08:00:00.000Z' },
      }, `stock-${itemId}`)
      expect(stocked.statusCode).toBe(201)
    }
    const created = await createRecipe(owner, rice.id, egg.id)
    expect(created.statusCode).toBe(201)
    const recipe = created.json<{ id: string; currentVersion: { id: string } }>()
    const session = await owner.write({
      method: 'POST', url: '/api/v1/life/cooking-sessions',
      payload: { recipeId: recipe.id, recipeVersionId: recipe.currentVersion.id, plannedServings: 4, note: '' },
    }, 'cooking-session-complete')
    expect(session.statusCode).toBe(201)
    const invalidCompletion = await owner.write({
      method: 'POST', url: `/api/v1/life/cooking-sessions/${encodeURIComponent(session.json<{ id: string }>().id)}/complete`,
      payload: { madeServings: 4, eatenServings: 1, completedAt: 'not-a-timestamp' },
    }, 'cooking-complete-invalid-time')
    expect(invalidCompletion.statusCode).toBe(400)
    expect(invalidCompletion.json()).toMatchObject({ error: { code: 'INVALID_DATE' } })
    const complete = () => owner.write({
      method: 'POST', url: `/api/v1/life/cooking-sessions/${encodeURIComponent(session.json<{ id: string }>().id)}/complete`,
      payload: { madeServings: 4, eatenServings: 1, completedAt: '2026-08-13T10:00:00.000Z' },
    }, 'cooking-complete-retry')
    const first = await complete()
    const replay = await complete()

    expect(first.statusCode).toBe(201)
    expect(replay.json()).toEqual(first.json())
    expect(first.json()).toMatchObject({
      snapshot: { recipeVersionId: recipe.currentVersion.id, madeServings: 4, eatenServings: 1 },
      preparedFood: { portionsCreated: 3, portionsRemaining: 3 },
      intake: { servings: 1 },
    })
    expect((await owner.get('/api/v1/life/prepared-food')).json()).toEqual([
      expect.objectContaining({ recipeId: recipe.id, recipeVersionId: recipe.currentVersion.id, portionsRemaining: 3 }),
    ])
    const balances = await owner.get('/api/v1/life/inventory/balances')
    expect(balances.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: rice.id, onHand: 800 }),
      expect.objectContaining({ itemId: egg.id, onHand: 10 }),
    ]))
    expect((await owner.get(`/api/v1/life/inventory/transactions?itemId=${encodeURIComponent(rice.id)}`)).json()).toHaveLength(2)
  })
})
