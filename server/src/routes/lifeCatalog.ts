import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type {
  CatalogBatchInput,
  CatalogFilters,
  CreateCatalogItemInput,
  CreateTaxonomyInput,
  CreateUnitInput,
  TaxonomyKind,
  UpdateCatalogItemInput,
  UpdateTaxonomyInput,
  UpdateUnitInput,
} from '../domain/life/catalog.js'
import type { User } from '../domain/types.js'
import type { LifeStore } from '../store/lifeStore.js'

interface RouteAuth { user: User }
interface LifeCatalogRouteSecurity {
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
  authorizeWrite(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required })
const strictObjectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object', additionalProperties: { not: {} }, properties, required,
})
const text = (minLength = 1, maxLength = 10_000) => ({ type: 'string', minLength, maxLength })
const nullableText = (maxLength = 80) => ({ anyOf: [text(1, maxLength), { type: 'null' }] })
const id = text(1, 80)
const idParams = objectSchema({ id }, ['id'])
const version = { type: 'integer', minimum: 1 }
const nonNegativeInteger = { type: 'integer', minimum: 0 }
const nonNegativeNumber = { type: 'number', minimum: 0 }
const positiveNumber = { type: 'number', exclusiveMinimum: 0 }
const stringArray = { type: 'array', maxItems: 200, uniqueItems: true, items: text(1, 160) }
const status = { type: 'string', enum: ['active', 'disabled'] }
const kind = { type: 'string', enum: ['ingredient', 'supplement', 'medicine', 'household_consumable', 'household_durable'] }
const dimension = { type: 'string', enum: ['mass', 'volume', 'count', 'package', 'time'] }
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }

