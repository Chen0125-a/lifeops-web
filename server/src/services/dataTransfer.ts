import { createHash, randomUUID } from 'node:crypto'

export type PortableRow = Record<string, any>

export interface DataTransferOwnedData {
  original: {
    goals: PortableRow[]
    projects: PortableRow[]
    milestones: PortableRow[]
    tasks: PortableRow[]
    scheduleBlocks: PortableRow[]
    habits: PortableRow[]
    habitEntries: PortableRow[]
    records: PortableRow[]
    reviews: PortableRow[]
    knowledge: PortableRow[]
    publications: PortableRow[]
    trash: PortableRow[]
  }
  life: Record<string, PortableRow[]>
  settings: Record<string, unknown>
}

export interface DataTransferPort {
  readOwnedData(userId: string): Promise<DataTransferOwnedData>
  applyOwnedData(userId: string, data: DataTransferOwnedData): Promise<void>
  persistDataTransferRestorePoint(userId: string, snapshot: DataExportResult): Promise<DataTransferRestorePoint>
  transaction<T>(userId: string, work: () => Promise<T>): Promise<T>
}

export type DataTransferCounts = Record<string, number>

export interface DataExportResult {
  schemaVersion: 1
  canonicalJson: string
  checksumSha256: string
  counts: DataTransferCounts
}

export interface DataTransferRestorePoint {
  id: string
  checksumSha256: string
  createdAt: string
}

export interface DataImportPreview {
  status: 'ready' | 'conflicts'
  previewChecksum: string
  counts: DataTransferCounts
  conflicts: Array<{ id: string; collection: string }>
  rejectedRecords: Array<{ collection: string; id: string; code: string; message: string }>
  ownerRemap: { source: string; target: string }
}

export type DataTransferErrorCode =
  | 'INVALID_IMPORT'
  | 'IMPORT_VERSION_UNSUPPORTED'
  | 'IMPORT_CHECKSUM_MISMATCH'
  | 'IMPORT_RELATION_MISSING'
  | 'IMPORT_PREVIEW_STALE'
  | 'CURRENT_PASSWORD_INVALID'

export class DataTransferError extends Error {
  constructor(public readonly code: DataTransferErrorCode, message: string, public readonly statusCode: number) {
    super(message)
    this.name = 'DataTransferError'
  }
}

const SENSITIVE_KEYS = new Set([
  'passwordhash',
  'password_hash',
  'sessiontokens',
  'sessiontoken',
  'tokenhash',
  'token_hash',
  'csrftoken',
  'csrf_token',
  'loginlimits',
  'loginratelimits',
  'platformcredentials',
  'rawsanitizedlogsamples',
  'rawlogsamples',
  'cookie',
  'cookies',
  'secret',
  'secrets',
])

export function stableDataTransferJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableDataTransferJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableDataTransferJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function checksumDataTransfer(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !SENSITIVE_KEYS.has(key.toLocaleLowerCase()))
    .map(([key, item]) => [key, sanitize(item)]))
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DataTransferError('INVALID_IMPORT', `${field} must be an object.`, 400)
  }
  return value as Record<string, unknown>
}

function rows(value: unknown, field: string): PortableRow[] {
  if (!Array.isArray(value) || value.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
    throw new DataTransferError('INVALID_IMPORT', `${field} must be an array of records.`, 400)
  }
  return value as PortableRow[]
}

function idSet(values: PortableRow[]) {
  return new Set(values.map((row) => row.id).filter((id): id is string => typeof id === 'string' && id.length > 0))
}

function rejectDuplicateIds(collections: Array<{ name: string; values: PortableRow[] }>) {
  const seen = new Map<string, string>()
  for (const { name, values } of collections) for (const row of values) {
    if (typeof row.id !== 'string' || !row.id) continue
    const prior = seen.get(row.id)
    if (prior) throw new DataTransferError('INVALID_IMPORT', `${name}.${row.id} collides with ${prior}.`, 409)
    seen.set(row.id, name)
  }
}

function relationExists(value: unknown, ids: Set<string>, collection: string, row: PortableRow, field: string) {
  if (value == null) return
  if (typeof value !== 'string' || !ids.has(value)) {
    throw new DataTransferError(
      'IMPORT_RELATION_MISSING',
      `${collection}.${String(row.id ?? 'unknown')}.${field} references a missing record.`,
      409,
    )
  }
}

