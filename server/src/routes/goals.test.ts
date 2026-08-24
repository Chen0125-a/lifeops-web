import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { hashPassword } from '../security/password.js'
import { MemoryLifeStore } from '../store/memoryLifeStore.js'

interface AuthenticatedClient {
  get(url: string): ReturnType<FastifyInstance['inject']>
  write(options: InjectOptions, idempotencyKey?: string): ReturnType<FastifyInstance['inject']>
}

function cookieFrom(headers: Record<string, string | string[] | undefined>) {
  const value = headers['set-cookie']
  return (Array.isArray(value) ? value[0] : value)?.split(';')[0] ?? ''
}

describe('goals, projects and milestones routes', () => {
  let app: FastifyInstance
  let store: MemoryLifeStore

  beforeEach(async () => {
    let sequence = 0
    store = new MemoryLifeStore({
      createId: () => `goal-test-${++sequence}`,
      now: () => '2026-08-11T08:00:00.000Z',
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

  async function client(account = 'owner@example.com', password = 'owner-safe-password'): Promise<AuthenticatedClient> {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { account, password } })
    expect(login.statusCode).toBe(200)
    const cookie = cookieFrom(login.headers)
    const csrfToken = login.json<{ csrfToken: string }>().csrfToken
    return {
      get: (url) => app.inject({ method: 'GET', url, headers: { cookie } }),
      write: (options, idempotencyKey) => app.inject({
        ...options,
        headers: {
          ...options.headers,
          cookie,
          'x-csrf-token': csrfToken,
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
      }),
    }
  }

  it('creates and lists one idempotent owner-scoped goal', async () => {
    const owner = await client()
    const request: InjectOptions = {
      method: 'POST',
      url: '/api/v1/goals',
      payload: {
        title: '完成 LifeOps',
        description: '把产品与交付闭环真正做完',
        priority: 1,
        startsOn: '2026-08-11',
        targetOn: '2026-09-30',
        progressMode: 'manual',
        manualProgress: 5,
      },
    }

    const created = await owner.write(request, 'goal-create-1')
    const replay = await owner.write(request, 'goal-create-1')

    expect(created.statusCode).toBe(201)
    expect(replay.statusCode).toBe(201)
    expect(replay.json<{ id: string }>().id).toBe(created.json<{ id: string }>().id)
    expect(created.json()).toMatchObject({
      title: '完成 LifeOps',
      status: 'active',
      priority: 1,
      progressMode: 'manual',
      manualProgress: 5,
      version: 1,
      deletedAt: null,
    })

    const listed = await owner.get('/api/v1/goals')
    expect(listed.statusCode).toBe(200)
    expect(listed.json<Array<{ id: string }>>()).toHaveLength(1)
  })

  it('requires authentication, CSRF and an idempotency key at the route boundary', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/goals' })
    expect(anonymous.statusCode).toBe(401)

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { account: 'owner@example.com', password: 'owner-safe-password' },
    })
    const cookie = cookieFrom(login.headers)
    const withoutCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/goals',
      headers: { cookie, 'idempotency-key': 'goal-no-csrf' },
      payload: { title: '不应保存' },
    })
    expect(withoutCsrf.statusCode).toBe(403)

    const owner = await client()
    const withoutKey = await owner.write({ method: 'POST', url: '/api/v1/goals', payload: { title: '缺少幂等键' } })
    expect(withoutKey.statusCode).toBe(400)
    expect(withoutKey.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_REQUIRED' } })
  })

  it('rejects a stale version and supports pause, completion and explicit reopen', async () => {
    const owner = await client()
    const created = await owner.write({
      method: 'POST',
      url: '/api/v1/goals',
      payload: { title: '分阶段完成 LifeOps', priority: 2 },
    }, 'goal-lifecycle-1')
    expect(created.statusCode).toBe(201)
    const id = created.json<{ id: string }>().id

    const stale = await owner.write({
      method: 'PATCH',
      url: `/api/v1/goals/${id}`,
      payload: { title: '冲突写入', version: 0 },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })

    const paused = await owner.write({ method: 'PATCH', url: `/api/v1/goals/${id}`, payload: { status: 'paused', version: 1 } })
    expect(paused.statusCode).toBe(200)
    expect(paused.json()).toMatchObject({ status: 'paused', version: 2 })

    const completed = await owner.write({ method: 'PATCH', url: `/api/v1/goals/${id}`, payload: { status: 'completed', version: 2 } })
    expect(completed.statusCode).toBe(200)
    expect(completed.json()).toMatchObject({ status: 'completed', version: 3 })

    const rejectedProject = await owner.write({
      method: 'POST',
      url: `/api/v1/goals/${id}/projects`,
      payload: { title: '完成目标下的新活动项目' },
    }, 'project-while-complete')
    expect(rejectedProject.statusCode).toBe(409)
    expect(rejectedProject.json()).toMatchObject({ error: { code: 'GOAL_COMPLETED' } })

    const reopened = await owner.write({ method: 'PATCH', url: `/api/v1/goals/${id}`, payload: { status: 'active', version: 3 } })
    expect(reopened.statusCode).toBe(200)
    expect(reopened.json()).toMatchObject({ status: 'active', version: 4 })
    expect((await owner.write({
      method: 'POST',
      url: `/api/v1/goals/${id}/projects`,
      payload: { title: '重新开始后的项目' },
    }, 'project-after-reopen')).statusCode).toBe(201)
  })

  it('soft-deletes goals and keeps another owner from reading or mutating them', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const created = await owner.write({ method: 'POST', url: '/api/v1/goals', payload: { title: 'Owner 私有目标' } }, 'private-goal')
    expect(created.statusCode).toBe(201)
    const id = created.json<{ id: string }>().id

    expect((await other.get(`/api/v1/goals/${id}`)).statusCode).toBe(404)
    expect((await other.get('/api/v1/goals')).json()).toEqual([])
    expect((await other.write({ method: 'PATCH', url: `/api/v1/goals/${id}`, payload: { title: '越权写入', version: 1 } })).statusCode).toBe(404)

    const removed = await owner.write({ method: 'DELETE', url: `/api/v1/goals/${id}`, payload: { version: 1 } })
    expect(removed.statusCode).toBe(204)
    expect((await owner.get(`/api/v1/goals/${id}`)).statusCode).toBe(404)
    expect((await owner.get('/api/v1/goals')).json()).toEqual([])
  })

  it('supports versioned project lifecycle and ordered milestone completion', async () => {
    const owner = await client()
    const goal = await owner.write({ method: 'POST', url: '/api/v1/goals', payload: { title: '交付项目目标' } }, 'project-goal')
    expect(goal.statusCode).toBe(201)
    const goalId = goal.json<{ id: string }>().id
    const project = await owner.write({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/projects`,
      payload: { title: 'LifeOps Web', description: '产品与交付包', progress: 10 },
    }, 'project-create-1')
    expect(project.statusCode).toBe(201)
    expect(project.json()).toMatchObject({ goalId, status: 'active', progress: 10, version: 1 })
    const projectId = project.json<{ id: string }>().id

    const paused = await owner.write({ method: 'PATCH', url: `/api/v1/projects/${projectId}`, payload: { status: 'paused', version: 1 } })
    expect(paused.statusCode).toBe(200)
    expect(paused.json()).toMatchObject({ status: 'paused', version: 2 })
    expect((await owner.write({ method: 'PATCH', url: `/api/v1/projects/${projectId}`, payload: { progress: 50, version: 1 } })).statusCode).toBe(409)

    const later = await owner.write({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/milestones`,
      payload: { title: '后完成', dueOn: '2026-09-20', position: 20 },
    }, 'milestone-later')
    const earlier = await owner.write({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/milestones`,
      payload: { title: '先完成', dueOn: '2026-09-10', position: 10 },
    }, 'milestone-earlier')
    expect(later.statusCode).toBe(201)
    expect(earlier.statusCode).toBe(201)

    const ordered = await owner.get(`/api/v1/projects/${projectId}/milestones`)
    expect(ordered.statusCode).toBe(200)
    expect(ordered.json<Array<{ title: string }>>().map((item) => item.title)).toEqual(['先完成', '后完成'])

    const milestoneId = earlier.json<{ id: string }>().id
    const completed = await owner.write({
      method: 'PATCH',
      url: `/api/v1/milestones/${milestoneId}`,
      payload: { completedAt: '2026-08-11T09:30:00.000Z', version: 1 },
    })
    expect(completed.statusCode).toBe(200)
    expect(completed.json()).toMatchObject({ completedAt: '2026-08-11T09:30:00.000Z', version: 2 })

    expect((await owner.write({ method: 'DELETE', url: `/api/v1/milestones/${milestoneId}`, payload: { version: 2 } })).statusCode).toBe(204)
    expect((await owner.get(`/api/v1/milestones/${milestoneId}`)).statusCode).toBe(404)
    expect((await owner.write({ method: 'DELETE', url: `/api/v1/projects/${projectId}`, payload: { version: 2 } })).statusCode).toBe(204)
    expect((await owner.get(`/api/v1/projects/${projectId}`)).statusCode).toBe(404)
  })

  it('persists a project risk note independently from its description', async () => {
    const owner = await client()
    const goal = await owner.write({
      method: 'POST',
      url: '/api/v1/goals',
      payload: { title: '交付目标' },
    }, 'project-risk-goal')
    expect(goal.statusCode).toBe(201)

    const project = await owner.write({
      method: 'POST',
      url: `/api/v1/goals/${goal.json<{ id: string }>().id}/projects`,
      payload: {
        title: 'LifeOps Web',
        description: '产品与交付范围',
        riskNote: 'UHub release digests 尚未刷新',
      },
    }, 'project-risk-create')

    expect(project.statusCode).toBe(201)
    expect(project.json()).toMatchObject({
      description: '产品与交付范围',
      riskNote: 'UHub release digests 尚未刷新',
      version: 1,
    })

    const updated = await owner.write({
      method: 'PATCH',
      url: `/api/v1/projects/${project.json<{ id: string }>().id}`,
      payload: { riskNote: 'Docker、GitHub 与 UHub 均需新鲜验证', version: 1 },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({
      description: '产品与交付范围',
      riskNote: 'Docker、GitHub 与 UHub 均需新鲜验证',
      version: 2,
    })
  })

  it('restores archived goals, projects and milestones with the same ids and protected versions', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const goal = await owner.write({
      method: 'POST',
      url: '/api/v1/goals',
      payload: { title: '可恢复目标' },
    }, 'recovery-goal')
    const goalId = goal.json<{ id: string }>().id
    const project = await owner.write({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/projects`,
      payload: { title: '可恢复项目' },
    }, 'recovery-project')
    const projectId = project.json<{ id: string }>().id
    const milestone = await owner.write({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/milestones`,
      payload: { title: '可恢复里程碑', position: 10 },
    }, 'recovery-milestone')
    const milestoneId = milestone.json<{ id: string }>().id

    expect((await owner.write({
      method: 'DELETE',
      url: `/api/v1/milestones/${milestoneId}`,
      payload: { version: 1 },
    })).statusCode).toBe(204)
    const staleMilestone = await owner.write({
      method: 'POST',
      url: `/api/v1/milestones/${milestoneId}/restore`,
      payload: { version: 1 },
    })
    expect(staleMilestone.statusCode).toBe(409)
    expect(staleMilestone.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })
    expect((await other.write({
      method: 'POST',
      url: `/api/v1/milestones/${milestoneId}/restore`,
      payload: { version: 2 },
    })).statusCode).toBe(404)
    const restoredMilestone = await owner.write({
      method: 'POST',
      url: `/api/v1/milestones/${milestoneId}/restore`,
      payload: { version: 2 },
    })
    expect(restoredMilestone.statusCode).toBe(200)
    expect(restoredMilestone.json()).toMatchObject({ id: milestoneId, version: 3, deletedAt: null })

    expect((await owner.write({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}`,
      payload: { version: 1 },
    })).statusCode).toBe(204)
    const restoredProject = await owner.write({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/restore`,
      payload: { version: 2 },
    })
    expect(restoredProject.statusCode).toBe(200)
    expect(restoredProject.json()).toMatchObject({ id: projectId, version: 3, deletedAt: null })

    expect((await owner.write({
      method: 'DELETE',
      url: `/api/v1/goals/${goalId}`,
      payload: { version: 1 },
    })).statusCode).toBe(204)
    const restoredGoal = await owner.write({
      method: 'POST',
      url: `/api/v1/goals/${goalId}/restore`,
      payload: { version: 2 },
    })
    expect(restoredGoal.statusCode).toBe(200)
    expect(restoredGoal.json()).toMatchObject({ id: goalId, version: 3, deletedAt: null })
  })
})
