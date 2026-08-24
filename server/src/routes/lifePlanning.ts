import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateDayPlanInput,
  CreateFitnessActivityInput,
  CreateMedicineRecurrenceRuleInput,
  CreatePlanTemplateInput,
  MedicineRecurrence,
  MedicineOccurrenceTransitionInput,
  PlanningCompletionInput,
  UpdateDayPlanInput,
  UpdatePlanTemplateInput,
  UpdateMedicineRecurrenceRuleInput,
} from '../domain/life/planning.js'
import type { User } from '../domain/types.js'
import type { LifeStore } from '../store/lifeStore.js'

interface RouteAuth { user: User }
interface LifePlanningRouteSecurity {
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
  authorizeWrite(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required })
const text = (minLength = 1, maxLength = 10_000) => ({ type: 'string', minLength, maxLength })
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: 'null' }] })
const id = text(1, 80)
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
const time = { type: 'string', pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$' }
const nonNegative = { type: 'number', minimum: 0 }
const positive = { type: 'number', exclusiveMinimum: 0 }
const source = objectSchema({ type: { type: 'string', enum: ['recipe-version', 'catalog-item', 'fitness-activity'] }, id, versionId: nullable(id) }, ['type', 'id'])
const mealSlot = objectSchema({ id, name: text(1, 240), position: { type: 'integer', minimum: 0 }, hidden: { type: 'boolean' } }, ['id', 'name', 'position', 'hidden'])
const planItemFields = {
  kind: { type: 'string', enum: ['meal', 'supplement', 'medicine', 'fitness', 'custom'] },
  title: text(1, 240), mealSlotId: nullable(id), scheduledTime: nullable(time), weekdays: { type: 'array', uniqueItems: true, maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 } },
  source: nullable(source), quantity: nullable(positive), unit: nullable(text(1, 80)), servings: nullable(positive), durationMinutes: nullable(nonNegative),
  relativeToItemIndex: { type: 'integer', minimum: 0 }, offsetMinutes: { type: 'integer', minimum: -1_440, maximum: 1_440 },
}
const planItem = objectSchema(planItemFields, ['kind', 'title'])
const updatePlanItem = objectSchema({ id, entityVersion: { type: 'integer', minimum: 1 }, ...planItemFields }, ['kind', 'title'])
const templateFields = {
  name: text(1, 240),
  mealSlots: { type: 'array', maxItems: 100, items: mealSlot },
  items: { type: 'array', maxItems: 1_000, items: planItem },
}
const recurrence = objectSchema({
  mode: { type: 'string', enum: ['weekdays', 'interval'] }, times: { type: 'array', minItems: 1, uniqueItems: true, items: time },
  weekdays: { type: 'array', uniqueItems: true, maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 } },
  everyDays: { type: 'integer', minimum: 1 }, startDate: date, endDate: date,
}, ['mode', 'times', 'startDate', 'endDate'])
const medicineRecurrenceRuleFields = {
  title: text(1, 240), sourceId: id, quantity: positive, unit: text(1, 80), recurrence,
}

function idempotencyKey(request: FastifyRequest, reply: FastifyReply) {
  const value = Array.isArray(request.headers['idempotency-key']) ? request.headers['idempotency-key'][0] : request.headers['idempotency-key']
  if (typeof value !== 'string' || !value.trim()) {
    reply.code(400).send({ error: { code: 'IDEMPOTENCY_REQUIRED', message: 'Planning creates, applies, syncs, completions and undo require an idempotency key.', requestId: request.id } })
    return undefined
  }
  return value.trim()
}

const notFound = (request: FastifyRequest, reply: FastifyReply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'The life planning object was not found.', requestId: request.id } })