function validateRelations(data: DataTransferOwnedData) {
  const original = data.original
  for (const [name, values] of Object.entries(original)) rejectDuplicateIds([{ name, values }])
  for (const [name, values] of Object.entries(data.life)) rejectDuplicateIds([{ name, values }])
  rejectDuplicateIds([
    { name: 'catalogItems', values: data.life.catalogItems ?? [] },
    { name: 'recipes', values: data.life.recipes ?? [] },
    { name: 'recipeVersions', values: data.life.recipeVersions ?? [] },
  ])
  const goals = idSet(original.goals)
  const projects = idSet(original.projects)
  const milestones = idSet(original.milestones)
  const tasks = idSet(original.tasks)
  const habits = idSet(original.habits)
  const records = idSet(original.records)
  const reviews = idSet(original.reviews)
  const knowledge = idSet(original.knowledge)

  for (const row of original.projects) relationExists(row.goalId, goals, 'projects', row, 'goalId')
  for (const row of original.milestones) relationExists(row.projectId, projects, 'milestones', row, 'projectId')
  for (const row of original.tasks) {
    relationExists(row.goalId, goals, 'tasks', row, 'goalId')
    relationExists(row.projectId, projects, 'tasks', row, 'projectId')
    relationExists(row.milestoneId, milestones, 'tasks', row, 'milestoneId')
  }
  for (const row of original.scheduleBlocks) relationExists(row.taskId, tasks, 'scheduleBlocks', row, 'taskId')
  for (const row of original.habits) {
    relationExists(row.goalId, goals, 'habits', row, 'goalId')
    relationExists(row.projectId, projects, 'habits', row, 'projectId')
  }
  for (const row of original.habitEntries) relationExists(row.habitId, habits, 'habitEntries', row, 'habitId')
  const originalRelations: Record<string, Set<string>> = { goal: goals, project: projects, record: records, review: reviews, knowledge }
  for (const row of original.records) for (const link of Array.isArray(row.links) ? row.links : []) {
    if (link && typeof link === 'object') relationExists(link.id, originalRelations[String(link.type)] ?? new Set(), 'records', row, 'links')
  }
  for (const row of original.knowledge) for (const link of Array.isArray(row.sourceLinks) ? row.sourceLinks : []) {
    if (link && typeof link === 'object') relationExists(link.id, originalRelations[String(link.type)] ?? new Set(), 'knowledge', row, 'sourceLinks')
  }
  for (const row of original.publications) {
    const sourceIds = originalRelations[String(row.sourceType)]
    if (sourceIds) relationExists(row.sourceId, sourceIds, 'publications', row, 'sourceId')
  }

  const life = data.life
  const taxonomy = idSet(life.catalogTaxonomy ?? [])
  const items = idSet(life.catalogItems ?? [])
  const recipes = idSet(life.recipes ?? [])
  const versions = idSet(life.recipeVersions ?? [])
  const dayPlans = idSet(life.dayPlans ?? [])
  const transactionIds = idSet(life.inventoryTransactions ?? [])

  for (const row of life.catalogTaxonomy ?? []) relationExists(row.parentId, taxonomy, 'catalogTaxonomy', row, 'parentId')
  for (const row of life.catalogItems ?? []) relationExists(row.categoryId, taxonomy, 'catalogItems', row, 'categoryId')
  for (const row of life.recipes ?? []) relationExists(row.currentVersionId, versions, 'recipes', row, 'currentVersionId')
  for (const row of life.recipeVersions ?? []) {
    relationExists(row.recipeId, recipes, 'recipeVersions', row, 'recipeId')
    for (const component of Array.isArray(row.components) ? row.components : []) {
      if (component && typeof component === 'object') relationExists(component.itemId, items, 'recipeVersions', row, 'components.itemId')
    }
  }
  for (const row of life.inventoryTransactions ?? []) {
    relationExists(row.itemId, items, 'inventoryTransactions', row, 'itemId')
    relationExists(row.reversesTransactionId, transactionIds, 'inventoryTransactions', row, 'reversesTransactionId')
    if (typeof row.reversesTransactionId === 'string') {
      const reversed = (life.inventoryTransactions ?? []).find((candidate) => candidate.id === row.reversesTransactionId)
      if (reversed && reversed.itemId !== row.itemId) {
        throw new DataTransferError('INVALID_IMPORT', `inventoryTransactions.${String(row.id)} reverses a different item ledger.`, 409)
      }
    }
  }
  for (const row of life.completionSnapshots ?? []) relationExists(row.dayPlanId, dayPlans, 'completionSnapshots', row, 'dayPlanId')
}