const conversion = objectSchema({
  itemId: id,
  fromUnit: text(1, 80),
  toUnit: text(1, 80),
  factor: positiveNumber,
}, ['itemId', 'fromUnit', 'toUnit', 'factor'])
const price = objectSchema({
  id,
  amountMinor: nonNegativeInteger,
  currency: { type: 'string', minLength: 3, maxLength: 3 },
  purchaseQuantity: positiveNumber,
  purchaseUnit: text(1, 80),
  effectiveFrom: date,
}, ['amountMinor', 'currency', 'purchaseQuantity', 'purchaseUnit', 'effectiveFrom'])
const nutritionValues = objectSchema({
  energyKcal: nonNegativeNumber,
  proteinGrams: nonNegativeNumber,
  fatGrams: nonNegativeNumber,
  carbohydrateGrams: nonNegativeNumber,
  custom: {
    type: 'object',
    maxProperties: 100,
    propertyNames: { type: 'string', minLength: 1, maxLength: 120 },
    additionalProperties: nonNegativeNumber,
  },
}, ['energyKcal', 'proteinGrams', 'fatGrams', 'carbohydrateGrams'])
const nutrition = objectSchema({ basisQuantity: positiveNumber, basisUnit: text(1, 80), values: nutritionValues }, ['basisQuantity', 'basisUnit', 'values'])
const medicine = objectSchema({
  tradeName: text(1, 240),
  genericName: text(1, 240),
  specification: text(1, 500),
  dosageForm: text(1, 160),
  packageDescription: text(1, 500),
  userInstructions: text(1, 4_000),
  userScheduleText: text(1, 4_000),
  asNeeded: { type: 'boolean' },
  recommendation: false,
  diagnosis: false,
  dosageAdvice: false,
  stopMedicationAdvice: false,
  interactionAdvice: false,
})
const nullableDate = { anyOf: [{ type: 'null' }, date] }
const profile = strictObjectSchema({
  kind: { type: 'string', enum: ['supplement', 'household_consumable', 'household_durable'] },
  servingQuantity: positiveNumber,
  servingUnit: text(1, 80),
  ingredients: { type: 'array', maxItems: 200, uniqueItems: true, items: text(1, 500) },
  defaultFrequency: text(0, 2_000),
  userInstructions: text(0, 4_000),
  reminder: strictObjectSchema({
    enabled: { type: 'boolean' },
    localTimes: { type: 'array', maxItems: 48, uniqueItems: true, items: { type: 'string', pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$' } },
    note: text(0, 2_000),
  }, ['enabled', 'localTimes']),
  defaultPurchaseQuantity: positiveNumber,
  defaultPurchaseUnit: text(1, 80),
  consumptionCycleDays: { type: 'integer', minimum: 1 },
  estimatedDepletionDate: nullableDate,
  valueMinor: nonNegativeInteger,
  currency: { type: 'string', pattern: '^[A-Za-z]{3}$' },
  valueAsOfDate: nullableDate,
  lifecycleStatus: { type: 'string', enum: ['active', 'maintenance', 'retired'] },
  acquiredOn: nullableDate,
  warrantyExpiresOn: nullableDate,
  maintenanceRecords: {
    type: 'array', maxItems: 1_000, items: strictObjectSchema({
      id, performedOn: date, summary: text(1, 2_000), costMinor: nonNegativeInteger,
      currency: { type: 'string', pattern: '^[A-Za-z]{3}$' },
    }, ['id', 'performedOn', 'summary']),
  },
  retiredOn: nullableDate,
  retirementReason: { anyOf: [{ type: 'null' }, text(0, 2_000)] },
  setItemIds: { type: 'array', maxItems: 1_000, uniqueItems: true, items: id },
}, ['kind'])
const attachment = objectSchema({ mediaId: id, caption: text(0, 500) }, ['mediaId', 'caption'])

const catalogFields = {
  kind,
  name: text(1, 240),
  aliases: stringArray,
  status,
  categoryId: nullableText(),
  tagIds: stringArray,
  locationId: nullableText(),
  baseUnit: text(1, 80),
  availableUnits: stringArray,
  itemConversions: { type: 'array', maxItems: 100, items: conversion },
  pricePoints: { type: 'array', maxItems: 500, items: price },
  nutrition,
  isCookingOil: { type: 'boolean' },
  medicine,
  profile,
  attachments: { type: 'array', maxItems: 50, items: attachment },
  notes: text(0, 20_000),
  customOrder: nonNegativeInteger,
}

function idempotencyKey(request: FastifyRequest, reply: FastifyReply) {
  const value = Array.isArray(request.headers['idempotency-key']) ? request.headers['idempotency-key'][0] : request.headers['idempotency-key']
  if (typeof value !== 'string' || !value.trim()) {
    reply.code(400).send({ error: { code: 'IDEMPOTENCY_REQUIRED', message: 'Creating a catalog item requires an idempotency key.', requestId: request.id } })
    return undefined
  }
  return value.trim()
}

function notFound(request: FastifyRequest, reply: FastifyReply, message = 'The life catalog object was not found.') {
  return reply.code(404).send({ error: { code: 'NOT_FOUND', message, requestId: request.id } })
}

const taxonomyPaths: Array<{ path: 'categories' | 'tags' | 'locations'; kind: TaxonomyKind }> = [
  { path: 'categories', kind: 'category' },
  { path: 'tags', kind: 'tag' },
  { path: 'locations', kind: 'location' },
]

export function registerLifeCatalogRoutes(app: FastifyInstance, store: LifeStore, security: LifeCatalogRouteSecurity) {
  app.get('/api/v1/life/catalog', {
    schema: { querystring: objectSchema({ kind, q: text(1, 240) }) },
  }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listCatalogItems(auth.user.id, request.query as CatalogFilters)
  })

  app.post('/api/v1/life/catalog', {
    schema: { body: objectSchema(catalogFields, ['kind', 'name', 'baseUnit']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return reply.code(201).send(await store.createCatalogItem(auth.user.id, request.body as CreateCatalogItemInput, key))
  })

  app.post('/api/v1/life/catalog/batch', {
    schema: {
      body: objectSchema({
        items: { type: 'array', minItems: 1, maxItems: 500, items: objectSchema({ id, version }, ['id', 'version']) },
        patch: objectSchema({ categoryId: nullableText(), locationId: nullableText(), addTagIds: stringArray, removeTagIds: stringArray, status }),
      }, ['items', 'patch']),
    },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return store.batchUpdateCatalogItems(auth.user.id, request.body as CatalogBatchInput)
  })

  app.get('/api/v1/life/catalog/:id/delete-impact', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return await store.previewCatalogItemDelete(auth.user.id, (request.params as { id: string }).id) ?? notFound(request, reply)
  })

  app.get('/api/v1/life/catalog/:id', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return await store.getCatalogItem(auth.user.id, (request.params as { id: string }).id) ?? notFound(request, reply)
  })

  app.patch('/api/v1/life/catalog/:id', {
    schema: { params: idParams, body: objectSchema({ ...catalogFields, version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return await store.updateCatalogItem(auth.user.id, (request.params as { id: string }).id, request.body as UpdateCatalogItemInput)
      ?? notFound(request, reply)
  })

  app.delete('/api/v1/life/catalog/:id', {
    schema: { params: idParams, body: objectSchema({ version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const removed = await store.deleteCatalogItem(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
    if (!removed) return notFound(request, reply)
    return reply.code(204).send()
  })

  app.get('/api/v1/life/trash/catalog', async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listDeletedCatalogItems(auth.user.id)
  })

  app.post('/api/v1/life/trash/catalog/:id/restore', {
    schema: { params: idParams, body: objectSchema({ version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return await store.restoreCatalogItem(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
      ?? notFound(request, reply)
  })

  for (const entry of taxonomyPaths) {
    const root = `/api/v1/life/taxonomy/${entry.path}`
    app.get(root, async (request, reply) => {
      const auth = await security.authenticate(request, reply)
      if (!auth) return
      return store.listTaxonomy(auth.user.id, entry.kind)
    })
    app.post(root, {
      schema: { body: objectSchema({ name: text(1, 160), parentId: nullableText(), status, position: nonNegativeInteger }, ['name']) },
    }, async (request, reply) => {
      const auth = await security.authorizeWrite(request, reply)
      if (!auth) return
      return reply.code(201).send(await store.createTaxonomy(auth.user.id, entry.kind, request.body as CreateTaxonomyInput))
    })
    app.get(`${root}/:id`, { schema: { params: idParams } }, async (request, reply) => {
      const auth = await security.authenticate(request, reply)
      if (!auth) return
      const idValue = (request.params as { id: string }).id
      return (await store.listTaxonomy(auth.user.id, entry.kind)).find((value) => value.id === idValue) ?? notFound(request, reply)
    })
    app.patch(`${root}/:id`, {
      schema: { params: idParams, body: objectSchema({ name: text(1, 160), parentId: nullableText(), status, position: nonNegativeInteger, version }, ['version']) },
    }, async (request, reply) => {
      const auth = await security.authorizeWrite(request, reply)
      if (!auth) return
      return await store.updateTaxonomy(auth.user.id, entry.kind, (request.params as { id: string }).id, request.body as UpdateTaxonomyInput)
        ?? notFound(request, reply)
    })
    app.delete(`${root}/:id`, {
      schema: { params: idParams, body: objectSchema({ version }, ['version']) },
    }, async (request, reply) => {
      const auth = await security.authorizeWrite(request, reply)
      if (!auth) return
      const removed = await store.deleteTaxonomy(auth.user.id, entry.kind, (request.params as { id: string }).id, (request.body as { version: number }).version)
      if (!removed) return notFound(request, reply)
      return reply.code(204).send()
    })
    app.post(`/api/v1/life/trash/${entry.path}/:id/restore`, {
      schema: { params: idParams, body: objectSchema({ version }, ['version']) },
    }, async (request, reply) => {
      const auth = await security.authorizeWrite(request, reply)
      if (!auth) return
      return await store.restoreTaxonomy(auth.user.id, entry.kind, (request.params as { id: string }).id, (request.body as { version: number }).version)
        ?? notFound(request, reply)
    })
  }

  app.get('/api/v1/life/units', async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listUnits(auth.user.id)
  })
  app.post('/api/v1/life/units', {
    schema: { body: objectSchema({ code: text(1, 80), name: text(1, 120), symbol: text(1, 40), dimension, baseCode: text(1, 80), toBaseFactor: { anyOf: [positiveNumber, { type: 'null' }] } }, ['code', 'name', 'symbol', 'dimension', 'baseCode']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return reply.code(201).send(await store.createUnit(auth.user.id, request.body as CreateUnitInput))
  })
  app.patch('/api/v1/life/units/:id', {
    schema: { params: idParams, body: objectSchema({ code: text(1, 80), name: text(1, 120), symbol: text(1, 40), dimension, baseCode: text(1, 80), toBaseFactor: { anyOf: [positiveNumber, { type: 'null' }] }, version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return await store.updateUnit(auth.user.id, (request.params as { id: string }).id, request.body as UpdateUnitInput) ?? notFound(request, reply)
  })
  app.delete('/api/v1/life/units/:id', {
    schema: { params: idParams, body: objectSchema({ version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const removed = await store.deleteUnit(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
    if (!removed) return notFound(request, reply)
    return reply.code(204).send()
  })
  app.post('/api/v1/life/trash/units/:id/restore', {
    schema: { params: idParams, body: objectSchema({ version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    return await store.restoreUnit(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version) ?? notFound(request, reply)
  })
}
