import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import type { PortablePayload } from '../../domain/lifeCommerce'
import type { Review } from '../../domain/reviews'

export const lifeProjectionTypes = [
  'recipe',
  'cooking-note',
  'fitness-summary',
  'life-review',
  'shopping-summary',
  'budget-summary',
] as const

export type LifeProjectionType = (typeof lifeProjectionTypes)[number]

export interface LifeProjectionDocument {
  lifeopsId: string
  type: LifeProjectionType
  version: number
  updatedAt: string
  title: string
  tags: string[]
  body: string
  path: string
}

export interface LifeProjectionSource {
  payload: PortablePayload
  reviews?: Review[]
  selectedTypes?: LifeProjectionType[]
}

const folderByType: Record<LifeProjectionType, string> = {
  recipe: 'Recipes',
  'cooking-note': 'Cooking',
  'fitness-summary': 'Fitness',
  'life-review': 'Reviews',
  'shopping-summary': 'Shopping',
  'budget-summary': 'Budgets',
}

const typeSet = new Set<string>(lifeProjectionTypes)
const FIXED_ZIP_MTIME = new Date('1980-01-01T00:00:00.000Z')

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    : []
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function inline(value: unknown, fallback = ''): string {
  return text(value, fallback).replace(/[\r\n]+/gu, ' ').trim()
}

function positiveVersion(value: unknown): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : 1
}

function timestamp(value: unknown, fallback?: unknown): string | null {
  for (const candidate of [value, fallback]) {
    if (typeof candidate !== 'string') continue
    const parsed = new Date(candidate)
    if (!Number.isNaN(parsed.valueOf()) && parsed.toISOString() === candidate) return candidate
  }
  return null
}

function tags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string').map((entry) => inline(entry)).filter(Boolean))]
}

function numberText(value: unknown, fallback = '—'): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback
}

function bulletLines(value: unknown): string {
  const values = Array.isArray(value) ? value.map((entry) => inline(entry)).filter(Boolean) : []
  return values.length ? values.map((entry) => `- ${entry}`).join('\n') : '- （无）'
}

function pathFor(type: LifeProjectionType, lifeopsId: string): string {
  return `LifeOps/Life/${folderByType[type]}/${encodeURIComponent(lifeopsId)}.md`
}

function document(input: Omit<LifeProjectionDocument, 'path'>): LifeProjectionDocument {
  return { ...input, path: pathFor(input.type, input.lifeopsId) }
}

function recipeDocuments(payload: PortablePayload): LifeProjectionDocument[] {
  return records(payload.recipes).flatMap((recipe) => {
    const lifeopsId = inline(recipe.id)
    const title = inline(recipe.name)
    const updatedAt = timestamp(recipe.updatedAt, recipe.createdAt)
    const current = recipe.currentVersion && typeof recipe.currentVersion === 'object' && !Array.isArray(recipe.currentVersion)
      ? recipe.currentVersion as Record<string, unknown>
      : null
    if (!lifeopsId || !title || !updatedAt || !current) return []
    const components = records(current.components).sort((left, right) => Number(left.position ?? 0) - Number(right.position ?? 0))
    const steps = records(current.steps).sort((left, right) => Number(left.position ?? 0) - Number(right.position ?? 0))
    const body = [
      `# ${title}`,
      text(recipe.description) || '（没有补充说明）',
      '## 配方事实',
      `- 份数：${numberText(current.servings)}`,
      `- 准备：${numberText(recipe.prepMinutes, '0')} 分钟`,
      `- 烹饪：${numberText(recipe.cookMinutes, '0')} 分钟`,
      `- 难度：${inline(recipe.difficulty, '未标注')}`,
      '## 食材',
      components.length
        ? components.map((entry) => `- ${inline(entry.itemId, '未命名食材')} · ${numberText(entry.quantity)} ${inline(entry.unit)}`).join('\n')
        : '- （无）',
      '## 步骤',
      steps.length
        ? steps.map((entry, index) => `${index + 1}. ${inline(entry.instruction, '未填写')}（${numberText(entry.durationSeconds, '未计时')} 秒）${inline(entry.caution) ? ` — 注意：${inline(entry.caution)}` : ''}`).join('\n')
        : '1. （无）',
      '## 保存备注',
      text(recipe.storageNotes) || '（无）',
    ].join('\n\n')
    return [document({
      lifeopsId, type: 'recipe', version: positiveVersion(recipe.entityVersion ?? current.number), updatedAt, title,
      tags: tags(recipe.tagIds), body,
    })]
  })
}

function cookingDocuments(payload: PortablePayload): LifeProjectionDocument[] {
  return records(payload.cookingSessions).flatMap((session) => {
    const lifeopsId = inline(session.id)
    const updatedAt = timestamp(session.completedAt, session.createdAt)
    if (!lifeopsId || !updatedAt) return []
    const recipeId = inline(session.recipeId, '未知配方')
    const title = `烹饪记录 · ${recipeId}`
    return [document({
      lifeopsId, type: 'cooking-note', version: positiveVersion(session.entityVersion), updatedAt, title, tags: [],
      body: [
        `# ${title}`,
        '## 本次事实',
        `- 配方：${recipeId}`,
        `- 配方版本：${inline(session.recipeVersionId, '未记录')}`,
        `- 计划份数：${numberText(session.plannedServings)}`,
        `- 状态：${inline(session.status, '未记录')}`,
        '## 手写备注',
        text(session.note) || '（无）',
      ].join('\n\n'),
    })]
  })
}

