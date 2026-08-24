export type LifeItemKind =
  | 'ingredient'
  | 'supplement'
  | 'medicine'
  | 'household_consumable'
  | 'household_durable'

export type UnitDimension = 'mass' | 'volume' | 'count' | 'package' | 'time'
export type CatalogStatus = 'active' | 'disabled'
export type TaxonomyKind = 'category' | 'tag' | 'location'

export interface ItemUnitConversion {
  itemId: string
  fromUnit: string
  toUnit: string
  factor: number
}

export interface UnitConversionInput {
  quantity: number
  fromUnit: string
  toBaseUnit: string
  itemId?: string
  itemConversions?: ItemUnitConversion[]
  densityGramsPerMillilitre?: number
  units?: UnitDefinition[]
}

export interface UnitDefinition {
  code: string
  dimension: UnitDimension
  baseCode: string
  toBaseFactor: number | null
}

export type UnitConversionResult =
  | { status: 'complete'; baseQuantity: number }
  | { status: 'incomplete'; reason: 'missing_conversion' | 'cross_dimension' }

export interface PricePoint {
  id: string
  amountMinor: number
  currency: string
  purchaseQuantity: number
  purchaseUnit: string
  effectiveFrom: string
}

export type CreatePricePointInput = Omit<PricePoint, 'id'> & { id?: string }

export interface NutritionValues {
  energyKcal: number
  proteinGrams: number
  fatGrams: number
  carbohydrateGrams: number
  custom?: Record<string, number>
}

export interface NutritionProfile {
  basisQuantity: number
  basisUnit: string
  values: NutritionValues
}

export type NutritionCalculation =
  | { status: 'complete'; values: NutritionValues }
  | { status: 'incomplete'; missing: Array<'nutrition' | 'conversion'> }

export interface MedicineProfile {
  tradeName?: string
  genericName?: string
  specification?: string
  dosageForm?: string
  packageDescription?: string
  userInstructions?: string
  userScheduleText?: string
  asNeeded?: boolean
}

export interface SupplementReminderProfile {
  enabled: boolean
  localTimes: string[]
  note?: string
}

export interface SupplementProfile {
  kind: 'supplement'
  servingQuantity?: number
  servingUnit?: string
  ingredients?: string[]
  defaultFrequency?: string
  userInstructions?: string
  reminder?: SupplementReminderProfile
}

export interface HouseholdConsumableProfile {
  kind: 'household_consumable'
  defaultPurchaseQuantity?: number
  defaultPurchaseUnit?: string
  consumptionCycleDays?: number
  estimatedDepletionDate?: string | null
}

export interface HouseholdMaintenanceRecord {
  id: string
  performedOn: string
  summary: string
  costMinor?: number
  currency?: string
}

export interface HouseholdDurableProfile {
  kind: 'household_durable'
  valueMinor?: number
  currency?: string
  valueAsOfDate?: string | null
  lifecycleStatus?: 'active' | 'maintenance' | 'retired'
  acquiredOn?: string | null
  warrantyExpiresOn?: string | null
  maintenanceRecords?: HouseholdMaintenanceRecord[]
  retiredOn?: string | null
  retirementReason?: string | null
  setItemIds?: string[]
}

export type CatalogItemProfile = SupplementProfile | HouseholdConsumableProfile | HouseholdDurableProfile

export interface CatalogAttachment {
  mediaId: string
  caption: string
}

