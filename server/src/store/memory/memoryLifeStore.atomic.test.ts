import { describe, expect, it } from 'vitest'
import { MemoryLifeStore } from '../memoryLifeStore.js'

interface TransactionObserverEvent {
  userId: string
  operation: string
  phase: string
}

type AtomicMemoryLifeStoreOptions = ConstructorParameters<typeof MemoryLifeStore>[0] & {
  transactionObserver?: (event: TransactionObserverEvent) => Promise<void> | void
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

async function withDeadline<T>(promise: Promise<T>, label: string, timeoutMs = 750) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function createStore(transactionObserver: AtomicMemoryLifeStoreOptions['transactionObserver']) {
  let sequence = 0
  const options: AtomicMemoryLifeStoreOptions = {
    createId: () => `atomic-planning-${++sequence}`,
    now: () => '2026-08-14T08:00:00.000Z',
    transactionObserver,
  }
  return new MemoryLifeStore(options)
}

async function createMedicineFixture(store: MemoryLifeStore, stockQuantity = 10) {
  const user = await store.createUser({
    account: 'atomic-owner@example.com',
    displayName: 'Atomic owner',
    passwordHash: 'unused-in-direct-store-test',
  })
  const medicine = await store.createCatalogItem(user.id, {
    kind: 'medicine',
    name: 'Snapshot medicine',
    baseUnit: 'tablet',
    availableUnits: ['tablet'],
    nutrition: {
      basisQuantity: 1,
      basisUnit: 'tablet',
      values: { energyKcal: 10, proteinGrams: 1, fatGrams: 0, carbohydrateGrams: 0 },
    },
  }, 'atomic-medicine')
  await store.createInventoryTransaction(user.id, {
    itemId: medicine.id,
    kind: 'purchase',
    quantity: stockQuantity,
    unit: 'tablet',
    occurredAt: '2026-08-14T08:00:00.000Z',
    batch: { purchasedOn: '2026-08-14', expiresOn: '2026-09-30', actualUnitCostMinor: 37 },
  }, 'atomic-stock-old-batch')
  await store.createMedicineRecurrenceRule(user.id, {
    title: 'Snapshot medicine schedule',
    sourceId: medicine.id,
    quantity: 2,
    unit: 'tablet',
    recurrence: {
      mode: 'interval',
      everyDays: 1,
      times: ['08:00'],
      startDate: '2026-08-17',
      endDate: '2026-08-18',
    },
  }, 'atomic-medicine-rule')
  const occurrenceOn = async (date: string) => {
    const occurrence = (await store.getPlanningTimeline(user.id, date)).timelineItems.find((item) => (
      item.sourceType === 'medicine-occurrence'
    ))
    if (!occurrence || occurrence.sourceType !== 'medicine-occurrence') throw new Error(`Missing medicine occurrence for ${date}.`)
    return occurrence
  }
  return { user, medicine, occurrenceOn }
}

function completeOccurrence(
  store: MemoryLifeStore,
  userId: string,
  occurrence: { id: string; entityVersion: number; scheduledDate: string },
  key: string,
) {
  return store.createPlanningCompletionFromSource(userId, {
    source: { type: 'medicine-occurrence', id: occurrence.id, entityVersion: occurrence.entityVersion },
    completedAt: `${occurrence.scheduledDate}T08:05:00.000Z`,
  }, key)
}

function consumeTransactionsFor(transactions: Awaited<ReturnType<MemoryLifeStore['listInventoryTransactions']>>, occurrenceId: string) {
  return transactions.filter((transaction) => transaction.kind === 'consume' && transaction.note === `Planning completion ${occurrenceId}`)
}

describe('MemoryLifeStore atomic medicine completion snapshots', () => {
  it('holds concurrent fact mutations behind one owner snapshot and never mixes pre/post completion facts', async () => {
    const snapshotCaptured = deferred()
    const releaseSnapshot = deferred()
    let ownerId = ''
    const store = createStore(async (event) => {
      if (event.userId === ownerId
        && event.operation === 'planning:complete-medicine-occurrence'
        && event.phase === 'snapshot-captured') {
        snapshotCaptured.resolve()
        await releaseSnapshot.promise
      }
    })
    const fixture = await createMedicineFixture(store)
    ownerId = fixture.user.id
    const firstOccurrence = await fixture.occurrenceOn('2026-08-17')
    const secondOccurrence = await fixture.occurrenceOn('2026-08-18')
    const firstCompletionPromise = completeOccurrence(store, ownerId, firstOccurrence, 'atomic-first-completion')

    try {
      await withDeadline(snapshotCaptured.promise, 'planning snapshot-captured checkpoint')
    } catch (error) {
      releaseSnapshot.resolve()
      await firstCompletionPromise
      throw error
    }

    let catalogMutationSettled = false
    let inventoryMutationSettled = false
    const catalogMutation = store.updateCatalogItem(ownerId, fixture.medicine.id, {
      version: fixture.medicine.version,
      nutrition: {
        basisQuantity: 1,
        basisUnit: 'tablet',
        values: { energyKcal: 90, proteinGrams: 9, fatGrams: 0, carbohydrateGrams: 0 },
      },
    }).finally(() => { catalogMutationSettled = true })
    const inventoryMutation = store.createInventoryTransaction(ownerId, {
      itemId: fixture.medicine.id,
      kind: 'purchase',
      quantity: 10,
      unit: 'tablet',
      occurredAt: '2026-08-14T08:10:00.000Z',
      batch: { purchasedOn: '2026-08-14', expiresOn: '2026-08-25', actualUnitCostMinor: 101 },
    }, 'atomic-stock-new-earlier-batch').finally(() => { inventoryMutationSettled = true })
    await new Promise<void>((resolve) => setImmediate(resolve))
    const mutationsPendingAtRelease = [catalogMutationSettled, inventoryMutationSettled]
    releaseSnapshot.resolve()

    expect(mutationsPendingAtRelease).toEqual([false, false])
    const firstCompletion = await firstCompletionPromise
    await Promise.all([catalogMutation, inventoryMutation])
    expect(firstCompletion).toMatchObject({
      nutrition: { energyKcal: 20, proteinGrams: 2, fatGrams: 0, carbohydrateGrams: 0 },
      costMinor: 74,
    })
    expect(await completeOccurrence(store, ownerId, firstOccurrence, 'atomic-first-completion')).toEqual(firstCompletion)
    expect(consumeTransactionsFor(await store.listInventoryTransactions(ownerId), firstOccurrence.id)).toHaveLength(1)

    const secondCompletion = await completeOccurrence(store, ownerId, secondOccurrence, 'atomic-second-completion')
    expect(secondCompletion).toMatchObject({
      nutrition: { energyKcal: 180, proteinGrams: 18, fatGrams: 0, carbohydrateGrams: 0 },
      costMinor: 202,
    })
    expect(consumeTransactionsFor(await store.listInventoryTransactions(ownerId), secondOccurrence.id)).toHaveLength(1)
  })

  it('rolls back inventory, occurrence and idempotency state when completion fails after its consume effect', async () => {
    let ownerId = ''
    let failAfterInventoryEffect = true
    const store = createStore((event) => {
      if (failAfterInventoryEffect
        && event.userId === ownerId
        && event.operation === 'planning:complete-medicine-occurrence'
        && event.phase === 'inventory-effect-applied') {
        failAfterInventoryEffect = false
        throw new Error('Injected failure after inventory effect.')
      }
    })
    const fixture = await createMedicineFixture(store, 2)
    ownerId = fixture.user.id
    const occurrence = await fixture.occurrenceOn('2026-08-17')
    const completionKey = 'atomic-failure-retry'

    await expect(completeOccurrence(store, ownerId, occurrence, completionKey))
      .rejects.toThrow('Injected failure after inventory effect.')
    expect(await fixture.occurrenceOn('2026-08-17')).toMatchObject({
      id: occurrence.id,
      entityVersion: occurrence.entityVersion,
      status: 'planned',
      completionId: null,
    })
    expect(consumeTransactionsFor(await store.listInventoryTransactions(ownerId), occurrence.id)).toEqual([])
    expect(await store.listInventoryBalances(ownerId, { itemId: fixture.medicine.id })).toEqual([
      expect.objectContaining({ itemId: fixture.medicine.id, onHand: 2 }),
    ])

    const retried = await completeOccurrence(store, ownerId, occurrence, completionKey)
    expect(retried).toMatchObject({ costMinor: 74 })
    expect(await fixture.occurrenceOn('2026-08-17')).toMatchObject({
      id: occurrence.id,
      entityVersion: occurrence.entityVersion + 1,
      status: 'completed',
      completionId: retried.id,
    })
    const consumes = consumeTransactionsFor(await store.listInventoryTransactions(ownerId), occurrence.id)
    expect(consumes).toEqual([
      expect.objectContaining({
        quantity: 2,
        unit: 'tablet',
        allocations: [expect.objectContaining({ quantity: 2, expiresOn: '2026-09-30' })],
      }),
    ])
    expect(await store.listInventoryBalances(ownerId, { itemId: fixture.medicine.id })).toEqual([
      expect.objectContaining({ itemId: fixture.medicine.id, onHand: 0 }),
    ])
  })

  it('serializes every same-owner inventory-writing workflow behind an occurrence transaction', async () => {
    const snapshotCaptured = deferred()
    const releaseSnapshot = deferred()
    let ownerId = ''
    const store = createStore(async (event) => {
      if (event.userId === ownerId
        && event.operation === 'planning:complete-medicine-occurrence'
        && event.phase === 'snapshot-captured') {
        snapshotCaptured.resolve()
        await releaseSnapshot.promise
      }
      if (event.userId === ownerId
        && event.operation === 'planning:complete-medicine-occurrence'
        && event.phase === 'inventory-effect-applied') {
        throw new Error('Injected owner-serialization rollback.')
      }
    })
    const fixture = await createMedicineFixture(store, 20)
    ownerId = fixture.user.id
    const occurrence = await fixture.occurrenceOn('2026-08-17')
    const day = await store.createDayPlan(ownerId, {
      date: '2026-08-19',
      mealSlots: [],
      items: [
        { kind: 'medicine', title: 'Legacy completion', mealSlotId: null, scheduledTime: '08:00', source: { type: 'catalog-item', id: fixture.medicine.id }, quantity: 1, unit: 'tablet', servings: null, durationMinutes: null },
        { kind: 'medicine', title: 'Unified completion', mealSlotId: null, scheduledTime: '09:00', source: { type: 'catalog-item', id: fixture.medicine.id }, quantity: 1, unit: 'tablet', servings: null, durationMinutes: null },
        { kind: 'medicine', title: 'Undo completion', mealSlotId: null, scheduledTime: '10:00', source: { type: 'catalog-item', id: fixture.medicine.id }, quantity: 1, unit: 'tablet', servings: null, durationMinutes: null },
      ],
    }, 'atomic-owner-day')
    const undoTarget = await store.createPlanningCompletion(ownerId, {
      date: day.date,
      dayPlanItemId: day.items[2]!.id,
      completedAt: '2026-08-19T10:05:00.000Z',
    }, 'atomic-owner-undo-target')

    const ingredient = await store.createCatalogItem(ownerId, {
      kind: 'ingredient',
      name: 'Atomic cooking ingredient',
      baseUnit: 'gram',
      nutrition: {
        basisQuantity: 100,
        basisUnit: 'gram',
        values: { energyKcal: 100, proteinGrams: 4, fatGrams: 1, carbohydrateGrams: 20 },
      },
      pricePoints: [{ amountMinor: 100, currency: 'CNY', purchaseQuantity: 100, purchaseUnit: 'gram', effectiveFrom: '2026-08-01' }],
    }, 'atomic-cooking-ingredient')
    await store.createInventoryTransaction(ownerId, {
      itemId: ingredient.id,
      kind: 'purchase',
      quantity: 500,
      unit: 'gram',
      occurredAt: '2026-08-14T08:15:00.000Z',
    }, 'atomic-cooking-stock')
    const recipe = await store.createRecipe(ownerId, {
      name: 'Atomic cooking recipe',
      servings: 1,
      components: [{ itemId: ingredient.id, quantity: 100, unit: 'gram', role: 'ingredient', position: 0 }],
      steps: [{ instruction: 'Cook.', ingredientItemIds: [ingredient.id], durationSeconds: 60, imageMediaId: null, caution: '', position: 0 }],
    }, 'atomic-cooking-recipe')
    const cooking = await store.createCookingSession(ownerId, {
      recipeId: recipe.id,
      recipeVersionId: recipe.currentVersion.id,
      plannedServings: 1,
    }, 'atomic-cooking-session')

    const occurrenceCompletion = completeOccurrence(store, ownerId, occurrence, 'atomic-owner-occurrence')
    try {
      await withDeadline(snapshotCaptured.promise, 'owner serialization snapshot checkpoint')
    } catch (error) {
      releaseSnapshot.resolve()
      await occurrenceCompletion
      throw error
    }

    const settled = { legacy: false, unified: false, undo: false, cooking: false }
    const legacyCompletion = store.createPlanningCompletion(ownerId, {
      date: day.date,
      dayPlanItemId: day.items[0]!.id,
      completedAt: '2026-08-19T08:05:00.000Z',
    }, 'atomic-owner-legacy').finally(() => { settled.legacy = true })
    const unifiedCompletion = store.createPlanningCompletionFromSource(ownerId, {
      source: { type: 'day-plan-item', date: day.date, dayPlanItemId: day.items[1]!.id },
      completedAt: '2026-08-19T09:05:00.000Z',
    }, 'atomic-owner-unified').finally(() => { settled.unified = true })
    const undo = store.undoPlanningCompletion(ownerId, undoTarget.id, 'atomic-owner-undo')
      .finally(() => { settled.undo = true })
    const cookingCompletion = store.completeCookingSession(ownerId, cooking.id, {
      madeServings: 1,
      eatenServings: 1,
      completedAt: '2026-08-19T11:00:00.000Z',
    }, 'atomic-owner-cooking').finally(() => { settled.cooking = true })

    await new Promise<void>((resolve) => setImmediate(resolve))
    const settledBeforeRelease = { ...settled }
    releaseSnapshot.resolve()

    expect(settledBeforeRelease).toEqual({ legacy: false, unified: false, undo: false, cooking: false })
    await expect(occurrenceCompletion).rejects.toThrow('Injected owner-serialization rollback.')
    await expect(legacyCompletion).resolves.toMatchObject({ completionSource: { type: 'day-plan-item', dayPlanItemId: day.items[0]!.id } })
    await expect(unifiedCompletion).resolves.toMatchObject({ completionSource: { type: 'day-plan-item', dayPlanItemId: day.items[1]!.id } })
    await expect(undo).resolves.toMatchObject({ completionId: undoTarget.id, status: 'planned' })
    await expect(cookingCompletion).resolves.toMatchObject({ snapshot: { cookingSessionId: cooking.id } })
    await expect(store.getDayPlan(ownerId, day.date)).resolves.toMatchObject({
      items: [
        expect.objectContaining({ id: day.items[0]!.id, status: 'completed', completionId: expect.any(String) }),
        expect.objectContaining({ id: day.items[1]!.id, status: 'completed', completionId: expect.any(String) }),
        expect.objectContaining({ id: day.items[2]!.id, status: 'planned', completionId: null }),
      ],
    })
    await expect(store.getCookingSession(ownerId, cooking.id)).resolves.toMatchObject({ status: 'completed' })
  })

  it('never exposes a partially applied occurrence completion to same-owner reads', async () => {
    const inventoryEffectApplied = deferred()
    const releaseInventoryEffect = deferred()
    let ownerId = ''
    const store = createStore(async (event) => {
      if (event.userId === ownerId
        && event.operation === 'planning:complete-medicine-occurrence'
        && event.phase === 'inventory-effect-applied') {
        inventoryEffectApplied.resolve()
        await releaseInventoryEffect.promise
      }
    })
    const fixture = await createMedicineFixture(store, 10)
    ownerId = fixture.user.id
    const ingredient = await store.createCatalogItem(ownerId, {
      kind: 'ingredient',
      name: 'Atomic read-isolation ingredient',
      baseUnit: 'gram',
      availableUnits: ['gram'],
      nutrition: {
        basisQuantity: 100,
        basisUnit: 'gram',
        values: { energyKcal: 120, proteinGrams: 4, fatGrams: 1, carbohydrateGrams: 24 },
      },
      pricePoints: [{ amountMinor: 100, currency: 'CNY', purchaseQuantity: 100, purchaseUnit: 'gram', effectiveFrom: '2026-08-01' }],
    }, 'atomic-read-isolation-ingredient')
    await store.createInventoryTransaction(ownerId, {
      itemId: ingredient.id,
      kind: 'purchase',
      quantity: 500,
      unit: 'gram',
      occurredAt: '2026-08-14T08:00:00.000Z',
    }, 'atomic-read-isolation-ingredient-stock')
    const recipeInput = {
      name: 'Atomic read-isolation recipe',
      servings: 2,
      components: [{ itemId: ingredient.id, quantity: 200, unit: 'gram', role: 'ingredient' as const, position: 0 }],
      steps: [{ instruction: 'Cook.', ingredientItemIds: [ingredient.id], durationSeconds: 60, imageMediaId: null, caution: '', position: 0 }],
    }
    const recipe = await store.createRecipe(ownerId, recipeInput, 'atomic-read-isolation-recipe')
    const occurrence = await fixture.occurrenceOn('2026-08-17')
    const completionPromise = completeOccurrence(store, ownerId, occurrence, 'atomic-read-isolation')

    try {
      await withDeadline(inventoryEffectApplied.promise, 'inventory-effect-applied read-isolation checkpoint')
    } catch (error) {
      releaseInventoryEffect.resolve()
      await completionPromise
      throw error
    }

    const settled = { timeline: false, balances: false, transactions: false, recipePreview: false, storedRecipe: false }
    const timelinePromise = store.getPlanningTimeline(ownerId, occurrence.scheduledDate)
      .finally(() => { settled.timeline = true })
    const balancesPromise = store.listInventoryBalances(ownerId, { itemId: fixture.medicine.id })
      .finally(() => { settled.balances = true })
    const transactionsPromise = store.listInventoryTransactions(ownerId)
      .finally(() => { settled.transactions = true })
    const recipePreviewPromise = store.previewRecipeImpact(ownerId, recipe.id, {
      ...recipeInput,
      entityVersion: recipe.entityVersion,
    }).finally(() => { settled.recipePreview = true })
    const storedRecipePromise = store.calculateStoredRecipe(ownerId, recipe.id, {
      mode: 'latest',
      asOf: '2026-08-17',
    }).finally(() => { settled.storedRecipe = true })
    await new Promise<void>((resolve) => setImmediate(resolve))
    const settledBeforeRelease = { ...settled }
    releaseInventoryEffect.resolve()

    expect(settledBeforeRelease).toEqual({
      timeline: false,
      balances: false,
      transactions: false,
      recipePreview: false,
      storedRecipe: false,
    })
    const completion = await completionPromise
    await expect(timelinePromise).resolves.toMatchObject({
      timelineItems: [expect.objectContaining({
        id: occurrence.id,
        status: 'completed',
        completionId: completion.id,
      })],
    })
    await expect(balancesPromise).resolves.toEqual([
      expect.objectContaining({ itemId: fixture.medicine.id, onHand: 8 }),
    ])
    await expect(transactionsPromise).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'consume', note: `Planning completion ${occurrence.id}` }),
    ]))
    await expect(recipePreviewPromise).resolves.toMatchObject({
      calculation: { status: 'complete', ingredients: [expect.objectContaining({ itemId: ingredient.id, onHand: 500 })] },
    })
    await expect(storedRecipePromise).resolves.toMatchObject({
      status: 'complete',
      ingredients: [expect.objectContaining({ itemId: ingredient.id, onHand: 500 })],
    })
  })
})