function fitnessDocuments(payload: PortablePayload): LifeProjectionDocument[] {
  return records(payload.fitnessActivities).flatMap((activity) => {
    const lifeopsId = inline(activity.id)
    const title = inline(activity.name)
    const updatedAt = timestamp(activity.updatedAt, activity.createdAt)
    if (!lifeopsId || !title || !updatedAt) return []
    return [document({
      lifeopsId, type: 'fitness-summary', version: positiveVersion(activity.entityVersion), updatedAt, title,
      tags: tags(activity.tags),
      body: [
        `# ${title}`,
        '## 已记录的活动事实',
        `- 默认时长：${numberText(activity.defaultMinutes)} 分钟`,
        `- 强度：${inline(activity.intensity, '未标注')}`,
        `- 记录的每小时能量估值：${numberText(activity.kcalPerHour)} kcal`,
        '## 步骤',
        bulletLines(activity.steps),
        '## 器材',
        bulletLines(activity.equipment),
      ].join('\n\n'),
    })]
  })
}

function reviewDocuments(reviews: Review[]): LifeProjectionDocument[] {
  return reviews.flatMap((review) => {
    if (review.deletedAt != null) return []
    const updatedAt = timestamp(review.updatedAt, review.createdAt)
    if (!review.id || !updatedAt) return []
    const title = `${review.period.from} 至 ${review.period.to} 生活回顾`
    return [document({
      lifeopsId: review.id, type: 'life-review', version: positiveVersion(review.version), updatedAt, title,
      tags: ['生活回顾', review.type],
      body: [
        `# ${title}`,
        '## 做到的事', bulletLines(review.achievements),
        '## 遇到的问题', bulletLines(review.problems),
        '## 原因', bulletLines(review.causes),
        '## 新的理解', bulletLines(review.insights),
        '## 下一步变化', bulletLines(review.nextChanges),
      ].join('\n\n'),
    })]
  })
}

function shoppingDocuments(payload: PortablePayload): LifeProjectionDocument[] {
  return records(payload.shoppingItems).flatMap((item) => {
    const lifeopsId = inline(item.id)
    const updatedAt = timestamp(item.updatedAt, item.createdAt)
    if (!lifeopsId || !updatedAt) return []
    const title = `采购摘要 · ${inline(item.itemId, lifeopsId)}`
    return [document({
      lifeopsId, type: 'shopping-summary', version: positiveVersion(item.version), updatedAt, title,
      tags: tags(item.tags),
      body: [
        `# ${title}`,
        `- 物品：${inline(item.itemId, '未记录')}`,
        `- 请求数量：${numberText(item.requestedQuantity)} ${inline(item.unit)}`,
        `- 已购数量：${numberText(item.purchasedQuantity)} ${inline(item.unit)}`,
        `- 剩余数量：${numberText(item.remainingQuantity)} ${inline(item.unit)}`,
        `- 需要日期：${inline(item.neededOn, '未指定')}`,
        `- 状态：${inline(item.status, '未记录')}`,
      ].join('\n\n'),
    })]
  })
}

function budgetDocuments(payload: PortablePayload): LifeProjectionDocument[] {
  return records(payload.budgets).flatMap((budget) => {
    const lifeopsId = inline(budget.id)
    const title = inline(budget.name)
    const updatedAt = timestamp(budget.updatedAt, budget.createdAt)
    const period = budget.period && typeof budget.period === 'object' && !Array.isArray(budget.period)
      ? budget.period as Record<string, unknown>
      : {}
    if (!lifeopsId || !title || !updatedAt) return []
    return [document({
      lifeopsId, type: 'budget-summary', version: positiveVersion(budget.version), updatedAt, title,
      tags: tags(budget.tags),
      body: [
        `# ${title}`,
        `- 周期：${inline(period.startsOn, '未记录')} 至 ${inline(period.endsOn, '未记录')}`,
        `- 预算上限（最小货币单位）：${numberText(budget.limitMinor)}`,
        `- 结转（最小货币单位）：${numberText(budget.rolloverMinor, '0')}`,
        `- 提醒阈值：${Array.isArray(budget.thresholds) ? budget.thresholds.filter((value) => typeof value === 'number').join('、') : '未设置'}`,
      ].join('\n\n'),
    })]
  })
}

