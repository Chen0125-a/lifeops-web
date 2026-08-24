import { lifeApi, type LifeApi } from '../api/lifeApi'
import type { KnowledgeNote, LifeRecord, LifeState, PeriodReview, PlanItem, PublicSnapshot, SourceType } from './types'

const emptyState = (): LifeState => ({ schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] })

export class RemoteLifeRepository {
  private state: LifeState = emptyState()
  private readonly listeners = new Set<() => void>()
  readonly remote = true

  constructor(private readonly api: LifeApi = lifeApi) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  async refresh() { this.commit(await this.api.state()) }
  reset() { this.commit(emptyState()) }

  async createPlan(input: { title: string; scheduledFor?: string }) { const item = await this.api.createPlan(input); this.commit({ ...this.state, plans: [...this.state.plans, item] }); return item }
  async completePlan(id: string) { const item = await this.api.completePlan(id); this.commit({ ...this.state, plans: this.state.plans.map((plan) => plan.id === id ? item : plan) }); return item }
  async createRecord(input: { planId?: string; title: string; body: string; occurredAt?: string; tags?: string[] }) { const item = await this.api.createRecord(input); this.commit({ ...this.state, records: [...this.state.records, item] }); return item }
  async createReview(input: { periodStart: string; periodEnd: string; summary: string; insights?: string[]; sourcePlanIds?: string[]; sourceRecordIds?: string[] }) { const item = await this.api.createReview(input); this.commit({ ...this.state, reviews: [...this.state.reviews, item] }); return item }
  async createKnowledgeNote(input: { sourceType: 'record' | 'review'; sourceId: string; title: string; body: string; tags?: string[] }) { const item = await this.api.createKnowledge(input); this.commit({ ...this.state, knowledge: [...this.state.knowledge, item] }); return item }
  async createSnapshot(input: { sourceType: SourceType; sourceId: string; title: string; excerpt: string }) { const item = await this.api.createSnapshot(input); this.commit({ ...this.state, snapshots: [...this.state.snapshots, item] }); return item }
  async publishSnapshot(id: string) { const item = await this.api.publishSnapshot(id); this.replaceSnapshot(item); return item }
  async revokeSnapshot(id: string) { const item = await this.api.revokeSnapshot(id); this.replaceSnapshot(item); return item }

  private replaceSnapshot(item: PublicSnapshot) { this.commit({ ...this.state, snapshots: this.state.snapshots.map((snapshot) => snapshot.id === item.id ? item : snapshot) }) }
  private commit(state: LifeState) { this.state = state; this.listeners.forEach((listener) => listener()) }
}

export interface RepositoryPort {
  getSnapshot(): LifeState
  subscribe(listener: () => void): () => void
  createPlan(input: { title: string; scheduledFor?: string }): PlanItem | Promise<PlanItem>
  completePlan(id: string): PlanItem | Promise<PlanItem>
  createRecord(input: { planId?: string; title: string; body: string; occurredAt?: string; tags?: string[] }): LifeRecord | Promise<LifeRecord>
  createReview(input: { periodStart: string; periodEnd: string; summary: string; insights?: string[]; sourcePlanIds?: string[]; sourceRecordIds?: string[] }): PeriodReview | Promise<PeriodReview>
  createKnowledgeNote(input: { sourceType: 'record' | 'review'; sourceId: string; title: string; body: string; tags?: string[] }): KnowledgeNote | Promise<KnowledgeNote>
  createSnapshot(input: { sourceType: SourceType; sourceId: string; title: string; excerpt: string }): PublicSnapshot | Promise<PublicSnapshot>
  publishSnapshot(id: string): PublicSnapshot | Promise<PublicSnapshot>
  revokeSnapshot(id: string): PublicSnapshot | Promise<PublicSnapshot>
}