function normalizeOwnedData(value: unknown): DataTransferOwnedData {
  const data = object(value, 'data')
  const original = object(data.original, 'data.original')
  const life = object(data.life, 'data.life')
  const settings = object(data.settings, 'data.settings')
  const requiredOriginal = ['goals', 'projects', 'milestones', 'tasks', 'scheduleBlocks', 'habits', 'habitEntries', 'records', 'reviews', 'knowledge', 'publications', 'trash'] as const
  const normalized: DataTransferOwnedData = {
    original: Object.fromEntries(requiredOriginal.map((key) => [key, rows(original[key], `data.original.${key}`)])) as DataTransferOwnedData['original'],
    life: Object.fromEntries(Object.entries(life).map(([key, value]) => [key, rows(value, `data.life.${key}`)])),
    settings: structuredClone(settings),
  }
  validateRelations(normalized)
  return normalized
}

function countsFor(data: DataTransferOwnedData): DataTransferCounts {
  const counts: DataTransferCounts = {}
  for (const [key, value] of [...Object.entries(data.original), ...Object.entries(data.life)]) {
    counts[key] = (counts[key] ?? 0) + value.length
  }
  return counts
}

function everyRecord(data: DataTransferOwnedData) {
  return [...Object.entries(data.original), ...Object.entries(data.life)]
    .flatMap(([collection, values]) => values.map((row) => ({ collection, row })))
}

function remapOwnedIds(data: DataTransferOwnedData, createId: () => string): DataTransferOwnedData {
  const ids = new Set<string>()
  const collect = (value: unknown) => {
    if (Array.isArray(value)) { for (const item of value) collect(item); return }
    if (!value || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'id' && typeof item === 'string' && item) ids.add(item)
      collect(item)
    }
  }
  collect(data.original)
  collect(data.life)
  const idMap = new Map([...ids].sort((left, right) => left.localeCompare(right, 'en')).map((id) => [id, createId()]))
  const replace = (value: unknown): unknown => {
    if (typeof value === 'string') return idMap.get(value) ?? value
    if (Array.isArray(value)) return value.map(replace)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, replace(item)]))
  }
  return replace(data) as DataTransferOwnedData
}

type StoredPreview = DataImportPreview & { data: DataTransferOwnedData; dataChecksum: string; payloadChecksum: string }

export class DataTransferService {
  private readonly previews = new Map<string, StoredPreview>()
  private readonly now: () => string
  private readonly createId: () => string

