import { createHash } from 'node:crypto'
import { BUILT_IN_UNITS, convertUnit, type CatalogItem, type LifeUnit } from './catalog.js'
import type { InventoryTransaction } from './inventory.js'
import type { MediaAsset } from '../types.js'

export type ShoppingReasonKind = 'planned_shortage' | 'minimum_stock' | 'expiring' | 'manual'
export type ShoppingReasonSourceType = 'day-plan' | 'inventory-policy' | 'inventory-batch' | 'manual'
export type ShoppingItemStatus = 'added' | 'shopping' | 'partial' | 'purchased' | 'deferred' | 'cancelled' | 'archived'

export interface ShoppingReason {
  id: string
  kind: ShoppingReasonKind
  sourceType: ShoppingReasonSourceType
  sourceId: string
  requiredQuantity: number
  sourceQuantity: number
  sourceUnit: string
  conversionFactor: number
  requiredOn: string | null
  createdAt: string
}

export interface ShoppingSuggestion {
  id: string
  kind: 'suggestion'
  origin: 'manual' | 'derived'
  through: string | null
  itemId: string
  requiredQuantity: number
  suggestedQuantity: number
  unit: string
  packageQuantity: number
  reasons: ShoppingReason[]
  createdAt: string
  updatedAt: string
}

export interface InventoryPolicy {
  id: string
  itemId: string
  minimumStock: number
  packageQuantity: number
  unitId: string
  unit: string
  version: number
  createdAt: string
  updatedAt: string
}

export interface UpsertInventoryPolicyInput {
  minimumStock: number
  packageQuantity: number
  unitId: string
  version?: number
}

export interface ShoppingQuantityEvidence {
  sourceType: 'day-plan-item' | 'inventory-batches' | 'shopping-item'
  sourceId?: string
  date?: string
  sourceQuantity: number | null
  sourceUnit: string | null
  policyQuantity: number | null
  conversionFactor: number | null
}

export interface CompleteShoppingRecalculation {
  status: 'complete'
  itemId: string
  policyVersion: number
  unitId: string
  unit: string
  plannedDemand: number
  minimumStock: number
  effectiveStock: number
  outstandingFormalQuantity: number
  packageQuantity: number
  rawShortage: number
  suggestedQuantity: number
  evidence: {
    planned: ShoppingQuantityEvidence[]
    stock: ShoppingQuantityEvidence[]
    outstanding: ShoppingQuantityEvidence[]
  }
}

export interface IncompleteShoppingRecalculation {
  status: 'incomplete'
  itemId: string
  policyVersion: number
  unitId: string
  unit: string
  reason: 'missing_conversion'
  evidence: ShoppingQuantityEvidence[]
}

export interface ShoppingRecalculationResult {
  through: string
  calculations: CompleteShoppingRecalculation[]
  incomplete: IncompleteShoppingRecalculation[]
  suggestions: ShoppingSuggestion[]
}

export interface CreateShoppingSuggestionInput {
  itemId: string
  requiredQuantity: number
  unit: string
  packageQuantity: number
  reason: {
    kind: ShoppingReasonKind
    sourceType: ShoppingReasonSourceType
    sourceId: string
    requiredOn: string | null
  }
}

export interface ShoppingItem {
  id: string
  kind: 'formal'
  itemId: string
  requestedQuantity: number
  purchasedQuantity: number
  remainingQuantity: number
  unit: string
  neededOn: string | null
  priority: 'low' | 'normal' | 'high'
  storeGroup: string
  status: ShoppingItemStatus
  version: number
  createdAt: string
  updatedAt: string
}

export interface CreateShoppingItemInput {
  itemId: string
  requestedQuantity: number
  unit: string
  neededOn?: string | null
  priority?: 'low' | 'normal' | 'high'
  storeGroup?: string
}

export interface PurchaseItemInput {
  shoppingItemId?: string | null
  itemId: string
  quantity: number
  unit: string
  amountMinor: number
  updateCurrentPrice?: boolean
  expiresOn?: string | null
  locationId?: string | null
}

export interface CreatePurchaseInput {
  purchasedAt: string
  currency: string
  storeName?: string
  items: PurchaseItemInput[]
}

export interface PurchaseItem extends PurchaseItemInput {
  id: string
  purchaseId: string
  shoppingItemId: string | null
  updateCurrentPrice: boolean
  inventoryTransactionId: string
}

export interface Purchase {
  id: string
  purchasedAt: string
  currency: string
  storeName: string
  totalAmountMinor: number
  createdAt: string
}

export interface CashExpenditure {
  id: string
  amountMinor: number
  currency: string
  occurredAt: string
  sourceType: 'purchase' | 'refund'
  sourceId: string
  createdAt: string
}

export interface PurchaseResult {
  purchase: Purchase
  items: PurchaseItem[]
  cashExpenditure: CashExpenditure
  inventoryTransactions: InventoryTransaction[]
  shoppingItems: ShoppingItem[]
}

export interface RefundItemInput {
  purchaseItemId: string
  quantity: number
  amountMinor: number
}

export interface CreateRefundInput {
  refundedAt: string
  items: RefundItemInput[]
  note?: string
}

export interface RefundItem extends RefundItemInput {
  id: string
  refundId: string
  purchaseId: string
  itemId: string
  inventoryTransactionId: string
}

export interface Refund {
  id: string
  purchaseId: string
  refundedAt: string
  totalAmountMinor: number
  note: string
  createdAt: string
}

export interface RefundResult {
  refund: Refund
  items: RefundItem[]
  cashExpenditure: CashExpenditure
  inventoryTransactions: InventoryTransaction[]
}

export type BudgetScope =
  | { kind: 'all-life' }
  | { kind: 'item'; itemIds: string[] }
  | { kind: 'category'; categoryIds: string[] }
  | { kind: 'custom'; itemIds: string[]; categoryIds: string[] }

export interface BudgetPeriod {
  kind: 'weekly' | 'monthly' | 'custom'
  startsOn: string
  endsOn: string
}

export interface CreateBudgetInput {
  name: string
  scope: BudgetScope
  period: BudgetPeriod
  limitMinor: number
  thresholds: number[]
  rolloverMinor?: number
}

export interface Budget extends CreateBudgetInput {
  id: string
  rolloverMinor: number
  version: number
  createdAt: string
  updatedAt: string
}

export interface BudgetSummary extends Budget {
  spentMinor: number
  remainingMinor: number
  thresholdStatus: 'ok' | 'warning' | 'critical' | 'exceeded'
  forecast: { status: 'complete'; projectedMinor: number } | { status: 'insufficient-data' }
}

export interface AnalyticsDayValue {
  status: 'recorded' | 'no-record'
  valueMinor?: number
  sourceIds?: string[]
}

export type AnalyticsPlanExecution =
  | { status: 'no-record' }
  | {
      status: 'recorded'
      plannedCount: number
      actualCount: number
      incompleteCount: number
      sourceIds: string[]
    }

