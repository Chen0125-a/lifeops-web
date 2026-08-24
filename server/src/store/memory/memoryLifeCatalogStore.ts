import { createHash, randomUUID } from 'node:crypto'
import {
  BUILT_IN_UNITS,
  LifeCatalogDomainError,
  assertCatalogVersion,
  assertCategoryMove,
  createCatalogItemEntity,
  createTaxonomyEntity,
  createUnitEntity,
  normalizeCatalogIdempotencyKey,
  updateCatalogItemEntity,
  updateTaxonomyEntity,
  updateUnitEntity,
  type CatalogBatchInput,
  type CatalogDeleteImpact,
  type CatalogFilters,
  type CatalogItem,
  type CreateCatalogItemInput,
  type CreateTaxonomyInput,
  type CreateUnitInput,
  type LifeUnit,
  type TaxonomyEntity,
  type TaxonomyKind,
  type UpdateCatalogItemInput,
  type UpdateTaxonomyInput,
  type UpdateUnitInput,
} from '../../domain/life/catalog.js'
import type { LifeCatalogStore } from '../lifeCatalogStore.js'
import type { MemoryOwnerTransactionParticipant } from './memoryOwnerTransactionCoordinator.js'

interface Owned<T> { userId: string; value: T }
interface CatalogOwnerTransactionState {
  taxonomy: Array<Owned<TaxonomyEntity>>
  units: Array<Owned<LifeUnit>>
  items: Array<Owned<CatalogItem>>
  idempotency: Array<[string, { hash: string; promise: Promise<CatalogItem> }]>
}

