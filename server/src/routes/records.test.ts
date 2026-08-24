import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { FileSystemMediaStorage } from '../media/fileSystemStorage.js'
import { hashPassword } from '../security/password.js'
import { MemoryLifeStore } from '../store/memoryLifeStore.js'

interface Client {
  get(url: string): ReturnType<FastifyInstance['inject']>
  write(options: InjectOptions, idempotencyKey?: string): ReturnType<FastifyInstance['inject']>
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])

function cookieFrom(headers: Record<string, string | string[] | undefined>) {
  const value = headers['set-cookie']
  return (Array.isArray(value) ? value[0] : value)?.split(';')[0] ?? ''
}

function multipartFile(bytes: Uint8Array, mimeType: string, filename: string) {
  const boundary = 'lifeops-test-boundary'
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return {
    payload: Buffer.concat([head, Buffer.from(bytes), tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

describe('versioned record and authenticated media routes', () => {
  let app: FastifyInstance
  let store: MemoryLifeStore
  let mediaRoot: string

  beforeEach(async () => {
    let sequence = 0
    mediaRoot = await mkdtemp(join(tmpdir(), 'lifeops-record-media-'))
    store = new MemoryLifeStore({
      createId: () => `record-test-${++sequence}`,
      now: () => '2026-08-13T10:00:00.000Z',
    })
    await store.createUser({ account: 'owner@example.com', displayName: 'Owner', passwordHash: await hashPassword('owner-safe-password') })
    await store.createUser({ account: 'other@example.com', displayName: 'Other', passwordHash: await hashPassword('other-safe-password') })
    app = buildApp({
      store,
      config: { cookieName: 'lifeops_session', sessionTtlSeconds: 3600, secureCookies: false },
      mediaStorage: new FileSystemMediaStorage(mediaRoot, { createId: () => `media-${++sequence}` }),
    })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    await rm(mediaRoot, { recursive: true, force: true })
  })

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

  async function createHabit(subject: Client, prefix: string) {
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/habits',
      payload: {
        title: `${prefix}习惯`,
        measure: 'boolean',
        timezone: 'Asia/Shanghai',
        schedule: { scheduleType: 'daily', startsOn: '2026-08-01' },
      },
    }, `${prefix}-habit`)
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string }>().id
  }

  async function createRecord(subject: Client, patch: Record<string, unknown> = {}, key = 'record-create-1') {
    return subject.write({
      method: 'POST',
      url: '/api/v1/records',
      payload: {
        title: '日光记录',
        body: '# 今天\n\n完成了真实的数据闭环。',
        occurredAt: '2026-08-13T09:30:00.000Z',
        tags: ['lifeops', '复盘'],
        ...patch,
      },
    }, key)
  }

  async function uploadImage(subject: Client, key: string, filename: string) {
    const multipart = multipartFile(png, 'image/png', filename)
    const response = await subject.write({
      method: 'POST',
      url: '/api/v1/media',
      headers: { 'content-type': multipart.contentType },
      payload: multipart.payload,
    }, key)
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string; visibility: 'private' }>()
  }

  it('creates idempotently and autosaves with optimistic version conflict protection', async () => {
    const owner = await client()
    const first = await createRecord(owner)
    const replay = await createRecord(owner)
    expect(first.statusCode).toBe(201)
    expect(replay.statusCode).toBe(201)
    expect(replay.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id)
    expect(first.json()).toMatchObject({
      title: '日光记录',
      body: expect.stringContaining('# 今天'),
      pinned: false,
      archivedAt: null,
      links: [],
      mediaIds: [],
      version: 1,
      updatedAt: '2026-08-13T10:00:00.000Z',
      deletedAt: null,
    })

    const id = first.json<{ id: string }>().id
    const saved = await owner.write({
      method: 'PATCH', url: `/api/v1/records/${id}`,
      payload: { body: '# 今天\n\n自动保存后的正文。', pinned: true, version: 1 },
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toMatchObject({ pinned: true, version: 2, body: expect.stringContaining('自动保存') })

    const stale = await owner.write({
      method: 'PATCH', url: `/api/v1/records/${id}`,
      payload: { title: '陈旧覆盖', version: 1 },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })
  })

  it('filters private records and rejects cross-owner generic links', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const ownerHabitId = await createHabit(owner, 'owner')
    const otherHabitId = await createHabit(other, 'other')
    const linked = await createRecord(owner, {
      links: [{ type: 'habit', id: ownerHabitId }],
    }, 'linked-record')
    expect(linked.statusCode).toBe(201)
    await createRecord(owner, { title: '无关记录', tags: ['other'] }, 'unrelated-record')

    const filtered = await owner.get(`/api/v1/records?from=2026-08-13&to=2026-08-13&tag=lifeops&linkType=habit&linkId=${ownerHabitId}&q=数据闭环`)
    expect(filtered.statusCode).toBe(200)
    expect(filtered.json<Array<{ id: string }>>()).toEqual([expect.objectContaining({ id: linked.json<{ id: string }>().id })])
    expect((await other.get('/api/v1/records')).json()).toEqual([])

    const crossOwner = await createRecord(owner, {
      links: [{ type: 'habit', id: otherHabitId }],
    }, 'cross-owner-record-link')
    expect(crossOwner.statusCode).toBe(404)
  })

  it('archives, soft-deletes and restores the same stable record identity', async () => {
    const owner = await client()
    const created = await createRecord(owner)
    const id = created.json<{ id: string }>().id

    const archived = await owner.write({
      method: 'PATCH', url: `/api/v1/records/${id}`,
      payload: { archived: true, version: 1 },
    })
    expect(archived.statusCode).toBe(200)
    expect(archived.json()).toMatchObject({ id, archivedAt: '2026-08-13T10:00:00.000Z', version: 2 })
    expect((await owner.get('/api/v1/records')).json()).toEqual([])
    expect((await owner.get('/api/v1/records?includeArchived=true')).json()).toHaveLength(1)

    const removed = await owner.write({ method: 'DELETE', url: `/api/v1/records/${id}`, payload: { version: 2 } })
    expect(removed.statusCode).toBe(204)
    expect((await owner.get(`/api/v1/records/${id}`)).statusCode).toBe(404)
    expect((await owner.get('/api/v1/state')).json<{ records: unknown[] }>().records).toEqual([])

    const restored = await owner.write({ method: 'POST', url: `/api/v1/records/${id}/restore`, payload: { version: 3 } })
    expect(restored.statusCode).toBe(200)
    expect(restored.json()).toMatchObject({ id, deletedAt: null, version: 4 })
  })

  it('persists an owner-scoped attached cover and updates its lifecycle atomically', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const cover = await uploadImage(owner, 'cover-upload-1', 'cover.png')
    const replacement = await uploadImage(owner, 'cover-upload-2', 'replacement.png')
    const foreign = await uploadImage(other, 'cover-upload-foreign', 'foreign.png')

    const withoutCover = await createRecord(owner, { mediaIds: [cover.id] }, 'cover-default-null')
    expect(withoutCover.statusCode).toBe(201)
    expect(withoutCover.json()).toMatchObject({ mediaIds: [cover.id], coverMediaId: null })

    const created = await createRecord(owner, {
      title: '显式封面记录',
      mediaIds: [cover.id, replacement.id],
      coverMediaId: cover.id,
    }, 'cover-create')
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ coverMediaId: cover.id, version: 1 })
    const id = created.json<{ id: string }>().id

    const foreignCover = await createRecord(owner, {
      title: '跨用户封面', mediaIds: [foreign.id], coverMediaId: foreign.id,
    }, 'cover-cross-owner')
    expect(foreignCover.statusCode).toBe(404)

    const unattachedCover = await createRecord(owner, {
      title: '未附着封面', mediaIds: [replacement.id], coverMediaId: cover.id,
    }, 'cover-unattached')
    expect(unattachedCover.statusCode).toBe(400)
    expect(unattachedCover.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } })

    const omitted = await owner.write({
      method: 'PATCH', url: `/api/v1/records/${id}`,
      payload: { title: '省略封面字段', version: 1 },
    })
    expect(omitted.statusCode).toBe(200)
    expect(omitted.json()).toMatchObject({ title: '省略封面字段', coverMediaId: cover.id, version: 2 })

    const invalidRemoval = await owner.write({
      method: 'PATCH', url: `/api/v1/records/${id}`,
      payload: { mediaIds: [replacement.id], version: 2 },
    })
    expect(invalidRemoval.statusCode).toBe(400)
    expect((await owner.get(`/api/v1/records/${id}`)).json())
      .toMatchObject({ mediaIds: [cover.id, replacement.id], coverMediaId: cover.id, version: 2 })

    const replaced = await owner.write({
      method: 'PATCH', url: `/api/v1/records/${id}`,
      payload: { mediaIds: [replacement.id], coverMediaId: replacement.id, version: 2 },
    })
    expect(replaced.statusCode).toBe(200)
    expect(replaced.json()).toMatchObject({ mediaIds: [replacement.id], coverMediaId: replacement.id, version: 3 })

    const cleared = await owner.write({
      method: 'PATCH', url: `/api/v1/records/${id}`,
      payload: { mediaIds: [], coverMediaId: null, version: 3 },
    })
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json()).toMatchObject({ mediaIds: [], coverMediaId: null, version: 4 })
    expect((await other.get(`/api/v1/media/${cover.id}`)).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/api/v1/public/media/${cover.id}` })).statusCode).toBe(404)
  })

  it('stores a private upload, serves only to its owner and denies the public route', async () => {
    const owner = await client()
    const other = await client('other@example.com', 'other-safe-password')
    const multipart = multipartFile(png, 'image/png', '../private.png')
    const uploaded = await owner.write({
      method: 'POST',
      url: '/api/v1/media',
      headers: { 'content-type': multipart.contentType },
      payload: multipart.payload,
    }, 'media-upload-1')
    expect(uploaded.statusCode).toBe(201)
    expect(uploaded.json()).toMatchObject({
      visibility: 'private', mimeType: 'image/png', originalName: 'private.png', sizeBytes: png.byteLength, version: 1,
    })
    expect(uploaded.json<{ storageKey: string }>().storageKey).toBeUndefined()

    const replay = await owner.write({
      method: 'POST',
      url: '/api/v1/media',
      headers: { 'content-type': multipart.contentType },
      payload: multipart.payload,
    }, 'media-upload-1')
    expect(replay.statusCode).toBe(201)
    expect(replay.json<{ id: string }>().id).toBe(uploaded.json<{ id: string }>().id)
    expect((await readdir(mediaRoot, { recursive: true })).filter((entry) => entry.endsWith('.png'))).toHaveLength(1)

    const id = uploaded.json<{ id: string }>().id
    const ownerRead = await owner.get(`/api/v1/media/${id}`)
    expect(ownerRead.statusCode).toBe(200)
    expect(ownerRead.headers['content-type']).toContain('image/png')
    expect(ownerRead.rawPayload).toEqual(png)
    expect((await other.get(`/api/v1/media/${id}`)).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/api/v1/public/media/${id}` })).statusCode).toBe(404)
  })
})
