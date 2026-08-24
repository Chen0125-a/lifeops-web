import { afterEach, describe, expect, it, vi } from 'vitest'
import { LifeApi } from './lifeApi'
import { tasksApi } from './tasksApi'

describe('LifeApi', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps credentials same-origin and attaches the server CSRF token to writes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'u1', account: 'owner@example.com', displayName: 'Owner' }, csrfToken: 'csrf-1' }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'p1', title: '真实 API 计划' }), { status: 201, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const api = new LifeApi('/api/v1')

    await api.login('owner@example.com', 'a-valid-password')
    await api.createPlan({ title: '真实 API 计划' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/auth/login', expect.objectContaining({ credentials: 'same-origin', method: 'POST' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/plans', expect.objectContaining({ credentials: 'same-origin', headers: expect.objectContaining({ 'x-csrf-token': 'csrf-1' }) }))
  })

  it('turns structured API failures into recoverable client errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: '账号或密码不正确' } }), { status: 401, headers: { 'content-type': 'application/json' } })))
    const api = new LifeApi('/api/v1')

    await expect(api.login('owner@example.com', 'wrong')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', message: '账号或密码不正确' })
  })

  it('keeps legacy reads stable while new task writes use the domain transport', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ plans: [], snapshots: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        slug: 'public/snapshot', title: '公开副本', excerpt: '公开摘要', publishedAt: '2026-08-14T08:00:00.000Z',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'task-1', title: '领域任务', version: 1 }), {
        status: 201, headers: { 'content-type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const legacyApi = new LifeApi('/api/v1')

    await legacyApi.state()
    await legacyApi.publicSnapshot('public/snapshot')
    await tasksApi.create({ title: '领域任务' }, 'task-create-p1-compat', 'csrf-domain')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/state', expect.objectContaining({
      method: 'GET', credentials: 'same-origin',
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/v1/public/snapshots/public%2Fsnapshot', expect.objectContaining({
      method: 'GET', credentials: 'same-origin',
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/v1/tasks', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ title: '领域任务' }),
      headers: expect.objectContaining({
        'x-csrf-token': 'csrf-domain',
        'idempotency-key': 'task-create-p1-compat',
      }),
    }))
  })
})
