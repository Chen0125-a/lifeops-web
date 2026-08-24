import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { PUBLIC_CATEGORIES, toPublicRevisionView, type PublicCategory, type PublicRevision } from '../domain/publishing.js'
import type { PublishingStore } from '../store/publishingStore.js'

export interface PublicContentSummary {
  id: string
  slug: string
  category: PublicCategory
  title: string
  excerpt: string
  coverUrl: string | null
  publishedAt: string
  featured: boolean
  revision?: number
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
})

function escapeXml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function asSummary(revision: PublicRevision): PublicContentSummary {
  return {
    id: revision.draftId,
    slug: revision.slug,
    category: revision.category,
    title: revision.title,
    excerpt: revision.excerpt,
    coverUrl: revision.coverUrl,
    publishedAt: revision.publishedAt,
    featured: revision.featured,
    revision: revision.revision,
  }
}

function notFound(request: FastifyRequest, reply: FastifyReply) {
  return reply.code(404).send({
    error: {
      code: 'NOT_FOUND',
      message: '公开内容不存在或已撤回',
      requestId: request.id,
    },
  })
}

export function registerPublicContentRoutes(app: FastifyInstance, store: PublishingStore, publicOrigin = 'http://localhost') {
  app.get('/api/v1/public/content', {
    schema: {
      querystring: objectSchema({ category: { type: 'string', enum: PUBLIC_CATEGORIES } }),
    },
  }, async (request) => {
    const { category } = request.query as { category?: PublicCategory }
    return (await store.listPublishedRevisions())
      .map(asSummary)
      .filter((item) => !category || item.category === category)
  })

  app.get('/api/v1/public/content/:slug', {
    schema: {
      params: objectSchema({ slug: { type: 'string', minLength: 1, maxLength: 120 } }, ['slug']),
    },
  }, async (request, reply) => {
    const slug = (request.params as { slug: string }).slug
    const revision = await store.getPublishedRevision(slug)
    return revision ? toPublicRevisionView(revision) : notFound(request, reply)
  })

  app.get('/api/v1/public/feed.xml', async (_request, reply) => {
    const entries = (await store.listPublishedRevisions()).slice(0, 50)
    const origin = publicOrigin.replace(/\/$/u, '')
    const items = entries.map((entry) => {
      const link = `${origin}/p/${encodeURIComponent(entry.slug)}`
      return `<item><title>${escapeXml(entry.title)}</title><link>${escapeXml(link)}</link><guid isPermaLink="true">${escapeXml(link)}</guid><description>${escapeXml(entry.excerpt)}</description><pubDate>${new Date(entry.publishedAt).toUTCString()}</pubDate></item>`
    }).join('')
    const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>LifeOps</title><link>${escapeXml(origin)}</link><description>LifeOps public feed</description>${items}</channel></rss>`
    return reply.type('application/rss+xml; charset=utf-8').send(xml)
  })
}
