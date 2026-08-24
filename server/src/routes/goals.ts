import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateGoalInput,
  CreateMilestoneInput,
  CreateProjectInput,
  UpdateGoalInput,
  UpdateMilestoneInput,
  UpdateProjectInput,
} from '../domain/goals.js'
import type { User } from '../domain/types.js'
import type { LifeStore } from '../store/lifeStore.js'

interface RouteAuth {
  user: User
}

interface GoalsRouteSecurity {
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
const idParams = objectSchema({ id: text(1, 80) }, ['id'])
const goalParams = objectSchema({ goalId: text(1, 80) }, ['goalId'])
const projectParams = objectSchema({ projectId: text(1, 80) }, ['projectId'])
const versionBody = objectSchema({ version: { type: 'integer', minimum: 0 } }, ['version'])
const status = { type: 'string', enum: ['active', 'paused', 'completed', 'cancelled'] }
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
const instant = text(1, 64)
const progress = { type: 'number', minimum: 0, maximum: 100 }

const goalFields = {
  title: text(1, 240),
  description: text(0, 20_000),
  priority: { type: 'integer', enum: [1, 2, 3] },
  startsOn: nullable(date),
  targetOn: nullable(date),
  progressMode: { type: 'string', enum: ['manual', 'task-ratio', 'milestone-ratio'] },
  manualProgress: progress,
}

const projectFields = {
  title: text(1, 240),
  description: text(0, 20_000),
  riskNote: text(0, 20_000),
  status,
  startsOn: nullable(date),
  targetOn: nullable(date),
  progress,
  nextTaskId: nullable(text(1, 80)),
}

const milestoneFields = {
  title: text(1, 240),
  dueOn: nullable(date),
  completedAt: nullable(instant),
  position: { type: 'integer', minimum: 0, maximum: 4_294_967_295 },
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

export function registerGoalsRoutes(
  app: FastifyInstance,
  store: LifeStore,
  security: GoalsRouteSecurity,
) {
  app.get('/api/v1/goals', async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listGoals(auth.user.id)
  })

  app.post('/api/v1/goals', {
    schema: { body: objectSchema(goalFields, ['title']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return reply.code(201).send(await store.createGoal(auth.user.id, request.body as CreateGoalInput, key))
  })

  app.get('/api/v1/goals/:id', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    const result = await store.getGoal(auth.user.id, (request.params as { id: string }).id)
    return result ?? notFound(reply, request, '找不到目标')
  })

  app.patch('/api/v1/goals/:id', {
    schema: { params: idParams, body: objectSchema({ ...goalFields, status, version: { type: 'integer', minimum: 0 } }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const result = await store.updateGoal(auth.user.id, (request.params as { id: string }).id, request.body as UpdateGoalInput)
    return result ?? notFound(reply, request, '找不到目标')
  })

  app.delete('/api/v1/goals/:id', { schema: { params: idParams, body: versionBody } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const removed = await store.deleteGoal(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
    if (!removed) return notFound(reply, request, '找不到目标')
    return reply.code(204).send()
  })

  app.post('/api/v1/goals/:id/restore', { schema: { params: idParams, body: versionBody } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const result = await store.restoreGoal(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
    return result ?? notFound(reply, request, '找不到已归档目标')
  })

  app.get('/api/v1/goals/:goalId/projects', { schema: { params: goalParams } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listProjects(auth.user.id, (request.params as { goalId: string }).goalId)
  })

  app.post('/api/v1/goals/:goalId/projects', {
    schema: { params: goalParams, body: objectSchema(projectFields, ['title']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return reply.code(201).send(await store.createProject(
      auth.user.id,
      (request.params as { goalId: string }).goalId,
      request.body as CreateProjectInput,
      key,
    ))
  })

  app.get('/api/v1/projects/:id', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    const result = await store.getProject(auth.user.id, (request.params as { id: string }).id)
    return result ?? notFound(reply, request, '找不到项目')
  })

  app.patch('/api/v1/projects/:id', {
    schema: { params: idParams, body: objectSchema({ ...projectFields, version: { type: 'integer', minimum: 0 } }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const result = await store.updateProject(auth.user.id, (request.params as { id: string }).id, request.body as UpdateProjectInput)
    return result ?? notFound(reply, request, '找不到项目')
  })

  app.delete('/api/v1/projects/:id', { schema: { params: idParams, body: versionBody } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const removed = await store.deleteProject(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
    if (!removed) return notFound(reply, request, '找不到项目')
    return reply.code(204).send()
  })

  app.post('/api/v1/projects/:id/restore', { schema: { params: idParams, body: versionBody } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const result = await store.restoreProject(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
    return result ?? notFound(reply, request, '找不到已归档项目')
  })

  app.get('/api/v1/projects/:projectId/milestones', { schema: { params: projectParams } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    return store.listMilestones(auth.user.id, (request.params as { projectId: string }).projectId)
  })

  app.post('/api/v1/projects/:projectId/milestones', {
    schema: { params: projectParams, body: objectSchema(milestoneFields, ['title']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const key = idempotencyKey(request, reply)
    if (!key) return
    return reply.code(201).send(await store.createMilestone(
      auth.user.id,
      (request.params as { projectId: string }).projectId,
      request.body as CreateMilestoneInput,
      key,
    ))
  })

  app.get('/api/v1/milestones/:id', { schema: { params: idParams } }, async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    const result = await store.getMilestone(auth.user.id, (request.params as { id: string }).id)
    return result ?? notFound(reply, request, '找不到里程碑')
  })

  app.patch('/api/v1/milestones/:id', {
    schema: { params: idParams, body: objectSchema({ ...milestoneFields, version: { type: 'integer', minimum: 0 } }, ['version']) },
  }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const result = await store.updateMilestone(auth.user.id, (request.params as { id: string }).id, request.body as UpdateMilestoneInput)
    return result ?? notFound(reply, request, '找不到里程碑')
  })

  app.delete('/api/v1/milestones/:id', { schema: { params: idParams, body: versionBody } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const removed = await store.deleteMilestone(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
    if (!removed) return notFound(reply, request, '找不到里程碑')
    return reply.code(204).send()
  })

  app.post('/api/v1/milestones/:id/restore', { schema: { params: idParams, body: versionBody } }, async (request, reply) => {
    const auth = await security.authorizeWrite(request, reply)
    if (!auth) return
    const result = await store.restoreMilestone(auth.user.id, (request.params as { id: string }).id, (request.body as { version: number }).version)
    return result ?? notFound(reply, request, '找不到已归档里程碑')
  })
}
