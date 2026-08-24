import type { KnowledgeNote, LifeRecord, LifeState, PeriodReview, PlanItem, PublicSnapshot, SourceType } from '../domain/types'

export interface AuthUser { id: string; account: string; displayName: string }
export interface AuthSession { user: AuthUser; csrfToken: string }

export class LifeApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message)
    this.name = 'LifeApiError'
  }
}

export class LifeApi {
  private csrfToken = ''

  constructor(private readonly baseUrl = '/api/v1') {}

  async login(account: string, password: string) {
    const session = await this.request<AuthSession>('/auth/login', { method: 'POST', body: JSON.stringify({ account, password }) })
    this.csrfToken = session.csrfToken
    return session
  }
  async session() {
    const session = await this.request<AuthSession>('/auth/session')
    this.csrfToken = session.csrfToken
    return session
  }
  async logout() {
    await this.request<void>('/auth/logout', { method: 'POST', write: true })
    this.csrfToken = ''
  }
  async state() { return this.request<LifeState>('/state') }
  async createPlan(input: { title: string; scheduledFor?: string }) { return this.request<PlanItem>('/plans', { method: 'POST', write: true, body: JSON.stringify(input) }) }
  async completePlan(id: string) { return this.request<PlanItem>(`/plans/${encodeURIComponent(id)}/complete`, { method: 'POST', write: true }) }
  async createRecord(input: { planId?: string; title: string; body: string; occurredAt?: string; tags?: string[] }, idempotencyKey = crypto.randomUUID()) { return this.request<LifeRecord>('/records', { method: 'POST', write: true, body: JSON.stringify(input), idempotencyKey }) }
  async createReview(input: { periodStart: string; periodEnd: string; summary: string; insights?: string[]; sourcePlanIds?: string[]; sourceRecordIds?: string[] }) { return this.request<PeriodReview>('/reviews', { method: 'POST', write: true, body: JSON.stringify(input) }) }
  async createKnowledge(input: { sourceType: 'record' | 'review'; sourceId: string; title: string; body: string; tags?: string[] }) { return this.request<KnowledgeNote>('/knowledge', { method: 'POST', write: true, body: JSON.stringify(input) }) }
  async createSnapshot(input: { sourceType: SourceType; sourceId: string; title: string; excerpt: string }) { return this.request<PublicSnapshot>('/snapshots', { method: 'POST', write: true, body: JSON.stringify(input) }) }
  async publishSnapshot(id: string) { return this.request<PublicSnapshot>(`/snapshots/${encodeURIComponent(id)}/publish`, { method: 'POST', write: true }) }
  async revokeSnapshot(id: string) { return this.request<PublicSnapshot>(`/snapshots/${encodeURIComponent(id)}/revoke`, { method: 'POST', write: true }) }
  async publicSnapshot(slug: string) { return this.request<Pick<PublicSnapshot, 'slug' | 'title' | 'excerpt' | 'publishedAt'>>(`/public/snapshots/${encodeURIComponent(slug)}`) }

  private async request<T>(path: string, options: { method?: string; body?: string; write?: boolean; idempotencyKey?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (options.body) headers['content-type'] = 'application/json'
    if (options.write) headers['x-csrf-token'] = this.csrfToken
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey
    const response = await fetch(`${this.baseUrl}${path}`, { method: options.method ?? 'GET', body: options.body, credentials: 'same-origin', headers })
    if (response.status === 204) return undefined as T
    const payload = await response.json() as T | { error?: { code?: string; message?: string } }
    if (!response.ok) {
      const error = 'error' in (payload as object) ? (payload as { error?: { code?: string; message?: string } }).error : undefined
      throw new LifeApiError(error?.code ?? 'REQUEST_FAILED', error?.message ?? '请求失败，请稍后重试', response.status)
    }
    return payload as T
  }
}

export const lifeApi = new LifeApi()
export const isLocalDemoMode = import.meta.env.DEV && import.meta.env.VITE_LIFEOPS_API_MODE !== 'remote'