export interface CatalogItem {
  id: string
  kind: LifeItemKind
  name: string
  aliases: string[]
  status: CatalogStatus
  categoryId: string | null
  tagIds: string[]
  locationId: string | null
  baseUnit: string
  availableUnits: string[]
  itemConversions: ItemUnitConversion[]
  pricePoints: PricePoint[]
  nutrition?: NutritionProfile
  isCookingOil: boolean
  medicine?: MedicineProfile
  profile?: CatalogItemProfile
  attachments: CatalogAttachment[]
  notes: string
  customOrder: number
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface CreateCatalogItemInput {
  kind: LifeItemKind
  name: string
  aliases?: string[]
  status?: CatalogStatus
  categoryId?: string | null
  tagIds?: string[]
  locationId?: string | null
  baseUnit: string
  availableUnits?: string[]
  itemConversions?: ItemUnitConversion[]
  pricePoints?: CreatePricePointInput[]
  nutrition?: NutritionProfile
  isCookingOil?: boolean
  medicine?: MedicineProfile
  profile?: CatalogItemProfile
  attachments?: CatalogAttachment[]
  notes?: string
  customOrder?: number
}

export interface UpdateCatalogItemInput extends Partial<Omit<CreateCatalogItemInput, 'kind'>> {
  kind?: LifeItemKind
  version: number
}

export interface CatalogFilters {
  kind?: LifeItemKind
  q?: string
}

export interface CatalogBatchInput {
  items: Array<{ id: string; version: number }>
  patch: {
    categoryId?: string | null
    locationId?: string | null
    addTagIds?: string[]
    removeTagIds?: string[]
    status?: CatalogStatus
  }
}

export interface CatalogDeleteImpact {
  recipeIds: string[]
  templateIds: string[]
  futurePlanIds: string[]
}

export interface CatalogCategoryNode {
  id: string
  parentId: string | null
}

export interface TaxonomyEntity extends CatalogCategoryNode {
  kind: TaxonomyKind
  name: string
  status: CatalogStatus
  position: number
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface CreateTaxonomyInput {
  name: string
  parentId?: string | null
  status?: CatalogStatus
  position?: number
}

export interface UpdateTaxonomyInput extends Partial<CreateTaxonomyInput> {
  version: number
}

export interface LifeUnit {
  id: string
  code: string
  name: string
  symbol: string
  dimension: UnitDimension
  baseCode: string
  toBaseFactor: number | null
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  builtIn: boolean
}

export interface CreateUnitInput {
  code: string
  name: string
  symbol: string
  dimension: UnitDimension
  baseCode: string
  toBaseFactor?: number | null
}

export interface UpdateUnitInput extends Partial<CreateUnitInput> {
  version: number
}

export class LifeCatalogDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'LifeCatalogDomainError'
  }
}

const LIFE_ITEM_KINDS = new Set<LifeItemKind>([
  'ingredient',
  'supplement',
  'medicine',
  'household_consumable',
  'household_durable',
])
const CATALOG_STATUSES = new Set<CatalogStatus>(['active', 'disabled'])
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const PROFILE_KINDS = new Set<CatalogItemProfile['kind']>(['supplement', 'household_consumable', 'household_durable'])
const DURABLE_LIFECYCLE_STATUSES = new Set<NonNullable<HouseholdDurableProfile['lifecycleStatus']>>(['active', 'maintenance', 'retired'])
const FORBIDDEN_MEDICINE_FIELDS = new Set([
  'recommendation',
  'diagnosis',
  'dosageAdvice',
  'stopMedicationAdvice',
  'interactionAdvice',
])

const FIXED_UNITS: Record<string, { dimension: UnitDimension; toBase: number }> = {
  kilogram: { dimension: 'mass', toBase: 1_000 },
  kg: { dimension: 'mass', toBase: 1_000 },
  jin: { dimension: 'mass', toBase: 500 },
  gram: { dimension: 'mass', toBase: 1 },
  g: { dimension: 'mass', toBase: 1 },
  litre: { dimension: 'volume', toBase: 1_000 },
  liter: { dimension: 'volume', toBase: 1_000 },
  l: { dimension: 'volume', toBase: 1_000 },
  millilitre: { dimension: 'volume', toBase: 1 },
  milliliter: { dimension: 'volume', toBase: 1 },
  ml: { dimension: 'volume', toBase: 1 },
  each: { dimension: 'count', toBase: 1 },
  capsule: { dimension: 'count', toBase: 1 },
  tablet: { dimension: 'count', toBase: 1 },
  minute: { dimension: 'time', toBase: 1 },
  hour: { dimension: 'time', toBase: 60 },
}

function resolveUnit(code: string, units: UnitDefinition[] = [], visited = new Set<string>()): { dimension: UnitDimension; toBase: number } | undefined {
  const fixed = FIXED_UNITS[code]
  if (fixed) return fixed
  if (visited.has(code)) return undefined
  const custom = units.find((unit) => unit.code.trim().toLocaleLowerCase() === code)
  if (!custom || custom.toBaseFactor == null || !Number.isFinite(custom.toBaseFactor) || custom.toBaseFactor <= 0) return undefined
  const baseCode = custom.baseCode.trim().toLocaleLowerCase()
  if (baseCode === code) return { dimension: custom.dimension, toBase: custom.toBaseFactor }
  const nextVisited = new Set(visited).add(code)
  const base = resolveUnit(baseCode, units, nextVisited)
  if (!base || base.dimension !== custom.dimension) return undefined
  return { dimension: custom.dimension, toBase: custom.toBaseFactor * base.toBase }
}

