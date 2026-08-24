import type {
  KnowledgeNote,
  LifeRecord,
  LifeState,
  PeriodReview,
  PlanItem,
  PublicSnapshot,
  ReviewEvidence,
  SourceType,
} from './types'

export interface StoragePort {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface RepositoryOptions {
  storage: StoragePort
  key?: string
  createId?: () => string
  now?: () => string
}

const emptyState = (): LifeState => ({
  schemaVersion: 1,
  plans: [],
  records: [],
  reviews: [],
  knowledge: [],
  snapshots: [],
})

const nonEmpty = (value: string, field: string) => {
  const clean = value.trim()
  if (!clean) throw new Error(`${field}不能为空`)
  return clean
}

const isArray = <T>(value: unknown): T[] => (Array.isArray(value) ? value : [])

function migrate(raw: unknown, now: string): LifeState {
  if (!raw || typeof raw !== 'object') return emptyState()
  const source = raw as Record<string, unknown>
  const plans = isArray<Record<string, unknown>>(source.plans).map((item) => {
    const status =
      item.status === 'done' || item.done === true
        ? 'done'
        : item.status === 'skipped'
          ? 'skipped'
          : 'planned'
    return {
      id: String(item.id ?? crypto.randomUUID()),
      title: String(item.title ?? '未命名计划'),
      scheduledFor: typeof item.scheduledFor === 'string' ? item.scheduledFor : undefined,
      status,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : now,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : now,
      completedAt:
        typeof item.completedAt === 'string'
          ? item.completedAt
          : status === 'done'
            ? now
            : undefined,
    } satisfies PlanItem
  })

  return {
    schemaVersion: 1,
    plans,
    records: isArray<Record<string, unknown>>(source.records).map((item) => ({
      id: String(item.id ?? crypto.randomUUID()),
      ...(typeof item.planId === 'string' ? { planId: item.planId } : {}),
      title: String(item.title ?? '未命名记录'),
      body: String(item.body ?? ''),
      occurredAt: typeof item.occurredAt === 'string' ? item.occurredAt : now,
      tags: isArray<string>(item.tags).map(String),
      pinned: item.pinned === true,
      archivedAt: typeof item.archivedAt === 'string' ? item.archivedAt : null,
      links: isArray<Record<string, unknown>>(item.links)
        .filter((link) => ['goal', 'project', 'task', 'habit'].includes(String(link.type)) && typeof link.id === 'string')
        .map((link) => ({ type: link.type as 'goal' | 'project' | 'task' | 'habit', id: String(link.id) })),
      mediaIds: isArray<string>(item.mediaIds).map(String),
      coverMediaId: typeof item.coverMediaId === 'string' ? item.coverMediaId : null,
      version: Number.isInteger(item.version) && Number(item.version) > 0 ? Number(item.version) : 1,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : now,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : typeof item.createdAt === 'string' ? item.createdAt : now,
      deletedAt: typeof item.deletedAt === 'string' ? item.deletedAt : null,
    } satisfies LifeRecord)),
    reviews: isArray<PeriodReview>(source.reviews),
    knowledge: isArray<KnowledgeNote>(source.knowledge),
    snapshots: isArray<PublicSnapshot>(source.snapshots),
  }
}

export class LifeRepository {
  private readonly storage: StoragePort
  private readonly key: string
  private readonly createId: () => string
  private readonly now: () => string
  private readonly listeners = new Set<() => void>()
  private state: LifeState

  constructor(options: RepositoryOptions) {
    this.storage = options.storage
    this.key = options.key ?? 'lifeops:data:v1'
    this.createId = options.createId ?? (() => crypto.randomUUID())
    this.now = options.now ?? (() => new Date().toISOString())
    this.state = this.read()
    this.persist()
  }

  getSnapshot = (): LifeState => this.state

