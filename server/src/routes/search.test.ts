import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchResult, SearchStore } from '../domain/search.js'
import { registerSearchRoutes } from './search.js'

const result: SearchResult = {
  type: 'record',
  id: 'record-1',
  title: '平台验收记录',
  excerpt: '平台验收记录',
  context: '来自记录 · 2026-08-23',
  updatedAt: '2026-08-23T00:00:00.000Z',
  route: '/records/record-1',
}

describe('personal search route', () => {
  let app: ReturnType<typeof Fastify>
  let search: ReturnType<typeof vi.fn<SearchStore['search']>>

  beforeEach(async () => {
    app = Fastify()
    search = vi.fn<SearchStore['search']>().mockResolvedValue([result])
    registerSearchRoutes(app, { search }, {
      authenticate: async (request: FastifyRequest, reply: FastifyReply) => {
        if (request.headers.authorization !== 'Bearer owner-session') {
          reply.code(401).send({ error: { code: 'AUTH_REQUIRED' } })
          return undefined
        }
        return { user: { id: 'owner-a' } }
      },
    })
    await app.ready()
  })

  afterEach(async () => app.close())

  const get = (url: string) => app.inject({ method: 'GET', url, headers: { authorization: 'Bearer owner-session' } })

  it('requires an authenticated owner and scopes the store query to that owner', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/search?q=平台' })).statusCode).toBe(401)

    const response = await get('/api/v1/search?q=%E5%B9%B3%E5%8F%B0&types=goal%2Crecipe&limit=7')

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ items: [result] })
    expect(search).toHaveBeenCalledWith('owner-a', { query: '平台', types: ['goal', 'recipe'], limit: 7 })
  })

  it.each(['', 'a', ' '])('rejects a query shorter than two characters: %j', async (query) => {
    const response = await get(`/api/v1/search?q=${encodeURIComponent(query)}`)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: { code: 'INVALID_SEARCH_QUERY' } })
    expect(search).not.toHaveBeenCalled()
  })

  it('caps the requested result count at fifty', async () => {
    const response = await get('/api/v1/search?q=LifeOps&limit=500')

    expect(response.statusCode).toBe(200)
    expect(search).toHaveBeenCalledWith('owner-a', { query: 'LifeOps', types: undefined, limit: 50 })
  })

  it.each(['log', 'alert', 'platform'])('rejects non-personal %s sources before querying the store', async (type) => {
    const response = await get(`/api/v1/search?q=LifeOps&types=${type}`)

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ error: { code: 'UNSUPPORTED_SEARCH_TYPE' } })
    expect(search).not.toHaveBeenCalled()
  })
})