export const BUILT_IN_UNITS: LifeUnit[] = [
  ['kilogram', 'Kilogram', 'kg', 'mass', 'gram', 1_000],
  ['jin', 'Jin', '斤', 'mass', 'gram', 500],
  ['gram', 'Gram', 'g', 'mass', 'gram', 1],
  ['litre', 'Litre', 'L', 'volume', 'millilitre', 1_000],
  ['millilitre', 'Millilitre', 'mL', 'volume', 'millilitre', 1],
  ['each', 'Each', '个', 'count', 'each', 1],
  ['capsule', 'Capsule', '粒', 'count', 'each', 1],
  ['tablet', 'Tablet', '片', 'count', 'each', 1],
  ['minute', 'Minute', 'min', 'time', 'minute', 1],
  ['hour', 'Hour', 'h', 'time', 'minute', 60],
].map(([code, name, symbol, dimension, baseCode, factor]) => ({
  id: `builtin:${code}`,
  code: String(code),
  name: String(name),
  symbol: String(symbol),
  dimension: dimension as UnitDimension,
  baseCode: String(baseCode),
  toBaseFactor: Number(factor),
  version: 1,
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
  deletedAt: null,
  builtIn: true,
}))

const cleanText = (value: string, field: string, allowEmpty = false) => {
  const result = value.trim()
  if (!allowEmpty && !result) throw new LifeCatalogDomainError('INVALID_INPUT', `${field} cannot be empty.`, 400)
  return result
}

const uniqueText = (values: string[] = []) => [...new Set(values.map((value) => value.trim()).filter(Boolean))]

const validDateOnly = (value: string) => DATE_ONLY.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value

const assertDateOnly = (value: string, field: string) => {
  if (!validDateOnly(value)) throw new LifeCatalogDomainError('INVALID_DATE', `${field} must be a valid date-only value.`, 400)
  return value
}

const assertAllowedKeys = (value: Record<string, unknown>, allowed: ReadonlySet<string>) => {
  if (Object.keys(value).some((field) => !allowed.has(field))) {
    throw new LifeCatalogDomainError('INVALID_PROFILE_FACT', 'Catalog profiles may contain approved user-authored facts only.', 400)
  }
}

const assertPair = (value: Record<string, unknown>, left: string, right: string) => {
  if ((value[left] !== undefined) !== (value[right] !== undefined)) {
    throw new LifeCatalogDomainError('INVALID_PROFILE_FACT', `${left} and ${right} must be provided together.`, 400)
  }
}

const currency = (value: string, field = 'currency') => {
  const normalized = cleanText(value, field).toUpperCase()
  if (!/^[A-Z]{3}$/.test(normalized)) throw new LifeCatalogDomainError('INVALID_INPUT', `${field} must be a three-letter currency code.`, 400)
  return normalized
}

