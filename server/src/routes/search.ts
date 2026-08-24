import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { parseSearchTypes, type SearchStore } from '../domain/search.js'
import type { User } from '../domain/types.js'

interface SearchRouteSecurity {
  authenticate(request: FastifyRequest, reply: FastifyReply): Promise<{ user: Pick<User, 'id'> } | undefined>
}

const error = (request: FastifyRequest, reply: FastifyReply, code: string, message: string) =>
  reply.code(400).send({ error: { code, message, requestId: request.id } })

export function registerSearchRoutes(app: FastifyInstance, store: SearchStore, security: SearchRouteSecurity) {
  app.get('/api/v1/search', async (request, reply) => {
    const auth = await security.authenticate(request, reply)
    if (!auth) return
    const raw = new URL(request.raw.url ?? request.url, 'http://lifeops.local').searchParams
    const query = (raw.get('q') ?? '').trim()
    if (query.length < 2 || query.length > 200) return error(request, reply, 'INVALID_SEARCH_QUERY', '搜索关键词需要 2 到 200 个字符')

    let types
    try {
      types = raw.has('types') ? parseSearchTypes((raw.get('types') ?? '').split(',')) : undefined
    } catch {
      return error(request, reply, 'UNSUPPORTED_SEARCH_TYPE', '搜索类型不受支持')
    }
    const requestedLimit = Number.parseInt(raw.get('limit') ?? '20', 10)
    const limit = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 20
    const items = await store.search(auth.user.id, { query, types, limit })
    return { items }
  })
}