  constructor(private readonly port: DataTransferPort, options: { now?: () => string; createId?: () => string } = {}) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.createId = options.createId ?? randomUUID
  }

  async export(userId: string): Promise<DataExportResult> {
    const raw = await this.port.readOwnedData(userId)
    const data = normalizeOwnedData(sanitize(raw))
    const canonicalJson = stableDataTransferJson({ schemaVersion: 1, exportedAt: this.now(), ownerId: userId, data })
    return { schemaVersion: 1, canonicalJson, checksumSha256: checksumDataTransfer(canonicalJson), counts: countsFor(data) }
  }

  async preview(userId: string, input: { canonicalJson: string; checksumSha256: string; existingIds?: string[] }): Promise<DataImportPreview> {
    if (checksumDataTransfer(input.canonicalJson) !== input.checksumSha256.toLocaleLowerCase()) {
      throw new DataTransferError('IMPORT_CHECKSUM_MISMATCH', 'Import checksum does not match its canonical payload.', 400)
    }
    let parsed: unknown
    try { parsed = JSON.parse(input.canonicalJson) } catch {
      throw new DataTransferError('INVALID_IMPORT', 'Import payload is not valid JSON.', 400)
    }
    const root = object(parsed, 'import')
    if (root.schemaVersion !== 1) throw new DataTransferError('IMPORT_VERSION_UNSUPPORTED', 'Only data schema version 1 is supported.', 409)
    if (typeof root.ownerId !== 'string' || !root.ownerId) throw new DataTransferError('INVALID_IMPORT', 'Import owner identity is missing.', 400)
    const data = normalizeOwnedData(sanitize(root.data))
    const existing = new Set(input.existingIds ?? [])
    const conflicts = everyRecord(data)
      .filter(({ row }) => typeof row.id === 'string' && existing.has(row.id))
      .map(({ collection, row }) => ({ id: String(row.id), collection }))
      .sort((left, right) => left.id.localeCompare(right.id, 'en') || left.collection.localeCompare(right.collection, 'en'))
    const previewBase = {
      status: conflicts.length ? 'conflicts' as const : 'ready' as const,
      counts: countsFor(data),
      conflicts,
      rejectedRecords: [],
      ownerRemap: { source: root.ownerId, target: userId },
    }
    const previewChecksum = checksumDataTransfer(stableDataTransferJson({ payloadChecksum: input.checksumSha256.toLocaleLowerCase(), userId, previewBase }))
    const preview = {
      ...previewBase,
      previewChecksum,
      data,
      dataChecksum: checksumDataTransfer(stableDataTransferJson(data)),
      payloadChecksum: input.checksumSha256.toLocaleLowerCase(),
    }
    this.previews.set(`${userId}\0${previewChecksum}`, preview)
    const { data: _data, dataChecksum: _dataChecksum, payloadChecksum: _payloadChecksum, ...publicPreview } = preview
    return structuredClone(publicPreview)
  }

  async apply(
    userId: string,
    input: { previewChecksum: string; currentPassword: string },
    authorizeCurrentPassword: (password: string) => Promise<boolean>,
    appendAuditInsideTransaction?: (result: { counts: DataTransferCounts; restorePoint: DataTransferRestorePoint }) => Promise<void>,
  ) {
    const preview = this.previews.get(`${userId}\0${input.previewChecksum}`)
    if (!preview) throw new DataTransferError('IMPORT_PREVIEW_STALE', 'Import preview is missing or stale.', 409)
    if (!await authorizeCurrentPassword(input.currentPassword)) {
      throw new DataTransferError('CURRENT_PASSWORD_INVALID', 'Current password is incorrect.', 403)
    }
    const restoreSnapshot = await this.export(userId)
    const restorePoint = await this.port.persistDataTransferRestorePoint(userId, restoreSnapshot)
    if (restorePoint.checksumSha256 !== restoreSnapshot.checksumSha256) {
      throw new DataTransferError('INVALID_IMPORT', 'Import restore point failed checksum verification.', 500)
    }
    await this.port.transaction(userId, async () => {
      const data = normalizeOwnedData(sanitize(structuredClone(preview.data)))
      if (checksumDataTransfer(stableDataTransferJson(data)) !== preview.dataChecksum) {
        throw new DataTransferError('IMPORT_PREVIEW_STALE', 'Import preview data changed after validation.', 409)
      }
      const previewBase = {
        status: preview.status,
        counts: preview.counts,
        conflicts: preview.conflicts,
        rejectedRecords: preview.rejectedRecords,
        ownerRemap: preview.ownerRemap,
      }
      const repeatedChecksum = checksumDataTransfer(stableDataTransferJson({
        payloadChecksum: preview.payloadChecksum,
        userId,
        previewBase,
      }))
      if (repeatedChecksum !== input.previewChecksum) {
        throw new DataTransferError('IMPORT_PREVIEW_STALE', 'Import preview checksum changed after validation.', 409)
      }
      const ownedData = preview.ownerRemap.source === preview.ownerRemap.target ? data : remapOwnedIds(data, this.createId)
      validateRelations(ownedData)
      await this.port.applyOwnedData(userId, ownedData)
      await appendAuditInsideTransaction?.({ counts: structuredClone(preview.counts), restorePoint: structuredClone(restorePoint) })
    })
    this.previews.delete(`${userId}\0${input.previewChecksum}`)
    return { applied: true as const, counts: structuredClone(preview.counts), restorePoint: structuredClone(restorePoint) }
  }
}