function normalizeCatalogProfile(input: CatalogItemProfile | undefined, itemKind: LifeItemKind): CatalogItemProfile | undefined {
  if (input === undefined) return undefined
  const raw = input as unknown as Record<string, unknown>
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !PROFILE_KINDS.has(raw.kind as CatalogItemProfile['kind'])) {
    throw new LifeCatalogDomainError('INVALID_PROFILE_FACT', 'Catalog profile kind is invalid.', 400)
  }
  if (raw.kind !== itemKind) throw new LifeCatalogDomainError('INVALID_PROFILE_KIND', 'Catalog profile kind must match the item kind.', 400)

  if (raw.kind === 'supplement') {
    assertAllowedKeys(raw, new Set(['kind', 'servingQuantity', 'servingUnit', 'ingredients', 'defaultFrequency', 'userInstructions', 'reminder']))
    assertPair(raw, 'servingQuantity', 'servingUnit')
    if (raw.servingQuantity !== undefined) positive(raw.servingQuantity as number, 'servingQuantity')
    if (raw.ingredients !== undefined && (!Array.isArray(raw.ingredients) || raw.ingredients.some((item) => typeof item !== 'string'))) {
      throw new LifeCatalogDomainError('INVALID_PROFILE_FACT', 'ingredients must contain user-authored text facts.', 400)
    }
    let reminder: SupplementReminderProfile | undefined
    if (raw.reminder !== undefined) {
      const value = raw.reminder as unknown as Record<string, unknown>
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LifeCatalogDomainError('INVALID_PROFILE_FACT', 'reminder must be a factual configuration.', 400)
      assertAllowedKeys(value, new Set(['enabled', 'localTimes', 'note']))
      if (typeof value.enabled !== 'boolean' || !Array.isArray(value.localTimes) || value.localTimes.some((item) => typeof item !== 'string' || !LOCAL_TIME.test(item))) {
        throw new LifeCatalogDomainError('INVALID_PROFILE_FACT', 'Reminder local time values must use HH:mm.', 400)
      }
      reminder = {
        enabled: value.enabled,
        localTimes: uniqueText(value.localTimes as string[]),
        ...(value.note === undefined ? {} : { note: cleanText(value.note as string, 'reminder note', true) }),
      }
    }
    return {
      kind: 'supplement',
      ...(raw.servingQuantity === undefined ? {} : { servingQuantity: positive(raw.servingQuantity as number, 'servingQuantity') }),
      ...(raw.servingUnit === undefined ? {} : { servingUnit: cleanText(raw.servingUnit as string, 'servingUnit').toLocaleLowerCase() }),
      ...(raw.ingredients === undefined ? {} : { ingredients: uniqueText(raw.ingredients as string[]) }),
      ...(raw.defaultFrequency === undefined ? {} : { defaultFrequency: cleanText(raw.defaultFrequency as string, 'defaultFrequency', true) }),
      ...(raw.userInstructions === undefined ? {} : { userInstructions: cleanText(raw.userInstructions as string, 'userInstructions', true) }),
      ...(reminder ? { reminder } : {}),
    }
  }

  if (raw.kind === 'household_consumable') {
    assertAllowedKeys(raw, new Set(['kind', 'defaultPurchaseQuantity', 'defaultPurchaseUnit', 'consumptionCycleDays', 'estimatedDepletionDate']))
    assertPair(raw, 'defaultPurchaseQuantity', 'defaultPurchaseUnit')
    if (raw.consumptionCycleDays !== undefined && (!Number.isInteger(raw.consumptionCycleDays) || Number(raw.consumptionCycleDays) <= 0)) {
      throw new LifeCatalogDomainError('INVALID_PROFILE_FACT', 'consumptionCycleDays must be a positive integer.', 400)
    }
    return {
      kind: 'household_consumable',
      ...(raw.defaultPurchaseQuantity === undefined ? {} : { defaultPurchaseQuantity: positive(raw.defaultPurchaseQuantity as number, 'defaultPurchaseQuantity') }),
      ...(raw.defaultPurchaseUnit === undefined ? {} : { defaultPurchaseUnit: cleanText(raw.defaultPurchaseUnit as string, 'defaultPurchaseUnit').toLocaleLowerCase() }),
      ...(raw.consumptionCycleDays === undefined ? {} : { consumptionCycleDays: raw.consumptionCycleDays as number }),
      ...(raw.estimatedDepletionDate === undefined ? {} : {
        estimatedDepletionDate: raw.estimatedDepletionDate === null ? null : assertDateOnly(raw.estimatedDepletionDate as string, 'estimatedDepletionDate'),
      }),
    }
  }

  assertAllowedKeys(raw, new Set([
    'kind', 'valueMinor', 'currency', 'valueAsOfDate', 'lifecycleStatus', 'acquiredOn', 'warrantyExpiresOn',
    'maintenanceRecords', 'retiredOn', 'retirementReason', 'setItemIds',
  ]))
  assertPair(raw, 'valueMinor', 'currency')
  if (raw.valueAsOfDate !== undefined && raw.valueMinor === undefined) {
    throw new LifeCatalogDomainError('INVALID_PROFILE_FACT', 'valueAsOfDate requires valueMinor and currency facts.', 400)
  }
  if (raw.lifecycleStatus !== undefined && !DURABLE_LIFECYCLE_STATUSES.has(raw.lifecycleStatus as NonNullable<HouseholdDurableProfile['lifecycleStatus']>)) {
    throw new LifeCatalogDomainError('INVALID_PROFILE_FACT', 'lifecycleStatus is invalid.', 400)
  }
  if ((raw.retiredOn != null || raw.retirementReason != null) && raw.lifecycleStatus !== 'retired') {
    throw new LifeCatalogDomainError('INVALID_PROFILE_FACT', 'Retirement facts require a retired lifecycleStatus.', 400)
  }
  const maintenanceRecords = raw.maintenanceRecords === undefined ? undefined : (() => {
    if (!Array.isArray(raw.maintenanceRecords)) throw new LifeCatalogDomainError('INVALID_PROFILE_FACT', 'maintenanceRecords must be an array of facts.', 400)
    const ids = new Set<string>()
    return raw.maintenanceRecords.map((entry) => {
      const value = entry as Record<string, unknown>
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LifeCatalogDomainError('INVALID_PROFILE_FACT', 'maintenance record must be a factual object.', 400)
      assertAllowedKeys(value, new Set(['id', 'performedOn', 'summary', 'costMinor', 'currency']))
      assertPair(value, 'costMinor', 'currency')
      const id = cleanText(value.id as string, 'maintenance id')
      if (ids.has(id)) throw new LifeCatalogDomainError('INVALID_PROFILE_FACT', 'maintenance record IDs must be unique.', 400)
      ids.add(id)
      return {
        id,
        performedOn: assertDateOnly(value.performedOn as string, 'maintenance performedOn'),
        summary: cleanText(value.summary as string, 'maintenance summary'),
        ...(value.costMinor === undefined ? {} : { costMinor: finiteNonNegative(value.costMinor as number, 'maintenance costMinor') }),
        ...(value.currency === undefined ? {} : { currency: currency(value.currency as string, 'maintenance currency') }),
      }
    })
  })()
  const dateOrNull = (field: string) => raw[field] === null ? null : assertDateOnly(raw[field] as string, field)
  return {
    kind: 'household_durable',
    ...(raw.valueMinor === undefined ? {} : { valueMinor: finiteNonNegative(raw.valueMinor as number, 'valueMinor') }),
    ...(raw.currency === undefined ? {} : { currency: currency(raw.currency as string) }),
    ...(raw.valueAsOfDate === undefined ? {} : { valueAsOfDate: dateOrNull('valueAsOfDate') }),
    ...(raw.lifecycleStatus === undefined ? {} : { lifecycleStatus: raw.lifecycleStatus as HouseholdDurableProfile['lifecycleStatus'] }),
    ...(raw.acquiredOn === undefined ? {} : { acquiredOn: dateOrNull('acquiredOn') }),
    ...(raw.warrantyExpiresOn === undefined ? {} : { warrantyExpiresOn: dateOrNull('warrantyExpiresOn') }),
    ...(maintenanceRecords === undefined ? {} : { maintenanceRecords }),
    ...(raw.retiredOn === undefined ? {} : { retiredOn: dateOrNull('retiredOn') }),
    ...(raw.retirementReason === undefined ? {} : { retirementReason: raw.retirementReason === null ? null : cleanText(raw.retirementReason as string, 'retirementReason', true) }),
    ...(raw.setItemIds === undefined ? {} : (() => {
      if (!Array.isArray(raw.setItemIds) || raw.setItemIds.some((item) => typeof item !== 'string')) {
        throw new LifeCatalogDomainError('INVALID_PROFILE_FACT', 'setItemIds must contain item ID facts.', 400)
      }
      return { setItemIds: uniqueText(raw.setItemIds as string[]) }
    })()),
  }
}