export function registerLifePlanningRoutes(app: FastifyInstance, store: LifeStore, security: LifePlanningRouteSecurity) {
  app.get('/api/v1/life/templates', async (request, reply) => {
    const auth = await security.authenticate(request, reply); if (!auth) return
    return store.listPlanTemplates(auth.user.id)
  })
  app.post('/api/v1/life/templates', { schema: { body: objectSchema(templateFields, ['name', 'mealSlots', 'items']) } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const key = idempotencyKey(request, reply); if (!key) return
    return reply.code(201).send(await store.createPlanTemplate(auth.user.id, request.body as CreatePlanTemplateInput, key))
  })
  app.patch('/api/v1/life/templates/:id', {
    schema: { params: objectSchema({ id }, ['id']), body: objectSchema({ entityVersion: { type: 'integer', minimum: 1 }, ...templateFields }, ['entityVersion', 'name', 'mealSlots', 'items']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    return await store.updatePlanTemplate(auth.user.id, (request.params as { id: string }).id, request.body as UpdatePlanTemplateInput) ?? notFound(request, reply)
  })

  app.post('/api/v1/life/day-plans/recurrence-preview', {
    schema: { body: objectSchema({ kind: { type: 'string', const: 'medicine' }, source, recurrence }, ['kind', 'source', 'recurrence']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const body = request.body as { source: { type: string; id: string }; recurrence: MedicineRecurrence }
    if (body.source.type !== 'catalog-item') return reply.code(400).send({ error: { code: 'INVALID_SOURCE', message: 'Medicine recurrence requires a catalog item source.', requestId: request.id } })
    return store.previewMedicineRecurrence(auth.user.id, body.source.id, body.recurrence)
  })
  app.get('/api/v1/life/day-plans/recurrence-rules', async (request, reply) => {
    const auth = await security.authenticate(request, reply); if (!auth) return
    return store.listMedicineRecurrenceRules(auth.user.id)
  })
  app.post('/api/v1/life/day-plans/recurrence-rules', {
    schema: { body: objectSchema(medicineRecurrenceRuleFields, ['title', 'sourceId', 'quantity', 'unit', 'recurrence']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const key = idempotencyKey(request, reply); if (!key) return
    return reply.code(201).send(await store.createMedicineRecurrenceRule(auth.user.id, request.body as CreateMedicineRecurrenceRuleInput, key))
  })
  app.patch('/api/v1/life/day-plans/recurrence-rules/:id', {
    schema: {
      params: objectSchema({ id }, ['id']),
      body: objectSchema({ ...medicineRecurrenceRuleFields, entityVersion: { type: 'integer', minimum: 1 } }, ['title', 'sourceId', 'quantity', 'unit', 'recurrence', 'entityVersion']),
    },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    return await store.updateMedicineRecurrenceRule(
      auth.user.id,
      (request.params as { id: string }).id,
      request.body as UpdateMedicineRecurrenceRuleInput,
    ) ?? notFound(request, reply)
  })
  app.delete('/api/v1/life/day-plans/recurrence-rules/:id', {
    schema: { params: objectSchema({ id }, ['id']), body: objectSchema({ entityVersion: { type: 'integer', minimum: 1 } }, ['entityVersion']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const deleted = await store.deleteMedicineRecurrenceRule(auth.user.id, (request.params as { id: string }).id, (request.body as { entityVersion: number }).entityVersion)
    return deleted ? reply.code(204).send() : notFound(request, reply)
  })
  app.patch('/api/v1/life/day-plans/medicine-occurrences/:id', {
    schema: {
      params: objectSchema({ id }, ['id']),
      body: objectSchema({
        entityVersion: { type: 'integer', minimum: 1 },
        action: { type: 'string', enum: ['skip', 'delay'] },
        at: text(1, 80),
        delayedUntil: objectSchema({ date, time }, ['date', 'time']),
      }, ['entityVersion', 'action', 'at']),
    },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const key = idempotencyKey(request, reply); if (!key) return
    const body = request.body as {
      entityVersion: number
      action: 'skip' | 'delay'
      at: string
      delayedUntil?: { date: string; time: string }
    }
    if ((body.action === 'delay' && !body.delayedUntil) || (body.action === 'skip' && body.delayedUntil != null)) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_INPUT',
          message: 'delayedUntil is required only for delay and must be absent for skip.',
          requestId: request.id,
        },
      })
    }
    const input: MedicineOccurrenceTransitionInput = body.action === 'delay'
      ? {
          entityVersion: body.entityVersion,
          action: body.action,
          at: body.at,
          scheduledDate: body.delayedUntil!.date,
          scheduledTime: body.delayedUntil!.time,
        }
      : { entityVersion: body.entityVersion, action: body.action, at: body.at }
    return await store.transitionMedicineOccurrence(
      auth.user.id,
      (request.params as { id: string }).id,
      input,
      key,
    ) ?? notFound(request, reply)
  })
  app.post('/api/v1/life/day-plans', {
    schema: { body: objectSchema({ date, mealSlots: templateFields.mealSlots, items: templateFields.items }, ['date', 'mealSlots', 'items']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const key = idempotencyKey(request, reply); if (!key) return
    return reply.code(201).send(await store.createDayPlan(auth.user.id, request.body as CreateDayPlanInput, key))
  })
  app.patch('/api/v1/life/day-plans/:date', {
    schema: {
      params: objectSchema({ date }, ['date']),
      body: objectSchema({
        entityVersion: { type: 'integer', minimum: 1 },
        mealSlots: templateFields.mealSlots,
        items: { type: 'array', maxItems: 1_000, items: updatePlanItem },
      }, ['entityVersion', 'mealSlots', 'items']),
    },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    return await store.updateDayPlan(
      auth.user.id,
      (request.params as { date: string }).date,
      request.body as UpdateDayPlanInput,
    ) ?? notFound(request, reply)
  })
  app.get('/api/v1/life/day-plans/:date', { schema: { params: objectSchema({ date }, ['date']) } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply); if (!auth) return
    return await store.getDayPlan(auth.user.id, (request.params as { date: string }).date) ?? notFound(request, reply)
  })
  app.get('/api/v1/life/day-plans/:date/projection', { schema: { params: objectSchema({ date }, ['date']) } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply); if (!auth) return
    return await store.getDayPlanProjection(auth.user.id, (request.params as { date: string }).date) ?? notFound(request, reply)
  })
  app.post('/api/v1/life/day-plans/:date/template-preview', {
    schema: { params: objectSchema({ date }, ['date']), body: objectSchema({ templateId: id, resolution: { type: 'string', enum: ['merge', 'replace', 'skip'] } }, ['templateId', 'resolution']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const body = request.body as { templateId: string; resolution: 'merge' | 'replace' | 'skip' }
    return await store.previewTemplateApplication(auth.user.id, (request.params as { date: string }).date, body.templateId, body.resolution) ?? notFound(request, reply)
  })
  app.post('/api/v1/life/day-plans/:date/apply-template', {
    schema: { params: objectSchema({ date }, ['date']), body: objectSchema({ templateId: id, resolution: { type: 'string', enum: ['merge', 'replace', 'skip'] }, entityVersion: { type: 'integer', minimum: 1 }, templateVersion: { type: 'integer', minimum: 1 } }, ['templateId', 'resolution', 'entityVersion', 'templateVersion']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const key = idempotencyKey(request, reply); if (!key) return
    return await store.applyTemplateToDayPlan(auth.user.id, (request.params as { date: string }).date, request.body as { templateId: string; resolution: 'merge' | 'replace' | 'skip'; entityVersion: number; templateVersion: number }, key) ?? notFound(request, reply)
  })
  app.post('/api/v1/life/day-plans/:date/copy', {
    schema: { params: objectSchema({ date }, ['date']), body: objectSchema({ targetDate: date }, ['targetDate']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const key = idempotencyKey(request, reply); if (!key) return
    const result = await store.copyDayPlan(auth.user.id, (request.params as { date: string }).date, (request.body as { targetDate: string }).targetDate, key)
    return result ? reply.code(201).send(result) : notFound(request, reply)
  })
  app.patch('/api/v1/life/day-plans/:date/items/:itemId', {
    schema: {
      params: objectSchema({ date, itemId: id }, ['date', 'itemId']),
      body: objectSchema({ entityVersion: { type: 'integer', minimum: 1 }, action: { type: 'string', enum: ['complete', 'skip', 'delay', 'backfill'] }, at: text(1, 80), delayedUntil: time }, ['entityVersion', 'action', 'at']),
    },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const params = request.params as { date: string; itemId: string }
    return await store.transitionDayPlanItem(auth.user.id, params.date, params.itemId, request.body as { entityVersion: number; action: 'complete' | 'skip' | 'delay' | 'backfill'; at: string; delayedUntil?: string }) ?? notFound(request, reply)
  })

  const syncBody = objectSchema({ fromDate: date, target: { type: 'string', enum: ['future-incomplete', 'selected'] }, dates: { type: 'array', uniqueItems: true, maxItems: 500, items: date } }, ['fromDate', 'target'])
  const syncConfirmationBody = objectSchema({
    fromDate: date,
    target: { type: 'string', enum: ['future-incomplete', 'selected'] },
    dates: { type: 'array', uniqueItems: true, maxItems: 500, items: date },
    templateVersion: { type: 'integer', minimum: 1 },
    dayPlanVersions: { type: 'object', maxProperties: 500, additionalProperties: { type: 'integer', minimum: 1 } },
  }, ['fromDate', 'target', 'templateVersion', 'dayPlanVersions'])
  app.post('/api/v1/life/templates/:id/sync-preview', { schema: { params: objectSchema({ id }, ['id']), body: syncBody } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    return await store.previewTemplateSync(auth.user.id, (request.params as { id: string }).id, request.body as { fromDate: string; target: 'future-incomplete' | 'selected'; dates?: string[] }) ?? notFound(request, reply)
  })
  app.post('/api/v1/life/templates/:id/sync', { schema: { params: objectSchema({ id }, ['id']), body: syncConfirmationBody } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const key = idempotencyKey(request, reply); if (!key) return
    return await store.syncPlanTemplate(auth.user.id, (request.params as { id: string }).id, request.body as { fromDate: string; target: 'future-incomplete' | 'selected'; dates?: string[]; templateVersion: number; dayPlanVersions: Record<string, number> }, key) ?? notFound(request, reply)
  })

  app.get('/api/v1/life/calendar', {
    schema: { querystring: objectSchema({ from: date, to: date, today: date }, ['from', 'to']) },
  }, async (request, reply) => {
    const auth = await security.authenticate(request, reply); if (!auth) return
    const query = request.query as { from: string; to: string; today?: string }
    return store.listCalendar(auth.user.id, query.from, query.to, query.today ?? new Date().toISOString().slice(0, 10))
  })
  app.get('/api/v1/life/timeline/:date', { schema: { params: objectSchema({ date }, ['date']) } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply); if (!auth) return
    return store.getPlanningTimeline(auth.user.id, (request.params as { date: string }).date)
  })

  const fitnessFields = {
    name: text(1, 240), defaultMinutes: nonNegative, kcalPerHour: nonNegative, intensity: text(1, 120),
    steps: { type: 'array', maxItems: 500, items: text(1, 2_000) }, equipment: { type: 'array', maxItems: 500, items: text(1, 500) },
  }
  app.get('/api/v1/life/fitness', async (request, reply) => {
    const auth = await security.authenticate(request, reply); if (!auth) return
    return store.listFitnessActivities(auth.user.id)
  })
  app.post('/api/v1/life/fitness', { schema: { body: objectSchema(fitnessFields, Object.keys(fitnessFields)) } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const key = idempotencyKey(request, reply); if (!key) return
    return reply.code(201).send(await store.createFitnessActivity(auth.user.id, request.body as CreateFitnessActivityInput, key))
  })

  app.post('/api/v1/life/completions', {
    schema: { body: objectSchema({
      date,
      dayPlanItemId: id,
      medicineOccurrenceId: id,
      medicineOccurrenceVersion: { type: 'integer', minimum: 1 },
      completedAt: text(1, 80),
      actualMinutes: nonNegative,
      overrideEnergyKcal: nonNegative,
    }, ['completedAt']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const key = idempotencyKey(request, reply); if (!key) return
    const body = request.body as {
      date?: string
      dayPlanItemId?: string
      medicineOccurrenceId?: string
      medicineOccurrenceVersion?: number
      completedAt: string
      actualMinutes?: number
      overrideEnergyKcal?: number
    }
    const dayPlanSource = body.dayPlanItemId != null
    const occurrenceSource = body.medicineOccurrenceId != null
    const invalidSource = dayPlanSource === occurrenceSource
      || (dayPlanSource && body.date == null)
      || (occurrenceSource && body.medicineOccurrenceVersion == null)
      || (!occurrenceSource && body.medicineOccurrenceVersion != null)
      || (occurrenceSource && (body.actualMinutes != null || body.overrideEnergyKcal != null))
    if (invalidSource) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_COMPLETION_SOURCE',
          message: 'Provide exactly one day-plan item or versioned medicine occurrence completion source.',
          requestId: request.id,
        },
      })
    }
    const input: PlanningCompletionInput = dayPlanSource
      ? {
          source: { type: 'day-plan-item', date: body.date!, dayPlanItemId: body.dayPlanItemId! },
          completedAt: body.completedAt,
          ...(body.actualMinutes === undefined ? {} : { actualMinutes: body.actualMinutes }),
          ...(body.overrideEnergyKcal === undefined ? {} : { overrideEnergyKcal: body.overrideEnergyKcal }),
        }
      : {
          source: { type: 'medicine-occurrence', id: body.medicineOccurrenceId!, entityVersion: body.medicineOccurrenceVersion! },
          completedAt: body.completedAt,
        }
    return reply.code(201).send(await store.createPlanningCompletionFromSource(auth.user.id, input, key))
  })
  app.post('/api/v1/life/completions/:id/undo', {
    schema: { params: objectSchema({ id }, ['id']), body: objectSchema({}) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply); if (!auth) return
    const key = idempotencyKey(request, reply); if (!key) return
    return await store.undoPlanningCompletion(auth.user.id, (request.params as { id: string }).id, key) ?? notFound(request, reply)
  })
}