export interface LifeAnalytics {
  from: string
  to: string
  days: Array<{ date: string; cashExpenditure: AnalyticsDayValue; consumptionCost: AnalyticsDayValue; planExecution: AnalyticsPlanExecution }>
  totals: { cashExpenditureMinor: number; consumptionCostMinor: number; plannedCount: number; actualCount: number; incompleteCount: number }
  drillDown: {
    cashExpenditure: Array<{ sourceType: 'purchase' | 'refund'; sourceId: string; amountMinor: number; occurredAt: string }>
    consumptionCost: Array<{ sourceType: 'completion'; sourceId: string; amountMinor: number; occurredAt: string }>
  }
}

export interface PortablePayload {
  catalogItems: Array<CatalogItem | Record<string, unknown>>
  inventoryPolicies?: InventoryPolicy[]
  shoppingItems: ShoppingItem[]
  purchases: Purchase[]
  purchaseItems?: PurchaseItem[]
  refunds: Refund[]
  refundItems?: RefundItem[]
  budgets: Budget[]
  mediaAssets?: PortableMediaAsset[]
  [key: string]: unknown
}

export interface PortableMediaAsset extends Omit<MediaAsset, 'storageKey' | 'deletedAt'> {
  archiveEntry: string
  bytesBase64: string
}

export interface ExportJob {
  id: string
  status: 'completed'
  reason: 'user-export' | 'pre-import-restore-point'
  format: 'json' | 'zip'
  formatVersion: 1
  checksumSha256: string
  recordCounts: Record<string, number>
  payload?: PortablePayload
  canonicalJson?: string
  archiveBase64?: string
  archiveEntries?: string[]
  createdAt: string
}

export interface ImportConflict {
  entityType: string
  entityId: string
  currentVersion: number
  incomingVersion: number
  resolutions: Array<'keep-current' | 'use-imported' | 'duplicate'>
}

export interface ImportValidationError {
  entityType: string
  entityId: string
  code: string
  message: string
}

export interface ImportPreview {
  id: string
  mode: 'merge' | 'replace'
  status: 'ready' | 'conflicts' | 'invalid' | 'applied'
  payload: PortablePayload
  conflicts: ImportConflict[]
  errors: ImportValidationError[]
  createdAt: string
}

export class LifeCommerceDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'LifeCommerceDomainError'
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const round = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000

export function cleanText(value: string, field: string, allowEmpty = false) {
  const result = value.trim()
  if (!allowEmpty && !result) throw new LifeCommerceDomainError('INVALID_INPUT', `${field} cannot be empty.`, 400)
  return result
}

export function positive(value: number, field: string) {
  if (!Number.isFinite(value) || value <= 0) throw new LifeCommerceDomainError('INVALID_INPUT', `${field} must be greater than zero.`, 400)
  return value
}

export function nonNegative(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) throw new LifeCommerceDomainError('INVALID_INPUT', `${field} cannot be negative.`, 400)
  return value
}

export function validDate(value: string, field: string) {
  if (!DATE_ONLY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new LifeCommerceDomainError('INVALID_DATE', `${field} must be a valid date-only value.`, 400)
  }
  return value
}

export function validTimestamp(value: string, field: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) throw new LifeCommerceDomainError('INVALID_TIMESTAMP', `${field} must be an ISO timestamp.`, 400)
  return new Date(timestamp).toISOString()
}

export function validateShoppingReasonSource(reason: CreateShoppingSuggestionInput['reason']) {
  const expected: Record<ShoppingReasonKind, ShoppingReasonSourceType> = {
    planned_shortage: 'day-plan',
    minimum_stock: 'inventory-policy',
    expiring: 'inventory-batch',
    manual: 'manual',
  }
  if (reason.sourceType !== expected[reason.kind]) {
    throw new LifeCommerceDomainError(
      'INVALID_SHOPPING_REASON_SOURCE',
      `Shopping reason ${reason.kind} must use source type ${expected[reason.kind]}.`,
      400,
    )
  }
}