const finiteNonNegative = (value: number, field: string) => {
  if (!Number.isFinite(value) || value < 0) throw new LifeCatalogDomainError('INVALID_INPUT', `${field} must be a finite non-negative number.`, 400)
  return value
}

const positive = (value: number, field: string) => {
  if (!Number.isFinite(value) || value <= 0) throw new LifeCatalogDomainError('INVALID_INPUT', `${field} must be greater than zero.`, 400)
  return value
}

const round = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000

export function assertCatalogVersion(actual: number, expected: number) {
  if (actual !== expected) {
    throw new LifeCatalogDomainError('VERSION_CONFLICT', 'The catalog entry changed; refresh before retrying.', 409)
  }
}

export function normalizeCatalogIdempotencyKey(value: string) {
  const result = value.trim()
  if (!result || result.length > 190) throw new LifeCatalogDomainError('INVALID_IDEMPOTENCY_KEY', 'A valid idempotency key is required.', 400)
  return result
}

export function convertUnit(input: UnitConversionInput): UnitConversionResult {
  finiteNonNegative(input.quantity, 'quantity')
  const fromUnit = cleanText(input.fromUnit, 'fromUnit').toLocaleLowerCase()
  const toUnit = cleanText(input.toBaseUnit, 'toBaseUnit').toLocaleLowerCase()
  if (fromUnit === toUnit) return { status: 'complete', baseQuantity: round(input.quantity) }

  const rule = input.itemConversions?.find((candidate) =>
    candidate.itemId === input.itemId
    && candidate.fromUnit.toLocaleLowerCase() === fromUnit
    && candidate.toUnit.toLocaleLowerCase() === toUnit)
  if (rule) return { status: 'complete', baseQuantity: round(input.quantity * positive(rule.factor, 'conversion factor')) }

  const from = resolveUnit(fromUnit, input.units)
  const to = resolveUnit(toUnit, input.units)
  if (!from || !to) return { status: 'incomplete', reason: 'missing_conversion' }
  if (from.dimension === to.dimension) {
    return { status: 'complete', baseQuantity: round(input.quantity * from.toBase / to.toBase) }
  }

  if ((from.dimension === 'mass' && to.dimension === 'volume') || (from.dimension === 'volume' && to.dimension === 'mass')) {
    if (input.densityGramsPerMillilitre == null) return { status: 'incomplete', reason: 'cross_dimension' }
    const density = positive(input.densityGramsPerMillilitre, 'densityGramsPerMillilitre')
    const baseQuantity = from.dimension === 'mass'
      ? input.quantity * from.toBase / density / to.toBase
      : input.quantity * from.toBase * density / to.toBase
    return { status: 'complete', baseQuantity: round(baseQuantity) }
  }

  return { status: 'incomplete', reason: 'cross_dimension' }
}

