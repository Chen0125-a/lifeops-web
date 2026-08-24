import { createHash, randomUUID } from 'node:crypto'
import type { KnowledgeNote, LifeRecord, LifeState, MediaAsset, PeriodReview, PlanItem, PublicSnapshot, SafeAuditEvent, Session, SourceType, User, UserSettings, UserSettingsDocument } from '../domain/types.js'
import type { Goal, GoalsStore, Milestone, Project } from '../domain/goals.js'
import { TasksDomainError, type ScheduleBlock, type Task, type TasksStore } from '../domain/tasks.js'
import { HabitsDomainError, type Habit, type HabitEntry, type HabitsStore } from '../domain/habits.js'
import {
  RecordsDomainError,
  assertRecordVersion,
  createMediaAssetEntity,
  createRecordEntity,
  normalizeRecordIdempotencyKey,
  updateRecordEntity,
  type CreateMediaAssetInput,
  type CreateRecordInput,
  type RecordFilters,
  type RecordsStore,
  type UpdateRecordInput,
} from '../domain/records.js'
import {
  ReviewsDomainError,
  assertReviewVersion,
  buildReviewEvidence,
  createReviewEntity,
  normalizeReviewIdempotencyKey,
  updateReviewEntity,
  type ConvertReviewActionInput,
  type CreateReviewInput,
  type Review,
  type ReviewActionConversion,
  type ReviewFilters,
  type ReviewPeriod,
  type ReviewsStore,
  type UpdateReviewInput,
} from '../domain/reviews.js'
import type { LifeStore } from './lifeStore.js'
import { GoalsMemoryStore } from './memory/goalsMemoryStore.js'
import { TasksMemoryStore } from './memory/tasksMemoryStore.js'
import { HabitsMemoryStore } from './memory/habitsMemoryStore.js'
import { MemoryLifeCatalogStore } from './memory/memoryLifeCatalogStore.js'
import { MemoryLifeInventoryStore } from './memory/memoryLifeInventoryStore.js'
import { MemoryLifeRecipeStore } from './memory/memoryLifeRecipeStore.js'
import { MemoryLifePlanningStore } from './memory/memoryLifePlanningStore.js'
import { MemoryLifeCommerceStore } from './memory/memoryLifeCommerceStore.js'
import {
  MemoryOwnerTransactionCoordinator,
  type MemoryOwnerTransactionObserver,
} from './memory/memoryOwnerTransactionCoordinator.js'
import type { LifeCatalogStore } from './lifeCatalogStore.js'
import type { LifeInventoryStore } from './lifeInventoryStore.js'
import type { LifeRecipeStore } from './lifeRecipeStore.js'
import type { LifePlanningStore } from './lifePlanningStore.js'
import type { LifeCommerceStore } from './lifeCommerceStore.js'
import type { MediaStoragePort } from '../media/storagePort.js'
import { LifeCommerceDomainError, type PortableMediaAsset } from '../domain/life/commerce.js'
import {
  KnowledgeDomainError,
  assertKnowledgeVersion,
  createKnowledgeCollectionEntity,
  createKnowledgeNoteEntity,
  rankResurfacedKnowledge,
  updateKnowledgeCollectionEntity,
  updateKnowledgeNoteEntity,
  type CreateKnowledgeInput,
  type KnowledgeCollection,
  type KnowledgeFilters,
  type UpdateKnowledgeInput,
} from '../domain/knowledge.js'
import {
  PublishingDomainError,
  assertPublicSlugAvailable,
  createPublicDraftEntity,
  createPublicRevisionEntity,
  diffPublicRevisions,
  schedulePublicDraftEntity,
  updatePublicDraftEntity,
  type CreatePublicDraftInput,
  type PublicDraft,
  type PublicRevision,
  type UpdatePublicDraftInput,
} from '../domain/publishing.js'
import type { PublicationResult } from '../services/publicationScheduler.js'
import { searchDocuments, type SearchDocument, type SearchStore, type SearchType } from '../domain/search.js'
import type { DataExportResult, DataTransferOwnedData, DataTransferRestorePoint } from '../services/dataTransfer.js'
import { DEFAULT_USER_SETTINGS } from './settingsStore.js'

interface Owned<T> { userId: string; value: T }

const clean = (value: string, field: string) => {
  const result = value.trim()
  if (!result) throw new Error(`${field}不能为空`)
  return result
}

export class MemoryLifeStore implements LifeStore {
  private readonly createId: () => string
  private readonly now: () => string
  private readonly users: User[] = []
  private readonly sessions: Session[] = []
  private readonly userSettings = new Map<string, UserSettingsDocument>()
  private readonly safeAuditEvents: Array<Owned<SafeAuditEvent>> = []
  private readonly dataTransferRestorePoints: Array<Owned<DataTransferRestorePoint & { canonicalJson: string; counts: Record<string, number> }>> = []
  private readonly loginFailures = new Map<string, { count: number; resetAt: string }>()
  private readonly plans: Array<Owned<PlanItem>> = []
  private readonly records: Array<Owned<LifeRecord>> = []
  private readonly mediaAssets: Array<Owned<MediaAsset>> = []
  private readonly recordIdempotency = new Map<string, { hash: string; promise: Promise<unknown> }>()
  private readonly reviews: Array<Owned<Review>> = []
  private readonly reviewIdempotency = new Map<string, { hash: string; promise: Promise<unknown> }>()
  private readonly reviewConversionIdempotency = new Map<string, { hash: string; promise: Promise<unknown> }>()
  private readonly reviewActionConversions = new Map<string, Promise<ReviewActionConversion>>()
  private readonly goalUpdates: Array<Owned<{ id: string; goalId: string; reviewId: string; actionId: string; body: string; createdAt: string }>> = []
  private readonly knowledge: Array<Owned<KnowledgeNote>> = []
  private readonly knowledgeCollections: Array<Owned<KnowledgeCollection>> = []
  private readonly snapshots: Array<Owned<PublicSnapshot>> = []
  private readonly publicDrafts: Array<Owned<PublicDraft>> = []
  private readonly publicRevisions: Array<Owned<PublicRevision>> = []
  private readonly goalsStore: GoalsMemoryStore
  private readonly tasksStore: TasksMemoryStore
  private readonly habitsStore: HabitsMemoryStore
  private readonly lifeCatalogStore: MemoryLifeCatalogStore
  private readonly lifeInventoryStore: MemoryLifeInventoryStore
  private readonly lifeRecipeStore: MemoryLifeRecipeStore
  private readonly lifePlanningStore: MemoryLifePlanningStore
  private readonly lifeCommerceStore: MemoryLifeCommerceStore
  private readonly ownerTransactions: MemoryOwnerTransactionCoordinator
  private mediaStorage: MediaStoragePort | undefined

  constructor(options: {
    createId?: () => string
    now?: () => string
    transactionObserver?: MemoryOwnerTransactionObserver
    mediaStorage?: MediaStoragePort
  } = {}) {
    this.createId = options.createId ?? randomUUID
    this.now = options.now ?? (() => new Date().toISOString())
    this.mediaStorage = options.mediaStorage
    this.ownerTransactions = new MemoryOwnerTransactionCoordinator(options.transactionObserver)
    this.goalsStore = new GoalsMemoryStore({ createId: this.createId, now: this.now })
    this.tasksStore = new TasksMemoryStore({
      createId: this.createId,
      now: this.now,
      validateLinks: async (userId, links) => {
        const goal = links.goalId ? await this.goalsStore.getGoal(userId, links.goalId) : undefined
        if (links.goalId && !goal) throw new TasksDomainError('NOT_FOUND', '找不到目标', 404)
        const project = links.projectId ? await this.goalsStore.getProject(userId, links.projectId) : undefined
        if (links.projectId && !project) throw new TasksDomainError('NOT_FOUND', '找不到项目', 404)
        const milestone = links.milestoneId ? await this.goalsStore.getMilestone(userId, links.milestoneId) : undefined
        if (links.milestoneId && !milestone) throw new TasksDomainError('NOT_FOUND', '找不到里程碑', 404)
        if (project && links.goalId && project.goalId !== links.goalId) throw new TasksDomainError('INVALID_INPUT', '项目不属于所选目标', 400)
        if (milestone && links.projectId && milestone.projectId !== links.projectId) throw new TasksDomainError('INVALID_INPUT', '里程碑不属于所选项目', 400)
      },
    })
    this.habitsStore = new HabitsMemoryStore({
      createId: this.createId,
      now: this.now,
      validateLinks: async (userId, links) => {
        const goal = links.goalId ? await this.goalsStore.getGoal(userId, links.goalId) : undefined
        if (links.goalId && !goal) throw new HabitsDomainError('NOT_FOUND', '找不到目标', 404)
        const project = links.projectId ? await this.goalsStore.getProject(userId, links.projectId) : undefined
        if (links.projectId && !project) throw new HabitsDomainError('NOT_FOUND', '找不到项目', 404)
        if (project && links.goalId && project.goalId !== links.goalId) {
          throw new HabitsDomainError('INVALID_INPUT', '项目不属于所选目标', 400)
        }
      },
    })
    this.lifeCatalogStore = new MemoryLifeCatalogStore({
      createId: this.createId,
      now: this.now,
      validateMedia: (userId, mediaIds) => {
        for (const id of mediaIds) {
          if (!this.mediaAssets.some((entry) => entry.userId === userId && entry.value.id === id && entry.value.deletedAt == null)) {
            throw new RecordsDomainError('NOT_FOUND', 'Catalog attachment media was not found.', 404)
          }
        }
      },
      deleteImpact: async (userId, itemId) => ({
        recipeIds: [...new Set((await this.lifeRecipeStore.listRecipeRelations(userId, itemId)).map((relation) => relation.recipeId))].sort(),
        ...await this.lifePlanningStore.getPlanningCatalogReferences(userId, itemId),
      }),
    })
    this.lifeInventoryStore = new MemoryLifeInventoryStore({
      createId: this.createId,
      now: this.now,
      getCatalogItem: (userId, itemId) => this.lifeCatalogStore.getCatalogItem(userId, itemId),
      listUnits: (userId) => this.lifeCatalogStore.listUnits(userId),
      listLocations: (userId) => this.lifeCatalogStore.listTaxonomy(userId, 'location'),
    })
    this.lifeRecipeStore = new MemoryLifeRecipeStore({
      createId: this.createId,
      now: this.now,
      getCatalogItem: (userId, itemId) => this.lifeCatalogStore.getCatalogItem(userId, itemId),
      listCatalogItems: (userId) => this.lifeCatalogStore.listCatalogItems(userId),
      listTaxonomy: (userId, kind) => this.lifeCatalogStore.listTaxonomy(userId, kind),
      listUnits: (userId) => this.lifeCatalogStore.listUnits(userId),
      getMediaAsset: (userId, id) => this.getMediaAsset(userId, id),
      listInventoryBalances: (userId) => this.lifeInventoryStore.listInventoryBalances(userId),
      consumeRecipeIngredients: (userId, inputs, occurredAt, sessionId) => this.lifeInventoryStore.consumeRecipeIngredients(userId, inputs, occurredAt, sessionId),
    })
    this.lifePlanningStore = new MemoryLifePlanningStore({
      createId: this.createId,
      now: this.now,
      getCatalogItem: (userId, itemId) => this.lifeCatalogStore.getCatalogItem(userId, itemId),
      listUnits: (userId) => this.lifeCatalogStore.listUnits(userId),
      listInventoryForecasts: (userId) => this.lifeInventoryStore.listInventoryForecasts(userId),
      calculateStoredRecipe: (userId, recipeId, input) => this.lifeRecipeStore.calculateStoredRecipe(userId, recipeId, input),
      listPreparedFood: (userId) => this.lifeRecipeStore.listPreparedFood(userId),
      consumePreparedFood: (userId, recipeId, recipeVersionId, portions) => this.lifeRecipeStore.consumePreparedFood(userId, recipeId, recipeVersionId, portions),
      restorePreparedFood: (userId, events) => this.lifeRecipeStore.restorePreparedFood(userId, events),
      createInventoryTransaction: (userId, input, key) => this.lifeInventoryStore.createInventoryTransaction(userId, input, key),
      getInventoryTransactionActualCost: (userId, transactionId) => this.lifeInventoryStore.getTransactionActualCost(userId, transactionId),
      reverseInventoryTransaction: (userId, id, input, key) => this.lifeInventoryStore.reverseInventoryTransaction(userId, id, input, key),
      onMedicineCompletionInventoryEffect: (userId) => this.ownerTransactions.checkpoint(
        userId,
        'planning:complete-medicine-occurrence',
        'inventory-effect-applied',
      ),
    })
    this.lifeCommerceStore = new MemoryLifeCommerceStore({
      createId: this.createId,
      now: this.now,
      getCatalogItem: (userId, itemId) => this.lifeCatalogStore.getCatalogItem(userId, itemId),
      listCatalogItems: (userId) => this.lifeCatalogStore.listCatalogItems(userId),
      listCategoryIds: async (userId) => (await this.lifeCatalogStore.listTaxonomy(userId, 'category')).map((entry) => entry.id),
      readMediaAsset: async (userId, mediaId) => {
        const asset = await this.getMediaAsset(userId, mediaId)
        if (!asset || !this.mediaStorage) return undefined
        const bytes = await this.mediaStorage.read(asset.storageKey)
        return bytes ? { asset, bytes } : undefined
      },
      restoreMediaAssets: (userId, mediaAssets) => this.restorePortableMediaAssets(userId, mediaAssets),
      listUnits: (userId) => this.lifeCatalogStore.listUnits(userId),
      updateCatalogItem: (userId, itemId, input) => this.lifeCatalogStore.updateCatalogItem(userId, itemId, input),
      createInventoryTransaction: (userId, input, key) => this.lifeInventoryStore.createInventoryTransaction(userId, input, key),
      listInventoryBalances: (userId) => this.lifeInventoryStore.listInventoryBalances(userId),
      listUsableInventoryBalances: (userId, asOf) => this.lifeInventoryStore.listUsableInventoryBalances(userId, asOf),
      listCompletionSnapshots: (userId, from, to) => this.lifePlanningStore.listActiveCompletionSnapshotsForAnalytics(userId, from, to),
      getPlanningTimeline: (userId, date) => this.lifePlanningStore.getPlanningTimeline(userId, date),
      listDayPlanProjections: (userId, from, through) => this.lifePlanningStore.listDayPlanProjections(userId, from, through),
      exportBusinessData: async (userId) => ({
        ...this.lifeCatalogStore.exportOwnerPortableData(userId),
        ...await this.lifeInventoryStore.exportOwnerPortableData(userId),
        ...this.lifeRecipeStore.exportOwnerPortableData(userId),
        ...this.lifePlanningStore.exportOwnerPortableData(userId),
      }),
      replaceBusinessData: (userId, payload) => {
        this.lifeCatalogStore.replaceOwnerPortableData(userId, payload)
        this.lifeInventoryStore.replaceOwnerPortableData(userId, payload)
        this.lifeRecipeStore.replaceOwnerPortableData(userId, payload)
        this.lifePlanningStore.replaceOwnerPortableData(userId, payload)
      },
      mergeCatalogItems: (userId, items) => this.lifeCatalogStore.mergeOwnerPortableCatalogItems(userId, items),
      onImportBusinessDataReplaced: (userId) => this.ownerTransactions.checkpoint(
        userId, 'commerce:apply-import', 'business-data-replaced',
      ),
    })
  }