export function projectLifeKnowledge(source: LifeProjectionSource): LifeProjectionDocument[] {
  const selected = new Set<LifeProjectionType>(source.selectedTypes ?? lifeProjectionTypes)
  return [
    ...recipeDocuments(source.payload),
    ...cookingDocuments(source.payload),
    ...fitnessDocuments(source.payload),
    ...reviewDocuments(source.reviews ?? []),
    ...shoppingDocuments(source.payload),
    ...budgetDocuments(source.payload),
  ]
    .filter(({ type }) => selected.has(type))
    .sort((left, right) => left.type.localeCompare(right.type, 'en') || left.lifeopsId.localeCompare(right.lifeopsId, 'en'))
}

function validateDocument(value: LifeProjectionDocument): void {
  if (!value.lifeopsId || value.lifeopsId === '.' || value.lifeopsId === '..' || /[\\\u0000-\u001f]/u.test(value.lifeopsId)) throw new Error('Invalid lifeops_id')
  if (!typeSet.has(value.type)) throw new Error('Invalid projection type')
  if (!Number.isInteger(value.version) || value.version < 1) throw new Error('Invalid version')
  if (!timestamp(value.updatedAt)) throw new Error('Invalid updated_at')
  if (!value.title || !Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string')) throw new Error('Invalid projection metadata')
  if (typeof value.body !== 'string' || value.path !== pathFor(value.type, value.lifeopsId)) throw new Error('Invalid projection path or body')
}

export function serializeLifeProjection(value: LifeProjectionDocument): string {
  validateDocument(value)
  return [
    '---',
    `lifeops_id: ${JSON.stringify(value.lifeopsId)}`,
    `type: ${JSON.stringify(value.type)}`,
    `version: ${value.version}`,
    `updated_at: ${JSON.stringify(value.updatedAt)}`,
    `title: ${JSON.stringify(value.title)}`,
    'tags:',
    ...value.tags.map((tag) => `  - ${JSON.stringify(tag)}`),
    '---',
    value.body,
  ].join('\n')
}

export function parseLifeProjectionMarkdown(markdown: string, path: string): LifeProjectionDocument {
  if (!markdown.startsWith('---\n')) throw new Error('Missing frontmatter')
  const closing = markdown.indexOf('\n---\n', 4)
  if (closing < 0) throw new Error('Missing frontmatter boundary')
  const header = markdown.slice(4, closing)
  const values = new Map<string, unknown>()
  const parsedTags: string[] = []
  let readingTags = false
  for (const line of header.split('\n')) {
    if (readingTags && line.startsWith('  - ')) {
      const tag = JSON.parse(line.slice(4)) as unknown
      if (typeof tag !== 'string') throw new Error('Invalid tags')
      parsedTags.push(tag)
      continue
    }
    readingTags = false
    const separator = line.indexOf(':')
    if (separator <= 0) throw new Error('Invalid frontmatter entry')
    const key = line.slice(0, separator)
    if (!['lifeops_id', 'type', 'version', 'updated_at', 'title', 'tags'].includes(key)) throw new Error(`Unsupported frontmatter entry: ${key}`)
    if (values.has(key)) throw new Error(`Duplicate frontmatter entry: ${key}`)
    const raw = line.slice(separator + 1).trim()
    if (key === 'tags') {
      if (raw) throw new Error('Invalid tags')
      values.set(key, parsedTags)
      readingTags = true
      continue
    }
    try { values.set(key, JSON.parse(raw)) } catch { throw new Error(`Invalid frontmatter entry: ${key}`) }
  }
  for (const key of ['lifeops_id', 'type', 'version', 'updated_at', 'title', 'tags']) {
    if (!values.has(key)) throw new Error(`Missing ${key}`)
  }
  const value: LifeProjectionDocument = {
    lifeopsId: values.get('lifeops_id') as string,
    type: values.get('type') as LifeProjectionType,
    version: values.get('version') as number,
    updatedAt: values.get('updated_at') as string,
    title: values.get('title') as string,
    tags: values.get('tags') as string[],
    body: markdown.slice(closing + 5),
    path,
  }
  validateDocument(value)
  return value
}

export function exportLifeProjectionZip(documents: LifeProjectionDocument[]): Uint8Array {
  const entries: Zippable = {}
  const keys = new Set<string>()
  for (const value of [...documents].sort((left, right) => left.path.localeCompare(right.path, 'en'))) {
    validateDocument(value)
    const key = `${value.type}:${value.lifeopsId}`
    if (keys.has(key)) throw new Error(`Duplicate Life projection: ${key}`)
    keys.add(key)
    entries[value.path] = [strToU8(serializeLifeProjection(value)), { mtime: FIXED_ZIP_MTIME }]
  }
  return zipSync(entries, { level: 6, mtime: FIXED_ZIP_MTIME })
}

export function previewLifeProjectionZip(bytes: Uint8Array): LifeProjectionDocument[] {
  const entries = unzipSync(bytes)
  const documents = Object.keys(entries)
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((path) => parseLifeProjectionMarkdown(strFromU8(entries[path]), path))
  const keys = new Set<string>()
  for (const value of documents) {
    const key = `${value.type}:${value.lifeopsId}`
    if (keys.has(key)) throw new Error(`Duplicate ZIP Life projection: ${key}`)
    keys.add(key)
  }
  return documents
}
