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

describe('publishing routes', () => {
  let app: FastifyInstance
  let store: MemoryLifeStore
  let sequence = 0

  beforeEach(async () => {
    sequence = 0
    store = new MemoryLifeStore({ createId: () => `publishing-${++sequence}`, now: () => '2026-08-22T10:00:00.000Z' })
    await store.createUser({ account: 'owner@example.com', displayName: 'Owner', passwordHash: await hashPassword('owner-safe-password') })
    await store.createUser({ account: 'other@example.com', displayName: 'Other', passwordHash: await hashPassword('other-safe-password') })
    app = buildApp({
      store,
      config: {
        cookieName: 'lifeops_session', sessionTtlSeconds: 3600, secureCookies: false,
        ...({ publicOrigin: 'https://lifeops.example.test' } as Record<string, string>),
      },
    })
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

  const standalone = {
    category: 'learning',
    slug: 'release-gate',
    title: '发布门禁',
    excerpt: '只公开批准字段。',
    body: '# 发布门禁',
    coverUrl: null,
    tags: ['k8s'],
    featured: true,
    seo: { title: '发布门禁', description: '门禁摘要' },
  }

  it('creates standalone and source-derived drafts, previews explicit public fields and remains owner scoped', async () => {
    const owner = await client()
    const direct = await owner.write({ method: 'POST', url: '/api/v1/publishing/drafts', payload: standalone })
    expect(direct.statusCode).toBe(201)
    expect(direct.json()).toMatchObject({ ...standalone, status: 'draft', version: 1, source: null })

    const knowledge = await owner.write({
      method: 'POST',
      url: '/api/v1/knowledge',
      payload: { title: '私有知识标题', body: '来源正文', tags: ['source'], sourceLinks: [] },
    })
    expect(knowledge.statusCode).toBe(201)
    const derived = await owner.write({
      method: 'POST',
      url: '/api/v1/publishing/drafts',
      payload: { category: 'learning', slug: 'derived-note', source: { type: 'knowledge', id: knowledge.json<{ id: string }>().id } },
    })
    expect(derived.statusCode).toBe(201)
    expect(derived.json()).toMatchObject({ title: '私有知识标题', body: '来源正文', source: { type: 'knowledge', version: 1 } })

    const preview = await owner.write({ method: 'POST', url: `/api/v1/publishing/drafts/${derived.json<{ id: string }>().id}/preview` })
    expect(Object.keys(preview.json()).sort()).toEqual([
      'body', 'category', 'coverUrl', 'excerpt', 'featured', 'publishedAt', 'revision', 'slug', 'tags', 'title', 'updatedAt',
    ])
    expect(preview.body).not.toContain('"source":')

    const other = await client('other@example.com', 'other-safe-password')
    expect((await other.get('/api/v1/publishing/drafts')).json()).toEqual([])
    expect((await other.get(`/api/v1/publishing/drafts/${direct.json<{ id: string }>().id}`)).statusCode).toBe(404)
  })

  it('publishes immediately, updates into a new immutable revision and returns a public-only diff', async () => {
    const owner = await client()
    const created = await owner.write({ method: 'POST', url: '/api/v1/publishing/drafts', payload: standalone })
    const id = created.json<{ id: string }>().id
    const published = await owner.write({ method: 'POST', url: `/api/v1/publishing/drafts/${id}/publish`, payload: { version: 1 } })
    expect(published.statusCode).toBe(200)
    expect(published.json()).toMatchObject({ draftId: id, revision: 1 })

    const publicFirst = await app.inject({ method: 'GET', url: '/api/v1/public/content/release-gate' })
    expect(publicFirst.statusCode).toBe(200)
    expect(Object.keys(publicFirst.json()).sort()).toEqual([
      'body', 'category', 'coverUrl', 'excerpt', 'featured', 'publishedAt', 'revision', 'slug', 'tags', 'title', 'updatedAt',
    ])

    const edited = await owner.write({ method: 'PATCH', url: `/api/v1/publishing/drafts/${id}`, payload: { title: '发布门禁 v2', tags: ['revision'], version: 2 } })
    expect(edited.json()).toMatchObject({ title: '发布门禁 v2', status: 'draft', version: 3 })
    const republished = await owner.write({ method: 'POST', url: `/api/v1/publishing/drafts/${id}/publish`, payload: { version: 3 } })
    expect(republished.json()).toMatchObject({ revision: 2 })

    const history = await owner.get(`/api/v1/publishing/drafts/${id}/revisions`)
    expect(history.json<Array<{ revision: number }>>().map(({ revision }) => revision)).toEqual([2, 1])
    const diff = await owner.get(`/api/v1/publishing/drafts/${id}/revisions/diff?from=1&to=2`)
    expect(diff.json()).toMatchObject({ from: 1, to: 2, changed: expect.arrayContaining([{ field: 'title', before: '发布门禁', after: '发布门禁 v2' }]) })
  })

  it('schedules without publishing early, revokes to public 404 and emits only live revisions in escaped RSS', async () => {
    const owner = await client()
    const created = await owner.write({ method: 'POST', url: '/api/v1/publishing/drafts', payload: { ...standalone, title: 'A & B <公开>', slug: 'rss-entry' } })
    const id = created.json<{ id: string }>().id
    const scheduled = await owner.write({ method: 'POST', url: `/api/v1/publishing/drafts/${id}/schedule`, payload: { version: 1, scheduledAt: '2026-08-23T10:00:00.000Z' } })
    expect(scheduled.json()).toMatchObject({ status: 'scheduled', scheduledAt: '2026-08-23T10:00:00.000Z', version: 2 })
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/content/rss-entry' })).statusCode).toBe(404)

    const published = await owner.write({ method: 'POST', url: `/api/v1/publishing/drafts/${id}/publish`, payload: { version: 2 } })
    expect(published.statusCode).toBe(200)
    const draft = (await owner.get(`/api/v1/publishing/drafts/${id}`)).json<{ version: number }>()
    const revoked = await owner.write({ method: 'POST', url: `/api/v1/publishing/drafts/${id}/revoke`, payload: { version: draft.version } })
    expect(revoked.json()).toMatchObject({ status: 'revoked' })
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/content/rss-entry' })).statusCode).toBe(404)

    const feed = await app.inject({ method: 'GET', url: '/api/v1/public/feed.xml' })
    expect(feed.statusCode).toBe(200)
    expect(feed.headers['content-type']).toContain('application/rss+xml')
    expect(feed.body).not.toContain('rss-entry')
    expect(feed.body).not.toContain('<公开>')
  })

  it('requires authentication and CSRF, rejects duplicate slugs and excludes private source fields from public JSON', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/publishing/drafts' })).statusCode).toBe(401)
    const owner = await client()
    const first = await owner.write({ method: 'POST', url: '/api/v1/publishing/drafts', payload: standalone })
    expect(first.statusCode).toBe(201)
    expect((await owner.write({ method: 'POST', url: '/api/v1/publishing/drafts', payload: { ...standalone, slug: 'Release Gate' } })).statusCode).toBe(409)

    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { account: 'owner@example.com', password: 'owner-safe-password' } })
    const cookie = cookieFrom(login.headers)
    expect((await app.inject({ method: 'POST', url: `/api/v1/publishing/drafts/${first.json<{ id: string }>().id}/publish`, headers: { cookie }, payload: { version: 1 } })).statusCode).toBe(403)
  })
})