async function createShoppingRecalculationFixture(store: MemoryLifeStore) {
  const user = await store.createUser({
    account: 'shopping-atomic-owner@example.com',
    displayName: 'Shopping atomic owner',
    passwordHash: 'unused-in-direct-store-test',
  })
  const item = await store.createCatalogItem(user.id, {
    kind: 'supplement', name: 'Atomic shopping item', baseUnit: 'each', availableUnits: ['each'],
  }, 'atomic-shopping-item')
  await store.upsertInventoryPolicy(user.id, item.id, {
    minimumStock: 2, packageQuantity: 4, unitId: 'builtin:each',
  }, 'atomic-shopping-policy')
  await store.createInventoryTransaction(user.id, {
    itemId: item.id, kind: 'purchase', quantity: 1, unit: 'each',
    occurredAt: '2026-08-14T07:00:00.000Z', batch: { expiresOn: '2026-12-31' },
  }, 'atomic-shopping-stock-one')
  const day = await store.createDayPlan(user.id, {
    date: '2026-08-18', mealSlots: [], items: [{
      kind: 'supplement', title: 'Atomic shopping demand', mealSlotId: null, scheduledTime: '08:00',
      source: { type: 'catalog-item', id: item.id }, quantity: 5, unit: 'each', servings: null, durationMinutes: null,
    }],
  }, 'atomic-shopping-day')
  await store.createShoppingItem(user.id, {
    itemId: item.id, requestedQuantity: 1, unit: 'each', neededOn: '2026-08-18',
  }, 'atomic-shopping-formal-one')
  await store.createShoppingSuggestion(user.id, {
    itemId: item.id, requiredQuantity: 2, unit: 'each', packageQuantity: 1,
    reason: { kind: 'manual', sourceType: 'manual', sourceId: 'atomic-manual', requiredOn: null },
  }, 'atomic-shopping-manual')
  return { user, item, day }
}