const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, item]) => `${JSON.stringify(name)}:${stable(item)}`).join(',')}}`
    : JSON.stringify(value)

const requestHash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex').toUpperCase()

export class MemoryLifeCatalogStore implements LifeCatalogStore, MemoryOwnerTransactionParticipant<CatalogOwnerTransactionState> {
  private readonly createId: () => string
  private readonly now: () => string
  private readonly taxonomy: Array<Owned<TaxonomyEntity>> = []
  private readonly units: Array<Owned<LifeUnit>> = []
  private readonly items: Array<Owned<CatalogItem>> = []
  private readonly idempotency = new Map<string, { hash: string; promise: Promise<CatalogItem> }>()

  constructor(private readonly options: {
    createId?: () => string
    now?: () => string
    validateMedia?: (userId: string, mediaIds: string[]) => Promise<void> | void
    deleteImpact?: (userId: string, itemId: string) => Promise<CatalogDeleteImpact> | CatalogDeleteImpact
  } = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date().toISOString())
  }

  captureOwnerTransactionState(userId: string): CatalogOwnerTransactionState {
    const prefix = `${userId}\0`
    return {
      taxonomy: structuredClone(this.taxonomy.filter((entry) => entry.userId === userId)),
      units: structuredClone(this.units.filter((entry) => entry.userId === userId)),
      items: structuredClone(this.items.filter((entry) => entry.userId === userId)),
      idempotency: [...this.idempotency.entries()].filter(([key]) => key.startsWith(prefix)),
    }
  }

  restoreOwnerTransactionState(userId: string, state: CatalogOwnerTransactionState) {
    this.taxonomy.splice(0, this.taxonomy.length,
      ...this.taxonomy.filter((entry) => entry.userId !== userId),
      ...structuredClone(state.taxonomy))
    this.units.splice(0, this.units.length,
      ...this.units.filter((entry) => entry.userId !== userId),
      ...structuredClone(state.units))
    this.items.splice(0, this.items.length,
      ...this.items.filter((entry) => entry.userId !== userId),
      ...structuredClone(state.items))
    const prefix = `${userId}\0`
    for (const key of [...this.idempotency.keys()]) if (key.startsWith(prefix)) this.idempotency.delete(key)
    for (const [key, value] of state.idempotency) this.idempotency.set(key, value)
  }

  exportOwnerPortableData(userId: string) {
    return {
      catalogTaxonomy: structuredClone(this.taxonomy.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
      lifeUnits: structuredClone(this.units.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
      catalogItems: structuredClone(this.items.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
    }
  }

  replaceOwnerPortableData(userId: string, payload: Record<string, unknown>) {
    const values = <T>(key: string) => structuredClone((Array.isArray(payload[key]) ? payload[key] : []) as T[])
    this.taxonomy.splice(0, this.taxonomy.length,
      ...this.taxonomy.filter((entry) => entry.userId !== userId),
      ...values<TaxonomyEntity>('catalogTaxonomy').map((value) => ({ userId, value })))
    this.units.splice(0, this.units.length,
      ...this.units.filter((entry) => entry.userId !== userId),
      ...values<LifeUnit>('lifeUnits').map((value) => ({ userId, value })))
    this.items.splice(0, this.items.length,
      ...this.items.filter((entry) => entry.userId !== userId),
      ...values<CatalogItem>('catalogItems').map((value) => ({ userId, value })))
  }

  mergeOwnerPortableCatalogItems(userId: string, imported: CatalogItem[]) {
    for (const value of structuredClone(imported)) {
      const index = this.items.findIndex((entry) => entry.userId === userId && entry.value.id === value.id)
      if (index >= 0) this.items[index] = { userId, value }
      else this.items.push({ userId, value })
    }
  }

  async listCatalogItems(userId: string, filters: CatalogFilters = {}) {
    const query = filters.q?.trim().toLocaleLowerCase()
    return this.items
      .filter((entry) => entry.userId === userId && entry.value.deletedAt == null)
      .filter((entry) => !filters.kind || entry.value.kind === filters.kind)
      .filter((entry) => !query || `${entry.value.name}\n${entry.value.aliases.join('\n')}`.toLocaleLowerCase().includes(query))
      .map((entry) => structuredClone(entry.value))
      .sort((left, right) => left.customOrder - right.customOrder || left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
  }

  async getCatalogItem(userId: string, id: string) {
    const value = this.items.find((entry) => entry.userId === userId && entry.value.id === id && entry.value.deletedAt == null)?.value
    return value ? structuredClone(value) : undefined
  }

  async createCatalogItem(userId: string, input: CreateCatalogItemInput, rawKey: string) {
    const key = normalizeCatalogIdempotencyKey(rawKey)
    const mapKey = `${userId}\u0000catalog:create\u0000${key}`
    const hash = requestHash(input)
    const existing = this.idempotency.get(mapKey)
    if (existing) {
      if (existing.hash !== hash) throw new LifeCatalogDomainError('IDEMPOTENCY_CONFLICT', 'The idempotency key belongs to a different catalog request.', 409)
      return structuredClone(await existing.promise)
    }
    const promise = Promise.resolve().then(async () => {
      await this.validateItemReferences(userId, input)
      const item = createCatalogItemEntity(this.createId(), this.now(), input, this.createId)
      this.items.push({ userId, value: item })
      return item
    })
    this.idempotency.set(mapKey, { hash, promise })
    try { return structuredClone(await promise) } catch (error) { this.idempotency.delete(mapKey); throw error }
  }

  async updateCatalogItem(userId: string, id: string, input: UpdateCatalogItemInput) {
    const owned = this.items.find((entry) => entry.userId === userId && entry.value.id === id && entry.value.deletedAt == null)
    if (!owned) return undefined
    const candidate = updateCatalogItemEntity(owned.value, this.now(), input, this.createId)
    await this.validateItemReferences(userId, candidate)
    owned.value = candidate
    return structuredClone(candidate)
  }

  async batchUpdateCatalogItems(userId: string, input: CatalogBatchInput) {
    if (!input.items.length) throw new LifeCatalogDomainError('INVALID_INPUT', 'A batch must contain at least one catalog item.', 400)
    const ids = input.items.map((entry) => entry.id)
    if (new Set(ids).size !== ids.length) throw new LifeCatalogDomainError('INVALID_INPUT', 'A catalog item may appear only once in a batch.', 400)
    const owned = input.items.map((expected) => {
      const entry = this.items.find((candidate) => candidate.userId === userId && candidate.value.id === expected.id && candidate.value.deletedAt == null)
      if (!entry) throw new LifeCatalogDomainError('NOT_FOUND', 'A catalog item in the batch does not exist.', 404)
      assertCatalogVersion(entry.value.version, expected.version)
      return entry
    })
    await this.validateTaxonomyReferences(userId, input.patch.categoryId, input.patch.addTagIds, input.patch.locationId)
    if (input.patch.status && !['active', 'disabled'].includes(input.patch.status)) {
      throw new LifeCatalogDomainError('INVALID_INPUT', 'Unsupported catalog status.', 400)
    }
    const remove = new Set(input.patch.removeTagIds ?? [])
    const add = input.patch.addTagIds ?? []
    const timestamp = this.now()
    const replacements = owned.map((entry) => ({
      ...entry.value,
      categoryId: input.patch.categoryId === undefined ? entry.value.categoryId : input.patch.categoryId,
      locationId: input.patch.locationId === undefined ? entry.value.locationId : input.patch.locationId,
      tagIds: [...new Set([...entry.value.tagIds.filter((tagId) => !remove.has(tagId)), ...add])],
      status: input.patch.status ?? entry.value.status,
      version: entry.value.version + 1,
      updatedAt: timestamp,
    }))
    replacements.forEach((replacement, index) => { owned[index]!.value = replacement })
    return structuredClone(replacements)
  }

  async previewCatalogItemDelete(userId: string, id: string) {
    const exists = this.items.some((entry) => entry.userId === userId && entry.value.id === id && entry.value.deletedAt == null)
    if (!exists) return undefined
    return structuredClone(await (this.options.deleteImpact?.(userId, id) ?? { recipeIds: [], templateIds: [], futurePlanIds: [] }))
  }

  async deleteCatalogItem(userId: string, id: string, version: number) {
    const owned = this.items.find((entry) => entry.userId === userId && entry.value.id === id && entry.value.deletedAt == null)
    if (!owned) return false
    assertCatalogVersion(owned.value.version, version)
    const timestamp = this.now()
    owned.value = { ...owned.value, version: version + 1, updatedAt: timestamp, deletedAt: timestamp }
    return true
  }

  async listDeletedCatalogItems(userId: string) {
    return this.items
      .filter((entry) => entry.userId === userId && entry.value.deletedAt != null)
      .map((entry) => structuredClone(entry.value))
      .sort((left, right) => (right.deletedAt ?? '').localeCompare(left.deletedAt ?? '') || left.id.localeCompare(right.id))
  }

  async restoreCatalogItem(userId: string, id: string, version: number) {
    const owned = this.items.find((entry) => entry.userId === userId && entry.value.id === id && entry.value.deletedAt != null)
    if (!owned) return undefined
    assertCatalogVersion(owned.value.version, version)
    await this.validateItemReferences(userId, owned.value)
    const timestamp = this.now()
    owned.value = { ...owned.value, version: version + 1, updatedAt: timestamp, deletedAt: null }
    return structuredClone(owned.value)
  }

  async listTaxonomy(userId: string, kind: TaxonomyKind, includeDeleted = false) {
    return this.taxonomy
      .filter((entry) => entry.userId === userId && entry.value.kind === kind && (includeDeleted || entry.value.deletedAt == null))
      .map((entry) => structuredClone(entry.value))
      .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
  }

  async createTaxonomy(userId: string, kind: TaxonomyKind, input: CreateTaxonomyInput) {
    this.assertTaxonomyNameAvailable(userId, kind, input.name)
    await this.validateParent(userId, kind, input.parentId ?? null)
    const value = createTaxonomyEntity(this.createId(), this.now(), kind, input)
    this.taxonomy.push({ userId, value })
    return structuredClone(value)
  }

  async updateTaxonomy(userId: string, kind: TaxonomyKind, id: string, input: UpdateTaxonomyInput) {
    const owned = this.taxonomy.find((entry) => entry.userId === userId && entry.value.kind === kind && entry.value.id === id && entry.value.deletedAt == null)
    if (!owned) return undefined
    if (input.name !== undefined) this.assertTaxonomyNameAvailable(userId, kind, input.name, id)
    if (input.parentId !== undefined) {
      await this.validateParent(userId, kind, input.parentId)
      if (kind !== 'tag') {
        const nodes = this.taxonomy.filter((entry) => entry.userId === userId && entry.value.kind === kind && entry.value.deletedAt == null).map((entry) => entry.value)
        assertCategoryMove(nodes, id, input.parentId)
      }
    }
    owned.value = updateTaxonomyEntity(owned.value, this.now(), input)
    return structuredClone(owned.value)
  }

  async deleteTaxonomy(userId: string, kind: TaxonomyKind, id: string, version: number) {
    const owned = this.taxonomy.find((entry) => entry.userId === userId && entry.value.kind === kind && entry.value.id === id && entry.value.deletedAt == null)
    if (!owned) return false
    assertCatalogVersion(owned.value.version, version)
    const hasChild = kind !== 'tag' && this.taxonomy.some((entry) => entry.userId === userId && entry.value.kind === kind && entry.value.parentId === id && entry.value.deletedAt == null)
    const isUsed = this.items.some((entry) => entry.userId === userId && entry.value.deletedAt == null && (
      (kind === 'category' && entry.value.categoryId === id)
      || (kind === 'location' && entry.value.locationId === id)
      || (kind === 'tag' && entry.value.tagIds.includes(id))))
    if (hasChild || isUsed) throw new LifeCatalogDomainError('TAXONOMY_IN_USE', 'The taxonomy value is still referenced.', 409)
    const timestamp = this.now()
    owned.value = { ...owned.value, version: version + 1, updatedAt: timestamp, deletedAt: timestamp }
    return true
  }

  async restoreTaxonomy(userId: string, kind: TaxonomyKind, id: string, version: number) {
    const owned = this.taxonomy.find((entry) => entry.userId === userId && entry.value.kind === kind && entry.value.id === id && entry.value.deletedAt != null)
    if (!owned) return undefined
    assertCatalogVersion(owned.value.version, version)
    this.assertTaxonomyNameAvailable(userId, kind, owned.value.name, id)
    await this.validateParent(userId, kind, owned.value.parentId)
    const timestamp = this.now()
    owned.value = { ...owned.value, version: version + 1, updatedAt: timestamp, deletedAt: null }
    return structuredClone(owned.value)
  }

  async listUnits(userId: string, includeDeleted = false) {
    const custom = this.units
      .filter((entry) => entry.userId === userId && (includeDeleted || entry.value.deletedAt == null))
      .map((entry) => structuredClone(entry.value))
    return [...structuredClone(BUILT_IN_UNITS), ...custom].sort((left, right) => left.dimension.localeCompare(right.dimension) || left.code.localeCompare(right.code))
  }

  async createUnit(userId: string, input: CreateUnitInput) {
    this.assertUnitCodeAvailable(userId, input.code)
    const value = createUnitEntity(this.createId(), this.now(), input)
    this.units.push({ userId, value })
    return structuredClone(value)
  }

  async updateUnit(userId: string, id: string, input: UpdateUnitInput) {
    const owned = this.units.find((entry) => entry.userId === userId && entry.value.id === id && entry.value.deletedAt == null)
    if (!owned) return undefined
    if (input.code !== undefined) this.assertUnitCodeAvailable(userId, input.code, id)
    owned.value = updateUnitEntity(owned.value, this.now(), input)
    return structuredClone(owned.value)
  }

  async deleteUnit(userId: string, id: string, version: number) {
    const owned = this.units.find((entry) => entry.userId === userId && entry.value.id === id && entry.value.deletedAt == null)
    if (!owned) return false
    assertCatalogVersion(owned.value.version, version)
    const inUse = this.items.some((entry) => entry.userId === userId && entry.value.deletedAt == null && (
      entry.value.baseUnit === owned.value.code
      || entry.value.availableUnits.includes(owned.value.code)
      || entry.value.itemConversions.some((rule) => rule.fromUnit === owned.value.code || rule.toUnit === owned.value.code)))
    if (inUse) throw new LifeCatalogDomainError('UNIT_IN_USE', 'The unit is still referenced.', 409)
    const timestamp = this.now()
    owned.value = { ...owned.value, version: version + 1, updatedAt: timestamp, deletedAt: timestamp }
    return true
  }

  async restoreUnit(userId: string, id: string, version: number) {
    const owned = this.units.find((entry) => entry.userId === userId && entry.value.id === id && entry.value.deletedAt != null)
    if (!owned) return undefined
    assertCatalogVersion(owned.value.version, version)
    this.assertUnitCodeAvailable(userId, owned.value.code, id)
    const timestamp = this.now()
    owned.value = { ...owned.value, version: version + 1, updatedAt: timestamp, deletedAt: null }
    return structuredClone(owned.value)
  }

  private async validateItemReferences(userId: string, input: Pick<CreateCatalogItemInput, 'categoryId' | 'tagIds' | 'locationId' | 'attachments'>) {
    await this.validateTaxonomyReferences(userId, input.categoryId, input.tagIds, input.locationId)
    await this.options.validateMedia?.(userId, (input.attachments ?? []).map((attachment) => attachment.mediaId))
  }

  private async validateTaxonomyReferences(userId: string, categoryId?: string | null, tagIds?: string[], locationId?: string | null) {
    if (categoryId != null && !this.activeTaxonomy(userId, 'category', categoryId)) throw new LifeCatalogDomainError('NOT_FOUND', 'The category does not exist.', 404)
    if (locationId != null && !this.activeTaxonomy(userId, 'location', locationId)) throw new LifeCatalogDomainError('NOT_FOUND', 'The location does not exist.', 404)
    for (const tagId of tagIds ?? []) {
      if (!this.activeTaxonomy(userId, 'tag', tagId)) throw new LifeCatalogDomainError('NOT_FOUND', 'A tag does not exist.', 404)
    }
  }

  private activeTaxonomy(userId: string, kind: TaxonomyKind, id: string) {
    return this.taxonomy.find((entry) => entry.userId === userId && entry.value.kind === kind && entry.value.id === id && entry.value.deletedAt == null && entry.value.status === 'active')?.value
  }

  private async validateParent(userId: string, kind: TaxonomyKind, parentId: string | null) {
    if (kind === 'tag' && parentId != null) throw new LifeCatalogDomainError('INVALID_INPUT', 'Tags do not have parents.', 400)
    if (parentId != null && !this.activeTaxonomy(userId, kind, parentId)) throw new LifeCatalogDomainError('NOT_FOUND', 'The taxonomy parent does not exist.', 404)
  }

  private assertTaxonomyNameAvailable(userId: string, kind: TaxonomyKind, rawName: string, exceptId?: string) {
    const name = rawName.trim().toLocaleLowerCase()
    if (this.taxonomy.some((entry) => entry.userId === userId && entry.value.kind === kind && entry.value.id !== exceptId && entry.value.name.toLocaleLowerCase() === name)) {
      throw new LifeCatalogDomainError('NAME_CONFLICT', 'That taxonomy name is already in use.', 409)
    }
  }

  private assertUnitCodeAvailable(userId: string, rawCode: string, exceptId?: string) {
    const code = rawCode.trim().toLocaleLowerCase()
    if (BUILT_IN_UNITS.some((unit) => unit.code === code)
      || this.units.some((entry) => entry.userId === userId && entry.value.id !== exceptId && entry.value.code === code)) {
      throw new LifeCatalogDomainError('UNIT_CODE_CONFLICT', 'That unit code is already in use.', 409)
    }
  }
}
