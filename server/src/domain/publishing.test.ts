import { describe, expect, it } from 'vitest'
import {
  PUBLIC_CATEGORIES,
  PublishingDomainError,
  assertPublicSlugAvailable,
  copyPublicSourceFields,
  createPublicDraftEntity,
  createPublicRevisionEntity,
  diffPublicRevisions,
  normalizePublicSlug,
  schedulePublicDraftEntity,
  updatePublicDraftEntity,
  type CreatePublicDraftInput,
  type PublicDraft,
} from './publishing.js'

const now = '2026-08-22T10:00:00.000Z'
const input = (patch: Partial<CreatePublicDraftInput> = {}): CreatePublicDraftInput => ({
  category: 'learning',
  title: '发布门禁',
  excerpt: '只公开明确复制的字段。',
  body: '# 发布门禁\n\n保留公开事实。',
  coverUrl: null,
  tags: ['k8s', '发布'],
  slug: 'Release Gate',
  featured: true,
  seo: { title: '发布门禁 · LifeOps', description: '公开发布门禁摘要' },
  ...patch,
})

const draft = (patch: Partial<PublicDraft> = {}) => {
  const { id = 'draft-1', ...fields } = patch
  return { ...createPublicDraftEntity(id, now, { ...input(), ...fields }), ...patch }
}

describe('publishing domain', () => {
  it('accepts exactly the five approved categories and rejects every unknown category', () => {
    expect(PUBLIC_CATEGORIES).toEqual(['now', 'doing', 'learning', 'moments', 'archive'])
    for (const category of PUBLIC_CATEGORIES) {
      expect(createPublicDraftEntity(`draft-${category}`, now, input({ category })).category).toBe(category)
    }
    expect(() => createPublicDraftEntity('bad', now, input({ category: 'projects' as never }))).toThrowError(PublishingDomainError)
  })

  it('normalizes slugs deterministically and enforces normalized uniqueness', () => {
    expect(normalizePublicSlug('  LifeOps / 发布  门禁! ')).toBe('lifeops-发布-门禁')
    expect(normalizePublicSlug('Release___Gate')).toBe('release-gate')
    expect(() => normalizePublicSlug('---')).toThrowError(PublishingDomainError)

    const existing = [draft({ id: 'draft-a', slug: 'release-gate' })]
    expect(() => assertPublicSlugAvailable('Release Gate', existing)).toThrowError(PublishingDomainError)
    expect(() => assertPublicSlugAvailable('Release Gate', existing, 'draft-a')).not.toThrow()
  })

  it('copies only the explicit public whitelist from a private source', () => {
    const copied = copyPublicSourceFields({
      title: '可公开标题',
      excerpt: '可公开摘要',
      body: '可公开正文',
      coverUrl: 'https://cdn.example.test/public.webp',
      tags: ['公开'],
      ownerId: 'private-owner',
      privateBody: 'PRIVATE_SENTINEL',
      mediaIds: ['private-media'],
      sessionToken: 'TOKEN_SENTINEL',
    })
    expect(copied).toEqual({
      title: '可公开标题',
      excerpt: '可公开摘要',
      body: '可公开正文',
      coverUrl: 'https://cdn.example.test/public.webp',
      tags: ['公开'],
    })
    expect(JSON.stringify(copied)).not.toMatch(/owner|private|mediaIds|token/i)
  })

  it('creates immutable public-only revisions and never serializes source or scheduling facts', () => {
    const sourceDraft = draft({ source: { type: 'knowledge', id: 'note-1', version: 7 }, scheduledAt: '2026-08-23T10:00:00.000Z' })
    const revision = createPublicRevisionEntity('revision-1', sourceDraft, 1, '2026-08-23T10:00:00.000Z')
    expect(revision).toMatchObject({
      draftId: sourceDraft.id,
      sourceVersion: sourceDraft.version,
      revision: 1,
      title: sourceDraft.title,
      publishedAt: '2026-08-23T10:00:00.000Z',
    })
    expect(revision).not.toHaveProperty('source')
    expect(revision).not.toHaveProperty('scheduledAt')
    expect(revision).not.toHaveProperty('status')
    expect(Object.isFrozen(revision)).toBe(true)
    expect(Object.isFrozen(revision.tags)).toBe(true)
    expect(Object.isFrozen(revision.seo)).toBe(true)
  })

  it('requires a future scheduled timestamp and versions the scheduling transition', () => {
    const scheduled = schedulePublicDraftEntity(draft(), now, '2026-08-22T10:05:00.000Z', 1)
    expect(scheduled).toMatchObject({ status: 'scheduled', scheduledAt: '2026-08-22T10:05:00.000Z', version: 2 })
    expect(() => schedulePublicDraftEntity(draft(), now, now, 1)).toThrowError(PublishingDomainError)
    expect(() => schedulePublicDraftEntity(draft(), now, 'not-a-date', 1)).toThrowError(PublishingDomainError)
  })

  it('returns a deterministic public-field revision diff after an edited draft creates a new revision', () => {
    const first = createPublicRevisionEntity('revision-1', draft(), 1, now)
    const edited = updatePublicDraftEntity(draft(), '2026-08-22T11:00:00.000Z', {
      version: 1,
      title: '更新后的发布门禁',
      tags: ['k8s', 'revision'],
    })
    const second = createPublicRevisionEntity('revision-2', edited, 2, '2026-08-22T11:00:00.000Z')
    expect(diffPublicRevisions(first, second)).toEqual({
      from: 1,
      to: 2,
      changed: [
        { field: 'tags', before: ['k8s', '发布'], after: ['k8s', 'revision'] },
        { field: 'title', before: '发布门禁', after: '更新后的发布门禁' },
        { field: 'updatedAt', before: now, after: '2026-08-22T11:00:00.000Z' },
      ],
    })
  })
})
