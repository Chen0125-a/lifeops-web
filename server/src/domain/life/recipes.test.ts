import { describe, expect, it } from 'vitest'
import { BUILT_IN_UNITS, type CatalogItem, type NutritionValues } from './catalog.js'
import {
  buildIngredientRecipeRelations,
  calculateRecipe,
  diffRecipeVersions,
  resolveCookingCompletion,
  resolveCookingNotePromotion,
  scaleRecipeVersion,
  selectRecipeVersion,
  type RecipeVersion,
} from './recipes.js'

const timestamp = '2026-08-13T09:00:00.000Z'

function item(
  id: string,
  input: Partial<CatalogItem> & Pick<CatalogItem, 'baseUnit'>,
): CatalogItem {
  return {
    id,
    kind: 'ingredient',
    name: id,
    aliases: [],
    status: 'active',
    categoryId: null,
    tagIds: [],
    locationId: null,
    availableUnits: [input.baseUnit],
    itemConversions: [],
    pricePoints: [],
    attachments: [],
    notes: '',
    customOrder: 0,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    ...input,
  }
}

function version(input: Partial<RecipeVersion> = {}): RecipeVersion {
  return {
    id: 'version-1',
    recipeId: 'recipe-1',
    number: 1,
    servings: 2,
    yieldQuantity: 2,
    yieldUnit: 'portion',
    components: [
      { id: 'component-rice', itemId: 'rice', quantity: 200, unit: 'gram', role: 'ingredient', position: 0 },
      { id: 'component-egg', itemId: 'egg', quantity: 2, unit: 'each', role: 'ingredient', position: 1 },
    ],
    steps: [{ id: 'step-1', instruction: 'Cook together', ingredientItemIds: ['rice', 'egg'], durationSeconds: 600, imageMediaId: null, caution: '', position: 0 }],
    promotedNote: null,
    createdAt: timestamp,
    ...input,
  }
}

const nutrition = (energyKcal: number, proteinGrams: number, fatGrams: number, carbohydrateGrams: number): NutritionValues => ({
  energyKcal,
  proteinGrams,
  fatGrams,
  carbohydrateGrams,
})

const rice = item('rice', {
  baseUnit: 'gram',
  availableUnits: ['gram', 'kilogram'],
  nutrition: { basisQuantity: 100, basisUnit: 'gram', values: nutrition(130, 2.7, 0.3, 28) },
  pricePoints: [{ id: 'rice-price', amountMinor: 1_000, currency: 'CNY', purchaseQuantity: 1, purchaseUnit: 'kilogram', effectiveFrom: '2026-08-01' }],
})

const egg = item('egg', {
  baseUnit: 'each',
  availableUnits: ['each', 'dozen'],
  nutrition: { basisQuantity: 1, basisUnit: 'each', values: nutrition(70, 6, 5, 0.5) },
  pricePoints: [{ id: 'egg-price', amountMinor: 600, currency: 'CNY', purchaseQuantity: 12, purchaseUnit: 'each', effectiveFrom: '2026-08-01' }],
})

