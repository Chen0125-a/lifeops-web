export const PUBLIC_CATEGORIES = ['now', 'doing', 'learning', 'moments', 'archive'] as const
export type PublicCategory = typeof PUBLIC_CATEGORIES[number]
export type PublicDraftStatus = 'draft' | 'scheduled' | 'published' | 'revoked'
export type PublicSourceType = 'plan' | 'record' | 'review' | 'knowledge'

export interface PublicSourceCopy {
  type: PublicSourceType
  id: string
  version: number
}

export interface PublicSeo {
  title: string
  description: string
}

export interface PublicDraft {
  id: string
  category: PublicCategory
  source: PublicSourceCopy | null
  title: string
  excerpt: string
  body: string
  coverUrl: string | null
  tags: string[]
  slug: string
  scheduledAt: string | null
  featured: boolean
  seo: PublicSeo
  status: PublicDraftStatus
  version: number
  createdAt: string
  updatedAt: string
}

export interface PublicRevision {
  id: string
  draftId: string
  sourceVersion: number
  revision: number
  category: PublicCategory
  slug: string
  title: string
  excerpt: string
  body: string
  coverUrl: string | null
  tags: string[]
  featured: boolean
  seo: PublicSeo
  publishedAt: string
  updatedAt: string
}

export interface CreatePublicDraftInput {
  category: PublicCategory
  source?: PublicSourceCopy | null
  title: string
  excerpt: string
  body: string
  coverUrl?: string | null
  tags?: string[]
  slug: string
  scheduledAt?: string | null
  featured?: boolean
  seo?: Partial<PublicSeo>
}

export interface UpdatePublicDraftInput extends Partial<Omit<CreatePublicDraftInput, 'source'>> {
  version: number
}

export interface PublicRevisionDiff {
  from: number
  to: number
  changed: Array<{ field: string; before: unknown; after: unknown }>
}

export interface PublicRevisionView {
  body: string
  category: PublicCategory
  coverUrl: string | null
  excerpt: string
  featured: boolean
  publishedAt: string
  revision: number
  slug: string
  tags: string[]
  title: string
  updatedAt: string
}

export class PublishingDomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'PublishingDomainError'
  }
}

const categorySet = new Set<PublicCategory>(PUBLIC_CATEGORIES)

function clean(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new PublishingDomainError('INVALID_INPUT', `${field}无效`, 400)
  const result = value.trim()
  if (!result || result.length > max) throw new PublishingDomainError('INVALID_INPUT', `${field}无效`, 400)
  return result
}

function optionalUrl(value: unknown): string | null {
  if (value == null || value === '') return null
  const result = clean(value, '封面地址', 2_000)
  let url: URL
  try { url = new URL(result) } catch { throw new PublishingDomainError('INVALID_INPUT', '封面地址无效', 400) }
  if (!['http:', 'https:'].includes(url.protocol)) throw new PublishingDomainError('INVALID_INPUT', '封面地址无效', 400)
  return url.toString()
}

function stringList(value: unknown, field: string): string[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 50) throw new PublishingDomainError('INVALID_INPUT', `${field}无效`, 400)
  return [...new Set(value.map((item) => clean(item, field, 80)))]
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new PublishingDomainError('INVALID_INPUT', `${field}无效`, 400)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) throw new PublishingDomainError('INVALID_INPUT', `${field}无效`, 400)
  return value
}

function assertVersion(current: number, expected: number) {
  if (!Number.isSafeInteger(expected) || current !== expected) {
    throw new PublishingDomainError('VERSION_CONFLICT', '发布草稿已更新，请刷新后重试', 409)
  }
}

function sourceCopy(source: PublicSourceCopy | null | undefined): PublicSourceCopy | null {
  if (source == null) return null
  if (!['plan', 'record', 'review', 'knowledge'].includes(source.type)) throw new PublishingDomainError('INVALID_INPUT', '发布来源无效', 400)
  const version = source.version
  if (!Number.isSafeInteger(version) || version < 1) throw new PublishingDomainError('INVALID_INPUT', '发布来源版本无效', 400)
  return { type: source.type, id: clean(source.id, '发布来源', 80), version }
}

function seo(input: Partial<PublicSeo> | undefined, title: string, excerpt: string): PublicSeo {
  return {
    title: input?.title === undefined ? title : clean(input.title, 'SEO 标题', 240),
    description: input?.description === undefined ? excerpt : clean(input.description, 'SEO 描述', 500),
  }
}

export function normalizePublicSlug(value: string): string {
  const result = String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  if (!result || result.length > 120) throw new PublishingDomainError('INVALID_INPUT', '公开 slug 无效', 400)
  return result
}

export function assertPublicSlugAvailable(value: string, drafts: Array<Pick<PublicDraft, 'id' | 'slug'>>, currentId?: string): void {
  const slug = normalizePublicSlug(value)
  if (drafts.some((draft) => draft.id !== currentId && normalizePublicSlug(draft.slug) === slug)) {
    throw new PublishingDomainError('SLUG_CONFLICT', '公开 slug 已存在', 409)
  }
}

