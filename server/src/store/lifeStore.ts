import type { KnowledgeNote, LifeState, PlanItem, PublicSnapshot, Session, SourceType, User } from '../domain/types.js'
import type { GoalsStore } from '../domain/goals.js'
import type { TasksStore } from '../domain/tasks.js'
import type { HabitsStore } from '../domain/habits.js'
import type { RecordsStore } from '../domain/records.js'
import type { ReviewsStore } from '../domain/reviews.js'
import type { LifeCatalogStore } from './lifeCatalogStore.js'
import type { LifeInventoryStore } from './lifeInventoryStore.js'
import type { LifeRecipeStore } from './lifeRecipeStore.js'
import type { LifePlanningStore } from './lifePlanningStore.js'
import type { LifeCommerceStore } from './lifeCommerceStore.js'
import type { MediaStoragePort } from '../media/storagePort.js'
import type { KnowledgeStore } from '../domain/knowledge.js'
import type { PublishingStore } from './publishingStore.js'
import type { SearchStore } from '../domain/search.js'
import type { SettingsStore } from './settingsStore.js'

export interface LifeStore extends GoalsStore, TasksStore, HabitsStore, RecordsStore, ReviewsStore, KnowledgeStore, PublishingStore, LifeCatalogStore, LifeInventoryStore, LifeRecipeStore, LifePlanningStore, LifeCommerceStore, SearchStore, SettingsStore {
  configureMediaStorage(storage: MediaStoragePort | undefined): void
  createUser(input: { account: string; displayName: string; passwordHash: string }): Promise<User>
  findUserByAccount(account: string): Promise<User | undefined>
  findUserById(id: string): Promise<User | undefined>
  createSession(input: { userId: string; tokenHash: string; csrfToken: string; expiresAt: string }): Promise<Session>
  findSessionByTokenHash(tokenHash: string): Promise<Session | undefined>
  deleteSession(id: string): Promise<void>
  getLoginFailure(key: string): Promise<{ count: number; resetAt: string } | undefined>
  recordLoginFailure(key: string, now: string, resetAt: string): Promise<void>
  clearLoginFailures(key: string): Promise<void>
  getState(userId: string): Promise<LifeState>
  createPlan(userId: string, input: { title: string; scheduledFor?: string }): Promise<PlanItem>
  completePlan(userId: string, id: string): Promise<PlanItem | undefined>
  createKnowledge(userId: string, input: { sourceType: 'record' | 'review'; sourceId: string; title: string; body: string; tags?: string[] }): Promise<KnowledgeNote>
  createSnapshot(userId: string, input: { slug: string; sourceType: SourceType; sourceId: string; title: string; excerpt: string }): Promise<PublicSnapshot>
  publishSnapshot(userId: string, id: string): Promise<PublicSnapshot | undefined>
  revokeSnapshot(userId: string, id: string): Promise<PublicSnapshot | undefined>
  listPublicSnapshots(): Promise<PublicSnapshot[]>
  getPublicSnapshot(slug: string): Promise<PublicSnapshot | undefined>
  ping(): Promise<void>
  close(): Promise<void>
}
