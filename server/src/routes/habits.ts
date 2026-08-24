import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateHabitInput,
  UpdateHabitInput,
  UpsertHabitEntryInput,
} from '../domain/habits.js'
import type { User } from '../domain/types.js'
import type { LifeStore } from '../store/lifeStore.js'

interface RouteAuth {
  user: User
}

interface HabitsRouteSecurity {
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
  authorizeWrite(request: FastifyRequest, reply: FastifyReply): Promise<RouteAuth | undefined>
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
})
const text = (minLength = 1, maxLength = 10_000) => ({ type: 'string', minLength, maxLength })
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] })
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
const idParams = objectSchema({ id: text(1, 80) }, ['id'])
const entryParams = objectSchema({ habitId: text(1, 80), entryDate: date }, ['habitId', 'entryDate'])
const schedule = objectSchema({
  scheduleType: { type: 'string', enum: ['daily', 'weekdays', 'times-per-week', 'interval'] },
  weekdays: { type: 'array', minItems: 1, maxItems: 7, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: 7 } },
  timesPerWeek: { type: 'integer', minimum: 1, maximum: 7 },
  intervalDays: { type: 'integer', minimum: 1, maximum: 36_500 },
  startsOn: date,
  endsOn: nullable(date),
}, ['scheduleType', 'startsOn'])

const habitFields = {
  goalId: nullable(text(1, 80)),
  projectId: nullable(text(1, 80)),
  title: text(1, 240),
  description: text(0, 20_000),
  measure: { type: 'string', enum: ['boolean', 'count', 'duration', 'quantity'] },
  unit: nullable(text(1, 40)),
  targetValue: nullable({ type: 'number', minimum: 0 }),
  timezone: text(1, 64),
  schedule,
}

const entryFields = {
  status: { type: 'string', enum: ['done', 'partial', 'intentional-skip'] },
  value: nullable({ type: 'number', minimum: 0 }),
  note: text(0, 2_000),
  version: { type: 'integer', minimum: 1 },
}

function idempotencyKey(request: FastifyRequest, reply: FastifyReply) {
  const value = Array.isArray(request.headers['idempotency-key'])
    ? request.headers['idempotency-key'][0]
    : request.headers['idempotency-key']
  if (typeof value !== 'string' || !value.trim()) {
    reply.code(400).send({ error: { code: 'IDEMPOTENCY_REQUIRED', message: '创建请求需要幂等键', requestId: request.id } })
    return undefined
  }
  return value.trim()
}

function notFound(reply: FastifyReply, request: FastifyRequest, message: string) {
  return reply.code(404).send({ error: { code: 'NOT_FOUND', message, requestId: request.id } })
}

export function registerHabitsRoutes(
  app: FastifyInstance,
  store: LifeStore,
  security: HabitsRouteSecurity,
) {
  app.get('/api/v1/habits', {
    schema: { querystring: objectSchema({ from: date, to: date }) },
  }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    const { from, to } = request.query as { from?: string; to?: string }
    const [habits, entries] = await Promise.all([
      store.listHabits(auth.user.id),
      store.listHabitEntries(auth.user.id, from, to),
    ])
    return { from: from ?? null, to: to ?? null, habits, entries }
  })

  app.post('/api/v1/habits', {
    schema: { body: objectSchema(habitFields, ['title', 'measure', 'timezone', 'schedule']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return reply.code(201).send(await store.createHabit(auth.user.id, request.body as CreateHabitInput, key))
  })

  app.get('/api/v1/habits/:id', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    const habit = await store.getHabit(auth.user.id, (request.params as { id: string }).id)
    return habit ?? notFound(reply, request, '找不到习惯')
  })

  app.patch('/api/v1/habits/:id', {
    schema: {
      params: idParams,
      body: objectSchema({
        ...habitFields,
        status: { type: 'string', enum: ['active', 'paused', 'archived'] },
        version: { type: 'integer', minimum: 1 },
      }, ['version']),
    },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const habit = await store.updateHabit(
      auth.user.id,
      (request.params as { id: string }).id,
      request.body as UpdateHabitInput,
    )
    return habit ?? notFound(reply, request, '找不到习惯')
  })

  app.put('/api/v1/habits/:habitId/entries/:entryDate', {
    schema: { params: entryParams, body: objectSchema(entryFields, ['status']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const input = request.body as UpsertHabitEntryInput
    const key = input.version === undefined ? idempotencyKey(request, reply) : undefined
    if (input.version === undefined && !key) return
    const { habitId, entryDate } = request.params as { habitId: string; entryDate: string }
    const result = await store.upsertHabitEntry(auth.user.id, habitId, entryDate, input, key)
    if (!result) return notFound(reply, request, '找不到习惯或记录')
    return reply.code(result.created ? 201 : 200).send(result.entry)
  })
}
