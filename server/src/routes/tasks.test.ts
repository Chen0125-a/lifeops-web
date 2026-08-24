import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { hashPassword } from '../security/password.js'
import { MemoryLifeStore } from '../store/memoryLifeStore.js'

interface Client {
  get(url: string): ReturnType<FastifyInstance['inject']>
  write(options: InjectOptions, idempotencyKey?: string): ReturnType<FastifyInstance['inject']>
}

function cookieFrom(headers: Record<string, string | string[] | undefined>) {
  const value = headers['set-cookie']
  return (Array.isArray(value) ? value[0] : value)?.split(';')[0] ?? ''
}

describe('task, checklist and schedule routes', () => {
  let app: FastifyInstance
  let store: MemoryLifeStore

  beforeEach(async () => {
    let sequence = 0
    store = new MemoryLifeStore({ createId: () => `task-test-${++sequence}`, now: () => '2026-08-11T08:00:00.000Z' })
    await store.createUser({ account: 'owner@example.com', displayName: 'Owner', passwordHash: await hashPassword('owner-safe-password') })
    await store.createUser({ account: 'other@example.com', displayName: 'Other', passwordHash: await hashPassword('other-safe-password') })
    app = buildApp({ store, config: { cookieName: 'lifeops_session', sessionTtlSeconds: 3600, secureCookies: false } })
    await app.ready()
  })

  afterEach(async () => app.close())

  async function client(account = 'owner@example.com', password = 'owner-safe-password'): Promise<Client> {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { account, password } })
    expect(login.statusCode).toBe(200)
    const cookie = cookieFrom(login.headers)
    const csrf = login.json<{ csrfToken: string }>().csrfToken
    return {
      get: (url) => app.inject({ method: 'GET', url, headers: { cookie } }),
      write: (options, idempotencyKey) => app.inject({
        ...options,
        headers: { ...options.headers, cookie, 'x-csrf-token': csrf, ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
      }),
    }
  }

  async function createTask(owner: Client, key: string, title = '实现任务领域') {
    const response = await owner.write({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: { title, priority: 1, tags: ['lifeops'], estimateMinutes: 90 },
    }, key)
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string; version: number }>()
  }

  it('creates and lists one idempotent owner-scoped task', async () => {
    const owner = await client()
    const request: InjectOptions = { method: 'POST', url: '/api/v1/tasks', payload: { title: '写任务 API', priority: 1 } }
    const [created, replay] = await Promise.all([
      owner.write(request, 'task-create-1'),
      owner.write(request, 'task-create-1'),
    ])
    expect(created.statusCode).toBe(201)
    expect(replay.statusCode).toBe(201)
    expect(replay.json<{ id: string }>().id).toBe(created.json<{ id: string }>().id)
    expect((await owner.get('/api/v1/tasks')).json<Array<{ id: string }>>()).toHaveLength(1)

    const other = await client('other@example.com', 'other-safe-password')
    expect((await other.get('/api/v1/tasks')).json()).toEqual([])
    expect((await other.get(`/api/v1/tasks/${created.json<{ id: string }>().id}`)).statusCode).toBe(404)
  })

  it('coalesces concurrent memory-store creates with the same idempotency key', async () => {
    const owner = await store.findUserByAccount('owner@example.com')
    expect(owner).toBeDefined()
    const input = { title: '并发幂等任务', priority: 1 as const }
    const [first, second] = await Promise.all([
      store.createTask(owner!.id, input, 'concurrent-memory-task'),
      store.createTask(owner!.id, input, 'concurrent-memory-task'),
    ])
    expect(second.id).toBe(first.id)
    expect(await store.listTasks(owner!.id)).toHaveLength(1)
  })

  it('accepts keyboard-equivalent date/status patches and rejects stale versions', async () => {
    const owner = await client()
    const created = await createTask(owner, 'task-keyboard-1')
    const moved = await owner.write({
      method: 'PATCH',
      url: `/api/v1/tasks/${created.id}`,
      payload: {
        startsAt: '2026-08-12T09:00:00.000Z',
        endsAt: '2026-08-12T10:30:00.000Z',
        dueAt: '2026-08-12T11:00:00.000Z',
        status: 'planned',
        version: 1,
      },
    })
    expect(moved.statusCode).toBe(200)
    expect(moved.json()).toMatchObject({ startsAt: '2026-08-12T09:00:00.000Z', endsAt: '2026-08-12T10:30:00.000Z', status: 'planned', version: 2 })
    const stale = await owner.write({ method: 'PATCH', url: `/api/v1/tasks/${created.id}`, payload: { title: '冲突', version: 1 } })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })
  })

  it('orders checklist items and supports complete plus undo without losing them', async () => {
    const owner = await client()
    const task = await createTask(owner, 'task-checklist-1')
    const later = await owner.write({ method: 'POST', url: `/api/v1/tasks/${task.id}/checklist`, payload: { title: '后做', position: 20 } }, 'check-later')
    const earlier = await owner.write({ method: 'POST', url: `/api/v1/tasks/${task.id}/checklist`, payload: { title: '先做', position: 10 } }, 'check-earlier')
    expect(later.statusCode).toBe(201)
    expect(earlier.statusCode).toBe(201)

    const itemId = earlier.json<{ id: string }>().id
    expect((await owner.write({ method: 'PATCH', url: `/api/v1/tasks/${task.id}/checklist/${itemId}`, payload: { isCompleted: true, version: 1 } })).statusCode).toBe(200)
    const completed = await owner.write({ method: 'POST', url: `/api/v1/tasks/${task.id}/complete`, payload: { version: 1 } })
    expect(completed.json()).toMatchObject({ status: 'done', version: 2 })
    const undone = await owner.write({ method: 'DELETE', url: `/api/v1/tasks/${task.id}/complete`, payload: { version: 2 } })
    expect(undone.json()).toMatchObject({ status: 'planned', completedAt: null, version: 3 })
    const fetched = await owner.get(`/api/v1/tasks/${task.id}`)
    expect(fetched.json<{ checklist: Array<{ title: string }> }>().checklist.map((item) => item.title)).toEqual(['先做', '后做'])
  })

  it('moves and resizes schedule blocks and reports only real overlaps', async () => {
    const owner = await client()
    const firstTask = await createTask(owner, 'schedule-task-1', '第一任务')
    const secondTask = await createTask(owner, 'schedule-task-2', '第二任务')
    const first = await owner.write({
      method: 'POST', url: '/api/v1/schedule-blocks',
      payload: { taskId: firstTask.id, startsAt: '2026-08-11T09:00:00.000Z', endsAt: '2026-08-11T10:00:00.000Z' },
    }, 'block-1')
    const second = await owner.write({
      method: 'POST', url: '/api/v1/schedule-blocks',
      payload: { taskId: secondTask.id, startsAt: '2026-08-11T10:00:00.000Z', endsAt: '2026-08-11T11:00:00.000Z' },
    }, 'block-2')
    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect((await owner.get('/api/v1/schedule/conflicts?from=2026-08-11T00%3A00%3A00.000Z&to=2026-08-12T00%3A00%3A00.000Z')).json()).toEqual([])

    const blockId = second.json<{ id: string }>().id
    const moved = await owner.write({
      method: 'PATCH', url: `/api/v1/schedule-blocks/${blockId}`,
      payload: { startsAt: '2026-08-11T09:30:00.000Z', endsAt: '2026-08-11T10:30:00.000Z', version: 1 },
    })
    expect(moved.json()).toMatchObject({ startsAt: '2026-08-11T09:30:00.000Z', endsAt: '2026-08-11T10:30:00.000Z', version: 2 })
    expect((await owner.get('/api/v1/schedule/conflicts?from=2026-08-11T00%3A00%3A00.000Z&to=2026-08-12T00%3A00%3A00.000Z')).json())
      .toEqual([{ leftId: first.json<{ id: string }>().id, rightId: blockId, overlapMinutes: 30 }])
  })

  it('requires write security and soft-deletes the owner task by version', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/tasks' })
    expect(anonymous.statusCode).toBe(401)
    const owner = await client()
    expect((await owner.write({ method: 'POST', url: '/api/v1/tasks', payload: { title: '缺少幂等键' } })).statusCode).toBe(400)
    const created = await createTask(owner, 'task-delete-1')
    expect((await owner.write({ method: 'DELETE', url: `/api/v1/tasks/${created.id}`, payload: { version: 1 } })).statusCode).toBe(204)
    expect((await owner.get(`/api/v1/tasks/${created.id}`)).statusCode).toBe(404)
  })
})
