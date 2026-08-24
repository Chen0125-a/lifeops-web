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

describe('revision-backed public content routes', () => {
  let app: FastifyInstance
  let sequence = 0

  beforeEach(async () => {
    sequence = 0
    const store = new MemoryLifeStore({ createId: () => `public-revision-${++sequence}`, now: () => '2026-08-22T10:00:00.000Z' })
    await store.createUser({ account: 'owner@example.com', displayName: 'Owner', passwordHash: await hashPassword('owner-safe-password') })
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

  async function client(): Promise<Client> {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { account: 'owner@example.com', password: 'owner-safe-password' } })
    expect(login.statusCode).toBe(200)
    const cookie = cookieFrom(login.headers)
    const csrf = login.json<{ csrfToken: string }>().csrfToken
    return {
      get: (url) => app.inject({ method: 'GET', url, headers: { cookie } }),
      write: (options) => app.inject({ ...options, headers: { ...options.headers, cookie, 'x-csrf-token': csrf } }),
    }
  }

  async function createAndPublish(subject: Client, index: number, category = 'learning') {
    const draft = await subject.write({
      method: 'POST',
      url: '/api/v1/publishing/drafts',
      payload: {
        category,
        slug: `public-entry-${index}`,
        title: `公开 & 条目 <${index}>`,
        excerpt: `公开摘要 ${index}`,
        body: `# 公开正文 ${index}`,
        tags: ['public'],
      },
    })
    expect(draft.statusCode).toBe(201)
    const value = draft.json<{ id: string; version: number }>()
    const published = await subject.write({ method: 'POST', url: `/api/v1/publishing/drafts/${value.id}/publish`, payload: { version: value.version } })
    expect(published.statusCode).toBe(200)
    return value.id
  }

  it('lists and reads only the latest live immutable revisions with an exact public whitelist', async () => {
    const owner = await client()
    const id = await createAndPublish(owner, 1)
    await createAndPublish(owner, 2, 'doing')

    const edited = await owner.write({ method: 'PATCH', url: `/api/v1/publishing/drafts/${id}`, payload: { title: '公开条目 v2', version: 2 } })
    expect(edited.statusCode).toBe(200)
    await owner.write({ method: 'POST', url: `/api/v1/publishing/drafts/${id}/publish`, payload: { version: 3 } })

    const list = await app.inject({ method: 'GET', url: '/api/v1/public/content?category=learning' })
    expect(list.statusCode).toBe(200)
    expect(list.json<Array<{ slug: string; title: string; revision: number }>>()).toEqual([
      expect.objectContaining({ slug: 'public-entry-1', title: '公开条目 v2', revision: 2 }),
    ])

    const detail = await app.inject({ method: 'GET', url: '/api/v1/public/content/public-entry-1' })
    expect(detail.statusCode).toBe(200)
    expect(Object.keys(detail.json()).sort()).toEqual([
      'body', 'category', 'coverUrl', 'excerpt', 'featured', 'publishedAt', 'revision', 'slug', 'tags', 'title', 'updatedAt',
    ])
    expect(detail.body).not.toContain('PRIVATE_SENTINEL')
    expect(detail.body).not.toContain('source')
    expect(detail.body).not.toContain('seo')
  })

  it('returns the latest 50 live items in escaped RSS with stable configured absolute links', async () => {
    const owner = await client()
    for (let index = 1; index <= 51; index += 1) await createAndPublish(owner, index)

    const feed = await app.inject({ method: 'GET', url: '/api/v1/public/feed.xml' })
    expect(feed.statusCode).toBe(200)
    expect(feed.headers['content-type']).toContain('application/rss+xml')
    expect(feed.body.match(/<item>/g)).toHaveLength(50)
    expect(feed.body).toContain('https://lifeops.example.test/p/public-entry-51')
    expect(feed.body).not.toContain('public-entry-1</link>')
    expect(feed.body).toContain('&amp;')
    expect(feed.body).toContain('&lt;51&gt;')
    expect(feed.body).not.toContain('PRIVATE_SENTINEL')
  })
})