describe('recipe calculation completeness', () => {
  it('derives whole-dish and per-serving nutrition and cost from traceable catalog facts', () => {
    const result = calculateRecipe({ version: version(), items: [rice, egg], units: BUILT_IN_UNITS, asOf: '2026-08-13' })

    expect(result).toMatchObject({
      status: 'complete',
      servings: 2,
      scaleFactor: 1,
      totalCostMinor: 300,
      perServingCostMinor: 150,
      totalNutrition: nutrition(400, 17.4, 10.6, 57),
      perServingNutrition: nutrition(200, 8.7, 5.3, 28.5),
      missing: [],
    })
  })

  it('uses the ingredient-specific package conversion before calculating nutrition and cost', () => {
    const tomatoes = item('tomato', {
      baseUnit: 'gram',
      availableUnits: ['gram', 'can'],
      itemConversions: [{ itemId: 'tomato', fromUnit: 'can', toUnit: 'gram', factor: 400 }],
      nutrition: { basisQuantity: 100, basisUnit: 'gram', values: nutrition(18, 0.9, 0.2, 3.9) },
      pricePoints: [{ id: 'tomato-price', amountMinor: 200, currency: 'CNY', purchaseQuantity: 1, purchaseUnit: 'can', effectiveFrom: '2026-08-01' }],
    })
    const recipe = version({
      servings: 4,
      components: [{ id: 'component-tomato', itemId: 'tomato', quantity: 1, unit: 'can', role: 'ingredient', position: 0 }],
    })

    expect(calculateRecipe({ version: recipe, items: [tomatoes], units: BUILT_IN_UNITS, asOf: '2026-08-13' })).toMatchObject({
      status: 'complete',
      ingredients: [{ itemId: 'tomato', baseQuantity: 400, costMinor: 200, nutrition: nutrition(72, 3.6, 0.8, 15.6) }],
      totalCostMinor: 200,
      perServingCostMinor: 50,
    })
  })

  it('reports every missing conversion, nutrition and price instead of treating unknown facts as zero', () => {
    const incomplete = item('mystery', {
      baseUnit: 'gram',
      availableUnits: ['gram', 'teaspoon'],
      nutrition: undefined,
      pricePoints: [],
    })
    const recipe = version({
      components: [{ id: 'component-mystery', itemId: 'mystery', quantity: 1, unit: 'teaspoon', role: 'seasoning', position: 0 }],
    })

    expect(calculateRecipe({ version: recipe, items: [incomplete], units: BUILT_IN_UNITS, asOf: '2026-08-13' })).toEqual({
      status: 'incomplete',
      servings: 2,
      scaleFactor: 1,
      ingredients: [{
        itemId: 'mystery', quantity: 1, unit: 'teaspoon', baseQuantity: null, costMinor: null,
        nutrition: null, onHand: null, shortage: null,
      }],
      totalCostMinor: null,
      perServingCostMinor: null,
      totalNutrition: null,
      perServingNutrition: null,
      cookingOilGrams: 0,
      perServingCookingOilGrams: 0,
      missing: [{ itemId: 'mystery', facts: ['conversion', 'nutrition', 'price'] }],
    })
  })

  it('adds custom nutrition fields and counts only explicitly marked cooking oil in grams', () => {
    const oil = item('oil', {
      baseUnit: 'gram',
      isCookingOil: true,
      nutrition: {
        basisQuantity: 100,
        basisUnit: 'gram',
        values: { ...nutrition(900, 0, 100, 0), custom: { sodiumMilligrams: 2 } },
      },
      pricePoints: [{ id: 'oil-price', amountMinor: 2_000, currency: 'CNY', purchaseQuantity: 1_000, purchaseUnit: 'gram', effectiveFrom: '2026-08-01' }],
    })
    const nuts = item('nuts', {
      baseUnit: 'gram',
      isCookingOil: false,
      nutrition: {
        basisQuantity: 100,
        basisUnit: 'gram',
        values: { ...nutrition(600, 20, 50, 20), custom: { sodiumMilligrams: 10 } },
      },
      pricePoints: [{ id: 'nuts-price', amountMinor: 3_000, currency: 'CNY', purchaseQuantity: 1_000, purchaseUnit: 'gram', effectiveFrom: '2026-08-01' }],
    })
    const result = calculateRecipe({
      version: version({
        servings: 2,
        components: [
          { id: 'component-oil', itemId: 'oil', quantity: 20, unit: 'gram', role: 'seasoning', position: 0 },
          { id: 'component-nuts', itemId: 'nuts', quantity: 20, unit: 'gram', role: 'ingredient', position: 1 },
        ],
      }),
      items: [oil, nuts],
      units: BUILT_IN_UNITS,
      asOf: '2026-08-13',
    })

    expect(result).toMatchObject({
      status: 'complete',
      cookingOilGrams: 20,
      perServingCookingOilGrams: 10,
      totalNutrition: { custom: { sodiumMilligrams: 2.4 } },
      perServingNutrition: { custom: { sodiumMilligrams: 1.2 } },
    })
  })
})

