import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { hashPassword } from '../security/password.js'
import { MemoryLifeStore } from '../store/memoryLifeStore.js'

interface Client {
  get(url: string): ReturnType<FastifyInstance['inject']>
  write(options: InjectOptions): ReturnType<FastifyInstance['inject']>
}

function cookieFrom(headers: Record<string, string | string[] | undefined>) {
  const value = headers['set-cookie']
  return (Array.isArray(value) ? value[0] : value)?.split(';')[0] ?? ''
}

describe('knowledge routes', () => {
  let app: FastifyInstance
  let sequence = 0

  beforeEach(async () => {
    sequence = 0
    const store = new MemoryLifeStore({
      createId: () => `knowledge-test-${++sequence}`,
      now: () => '2026-08-22T08:00:00.000Z',
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
      write: (options) => app.inject({ ...options, headers: { ...options.headers, cookie, 'x-csrf-token': csrf } }),
    }
  }

  async function createNote(subject: Client, patch: Record<string, unknown> = {}) {
    return subject.write({
      method: 'POST',
      url: '/api/v1/knowledge',
      payload: {
        title: '高可用复盘',
        body: '从回顾中沉淀的 K8s 知识。',
        tags: ['k8s', 'review'],
        reviewOn: '2026-08-20',
        sourceLinks: [{ type: 'review', id: 'review-1' }],
        ...patch,
      },
    })
  }

  it('creates direct and derived notes and searches title/body/tags/source', async () => {
    const owner = await client()
    const direct = await createNote(owner, { title: '直接知识', sourceLinks: [] })
    expect(direct.statusCode).toBe(201)
    expect(direct.json()).toMatchObject({ title: '直接知识', sourceLinks: [], version: 1, deletedAt: null })

    const sourceReview = await owner.write({
      method: 'POST',
      url: '/api/v1/reviews',
      headers: { 'idempotency-key': 'knowledge-source-review' },
      payload: { type: 'custom', period: { from: '2026-08-20', to: '2026-08-20' }, insights: ['可复用结论'] },
    })
    expect(sourceReview.statusCode).toBe(201)
    const sourceReviewId = sourceReview.json<{ id: string }>().id
    const derived = await createNote(owner, { sourceLinks: [{ type: 'review', id: sourceReviewId }] })
    expect(derived.statusCode).toBe(201)
    expect(derived.json()).toMatchObject({ sourceLinks: [{ type: 'review', id: sourceReviewId }] })

    const searched = await owner.get('/api/v1/knowledge?q=高可用&tag=k8s&source=review')
    expect(searched.statusCode).toBe(200)
    expect(searched.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id)).toEqual([
      derived.json<{ id: string }>().id,
    ])
  })

  it('creates and edits collections and adds/removes cycle-tolerant relations', async () => {
    const owner = await client()
    const collection = await owner.write({ method: 'POST', url: '/api/v1/knowledge/collections', payload: { name: '平台工程', color: '#2F6B55' } })
    expect(collection.statusCode).toBe(201)
    const collectionId = collection.json<{ id: string }>().id
    const moved = await owner.write({ method: 'PATCH', url: `/api/v1/knowledge/collections/${collectionId}`, payload: { name: '系统工程', color: '#315E52', position: 2, version: 1 } })
    expect(moved.json()).toMatchObject({ name: '系统工程', position: 2, version: 2 })

    const first = await createNote(owner, { title: '节点 A', collectionIds: [collectionId], sourceLinks: [] })
    const second = await createNote(owner, { title: '节点 B', sourceLinks: [] })
    const firstId = first.json<{ id: string; version: number }>().id
    const secondId = second.json<{ id: string; version: number }>().id
    const related = await owner.write({ method: 'POST', url: `/api/v1/knowledge/${firstId}/relations`, payload: { relatedId: secondId, version: 1 } })
    expect(related.json()).toMatchObject({ id: firstId, relatedIds: [secondId], version: 2 })
    const cycle = await owner.write({ method: 'POST', url: `/api/v1/knowledge/${secondId}/relations`, payload: { relatedId: firstId, version: 1 } })
    expect(cycle.statusCode).toBe(200)
    const removed = await owner.write({ method: 'DELETE', url: `/api/v1/knowledge/${firstId}/relations`, payload: { relatedId: secondId, version: 2 } })
    expect(removed.json()).toMatchObject({ relatedIds: [], version: 3 })
  })

  it('versions edits, pin/favorite/archive/delete/restore and due resurfacing', async () => {
    const owner = await client()
    const created = await createNote(owner, { sourceLinks: [] })
    expect(created.statusCode).toBe(201)
    const id = created.json<{ id: string }>().id

    const edited = await owner.write({ method: 'PATCH', url: `/api/v1/knowledge/${id}`, payload: { title: '更新后的知识', pinned: true, favorite: true, version: 1 } })
    expect(edited.json()).toMatchObject({ title: '更新后的知识', pinned: true, favorite: true, version: 2 })
    const stale = await owner.write({ method: 'PATCH', url: `/api/v1/knowledge/${id}`, payload: { title: '陈旧写入', version: 1 } })
    expect(stale.statusCode).toBe(409)

    const resurfaced = await owner.get('/api/v1/knowledge/resurface')
    expect(resurfaced.json<Array<{ id: string }>>().map((item) => item.id)).toContain(id)
    const archived = await owner.write({ method: 'POST', url: `/api/v1/knowledge/${id}/archive`, payload: { version: 2 } })
    expect(archived.json()).toMatchObject({ id, version: 3 })
    expect((await owner.get('/api/v1/knowledge')).json<{ items: unknown[] }>().items).toEqual([])

    const removed = await owner.write({ method: 'DELETE', url: `/api/v1/knowledge/${id}`, payload: { version: 3 } })
    expect(removed.statusCode).toBe(204)
    expect((await owner.get(`/api/v1/knowledge/${id}`)).statusCode).toBe(404)
    const restored = await owner.write({ method: 'POST', url: `/api/v1/knowledge/${id}/restore`, payload: { version: 4 } })
    expect(restored.json()).toMatchObject({ id, archivedAt: null, deletedAt: null, version: 5 })
  })

  it('requires authentication/CSRF and keeps notes and collections owner-scoped', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/knowledge' })).statusCode).toBe(401)
    const owner = await client()
    const created = await createNote(owner, { sourceLinks: [] })
    const id = created.json<{ id: string }>().id
    const other = await client('other@example.com', 'other-safe-password')
    expect((await other.get('/api/v1/knowledge')).json()).toEqual({ items: [] })
    expect((await other.get(`/api/v1/knowledge/${id}`)).statusCode).toBe(404)
    expect((await other.write({ method: 'PATCH', url: `/api/v1/knowledge/${id}`, payload: { title: 'cross owner', version: 1 } })).statusCode).toBe(404)

    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { account: 'owner@example.com', password: 'owner-safe-password' } })
    const cookie = cookieFrom(login.headers)
    expect((await app.inject({ method: 'PATCH', url: `/api/v1/knowledge/${id}`, headers: { cookie }, payload: { title: 'missing csrf', version: 1 } })).statusCode).toBe(403)
  })
})