export function copyPublicSourceFields(source: Record<string, unknown>): Pick<PublicDraft, 'title' | 'excerpt' | 'body' | 'coverUrl' | 'tags'> {
  const body = clean(source.body, '公开正文', 200_000)
  return {
    title: clean(source.title, '公开标题', 240),
    excerpt: source.excerpt == null ? body.slice(0, 500) : clean(source.excerpt, '公开摘要', 2_000),
    body,
    coverUrl: optionalUrl(source.coverUrl),
    tags: stringList(source.tags, '公开标签'),
  }
}

export function createPublicDraftEntity(id: string, now: string, input: CreatePublicDraftInput): PublicDraft {
  if (!categorySet.has(input.category)) throw new PublishingDomainError('INVALID_INPUT', '公开分类无效', 400)
  const title = clean(input.title, '公开标题', 240)
  const excerpt = clean(input.excerpt, '公开摘要', 2_000)
  const createdAt = timestamp(now, '创建时间')
  const draft: PublicDraft = {
    id: clean(id, '草稿 ID', 80),
    category: input.category,
    source: sourceCopy(input.source),
    title,
    excerpt,
    body: clean(input.body, '公开正文', 200_000),
    coverUrl: optionalUrl(input.coverUrl),
    tags: stringList(input.tags, '公开标签'),
    slug: normalizePublicSlug(input.slug),
    scheduledAt: null,
    featured: input.featured ?? false,
    seo: seo(input.seo, title, excerpt),
    status: 'draft',
    version: 1,
    createdAt,
    updatedAt: createdAt,
  }
  if (input.scheduledAt) return schedulePublicDraftEntity(draft, now, input.scheduledAt, 1)
  return draft
}

export function updatePublicDraftEntity(current: PublicDraft, now: string, input: UpdatePublicDraftInput): PublicDraft {
  assertVersion(current.version, input.version)
  const category = input.category ?? current.category
  if (!categorySet.has(category)) throw new PublishingDomainError('INVALID_INPUT', '公开分类无效', 400)
  const title = input.title === undefined ? current.title : clean(input.title, '公开标题', 240)
  const excerpt = input.excerpt === undefined ? current.excerpt : clean(input.excerpt, '公开摘要', 2_000)
  return {
    ...current,
    category,
    title,
    excerpt,
    body: input.body === undefined ? current.body : clean(input.body, '公开正文', 200_000),
    coverUrl: input.coverUrl === undefined ? current.coverUrl : optionalUrl(input.coverUrl),
    tags: input.tags === undefined ? [...current.tags] : stringList(input.tags, '公开标签'),
    slug: input.slug === undefined ? current.slug : normalizePublicSlug(input.slug),
    featured: input.featured ?? current.featured,
    seo: input.seo === undefined ? { ...current.seo } : seo({ ...current.seo, ...input.seo }, title, excerpt),
    scheduledAt: null,
    status: 'draft',
    version: current.version + 1,
    updatedAt: timestamp(now, '更新时间'),
  }
}

export function schedulePublicDraftEntity(current: PublicDraft, now: string, scheduledAt: string, version: number): PublicDraft {
  assertVersion(current.version, version)
  const currentTime = timestamp(now, '当前时间')
  const scheduled = timestamp(scheduledAt, '发布时间')
  if (scheduled <= currentTime) throw new PublishingDomainError('INVALID_INPUT', '计划发布时间必须晚于当前时间', 400)
  return { ...current, status: 'scheduled', scheduledAt: scheduled, version: current.version + 1, updatedAt: currentTime }
}

export function createPublicRevisionEntity(id: string, draft: PublicDraft, revision: number, publishedAt: string): PublicRevision {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new PublishingDomainError('INVALID_INPUT', '公开 revision 无效', 400)
  const result: PublicRevision = {
    id: clean(id, 'revision ID', 80),
    draftId: draft.id,
    sourceVersion: draft.version,
    revision,
    category: draft.category,
    slug: draft.slug,
    title: draft.title,
    excerpt: draft.excerpt,
    body: draft.body,
    coverUrl: draft.coverUrl,
    tags: Object.freeze([...draft.tags]) as string[],
    featured: draft.featured,
    seo: Object.freeze({ ...draft.seo }) as PublicSeo,
    publishedAt: timestamp(publishedAt, '发布时间'),
    updatedAt: draft.updatedAt,
  }
  return Object.freeze(result)
}

export function diffPublicRevisions(from: PublicRevision, to: PublicRevision): PublicRevisionDiff {
  if (from.draftId !== to.draftId) throw new PublishingDomainError('INVALID_INPUT', '不能比较不同草稿的 revision', 400)
  const fields = ['body', 'category', 'coverUrl', 'excerpt', 'featured', 'seo', 'slug', 'tags', 'title', 'updatedAt'] as const
  const changed = fields.filter((field) => JSON.stringify(from[field]) !== JSON.stringify(to[field]))
    .map((field) => ({ field, before: from[field], after: to[field] }))
    .sort((left, right) => left.field.localeCompare(right.field, 'en'))
  return { from: from.revision, to: to.revision, changed }
}

export function toPublicRevisionView(revision: PublicRevision): PublicRevisionView {
  return {
    body: revision.body,
    category: revision.category,
    coverUrl: revision.coverUrl,
    excerpt: revision.excerpt,
    featured: revision.featured,
    publishedAt: revision.publishedAt,
    revision: revision.revision,
    slug: revision.slug,
    tags: [...revision.tags],
    title: revision.title,
    updatedAt: revision.updatedAt,
  }
}