describe('recipe scaling and immutable versions', () => {
  it('scales every component proportionally from two to five servings', () => {
    expect(scaleRecipeVersion(version(), { items: [rice, egg], units: BUILT_IN_UNITS, targetServings: 5 })).toMatchObject({
      scaleFactor: 2.5,
      servings: 5,
      components: [
        { itemId: 'rice', quantity: 500, unit: 'gram' },
        { itemId: 'egg', quantity: 5, unit: 'each' },
      ],
    })
  })

  it('uses a locked ingredient quantity as the scale anchor', () => {
    expect(scaleRecipeVersion(version(), {
      items: [rice, egg],
      units: BUILT_IN_UNITS,
      lockedIngredient: { itemId: 'rice', quantity: 350, unit: 'gram' },
    })).toMatchObject({
      scaleFactor: 1.75,
      servings: 3.5,
      components: [
        { itemId: 'rice', quantity: 350, unit: 'gram' },
        { itemId: 'egg', quantity: 3.5, unit: 'each' },
      ],
    })
  })

  it('shows component, serving, step and promoted-note differences between immutable versions', () => {
    const next = version({
      id: 'version-2',
      number: 2,
      servings: 4,
      yieldQuantity: 6,
      yieldUnit: 'bowl',
      components: [
        { id: 'component-rice-2', itemId: 'rice', quantity: 250, unit: 'gram', role: 'ingredient', position: 0 },
        { id: 'component-salt', itemId: 'salt', quantity: 2, unit: 'gram', role: 'seasoning', position: 1 },
      ],
      steps: [{ id: 'step-2', instruction: 'Cook slowly', ingredientItemIds: ['rice', 'salt'], durationSeconds: 900, imageMediaId: null, caution: '', position: 0 }],
      promotedNote: 'Use a lower heat.',
    })

    expect(diffRecipeVersions(version(), next)).toEqual({
      servings: { before: 2, after: 4 },
      yield: { before: { quantity: 2, unit: 'portion' }, after: { quantity: 6, unit: 'bowl' } },
      components: [
        { itemId: 'egg', change: 'removed', beforeQuantity: 2, afterQuantity: null, unit: 'each' },
        { itemId: 'rice', change: 'changed', beforeQuantity: 200, afterQuantity: 250, unit: 'gram' },
        { itemId: 'salt', change: 'added', beforeQuantity: null, afterQuantity: 2, unit: 'gram' },
      ],
      stepsChanged: true,
      promotedNoteChanged: true,
    })
  })

  it('lets future work follow the latest version while a pinned or historical reference stays fixed', () => {
    const first = version()
    const second = version({ id: 'version-2', number: 2, servings: 4 })

    expect(selectRecipeVersion([first, second], { mode: 'latest' }).id).toBe('version-2')
    expect(selectRecipeVersion([first, second], { mode: 'pinned', versionId: 'version-1' }).id).toBe('version-1')
  })
})

describe('recipe relations and cooking completion', () => {
  it('builds one bidirectional relation source reachable from ingredient and recipe views', () => {
    const relations = buildIngredientRecipeRelations([
      { id: 'recipe-1', name: 'Rice and egg', version: version() },
      { id: 'recipe-2', name: 'Rice bowl', version: version({ id: 'version-rice-bowl', recipeId: 'recipe-2', components: [{ id: 'component-rice-bowl', itemId: 'rice', quantity: 150, unit: 'gram', role: 'ingredient', position: 0 }] }) },
    ], 'rice')

    expect(relations).toEqual([
      { recipeId: 'recipe-1', recipeName: 'Rice and egg', recipeVersionId: 'version-1', itemId: 'rice', quantity: 200, unit: 'gram' },
      { recipeId: 'recipe-2', recipeName: 'Rice bowl', recipeVersionId: 'version-rice-bowl', itemId: 'rice', quantity: 150, unit: 'gram' },
    ])
  })

  it('keeps a cooking note session-only until an explicit promotion creates a new version', () => {
    const sessionOnly = resolveCookingNotePromotion({ version: version(), note: 'Use lower heat.', promote: false, nextVersionId: 'unused', createdAt: timestamp })
    const promoted = resolveCookingNotePromotion({ version: version(), note: 'Use lower heat.', promote: true, nextVersionId: 'version-2', createdAt: '2026-08-13T10:00:00.000Z' })

    expect(sessionOnly).toEqual({ sessionNote: 'Use lower heat.', promotedVersion: null })
    expect(promoted).toMatchObject({ sessionNote: 'Use lower heat.', promotedVersion: { id: 'version-2', number: 2, promotedNote: 'Use lower heat.' } })
  })

  it('records the full ingredient use once and leaves three prepared portions after four are made and one is eaten', () => {
    const calculation = calculateRecipe({
      version: version({ servings: 4, yieldQuantity: 4 }),
      items: [rice, egg],
      units: BUILT_IN_UNITS,
      asOf: '2026-08-13',
    })

    expect(resolveCookingCompletion({ calculation, madeServings: 4, eatenServings: 1 })).toEqual({
      madeServings: 4,
      eatenServings: 1,
      preparedServings: 3,
      ingredientConsumption: [
        { itemId: 'rice', quantity: 200, unit: 'gram' },
        { itemId: 'egg', quantity: 2, unit: 'each' },
      ],
      intakeNutrition: nutrition(100, 4.35, 2.65, 14.25),
      preparedNutrition: nutrition(300, 13.05, 7.95, 42.75),
      intakeCookingOilGrams: 0,
      preparedCookingOilGrams: 0,
    })
  })
})
