import { describe, expect, it } from 'vitest'
import {
  LifeCatalogDomainError,
  assertCategoryMove,
  calculateNutrition,
  convertUnit,
  createCatalogItemEntity,
  selectEffectivePrice,
  updateCatalogItemEntity,
  type ItemUnitConversion,
  type NutritionProfile,
  type PricePoint,
} from './catalog.js'

const timestamp = '2026-08-21T08:00:00.000Z'
const createId = () => 'generated-id'

describe('life catalog discriminated factual profiles', () => {
  it('preserves each approved supplement and household profile branch without advice fields', () => {
    const supplement = createCatalogItemEntity('supplement-1', timestamp, {
      kind: 'supplement',
      name: 'User-authored supplement facts',
      baseUnit: 'capsule',
      profile: {
        kind: 'supplement',
        servingQuantity: 2,
        servingUnit: 'capsule',
        ingredients: ['magnesium glycinate', 'rice flour'],
        defaultFrequency: 'with the evening meal',
        userInstructions: 'My own note',
        reminder: { enabled: true, localTimes: ['19:30'], note: 'User-authored reminder' },
      },
    }, createId)
    const consumable = createCatalogItemEntity('consumable-1', timestamp, {
      kind: 'household_consumable',
      name: 'Dish soap',
      baseUnit: 'bottle',
      profile: {
        kind: 'household_consumable',
        defaultPurchaseQuantity: 2,
        defaultPurchaseUnit: 'bottle',
        consumptionCycleDays: 45,
        estimatedDepletionDate: '2026-10-05',
      },
    }, createId)
    const durable = createCatalogItemEntity('durable-1', timestamp, {
      kind: 'household_durable',
      name: 'Vacuum cleaner',
      baseUnit: 'each',
      profile: {
        kind: 'household_durable',
        valueMinor: 129_900,
        currency: 'cny',
        valueAsOfDate: '2026-08-21',
        lifecycleStatus: 'maintenance',
        acquiredOn: '2025-03-01',
        warrantyExpiresOn: '2027-03-01',
        maintenanceRecords: [{ id: 'maintenance-1', performedOn: '2026-08-20', summary: 'Filter replaced', costMinor: 4_500, currency: 'cny' }],
        retiredOn: null,
        retirementReason: null,
        setItemIds: ['attachment-1', 'attachment-2'],
      },
    }, createId)

    expect(supplement.profile).toEqual({
      kind: 'supplement',
      servingQuantity: 2,
      servingUnit: 'capsule',
      ingredients: ['magnesium glycinate', 'rice flour'],
      defaultFrequency: 'with the evening meal',
      userInstructions: 'My own note',
      reminder: { enabled: true, localTimes: ['19:30'], note: 'User-authored reminder' },
    })
    expect(consumable.profile).toEqual({
      kind: 'household_consumable',
      defaultPurchaseQuantity: 2,
      defaultPurchaseUnit: 'bottle',
      consumptionCycleDays: 45,
      estimatedDepletionDate: '2026-10-05',
    })
    expect(durable.profile).toEqual({
      kind: 'household_durable',
      valueMinor: 129_900,
      currency: 'CNY',
      valueAsOfDate: '2026-08-21',
      lifecycleStatus: 'maintenance',
      acquiredOn: '2025-03-01',
      warrantyExpiresOn: '2027-03-01',
      maintenanceRecords: [{ id: 'maintenance-1', performedOn: '2026-08-20', summary: 'Filter replaced', costMinor: 4_500, currency: 'CNY' }],
      retiredOn: null,
      retirementReason: null,
      setItemIds: ['attachment-1', 'attachment-2'],
    })
  })

  it('rejects kind-incompatible, incoherent and advice-like profiles at the domain boundary', () => {
    expect(() => createCatalogItemEntity('wrong-kind', timestamp, {
      kind: 'ingredient', name: 'Wrong branch', baseUnit: 'gram',
      profile: { kind: 'supplement', servingQuantity: 1, servingUnit: 'capsule' },
    }, createId)).toThrowError(expect.objectContaining<Partial<Error>>({ message: expect.stringContaining('kind') }))

    expect(() => createCatalogItemEntity('unpaired', timestamp, {
      kind: 'household_consumable', name: 'Unpaired purchase fact', baseUnit: 'each',
      profile: { kind: 'household_consumable', defaultPurchaseQuantity: 1 },
    }, createId)).toThrowError(expect.objectContaining<Partial<Error>>({ message: expect.stringContaining('together') }))

    expect(() => createCatalogItemEntity('advice', timestamp, {
      kind: 'household_durable', name: 'Advice is not a fact', baseUnit: 'each',
      profile: { kind: 'household_durable', replacementAdvice: 'Replace it now' },
    } as never, createId)).toThrowError(expect.objectContaining<Partial<Error>>({ message: expect.stringContaining('facts') }))
  })

  it('rejects malformed date, local-time, lifecycle and monetary facts', () => {
    expect(() => createCatalogItemEntity('bad-time', timestamp, {
      kind: 'supplement', name: 'Bad reminder', baseUnit: 'capsule',
      profile: { kind: 'supplement', reminder: { enabled: true, localTimes: ['25:90'] } },
    }, createId)).toThrowError(expect.objectContaining<Partial<Error>>({ message: expect.stringContaining('local time') }))

    expect(() => createCatalogItemEntity('bad-durable', timestamp, {
      kind: 'household_durable', name: 'Bad durable facts', baseUnit: 'each',
      profile: { kind: 'household_durable', valueMinor: -1, currency: 'CNY', lifecycleStatus: 'retired', retiredOn: '2026-02-30' },
    }, createId)).toThrow()
  })

  it('clears an omitted incompatible profile on kind retype and rejects an explicit wrong branch', () => {
    const supplement = createCatalogItemEntity('retype-1', timestamp, {
      kind: 'supplement', name: 'Retype me', baseUnit: 'capsule',
      profile: { kind: 'supplement', servingQuantity: 1, servingUnit: 'capsule' },
    }, createId)

    const retyped = updateCatalogItemEntity(supplement, '2026-08-21T09:00:00.000Z', {
      version: 1,
      kind: 'household_consumable',
    }, createId)
    expect(retyped).toMatchObject({ kind: 'household_consumable', version: 2 })
    expect(retyped.profile).toBeUndefined()

    expect(() => updateCatalogItemEntity(supplement, '2026-08-21T09:00:00.000Z', {
      version: 1,
      kind: 'household_consumable',
      profile: { kind: 'supplement', servingQuantity: 1, servingUnit: 'capsule' },
    }, createId)).toThrowError(expect.objectContaining<Partial<Error>>({ message: expect.stringContaining('kind') }))
  })
})