  configureMediaStorage(storage: MediaStoragePort | undefined) { this.mediaStorage = storage }

  async search(...args: Parameters<SearchStore['search']>) {
    const [userId, input] = args
    const documents: SearchDocument[] = []
    const add = (type: SearchType, sourceId: string, title: string, bodyText: string, tagsText: string, sourceText: string, updatedAt: string, deletedAt: string | null = null) => {
      documents.push({ userId, type, sourceId, title, bodyText, tagsText, sourceText, updatedAt, deletedAt })
    }
    const goals = await this.goalsStore.listGoals(userId)
    for (const goal of goals) add('goal', goal.id, goal.title, goal.description, '', goal.targetOn ?? '', goal.updatedAt, goal.deletedAt)
    for (const goal of goals) for (const project of await this.goalsStore.listProjects(userId, goal.id)) {
      add('project', project.id, project.title, `${project.description} ${project.riskNote}`, '', goal.title, project.updatedAt, project.deletedAt)
    }
    for (const task of await this.tasksStore.listTasks(userId)) add('task', task.id, task.title, task.description, task.tags.join(' '), [task.dueAt, task.projectId].filter(Boolean).join(' '), task.updatedAt, task.deletedAt)
    for (const plan of this.plans.filter((item) => item.userId === userId)) add('task', plan.value.id, plan.value.title, '', '', plan.value.scheduledFor ?? '', plan.value.updatedAt)
    for (const record of this.records.filter((item) => item.userId === userId)) add('record', record.value.id, record.value.title, record.value.body, record.value.tags.join(' '), record.value.occurredAt, record.value.updatedAt, record.value.deletedAt)
    for (const review of this.reviews.filter((item) => item.userId === userId)) {
      add('review', review.value.id, `${review.value.period.from} — ${review.value.period.to} 回顾`, [...review.value.achievements, ...review.value.problems, ...review.value.causes, ...review.value.insights, ...review.value.nextChanges].join(' '), '', review.value.type, review.value.updatedAt, review.value.deletedAt)
    }
    for (const note of this.knowledge.filter((item) => item.userId === userId)) add('knowledge', note.value.id, note.value.title, note.value.body, note.value.tags.join(' '), note.value.sourceLinks.map((link) => `${link.type} ${link.id}`).join(' '), note.value.updatedAt, note.value.deletedAt)
    for (const draft of this.publicDrafts.filter((item) => item.userId === userId)) add('public-draft', draft.value.id, draft.value.title, `${draft.value.excerpt} ${draft.value.body}`, draft.value.tags.join(' '), `${draft.value.category} ${draft.value.status}`, draft.value.updatedAt)

    const catalog = [...await this.lifeCatalogStore.listCatalogItems(userId), ...await this.lifeCatalogStore.listDeletedCatalogItems(userId)]
    const catalogById = new Map(catalog.map((item) => [item.id, item]))
    for (const item of catalog) {
      const type: SearchType = item.kind === 'medicine' ? 'medicine' : item.kind.startsWith('household_') ? 'household-item' : 'life-item'
      add(type, item.id, item.name, item.notes, `${item.aliases.join(' ')} ${item.tagIds.join(' ')}`, `${item.kind} ${item.baseUnit}`, item.updatedAt, item.deletedAt)
    }
    for (const recipe of [...await this.lifeRecipeStore.listRecipes(userId), ...await this.lifeRecipeStore.listDeletedRecipes(userId)]) {
      const ingredients = recipe.currentVersion.components.map((component) => catalogById.get(component.itemId)?.name ?? component.itemId)
      add('recipe', recipe.id, recipe.name, `${recipe.description} ${recipe.storageNotes}`, recipe.tagIds.join(' '), ingredients.join(' '), recipe.updatedAt, recipe.deletedAt)
    }
    for (const activity of await this.lifePlanningStore.listFitnessActivities(userId)) add('fitness', activity.id, activity.name, activity.steps.join(' '), activity.equipment.join(' '), activity.intensity, activity.updatedAt)
    for (const day of await this.lifePlanningStore.listDayPlanProjections(userId, '2000-01-01', '2100-12-31')) {
      add('day-plan', day.date, `${day.date} 日计划`, day.items.map((item) => `${item.kind} ${item.source?.id ?? ''}`).join(' '), '', day.date, `${day.date}T00:00:00.000Z`)
    }
    const shopping = await this.lifeCommerceStore.listShopping(userId)
    for (const item of shopping.formalItems) add('shopping-item', item.id, catalogById.get(item.itemId)?.name ?? item.itemId, item.storeGroup, '', `${item.neededOn ?? ''} ${item.status}`, item.updatedAt)
    return searchDocuments(documents, { ...input, userId })
  }

  private async restorePortableMediaAssets(userId: string, portableAssets: PortableMediaAsset[]) {
    const storage = this.mediaStorage
    if (!storage) throw new LifeCommerceDomainError('ATTACHMENT_STORAGE_UNAVAILABLE', 'Attachment storage is unavailable for this restore.', 409)
    const previous = structuredClone(this.mediaAssets.filter((entry) => entry.userId === userId))
    const replacedIds = new Set(portableAssets.map((asset) => asset.id))
    const oldStorageKeys = previous.filter((entry) => replacedIds.has(entry.value.id)).map((entry) => entry.value.storageKey)
    const createdStorageKeys: string[] = []
    const restored: Array<Owned<MediaAsset>> = []
    try {
      for (const portable of portableAssets) {
        const bytes = Buffer.from(portable.bytesBase64, 'base64')
        const stored = await storage.put({ originalName: portable.originalName, mimeType: portable.mimeType, bytes })
        createdStorageKeys.push(stored.storageKey)
        if (stored.sizeBytes !== portable.sizeBytes || stored.checksum.toUpperCase() !== portable.checksum.toUpperCase()
          || stored.mimeType !== portable.mimeType) {
          throw new LifeCommerceDomainError('ATTACHMENT_CONTENT_MISMATCH', `Attachment ${portable.id} failed storage verification.`, 409)
        }
        const { archiveEntry: _archiveEntry, bytesBase64: _bytesBase64, ...metadata } = portable
        restored.push({ userId, value: { ...metadata, storageKey: stored.storageKey, deletedAt: null } })
      }
    } catch (error) {
      await Promise.allSettled(createdStorageKeys.map((storageKey) => storage.remove(storageKey)))
      throw error
    }
    const retained = this.mediaAssets.filter((entry) => entry.userId !== userId || !replacedIds.has(entry.value.id))
    this.mediaAssets.splice(0, this.mediaAssets.length, ...retained, ...restored)
    return {
      commit: async () => { await Promise.allSettled(oldStorageKeys.map((storageKey) => storage.remove(storageKey))) },
      rollback: async () => {
        await Promise.allSettled(createdStorageKeys.map((storageKey) => storage.remove(storageKey)))
        const otherOwners = this.mediaAssets.filter((entry) => entry.userId !== userId)
        this.mediaAssets.splice(0, this.mediaAssets.length, ...otherOwners, ...previous)
      },
    }
  }

