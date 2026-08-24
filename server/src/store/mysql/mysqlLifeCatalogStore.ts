import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
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
  type CatalogAttachment,
  type CatalogBatchInput,
  type CatalogDeleteImpact,
  type CatalogFilters,
  type CatalogItem,
  type CreateCatalogItemInput,
  type CreateTaxonomyInput,
  type CreateUnitInput,
  type ItemUnitConversion,
  type LifeUnit,
  type MedicineProfile,
  type NutritionProfile,
  type PricePoint,
  type TaxonomyEntity,
  type TaxonomyKind,
  type UpdateCatalogItemInput,
  type UpdateTaxonomyInput,
  type UpdateUnitInput,
} from '../../domain/life/catalog.js'
import type { LifeCatalogStore } from '../lifeCatalogStore.js'

type Executor = Pool | PoolConnection
type SqlRow = RowDataPacket & Record<string, unknown>

const TAXONOMY_TABLES: Record<TaxonomyKind, string> = {
  category: 'life_categories',
  tag: 'life_tags',
  location: 'life_locations',
}

const toSqlDateTime = (value: string) => new Date(value).toISOString().slice(0, 23).replace('T', ' ')
const iso = (value: unknown) => {
  if (value instanceof Date) return value.toISOString()
  const result = String(value)
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(result) ? `${result.replace(' ', 'T')}Z` : result
}
const optionalIso = (value: unknown) => value == null ? null : iso(value)
const parseJson = <T>(value: unknown, fallback: T): T => {
  if (value && typeof value === 'object') return value as T
  if (typeof value !== 'string') return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, item]) => `${JSON.stringify(name)}:${stable(item)}`).join(',')}}`
    : JSON.stringify(value)
const requestHash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex').toUpperCase()

async function queryRows<T>(executor: Executor, sql: string, values: unknown[] = []): Promise<T[]> {
  const [rows] = await executor.execute(sql, values as never[])
  return rows as unknown as T[]
}

export class MySqlLifeCatalogStore implements LifeCatalogStore {
  constructor(
    private readonly pool: Pool,
    private readonly options: { createId?: () => string; now?: () => string } = {},
  ) {}

  private createId = () => this.options.createId?.() ?? randomUUID()
  private now = () => this.options.now?.() ?? new Date().toISOString()

  async listCatalogItems(userId: string, filters: CatalogFilters = {}) {
    return this.listCatalogItemsFrom(this.pool, userId, filters)
  }

  async listCatalogItemsFrom(executor: Executor, userId: string, filters: CatalogFilters = {}) {
    const rows = await queryRows<SqlRow>(executor, `SELECT * FROM life_items
      WHERE user_id = ? AND deleted_at IS NULL ${filters.kind ? 'AND item_kind = ?' : ''}
      ORDER BY custom_order, name, id`, filters.kind ? [userId, filters.kind] : [userId])
    let items = await this.hydrateItems(executor, userId, rows)
    const query = filters.q?.trim().toLocaleLowerCase()
    if (query) items = items.filter((item) => `${item.name}\n${item.aliases.join('\n')}`.toLocaleLowerCase().includes(query))
    return items
  }

  async getCatalogItem(userId: string, id: string) {
    return this.getCatalogItemFrom(this.pool, userId, id)
  }

  async getCatalogItemFrom(executor: Executor, userId: string, id: string) {
    const rows = await queryRows<SqlRow>(executor, `SELECT * FROM life_items
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`, [id, userId])
    return rows[0] ? (await this.hydrateItems(executor, userId, rows))[0] : undefined
  }

  async restoreCatalogItemsFrom(connection: PoolConnection, userId: string, imported: CatalogItem[]) {
    for (const item of imported) {
      const existing = await queryRows<SqlRow>(connection,
        'SELECT id FROM life_items WHERE user_id=? AND id=? LIMIT 1', [userId, item.id])
      if (existing[0]) {
        await connection.execute(`UPDATE life_items SET item_kind=?,name=?,aliases=?,status=?,category_id=?,location_id=?,
          base_unit=?,available_units=?,notes=?,custom_order=?,version=?,created_at=?,updated_at=?,deleted_at=?
          WHERE user_id=? AND id=?`, [
          item.kind,item.name,JSON.stringify(item.aliases),item.status,item.categoryId,item.locationId,item.baseUnit,
          JSON.stringify(item.availableUnits),item.notes,item.customOrder,item.version,toSqlDateTime(item.createdAt),
          toSqlDateTime(item.updatedAt),item.deletedAt==null?null:toSqlDateTime(item.deletedAt),userId,item.id,
        ])
      } else {
        await connection.execute(`INSERT INTO life_items
          (id,user_id,item_kind,name,aliases,status,category_id,location_id,base_unit,available_units,notes,custom_order,
           version,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
          item.id,userId,item.kind,item.name,JSON.stringify(item.aliases),item.status,item.categoryId,item.locationId,
          item.baseUnit,JSON.stringify(item.availableUnits),item.notes,item.customOrder,item.version,
          toSqlDateTime(item.createdAt),toSqlDateTime(item.updatedAt),item.deletedAt==null?null:toSqlDateTime(item.deletedAt),
        ])
      }
      await this.replaceItemRelations(connection, userId, item)
      await connection.execute('DELETE FROM life_price_history WHERE user_id=? AND item_id=?',[userId,item.id])
      for (const point of item.pricePoints) await this.insertPrice(connection,userId,item.id,point,item.createdAt)
    }
  }

  async exportOwnerPortableDataFrom(executor: Executor, userId: string) {
    const itemRows = await queryRows<SqlRow>(executor, 'SELECT * FROM life_items WHERE user_id=? ORDER BY created_at,id', [userId])
    const taxonomy: TaxonomyEntity[] = []
    for (const kind of ['category', 'tag', 'location'] as const) {
      const found = await queryRows<SqlRow>(executor, `SELECT * FROM ${TAXONOMY_TABLES[kind]} WHERE user_id=? ORDER BY created_at,id`, [userId])
      taxonomy.push(...found.map((row) => this.mapTaxonomy(kind, row)))
    }
    const unitRows = await queryRows<SqlRow>(executor, 'SELECT * FROM life_units WHERE user_id=? ORDER BY created_at,id', [userId])
    return {
      catalogTaxonomy: taxonomy,
      lifeUnits: unitRows.map((row) => this.mapUnit(row)),
      catalogItems: await this.hydrateItems(executor, userId, itemRows),
    }
  }

  async createCatalogItem(userId: string, input: CreateCatalogItemInput, idempotencyKey: string) {
    return (await this.createIdempotently(userId, normalizeCatalogIdempotencyKey(idempotencyKey), input, async (connection) => {
      await this.validateItemReferences(connection, userId, input)
      const item = createCatalogItemEntity(this.createId(), this.now(), input, this.createId)
      await this.insertItem(connection, userId, item)
      await this.audit(connection, userId, 'life.catalog.create', item.id, { kind: item.kind })
      return item
    })).value
  }

  async updateCatalogItem(userId: string, id: string, input: UpdateCatalogItemInput) {
    return this.inTransaction((connection) => this.updateCatalogItemFrom(connection, userId, id, input))
  }

  async updateCatalogItemFrom(connection: PoolConnection, userId: string, id: string, input: UpdateCatalogItemInput) {
    const current = await this.lockItem(connection, userId, id, false)
    if (!current) return undefined
    const next = updateCatalogItemEntity(current, this.now(), input, this.createId)
    await this.validateItemReferences(connection, userId, next)
    const [result] = await connection.execute<ResultSetHeader>(`UPDATE life_items SET item_kind = ?, name = ?, aliases = ?, status = ?,
      category_id = ?, location_id = ?, base_unit = ?, available_units = ?, notes = ?, custom_order = ?, version = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [
      next.kind, next.name, JSON.stringify(next.aliases), next.status, next.categoryId, next.locationId, next.baseUnit,
      JSON.stringify(next.availableUnits), next.notes, next.customOrder, next.version, toSqlDateTime(next.updatedAt), id, userId, input.version,
    ])
    if (result.affectedRows !== 1) throw this.versionConflict()
    await this.replaceItemRelations(connection, userId, next)
    const existingPrices = new Set(current.pricePoints.map((point) => point.id))
    for (const point of next.pricePoints) if (!existingPrices.has(point.id)) await this.insertPrice(connection, userId, id, point, next.updatedAt)
    await this.audit(connection, userId, 'life.catalog.update', id, { previousVersion: input.version, nextVersion: next.version })
    return next
  }

  async batchUpdateCatalogItems(userId: string, input: CatalogBatchInput) {
    return this.inTransaction(async (connection) => {
      if (!input.items.length) throw new LifeCatalogDomainError('INVALID_INPUT', 'A batch must contain at least one catalog item.', 400)
      const ids = input.items.map((entry) => entry.id)
      if (new Set(ids).size !== ids.length) throw new LifeCatalogDomainError('INVALID_INPUT', 'A catalog item may appear only once in a batch.', 400)
      await this.validateTaxonomyReferences(connection, userId, input.patch.categoryId, input.patch.addTagIds, input.patch.locationId)
      const timestamp = this.now()
      const results: CatalogItem[] = []
      for (const expected of input.items) {
        const current = await this.lockItem(connection, userId, expected.id, false)
        if (!current) throw new LifeCatalogDomainError('NOT_FOUND', 'A catalog item in the batch does not exist.', 404)
        assertCatalogVersion(current.version, expected.version)
        results.push(current)
      }
      const remove = new Set(input.patch.removeTagIds ?? [])
      const add = input.patch.addTagIds ?? []
      const replacements = results.map((current) => ({
        ...current,
        categoryId: input.patch.categoryId === undefined ? current.categoryId : input.patch.categoryId,
        locationId: input.patch.locationId === undefined ? current.locationId : input.patch.locationId,
        tagIds: [...new Set([...current.tagIds.filter((tagId) => !remove.has(tagId)), ...add])],
        status: input.patch.status ?? current.status,
        version: current.version + 1,
        updatedAt: timestamp,
      }))
      for (const next of replacements) {
        const [result] = await connection.execute<ResultSetHeader>(`UPDATE life_items SET category_id = ?, location_id = ?, status = ?,
          version = ?, updated_at = ? WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [
          next.categoryId, next.locationId, next.status, next.version, toSqlDateTime(timestamp), next.id, userId, next.version - 1,
        ])
        if (result.affectedRows !== 1) throw this.versionConflict()
        await this.replaceTags(connection, userId, next.id, next.tagIds, timestamp)
        await this.audit(connection, userId, 'life.catalog.batch-update', next.id, { nextVersion: next.version })
      }
      return replacements
    })
  }

  async previewCatalogItemDelete(userId: string, id: string) {
    const exists = await queryRows<SqlRow>(this.pool, `SELECT id FROM life_items
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`, [id, userId])
    if (!exists[0]) return undefined
    return this.readDeleteImpact(this.pool, userId, id)
  }

  async deleteCatalogItem(userId: string, id: string, version: number) {
    return this.inTransaction(async (connection) => {
      const current = await this.lockItem(connection, userId, id, false)
      if (!current) return false
      assertCatalogVersion(current.version, version)
      const timestamp = this.now()
      const [result] = await connection.execute<ResultSetHeader>(`UPDATE life_items SET version = version + 1, updated_at = ?, deleted_at = ?
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [toSqlDateTime(timestamp), toSqlDateTime(timestamp), id, userId, version])
      if (result.affectedRows !== 1) throw this.versionConflict()
      await this.audit(connection, userId, 'life.catalog.delete', id, { impact: await this.readDeleteImpact(connection, userId, id) })
      return true
    })
  }

  async listDeletedCatalogItems(userId: string) {
    const rows = await queryRows<SqlRow>(this.pool, `SELECT * FROM life_items
      WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC, id`, [userId])
    return this.hydrateItems(this.pool, userId, rows)
  }

  async restoreCatalogItem(userId: string, id: string, version: number) {
    return this.inTransaction(async (connection) => {
      const current = await this.lockItem(connection, userId, id, true)
      if (!current) return undefined
      assertCatalogVersion(current.version, version)
      await this.validateItemReferences(connection, userId, current)
      const timestamp = this.now()
      const [result] = await connection.execute<ResultSetHeader>(`UPDATE life_items SET version = version + 1, updated_at = ?, deleted_at = NULL
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NOT NULL`, [toSqlDateTime(timestamp), id, userId, version])
      if (result.affectedRows !== 1) throw this.versionConflict()
      await connection.execute(`UPDATE life_trash_references SET restored_at = ?
        WHERE user_id = ? AND entity_type = 'catalog-item' AND entity_id = ? AND restored_at IS NULL`, [toSqlDateTime(timestamp), userId, id])
      await this.audit(connection, userId, 'life.catalog.restore', id, { previousVersion: version, nextVersion: version + 1 })
      return { ...current, version: version + 1, updatedAt: timestamp, deletedAt: null }
    })
  }

  async listTaxonomy(userId: string, kind: TaxonomyKind, includeDeleted = false) {
    const table = TAXONOMY_TABLES[kind]
    const rows = await queryRows<SqlRow>(this.pool, `SELECT * FROM ${table}
      WHERE user_id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY ${kind === 'tag' ? '' : 'position, '}name, id`, [userId])
    return rows.map((row) => this.mapTaxonomy(kind, row))
  }

  async createTaxonomy(userId: string, kind: TaxonomyKind, input: CreateTaxonomyInput) {
    return this.inTransaction(async (connection) => {
      await this.validateParent(connection, userId, kind, input.parentId ?? null)
      const value = createTaxonomyEntity(this.createId(), this.now(), kind, input)
      const table = TAXONOMY_TABLES[kind]
      try {
        if (kind === 'tag') {
          await connection.execute(`INSERT INTO ${table}
            (id, user_id, name, status, version, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, 1, ?, ?, NULL)`, [
            value.id, userId, value.name, value.status, toSqlDateTime(value.createdAt), toSqlDateTime(value.updatedAt),
          ])
        } else {
          await connection.execute(`INSERT INTO ${table}
            (id, user_id, name, parent_id, status, position, version, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`, [
            value.id, userId, value.name, value.parentId, value.status, value.position, toSqlDateTime(value.createdAt), toSqlDateTime(value.updatedAt),
          ])
        }
      } catch (error) { throw this.mapDuplicate(error, 'NAME_CONFLICT', 'That taxonomy name is already in use.') }
      await this.audit(connection, userId, `life.${kind}.create`, value.id, {})
      return value
    })
  }

  async updateTaxonomy(userId: string, kind: TaxonomyKind, id: string, input: UpdateTaxonomyInput) {
    return this.inTransaction(async (connection) => {
      const current = await this.lockTaxonomy(connection, userId, kind, id, false)
      if (!current) return undefined
      if (input.parentId !== undefined) {
        await this.validateParent(connection, userId, kind, input.parentId)
        if (kind !== 'tag') assertCategoryMove(await this.listTaxonomyFrom(connection, userId, kind, false), id, input.parentId)
      }
      const next = updateTaxonomyEntity(current, this.now(), input)
      const table = TAXONOMY_TABLES[kind]
      try {
        const [result] = kind === 'tag'
          ? await connection.execute<ResultSetHeader>(`UPDATE ${table} SET name = ?, status = ?, version = ?, updated_at = ?
              WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [next.name, next.status, next.version, toSqlDateTime(next.updatedAt), id, userId, input.version])
          : await connection.execute<ResultSetHeader>(`UPDATE ${table} SET name = ?, parent_id = ?, status = ?, position = ?, version = ?, updated_at = ?
              WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [next.name, next.parentId, next.status, next.position, next.version, toSqlDateTime(next.updatedAt), id, userId, input.version])
        if (result.affectedRows !== 1) throw this.versionConflict()
      } catch (error) { throw this.mapDuplicate(error, 'NAME_CONFLICT', 'That taxonomy name is already in use.') }
      await this.audit(connection, userId, `life.${kind}.update`, id, { nextVersion: next.version })
      return next
    })
  }

  async deleteTaxonomy(userId: string, kind: TaxonomyKind, id: string, version: number) {
    return this.inTransaction(async (connection) => {
      const current = await this.lockTaxonomy(connection, userId, kind, id, false)
      if (!current) return false
      assertCatalogVersion(current.version, version)
      const table = TAXONOMY_TABLES[kind]
      const child = kind === 'tag' ? [] : await queryRows<SqlRow>(connection, `SELECT id FROM ${table}
        WHERE user_id = ? AND parent_id = ? AND deleted_at IS NULL LIMIT 1`, [userId, id])
      const used = kind === 'tag'
        ? await queryRows<SqlRow>(connection, `SELECT item_id AS id FROM life_item_tags tags INNER JOIN life_items item
            ON item.id = tags.item_id AND item.user_id = tags.user_id WHERE tags.user_id = ? AND tags.tag_id = ? AND item.deleted_at IS NULL LIMIT 1`, [userId, id])
        : await queryRows<SqlRow>(connection, `SELECT id FROM life_items WHERE user_id = ? AND ${kind === 'category' ? 'category_id' : 'location_id'} = ? AND deleted_at IS NULL LIMIT 1`, [userId, id])
      if (child[0] || used[0]) throw new LifeCatalogDomainError('TAXONOMY_IN_USE', 'The taxonomy value is still referenced.', 409)
      const timestamp = this.now()
      await connection.execute(`UPDATE ${table} SET version = version + 1, updated_at = ?, deleted_at = ?
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [toSqlDateTime(timestamp), toSqlDateTime(timestamp), id, userId, version])
      await this.audit(connection, userId, `life.${kind}.delete`, id, {})
      return true
    })
  }

  async restoreTaxonomy(userId: string, kind: TaxonomyKind, id: string, version: number) {
    return this.inTransaction(async (connection) => {
      const current = await this.lockTaxonomy(connection, userId, kind, id, true)
      if (!current) return undefined
      assertCatalogVersion(current.version, version)
      await this.validateParent(connection, userId, kind, current.parentId)
      const timestamp = this.now()
      const table = TAXONOMY_TABLES[kind]
      await connection.execute(`UPDATE ${table} SET version = version + 1, updated_at = ?, deleted_at = NULL
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NOT NULL`, [toSqlDateTime(timestamp), id, userId, version])
      await this.audit(connection, userId, `life.${kind}.restore`, id, {})
      return { ...current, version: version + 1, updatedAt: timestamp, deletedAt: null }
    })
  }

  async listUnits(userId: string, includeDeleted = false) {
    return this.listUnitsFrom(this.pool, userId, includeDeleted)
  }

  async listUnitsFrom(executor: Executor, userId: string, includeDeleted = false) {
    const rows = await queryRows<SqlRow>(executor, `SELECT * FROM life_units
      WHERE user_id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY dimension, code`, [userId])
    return [...structuredClone(BUILT_IN_UNITS), ...rows.map((row) => this.mapUnit(row))]
      .sort((left, right) => left.dimension.localeCompare(right.dimension) || left.code.localeCompare(right.code))
  }

  async createUnit(userId: string, input: CreateUnitInput) {
    const value = createUnitEntity(this.createId(), this.now(), input)
    if (BUILT_IN_UNITS.some((unit) => unit.code === value.code)) throw new LifeCatalogDomainError('UNIT_CODE_CONFLICT', 'That unit code is already in use.', 409)
    try {
      await this.pool.execute(`INSERT INTO life_units
        (id, user_id, code, name, symbol, dimension, base_code, to_base_factor, version, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`, [
        value.id, userId, value.code, value.name, value.symbol, value.dimension, value.baseCode, value.toBaseFactor,
        toSqlDateTime(value.createdAt), toSqlDateTime(value.updatedAt),
      ])
    } catch (error) { throw this.mapDuplicate(error, 'UNIT_CODE_CONFLICT', 'That unit code is already in use.') }
    return value
  }

  async updateUnit(userId: string, id: string, input: UpdateUnitInput) {
    return this.inTransaction(async (connection) => {
      if (id.startsWith('builtin:')) throw new LifeCatalogDomainError('BUILT_IN_UNIT_IMMUTABLE', 'Built-in units cannot be changed.', 409)
      const current = await this.lockUnit(connection, userId, id, false)
      if (!current) return undefined
      const next = updateUnitEntity(current, this.now(), input)
      if (BUILT_IN_UNITS.some((unit) => unit.code === next.code)) throw new LifeCatalogDomainError('UNIT_CODE_CONFLICT', 'That unit code is already in use.', 409)
      try {
        const [result] = await connection.execute<ResultSetHeader>(`UPDATE life_units SET code = ?, name = ?, symbol = ?, dimension = ?,
          base_code = ?, to_base_factor = ?, version = ?, updated_at = ? WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [
          next.code, next.name, next.symbol, next.dimension, next.baseCode, next.toBaseFactor, next.version, toSqlDateTime(next.updatedAt), id, userId, input.version,
        ])
        if (result.affectedRows !== 1) throw this.versionConflict()
      } catch (error) { throw this.mapDuplicate(error, 'UNIT_CODE_CONFLICT', 'That unit code is already in use.') }
      return next
    })
  }

  async deleteUnit(userId: string, id: string, version: number) {
    return this.inTransaction(async (connection) => {
      if (id.startsWith('builtin:')) throw new LifeCatalogDomainError('BUILT_IN_UNIT_IMMUTABLE', 'Built-in units cannot be changed.', 409)
      const current = await this.lockUnit(connection, userId, id, false)
      if (!current) return false
      assertCatalogVersion(current.version, version)
      const itemRows = await queryRows<SqlRow>(connection, `SELECT base_unit, available_units FROM life_items
        WHERE user_id = ? AND deleted_at IS NULL`, [userId])
      const inUse = itemRows.some((row) => String(row.base_unit) === current.code || parseJson<string[]>(row.available_units, []).includes(current.code))
      const conversion = await queryRows<SqlRow>(connection, `SELECT id FROM life_item_unit_conversions
        WHERE user_id = ? AND deleted_at IS NULL AND (from_unit = ? OR to_unit = ?) LIMIT 1`, [userId, current.code, current.code])
      if (inUse || conversion[0]) throw new LifeCatalogDomainError('UNIT_IN_USE', 'The unit is still referenced.', 409)
      const timestamp = this.now()
      await connection.execute(`UPDATE life_units SET version = version + 1, updated_at = ?, deleted_at = ?
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL`, [toSqlDateTime(timestamp), toSqlDateTime(timestamp), id, userId, version])
      return true
    })
  }

  async restoreUnit(userId: string, id: string, version: number) {
    return this.inTransaction(async (connection) => {
      const current = await this.lockUnit(connection, userId, id, true)
      if (!current) return undefined
      assertCatalogVersion(current.version, version)
      const timestamp = this.now()
      await connection.execute(`UPDATE life_units SET version = version + 1, updated_at = ?, deleted_at = NULL
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NOT NULL`, [toSqlDateTime(timestamp), id, userId, version])
      return { ...current, version: version + 1, updatedAt: timestamp, deletedAt: null }
    })
  }

  private async insertItem(connection: PoolConnection, userId: string, item: CatalogItem) {
    await connection.execute(`INSERT INTO life_items
      (id, user_id, item_kind, name, aliases, status, category_id, location_id, base_unit, available_units, notes,
       custom_order, version, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`, [
      item.id, userId, item.kind, item.name, JSON.stringify(item.aliases), item.status, item.categoryId, item.locationId,
      item.baseUnit, JSON.stringify(item.availableUnits), item.notes, item.customOrder, toSqlDateTime(item.createdAt), toSqlDateTime(item.updatedAt),
    ])
    await this.replaceItemRelations(connection, userId, item)
    for (const point of item.pricePoints) await this.insertPrice(connection, userId, item.id, point, item.createdAt)
  }

  private async replaceItemRelations(connection: PoolConnection, userId: string, item: CatalogItem) {
    await this.replaceTags(connection, userId, item.id, item.tagIds, item.updatedAt)
    await connection.execute('DELETE FROM life_item_unit_conversions WHERE user_id = ? AND item_id = ?', [userId, item.id])
    for (const rule of item.itemConversions) {
      await connection.execute(`INSERT INTO life_item_unit_conversions
        (id, user_id, item_id, from_unit, to_unit, conversion_factor, version, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`, [
        this.createId(), userId, item.id, rule.fromUnit, rule.toUnit, rule.factor, toSqlDateTime(item.updatedAt), toSqlDateTime(item.updatedAt),
      ])
    }
    await connection.execute('DELETE FROM life_item_attachments WHERE user_id = ? AND item_id = ?', [userId, item.id])
    for (const [position, attachment] of item.attachments.entries()) {
      await connection.execute(`INSERT INTO life_item_attachments
        (user_id, item_id, media_id, caption, position, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)`, [
        userId, item.id, attachment.mediaId, attachment.caption, position, toSqlDateTime(item.updatedAt),
      ])
    }
    await connection.execute('DELETE FROM life_item_profiles WHERE user_id = ? AND item_id = ?', [userId, item.id])
    await connection.execute(`INSERT INTO life_item_profiles
      (item_id, user_id, profile_kind, profile_data, version, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, NULL)`, [
      item.id, userId, item.kind, JSON.stringify({ nutrition: item.nutrition, isCookingOil: item.isCookingOil, medicine: item.medicine, profile: item.profile }),
      toSqlDateTime(item.createdAt), toSqlDateTime(item.updatedAt),
    ])
  }

  private async replaceTags(connection: PoolConnection, userId: string, itemId: string, tagIds: string[], timestamp: string) {
    await connection.execute('DELETE FROM life_item_tags WHERE user_id = ? AND item_id = ?', [userId, itemId])
    for (const [position, tagId] of tagIds.entries()) {
      await connection.execute(`INSERT INTO life_item_tags (user_id, item_id, tag_id, position, created_at)
        VALUES (?, ?, ?, ?, ?)`, [userId, itemId, tagId, position, toSqlDateTime(timestamp)])
    }
  }

  private async insertPrice(connection: PoolConnection, userId: string, itemId: string, point: PricePoint, timestamp: string) {
    await connection.execute(`INSERT INTO life_price_history
      (id, user_id, item_id, amount_minor, currency, purchase_quantity, purchase_unit, effective_from, version, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`, [
      point.id, userId, itemId, point.amountMinor, point.currency, point.purchaseQuantity, point.purchaseUnit, point.effectiveFrom,
      toSqlDateTime(timestamp), toSqlDateTime(timestamp),
    ])
  }

  private async hydrateItems(executor: Executor, userId: string, rows: SqlRow[]): Promise<CatalogItem[]> {
    if (!rows.length) return []
    const ids = rows.map((row) => String(row.id))
    const placeholders = ids.map(() => '?').join(', ')
    const values = [userId, ...ids]
    const profileRows = await queryRows<SqlRow>(executor, `SELECT * FROM life_item_profiles WHERE user_id = ? AND item_id IN (${placeholders}) AND deleted_at IS NULL`, values)
    const tagRows = await queryRows<SqlRow>(executor, `SELECT item_id, tag_id FROM life_item_tags WHERE user_id = ? AND item_id IN (${placeholders}) ORDER BY item_id, position, tag_id`, values)
    const conversionRows = await queryRows<SqlRow>(executor, `SELECT * FROM life_item_unit_conversions WHERE user_id = ? AND item_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY item_id, from_unit, to_unit`, values)
    const priceRows = await queryRows<SqlRow>(executor, `SELECT * FROM life_price_history WHERE user_id = ? AND item_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY item_id, effective_from, id`, values)
    const attachmentRows = await queryRows<SqlRow>(executor, `SELECT * FROM life_item_attachments WHERE user_id = ? AND item_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY item_id, position, media_id`, values)

    const profiles = new Map(profileRows.map((row) => [String(row.item_id), parseJson<{ nutrition?: NutritionProfile; isCookingOil?: boolean; medicine?: MedicineProfile; profile?: CatalogItem['profile'] }>(row.profile_data, {})]))
    const tags = this.group<string>(tagRows, (row) => String(row.item_id), (row) => String(row.tag_id))
    const conversions = this.group<ItemUnitConversion>(conversionRows, (row) => String(row.item_id), (row) => ({
      itemId: String(row.item_id), fromUnit: String(row.from_unit), toUnit: String(row.to_unit), factor: Number(row.conversion_factor),
    }))
    const prices = this.group<PricePoint>(priceRows, (row) => String(row.item_id), (row) => ({
      id: String(row.id), amountMinor: Number(row.amount_minor), currency: String(row.currency), purchaseQuantity: Number(row.purchase_quantity),
      purchaseUnit: String(row.purchase_unit), effectiveFrom: String(row.effective_from).slice(0, 10),
    }))
    const attachments = this.group<CatalogAttachment>(attachmentRows, (row) => String(row.item_id), (row) => ({ mediaId: String(row.media_id), caption: String(row.caption) }))

    return rows.map((row) => {
      const id = String(row.id)
      const profile = profiles.get(id) ?? {}
      return {
        id,
        kind: row.item_kind as CatalogItem['kind'],
        name: String(row.name),
        aliases: parseJson<string[]>(row.aliases, []),
        status: row.status as CatalogItem['status'],
        categoryId: row.category_id == null ? null : String(row.category_id),
        tagIds: tags.get(id) ?? [],
        locationId: row.location_id == null ? null : String(row.location_id),
        baseUnit: String(row.base_unit),
        availableUnits: parseJson<string[]>(row.available_units, []),
        itemConversions: conversions.get(id) ?? [],
        pricePoints: prices.get(id) ?? [],
        nutrition: profile.nutrition,
        isCookingOil: profile.isCookingOil ?? false,
        medicine: profile.medicine,
        profile: profile.profile,
        attachments: attachments.get(id) ?? [],
        notes: String(row.notes),
        customOrder: Number(row.custom_order),
        version: Number(row.version),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        deletedAt: optionalIso(row.deleted_at),
      }
    })
  }

  private group<T>(rows: SqlRow[], key: (row: SqlRow) => string, value: (row: SqlRow) => T) {
    const result = new Map<string, T[]>()
    for (const row of rows) {
      const name = key(row)
      const items = result.get(name) ?? []
      items.push(value(row))
      result.set(name, items)
    }
    return result
  }

  private async lockItem(connection: PoolConnection, userId: string, id: string, deleted: boolean) {
    const rows = await queryRows<SqlRow>(connection, `SELECT * FROM life_items
      WHERE id = ? AND user_id = ? AND deleted_at IS ${deleted ? 'NOT ' : ''}NULL LIMIT 1 FOR UPDATE`, [id, userId])
    return rows[0] ? (await this.hydrateItems(connection, userId, rows))[0] : undefined
  }

  private async validateItemReferences(executor: Executor, userId: string, input: Pick<CreateCatalogItemInput, 'categoryId' | 'tagIds' | 'locationId' | 'attachments'>) {
    await this.validateTaxonomyReferences(executor, userId, input.categoryId, input.tagIds, input.locationId)
    const mediaIds = [...new Set((input.attachments ?? []).map((attachment) => attachment.mediaId))]
    if (mediaIds.length) {
      const placeholders = mediaIds.map(() => '?').join(', ')
      const rows = await queryRows<SqlRow>(executor, `SELECT id FROM media_assets
        WHERE user_id = ? AND id IN (${placeholders}) AND deleted_at IS NULL`, [userId, ...mediaIds])
      if (rows.length !== mediaIds.length) throw new LifeCatalogDomainError('NOT_FOUND', 'Catalog attachment media was not found.', 404)
    }
  }

  private async validateTaxonomyReferences(executor: Executor, userId: string, categoryId?: string | null, tagIds?: string[], locationId?: string | null) {
    if (categoryId != null && !(await this.taxonomyExists(executor, userId, 'category', categoryId))) throw new LifeCatalogDomainError('NOT_FOUND', 'The category does not exist.', 404)
    if (locationId != null && !(await this.taxonomyExists(executor, userId, 'location', locationId))) throw new LifeCatalogDomainError('NOT_FOUND', 'The location does not exist.', 404)
    const ids = [...new Set(tagIds ?? [])]
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(', ')
      const rows = await queryRows<SqlRow>(executor, `SELECT id FROM life_tags
        WHERE user_id = ? AND id IN (${placeholders}) AND status = 'active' AND deleted_at IS NULL`, [userId, ...ids])
      if (rows.length !== ids.length) throw new LifeCatalogDomainError('NOT_FOUND', 'A tag does not exist.', 404)
    }
  }

  private async taxonomyExists(executor: Executor, userId: string, kind: TaxonomyKind, id: string) {
    const rows = await queryRows<SqlRow>(executor, `SELECT id FROM ${TAXONOMY_TABLES[kind]}
      WHERE id = ? AND user_id = ? AND status = 'active' AND deleted_at IS NULL LIMIT 1`, [id, userId])
    return Boolean(rows[0])
  }

  private async validateParent(executor: Executor, userId: string, kind: TaxonomyKind, parentId: string | null) {
    if (kind === 'tag' && parentId != null) throw new LifeCatalogDomainError('INVALID_INPUT', 'Tags do not have parents.', 400)
    if (parentId != null && !(await this.taxonomyExists(executor, userId, kind, parentId))) throw new LifeCatalogDomainError('NOT_FOUND', 'The taxonomy parent does not exist.', 404)
  }

  private async listTaxonomyFrom(executor: Executor, userId: string, kind: TaxonomyKind, includeDeleted: boolean) {
    const rows = await queryRows<SqlRow>(executor, `SELECT * FROM ${TAXONOMY_TABLES[kind]}
      WHERE user_id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`, [userId])
    return rows.map((row) => this.mapTaxonomy(kind, row))
  }

  private async lockTaxonomy(connection: PoolConnection, userId: string, kind: TaxonomyKind, id: string, deleted: boolean) {
    const rows = await queryRows<SqlRow>(connection, `SELECT * FROM ${TAXONOMY_TABLES[kind]}
      WHERE id = ? AND user_id = ? AND deleted_at IS ${deleted ? 'NOT ' : ''}NULL LIMIT 1 FOR UPDATE`, [id, userId])
    return rows[0] ? this.mapTaxonomy(kind, rows[0]) : undefined
  }

  private mapTaxonomy(kind: TaxonomyKind, row: SqlRow): TaxonomyEntity {
    return {
      id: String(row.id), kind, name: String(row.name), parentId: kind === 'tag' || row.parent_id == null ? null : String(row.parent_id),
      status: row.status as TaxonomyEntity['status'], position: kind === 'tag' ? 0 : Number(row.position), version: Number(row.version),
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), deletedAt: optionalIso(row.deleted_at),
    }
  }

  private async lockUnit(connection: PoolConnection, userId: string, id: string, deleted: boolean) {
    const rows = await queryRows<SqlRow>(connection, `SELECT * FROM life_units
      WHERE id = ? AND user_id = ? AND deleted_at IS ${deleted ? 'NOT ' : ''}NULL LIMIT 1 FOR UPDATE`, [id, userId])
    return rows[0] ? this.mapUnit(rows[0]) : undefined
  }

  private mapUnit(row: SqlRow): LifeUnit {
    return {
      id: String(row.id), code: String(row.code), name: String(row.name), symbol: String(row.symbol), dimension: row.dimension as LifeUnit['dimension'],
      baseCode: String(row.base_code), toBaseFactor: row.to_base_factor == null ? null : Number(row.to_base_factor), version: Number(row.version),
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), deletedAt: optionalIso(row.deleted_at), builtIn: false,
    }
  }

  private async readDeleteImpact(executor: Executor, userId: string, itemId: string): Promise<CatalogDeleteImpact> {
    const storedReferences = await queryRows<SqlRow>(executor, `SELECT reference_type, reference_id FROM life_trash_references
      WHERE user_id = ? AND entity_type = 'catalog-item' AND entity_id = ? AND restored_at IS NULL ORDER BY reference_type, reference_id`, [userId, itemId])
    const currentRecipes = await queryRows<SqlRow>(executor, `SELECT DISTINCT recipe.id reference_id
      FROM life_recipes recipe
      INNER JOIN life_recipe_components component
        ON component.user_id = recipe.user_id AND component.recipe_version_id = recipe.current_version_id
      WHERE recipe.user_id = ? AND recipe.deleted_at IS NULL AND component.item_id = ?
      ORDER BY recipe.id`, [userId, itemId])
    const storedIds = (type: string) => storedReferences.filter((row) => row.reference_type === type).map((row) => String(row.reference_id))
    return {
      recipeIds: [...new Set([...storedIds('recipe'), ...currentRecipes.map((row) => String(row.reference_id))])].sort(),
      templateIds: storedIds('template'),
      futurePlanIds: storedIds('future-plan'),
    }
  }

  private async audit(connection: PoolConnection, userId: string, action: string, entityId: string, details: unknown) {
    const timestamp = this.now()
    await connection.execute(`INSERT INTO audit_events
      (id, user_id, action, entity_type, entity_id, request_id, details, occurred_at, created_at)
      VALUES (?, ?, ?, 'life-catalog', ?, NULL, ?, ?, ?)`, [
      this.createId(), userId, action, entityId, JSON.stringify(details), toSqlDateTime(timestamp), toSqlDateTime(timestamp),
    ])
  }

  private async createIdempotently<T>(
    userId: string,
    key: string,
    input: unknown,
    create: (connection: PoolConnection) => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }> {
    const hash = requestHash(input)
    const connection = await this.pool.getConnection()
    let transactionOpen = false
    try {
      await connection.beginTransaction()
      transactionOpen = true
      const existing = await this.idempotencyRows(connection, userId, key, true)
      if (existing[0]) {
        const value = this.replay<T>(existing[0], hash)
        await connection.commit()
        transactionOpen = false
        return { value, replayed: true }
      }
      const timestamp = this.now()
      try {
        await connection.execute(`INSERT INTO idempotency_keys
          (id, user_id, scope, idempotency_key, request_hash, response_status, response_body, created_at, expires_at)
          VALUES (?, ?, 'life-catalog:create', ?, ?, NULL, NULL, ?, ?)`, [
          this.createId(), userId, key, hash, toSqlDateTime(timestamp),
          toSqlDateTime(new Date(Date.parse(timestamp) + 24 * 60 * 60 * 1_000).toISOString()),
        ])
      } catch (error) {
        if (!this.duplicateEntry(error)) throw error
        await connection.rollback()
        transactionOpen = false
        const raced = await this.idempotencyRows(this.pool, userId, key, false)
        if (!raced[0]) throw error
        return { value: this.replay<T>(raced[0], hash), replayed: true }
      }
      const value = await create(connection)
      await connection.execute(`UPDATE idempotency_keys SET response_status = 201, response_body = ?
        WHERE user_id = ? AND scope = 'life-catalog:create' AND idempotency_key = ?`, [JSON.stringify(value), userId, key])
      await connection.commit()
      transactionOpen = false
      return { value, replayed: false }
    } catch (error) {
      if (transactionOpen) await connection.rollback()
      throw error
    } finally { connection.release() }
  }

  private async idempotencyRows(executor: Executor, userId: string, key: string, lock: boolean) {
    return queryRows<SqlRow>(executor, `SELECT request_hash, response_body FROM idempotency_keys
      WHERE user_id = ? AND scope = 'life-catalog:create' AND idempotency_key = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [userId, key])
  }

  private replay<T>(row: SqlRow, hash: string): T {
    if (String(row.request_hash).toUpperCase() !== hash) throw new LifeCatalogDomainError('IDEMPOTENCY_CONFLICT', 'The idempotency key belongs to a different catalog request.', 409)
    if (row.response_body == null) throw new LifeCatalogDomainError('IDEMPOTENCY_CONFLICT', 'The matching catalog request is still in progress.', 409)
    return parseJson<T>(row.response_body, undefined as T)
  }

  private duplicateEntry(error: unknown) {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ER_DUP_ENTRY')
  }

  private mapDuplicate(error: unknown, code: string, message: string) {
    return this.duplicateEntry(error) ? new LifeCatalogDomainError(code, message, 409) : error
  }

  private versionConflict() {
    return new LifeCatalogDomainError('VERSION_CONFLICT', 'The catalog entry changed; refresh before retrying.', 409)
  }

  private async inTransaction<T>(operation: (connection: PoolConnection) => Promise<T>) {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const value = await operation(connection)
      await connection.commit()
      return value
    } catch (error) {
      await connection.rollback()
      throw error
    } finally { connection.release() }
  }
}