describe('life catalog unit conversion', () => {
  it.each([
    { quantity: 1, fromUnit: 'kilogram', toBaseUnit: 'gram', expected: 1_000 },
    { quantity: 1, fromUnit: 'jin', toBaseUnit: 'gram', expected: 500 },
    { quantity: 1, fromUnit: 'litre', toBaseUnit: 'millilitre', expected: 1_000 },
  ])('converts fixed $fromUnit units into $toBaseUnit', ({ expected, ...input }) => {
    expect(convertUnit(input)).toEqual({ status: 'complete', baseQuantity: expected })
  })

  it.each([
    { itemId: 'egg', fromUnit: 'egg', toBaseUnit: 'gram', factor: 55, quantity: 2, expected: 110 },
    { itemId: 'milk', fromUnit: 'box', toBaseUnit: 'millilitre', factor: 250, quantity: 3, expected: 750 },
    { itemId: 'supplement', fromUnit: 'package', toBaseUnit: 'capsule', factor: 30, quantity: 2, expected: 60 },
  ])('uses the item-specific $fromUnit rule for $itemId', ({ expected, factor, ...input }) => {
    const itemConversions: ItemUnitConversion[] = [{
      itemId: input.itemId,
      fromUnit: input.fromUnit,
      toUnit: input.toBaseUnit,
      factor,
    }]
    expect(convertUnit({ ...input, itemConversions })).toEqual({ status: 'complete', baseQuantity: expected })
  })

  it('rejects cross-dimension conversion when no item density or explicit rule exists', () => {
    expect(convertUnit({ quantity: 1, fromUnit: 'kilogram', toBaseUnit: 'millilitre' })).toEqual({
      status: 'incomplete',
      reason: 'cross_dimension',
    })
  })

  it('uses a user-defined same-dimension unit instead of leaving unit CRUD disconnected from calculation', () => {
    expect(convertUnit({
      quantity: 2,
      fromUnit: 'cup',
      toBaseUnit: 'millilitre',
      units: [{ code: 'cup', dimension: 'volume', baseCode: 'millilitre', toBaseFactor: 240 }],
    })).toEqual({ status: 'complete', baseQuantity: 480 })
  })
})

describe('life catalog effective facts', () => {
  const prices: PricePoint[] = [
    { id: 'price-old', amountMinor: 1_200, currency: 'CNY', purchaseQuantity: 1, purchaseUnit: 'package', effectiveFrom: '2026-06-01' },
    { id: 'price-current', amountMinor: 980, currency: 'CNY', purchaseQuantity: 1, purchaseUnit: 'package', effectiveFrom: '2026-08-01' },
    { id: 'price-future', amountMinor: 1_100, currency: 'CNY', purchaseQuantity: 1, purchaseUnit: 'package', effectiveFrom: '2026-09-01' },
  ]

  it('selects the latest price effective on the requested date without using a future value', () => {
    expect(selectEffectivePrice(prices, '2026-08-10')?.id).toBe('price-current')
    expect(selectEffectivePrice(prices, '2026-05-31')).toBeUndefined()
  })

  it('returns nutrition incomplete when nutrition facts are absent instead of coercing them to zero', () => {
    expect(calculateNutrition({
      itemId: 'ingredient-without-nutrition',
      quantity: 100,
      unit: 'gram',
      baseUnit: 'gram',
    })).toEqual({ status: 'incomplete', missing: ['nutrition'] })
  })

  it('returns nutrition incomplete when the requested amount cannot be converted', () => {
    const profile: NutritionProfile = {
      basisQuantity: 100,
      basisUnit: 'gram',
      values: { energyKcal: 52, proteinGrams: 0.3, fatGrams: 0.2, carbohydrateGrams: 14 },
    }
    expect(calculateNutrition({
      itemId: 'apple',
      quantity: 1,
      unit: 'millilitre',
      baseUnit: 'gram',
      profile,
    })).toEqual({ status: 'incomplete', missing: ['conversion'] })
  })
})

describe('life catalog category tree', () => {
  it('rejects moving a category below one of its descendants', () => {
    const nodes = [
      { id: 'food', parentId: null },
      { id: 'fresh', parentId: 'food' },
      { id: 'vegetables', parentId: 'fresh' },
    ]

    expect(() => assertCategoryMove(nodes, 'food', 'vegetables')).toThrowError(
      expect.objectContaining<Partial<LifeCatalogDomainError>>({ code: 'CATEGORY_CYCLE' }),
    )
  })
})
