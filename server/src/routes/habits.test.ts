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

describe('habit and rhythm-entry routes', () => {
  let app: FastifyInstance
  let store: MemoryLifeStore

  beforeEach(async () => {
    let sequence = 0
    store = new MemoryLifeStore({
      createId: () => `habit-test-${++sequence}`,
      now: () => '2026-08-13T08:00:00.000Z',
    })
    await store.createUser({
      account: 'owner@example.com',
      displayName: 'Owner',
      passwordHash: await hashPassword('owner-safe-password'),
    })
    await store.createUser({
      account: 'other@example.com',
      displayName: 'Other',
      passwordHash: await hashPassword('other-safe-password'),
    })
    app = buildApp({
      store,
      config: { cookieName: 'lifeops_session', sessionTtlSeconds: 3600, secureCookies: false },
    })
    await app.ready()
  })

  afterEach(async () => app.close())

  async function client(account = 'owner@example.com', password = 'owner-safe-password'): Promise<Client> {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { account, password },
    })
    expect(login.statusCode).toBe(200)
    const cookie = cookieFrom(login.headers)
    const csrf = login.json<{ csrfToken: string }>().csrfToken
    return {
      get: (url) => app.inject({ method: 'GET', url, headers: { cookie } }),
      write: (options, idempotencyKey) => app.inject({
        ...options,
        headers: {
          ...options.headers,
          cookie,
          'x-csrf-token': csrf,
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
      }),
    }
  }

  async function createGoalAndProject(owner: Client, prefix: string) {
    const goal = await owner.write({
      method: 'POST',
      url: '/api/v1/goals',
      payload: { title: `${prefix}目标` },
    }, `${prefix}-goal`)
    expect(goal.statusCode).toBe(201)
    const goalId = goal.json<{ id: string }>().id
    const project = await owner.write({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/projects`,
      payload: { title: `${prefix}项目` },
    }, `${prefix}-project`)
    expect(project.statusCode).toBe(201)
    return { goalId, projectId: project.json<{ id: string }>().id }
  }

  async function createHabit(owner: Client, patch: Record<string, unknown> = {}, key = 'habit-create-1') {
    const response = await owner.write({
      method: 'POST',
      url: '/api/v1/habits',
      payload: {
        title: '稳定训练',
        description: '按真实节律记录，不做刺激性游戏化',
        measure: 'count',
        unit: '次',
        targetValue: 3,
        timezone: 'Asia/Shanghai',
        schedule: {
          scheduleType: 'weekdays',
          weekdays: [1, 3, 5],
          startsOn: '2026-08-01',
        },
        ...patch,
      },
    }, key)
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string; version: number }>()
  }

  it('creates one idempotent habit with valid owner goal/project links and returns a matrix-ready window', async () => {
    const owner = await client()
    const links = await createGoalAndProject(owner, '节律')
    const request: InjectOptions = {
      method: 'POST',
      url: '/api/v1/habits',
      payload: {
        title: '稳定训练',
        measure: 'count',
        unit: '次',
        targetValue: 3,
        timezone: 'Asia/Shanghai',
        schedule: { scheduleType: 'weekdays', weekdays: [1, 3, 5], startsOn: '2026-08-01' },
        ...links,
      },
    }
    const created = await owner.write(request, 'linked-habit')
    const replay = await owner.write(request, 'linked-habit')

    expect(created.statusCode).toBe(201)
    expect(replay.statusCode).toBe(201)
    expect(replay.json<{ id: string }>().id).toBe(created.json<{ id: string }>().id)
    expect(created.json()).toMatchObject({
      ...links,
      title: '稳定训练',
      status: 'active',
      pausedAt: null,
      version: 1,
      deletedAt: null,
    })

    const window = await owner.get('/api/v1/habits?from=2026-08-01&to=2026-08-28')
    expect(window.statusCode).toBe(200)
    expect(window.json()).toMatchObject({
      from: '2026-08-01',
      to: '2026-08-28',
      habits: [{ id: created.json<{ id: string }>().id, ...links }],
      entries: [],
    })
  })

  it('enforces authentication, CSRF and create idempotency at the route boundary', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/habits' })).statusCode).toBe(401)

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { account: 'owner@example.com', password: 'owner-safe-password' },
    })
    const cookie = cookieFrom(login.headers)
    const withoutCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/habits',
      headers: { cookie, 'idempotency-key': 'habit-no-csrf' },
      payload: {
        title: '不应保存',
        measure: 'boolean',
        timezone: 'Asia/Shanghai',
        schedule: { scheduleType: 'daily', startsOn: '2026-08-01' },
      },
    })
    expect(withoutCsrf.statusCode).toBe(403)

    const owner = await client()
    const withoutKey = await owner.write({
      method: 'POST',
      url: '/api/v1/habits',
      payload: {
        title: '缺少幂等键',
        measure: 'boolean',
        timezone: 'Asia/Shanghai',
        schedule: { scheduleType: 'daily', startsOn: '2026-08-01' },
      },
    })
    expect(withoutKey.statusCode).toBe(400)
    expect(withoutKey.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_REQUIRED' } })
  })

  it('edits, clears links, rejects a stale version, pauses and archives without deleting the habit', async () => {
    const owner = await client()
    const links = await createGoalAndProject(owner, '生命周期')
    const habit = await createHabit(owner, links, 'habit-lifecycle')

    const cleared = await owner.write({
      method: 'PATCH',
      url: `/api/v1/habits/${habit.id}`,
      payload: { title: '稳定训练（已调整）', goalId: null, projectId: null, version: 1 },
    })
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json()).toMatchObject({ title: '稳定训练（已调整）', goalId: null, projectId: null, version: 2 })

    const stale = await owner.write({
      method: 'PATCH',
      url: `/api/v1/habits/${habit.id}`,
      payload: { title: '冲突写入', version: 1 },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })

    const paused = await owner.write({
      method: 'PATCH',
      url: `/api/v1/habits/${habit.id}`,
      payload: { status: 'paused', version: 2 },
    })
    expect(paused.statusCode).toBe(200)
    expect(paused.json()).toMatchObject({ status: 'paused', pausedAt: '2026-08-13T08:00:00.000Z', version: 3 })

    const archived = await owner.write({
      method: 'PATCH',
      url: `/api/v1/habits/${habit.id}`,
      payload: { status: 'archived', version: 3 },
    })
    expect(archived.statusCode).toBe(200)
    expect(archived.json()).toMatchObject({ status: 'archived', version: 4, deletedAt: null })
    expect((await owner.get(`/api/v1/habits/${habit.id}`)).statusCode).toBe(200)
  })

  it('upserts one dated entry idempotently and corrects it with optimistic versioning', async () => {
    const owner = await client()
    const habit = await createHabit(owner)
    const request: InjectOptions = {
      method: 'PUT',
      url: `/api/v1/habits/${habit.id}/entries/2026-08-13`,
      payload: { status: 'done', value: 3, note: '按计划完成' },
    }
    const created = await owner.write(request, 'habit-entry-2026-08-13')
    const replay = await owner.write(request, 'habit-entry-2026-08-13')
    expect(created.statusCode).toBe(201)
    expect(replay.statusCode).toBe(201)
    expect(replay.json<{ id: string }>().id).toBe(created.json<{ id: string }>().id)

    const corrected = await owner.write({
      method: 'PUT',
      url: `/api/v1/habits/${habit.id}/entries/2026-08-13`,
      payload: { status: 'partial', value: 2, note: '复核后修正', version: 1 },
    })
    expect(corrected.statusCode).toBe(200)
    expect(corrected.json()).toMatchObject({
      id: created.json<{ id: string }>().id,
      habitId: habit.id,
      entryDate: '2026-08-13',
      status: 'partial',
      value: 2,
      note: '复核后修正',
      version: 2,
    })

    const window = await owner.get('/api/v1/habits?from=2026-08-01&to=2026-08-28')
    expect(window.json<{ entries: Array<{ status: string }> }>().entries).toHaveLength(1)
    expect(window.json<{ entries: Array<{ status: string }> }>().entries[0].status).toBe('partial')
  })

  it('isolates owners and rejects cross-owner or mismatched goal/project links', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const ownerLinks = await createGoalAndProject(owner, 'Owner')
    const otherLinks = await createGoalAndProject(other, 'Other')
    const secondOwnerProject = await createGoalAndProject(owner, '另一个')
    const habit = await createHabit(owner, ownerLinks, 'owner-private-habit')

    expect((await other.get('/api/v1/habits')).json()).toEqual({
      from: null,
      to: null,
      habits: [],
      entries: [],
    })
    expect((await other.get(`/api/v1/habits/${habit.id}`)).statusCode).toBe(404)
    expect((await other.write({
      method: 'PATCH',
      url: `/api/v1/habits/${habit.id}`,
      payload: { title: '越权修改', version: 1 },
    })).statusCode).toBe(404)

    const crossOwner = await owner.write({
      method: 'POST',
      url: '/api/v1/habits',
      payload: {
        title: '跨用户引用',
        measure: 'boolean',
        timezone: 'Asia/Shanghai',
        schedule: { scheduleType: 'daily', startsOn: '2026-08-01' },
        ...otherLinks,
      },
    }, 'cross-owner-habit')
    expect(crossOwner.statusCode).toBe(404)

    const mismatched = await owner.write({
      method: 'POST',
      url: '/api/v1/habits',
      payload: {
        title: '错误层级引用',
        measure: 'boolean',
        timezone: 'Asia/Shanghai',
        schedule: { scheduleType: 'daily', startsOn: '2026-08-01' },
        goalId: ownerLinks.goalId,
        projectId: secondOwnerProject.projectId,
      },
    }, 'mismatched-habit')
    expect(mismatched.statusCode).toBe(400)
    expect(mismatched.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } })
  })
})
