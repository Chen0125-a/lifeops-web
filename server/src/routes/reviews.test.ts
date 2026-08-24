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

describe('evidence review routes', () => {
  let app: FastifyInstance
  let store: MemoryLifeStore

  beforeEach(async () => {
    let sequence = 0
    store = new MemoryLifeStore({
      createId: () => `review-test-${++sequence}`,
      now: () => '2026-08-08T12:00:00.000Z',
    })
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
        headers: {
          ...options.headers,
          cookie,
          'x-csrf-token': csrf,
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
      }),
    }
  }

  async function createReview(subject: Client, key = 'review-create-1', patch: Record<string, unknown> = {}) {
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/reviews',
      payload: {
        type: 'weekly',
        period: { from: '2026-08-04', to: '2026-08-10' },
        achievements: ['Closed the planned vertical slice.'],
        problems: ['The verification window was narrow.'],
        causes: ['The evidence set was larger than expected.'],
        insights: ['Keep the gate focused and repeatable.'],
        nextChanges: ['Prepare the next red test first.'],
        actions: [{ id: 'action-ship-route', text: 'Ship the review route.' }],
        ...patch,
      },
    }, key)
    expect(response.statusCode).toBe(201)
    return response
  }

  it('creates one idempotent draft and autosaves with optimistic version protection', async () => {
    const owner = await client()
    const first = await createReview(owner)
    const replay = await createReview(owner)
    expect(replay.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id)
    expect(first.json()).toMatchObject({
      type: 'weekly',
      period: { from: '2026-08-04', to: '2026-08-10' },
      status: 'draft',
      achievements: ['Closed the planned vertical slice.'],
      version: 1,
      deletedAt: null,
    })

    const id = first.json<{ id: string }>().id
    const saved = await owner.write({
      method: 'PATCH',
      url: `/api/v1/reviews/${id}`,
      payload: {
        period: { from: '2026-08-05', to: '2026-08-10' },
        insights: ['Autosave preserved this user-authored insight.'],
        version: 1,
      },
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toMatchObject({
      period: { from: '2026-08-05', to: '2026-08-10' },
      evidence: { period: { from: '2026-08-05', to: '2026-08-10' } },
      insights: ['Autosave preserved this user-authored insight.'],
      version: 2,
    })

    const stale = await owner.write({
      method: 'PATCH',
      url: `/api/v1/reviews/${id}`,
      payload: { insights: ['This stale write must not win.'], version: 1 },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })
  })

  it('archives, soft-deletes and restores the same review identity', async () => {
    const owner = await client()
    const created = await createReview(owner)
    const id = created.json<{ id: string }>().id

    const archived = await owner.write({
      method: 'PATCH',
      url: `/api/v1/reviews/${id}`,
      payload: { status: 'archived', version: 1 },
    })
    expect(archived.statusCode).toBe(200)
    expect(archived.json()).toMatchObject({ id, status: 'archived', version: 2 })
    expect((await owner.get('/api/v1/reviews')).json()).toEqual([])
    expect((await owner.get('/api/v1/reviews?includeArchived=true')).json()).toHaveLength(1)

    const removed = await owner.write({ method: 'DELETE', url: `/api/v1/reviews/${id}`, payload: { version: 2 } })
    expect(removed.statusCode).toBe(204)
    expect((await owner.get(`/api/v1/reviews/${id}`)).statusCode).toBe(404)

    const restored = await owner.write({ method: 'POST', url: `/api/v1/reviews/${id}/restore`, payload: { version: 3 } })
    expect(restored.statusCode).toBe(200)
    expect(restored.json()).toMatchObject({ id, status: 'archived', deletedAt: null, version: 4 })
  })

  it('refreshes evidence from persisted facts without replacing user-authored narrative', async () => {
    const owner = await client()
    const task = await owner.write({
      method: 'POST', url: '/api/v1/tasks', payload: { title: 'Completed review evidence task', priority: 1 },
    }, 'review-evidence-task')
    expect(task.statusCode).toBe(201)
    expect((await owner.write({
      method: 'POST', url: `/api/v1/tasks/${task.json<{ id: string }>().id}/complete`, payload: { version: 1 },
    })).statusCode).toBe(200)

    const habit = await owner.write({
      method: 'POST',
      url: '/api/v1/habits',
      payload: {
        title: 'Review evidence habit', measure: 'boolean', timezone: 'Asia/Shanghai',
        schedule: { scheduleType: 'daily', startsOn: '2026-08-01' },
      },
    }, 'review-evidence-habit')
    expect(habit.statusCode).toBe(201)
    expect((await owner.write({
      method: 'PUT',
      url: `/api/v1/habits/${habit.json<{ id: string }>().id}/entries/2026-08-07`,
      payload: { status: 'done', note: 'Persisted fact.' },
    }, 'review-evidence-habit-entry')).statusCode).toBe(201)

    expect((await owner.write({
      method: 'POST',
      url: '/api/v1/records',
      payload: { title: 'Evidence record', body: 'A persisted record.', occurredAt: '2026-08-08T09:00:00.000Z' },
    }, 'review-evidence-record')).statusCode).toBe(201)

    const created = await createReview(owner)
    const refreshed = await owner.write({
      method: 'POST',
      url: `/api/v1/reviews/${created.json<{ id: string }>().id}/refresh-evidence`,
      payload: { version: 1 },
    })
    expect(refreshed.statusCode).toBe(200)
    expect(refreshed.json()).toMatchObject({
      achievements: ['Closed the planned vertical slice.'],
      insights: ['Keep the gate focused and repeatable.'],
      evidence: {
        tasks: { total: 1, completed: 1 },
        habits: { entries: 1, done: 1 },
        records: { total: 1 },
        hasFacts: true,
      },
      version: 2,
    })
  })

  it('converts an action into exactly one task and rejects a second effect', async () => {
    const owner = await client()
    const created = await createReview(owner)
    const reviewId = created.json<{ id: string }>().id
    const url = `/api/v1/reviews/${reviewId}/actions/action-ship-route/convert`

    const converted = await owner.write({ method: 'POST', url, payload: { target: 'task' } }, 'review-action-convert-1')
    expect(converted.statusCode).toBe(201)
    expect(converted.json()).toMatchObject({
      action: { id: 'action-ship-route', status: 'converted', convertedTarget: 'task' },
      target: { type: 'task', title: 'Ship the review route.' },
    })

    const replay = await owner.write({ method: 'POST', url, payload: { target: 'task' } }, 'review-action-convert-1')
    expect(replay.statusCode).toBe(201)
    expect(replay.json<{ target: { id: string } }>().target.id).toBe(converted.json<{ target: { id: string } }>().target.id)

    const repeated = await owner.write({ method: 'POST', url, payload: { target: 'task' } }, 'review-action-convert-2')
    expect(repeated.statusCode).toBe(409)
    expect(repeated.json()).toMatchObject({ error: { code: 'ACTION_ALREADY_CONVERTED' } })
    expect((await owner.get('/api/v1/tasks')).json<Array<{ title: string }>>().filter((item) => item.title === 'Ship the review route.')).toHaveLength(1)
  })

  it('requires write security and keeps reviews owner-scoped', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/reviews' })).statusCode).toBe(401)
    const owner = await client()
    const created = await createReview(owner)
    const id = created.json<{ id: string }>().id
    const other = await client('other@example.com', 'other-safe-password')
    expect((await other.get('/api/v1/reviews')).json()).toEqual([])
    expect((await other.get(`/api/v1/reviews/${id}`)).statusCode).toBe(404)
    expect((await other.write({ method: 'PATCH', url: `/api/v1/reviews/${id}`, payload: { insights: ['Cross-owner write'], version: 1 } })).statusCode).toBe(404)

    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { account: 'owner@example.com', password: 'owner-safe-password' } })
    const cookie = cookieFrom(login.headers)
    expect((await app.inject({
      method: 'PATCH', url: `/api/v1/reviews/${id}`, headers: { cookie }, payload: { insights: ['Missing CSRF'], version: 1 },
    })).statusCode).toBe(403)
  })
})