export function selectEffectivePrice(points: PricePoint[], asOf: string): PricePoint | undefined {
  const validDate = (value: string) => DATE_ONLY.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  if (!validDate(asOf)) {
    throw new LifeCatalogDomainError('INVALID_DATE', 'asOf must be a valid date-only value.', 400)
  }
  return [...points]
    .filter((point) => {
      positive(point.purchaseQuantity, 'purchaseQuantity')
      finiteNonNegative(point.amountMinor, 'amountMinor')
      if (!validDate(point.effectiveFrom)) throw new LifeCatalogDomainError('INVALID_DATE', 'effectiveFrom must be a date-only value.', 400)
      return point.effectiveFrom <= asOf
    })
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom) || right.id.localeCompare(left.id))[0]
}

export function calculateNutrition(input: {
  quantity: number
  unit: string
  baseUnit: string
  itemId: string
  profile?: NutritionProfile
  itemConversions?: ItemUnitConversion[]
}): NutritionCalculation {
  if (!input.profile) return { status: 'incomplete', missing: ['nutrition'] }
  positive(input.profile.basisQuantity, 'nutrition basis quantity')
  validateNutritionValues(input.profile.values)
  const converted = convertUnit({
    quantity: input.quantity,
    fromUnit: input.unit,
    toBaseUnit: input.profile.basisUnit,
    itemId: input.itemId,
    itemConversions: input.itemConversions,
  })
  if (converted.status === 'incomplete') return { status: 'incomplete', missing: ['conversion'] }
  const multiplier = converted.baseQuantity / input.profile.basisQuantity
  return {
    status: 'complete',
    values: {
      energyKcal: round(input.profile.values.energyKcal * multiplier),
      proteinGrams: round(input.profile.values.proteinGrams * multiplier),
      fatGrams: round(input.profile.values.fatGrams * multiplier),
      carbohydrateGrams: round(input.profile.values.carbohydrateGrams * multiplier),
      ...(input.profile.values.custom && Object.keys(input.profile.values.custom).length
        ? { custom: Object.fromEntries(Object.entries(input.profile.values.custom).map(([name, value]) => [name, round(value * multiplier)])) }
        : {}),
    },
  }
}

function validateNutritionValues(values: NutritionValues) {
  for (const [name, value] of Object.entries(values).filter(([name]) => name !== 'custom')) finiteNonNegative(value as number, name)
  for (const [name, value] of Object.entries(values.custom ?? {})) {
    cleanText(name, 'custom nutrition field')
    finiteNonNegative(value, name)
  }
}

export function assertCategoryMove(categories: CatalogCategoryNode[], categoryId: string, nextParentId: string | null): void {
  if (nextParentId == null) return
  if (!categories.some((category) => category.id === categoryId) || !categories.some((category) => category.id === nextParentId)) {
    throw new LifeCatalogDomainError('NOT_FOUND', 'The category or parent does not exist.', 404)
  }
  let cursor: string | null = nextParentId
  const visited = new Set<string>()
  while (cursor) {
    if (cursor === categoryId) throw new LifeCatalogDomainError('CATEGORY_CYCLE', 'A category cannot be moved below its descendant.', 409)
    if (visited.has(cursor)) throw new LifeCatalogDomainError('CATEGORY_CYCLE', 'The category tree already contains a cycle.', 409)
    visited.add(cursor)
    cursor = categories.find((category) => category.id === cursor)?.parentId ?? null
  }
}