  get storageKey() {
    return this.key
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  refreshFromStorage = () => {
    const next = this.read()
    if (JSON.stringify(next) === JSON.stringify(this.state)) return false
    this.state = next
    this.listeners.forEach((listener) => listener())
    return true
  }

  createPlan(input: { title: string; scheduledFor?: string }): PlanItem {
    const timestamp = this.now()
    const plan: PlanItem = {
      id: this.createId(),
      title: nonEmpty(input.title, '计划'),
      scheduledFor: input.scheduledFor || undefined,
      status: 'planned',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.commit({ ...this.state, plans: [...this.state.plans, plan] })
    return plan
  }

  completePlan(id: string): PlanItem {
    const timestamp = this.now()
    let completed: PlanItem | undefined
    const plans = this.state.plans.map((plan) => {
      if (plan.id !== id) return plan
      completed = {
        ...plan,
        status: 'done',
        completedAt: timestamp,
        updatedAt: timestamp,
      }
      return completed
    })
    if (!completed) throw new Error('找不到计划')
    this.commit({ ...this.state, plans })
    return completed
  }

  createRecord(input: {
    planId?: string
    title: string
    body: string
    occurredAt?: string
    tags?: string[]
  }): LifeRecord {
    if (input.planId && !this.state.plans.some((plan) => plan.id === input.planId)) {
      throw new Error('找不到来源计划')
    }
    const timestamp = this.now()
    const record: LifeRecord = {
      id: this.createId(),
      planId: input.planId,
      title: nonEmpty(input.title, '记录标题'),
      body: nonEmpty(input.body, '记录内容'),
      occurredAt: input.occurredAt ?? timestamp,
      tags: (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
      pinned: false,
      archivedAt: null,
      links: [],
      mediaIds: [],
      coverMediaId: null,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    }
    this.commit({ ...this.state, records: [...this.state.records, record] })
    return record
  }

  createReview(input: {
    periodStart: string
    periodEnd: string
    summary: string
    insights?: string[]
    sourcePlanIds?: string[]
    sourceRecordIds?: string[]
  }): PeriodReview {
    const evidence: ReviewEvidence[] = []
    for (const id of input.sourcePlanIds ?? []) {
      const plan = this.state.plans.find((item) => item.id === id)
      if (plan) evidence.push({ type: 'plan', sourceId: id, title: plan.title, excerpt: plan.status })
    }
    for (const id of input.sourceRecordIds ?? []) {
      const record = this.state.records.find((item) => item.id === id)
      if (record) {
        evidence.push({
          type: 'record',
          sourceId: id,
          title: record.title,
          excerpt: record.body.slice(0, 160),
        })
      }
    }
    const review: PeriodReview = {
      id: this.createId(),
      periodStart: nonEmpty(input.periodStart, '开始日期'),
      periodEnd: nonEmpty(input.periodEnd, '结束日期'),
      summary: nonEmpty(input.summary, '回顾总结'),
      insights: (input.insights ?? []).map((insight) => insight.trim()).filter(Boolean),
      evidence,
      createdAt: this.now(),
    }
    this.commit({ ...this.state, reviews: [...this.state.reviews, review] })
    return review
  }

  createKnowledgeNote(input: {
    sourceType: 'record' | 'review'
    sourceId: string
    title: string
    body: string
    tags?: string[]
  }): KnowledgeNote {
    const sourceExists =
      input.sourceType === 'record'
        ? this.state.records.some((item) => item.id === input.sourceId)
        : this.state.reviews.some((item) => item.id === input.sourceId)
    if (!sourceExists) throw new Error('找不到知识来源')
    const note: KnowledgeNote = {
      id: this.createId(),
      source: { type: input.sourceType, id: input.sourceId },
      title: nonEmpty(input.title, '知识标题'),
      body: nonEmpty(input.body, '知识内容'),
      tags: (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
      createdAt: this.now(),
    }
    this.commit({ ...this.state, knowledge: [...this.state.knowledge, note] })
    return note
  }

  createSnapshot(input: {
    sourceType: SourceType
    sourceId: string
    title: string
    excerpt: string
  }): PublicSnapshot {
    const sourceCollections: Record<SourceType, Array<{ id: string }>> = {
      plan: this.state.plans,
      record: this.state.records,
      review: this.state.reviews,
      knowledge: this.state.knowledge,
    }
    if (!sourceCollections[input.sourceType].some((item) => item.id === input.sourceId)) {
      throw new Error('找不到公开快照来源')
    }
    const snapshot: PublicSnapshot = {
      id: this.createId(),
      slug: '',
      source: { type: input.sourceType, id: input.sourceId },
      title: nonEmpty(input.title, '公开标题'),
      excerpt: nonEmpty(input.excerpt, '公开摘录'),
      visibility: 'private',
      createdAt: this.now(),
    }
    snapshot.slug = snapshot.id
    this.commit({ ...this.state, snapshots: [...this.state.snapshots, snapshot] })
    return snapshot
  }

  publishSnapshot(id: string): PublicSnapshot {
    return this.updateSnapshot(id, {
      visibility: 'public',
      publishedAt: this.now(),
      revokedAt: undefined,
    })
  }

  revokeSnapshot(id: string): PublicSnapshot {
    return this.updateSnapshot(id, {
      visibility: 'private',
      revokedAt: this.now(),
    })
  }

  private updateSnapshot(
    id: string,
    patch: Partial<PublicSnapshot>,
  ): PublicSnapshot {
    let updated: PublicSnapshot | undefined
    const snapshots = this.state.snapshots.map((snapshot) => {
      if (snapshot.id !== id) return snapshot
      updated = { ...snapshot, ...patch }
      return updated
    })
    if (!updated) throw new Error('找不到公开快照')
    this.commit({ ...this.state, snapshots })
    return updated
  }

  private read(): LifeState {
    const serialized = this.storage.getItem(this.key)
    if (!serialized) return emptyState()
    try {
      return migrate(JSON.parse(serialized), this.now())
    } catch {
      return emptyState()
    }
  }

  private persist() {
    this.storage.setItem(this.key, JSON.stringify(this.state))
  }

  private commit(state: LifeState) {
    this.state = state
    this.persist()
    this.listeners.forEach((listener) => listener())
  }
}

export function createMemoryStorage(seed: Record<string, string> = {}): StoragePort {
  const data = new Map(Object.entries(seed))
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  }
}