describe('MemoryLifeStore atomic shopping recalculation', () => {
  it('holds concurrent owner mutations behind one recalculation snapshot', async () => {
    const snapshotCaptured = deferred()
    const releaseSnapshot = deferred()
    let ownerId = ''
    const store = createStore(async (event) => {
      if (event.userId === ownerId && event.operation === 'commerce:recalculate-shopping' && event.phase === 'snapshot-captured') {
        snapshotCaptured.resolve()
        await releaseSnapshot.promise
      }
    })
    const fixture = await createShoppingRecalculationFixture(store)
    ownerId = fixture.user.id
    const recalculation = store.recalculateShopping(ownerId, { through: '2026-08-18' }, 'atomic-shopping-recalculate-pre')
    try {
      await withDeadline(snapshotCaptured.promise, 'shopping snapshot-captured checkpoint')
    } catch (error) {
      releaseSnapshot.resolve()
      await recalculation
      throw error
    }
    let stockMutationSettled = false
    const stockMutation = store.createInventoryTransaction(ownerId, {
      itemId: fixture.item.id, kind: 'purchase', quantity: 4, unit: 'each',
      occurredAt: '2026-08-14T09:00:00.000Z', batch: { expiresOn: '2026-12-31' },
    }, 'atomic-shopping-stock-four').finally(() => { stockMutationSettled = true })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(stockMutationSettled).toBe(false)
    releaseSnapshot.resolve()

    await expect(recalculation).resolves.toMatchObject({
      calculations: [expect.objectContaining({ effectiveStock: 1, rawShortage: 5, suggestedQuantity: 8 })],
    })
    await stockMutation
    await expect(store.recalculateShopping(ownerId, { through: '2026-08-18' }, 'atomic-shopping-recalculate-post')).resolves.toMatchObject({
      calculations: [expect.objectContaining({ effectiveStock: 5, rawShortage: 1, suggestedQuantity: 4 })],
    })
  })

  it('rolls back derived replacement and idempotency when failure occurs after the effect', async () => {
    let ownerId = ''
    let failAfterEffect = true
    const store = createStore((event) => {
      if (failAfterEffect && event.userId === ownerId && event.operation === 'commerce:recalculate-shopping' && event.phase === 'derived-effect-applied') {
        throw new Error('INJECTED_SHOPPING_RECALCULATION_FAILURE')
      }
    })
    const fixture = await createShoppingRecalculationFixture(store)
    ownerId = fixture.user.id

    await expect(store.recalculateShopping(ownerId, { through: '2026-08-18' }, 'atomic-shopping-recalculate-rollback'))
      .rejects.toThrow('INJECTED_SHOPPING_RECALCULATION_FAILURE')
    expect((await store.listShopping(ownerId)).suggestions).toEqual([
      expect.objectContaining({ origin: 'manual', reasons: [expect.objectContaining({ sourceId: 'atomic-manual' })] }),
    ])

    failAfterEffect = false
    await expect(store.recalculateShopping(ownerId, { through: '2026-08-18' }, 'atomic-shopping-recalculate-rollback')).resolves.toMatchObject({
      suggestions: [expect.objectContaining({ origin: 'derived', suggestedQuantity: 8 })],
    })
    expect((await store.listShopping(ownerId)).suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ origin: 'manual' }),
      expect.objectContaining({ origin: 'derived', suggestedQuantity: 8 }),
    ]))
  })

  it('holds recipe-version mutations behind a recalculation that reads recipe demand', async () => {
    const snapshotCaptured = deferred()
    const releaseSnapshot = deferred()
    let ownerId = ''
    const store = createStore(async (event) => {
      if (event.userId === ownerId && event.operation === 'commerce:recalculate-shopping' && event.phase === 'snapshot-captured') {
        snapshotCaptured.resolve()
        await releaseSnapshot.promise
      }
    })
    const user = await store.createUser({
      account: 'shopping-recipe-atomic-owner@example.com', displayName: 'Shopping recipe atomic owner',
      passwordHash: 'unused-in-direct-store-test',
    })
    ownerId = user.id
    const ingredient = await store.createCatalogItem(ownerId, {
      kind: 'ingredient', name: 'Atomic recipe ingredient', baseUnit: 'gram', availableUnits: ['gram'],
    }, 'atomic-shopping-recipe-ingredient')
    await store.upsertInventoryPolicy(ownerId, ingredient.id, {
      minimumStock: 0, packageQuantity: 100, unitId: 'builtin:gram',
    }, 'atomic-shopping-recipe-policy')
    const recipeInput = {
      name: 'Atomic shopping recipe', servings: 1,
      components: [{ itemId: ingredient.id, quantity: 100, unit: 'gram', role: 'ingredient' as const, position: 0 }],
      steps: [{ instruction: 'Cook.', ingredientItemIds: [ingredient.id], durationSeconds: 60, imageMediaId: null, caution: '', position: 0 }],
    }
    const recipe = await store.createRecipe(ownerId, recipeInput, 'atomic-shopping-recipe')
    await store.createDayPlan(ownerId, {
      date: '2026-08-18', mealSlots: [], items: [{
        kind: 'meal', title: 'Atomic shopping recipe', mealSlotId: null, scheduledTime: '12:00',
        source: { type: 'recipe-version', id: recipe.id, versionId: null }, quantity: null, unit: null,
        servings: 1, durationMinutes: null,
      }],
    }, 'atomic-shopping-recipe-day')

    const recalculation = store.recalculateShopping(ownerId, { through: '2026-08-18' }, 'atomic-shopping-recipe-pre')
    try {
      await withDeadline(snapshotCaptured.promise, 'shopping recipe snapshot-captured checkpoint')
    } catch (error) {
      releaseSnapshot.resolve()
      await recalculation
      throw error
    }
    let recipeMutationSettled = false
    const recipeMutation = store.updateRecipe(ownerId, recipe.id, {
      ...recipeInput, entityVersion: recipe.entityVersion,
      components: [{ ...recipeInput.components[0]!, quantity: 200 }],
    }).finally(() => { recipeMutationSettled = true })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(recipeMutationSettled).toBe(false)
    releaseSnapshot.resolve()

    await expect(recalculation).resolves.toMatchObject({
      calculations: [expect.objectContaining({ itemId: ingredient.id, plannedDemand: 100, suggestedQuantity: 100 })],
    })
    await recipeMutation
    await expect(store.recalculateShopping(ownerId, { through: '2026-08-18' }, 'atomic-shopping-recipe-post')).resolves.toMatchObject({
      calculations: [expect.objectContaining({ itemId: ingredient.id, plannedDemand: 200, suggestedQuantity: 200 })],
    })
  })
})