export function validateCatalogItemInput(input: CreateCatalogItemInput) {
  if (!LIFE_ITEM_KINDS.has(input.kind)) throw new LifeCatalogDomainError('INVALID_INPUT', 'Unsupported catalog item kind.', 400)
  cleanText(input.name, 'name')
  cleanText(input.baseUnit, 'baseUnit')
  if (input.status && !CATALOG_STATUSES.has(input.status)) throw new LifeCatalogDomainError('INVALID_INPUT', 'Unsupported catalog status.', 400)
  finiteNonNegative(input.customOrder ?? 0, 'customOrder')
  for (const rule of input.itemConversions ?? []) positive(rule.factor, 'conversion factor')
  for (const point of input.pricePoints ?? []) {
    finiteNonNegative(point.amountMinor, 'amountMinor')
    positive(point.purchaseQuantity, 'purchaseQuantity')
    if (!DATE_ONLY.test(point.effectiveFrom)) throw new LifeCatalogDomainError('INVALID_DATE', 'effectiveFrom must be a date-only value.', 400)
  }
  if (input.nutrition) {
    positive(input.nutrition.basisQuantity, 'nutrition basis quantity')
    validateNutritionValues(input.nutrition.values)
  }
  if (input.isCookingOil && input.kind !== 'ingredient') throw new LifeCatalogDomainError('INVALID_INPUT', 'Only ingredients can be marked as cooking oil.', 400)
  const rawMedicine = input.medicine as Record<string, unknown> | undefined
  if (rawMedicine) {
    for (const field of Object.keys(rawMedicine)) {
      if (FORBIDDEN_MEDICINE_FIELDS.has(field)) {
        throw new LifeCatalogDomainError('MEDICINE_ADVICE_NOT_ALLOWED', 'Medicine data may contain user-authored facts and schedules only.', 400)
      }
    }
    if (input.kind !== 'medicine') throw new LifeCatalogDomainError('INVALID_INPUT', 'Medicine facts require a medicine item.', 400)
  }
  normalizeCatalogProfile(input.profile, input.kind)
}

export function createCatalogItemEntity(
  id: string,
  timestamp: string,
  input: CreateCatalogItemInput,
  createId: () => string,
): CatalogItem {
  validateCatalogItemInput(input)
  const baseUnit = cleanText(input.baseUnit, 'baseUnit').toLocaleLowerCase()
  const availableUnits = uniqueText([baseUnit, ...(input.availableUnits ?? [])])
  return {
    id,
    kind: input.kind,
    name: cleanText(input.name, 'name'),
    aliases: uniqueText(input.aliases),
    status: input.status ?? 'active',
    categoryId: input.categoryId ?? null,
    tagIds: uniqueText(input.tagIds),
    locationId: input.locationId ?? null,
    baseUnit,
    availableUnits,
    itemConversions: (input.itemConversions ?? []).map((rule) => ({
      itemId: id,
      fromUnit: cleanText(rule.fromUnit, 'fromUnit').toLocaleLowerCase(),
      toUnit: cleanText(rule.toUnit, 'toUnit').toLocaleLowerCase(),
      factor: rule.factor,
    })),
    pricePoints: (input.pricePoints ?? []).map((point) => ({
      ...point,
      id: point.id ?? createId(),
      currency: cleanText(point.currency, 'currency').toUpperCase(),
      purchaseUnit: cleanText(point.purchaseUnit, 'purchaseUnit').toLocaleLowerCase(),
    })),
    nutrition: input.nutrition ? structuredClone(input.nutrition) : undefined,
    isCookingOil: input.kind === 'ingredient' ? input.isCookingOil ?? false : false,
    medicine: input.medicine ? structuredClone(input.medicine) : undefined,
    profile: normalizeCatalogProfile(input.profile, input.kind),
    attachments: (input.attachments ?? []).map((attachment) => ({
      mediaId: cleanText(attachment.mediaId, 'mediaId'),
      caption: cleanText(attachment.caption, 'caption', true),
    })),
    notes: cleanText(input.notes ?? '', 'notes', true),
    customOrder: input.customOrder ?? 0,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }
}

