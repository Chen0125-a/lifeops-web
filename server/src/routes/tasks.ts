import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { detectScheduleConflicts, type CreateTaskInput, type UpdateTaskInput } from '../domain/tasks.js'
import type { User } from '../domain/types.js'
import type { LifeStore } from '../store/lifeStore.js'

interface RouteAuth {
  user: User
}

interface TasksRouteSecurity {
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
const id = text(1, 80)
const instant = text(1, 64)
const version = { type: 'integer', minimum: 0 }
const idParams = objectSchema({ id }, ['id'])
const taskParams = objectSchema({ taskId: id }, ['taskId'])
const checklistParams = objectSchema({ taskId: id, id }, ['taskId', 'id'])
const versionBody = objectSchema({ version }, ['version'])
const recurrence = nullable(objectSchema({
  frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
  interval: { type: 'integer', minimum: 1 },
  weekdays: { type: 'array', uniqueItems: true, maxItems: 7, items: { type: 'integer', minimum: 1, maximum: 7 } },
  monthDay: { type: 'integer', minimum: 1, maximum: 31 },
  until: nullable({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
}, ['frequency', 'interval']))
const taskFields = {
  goalId: nullable(id),
  projectId: nullable(id),
  milestoneId: nullable(id),
  title: text(1, 240),
  description: text(0, 20_000),
  startsAt: nullable(instant),
  endsAt: nullable(instant),
  dueAt: nullable(instant),
  estimateMinutes: nullable({ type: 'integer', minimum: 0, maximum: 525_600 }),
  priority: { type: 'integer', enum: [1, 2, 3] },
  tags: { type: 'array', uniqueItems: true, maxItems: 50, items: text(1, 80) },
  status: { type: 'string', enum: ['inbox', 'planned', 'doing', 'done', 'skipped', 'cancelled'] },
  recurrence,
}
const checklistFields = {
  title: text(1, 500),
  isCompleted: { type: 'boolean' },
  position: { type: 'integer', minimum: 0, maximum: 4_294_967_295 },
}
const blockFields = { startsAt: instant, endsAt: instant }

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

export function registerTasksRoutes(app: FastifyInstance, store: LifeStore, security: TasksRouteSecurity) {
  app.get('/api/v1/tasks', async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listTasks(auth.user.id)
  })

  app.post('/api/v1/tasks', { schema: { body: objectSchema(taskFields, ['title']) } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return reply.code(201).send(await store.createTask(auth.user.id, request.body as CreateTaskInput, key))
  })

  app.get('/api/v1/tasks/:id', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    const result = await store.getTask(auth.user.id, (request.params as { id: string }).id)
    return result ?? notFound(reply, request, '找不到任务')
  })

  app.patch('/api/v1/tasks/:id', {
    schema: { params: idParams, body: objectSchema({ ...taskFields, version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const result = await store.updateTask(auth.user.id, (request.params as { id: string }).id, request.body as UpdateTaskInput)
    return result ?? notFound(reply, request, '找不到任务')
  })

  app.delete('/api/v1/tasks/:id', { schema: { params: idParams, body: versionBody } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const removed = await store.deleteTask(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
    if (!removed) return notFound(reply, request, '找不到任务')
    return reply.code(204).send()
  })

  app.post('/api/v1/tasks/:id/complete', { schema: { params: idParams, body: versionBody } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const result = await store.setTaskCompletion(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version, true)
    return result ?? notFound(reply, request, '找不到任务')
  })

  app.delete('/api/v1/tasks/:id/complete', { schema: { params: idParams, body: versionBody } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const result = await store.setTaskCompletion(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version, false)
    return result ?? notFound(reply, request, '找不到任务')
  })

  app.post('/api/v1/tasks/:taskId/checklist', {
    schema: { params: taskParams, body: objectSchema({ title: checklistFields.title, position: checklistFields.position }, ['title']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    const result = await store.addChecklistItem(auth.user.id, (request.params as { taskId: string }).taskId, request.body as { title: string; position?: number }, key)
    return reply.code(201).send(result)
  })

  app.patch('/api/v1/tasks/:taskId/checklist/:id', {
    schema: { params: checklistParams, body: objectSchema({ ...checklistFields, version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const params = request.params as { taskId: string; id: string }
    const result = await store.updateChecklistItem(auth.user.id, params.taskId, params.id, request.body as { title?: string; isCompleted?: boolean; position?: number; version: number })
    return result ?? notFound(reply, request, '找不到清单项')
  })

  app.delete('/api/v1/tasks/:taskId/checklist/:id', { schema: { params: checklistParams, body: versionBody } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const params = request.params as { taskId: string; id: string }
    const removed = await store.deleteChecklistItem(auth.user.id, params.taskId, params.id, (request.body as { version: number }).version)
    if (!removed) return notFound(reply, request, '找不到清单项')
    return reply.code(204).send()
  })

  app.get('/api/v1/schedule-blocks', {
    schema: { querystring: objectSchema({ from: instant, to: instant }) },
  }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    const query = request.query as { from?: string; to?: string }
    return store.listScheduleBlocks(auth.user.id, query.from, query.to)
  })

  app.post('/api/v1/schedule-blocks', {
    schema: { body: objectSchema({ taskId: id, ...blockFields }, ['taskId', 'startsAt', 'endsAt']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return reply.code(201).send(await store.createScheduleBlock(auth.user.id, request.body as { taskId: string; startsAt: string; endsAt: string }, key))
  })

  app.patch('/api/v1/schedule-blocks/:id', {
    schema: { params: idParams, body: objectSchema({ ...blockFields, version }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const result = await store.updateScheduleBlock(auth.user.id, (request.params as { id: string }).id, request.body as { startsAt?: string; endsAt?: string; version: number })
    return result ?? notFound(reply, request, '找不到日程块')
  })

  app.delete('/api/v1/schedule-blocks/:id', { schema: { params: idParams, body: versionBody } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const removed = await store.deleteScheduleBlock(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
    if (!removed) return notFound(reply, request, '找不到日程块')
    return reply.code(204).send()
  })

  app.get('/api/v1/schedule/conflicts', {
    schema: { querystring: objectSchema({ from: instant, to: instant }, ['from', 'to']) },
  }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    const query = request.query as { from: string; to: string }
    return detectScheduleConflicts(await store.listScheduleBlocks(auth.user.id, query.from, query.to))
  })
}
