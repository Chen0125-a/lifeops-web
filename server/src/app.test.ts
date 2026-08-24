import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { MemoryLifeStore } from './store/memoryLifeStore.js'
import { hashPassword } from './security/password.js'

const getCookie = (headers: Record<string, string | string[] | undefined>) => {
  const value = headers['set-cookie']
  return (Array.isArray(value) ? value[0] : value)?.split(';')[0] ?? ''
}

describe('LifeOps API', () => {
  let app: FastifyInstance
  let store: MemoryLifeStore

  beforeEach(async () => {
    let sequence = 0
    store = new MemoryLifeStore({
      createId: () => `id-${++sequence}`,
      now: () => '2026-08-09T02:00:00.000Z',
    })
    await store.createUser({
      account: 'owner@example.com',
      displayName: 'LifeOps Owner',
      passwordHash: await hashPassword('correct-horse-battery-staple'),
    })
    app = buildApp({
      store,
      config: { cookieName: 'lifeops_session', sessionTtlSeconds: 3600, secureCookies: false },
    })
    await app.ready()
  })

  afterEach(async () => app.close())

  it('establishes an opaque server session and requires CSRF on writes', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { account: 'owner@example.com', password: 'correct-horse-battery-staple' },
    })

    expect(login.statusCode).toBe(200)
    expect(login.headers['set-cookie']).toContain('HttpOnly')
    expect(login.headers['set-cookie']).toContain('SameSite=Lax')
    const cookie = getCookie(login.headers)
    const { csrfToken } = login.json<{ csrfToken: string }>()

    const withoutCsrf = await app.inject({ method: 'POST', url: '/api/v1/plans', headers: { cookie }, payload: { title: '不会被保存' } })
    expect(withoutCsrf.statusCode).toBe(403)

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { title: '把认证和数据真正接起来' },
    })
    expect(created.statusCode).toBe(201)

    const state = await app.inject({ method: 'GET', url: '/api/v1/state', headers: { cookie } })
    expect(state.json<{ plans: Array<{ title: string }> }>().plans[0].title).toBe('把认证和数据真正接起来')
  })

  it('publishes only an explicit snapshot copy and revokes it immediately', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { account: 'owner@example.com', password: 'correct-horse-battery-staple' } })
    const cookie = getCookie(login.headers)
    const { csrfToken } = login.json<{ csrfToken: string }>()
    const authHeaders = { cookie, 'x-csrf-token': csrfToken }

    const plan = await app.inject({ method: 'POST', url: '/api/v1/plans', headers: authHeaders, payload: { title: '私人原文标题' } })
    const planId = plan.json<{ id: string }>().id
    const draft = await app.inject({
      method: 'POST',
      url: '/api/v1/snapshots',
      headers: authHeaders,
      payload: { sourceType: 'plan', sourceId: planId, title: '可公开标题', excerpt: '只有这段经过确认的摘要可以公开。' },
    })
    const snapshot = draft.json<{ id: string; slug: string }>()

    expect((await app.inject({ method: 'GET', url: `/api/v1/public/snapshots/${snapshot.slug}` })).statusCode).toBe(404)
    await app.inject({ method: 'POST', url: `/api/v1/snapshots/${snapshot.id}/publish`, headers: authHeaders })
    const published = await app.inject({ method: 'GET', url: `/api/v1/public/snapshots/${snapshot.slug}` })
    expect(published.statusCode).toBe(200)
    expect(published.body).toContain('可公开标题')
    expect(published.body).not.toContain('私人原文标题')

    await app.inject({ method: 'POST', url: `/api/v1/snapshots/${snapshot.id}/revoke`, headers: authHeaders })
    expect((await app.inject({ method: 'GET', url: `/api/v1/public/snapshots/${snapshot.slug}` })).statusCode).toBe(404)
  })

  it('keeps legacy plan and snapshot reads while domain writes stay on their owned routes', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { account: 'owner@example.com', password: 'correct-horse-battery-staple' },
    })
    const cookie = getCookie(login.headers)
    const csrfToken = login.json<{ csrfToken: string }>().csrfToken
    const writeHeaders = { cookie, 'x-csrf-token': csrfToken }

    const legacyPlan = await app.inject({
      method: 'POST',
      url: '/api/v1/plans',
      headers: writeHeaders,
      payload: { title: '兼容计划读模型' },
    })
    expect(legacyPlan.statusCode).toBe(201)
    const legacyPlanId = legacyPlan.json<{ id: string }>().id
    expect((await app.inject({
      method: 'POST',
      url: `/api/v1/plans/${legacyPlanId}/complete`,
      headers: writeHeaders,
    })).statusCode).toBe(200)

    const domainTask = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { ...writeHeaders, 'idempotency-key': 'p1-compat-domain-task' },
      payload: { title: '新写入只走任务领域', priority: 1 },
    })
    expect(domainTask.statusCode).toBe(201)
    const domainTaskId = domainTask.json<{ id: string }>().id
    expect((await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${domainTaskId}`,
      headers: { cookie },
    })).json()).toMatchObject({ id: domainTaskId, title: '新写入只走任务领域' })

    const draft = await app.inject({
      method: 'POST',
      url: '/api/v1/snapshots',
      headers: writeHeaders,
      payload: {
        sourceType: 'plan', sourceId: legacyPlanId,
        title: '兼容公开副本', excerpt: '只读取明确发布的副本。',
      },
    })
    expect(draft.statusCode).toBe(201)
    const snapshot = draft.json<{ id: string; slug: string }>()
    expect((await app.inject({
      method: 'POST',
      url: `/api/v1/snapshots/${snapshot.id}/publish`,
      headers: writeHeaders,
    })).statusCode).toBe(200)

    const legacyState = await app.inject({ method: 'GET', url: '/api/v1/state', headers: { cookie } })
    expect(legacyState.statusCode).toBe(200)
    expect(legacyState.json<{ plans: Array<{ id: string; title: string; status: string }> }>().plans).toEqual([
      expect.objectContaining({ id: legacyPlanId, title: '兼容计划读模型', status: 'done' }),
    ])
    expect(legacyState.body).not.toContain('新写入只走任务领域')

    const publicRead = await app.inject({
      method: 'GET',
      url: `/api/v1/public/snapshots/${snapshot.slug}`,
    })
    expect(publicRead.statusCode).toBe(200)
    expect(publicRead.json()).toMatchObject({
      slug: snapshot.slug, title: '兼容公开副本', excerpt: '只读取明确发布的副本。',
    })
  })

  it('never returns another user private state', async () => {
    await store.createUser({ account: 'other@example.com', displayName: 'Other', passwordHash: await hashPassword('another-safe-password') })
    const firstLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { account: 'owner@example.com', password: 'correct-horse-battery-staple' } })
    const firstCookie = getCookie(firstLogin.headers)
    const firstCsrf = firstLogin.json<{ csrfToken: string }>().csrfToken
    await app.inject({ method: 'POST', url: '/api/v1/plans', headers: { cookie: firstCookie, 'x-csrf-token': firstCsrf }, payload: { title: '只属于 owner' } })

    const secondLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { account: 'other@example.com', password: 'another-safe-password' } })
    const secondState = await app.inject({ method: 'GET', url: '/api/v1/state', headers: { cookie: getCookie(secondLogin.headers) } })
    expect(secondState.json<{ plans: unknown[] }>().plans).toEqual([])
  })

  it('rate limits repeated invalid logins without revealing whether an account exists', async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { account: 'missing@example.com', password: 'definitely-wrong-password' } })
      expect(response.statusCode).toBe(401)
      expect(response.json<{ error: { code: string } }>().error.code).toBe('INVALID_CREDENTIALS')
    }
    const limited = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { account: 'missing@example.com', password: 'definitely-wrong-password' } })
    expect(limited.statusCode).toBe(429)
    expect(limited.headers['retry-after']).toBeDefined()
  })

  it('shares login failure limits across API replicas that use the same store', async () => {
    const secondApp = buildApp({
      store,
      config: { cookieName: 'lifeops_session', sessionTtlSeconds: 3600, secureCookies: false },
    })
    await secondApp.ready()
    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const replica = attempt % 2 === 0 ? app : secondApp
        const response = await replica.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { account: 'missing@example.com', password: 'definitely-wrong-password' },
        })
        expect(response.statusCode).toBe(401)
      }
      const limited = await secondApp.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { account: 'missing@example.com', password: 'definitely-wrong-password' },
      })
      expect(limited.statusCode).toBe(429)
    } finally {
      await secondApp.close()
    }
  })
})
