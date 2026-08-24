export type LifeItemKind = 'ingredient' | 'supplement' | 'medicine' | 'household_consumable' | 'household_durable'
export type UnitDimension = 'mass' | 'volume' | 'count' | 'package' | 'time'
export type CatalogStatus = 'active' | 'disabled'
export type TaxonomyKind = 'category' | 'tag' | 'location'

export interface ItemUnitConversion { itemId: string; fromUnit: string; toUnit: string; factor: number }
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

export interface NutritionValues { energyKcal: number; proteinGrams: number; fatGrams: number; carbohydrateGrams: number; custom?: Record<string, number> }
export interface NutritionProfile { basisQuantity: number; basisUnit: string; values: NutritionValues }
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

export interface SupplementReminderProfile { enabled: boolean; localTimes: string[]; note?: string }
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
  attachments: Array<{ mediaId: string; caption: string }>
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
  pricePoints?: Array<Omit<PricePoint, 'id'> & { id?: string }>
  nutrition?: NutritionProfile
  isCookingOil?: boolean
  medicine?: MedicineProfile
  profile?: CatalogItemProfile
  attachments?: Array<{ mediaId: string; caption: string }>
  notes?: string
  customOrder?: number
}

export interface UpdateCatalogItemInput extends Partial<CreateCatalogItemInput> { version: number }
export interface CatalogFilters { kind?: LifeItemKind; q?: string }
export interface CatalogBatchInput {
  items: Array<{ id: string; version: number }>
  patch: { categoryId?: string | null; locationId?: string | null; addTagIds?: string[]; removeTagIds?: string[]; status?: CatalogStatus }
}
export interface CatalogDeleteImpact { recipeIds: string[]; templateIds: string[]; futurePlanIds: string[] }

export interface TaxonomyEntity {
  id: string
  kind: TaxonomyKind
  name: string
  parentId: string | null
  status: CatalogStatus
  position: number
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
export interface CreateTaxonomyInput { name: string; parentId?: string | null; status?: CatalogStatus; position?: number }
export interface UpdateTaxonomyInput extends Partial<CreateTaxonomyInput> { version: number }

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
export interface CreateUnitInput { code: string; name: string; symbol: string; dimension: UnitDimension; baseCode: string; toBaseFactor?: number | null }
export interface UpdateUnitInput extends Partial<CreateUnitInput> { version: number }