export function updateCatalogItemEntity(
  current: CatalogItem,
  timestamp: string,
  input: UpdateCatalogItemInput,
  createId: () => string,
): CatalogItem {
  assertCatalogVersion(current.version, input.version)
  const nextKind = input.kind ?? current.kind
  const candidate: CreateCatalogItemInput = {
    kind: nextKind,
    name: input.name ?? current.name,
    aliases: input.aliases ?? current.aliases,
    status: input.status ?? current.status,
    categoryId: input.categoryId === undefined ? current.categoryId : input.categoryId,
    tagIds: input.tagIds ?? current.tagIds,
    locationId: input.locationId === undefined ? current.locationId : input.locationId,
    baseUnit: input.baseUnit ?? current.baseUnit,
    availableUnits: input.availableUnits ?? current.availableUnits,
    itemConversions: input.itemConversions ?? current.itemConversions,
    pricePoints: input.pricePoints ?? [],
    nutrition: input.nutrition === undefined ? current.nutrition : input.nutrition,
    isCookingOil: input.isCookingOil ?? current.isCookingOil,
    medicine: input.medicine === undefined ? current.medicine : input.medicine,
    profile: input.profile === undefined
      ? (current.profile?.kind === nextKind ? current.profile : undefined)
      : input.profile,
    attachments: input.attachments ?? current.attachments,
    notes: input.notes ?? current.notes,
    customOrder: input.customOrder ?? current.customOrder,
  }
  const replacement = createCatalogItemEntity(current.id, current.createdAt, candidate, createId)
  return {
    ...replacement,
    pricePoints: [...current.pricePoints, ...replacement.pricePoints],
    version: current.version + 1,
    createdAt: current.createdAt,
    updatedAt: timestamp,
    deletedAt: current.deletedAt,
  }
}

export function createTaxonomyEntity(id: string, timestamp: string, kind: TaxonomyKind, input: CreateTaxonomyInput): TaxonomyEntity {
  if (kind === 'tag' && input.parentId != null) throw new LifeCatalogDomainError('INVALID_INPUT', 'Tags do not have parents.', 400)
  if (input.status && !CATALOG_STATUSES.has(input.status)) throw new LifeCatalogDomainError('INVALID_INPUT', 'Unsupported taxonomy status.', 400)
  return {
    id,
    kind,
    name: cleanText(input.name, 'name'),
    parentId: kind === 'tag' ? null : input.parentId ?? null,
    status: input.status ?? 'active',
    position: finiteNonNegative(input.position ?? 0, 'position'),
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }
}

export function updateTaxonomyEntity(current: TaxonomyEntity, timestamp: string, input: UpdateTaxonomyInput): TaxonomyEntity {
  assertCatalogVersion(current.version, input.version)
  if (current.kind === 'tag' && input.parentId != null) throw new LifeCatalogDomainError('INVALID_INPUT', 'Tags do not have parents.', 400)
  if (input.status && !CATALOG_STATUSES.has(input.status)) throw new LifeCatalogDomainError('INVALID_INPUT', 'Unsupported taxonomy status.', 400)
  return {
    ...current,
    name: input.name === undefined ? current.name : cleanText(input.name, 'name'),
    parentId: current.kind === 'tag' || input.parentId === undefined ? current.parentId : input.parentId,
    status: input.status ?? current.status,
    position: input.position === undefined ? current.position : finiteNonNegative(input.position, 'position'),
    version: current.version + 1,
    updatedAt: timestamp,
  }
}

export function createUnitEntity(id: string, timestamp: string, input: CreateUnitInput): LifeUnit {
  const factor = input.toBaseFactor == null ? null : positive(input.toBaseFactor, 'toBaseFactor')
  return {
    id,
    code: cleanText(input.code, 'code').toLocaleLowerCase(),
    name: cleanText(input.name, 'name'),
    symbol: cleanText(input.symbol, 'symbol'),
    dimension: input.dimension,
    baseCode: cleanText(input.baseCode, 'baseCode').toLocaleLowerCase(),
    toBaseFactor: factor,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    builtIn: false,
  }
}

export function updateUnitEntity(current: LifeUnit, timestamp: string, input: UpdateUnitInput): LifeUnit {
  if (current.builtIn) throw new LifeCatalogDomainError('BUILT_IN_UNIT_IMMUTABLE', 'Built-in units cannot be changed.', 409)
  assertCatalogVersion(current.version, input.version)
  const candidate = createUnitEntity(current.id, current.createdAt, {
    code: input.code ?? current.code,
    name: input.name ?? current.name,
    symbol: input.symbol ?? current.symbol,
    dimension: input.dimension ?? current.dimension,
    baseCode: input.baseCode ?? current.baseCode,
    toBaseFactor: input.toBaseFactor === undefined ? current.toBaseFactor : input.toBaseFactor,
  })
  return { ...candidate, version: current.version + 1, updatedAt: timestamp, deletedAt: current.deletedAt }
}