export function normalizeCommerceIdempotencyKey(value: string) {
  const result = value.trim()
  if (!result || result.length > 190) throw new LifeCommerceDomainError('INVALID_IDEMPOTENCY_KEY', 'A valid idempotency key is required.', 400)
  return result
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, item]) => `${JSON.stringify(name)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function requestHash(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex').toUpperCase()
}

export function checksumSha256(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

const MEDIA_EXTENSIONS: Record<MediaAsset['mimeType'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export function buildPortableMediaAsset(asset: MediaAsset, bytes: Uint8Array): PortableMediaAsset {
  const actualChecksum = checksumSha256(bytes).toUpperCase()
  if (bytes.byteLength !== asset.sizeBytes || actualChecksum !== asset.checksum.toUpperCase()) {
    throw new LifeCommerceDomainError(
      'ATTACHMENT_CONTENT_MISMATCH',
      `Attachment ${asset.id} does not match its stored size and checksum metadata.`,
      409,
    )
  }
  const { storageKey: _storageKey, deletedAt: _deletedAt, ...portable } = asset
  return {
    ...portable,
    archiveEntry: `attachments/${asset.id}.${MEDIA_EXTENSIONS[asset.mimeType]}`,
    bytesBase64: Buffer.from(bytes).toString('base64'),
  }
}

function crc32(value: Uint8Array) {
  let crc = 0xFFFFFFFF
  for (const byte of value) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

export function createStoredZip(entries: Array<{ name: string; contents: string | Uint8Array }>) {
  const encoder = new TextEncoder()
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(encoder.encode(entry.name))
    const contents = Buffer.from(typeof entry.contents === 'string' ? encoder.encode(entry.contents) : entry.contents)
    const checksum = crc32(contents)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(contents.length, 18)
    local.writeUInt32LE(contents.length, 22)
    local.writeUInt16LE(name.length, 26)
    localParts.push(local, name, contents)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014B50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(contents.length, 20)
    central.writeUInt32LE(contents.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += local.length + name.length + contents.length
  }
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, ...centralParts, end])
}

export function readStoredZip(archive: Uint8Array, limits: { maxEntries?: number; maxEntryBytes?: number; maxTotalBytes?: number } = {}) {
  const bytes = Buffer.from(archive)
  const maxEntries = limits.maxEntries ?? 1_000
  const maxEntryBytes = limits.maxEntryBytes ?? 10_000_000
  const maxTotalBytes = limits.maxTotalBytes ?? 256 * 1024 * 1024
  const entries = new Map<string, Buffer>()
  let totalBytes = 0
  let offset = 0
  while (offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034B50) {
    if (entries.size >= maxEntries || offset + 30 > bytes.length) throw new LifeCommerceDomainError('INVALID_IMPORT_ARCHIVE', 'Import ZIP exceeds its safe entry limit.', 400)
    const flags = bytes.readUInt16LE(offset + 6)
    const method = bytes.readUInt16LE(offset + 8)
    const expectedCrc = bytes.readUInt32LE(offset + 14)
    const compressedSize = bytes.readUInt32LE(offset + 18)
    const uncompressedSize = bytes.readUInt32LE(offset + 22)
    const nameLength = bytes.readUInt16LE(offset + 26)
    const extraLength = bytes.readUInt16LE(offset + 28)
    if ((flags & 0x0008) !== 0 || method !== 0 || compressedSize !== uncompressedSize || uncompressedSize > maxEntryBytes) {
      throw new LifeCommerceDomainError('INVALID_IMPORT_ARCHIVE', 'Import ZIP must use bounded stored entries without data descriptors.', 400)
    }
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > bytes.length) throw new LifeCommerceDomainError('INVALID_IMPORT_ARCHIVE', 'Import ZIP is truncated.', 400)
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString('utf8')
    const safeRootEntry = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name)
    const safeAttachmentEntry = /^attachments\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(?:jpg|png|webp|gif)$/.test(name)
    totalBytes += uncompressedSize
    if ((!safeRootEntry && !safeAttachmentEntry) || entries.has(name) || totalBytes > maxTotalBytes) {
      throw new LifeCommerceDomainError('INVALID_IMPORT_ARCHIVE', 'Import ZIP contains an unsafe or duplicate entry name.', 400)
    }
    const contents = bytes.subarray(dataStart, dataEnd)
    if (crc32(contents) !== expectedCrc) throw new LifeCommerceDomainError('IMPORT_CHECKSUM_MISMATCH', `ZIP entry ${name} failed CRC validation.`, 400)
    entries.set(name, Buffer.from(contents))
    offset = dataEnd
  }
  if (entries.size === 0 || offset + 4 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014B50) {
    throw new LifeCommerceDomainError('INVALID_IMPORT_ARCHIVE', 'Import ZIP has no valid central directory.', 400)
  }
  return entries
}

export function portableJsonFromArchive(archive: Uint8Array, expectedFormatVersion: number) {
  const entries = readStoredZip(archive)
  if (!entries.has('manifest.json') || !entries.has('lifeops.json')) throw new LifeCommerceDomainError('INVALID_IMPORT_ARCHIVE', 'Import ZIP must contain manifest.json and lifeops.json.', 400)
  let manifest: unknown
  try { manifest = JSON.parse(entries.get('manifest.json')!.toString('utf8')) } catch {
    throw new LifeCommerceDomainError('INVALID_IMPORT_ARCHIVE', 'Import ZIP manifest is not valid JSON.', 400)
  }
  const record = manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest as Record<string, unknown> : undefined
  const canonicalJson = entries.get('lifeops.json')!.toString('utf8')
  if (!record || record.formatVersion !== expectedFormatVersion || record.payloadChecksumSha256 !== checksumSha256(canonicalJson)) {
    throw new LifeCommerceDomainError('IMPORT_CHECKSUM_MISMATCH', 'Import ZIP manifest does not match its portable payload.', 400)
  }
  const manifestAttachments = Array.isArray(record.attachments) ? record.attachments : []
  const expectedEntries = new Set(['manifest.json', 'lifeops.json'])
  for (const raw of manifestAttachments) {
    const attachment = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
    if (!attachment || typeof attachment.id !== 'string' || typeof attachment.entry !== 'string'
      || typeof attachment.checksumSha256 !== 'string' || typeof attachment.sizeBytes !== 'number') {
      throw new LifeCommerceDomainError('INVALID_IMPORT_ARCHIVE', 'Import ZIP attachment manifest is invalid.', 400)
    }
    const contents = entries.get(attachment.entry)
    if (!contents || contents.byteLength !== attachment.sizeBytes
      || checksumSha256(contents).toUpperCase() !== attachment.checksumSha256.toUpperCase()) {
      throw new LifeCommerceDomainError('IMPORT_CHECKSUM_MISMATCH', `Attachment ${attachment.id} failed archive validation.`, 400)
    }
    expectedEntries.add(attachment.entry)
  }
  if (entries.size !== expectedEntries.size || [...entries.keys()].some((name) => !expectedEntries.has(name))) {
    throw new LifeCommerceDomainError('INVALID_IMPORT_ARCHIVE', 'Import ZIP contains undeclared attachment entries.', 400)
  }
  let payload: unknown
  try { payload = JSON.parse(canonicalJson) } catch {
    throw new LifeCommerceDomainError('INVALID_IMPORT', 'Import payload is not valid JSON.', 400)
  }
  const mediaAssets = payload && typeof payload === 'object' && !Array.isArray(payload)
    && Array.isArray((payload as Record<string, unknown>).mediaAssets)
    ? (payload as { mediaAssets: unknown[] }).mediaAssets : []
  if (mediaAssets.length !== manifestAttachments.length || mediaAssets.some((raw) => {
    const asset = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
    const declared = asset && manifestAttachments.find((candidate) => candidate && typeof candidate === 'object'
      && (candidate as Record<string, unknown>).id === asset.id) as Record<string, unknown> | undefined
    return !asset || !declared || asset.archiveEntry !== declared.entry || asset.checksum !== declared.checksumSha256
      || asset.sizeBytes !== declared.sizeBytes || typeof asset.bytesBase64 !== 'string'
      || checksumSha256(Buffer.from(asset.bytesBase64, 'base64')).toUpperCase() !== String(asset.checksum).toUpperCase()
  })) throw new LifeCommerceDomainError('IMPORT_CHECKSUM_MISMATCH', 'Import ZIP attachment metadata does not match its manifest.', 400)
  return canonicalJson
}

export function buildSuggestion(
  current: ShoppingSuggestion | undefined,
  input: CreateShoppingSuggestionInput,
  identity: { suggestionId: string; reasonId: string; timestamp: string },
  outstandingQuantity: number,
): ShoppingSuggestion {
  validateShoppingReasonSource(input.reason)
  const itemId = cleanText(input.itemId, 'itemId')
  const unit = cleanText(input.unit, 'unit').toLocaleLowerCase()
  const packageQuantity = positive(input.packageQuantity, 'packageQuantity')
  const requiredQuantity = positive(input.requiredQuantity, 'requiredQuantity')
  const reasonKey = `${input.reason.sourceType}\0${cleanText(input.reason.sourceId, 'reason.sourceId')}`
  const existingReasons = current?.reasons ?? []
  const reasons = existingReasons.some((reason) => `${reason.sourceType}\0${reason.sourceId}` === reasonKey)
    ? existingReasons
    : [...existingReasons, {
      id: identity.reasonId,
      kind: input.reason.kind,
      sourceType: input.reason.sourceType,
      sourceId: cleanText(input.reason.sourceId, 'reason.sourceId'),
      requiredQuantity,
      sourceQuantity: requiredQuantity,
      sourceUnit: unit,
      conversionFactor: 1,
      requiredOn: input.reason.requiredOn == null ? null : validDate(input.reason.requiredOn, 'reason.requiredOn'),
      createdAt: identity.timestamp,
    }]
  if (current && (current.itemId !== itemId || current.unit !== unit || current.packageQuantity !== packageQuantity)) {
    throw new LifeCommerceDomainError('SUGGESTION_FACT_CONFLICT', 'Suggestion facts for one item must use one unit and package quantity.', 409)
  }
  const totalRequired = round(reasons.reduce((total, reason) => total + reason.requiredQuantity, 0))
  const raw = Math.max(0, totalRequired - nonNegative(outstandingQuantity, 'outstandingQuantity'))
  return {
    id: current?.id ?? identity.suggestionId,
    kind: 'suggestion',
    origin: 'manual',
    through: null,
    itemId,
    requiredQuantity: totalRequired,
    suggestedQuantity: round(Math.ceil(raw / packageQuantity) * packageQuantity),
    unit,
    packageQuantity,
    reasons,
    createdAt: current?.createdAt ?? identity.timestamp,
    updatedAt: identity.timestamp,
  }
}

export function validateBudgetInput(input: CreateBudgetInput) {
  cleanText(input.name, 'name')
  nonNegative(input.limitMinor, 'limitMinor')
  nonNegative(input.rolloverMinor ?? 0, 'rolloverMinor')
  validDate(input.period.startsOn, 'period.startsOn')
  validDate(input.period.endsOn, 'period.endsOn')
  if (input.period.endsOn < input.period.startsOn) throw new LifeCommerceDomainError('INVALID_PERIOD', 'Budget end cannot precede its start.', 400)
  if (!input.thresholds.length || input.thresholds.some((value) => !Number.isFinite(value) || value <= 0) || input.thresholds.some((value, index) => index > 0 && value <= input.thresholds[index - 1]!)) {
    throw new LifeCommerceDomainError('INVALID_THRESHOLDS', 'Budget thresholds must be positive and strictly increasing.', 400)
  }
  const validIds = (values: string[]) => values.length > 0
    && values.every((value) => typeof value === 'string' && value.trim().length > 0)
    && new Set(values).size === values.length
  if (input.scope.kind === 'item' && !validIds(input.scope.itemIds)) {
    throw new LifeCommerceDomainError('INVALID_BUDGET_SCOPE', 'An item budget requires unique item IDs.', 400)
  }
  if (input.scope.kind === 'category' && !validIds(input.scope.categoryIds)) {
    throw new LifeCommerceDomainError('INVALID_BUDGET_SCOPE', 'A category budget requires unique category IDs.', 400)
  }
  if (input.scope.kind === 'custom') {
    const { itemIds, categoryIds } = input.scope
    if ((!itemIds.length && !categoryIds.length)
      || (itemIds.length > 0 && !validIds(itemIds))
      || (categoryIds.length > 0 && !validIds(categoryIds))) {
      throw new LifeCommerceDomainError('INVALID_BUDGET_SCOPE', 'A custom budget requires unique item or category IDs.', 400)
    }
  }
}

export function budgetScopeMatchesItemIds(
  scope: BudgetScope,
  itemIds: string[],
  catalog: Array<{ id: string; categoryId: string | null }>,
) {
  if (scope.kind === 'all-life') return true
  const uniqueItemIds = new Set(itemIds)
  if (scope.kind === 'item') return scope.itemIds.some((id) => uniqueItemIds.has(id))
  const categories = new Set(catalog
    .filter((item) => uniqueItemIds.has(item.id) && item.categoryId != null)
    .map((item) => item.categoryId!))
  if (scope.kind === 'category') return scope.categoryIds.some((id) => categories.has(id))
  return scope.itemIds.some((id) => uniqueItemIds.has(id))
    || scope.categoryIds.some((id) => categories.has(id))
}

export function summarizeBudget(budget: Budget, expenditures: CashExpenditure[], asOf: string): BudgetSummary {
  validDate(asOf, 'asOf')
  const relevant = expenditures.filter((entry) => {
    const day = entry.occurredAt.slice(0, 10)
    return day >= budget.period.startsOn && day <= budget.period.endsOn && day <= asOf
  })
  const spentMinor = relevant.reduce((total, entry) => total + entry.amountMinor, 0)
  const available = budget.limitMinor + budget.rolloverMinor
  const ratio = available === 0 ? (spentMinor > 0 ? Number.POSITIVE_INFINITY : 0) : spentMinor / available
  const crossed = budget.thresholds.filter((threshold) => ratio >= threshold).length
  const thresholdStatus = ratio > 1
    ? 'exceeded'
    : crossed >= 3
      ? 'critical'
      : crossed >= 1
        ? 'warning'
        : 'ok'
  const recordedDays = new Set(relevant.map((entry) => entry.occurredAt.slice(0, 10))).size
  const elapsedDays = Math.max(1, Math.floor((Date.parse(`${asOf}T00:00:00.000Z`) - Date.parse(`${budget.period.startsOn}T00:00:00.000Z`)) / 86_400_000) + 1)
  const periodDays = Math.floor((Date.parse(`${budget.period.endsOn}T00:00:00.000Z`) - Date.parse(`${budget.period.startsOn}T00:00:00.000Z`)) / 86_400_000) + 1
  return {
    ...budget,
    spentMinor,
    remainingMinor: available - spentMinor,
    thresholdStatus,
    forecast: recordedDays >= 3
      ? { status: 'complete', projectedMinor: Math.round(spentMinor / elapsedDays * periodDays) }
      : { status: 'insufficient-data' },
  }
}

export function datesBetween(from: string, to: string) {
  validDate(from, 'from')
  validDate(to, 'to')
  if (to < from) throw new LifeCommerceDomainError('INVALID_RANGE', 'to cannot precede from.', 400)
  const result: string[] = []
  for (let cursor = Date.parse(`${from}T00:00:00.000Z`), end = Date.parse(`${to}T00:00:00.000Z`); cursor <= end; cursor += 86_400_000) {
    result.push(new Date(cursor).toISOString().slice(0, 10))
  }
  if (result.length > 3_660) throw new LifeCommerceDomainError('RANGE_TOO_LARGE', 'Analytics ranges cannot exceed 3,660 days.', 400)
  return result
}

export function validatePortablePayload(value: unknown): PortablePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LifeCommerceDomainError('INVALID_IMPORT', 'Import payload must be an object.', 400)
  const payload = value as Record<string, unknown>
  for (const key of ['catalogItems', 'shoppingItems', 'purchases', 'refunds', 'budgets']) {
    if (!Array.isArray(payload[key])) throw new LifeCommerceDomainError('INVALID_IMPORT', `${key} must be an array.`, 400)
  }
  for (const key of [
    'catalogTaxonomy', 'lifeUnits', 'inventoryPolicies', 'shoppingSuggestions', 'purchaseItems', 'refundItems', 'cashExpenditures',
    'inventoryBatches', 'inventoryTransactions', 'recipes', 'recipeVersions', 'cookingSessions', 'cookingCompletions',
    'preparedFood', 'planTemplates', 'dayPlans', 'fitnessActivities', 'medicineRecurrenceRules', 'medicineOccurrences',
    'completionSnapshots', 'completionReversals', 'completionPreparedFoodEvents', 'templateApplications',
    'mediaAssets',
  ]) {
    if (payload[key] !== undefined && !Array.isArray(payload[key])) {
      throw new LifeCommerceDomainError('INVALID_IMPORT', `${key} must be an array when present.`, 400)
    }
  }
  return structuredClone(payload) as PortablePayload
}

export function validatePortablePayloadRelationships(
  payload: PortablePayload,
  mode: 'merge' | 'replace',
): ImportValidationError[] {
  const errors: ImportValidationError[] = []
  const rowsFor = (key: string) => (Array.isArray(payload[key]) ? payload[key] : []) as Array<Record<string, unknown>>
  const entityNames: Record<string, string> = {
    catalogItems: 'catalog-item', inventoryPolicies: 'inventory-policy', shoppingSuggestions: 'shopping-suggestion', shoppingItems: 'shopping-item',
    inventoryBatches: 'inventory-batch', inventoryTransactions: 'inventory-transaction',
    purchases: 'purchase', purchaseItems: 'purchase-item', refunds: 'refund', refundItems: 'refund-item',
    cashExpenditures: 'cash-expenditure', budgets: 'budget', medicineRecurrenceRules: 'medicine-recurrence-rule',
    medicineOccurrences: 'medicine-occurrence', completionSnapshots: 'completion-snapshot',
    completionReversals: 'completion-reversal', completionPreparedFoodEvents: 'completion-prepared-food-event',
    recipeVersions: 'recipe-version', recipes: 'recipe', cookingSessions: 'cooking-session', cookingCompletions: 'cooking-completion',
    preparedFood: 'prepared-food', planTemplates: 'plan-template', dayPlans: 'day-plan', fitnessActivities: 'fitness-activity',
    templateApplications: 'template-application', catalogTaxonomy: 'catalog-taxonomy', lifeUnits: 'life-unit',
    mediaAssets: 'media-asset',
  }
  const invalidRow = (key: string, row: Record<string, unknown>, message: string) => errors.push({
    entityType: entityNames[key] ?? key,
    entityId: typeof row.id === 'string' ? row.id : typeof row.completionId === 'string' ? row.completionId : 'unknown',
    code: 'IMPORT_ROW_INVALID',
    message,
  })
  const stringField = (row: Record<string, unknown>, field: string) => typeof row[field] === 'string' && String(row[field]).trim().length > 0
  const arrayField = (row: Record<string, unknown>, field: string) => Array.isArray(row[field])
  const numberField = (row: Record<string, unknown>, field: string) => typeof row[field] === 'number' && Number.isFinite(row[field])
  const objectField = (row: Record<string, unknown>, field: string) => Boolean(row[field]) && typeof row[field] === 'object' && !Array.isArray(row[field])
  for (const [key, value] of Object.entries(payload)) {
    if (!Array.isArray(value)) continue
    for (const raw of value) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        invalidRow(key, {}, `${key} rows must be objects.`)
        continue
      }
      const row = raw as Record<string, unknown>
      const identityField = ['completionReversals', 'completionPreparedFoodEvents'].includes(key) ? 'completionId' : 'id'
      if (!stringField(row, identityField)) {
        invalidRow(key, row, `${key}.${identityField} must be a non-empty string.`)
        continue
      }
      const valid = (() => {
        switch (key) {
          case 'catalogTaxonomy': return stringField(row,'kind') && stringField(row,'name') && numberField(row,'version')
          case 'lifeUnits': return stringField(row,'code') && stringField(row,'name') && stringField(row,'symbol')
            && stringField(row,'dimension') && stringField(row,'baseCode') && numberField(row,'version')
          case 'catalogItems': return stringField(row,'kind') && stringField(row,'name') && stringField(row,'baseUnit')
            && arrayField(row,'availableUnits')
          case 'inventoryPolicies': return stringField(row,'itemId') && stringField(row,'unitId') && stringField(row,'unit')
            && numberField(row,'minimumStock') && Number(row.minimumStock) >= 0
            && numberField(row,'packageQuantity') && Number(row.packageQuantity) > 0
            && numberField(row,'version') && Number(row.version) >= 1
          case 'shoppingSuggestions': {
            const originValid = row.origin === 'manual' || row.origin === 'derived'
            const throughValid = row.origin === 'manual' ? row.through == null
              : typeof row.through === 'string' && DATE_ONLY.test(row.through)
            const reasonsValid = arrayField(row,'reasons') && (row.reasons as unknown[]).every((rawReason) => {
              if (!rawReason || typeof rawReason !== 'object' || Array.isArray(rawReason)) return false
              const reason = rawReason as Record<string, unknown>
              return stringField(reason,'id') && stringField(reason,'kind') && stringField(reason,'sourceType')
                && stringField(reason,'sourceId') && numberField(reason,'requiredQuantity') && Number(reason.requiredQuantity) > 0
                && numberField(reason,'sourceQuantity') && Number(reason.sourceQuantity) >= 0
                && stringField(reason,'sourceUnit') && numberField(reason,'conversionFactor') && Number(reason.conversionFactor) > 0
            })
            return row.kind === 'suggestion' && originValid && throughValid && stringField(row,'itemId') && stringField(row,'unit')
              && numberField(row,'requiredQuantity') && Number(row.requiredQuantity) > 0
              && numberField(row,'suggestedQuantity') && Number(row.suggestedQuantity) >= 0
              && numberField(row,'packageQuantity') && Number(row.packageQuantity) > 0 && reasonsValid
          }
          case 'shoppingItems': return stringField(row,'itemId') && stringField(row,'unit')
            && numberField(row,'requestedQuantity') && numberField(row,'purchasedQuantity') && stringField(row,'status')
          case 'purchases': return stringField(row,'purchasedAt') && stringField(row,'currency') && numberField(row,'totalAmountMinor')
          case 'purchaseItems': return stringField(row,'purchaseId') && stringField(row,'itemId')
            && stringField(row,'inventoryTransactionId') && numberField(row,'quantity') && numberField(row,'amountMinor')
          case 'refunds': return stringField(row,'purchaseId') && stringField(row,'refundedAt') && numberField(row,'totalAmountMinor')
          case 'refundItems': return stringField(row,'refundId') && stringField(row,'purchaseId')
            && stringField(row,'purchaseItemId') && stringField(row,'itemId') && stringField(row,'inventoryTransactionId')
            && numberField(row,'quantity') && numberField(row,'amountMinor')
          case 'cashExpenditures': return numberField(row,'amountMinor') && stringField(row,'currency')
            && stringField(row,'occurredAt') && stringField(row,'sourceType') && stringField(row,'sourceId')
          case 'inventoryBatches': return stringField(row,'itemId') && stringField(row,'baseUnit')
            && numberField(row,'originalQuantity') && numberField(row,'remainingQuantity')
          case 'inventoryTransactions': return stringField(row,'itemId') && stringField(row,'kind') && stringField(row,'unit')
            && numberField(row,'baseQuantity') && numberField(row,'deltaBaseQuantity') && arrayField(row,'allocations')
          case 'recipes': return stringField(row,'name') && objectField(row,'currentVersion') && arrayField(row,'tagIds')
          case 'recipeVersions': return stringField(row,'recipeId') && numberField(row,'number') && numberField(row,'servings')
            && arrayField(row,'components') && arrayField(row,'steps')
          case 'cookingSessions': return stringField(row,'recipeId') && stringField(row,'recipeVersionId')
            && numberField(row,'plannedServings') && objectField(row,'progress') && stringField(row,'status')
          case 'cookingCompletions': return stringField(row,'cookingSessionId') && stringField(row,'recipeId')
            && stringField(row,'recipeVersionId') && numberField(row,'madeServings') && numberField(row,'eatenServings')
            && arrayField(row,'ingredients')
          case 'preparedFood': return stringField(row,'cookingSnapshotId') && stringField(row,'recipeId')
            && stringField(row,'recipeVersionId') && numberField(row,'portionsCreated') && numberField(row,'portionsRemaining')
          case 'planTemplates': return stringField(row,'name') && arrayField(row,'mealSlots') && arrayField(row,'items')
            && numberField(row,'entityVersion')
          case 'dayPlans': return stringField(row,'date') && arrayField(row,'mealSlots') && arrayField(row,'items')
            && numberField(row,'entityVersion')
          case 'fitnessActivities': return stringField(row,'name') && numberField(row,'defaultMinutes')
            && numberField(row,'kcalPerHour') && arrayField(row,'steps') && arrayField(row,'equipment')
          case 'medicineRecurrenceRules': return stringField(row,'title') && stringField(row,'sourceId')
            && numberField(row,'quantity') && stringField(row,'unit') && objectField(row,'recurrence')
          case 'medicineOccurrences': return stringField(row,'ruleId') && objectField(row,'source')
            && stringField(row,'scheduledDate') && stringField(row,'scheduledTime') && stringField(row,'status')
          case 'completionSnapshots': return objectField(row,'completionSource') && stringField(row,'kind')
            && stringField(row,'completedAt') && arrayField(row,'inventoryTransactionIds')
          case 'completionReversals': return arrayField(row,'reversedInventoryTransactionIds')
          case 'completionPreparedFoodEvents': return arrayField(row,'events')
          case 'templateApplications': return stringField(row,'templateId') && stringField(row,'dayPlanId')
            && numberField(row,'appliedVersion') && stringField(row,'appliedAt')
          case 'mediaAssets': return stringField(row,'mimeType') && stringField(row,'originalName') && numberField(row,'sizeBytes')
            && stringField(row,'checksum') && stringField(row,'archiveEntry') && stringField(row,'bytesBase64')
            && Buffer.from(String(row.bytesBase64),'base64').byteLength === Number(row.sizeBytes)
            && checksumSha256(Buffer.from(String(row.bytesBase64),'base64')).toUpperCase() === String(row.checksum).toUpperCase()
          default: return true
        }
      })()
      if (!valid) invalidRow(key, row, `${key} contains missing or invalid required fields.`)
    }
  }
  const ids = new Map<string, Set<string>>()
  for (const [key, value] of Object.entries(payload)) {
    if (!Array.isArray(value)) continue
    const found = new Set<string>()
    for (const raw of value) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const id = (raw as Record<string, unknown>).id
      if (typeof id !== 'string' || !id.trim()) continue
      if (found.has(id)) {
        errors.push({
          entityType: entityNames[key] ?? key,
          entityId: id,
          code: 'IMPORT_DUPLICATE_ID',
          message: `${key} contains duplicate id ${id}.`,
        })
      }
      found.add(id)
    }
    ids.set(key, found)
  }
  if (mode !== 'replace') {
    for (const [key, value] of Object.entries(payload)) {
      if (!Array.isArray(value) || value.length === 0 || ['catalogItems', 'budgets'].includes(key)) continue
      for (const row of value) {
        const entityId = row && typeof row === 'object' && !Array.isArray(row) && typeof (row as Record<string, unknown>).id === 'string'
          ? String((row as Record<string, unknown>).id)
          : 'unknown'
        errors.push({
          entityType: entityNames[key] ?? key,
          entityId,
          code: 'IMPORT_MODE_REQUIRES_REPLACE',
          message: `${key} contains linked history and must be restored with replace mode.`,
        })
      }
    }
    return errors
  }

  const requireReference = (
    sourceKey: string,
    field: string,
    targetKey: string,
    targetLabel: string,
    condition: (row: Record<string, unknown>) => boolean = () => true,
    nullable = false,
  ) => {
    const targetIds = ids.get(targetKey) ?? new Set<string>()
    for (const row of rowsFor(sourceKey)) {
      if (!condition(row)) continue
      const reference = row[field]
      if (reference == null && nullable) continue
      if (typeof reference !== 'string' || !targetIds.has(reference)) {
        const entityId = typeof row.id === 'string' ? row.id : 'unknown'
        errors.push({
          entityType: entityNames[sourceKey] ?? sourceKey,
          entityId,
          code: 'IMPORT_RELATION_MISSING',
          message: `${sourceKey}.${field} references missing ${targetLabel} ${String(reference)}.`,
        })
      }
    }
  }

  for (const sourceKey of ['inventoryPolicies', 'shoppingSuggestions', 'shoppingItems', 'inventoryBatches', 'inventoryTransactions', 'purchaseItems', 'refundItems']) {
    requireReference(sourceKey, 'itemId', 'catalogItems', 'catalog item')
  }
  const portableUnits = rowsFor('lifeUnits').filter((row) => stringField(row,'id') && stringField(row,'code')
    && stringField(row,'dimension') && stringField(row,'baseCode') && numberField(row,'toBaseFactor')) as unknown as LifeUnit[]
  const allUnits = [...BUILT_IN_UNITS, ...portableUnits]
  const unitsById = new Map(allUnits.map((unit) => [unit.id,unit]))
  const catalogById = new Map(rowsFor('catalogItems').filter((row) => typeof row.id === 'string')
    .map((row) => [String(row.id),row]))
  for (const policy of rowsFor('inventoryPolicies')) {
    const unit = typeof policy.unitId === 'string' ? unitsById.get(policy.unitId) : undefined
    if (!unit) {
      errors.push({
        entityType: 'inventory-policy', entityId: typeof policy.id === 'string' ? policy.id : 'unknown',
        code: 'IMPORT_RELATION_MISSING',
        message: `inventoryPolicies.unitId references missing life unit ${String(policy.unitId)}.`,
      })
      continue
    }
    const item = typeof policy.itemId === 'string' ? catalogById.get(policy.itemId) : undefined
    if (!item || typeof item.baseUnit !== 'string') continue
    const converted = convertUnit({
      itemId: String(item.id), quantity: 1, fromUnit: unit.code, toBaseUnit: item.baseUnit,
      itemConversions: (Array.isArray(item.itemConversions) ? item.itemConversions : []) as CatalogItem['itemConversions'],
      units: allUnits,
    })
    if (policy.unit !== unit.code || converted.status === 'incomplete') {
      errors.push({
        entityType: 'inventory-policy', entityId: typeof policy.id === 'string' ? policy.id : 'unknown',
        code: 'IMPORT_POLICY_UNIT_INCOMPATIBLE',
        message: `inventoryPolicies.unitId is not compatible with catalog item ${String(policy.itemId)}.`,
      })
    }
  }
  requireReference('purchaseItems', 'purchaseId', 'purchases', 'purchase')
  requireReference('purchaseItems', 'shoppingItemId', 'shoppingItems', 'shopping item', () => true, true)
  requireReference('purchaseItems', 'inventoryTransactionId', 'inventoryTransactions', 'inventory transaction')
  requireReference('refunds', 'purchaseId', 'purchases', 'purchase')
  requireReference('refundItems', 'refundId', 'refunds', 'refund')
  requireReference('refundItems', 'purchaseId', 'purchases', 'purchase')
  requireReference('refundItems', 'purchaseItemId', 'purchaseItems', 'purchase item')
  requireReference('refundItems', 'inventoryTransactionId', 'inventoryTransactions', 'inventory transaction')
  requireReference('inventoryTransactions', 'batchId', 'inventoryBatches', 'inventory batch', () => true, true)
  requireReference('inventoryTransactions', 'reversesTransactionId', 'inventoryTransactions', 'inventory transaction', () => true, true)
  requireReference('inventoryTransactions', 'reversedByTransactionId', 'inventoryTransactions', 'inventory transaction', () => true, true)
  requireReference('medicineOccurrences', 'ruleId', 'medicineRecurrenceRules', 'medicine recurrence rule')
  requireReference('completionReversals', 'completionId', 'completionSnapshots', 'completion snapshot')
  requireReference('completionPreparedFoodEvents', 'completionId', 'completionSnapshots', 'completion snapshot')
  requireReference('cashExpenditures', 'sourceId', 'purchases', 'purchase', (row) => row.sourceType === 'purchase')
  requireReference('cashExpenditures', 'sourceId', 'refunds', 'refund', (row) => row.sourceType === 'refund')

  const rowIdentity = (row: Record<string, unknown>) => typeof row.id === 'string'
    ? row.id
    : typeof row.completionId === 'string'
      ? row.completionId
      : 'unknown'
  const missingRelation = (
    sourceKey: string,
    row: Record<string, unknown>,
    path: string,
    reference: unknown,
    targetLabel: string,
  ) => errors.push({
    entityType: entityNames[sourceKey] ?? sourceKey,
    entityId: rowIdentity(row),
    code: 'IMPORT_RELATION_MISSING',
    message: `${path} references missing ${targetLabel} ${String(reference)}.`,
  })
  const requireValue = (
    sourceKey: string,
    row: Record<string, unknown>,
    path: string,
    reference: unknown,
    targets: Set<string>,
    targetLabel: string,
    nullable = false,
  ) => {
    if (reference == null && nullable) return
    if (typeof reference !== 'string' || !targets.has(reference)) {
      missingRelation(sourceKey,row,path,reference,targetLabel)
    }
  }
  const requireArrayValues = (
    sourceKey: string,
    row: Record<string, unknown>,
    path: string,
    references: unknown,
    targets: Set<string>,
    targetLabel: string,
  ) => {
    if (!Array.isArray(references)) return
    for (const reference of references) requireValue(sourceKey,row,path,reference,targets,targetLabel)
  }

  const taxonomyByKind = new Map<string, Set<string>>()
  for (const row of rowsFor('catalogTaxonomy')) {
    if (typeof row.id !== 'string' || typeof row.kind !== 'string') continue
    const found = taxonomyByKind.get(row.kind) ?? new Set<string>()
    found.add(row.id)
    taxonomyByKind.set(row.kind,found)
  }
  const categoryIds = taxonomyByKind.get('category') ?? new Set<string>()
  const tagIds = taxonomyByKind.get('tag') ?? new Set<string>()
  const locationIds = taxonomyByKind.get('location') ?? new Set<string>()

  const catalogIds = ids.get('catalogItems') ?? new Set<string>()
  const mediaIds = ids.get('mediaAssets') ?? new Set<string>()
  for (const item of rowsFor('catalogItems')) {
    requireValue('catalogItems',item,'catalogItems.categoryId',item.categoryId,categoryIds,'catalog category',true)
    requireValue('catalogItems',item,'catalogItems.locationId',item.locationId,locationIds,'catalog location',true)
    requireArrayValues('catalogItems',item,'catalogItems.tagIds',item.tagIds,tagIds,'catalog tag')
    const attachments = Array.isArray(item.attachments) ? item.attachments : []
    for (const raw of attachments) {
      const mediaId = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).mediaId : undefined
      if (typeof mediaId !== 'string' || !mediaIds.has(mediaId)) errors.push({
        entityType: 'catalog-item', entityId: typeof item.id === 'string' ? item.id : 'unknown',
        code: 'IMPORT_RELATION_MISSING', message: `catalogItems.attachments references missing media asset ${String(mediaId)}.`,
      })
    }
  }
  for (const transaction of rowsFor('inventoryTransactions')) {
    const allocations = Array.isArray(transaction.allocations) ? transaction.allocations : []
    for (const allocation of allocations) {
      const batchId = allocation && typeof allocation === 'object' && !Array.isArray(allocation)
        ?(allocation as Record<string, unknown>).batchId
        :undefined
      if (typeof batchId !== 'string' || !(ids.get('inventoryBatches') ?? new Set<string>()).has(batchId)) {
        errors.push({
          entityType: 'inventory-transaction',
          entityId: typeof transaction.id === 'string' ? transaction.id : 'unknown',
          code: 'IMPORT_RELATION_MISSING',
          message: `inventoryTransactions.allocations references missing inventory batch ${String(batchId)}.`,
        })
      }
    }
  }
  for (const budget of rowsFor('budgets')) {
    const scope = budget.scope && typeof budget.scope === 'object' && !Array.isArray(budget.scope)
      ?budget.scope as Record<string, unknown>
      :undefined
    const itemIds = scope && Array.isArray(scope.itemIds) ? scope.itemIds : []
    for (const itemId of itemIds) {
      if (typeof itemId !== 'string' || !catalogIds.has(itemId)) {
        errors.push({
          entityType: 'budget', entityId: typeof budget.id === 'string' ? budget.id : 'unknown',
          code: 'IMPORT_RELATION_MISSING', message: `budgets.scope references missing catalog item ${String(itemId)}.`,
        })
      }
    }
    const scopedCategoryIds = scope && Array.isArray(scope.categoryIds) ? scope.categoryIds : []
    for (const categoryId of scopedCategoryIds) {
      requireValue('budgets',budget,'budgets.scope.categoryIds',categoryId,categoryIds,'catalog category')
    }
  }

  const recipeIds = ids.get('recipes') ?? new Set<string>()
  const recipeVersionIds = ids.get('recipeVersions') ?? new Set<string>()
  for (const recipe of rowsFor('recipes')) {
    const currentVersion = recipe.currentVersion && typeof recipe.currentVersion === 'object' && !Array.isArray(recipe.currentVersion)
      ? recipe.currentVersion as Record<string, unknown>
      :undefined
    requireValue('recipes',recipe,'recipes.currentVersion.id',currentVersion?.id,recipeVersionIds,'recipe version')
    requireValue('recipes',recipe,'recipes.coverMediaId',recipe.coverMediaId,mediaIds,'media asset',true)
    requireValue('recipes',recipe,'recipes.categoryId',recipe.categoryId,categoryIds,'recipe category',true)
    requireArrayValues('recipes',recipe,'recipes.tagIds',recipe.tagIds,tagIds,'recipe tag')
  }
  for (const version of rowsFor('recipeVersions')) {
    requireValue('recipeVersions',version,'recipeVersions.recipeId',version.recipeId,recipeIds,'recipe')
    const components = Array.isArray(version.components) ? version.components : []
    const componentItemIds = new Set<string>()
    for (const raw of components) {
      const component = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
      const itemId = component?.itemId
      requireValue('recipeVersions',version,'recipeVersions.components.itemId',itemId,catalogIds,'catalog item')
      if (typeof itemId === 'string') componentItemIds.add(itemId)
    }
    for (const raw of Array.isArray(version.steps) ? version.steps : []) {
      const step = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
      if (!step) continue
      requireArrayValues('recipeVersions',version,'recipeVersions.steps.ingredientItemIds',step.ingredientItemIds,componentItemIds,'recipe component item')
      requireValue('recipeVersions',version,'recipeVersions.steps.imageMediaId',step.imageMediaId,mediaIds,'media asset',true)
    }
  }

  requireReference('cookingSessions','recipeId','recipes','recipe')
  requireReference('cookingSessions','recipeVersionId','recipeVersions','recipe version')
  requireReference('cookingCompletions','cookingSessionId','cookingSessions','cooking session')
  requireReference('cookingCompletions','recipeId','recipes','recipe')
  requireReference('cookingCompletions','recipeVersionId','recipeVersions','recipe version')
  requireReference('preparedFood','cookingSnapshotId','cookingCompletions','cooking completion')
  requireReference('preparedFood','recipeId','recipes','recipe')
  requireReference('preparedFood','recipeVersionId','recipeVersions','recipe version')

  const fitnessIds = ids.get('fitnessActivities') ?? new Set<string>()
  const validatePlanSource = (sourceKey: 'planTemplates'|'dayPlans'|'completionSnapshots', row: Record<string, unknown>, source: unknown) => {
    if (source == null) return
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      missingRelation(sourceKey,row,`${sourceKey}.source`,source,'plan source')
      return
    }
    const reference = source as Record<string, unknown>
    if (reference.type === 'catalog-item') {
      requireValue(sourceKey,row,`${sourceKey}.source.id`,reference.id,catalogIds,'catalog item')
    } else if (reference.type === 'fitness-activity') {
      requireValue(sourceKey,row,`${sourceKey}.source.id`,reference.id,fitnessIds,'fitness activity')
    } else if (reference.type === 'recipe-version') {
      requireValue(sourceKey,row,`${sourceKey}.source.id`,reference.id,recipeIds,'recipe')
      requireValue(sourceKey,row,`${sourceKey}.source.versionId`,reference.versionId,recipeVersionIds,'recipe version',true)
    }
  }
  const dayPlanItemIds = new Set<string>()
  for (const sourceKey of ['planTemplates','dayPlans'] as const) {
    for (const row of rowsFor(sourceKey)) {
      for (const raw of Array.isArray(row.items) ? row.items : []) {
        const item = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
        if (!item) continue
        if (sourceKey === 'dayPlans' && typeof item.id === 'string') dayPlanItemIds.add(item.id)
        validatePlanSource(sourceKey,row,item.source)
      }
    }
  }
  for (const rule of rowsFor('medicineRecurrenceRules')) {
    requireValue('medicineRecurrenceRules',rule,'medicineRecurrenceRules.sourceId',rule.sourceId,catalogIds,'catalog item')
  }
  for (const occurrence of rowsFor('medicineOccurrences')) {
    const source = occurrence.source && typeof occurrence.source === 'object' && !Array.isArray(occurrence.source)
      ? occurrence.source as Record<string, unknown>
      :undefined
    requireValue('medicineOccurrences',occurrence,'medicineOccurrences.source.id',source?.id,catalogIds,'catalog item')
  }

  const dayPlanIds = ids.get('dayPlans') ?? new Set<string>()
  const inventoryTransactionIds = ids.get('inventoryTransactions') ?? new Set<string>()
  const preparedFoodIds = ids.get('preparedFood') ?? new Set<string>()
  const preparedEventIds = new Set<string>()
  for (const group of rowsFor('completionPreparedFoodEvents')) {
    for (const raw of Array.isArray(group.events) ? group.events : []) {
      const event = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
      if (!event) continue
      if (typeof event.id === 'string') preparedEventIds.add(event.id)
      requireValue('completionPreparedFoodEvents',group,'completionPreparedFoodEvents.events.stockId',event.stockId,preparedFoodIds,'prepared food stock')
    }
  }
  for (const completion of rowsFor('completionSnapshots')) {
    requireValue('completionSnapshots',completion,'completionSnapshots.dayPlanId',completion.dayPlanId,dayPlanIds,'day plan',true)
    requireValue('completionSnapshots',completion,'completionSnapshots.dayPlanItemId',completion.dayPlanItemId,dayPlanItemIds,'day plan item',true)
    requireArrayValues('completionSnapshots',completion,'completionSnapshots.inventoryTransactionIds',completion.inventoryTransactionIds,inventoryTransactionIds,'inventory transaction')
    requireArrayValues('completionSnapshots',completion,'completionSnapshots.preparedFoodEventIds',completion.preparedFoodEventIds,preparedEventIds,'prepared-food completion event')
    validatePlanSource('completionSnapshots',completion,completion.source)
  }
  for (const reversal of rowsFor('completionReversals')) {
    requireArrayValues('completionReversals',reversal,'completionReversals.reversedInventoryTransactionIds',reversal.reversedInventoryTransactionIds,inventoryTransactionIds,'inventory transaction')
    requireArrayValues('completionReversals',reversal,'completionReversals.restoredPreparedFoodEventIds',reversal.restoredPreparedFoodEventIds,preparedEventIds,'prepared-food completion event')
  }
  requireReference('templateApplications','templateId','planTemplates','plan template')
  requireReference('templateApplications','dayPlanId','dayPlans','day plan')
  return errors
}