  async createUser(input: { account: string; displayName: string; passwordHash: string }) {
    const account = clean(input.account, '账号').toLowerCase()
    if (this.users.some((user) => user.account === account)) throw new Error('账号已经存在')
    const user: User = { id: this.createId(), account, displayName: clean(input.displayName, '显示名称'), passwordHash: input.passwordHash, createdAt: this.now() }
    this.users.push(user)
    return user
  }

  async findUserByAccount(account: string) { return this.users.find((user) => user.account === account.trim().toLowerCase()) }
  async findUserById(id: string) { return this.users.find((user) => user.id === id) }

  async createSession(input: { userId: string; tokenHash: string; csrfToken: string; expiresAt: string }) {
    const session: Session = { id: this.createId(), ...input, createdAt: this.now() }
    this.sessions.push(session)
    return session
  }

  async findSessionByTokenHash(tokenHash: string) { return this.sessions.find((session) => session.tokenHash === tokenHash) }
  async deleteSession(id: string) { const index = this.sessions.findIndex((session) => session.id === id); if (index >= 0) this.sessions.splice(index, 1) }
  async getUserSettings(userId: string): Promise<UserSettingsDocument> {
    return structuredClone(this.userSettings.get(userId) ?? { ...structuredClone(DEFAULT_USER_SETTINGS), version: 1, updatedAt: this.now() })
  }
  async updateUserSettings(userId: string, input: Partial<UserSettings> & { version: number }) {
    const current = await this.getUserSettings(userId)
    if (current.version !== input.version) throw Object.assign(new Error('设置已在其他会话更新，请刷新后重试'), { code: 'SETTINGS_VERSION_CONFLICT', statusCode: 409 })
    const next: UserSettingsDocument = {
      appearance: { ...current.appearance, ...input.appearance },
      locale: { ...current.locale, ...input.locale },
      defaults: { ...current.defaults, ...input.defaults },
      life: { ...current.life, ...input.life },
      publicSite: { ...current.publicSite, ...input.publicSite },
      version: current.version + 1,
      updatedAt: this.now(),
    }
    this.userSettings.set(userId, next)
    return structuredClone(next)
  }
  async updateUserPassword(userId: string, passwordHash: string) {
    const user = this.users.find((candidate) => candidate.id === userId)
    if (!user) throw new Error('找不到账户')
    user.passwordHash = passwordHash
  }
  async listUserSessions(userId: string, currentSessionId: string) {
    return this.sessions.filter((session) => session.userId === userId)
      .map((session) => ({ id: session.id, current: session.id === currentSessionId, createdAt: session.createdAt, expiresAt: session.expiresAt }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id))
  }
  async revokeUserSession(userId: string, sessionId: string) {
    const index = this.sessions.findIndex((session) => session.userId === userId && session.id === sessionId)
    if (index < 0) return false
    this.sessions.splice(index, 1)
    return true
  }
  async revokeOtherUserSessions(userId: string, currentSessionId: string) {
    for (let index = this.sessions.length - 1; index >= 0; index -= 1) {
      if (this.sessions[index]!.userId === userId && this.sessions[index]!.id !== currentSessionId) this.sessions.splice(index, 1)
    }
  }
  async appendSafeAuditEvent(userId: string, input: { action: string; targetType: string; targetId?: string | null; metadata?: Record<string, unknown> }) {
    const metadata = Object.fromEntries(Object.entries(input.metadata ?? {}).filter(([key]) => !/(?:password|token|cookie|csrf|canonicalJson|requestBody)/i.test(key)))
    const event: SafeAuditEvent = {
      id: this.createId(), actorId: userId, action: input.action, targetType: input.targetType,
      targetId: input.targetId ?? null, metadata, occurredAt: this.now(),
    }
    this.safeAuditEvents.push({ userId, value: event })
    return structuredClone(event)
  }
  async listSafeAuditEvents(userId: string, limit = 100) {
    return this.safeAuditEvents.filter((entry) => entry.userId === userId)
      .map((entry) => structuredClone(entry.value))
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id))
      .slice(0, Math.max(1, Math.min(500, Math.trunc(limit))))
  }
  async persistDataTransferRestorePoint(userId: string, snapshot: DataExportResult): Promise<DataTransferRestorePoint> {
    if (createHash('sha256').update(snapshot.canonicalJson).digest('hex') !== snapshot.checksumSha256) {
      throw new Error('DATA_TRANSFER_RESTORE_CHECKSUM_MISMATCH')
    }
    const restorePoint = {
      id: this.createId(), checksumSha256: snapshot.checksumSha256, createdAt: this.now(),
      canonicalJson: snapshot.canonicalJson, counts: structuredClone(snapshot.counts),
    }
    this.dataTransferRestorePoints.push({ userId, value: restorePoint })
    const { canonicalJson: _canonicalJson, counts: _counts, ...metadata } = restorePoint
    return structuredClone(metadata)
  }
  async readOwnedData(userId: string): Promise<DataTransferOwnedData> {
    const goals = await this.goalsStore.listGoals(userId)
    const projects = (await Promise.all(goals.map((goal) => this.goalsStore.listProjects(userId, goal.id)))).flat()
    const milestones = (await Promise.all(projects.map((project) => this.goalsStore.listMilestones(userId, project.id)))).flat()
    const lifeExport = await this.lifeCommerceStore.createLifeExport(userId, { format: 'json', includeAttachments: false }, `full-data-export:${this.createId()}`)
    const trash = [
      ...this.records.filter((entry) => entry.userId === userId && entry.value.deletedAt != null).map((entry) => ({ entityType: 'record', entityId: entry.value.id })),
      ...this.reviews.filter((entry) => entry.userId === userId && entry.value.deletedAt != null).map((entry) => ({ entityType: 'review', entityId: entry.value.id })),
      ...this.knowledge.filter((entry) => entry.userId === userId && entry.value.deletedAt != null).map((entry) => ({ entityType: 'knowledge', entityId: entry.value.id })),
    ]
    return {
      original: {
        goals: structuredClone(goals), projects: structuredClone(projects), milestones: structuredClone(milestones),
        tasks: structuredClone(await this.tasksStore.listTasks(userId)),
        scheduleBlocks: structuredClone(await this.tasksStore.listScheduleBlocks(userId)),
        habits: structuredClone(await this.habitsStore.listHabits(userId)),
        habitEntries: structuredClone(await this.habitsStore.listHabitEntries(userId)),
        records: structuredClone(this.records.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
        reviews: structuredClone(this.reviews.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
        knowledge: structuredClone(this.knowledge.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
        publications: structuredClone(this.publicDrafts.filter((entry) => entry.userId === userId).map((entry) => entry.value)),
        trash,
      },
      life: structuredClone((lifeExport.payload ?? {}) as Record<string, Array<Record<string, unknown>>>),
      settings: await this.getUserSettings(userId) as unknown as Record<string, unknown>,
    }
  }
  captureOwnerTransactionState(userId: string) {
    return {
      settings: structuredClone(this.userSettings.get(userId)),
      safeAuditEvents: structuredClone(this.safeAuditEvents.filter((entry) => entry.userId === userId)),
      records: structuredClone(this.records.filter((entry) => entry.userId === userId)),
      reviews: structuredClone(this.reviews.filter((entry) => entry.userId === userId)),
      knowledge: structuredClone(this.knowledge.filter((entry) => entry.userId === userId)),
      publicDrafts: structuredClone(this.publicDrafts.filter((entry) => entry.userId === userId)),
    }
  }
  restoreOwnerTransactionState(userId: string, state: ReturnType<MemoryLifeStore['captureOwnerTransactionState']>) {
    if (state.settings) this.userSettings.set(userId, structuredClone(state.settings))
    else this.userSettings.delete(userId)
    this.replaceOwnerRows(this.safeAuditEvents, userId, state.safeAuditEvents)
    this.replaceOwnerRows(this.records, userId, state.records)
    this.replaceOwnerRows(this.reviews, userId, state.reviews)
    this.replaceOwnerRows(this.knowledge, userId, state.knowledge)
    this.replaceOwnerRows(this.publicDrafts, userId, state.publicDrafts)
  }
  private replaceOwnerRows<T>(target: Array<Owned<T>>, userId: string, rows: Array<Owned<T>>) {
    target.splice(0, target.length, ...target.filter((entry) => entry.userId !== userId), ...structuredClone(rows))
  }
  async applyOwnedData(userId: string, data: DataTransferOwnedData) {
    this.goalsStore.replaceOwnerPortableData(userId, {
      goals: structuredClone(data.original.goals) as Goal[],
      projects: structuredClone(data.original.projects) as Project[],
      milestones: structuredClone(data.original.milestones) as Milestone[],
    })
    this.tasksStore.replaceOwnerPortableData(
      userId,
      structuredClone(data.original.tasks) as Task[],
      structuredClone(data.original.scheduleBlocks) as ScheduleBlock[],
    )
    this.habitsStore.replaceOwnerPortableData(
      userId,
      structuredClone(data.original.habits) as Habit[],
      structuredClone(data.original.habitEntries) as HabitEntry[],
    )
    this.replaceOwnerRows(this.records, userId, data.original.records.map((value) => ({ userId, value: structuredClone(value) as unknown as LifeRecord })))
    this.replaceOwnerRows(this.reviews, userId, data.original.reviews.map((value) => ({ userId, value: structuredClone(value) as unknown as Review })))
    this.replaceOwnerRows(this.knowledge, userId, data.original.knowledge.map((value) => ({ userId, value: structuredClone(value) as unknown as KnowledgeNote })))
    this.replaceOwnerRows(this.publicDrafts, userId, data.original.publications.map((value) => ({ userId, value: structuredClone(value) as unknown as PublicDraft })))
    await this.ownerTransactions.checkpoint(userId, 'data-transfer:apply', 'original-data-replaced')

    this.lifeCatalogStore.replaceOwnerPortableData(userId, data.life)
    this.lifeInventoryStore.replaceOwnerPortableData(userId, data.life)
    this.lifeRecipeStore.replaceOwnerPortableData(userId, data.life)
    this.lifePlanningStore.replaceOwnerPortableData(userId, data.life)
    this.lifeCommerceStore.replaceOwnerPortableData(userId, data.life)
    await this.ownerTransactions.checkpoint(userId, 'data-transfer:apply', 'life-data-replaced')

    const current = await this.getUserSettings(userId)
    const imported = data.settings as Partial<UserSettings>
    await this.updateUserSettings(userId, { ...imported, version: current.version })
  }
  async transaction<T>(userId: string, work: () => Promise<T>): Promise<T> {
    return this.ownerTransactions.runAtomic(userId, 'data-transfer:apply', [
      this, this.goalsStore, this.tasksStore, this.habitsStore, this.lifeCatalogStore,
      this.lifeInventoryStore, this.lifeRecipeStore, this.lifePlanningStore, this.lifeCommerceStore,
    ], work)
  }
  async getLoginFailure(key: string) { return this.loginFailures.get(key) }
  async recordLoginFailure(key: string, now: string, resetAt: string) {
    const active = this.loginFailures.get(key)
    this.loginFailures.set(key, active && Date.parse(active.resetAt) > Date.parse(now)
      ? { count: active.count + 1, resetAt: active.resetAt }
      : { count: 1, resetAt })
  }
  async clearLoginFailures(key: string) { this.loginFailures.delete(key) }

  async listGoals(...args: Parameters<GoalsStore['listGoals']>) { return this.goalsStore.listGoals(...args) }
  async getGoal(...args: Parameters<GoalsStore['getGoal']>) { return this.goalsStore.getGoal(...args) }
  async createGoal(...args: Parameters<GoalsStore['createGoal']>) { return this.goalsStore.createGoal(...args) }
  async updateGoal(...args: Parameters<GoalsStore['updateGoal']>) { return this.goalsStore.updateGoal(...args) }
  async deleteGoal(...args: Parameters<GoalsStore['deleteGoal']>) { return this.goalsStore.deleteGoal(...args) }
  async restoreGoal(...args: Parameters<GoalsStore['restoreGoal']>) { return this.goalsStore.restoreGoal(...args) }
  async listProjects(...args: Parameters<GoalsStore['listProjects']>) { return this.goalsStore.listProjects(...args) }
  async getProject(...args: Parameters<GoalsStore['getProject']>) { return this.goalsStore.getProject(...args) }
  async createProject(...args: Parameters<GoalsStore['createProject']>) { return this.goalsStore.createProject(...args) }
  async updateProject(...args: Parameters<GoalsStore['updateProject']>) { return this.goalsStore.updateProject(...args) }
  async deleteProject(...args: Parameters<GoalsStore['deleteProject']>) { return this.goalsStore.deleteProject(...args) }
  async restoreProject(...args: Parameters<GoalsStore['restoreProject']>) { return this.goalsStore.restoreProject(...args) }
  async listMilestones(...args: Parameters<GoalsStore['listMilestones']>) { return this.goalsStore.listMilestones(...args) }
  async getMilestone(...args: Parameters<GoalsStore['getMilestone']>) { return this.goalsStore.getMilestone(...args) }
  async createMilestone(...args: Parameters<GoalsStore['createMilestone']>) { return this.goalsStore.createMilestone(...args) }
  async updateMilestone(...args: Parameters<GoalsStore['updateMilestone']>) { return this.goalsStore.updateMilestone(...args) }
  async deleteMilestone(...args: Parameters<GoalsStore['deleteMilestone']>) { return this.goalsStore.deleteMilestone(...args) }
  async restoreMilestone(...args: Parameters<GoalsStore['restoreMilestone']>) { return this.goalsStore.restoreMilestone(...args) }
  async listGoalRecoveryAuditEvents(...args: Parameters<GoalsStore['listGoalRecoveryAuditEvents']>) { return this.goalsStore.listGoalRecoveryAuditEvents(...args) }

  async listTasks(...args: Parameters<TasksStore['listTasks']>) { return this.tasksStore.listTasks(...args) }
  async getTask(...args: Parameters<TasksStore['getTask']>) { return this.tasksStore.getTask(...args) }
  async createTask(...args: Parameters<TasksStore['createTask']>) { return this.tasksStore.createTask(...args) }
  async updateTask(...args: Parameters<TasksStore['updateTask']>) { return this.tasksStore.updateTask(...args) }
  async deleteTask(...args: Parameters<TasksStore['deleteTask']>) { return this.tasksStore.deleteTask(...args) }
  async setTaskCompletion(...args: Parameters<TasksStore['setTaskCompletion']>) { return this.tasksStore.setTaskCompletion(...args) }
  async addChecklistItem(...args: Parameters<TasksStore['addChecklistItem']>) { return this.tasksStore.addChecklistItem(...args) }
  async updateChecklistItem(...args: Parameters<TasksStore['updateChecklistItem']>) { return this.tasksStore.updateChecklistItem(...args) }
  async deleteChecklistItem(...args: Parameters<TasksStore['deleteChecklistItem']>) { return this.tasksStore.deleteChecklistItem(...args) }
  async listScheduleBlocks(...args: Parameters<TasksStore['listScheduleBlocks']>) { return this.tasksStore.listScheduleBlocks(...args) }
  async createScheduleBlock(...args: Parameters<TasksStore['createScheduleBlock']>) { return this.tasksStore.createScheduleBlock(...args) }
  async updateScheduleBlock(...args: Parameters<TasksStore['updateScheduleBlock']>) { return this.tasksStore.updateScheduleBlock(...args) }
  async deleteScheduleBlock(...args: Parameters<TasksStore['deleteScheduleBlock']>) { return this.tasksStore.deleteScheduleBlock(...args) }

  async listHabits(...args: Parameters<HabitsStore['listHabits']>) { return this.habitsStore.listHabits(...args) }
  async getHabit(...args: Parameters<HabitsStore['getHabit']>) { return this.habitsStore.getHabit(...args) }
  async createHabit(...args: Parameters<HabitsStore['createHabit']>) { return this.habitsStore.createHabit(...args) }
  async updateHabit(...args: Parameters<HabitsStore['updateHabit']>) { return this.habitsStore.updateHabit(...args) }
  async listHabitEntries(...args: Parameters<HabitsStore['listHabitEntries']>) { return this.habitsStore.listHabitEntries(...args) }
  async upsertHabitEntry(...args: Parameters<HabitsStore['upsertHabitEntry']>) { return this.habitsStore.upsertHabitEntry(...args) }

  async listCatalogItems(...args: Parameters<LifeCatalogStore['listCatalogItems']>) { return this.lifeCatalogStore.listCatalogItems(...args) }
  async getCatalogItem(...args: Parameters<LifeCatalogStore['getCatalogItem']>) { return this.lifeCatalogStore.getCatalogItem(...args) }
  async createCatalogItem(...args: Parameters<LifeCatalogStore['createCatalogItem']>) { return this.ownerTransactions.runExclusive(args[0], 'catalog:create-item', () => this.lifeCatalogStore.createCatalogItem(...args)) }
  async updateCatalogItem(...args: Parameters<LifeCatalogStore['updateCatalogItem']>) { return this.ownerTransactions.runExclusive(args[0], 'catalog:update-item', () => this.lifeCatalogStore.updateCatalogItem(...args)) }
  async batchUpdateCatalogItems(...args: Parameters<LifeCatalogStore['batchUpdateCatalogItems']>) { return this.ownerTransactions.runExclusive(args[0], 'catalog:batch-update-items', () => this.lifeCatalogStore.batchUpdateCatalogItems(...args)) }
  async previewCatalogItemDelete(...args: Parameters<LifeCatalogStore['previewCatalogItemDelete']>) { return this.lifeCatalogStore.previewCatalogItemDelete(...args) }
  async deleteCatalogItem(...args: Parameters<LifeCatalogStore['deleteCatalogItem']>) { return this.ownerTransactions.runExclusive(args[0], 'catalog:delete-item', () => this.lifeCatalogStore.deleteCatalogItem(...args)) }
  async listDeletedCatalogItems(...args: Parameters<LifeCatalogStore['listDeletedCatalogItems']>) { return this.lifeCatalogStore.listDeletedCatalogItems(...args) }
  async restoreCatalogItem(...args: Parameters<LifeCatalogStore['restoreCatalogItem']>) { return this.ownerTransactions.runExclusive(args[0], 'catalog:restore-item', () => this.lifeCatalogStore.restoreCatalogItem(...args)) }
  async listTaxonomy(...args: Parameters<LifeCatalogStore['listTaxonomy']>) { return this.lifeCatalogStore.listTaxonomy(...args) }
  async createTaxonomy(...args: Parameters<LifeCatalogStore['createTaxonomy']>) { return this.ownerTransactions.runExclusive(args[0], 'catalog:create-taxonomy', () => this.lifeCatalogStore.createTaxonomy(...args)) }
  async updateTaxonomy(...args: Parameters<LifeCatalogStore['updateTaxonomy']>) { return this.ownerTransactions.runExclusive(args[0], 'catalog:update-taxonomy', () => this.lifeCatalogStore.updateTaxonomy(...args)) }
  async deleteTaxonomy(...args: Parameters<LifeCatalogStore['deleteTaxonomy']>) { return this.ownerTransactions.runExclusive(args[0], 'catalog:delete-taxonomy', () => this.lifeCatalogStore.deleteTaxonomy(...args)) }
  async restoreTaxonomy(...args: Parameters<LifeCatalogStore['restoreTaxonomy']>) { return this.ownerTransactions.runExclusive(args[0], 'catalog:restore-taxonomy', () => this.lifeCatalogStore.restoreTaxonomy(...args)) }
  async listUnits(...args: Parameters<LifeCatalogStore['listUnits']>) { return this.lifeCatalogStore.listUnits(...args) }
  async createUnit(...args: Parameters<LifeCatalogStore['createUnit']>) { return this.ownerTransactions.runExclusive(args[0], 'catalog:create-unit', () => this.lifeCatalogStore.createUnit(...args)) }
  async updateUnit(...args: Parameters<LifeCatalogStore['updateUnit']>) { return this.ownerTransactions.runExclusive(args[0], 'catalog:update-unit', () => this.lifeCatalogStore.updateUnit(...args)) }
  async deleteUnit(...args: Parameters<LifeCatalogStore['deleteUnit']>) { return this.ownerTransactions.runExclusive(args[0], 'catalog:delete-unit', () => this.lifeCatalogStore.deleteUnit(...args)) }
  async restoreUnit(...args: Parameters<LifeCatalogStore['restoreUnit']>) { return this.ownerTransactions.runExclusive(args[0], 'catalog:restore-unit', () => this.lifeCatalogStore.restoreUnit(...args)) }

  async listInventoryBalances(...args: Parameters<LifeInventoryStore['listInventoryBalances']>) { return this.ownerTransactions.runExclusive(args[0], 'inventory:list-balances', () => this.lifeInventoryStore.listInventoryBalances(...args)) }
  async listUsableInventoryBalances(...args: Parameters<LifeInventoryStore['listUsableInventoryBalances']>) { return this.ownerTransactions.runExclusive(args[0], 'inventory:list-usable-balances', () => this.lifeInventoryStore.listUsableInventoryBalances(...args)) }
  async listInventoryTransactions(...args: Parameters<LifeInventoryStore['listInventoryTransactions']>) { return this.ownerTransactions.runExclusive(args[0], 'inventory:list-transactions', () => this.lifeInventoryStore.listInventoryTransactions(...args)) }
  async createInventoryTransaction(...args: Parameters<LifeInventoryStore['createInventoryTransaction']>) { return this.ownerTransactions.runExclusive(args[0], 'inventory:create-transaction', () => this.lifeInventoryStore.createInventoryTransaction(...args)) }
  async reverseInventoryTransaction(...args: Parameters<LifeInventoryStore['reverseInventoryTransaction']>) { return this.ownerTransactions.runExclusive(args[0], 'inventory:reverse-transaction', () => this.lifeInventoryStore.reverseInventoryTransaction(...args)) }
  async listInventoryForecasts(...args: Parameters<LifeInventoryStore['listInventoryForecasts']>) { return this.ownerTransactions.runExclusive(args[0], 'inventory:list-forecasts', () => this.lifeInventoryStore.listInventoryForecasts(...args)) }

  async listRecipes(...args: Parameters<LifeRecipeStore['listRecipes']>) { return this.lifeRecipeStore.listRecipes(...args) }
  async listDeletedRecipes(...args: Parameters<LifeRecipeStore['listDeletedRecipes']>) { return this.lifeRecipeStore.listDeletedRecipes(...args) }
  async getRecipe(...args: Parameters<LifeRecipeStore['getRecipe']>) { return this.lifeRecipeStore.getRecipe(...args) }
  async createRecipe(...args: Parameters<LifeRecipeStore['createRecipe']>) { return this.ownerTransactions.runExclusive(args[0], 'recipes:create', () => this.lifeRecipeStore.createRecipe(...args)) }
  async previewRecipeImpact(...args: Parameters<LifeRecipeStore['previewRecipeImpact']>) { return this.ownerTransactions.runExclusive(args[0], 'recipes:preview-impact', () => this.lifeRecipeStore.previewRecipeImpact(...args)) }
  async updateRecipe(...args: Parameters<LifeRecipeStore['updateRecipe']>) { return this.ownerTransactions.runExclusive(args[0], 'recipes:update', () => this.lifeRecipeStore.updateRecipe(...args)) }
  async deleteRecipe(...args: Parameters<LifeRecipeStore['deleteRecipe']>) { return this.ownerTransactions.runExclusive(args[0], 'recipes:delete', () => this.lifeRecipeStore.deleteRecipe(...args)) }
  async restoreRecipe(...args: Parameters<LifeRecipeStore['restoreRecipe']>) { return this.ownerTransactions.runExclusive(args[0], 'recipes:restore', () => this.lifeRecipeStore.restoreRecipe(...args)) }
  async listRecipeVersions(...args: Parameters<LifeRecipeStore['listRecipeVersions']>) { return this.lifeRecipeStore.listRecipeVersions(...args) }
  async calculateStoredRecipe(...args: Parameters<LifeRecipeStore['calculateStoredRecipe']>) { return this.ownerTransactions.runExclusive(args[0], 'recipes:calculate-stored', () => this.lifeRecipeStore.calculateStoredRecipe(...args)) }
  async listRecipeRelations(...args: Parameters<LifeRecipeStore['listRecipeRelations']>) { return this.lifeRecipeStore.listRecipeRelations(...args) }
  async createCookingSession(...args: Parameters<LifeRecipeStore['createCookingSession']>) { return this.ownerTransactions.runExclusive(args[0], 'recipes:create-cooking-session', () => this.lifeRecipeStore.createCookingSession(...args)) }
  async getCookingSession(...args: Parameters<LifeRecipeStore['getCookingSession']>) { return this.lifeRecipeStore.getCookingSession(...args) }
  async updateCookingSession(...args: Parameters<LifeRecipeStore['updateCookingSession']>) { return this.ownerTransactions.runExclusive(args[0], 'recipes:update-cooking-session', () => this.lifeRecipeStore.updateCookingSession(...args)) }
  async promoteCookingNote(...args: Parameters<LifeRecipeStore['promoteCookingNote']>) { return this.ownerTransactions.runExclusive(args[0], 'recipes:promote-cooking-note', () => this.lifeRecipeStore.promoteCookingNote(...args)) }
  async completeCookingSession(...args: Parameters<LifeRecipeStore['completeCookingSession']>) { return this.ownerTransactions.runExclusive(args[0], 'recipes:complete-cooking-session', () => this.lifeRecipeStore.completeCookingSession(...args)) }
  async listPreparedFood(...args: Parameters<LifeRecipeStore['listPreparedFood']>) { return this.lifeRecipeStore.listPreparedFood(...args) }

  async getPlanningCatalogReferences(...args: Parameters<LifePlanningStore['getPlanningCatalogReferences']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:get-catalog-references', () => this.lifePlanningStore.getPlanningCatalogReferences(...args)) }
  async listPlanTemplates(...args: Parameters<LifePlanningStore['listPlanTemplates']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:list-templates', () => this.lifePlanningStore.listPlanTemplates(...args)) }
  async getPlanTemplate(...args: Parameters<LifePlanningStore['getPlanTemplate']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:get-template', () => this.lifePlanningStore.getPlanTemplate(...args)) }
  async createPlanTemplate(...args: Parameters<LifePlanningStore['createPlanTemplate']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:create-template', () => this.lifePlanningStore.createPlanTemplate(...args)) }
  async updatePlanTemplate(...args: Parameters<LifePlanningStore['updatePlanTemplate']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:update-template', () => this.lifePlanningStore.updatePlanTemplate(...args)) }
  async getDayPlan(...args: Parameters<LifePlanningStore['getDayPlan']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:get-day', () => this.lifePlanningStore.getDayPlan(...args)) }
  async getDayPlanProjection(...args: Parameters<LifePlanningStore['getDayPlanProjection']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:get-day-projection', () => this.lifePlanningStore.getDayPlanProjection(...args)) }
  async listDayPlanProjections(...args: Parameters<LifePlanningStore['listDayPlanProjections']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:list-day-projections', () => this.lifePlanningStore.listDayPlanProjections(...args)) }
  async createDayPlan(...args: Parameters<LifePlanningStore['createDayPlan']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:create-day', () => this.lifePlanningStore.createDayPlan(...args)) }
  async updateDayPlan(...args: Parameters<LifePlanningStore['updateDayPlan']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:update-day', () => this.lifePlanningStore.updateDayPlan(...args)) }
  async previewTemplateApplication(...args: Parameters<LifePlanningStore['previewTemplateApplication']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:preview-template-application', () => this.lifePlanningStore.previewTemplateApplication(...args)) }
  async applyTemplateToDayPlan(...args: Parameters<LifePlanningStore['applyTemplateToDayPlan']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:apply-template', () => this.lifePlanningStore.applyTemplateToDayPlan(...args)) }
  async copyDayPlan(...args: Parameters<LifePlanningStore['copyDayPlan']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:copy-day', () => this.lifePlanningStore.copyDayPlan(...args)) }
  async previewTemplateSync(...args: Parameters<LifePlanningStore['previewTemplateSync']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:preview-template-sync', () => this.lifePlanningStore.previewTemplateSync(...args)) }
  async syncPlanTemplate(...args: Parameters<LifePlanningStore['syncPlanTemplate']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:sync-template', () => this.lifePlanningStore.syncPlanTemplate(...args)) }
  async previewMedicineRecurrence(...args: Parameters<LifePlanningStore['previewMedicineRecurrence']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:preview-medicine-recurrence', () => this.lifePlanningStore.previewMedicineRecurrence(...args)) }
  async listMedicineRecurrenceRules(...args: Parameters<LifePlanningStore['listMedicineRecurrenceRules']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:list-medicine-recurrences', () => this.lifePlanningStore.listMedicineRecurrenceRules(...args)) }
  async createMedicineRecurrenceRule(...args: Parameters<LifePlanningStore['createMedicineRecurrenceRule']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:create-medicine-recurrence', () => this.lifePlanningStore.createMedicineRecurrenceRule(...args)) }
  async updateMedicineRecurrenceRule(...args: Parameters<LifePlanningStore['updateMedicineRecurrenceRule']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:update-medicine-recurrence', () => this.lifePlanningStore.updateMedicineRecurrenceRule(...args)) }
  async deleteMedicineRecurrenceRule(...args: Parameters<LifePlanningStore['deleteMedicineRecurrenceRule']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:delete-medicine-recurrence', () => this.lifePlanningStore.deleteMedicineRecurrenceRule(...args)) }
  async transitionMedicineOccurrence(...args: Parameters<LifePlanningStore['transitionMedicineOccurrence']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:transition-medicine-occurrence', () => this.lifePlanningStore.transitionMedicineOccurrence(...args)) }
  async listCalendar(...args: Parameters<LifePlanningStore['listCalendar']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:list-calendar', () => this.lifePlanningStore.listCalendar(...args)) }
  async getPlanningTimeline(...args: Parameters<LifePlanningStore['getPlanningTimeline']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:get-timeline', () => this.lifePlanningStore.getPlanningTimeline(...args)) }
  async listFitnessActivities(...args: Parameters<LifePlanningStore['listFitnessActivities']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:list-fitness', () => this.lifePlanningStore.listFitnessActivities(...args)) }
  async createFitnessActivity(...args: Parameters<LifePlanningStore['createFitnessActivity']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:create-fitness', () => this.lifePlanningStore.createFitnessActivity(...args)) }
  async transitionDayPlanItem(...args: Parameters<LifePlanningStore['transitionDayPlanItem']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:transition-day-item', () => this.lifePlanningStore.transitionDayPlanItem(...args)) }
  async createPlanningCompletion(...args: Parameters<LifePlanningStore['createPlanningCompletion']>) { return this.ownerTransactions.runExclusive(args[0], 'planning:complete-day-item', () => this.lifePlanningStore.createPlanningCompletion(...args)) }
  async createPlanningCompletionFromSource(...args: Parameters<LifePlanningStore['createPlanningCompletionFromSource']>) {
    if (args[1].source.type !== 'medicine-occurrence') return this.ownerTransactions.runExclusive(args[0], 'planning:complete-day-item', () => this.lifePlanningStore.createPlanningCompletionFromSource(...args))
    return this.ownerTransactions.runAtomic(
      args[0],
      'planning:complete-medicine-occurrence',
      [this.lifePlanningStore, this.lifeInventoryStore],
      () => this.lifePlanningStore.createPlanningCompletionFromSource(...args),
    )
  }
  async undoPlanningCompletion(...args: Parameters<LifePlanningStore['undoPlanningCompletion']>) {
    if (!this.lifePlanningStore.isMedicineOccurrenceCompletion(args[0], args[1])) {
      return this.ownerTransactions.runExclusive(args[0], 'planning:undo-day-item', () => this.lifePlanningStore.undoPlanningCompletion(...args))
    }
    return this.ownerTransactions.runAtomic(
      args[0],
      'planning:undo-medicine-occurrence',
      [this.lifePlanningStore, this.lifeInventoryStore],
      () => this.lifePlanningStore.undoPlanningCompletion(...args),
    )
  }

  async listInventoryPolicies(...args: Parameters<LifeCommerceStore['listInventoryPolicies']>) {
    return this.ownerTransactions.runExclusive(args[0], 'commerce:list-inventory-policies', () => this.lifeCommerceStore.listInventoryPolicies(...args))
  }
  async upsertInventoryPolicy(...args: Parameters<LifeCommerceStore['upsertInventoryPolicy']>) {
    return this.ownerTransactions.runExclusive(args[0], 'commerce:upsert-inventory-policy', () => this.lifeCommerceStore.upsertInventoryPolicy(...args))
  }
  async recalculateShopping(...args: Parameters<LifeCommerceStore['recalculateShopping']>) {
    return this.ownerTransactions.runAtomic(args[0], 'commerce:recalculate-shopping', [this.lifeCommerceStore], async () => {
      const result = await this.lifeCommerceStore.recalculateShopping(...args)
      await this.ownerTransactions.checkpoint(args[0], 'commerce:recalculate-shopping', 'derived-effect-applied')
      return result
    })
  }
  async createShoppingSuggestion(...args: Parameters<LifeCommerceStore['createShoppingSuggestion']>) {
    return this.ownerTransactions.runExclusive(args[0], 'commerce:create-shopping-suggestion', () => this.lifeCommerceStore.createShoppingSuggestion(...args))
  }
  async listShopping(...args: Parameters<LifeCommerceStore['listShopping']>) {
    return this.ownerTransactions.runExclusive(args[0], 'commerce:list-shopping', () => this.lifeCommerceStore.listShopping(...args))
  }
  async createShoppingItem(...args: Parameters<LifeCommerceStore['createShoppingItem']>) {
    return this.ownerTransactions.runExclusive(args[0], 'commerce:create-shopping-item', () => this.lifeCommerceStore.createShoppingItem(...args))
  }
  async createPurchase(...args: Parameters<LifeCommerceStore['createPurchase']>) {
    return this.ownerTransactions.runAtomic(args[0], 'commerce:create-purchase', [this.lifeCommerceStore, this.lifeCatalogStore, this.lifeInventoryStore], () => this.lifeCommerceStore.createPurchase(...args))
  }
  async createRefund(...args: Parameters<LifeCommerceStore['createRefund']>) {
    return this.ownerTransactions.runAtomic(args[0], 'commerce:create-refund', [this.lifeCommerceStore, this.lifeInventoryStore], () => this.lifeCommerceStore.createRefund(...args))
  }
  async createBudget(...args: Parameters<LifeCommerceStore['createBudget']>) {
    return this.ownerTransactions.runExclusive(args[0], 'commerce:create-budget', () => this.lifeCommerceStore.createBudget(...args))
  }
  async listBudgetSummaries(...args: Parameters<LifeCommerceStore['listBudgetSummaries']>) {
    return this.ownerTransactions.runExclusive(args[0], 'commerce:list-budget-summaries', () => this.lifeCommerceStore.listBudgetSummaries(...args))
  }
  async getLifeAnalytics(...args: Parameters<LifeCommerceStore['getLifeAnalytics']>) {
    return this.ownerTransactions.runExclusive(args[0], 'commerce:get-analytics', () => this.lifeCommerceStore.getLifeAnalytics(...args))
  }
  async createLifeExport(...args: Parameters<LifeCommerceStore['createLifeExport']>) {
    return this.ownerTransactions.runExclusive(args[0], 'commerce:create-export', () => this.lifeCommerceStore.createLifeExport(...args))
  }
  async listLifeExports(...args: Parameters<LifeCommerceStore['listLifeExports']>) {
    return this.ownerTransactions.runExclusive(args[0], 'commerce:list-exports', () => this.lifeCommerceStore.listLifeExports(...args))
  }
  async previewLifeImport(...args: Parameters<LifeCommerceStore['previewLifeImport']>) {
    return this.ownerTransactions.runExclusive(args[0], 'commerce:preview-import', () => this.lifeCommerceStore.previewLifeImport(...args))
  }
  async applyLifeImport(...args: Parameters<LifeCommerceStore['applyLifeImport']>) {
    return this.ownerTransactions.runPreparedAtomic(args[0], 'commerce:apply-import', [
      this.lifeCommerceStore, this.lifeCatalogStore, this.lifeInventoryStore, this.lifeRecipeStore, this.lifePlanningStore,
    ],
    async () => { await this.lifeCommerceStore.ensureImportRestorePoint(args[0], args[1], args[2]) },
    () => this.lifeCommerceStore.applyLifeImport(...args))
  }

  async listRecords(userId: string, filters: RecordFilters = {}) {
    const query = filters.q?.trim().toLocaleLowerCase()
    return this.records
      .filter((item) => item.userId === userId && item.value.deletedAt == null)
      .filter((item) => filters.includeArchived || item.value.archivedAt == null)
      .filter((item) => !filters.from || item.value.occurredAt.slice(0, 10) >= filters.from)
      .filter((item) => !filters.to || item.value.occurredAt.slice(0, 10) <= filters.to)
      .filter((item) => !filters.tag || item.value.tags.includes(filters.tag))
      .filter((item) => !filters.linkType || !filters.linkId || item.value.links.some((link) => link.type === filters.linkType && link.id === filters.linkId))
      .filter((item) => !query || `${item.value.title}\n${item.value.body}`.toLocaleLowerCase().includes(query))
      .map((item) => structuredClone(item.value))
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id))
  }

  async getRecord(userId: string, id: string) {
    const value = this.records.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt == null)?.value
    return value ? structuredClone(value) : undefined
  }

  async updateRecord(userId: string, id: string, input: UpdateRecordInput) {
    const owned = this.records.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt == null)
    if (!owned) return undefined
    const next = updateRecordEntity(owned.value, this.now(), input)
    if (input.links !== undefined) await this.validateRecordLinks(userId, next.links)
    if (input.mediaIds !== undefined) this.validateRecordMedia(userId, next.mediaIds)
    owned.value = next
    return structuredClone(next)
  }

  async deleteRecord(userId: string, id: string, version: number) {
    const owned = this.records.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt == null)
    if (!owned) return false
    assertRecordVersion(owned.value.version, version)
    const now = this.now()
    owned.value = { ...owned.value, version: version + 1, updatedAt: now, deletedAt: now }
    return true
  }

  async restoreRecord(userId: string, id: string, version: number) {
    const owned = this.records.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt != null)
    if (!owned) return undefined
    assertRecordVersion(owned.value.version, version)
    const now = this.now()
    owned.value = { ...owned.value, version: version + 1, updatedAt: now, deletedAt: null }
    return structuredClone(owned.value)
  }

  async createMediaAsset(userId: string, input: CreateMediaAssetInput, idempotencyKey: string) {
    const result = await this.createRecordIdempotently(userId, 'media:create', idempotencyKey, { ...input, storageKey: undefined }, async () => {
      const asset = createMediaAssetEntity(this.createId(), this.now(), input)
      this.mediaAssets.push({ userId, value: asset })
      return asset
    })
    return structuredClone(result)
  }

  async getMediaAsset(userId: string, id: string) {
    const asset = this.mediaAssets.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt == null)?.value
    return asset ? structuredClone(asset) : undefined
  }

  async getPublicMediaAsset(_id: string) { return undefined }

  async getState(userId: string): Promise<LifeState> {
    const own = <T>(items: Array<Owned<T>>) => items.filter((item) => item.userId === userId).map((item) => structuredClone(item.value))
    const reviews = this.reviews.filter((item) => item.userId === userId && item.value.deletedAt == null).map((item) => this.toLegacyReview(item.value))
    return { schemaVersion: 1, plans: own(this.plans), records: own(this.records.filter((item) => item.value.deletedAt == null)), reviews, knowledge: own(this.knowledge), snapshots: own(this.snapshots) }
  }

  async createPlan(userId: string, input: { title: string; scheduledFor?: string }) {
    const timestamp = this.now()
    const plan: PlanItem = { id: this.createId(), title: clean(input.title, '计划'), scheduledFor: input.scheduledFor || undefined, status: 'planned', createdAt: timestamp, updatedAt: timestamp }
    this.plans.push({ userId, value: plan })
    return plan
  }

  async completePlan(userId: string, id: string) {
    const owned = this.plans.find((item) => item.userId === userId && item.value.id === id)
    if (!owned) return undefined
    const timestamp = this.now()
    owned.value = { ...owned.value, status: 'done', completedAt: timestamp, updatedAt: timestamp }
    return owned.value
  }

  async createRecord(userId: string, input: CreateRecordInput, idempotencyKey?: string) {
    if (input.planId && !this.plans.some((item) => item.userId === userId && item.value.id === input.planId)) throw new Error('找不到来源计划')
    await this.validateRecordLinks(userId, input.links ?? [])
    this.validateRecordMedia(userId, input.mediaIds ?? [])
    const create = async () => {
      const record = createRecordEntity(this.createId(), this.now(), input)
      this.records.push({ userId, value: record })
      return record
    }
    if (!idempotencyKey) return structuredClone(await create())
    return structuredClone(await this.createRecordIdempotently(userId, 'records:create', idempotencyKey, input, create))
  }

  async listReviews(userId: string, filters: ReviewFilters = {}) {
    return this.reviews
      .filter((item) => item.userId === userId && item.value.deletedAt == null)
      .filter((item) => filters.includeArchived || item.value.status !== 'archived')
      .map((item) => structuredClone(item.value))
      .sort((left, right) => right.period.to.localeCompare(left.period.to) || left.id.localeCompare(right.id))
  }

  async getReview(userId: string, id: string) {
    const review = this.reviews.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt == null)?.value
    return review ? structuredClone(review) : undefined
  }

  async createReview(userId: string, input: CreateReviewInput, idempotencyKey: string) {
    const evidence = await this.reviewEvidenceState(userId, input.period)
    return structuredClone(await this.createReviewIdempotently(userId, idempotencyKey, input, async () => {
      const review = createReviewEntity(this.createId(), this.now(), input, evidence, this.createId)
      this.reviews.push({ userId, value: review })
      return review
    }))
  }

  async updateReview(userId: string, id: string, input: UpdateReviewInput) {
    const owned = this.reviews.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt == null)
    if (!owned) return undefined
    const next = updateReviewEntity(owned.value, this.now(), input, this.createId)
    owned.value = input.period
      ? { ...next, evidence: await this.reviewEvidenceState(userId, next.period, id) }
      : next
    return structuredClone(owned.value)
  }

  async deleteReview(userId: string, id: string, version: number) {
    const owned = this.reviews.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt == null)
    if (!owned) return false
    assertReviewVersion(owned.value.version, version)
    const now = this.now()
    owned.value = { ...owned.value, version: version + 1, updatedAt: now, deletedAt: now }
    return true
  }

  async restoreReview(userId: string, id: string, version: number) {
    const owned = this.reviews.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt != null)
    if (!owned) return undefined
    assertReviewVersion(owned.value.version, version)
    const now = this.now()
    owned.value = { ...owned.value, version: version + 1, updatedAt: now, deletedAt: null }
    return structuredClone(owned.value)
  }

  async refreshReviewEvidence(userId: string, id: string, version: number) {
    const owned = this.reviews.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt == null)
    if (!owned) return undefined
    assertReviewVersion(owned.value.version, version)
    const evidence = await this.reviewEvidenceState(userId, owned.value.period, id)
    const now = this.now()
    owned.value = { ...owned.value, evidence, version: version + 1, updatedAt: now }
    return structuredClone(owned.value)
  }

  async convertReviewAction(userId: string, reviewId: string, actionId: string, input: ConvertReviewActionInput, idempotencyKey: string) {
    const value = await this.createReviewConversionIdempotently(userId, reviewId, actionId, idempotencyKey, input, async () => {
      const key = `${userId}\u0000${reviewId}\u0000${actionId}`
      const concurrent = this.reviewActionConversions.get(key)
      if (concurrent) return concurrent
      const operation = this.convertReviewActionOnce(userId, reviewId, actionId, input)
      this.reviewActionConversions.set(key, operation)
      try { return await operation } finally { this.reviewActionConversions.delete(key) }
    })
    return structuredClone(value)
  }

  async createKnowledge(userId: string, input: { sourceType: 'record' | 'review'; sourceId: string; title: string; body: string; tags?: string[] }) {
    return this.createKnowledgeNote(userId, {
      title: input.title,
      body: input.body,
      tags: input.tags,
      sourceLinks: [{ type: input.sourceType, id: input.sourceId }],
    })
  }

  async listKnowledge(userId: string, filters: KnowledgeFilters = {}) {
    const query = filters.q?.trim().toLocaleLowerCase('zh-CN') ?? ''
    const items = this.knowledge
      .filter((item) => item.userId === userId)
      .map((item) => item.value)
      .filter((note) => filters.includeDeleted || note.deletedAt == null)
      .filter((note) => filters.includeArchived || note.archivedAt == null)
      .filter((note) => !filters.tag || note.tags.includes(filters.tag))
      .filter((note) => !filters.source || note.sourceLinks.some((link) => link.type === filters.source))
      .filter((note) => !filters.collectionId || note.collectionIds.includes(filters.collectionId))
      .filter((note) => !query || `${note.title} ${note.body} ${note.tags.join(' ')}`.toLocaleLowerCase('zh-CN').includes(query))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .map((note) => structuredClone(note))
    return { items }
  }

  async getKnowledgeNote(userId: string, id: string, includeDeleted = false) {
    const note = this.knowledge.find((item) => item.userId === userId && item.value.id === id && (includeDeleted || item.value.deletedAt == null))?.value
    return note ? structuredClone(note) : undefined
  }

  async createKnowledgeNote(userId: string, input: CreateKnowledgeInput) {
    await this.validateKnowledgeInput(userId, input)
    const note = createKnowledgeNoteEntity(this.createId(), this.now(), input)
    this.knowledge.push({ userId, value: note })
    return structuredClone(note)
  }

  async updateKnowledgeNote(userId: string, id: string, input: UpdateKnowledgeInput) {
    const owned = this.knowledge.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt == null)
    if (!owned) return undefined
    await this.validateKnowledgeInput(userId, input, id)
    owned.value = updateKnowledgeNoteEntity(owned.value, this.now(), input)
    return structuredClone(owned.value)
  }

  async archiveKnowledgeNote(userId: string, id: string, version: number) {
    const owned = this.knowledge.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt == null)
    if (!owned) return undefined
    assertKnowledgeVersion(owned.value.version, version)
    const now = this.now()
    owned.value = { ...owned.value, archivedAt: owned.value.archivedAt ? null : now, version: version + 1, updatedAt: now }
    return structuredClone(owned.value)
  }

  async deleteKnowledgeNote(userId: string, id: string, version: number) {
    const owned = this.knowledge.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt == null)
    if (!owned) return false
    assertKnowledgeVersion(owned.value.version, version)
    const now = this.now()
    owned.value = { ...owned.value, deletedAt: now, version: version + 1, updatedAt: now }
    return true
  }

  async restoreKnowledgeNote(userId: string, id: string, version: number) {
    const owned = this.knowledge.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt != null)
    if (!owned) return undefined
    assertKnowledgeVersion(owned.value.version, version)
    const now = this.now()
    owned.value = { ...owned.value, archivedAt: null, deletedAt: null, version: version + 1, updatedAt: now }
    return structuredClone(owned.value)
  }

  async addKnowledgeRelation(userId: string, id: string, relatedId: string, version: number) {
    return this.changeKnowledgeRelation(userId, id, relatedId, version, true)
  }

  async removeKnowledgeRelation(userId: string, id: string, relatedId: string, version: number) {
    return this.changeKnowledgeRelation(userId, id, relatedId, version, false)
  }

  async listKnowledgeCollections(userId: string) {
    return this.knowledgeCollections.filter((item) => item.userId === userId)
      .map((item) => structuredClone(item.value))
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
  }

  async createKnowledgeCollection(userId: string, input: { name: string; color: string; position?: number }) {
    const collection = createKnowledgeCollectionEntity(this.createId(), input)
    this.knowledgeCollections.push({ userId, value: collection })
    return structuredClone(collection)
  }

  async updateKnowledgeCollection(userId: string, id: string, input: { name?: string; color?: string; position?: number; version: number }) {
    const owned = this.knowledgeCollections.find((item) => item.userId === userId && item.value.id === id)
    if (!owned) return undefined
    owned.value = updateKnowledgeCollectionEntity(owned.value, input)
    return structuredClone(owned.value)
  }

  async deleteKnowledgeCollection(userId: string, id: string, version: number) {
    const index = this.knowledgeCollections.findIndex((item) => item.userId === userId && item.value.id === id)
    if (index < 0) return false
    assertKnowledgeVersion(this.knowledgeCollections[index]!.value.version, version)
    this.knowledgeCollections.splice(index, 1)
    for (const note of this.knowledge.filter((item) => item.userId === userId)) {
      note.value = { ...note.value, collectionIds: note.value.collectionIds.filter((collectionId) => collectionId !== id) }
    }
    return true
  }

  async resurfaceKnowledge(userId: string, now: string) {
    return rankResurfacedKnowledge(this.knowledge.filter((item) => item.userId === userId).map((item) => item.value), now)
  }

  async createSnapshot(userId: string, input: { slug: string; sourceType: SourceType; sourceId: string; title: string; excerpt: string }) {
    const collections: Record<SourceType, Array<Owned<{ id: string }>>> = { plan: this.plans, record: this.records, review: this.reviews, knowledge: this.knowledge }
    if (!collections[input.sourceType].some((item) => item.userId === userId && item.value.id === input.sourceId)) throw new Error('找不到公开快照来源')
    const snapshot: PublicSnapshot = { id: this.createId(), slug: input.slug, source: { type: input.sourceType, id: input.sourceId }, title: clean(input.title, '公开标题'), excerpt: clean(input.excerpt, '公开摘录'), visibility: 'private', createdAt: this.now() }
    this.snapshots.push({ userId, value: snapshot })
    return snapshot
  }

  async publishSnapshot(userId: string, id: string) { return this.updateSnapshot(userId, id, { visibility: 'public', publishedAt: this.now(), revokedAt: undefined }) }
  async revokeSnapshot(userId: string, id: string) { return this.updateSnapshot(userId, id, { visibility: 'private', revokedAt: this.now() }) }
  async listPublicSnapshots() { return this.snapshots.filter((item) => item.value.visibility === 'public' && !item.value.revokedAt).map((item) => item.value) }
  async getPublicSnapshot(slug: string) { return this.snapshots.find((item) => item.value.slug === slug && item.value.visibility === 'public')?.value }

  async listPublicDrafts(userId: string) {
    return this.publicDrafts.filter((item) => item.userId === userId).map((item) => structuredClone(item.value))
  }

  async getPublicDraft(userId: string, id: string) {
    const found = this.publicDrafts.find((item) => item.userId === userId && item.value.id === id)
    return found ? structuredClone(found.value) : undefined
  }

  async createPublicDraft(userId: string, input: CreatePublicDraftInput) {
    assertPublicSlugAvailable(input.slug, this.publicDrafts.map((item) => item.value))
    const draft = createPublicDraftEntity(this.createId(), this.now(), input)
    this.publicDrafts.push({ userId, value: draft })
    return structuredClone(draft)
  }

  async updatePublicDraft(userId: string, id: string, input: UpdatePublicDraftInput) {
    const owned = this.publicDrafts.find((item) => item.userId === userId && item.value.id === id)
    if (!owned) return undefined
    if (input.slug !== undefined) assertPublicSlugAvailable(input.slug, this.publicDrafts.map((item) => item.value), id)
    owned.value = updatePublicDraftEntity(owned.value, this.now(), input)
    return structuredClone(owned.value)
  }

  async deletePublicDraft(userId: string, id: string, version: number) {
    const index = this.publicDrafts.findIndex((item) => item.userId === userId && item.value.id === id)
    if (index < 0) return false
    const draft = this.publicDrafts[index].value
    if (draft.version !== version) throw new PublishingDomainError('VERSION_CONFLICT', '发布草稿已更新，请刷新后重试', 409)
    if (this.publicRevisions.some((item) => item.value.draftId === id)) {
      throw new PublishingDomainError('DRAFT_HAS_REVISIONS', '已有公开 revision 的草稿只能撤回，不能删除', 409)
    }
    this.publicDrafts.splice(index, 1)
    return true
  }

  async previewPublicDraft(userId: string, id: string) {
    const owned = this.publicDrafts.find((item) => item.userId === userId && item.value.id === id)
    if (!owned) return undefined
    const revision = this.publicRevisions.filter((item) => item.value.draftId === id).length + 1
    return createPublicRevisionEntity(`preview-${id}-${owned.value.version}`, owned.value, revision, this.now())
  }

  async publishPublicDraft(userId: string, id: string, version: number, publishedAt = this.now()) {
    const owned = this.publicDrafts.find((item) => item.userId === userId && item.value.id === id)
    if (!owned) return undefined
    if (owned.value.version !== version) throw new PublishingDomainError('VERSION_CONFLICT', '发布草稿已更新，请刷新后重试', 409)
    return this.publishOwnedDraft(owned, publishedAt)
  }

  async schedulePublicDraft(userId: string, id: string, version: number, scheduledAt: string) {
    const owned = this.publicDrafts.find((item) => item.userId === userId && item.value.id === id)
    if (!owned) return undefined
    owned.value = schedulePublicDraftEntity(owned.value, this.now(), scheduledAt, version)
    return structuredClone(owned.value)
  }

  async revokePublicDraft(userId: string, id: string, version: number) {
    const owned = this.publicDrafts.find((item) => item.userId === userId && item.value.id === id)
    if (!owned) return undefined
    if (owned.value.version !== version) throw new PublishingDomainError('VERSION_CONFLICT', '发布草稿已更新，请刷新后重试', 409)
    owned.value = { ...owned.value, status: 'revoked', scheduledAt: null, version: version + 1, updatedAt: this.now() }
    return structuredClone(owned.value)
  }

  async listPublicRevisions(userId: string, draftId: string) {
    if (!this.publicDrafts.some((item) => item.userId === userId && item.value.id === draftId)) return []
    return this.publicRevisions.filter((item) => item.userId === userId && item.value.draftId === draftId)
      .map((item) => structuredClone(item.value)).sort((left, right) => right.revision - left.revision)
  }

  async diffPublicRevisionHistory(userId: string, draftId: string, from: number, to: number) {
    const revisions = await this.listPublicRevisions(userId, draftId)
    const first = revisions.find((item) => item.revision === from)
    const second = revisions.find((item) => item.revision === to)
    return first && second ? diffPublicRevisions(first, second) : undefined
  }

  async listPublishedRevisions() {
    const indexed = this.publicDrafts.filter((item) => item.value.status !== 'revoked').flatMap((draft) => {
      const revisions = this.publicRevisions.filter((item) => item.value.draftId === draft.value.id)
      const latest = revisions.sort((left, right) => right.value.revision - left.value.revision)[0]
      return latest ? [{ value: structuredClone(latest.value), publishedOrder: this.publicRevisions.indexOf(latest) }] : []
    })
    return indexed.sort((left, right) => right.value.publishedAt.localeCompare(left.value.publishedAt)
      || right.publishedOrder - left.publishedOrder).map((item) => item.value)
  }

  async getPublishedRevision(slug: string) {
    const draft = this.publicDrafts.find((item) => item.value.slug === slug && item.value.status !== 'revoked')
    if (!draft) return undefined
    const latest = this.publicRevisions.filter((item) => item.value.draftId === draft.value.id)
      .sort((left, right) => right.value.revision - left.value.revision)[0]
    return latest ? structuredClone(latest.value) : undefined
  }

  async listDuePublicDraftIds(now: string) {
    return this.publicDrafts.filter((item) => item.value.status === 'scheduled' && item.value.scheduledAt != null && item.value.scheduledAt <= now)
      .map((item) => item.value.id).sort()
  }

  async publishDuePublicDraft(id: string, now: string) {
    const owned = this.publicDrafts.find((item) => item.value.id === id)
    if (!owned || owned.value.status !== 'scheduled' || !owned.value.scheduledAt || owned.value.scheduledAt > now) return undefined
    return this.publishOwnedDraft(owned, now)
  }

  async ping() {}
  async close() {}

  private publishOwnedDraft(owned: Owned<PublicDraft>, publishedAt: string): PublicationResult {
    const sourceVersion = owned.value.version
    const existing = this.publicRevisions.find((item) => item.value.draftId === owned.value.id && item.value.sourceVersion === sourceVersion)
    if (existing) return { draftId: owned.value.id, revisionId: existing.value.id, revision: existing.value.revision }
    const prior = this.publicRevisions.filter((item) => item.value.draftId === owned.value.id)
    const revision = createPublicRevisionEntity(this.createId(), owned.value, prior.length + 1, publishedAt)
    this.publicRevisions.push({ userId: owned.userId, value: revision })
    owned.value = {
      ...owned.value,
      status: 'published',
      scheduledAt: null,
      version: owned.value.version + 1,
      updatedAt: publishedAt,
    }
    return { draftId: owned.value.id, revisionId: revision.id, revision: revision.revision }
  }

  private updateSnapshot(userId: string, id: string, patch: Partial<PublicSnapshot>) {
    const owned = this.snapshots.find((item) => item.userId === userId && item.value.id === id)
    if (!owned) return undefined
    owned.value = { ...owned.value, ...patch }
    return owned.value
  }

  private async validateKnowledgeInput(userId: string, input: Partial<CreateKnowledgeInput>, currentId?: string) {
    for (const collectionId of input.collectionIds ?? []) {
      if (!this.knowledgeCollections.some((item) => item.userId === userId && item.value.id === collectionId)) {
        throw new KnowledgeDomainError('NOT_FOUND', '找不到知识集合', 404)
      }
    }
    for (const relatedId of input.relatedIds ?? []) {
      if (relatedId === currentId || !this.knowledge.some((item) => item.userId === userId && item.value.id === relatedId && item.value.deletedAt == null)) {
        throw new KnowledgeDomainError('NOT_FOUND', '找不到关联知识', 404)
      }
    }
    for (const source of input.sourceLinks ?? []) {
      const found = source.type === 'record'
        ? this.records.some((item) => item.userId === userId && item.value.id === source.id && item.value.deletedAt == null)
        : source.type === 'review'
          ? this.reviews.some((item) => item.userId === userId && item.value.id === source.id && item.value.deletedAt == null)
          : source.type === 'goal'
            ? Boolean(await this.goalsStore.getGoal(userId, source.id))
            : Boolean(await this.goalsStore.getProject(userId, source.id))
      if (!found) throw new KnowledgeDomainError('NOT_FOUND', '找不到知识来源', 404)
    }
  }

  private async changeKnowledgeRelation(userId: string, id: string, relatedId: string, version: number, add: boolean) {
    const owned = this.knowledge.find((item) => item.userId === userId && item.value.id === id && item.value.deletedAt == null)
    if (!owned) return undefined
    const related = this.knowledge.find((item) => item.userId === userId && item.value.id === relatedId && item.value.deletedAt == null)
    if (!related || id === relatedId) throw new KnowledgeDomainError('NOT_FOUND', '找不到关联知识', 404)
    assertKnowledgeVersion(owned.value.version, version)
    const ids = new Set(owned.value.relatedIds)
    if (add) ids.add(relatedId)
    else ids.delete(relatedId)
    const now = this.now()
    owned.value = { ...owned.value, relatedIds: [...ids], version: version + 1, updatedAt: now }
    return structuredClone(owned.value)
  }

  private async validateRecordLinks(userId: string, links: LifeRecord['links']) {
    for (const link of links) {
      const found = link.type === 'goal' ? await this.goalsStore.getGoal(userId, link.id)
        : link.type === 'project' ? await this.goalsStore.getProject(userId, link.id)
          : link.type === 'task' ? await this.tasksStore.getTask(userId, link.id)
            : await this.habitsStore.getHabit(userId, link.id)
      if (!found) throw new RecordsDomainError('NOT_FOUND', '找不到记录关联对象', 404)
    }
  }

  private validateRecordMedia(userId: string, mediaIds: string[]) {
    for (const id of mediaIds) {
      if (!this.mediaAssets.some((item) => item.userId === userId && item.value.id === id && item.value.deletedAt == null)) {
        throw new RecordsDomainError('NOT_FOUND', '找不到媒体', 404)
      }
    }
  }

  private async reviewEvidenceState(userId: string, period: ReviewPeriod, currentReviewId?: string) {
    const goals = await this.goalsStore.listGoals(userId)
    const projects = (await Promise.all(goals.map((goal) => this.goalsStore.listProjects(userId, goal.id)))).flat()
    const [tasks, habits, habitEntries, records] = await Promise.all([
      this.tasksStore.listTasks(userId),
      this.habitsStore.listHabits(userId),
      this.habitsStore.listHabitEntries(userId, period.from, period.to),
      this.listRecords(userId, { from: period.from, to: period.to, includeArchived: true }),
    ])
    const priorCommitments = this.reviews
      .filter((item) => item.userId === userId && item.value.id !== currentReviewId && item.value.deletedAt == null && item.value.period.to < period.from)
      .flatMap((item) => item.value.actions.filter((action) => action.status === 'pending')
        .map((action) => ({ reviewId: item.value.id, text: action.text, status: action.status })))
    return buildReviewEvidence({ goals, projects, tasks, habits, habitEntries, records, priorCommitments }, period)
  }

  private async convertReviewActionOnce(
    userId: string,
    reviewId: string,
    actionId: string,
    input: ConvertReviewActionInput,
  ): Promise<ReviewActionConversion> {
    const owned = this.reviews.find((item) => item.userId === userId && item.value.id === reviewId && item.value.deletedAt == null)
    if (!owned) throw new ReviewsDomainError('NOT_FOUND', '找不到回顾', 404)
    const actionIndex = owned.value.actions.findIndex((action) => action.id === actionId)
    if (actionIndex < 0) throw new ReviewsDomainError('NOT_FOUND', '找不到回顾行动', 404)
    const action = owned.value.actions[actionIndex]!
    if (action.status !== 'pending') throw new ReviewsDomainError('ACTION_ALREADY_CONVERTED', '该行动已经处理，不能重复产生效果', 409)

    let target: ReviewActionConversion['target']
    if (input.target === 'task') {
      const task = await this.tasksStore.createTask(userId, { title: action.text }, `review-action:${reviewId}:${actionId}:task`)
      target = { type: 'task', id: task.id, title: task.title }
    } else if (input.target === 'knowledge') {
      const note = await this.createKnowledge(userId, {
        sourceType: 'review', sourceId: reviewId, title: action.text, body: action.text, tags: ['review-action'],
      })
      target = { type: 'knowledge', id: note.id, title: note.title }
    } else if (input.target === 'public-draft') {
      const snapshot = await this.createSnapshot(userId, {
        slug: `review-${this.createId()}`,
        sourceType: 'review', sourceId: reviewId, title: action.text, excerpt: action.text,
      })
      target = { type: 'public-draft', id: snapshot.id, title: snapshot.title }
    } else {
      if (!input.goalId) throw new ReviewsDomainError('INVALID_INPUT', '转换为目标更新时必须选择目标', 400)
      const goal = await this.goalsStore.getGoal(userId, input.goalId)
      if (!goal) throw new ReviewsDomainError('NOT_FOUND', '找不到目标', 404)
      const update = { id: this.createId(), goalId: goal.id, reviewId, actionId, body: action.text, createdAt: this.now() }
      this.goalUpdates.push({ userId, value: update })
      target = { type: 'goal-update', id: update.id, title: action.text }
    }

    const now = this.now()
    const converted = {
      ...action,
      status: 'converted' as const,
      convertedTarget: input.target,
      convertedId: target.id,
      version: action.version + 1,
      updatedAt: now,
    }
    const actions = owned.value.actions.map((item, index) => index === actionIndex ? converted : item)
    owned.value = { ...owned.value, actions, version: owned.value.version + 1, updatedAt: now }
    return { review: structuredClone(owned.value), action: structuredClone(converted), target }
  }

  private toLegacyReview(review: Review): PeriodReview {
    return {
      id: review.id,
      periodStart: review.period.from,
      periodEnd: review.period.to,
      summary: review.achievements.join('\n') || review.insights.join('\n') || '回顾草稿',
      insights: [...review.insights],
      evidence: [],
      createdAt: review.createdAt,
    }
  }

  private async createReviewIdempotently<T>(userId: string, rawKey: string, input: unknown, create: () => Promise<T>) {
    const key = `${userId}\u0000reviews:create\u0000${normalizeReviewIdempotencyKey(rawKey)}`
    const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
      : value && typeof value === 'object'
        ? `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => `${JSON.stringify(name)}:${stable(item)}`).join(',')}}`
        : JSON.stringify(value)
    const hash = createHash('sha256').update(stable(input)).digest('hex').toUpperCase()
    const existing = this.reviewIdempotency.get(key) as { hash: string; promise: Promise<T> } | undefined
    if (existing) {
      if (existing.hash !== hash) throw new ReviewsDomainError('IDEMPOTENCY_CONFLICT', '幂等键已用于不同回顾请求', 409)
      return existing.promise
    }
    const promise = Promise.resolve().then(create)
    this.reviewIdempotency.set(key, { hash, promise })
    try { return await promise } catch (error) { this.reviewIdempotency.delete(key); throw error }
  }

  private async createReviewConversionIdempotently<T>(
    userId: string,
    reviewId: string,
    actionId: string,
    rawKey: string,
    input: unknown,
    create: () => Promise<T>,
  ) {
    const key = `${userId}\u0000${reviewId}\u0000${actionId}\u0000${normalizeReviewIdempotencyKey(rawKey)}`
    const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
      : value && typeof value === 'object'
        ? `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => `${JSON.stringify(name)}:${stable(item)}`).join(',')}}`
        : JSON.stringify(value)
    const hash = createHash('sha256').update(stable(input)).digest('hex').toUpperCase()
    const existing = this.reviewConversionIdempotency.get(key) as { hash: string; promise: Promise<T> } | undefined
    if (existing) {
      if (existing.hash !== hash) throw new ReviewsDomainError('IDEMPOTENCY_CONFLICT', '幂等键已用于不同转换请求', 409)
      return existing.promise
    }
    const promise = Promise.resolve().then(create)
    this.reviewConversionIdempotency.set(key, { hash, promise })
    try { return await promise } catch (error) { this.reviewConversionIdempotency.delete(key); throw error }
  }

  private async createRecordIdempotently<T>(userId: string, scope: string, rawKey: string, input: unknown, create: () => Promise<T>) {
    const key = `${userId}\u0000${scope}\u0000${normalizeRecordIdempotencyKey(rawKey)}`
    const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
      : value && typeof value === 'object'
        ? `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => `${JSON.stringify(name)}:${stable(item)}`).join(',')}}`
        : JSON.stringify(value)
    const hash = createHash('sha256').update(stable(input)).digest('hex').toUpperCase()
    const existing = this.recordIdempotency.get(key) as { hash: string; promise: Promise<T> } | undefined
    if (existing) {
      if (existing.hash !== hash) throw new RecordsDomainError('IDEMPOTENCY_CONFLICT', '幂等键已用于不同请求', 409)
      return existing.promise
    }
    const promise = Promise.resolve().then(create)
    this.recordIdempotency.set(key, { hash, promise })
    try { return await promise } catch (error) { this.recordIdempotency.delete(key); throw error }
  }
}
