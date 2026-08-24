import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { GoalsStore } from '../domain/goals.js'
import type { TasksStore } from '../domain/tasks.js'
import type { HabitsStore } from '../domain/habits.js'
import type { RecordsStore } from '../domain/records.js'
import type { ReviewsStore } from '../domain/reviews.js'
import type { KnowledgeStore } from '../domain/knowledge.js'
import type { KnowledgeNote, LifeState, PeriodReview, PlanItem, PublicSnapshot, ReviewEvidence, Session, SourceType, User, UserSettings } from '../domain/types.js'
import type { LifeStore } from './lifeStore.js'
import { GoalsMySqlStore } from './mysql/goalsMySqlStore.js'
import { TasksMySqlStore } from './mysql/tasksMySqlStore.js'
import { HabitsMySqlStore } from './mysql/habitsMySqlStore.js'
import { RecordsMySqlStore } from './mysql/recordsMySqlStore.js'
import { ReviewsMySqlStore } from './mysql/reviewsMySqlStore.js'
import { KnowledgeMySqlStore } from './mysql/knowledgeMySqlStore.js'
import { PublishingMySqlStore } from './mysql/publishingMySqlStore.js'
import { MySqlLifeCatalogStore } from './mysql/mysqlLifeCatalogStore.js'
import { MySqlLifeInventoryStore } from './mysql/mysqlLifeInventoryStore.js'
import { MySqlLifeRecipeStore } from './mysql/mysqlLifeRecipeStore.js'
import { MySqlLifePlanningStore } from './mysql/mysqlLifePlanningStore.js'
import { MySqlLifeCommerceStore } from './mysql/mysqlLifeCommerceStore.js'
import type { LifeCatalogStore } from './lifeCatalogStore.js'
import type { LifeInventoryStore } from './lifeInventoryStore.js'
import type { LifeRecipeStore } from './lifeRecipeStore.js'
import type { LifePlanningStore } from './lifePlanningStore.js'
import type { LifeCommerceStore } from './lifeCommerceStore.js'
import type { PublishingStore } from './publishingStore.js'
import type { MediaStoragePort } from '../media/storagePort.js'
import { LifeCommerceDomainError, type PortableMediaAsset } from '../domain/life/commerce.js'
import { SearchMySqlStore } from './mysql/searchMySqlStore.js'
import type { SearchStore } from '../domain/search.js'
import { SettingsMySqlStore } from './mysql/settingsMySqlStore.js'
import type { DataExportResult, DataTransferOwnedData, PortableRow } from '../services/dataTransfer.js'

type Executor = Pool | PoolConnection
type SqlRow = RowDataPacket & Record<string, unknown>

const clean = (value: string, field: string) => {
  const result = value.trim()
  if (!result) throw new Error(`${field}不能为空`)
  return result
}
const toSqlDateTime = (value: string) => new Date(value).toISOString().slice(0, 23).replace('T', ' ')
const iso = (value: unknown) => {
  if (value instanceof Date) return value.toISOString()
  const result = String(value)
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(result) ? `${result.replace(' ', 'T')}Z` : result
}
const optionalIso = (value: unknown) => value == null ? undefined : iso(value)
const parseArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string') return []
  try { const result = JSON.parse(value) as unknown; return Array.isArray(result) ? result.map(String) : [] } catch { return [] }
}

async function queryRows<T>(executor: Executor, sql: string, values: unknown[] = []): Promise<T[]> {
  const [rows] = await executor.execute(sql, values as never[])
  return rows as unknown as T[]
}

export class MySqlLifeStore implements LifeStore {
  private readonly goalsStore: GoalsMySqlStore
  private readonly tasksStore: TasksMySqlStore
  private readonly habitsStore: HabitsMySqlStore
  private readonly recordsStore: RecordsMySqlStore
  private readonly reviewsStore: ReviewsMySqlStore
  private readonly knowledgeStore: KnowledgeMySqlStore
  private readonly publishingStore: PublishingMySqlStore
  private readonly lifeCatalogStore: MySqlLifeCatalogStore
  private readonly lifeInventoryStore: MySqlLifeInventoryStore
  private readonly lifeRecipeStore: MySqlLifeRecipeStore
  private readonly lifePlanningStore: MySqlLifePlanningStore
  private readonly lifeCommerceStore: MySqlLifeCommerceStore
  private readonly searchStore: SearchMySqlStore
  private readonly settingsStore: SettingsMySqlStore
  private readonly dataTransferConnection = new AsyncLocalStorage<PoolConnection>()
  private mediaStorage: MediaStoragePort | undefined

  constructor(
    private readonly pool: Pool,
    private readonly options: { createId?: () => string; now?: () => string; mediaStorage?: MediaStoragePort } = {},
  ) {
    this.mediaStorage = options.mediaStorage
    this.goalsStore = new GoalsMySqlStore(pool, options)
    this.tasksStore = new TasksMySqlStore(pool, options)
    this.habitsStore = new HabitsMySqlStore(pool, options)
    this.recordsStore = new RecordsMySqlStore(pool, options)
    this.reviewsStore = new ReviewsMySqlStore(pool, options)
    this.knowledgeStore = new KnowledgeMySqlStore(pool, options)
    this.publishingStore = new PublishingMySqlStore(pool, options)
    this.lifeCatalogStore = new MySqlLifeCatalogStore(pool, options)
    this.lifeInventoryStore = new MySqlLifeInventoryStore(pool, {
      ...options,
      getCatalogItem: (userId, itemId) => this.lifeCatalogStore.getCatalogItem(userId, itemId),
      getCatalogItemFrom: (executor, userId, itemId) => this.lifeCatalogStore.getCatalogItemFrom(executor, userId, itemId),
      listUnits: (userId) => this.lifeCatalogStore.listUnits(userId),
      listUnitsFrom: (executor, userId) => this.lifeCatalogStore.listUnitsFrom(executor, userId),
    })
    this.lifeRecipeStore = new MySqlLifeRecipeStore(pool, {
      ...options,
      getCatalogItem: (userId, itemId) => this.lifeCatalogStore.getCatalogItem(userId, itemId),
      listCatalogItems: (userId) => this.lifeCatalogStore.listCatalogItems(userId),
      listCatalogItemsFrom: (executor, userId) => this.lifeCatalogStore.listCatalogItemsFrom(executor, userId),
      listTaxonomy: (userId, kind) => this.lifeCatalogStore.listTaxonomy(userId, kind),
      listUnits: (userId) => this.lifeCatalogStore.listUnits(userId),
      listUnitsFrom: (executor, userId) => this.lifeCatalogStore.listUnitsFrom(executor, userId),
      getMediaAsset: (userId, id) => this.recordsStore.getMediaAsset(userId, id),
      listInventoryBalances: (userId) => this.lifeInventoryStore.listInventoryBalances(userId),
      listInventoryBalancesFrom: (executor, userId) => this.lifeInventoryStore.listInventoryBalancesFrom(executor, userId),
      consumeRecipeIngredients: (connection, userId, inputs, occurredAt, sessionId) => this.lifeInventoryStore.consumeRecipeIngredients(connection, userId, inputs, occurredAt, sessionId),
    })
    this.lifePlanningStore = new MySqlLifePlanningStore(pool, {
      ...options,
      getCatalogItem: (userId, itemId) => this.lifeCatalogStore.getCatalogItem(userId, itemId),
      getCatalogItemFrom: (executor, userId, itemId) => this.lifeCatalogStore.getCatalogItemFrom(executor, userId, itemId),
      listUnits: (userId) => this.lifeCatalogStore.listUnits(userId),
      listUnitsFrom: (executor, userId) => this.lifeCatalogStore.listUnitsFrom(executor, userId),
      listInventoryForecasts: (userId) => this.lifeInventoryStore.listInventoryForecasts(userId),
      calculateStoredRecipe: (userId, recipeId, input) => this.lifeRecipeStore.calculateStoredRecipe(userId, recipeId, input),
      calculateStoredRecipeFrom: (executor, userId, recipeId, input) => this.lifeRecipeStore.calculateStoredRecipeFrom(executor, userId, recipeId, input),
      listPreparedFood: (userId) => this.lifeRecipeStore.listPreparedFood(userId),
    })
    this.lifeCommerceStore = new MySqlLifeCommerceStore(pool, {
      ...options,
      getCatalogItemFrom: (executor, userId, itemId) => this.lifeCatalogStore.getCatalogItemFrom(executor, userId, itemId),
      listCatalogItemsFrom: (executor, userId) => this.lifeCatalogStore.listCatalogItemsFrom(executor, userId),
      readMediaAsset: async (executor, userId, mediaId) => {
        const asset = await this.recordsStore.getMediaAssetFrom(executor, userId, mediaId)
        if (!asset || !this.mediaStorage) return undefined
        const bytes = await this.mediaStorage.read(asset.storageKey)
        return bytes ? { asset, bytes } : undefined
      },
      restoreMediaAssetsFrom: (connection, userId, mediaAssets) => this.restorePortableMediaAssetsFrom(connection, userId, mediaAssets),
      listUnitsFrom: (executor, userId) => this.lifeCatalogStore.listUnitsFrom(executor, userId),
      updateCatalogItemFrom: (connection, userId, itemId, input) => this.lifeCatalogStore.updateCatalogItemFrom(connection, userId, itemId, input),
      createInventoryTransactionFrom: (connection, userId, input) => this.lifeInventoryStore.createInventoryTransactionFrom(connection, userId, input),
      listInventoryBalancesFrom: (executor, userId) => this.lifeInventoryStore.listInventoryBalancesFrom(executor, userId),
      listUsableInventoryBalancesFrom: (executor, userId, asOf) => this.lifeInventoryStore.listUsableInventoryBalancesFrom(executor, userId, asOf),
      getPlanningTimeline: (userId, date) => this.lifePlanningStore.getPlanningTimeline(userId, date),
      listDayPlanProjectionsFrom: (executor, userId, from, through) => this.lifePlanningStore.listDayPlanProjectionsFrom(executor, userId, from, through),
      exportBusinessDataFrom: async (executor, userId) => ({
        ...await this.lifeCatalogStore.exportOwnerPortableDataFrom(executor, userId),
        ...await this.lifeInventoryStore.exportOwnerPortableDataFrom(executor, userId),
        ...await this.lifeRecipeStore.exportOwnerPortableDataFrom(executor, userId),
        ...await this.lifePlanningStore.exportOwnerPortableDataFrom(executor, userId),
      }),
      restoreCatalogItemsFrom: (connection, userId, items) => this.lifeCatalogStore.restoreCatalogItemsFrom(connection, userId, items),
    })
    this.searchStore = new SearchMySqlStore(pool)
    this.settingsStore = new SettingsMySqlStore(pool, options)
  }

  configureMediaStorage(storage: MediaStoragePort | undefined) { this.mediaStorage = storage }
  async search(...args: Parameters<SearchStore['search']>) { return this.searchStore.search(...args) }
  async getUserSettings(...args: Parameters<SettingsMySqlStore['getUserSettings']>) { return this.settingsStore.getUserSettings(...args) }
  async updateUserSettings(...args: Parameters<SettingsMySqlStore['updateUserSettings']>) { return this.settingsStore.updateUserSettings(...args) }
  async updateUserPassword(...args: Parameters<SettingsMySqlStore['updateUserPassword']>) { return this.settingsStore.updateUserPassword(...args) }
  async listUserSessions(...args: Parameters<SettingsMySqlStore['listUserSessions']>) { return this.settingsStore.listUserSessions(...args) }
  async revokeUserSession(...args: Parameters<SettingsMySqlStore['revokeUserSession']>) { return this.settingsStore.revokeUserSession(...args) }
  async revokeOtherUserSessions(...args: Parameters<SettingsMySqlStore['revokeOtherUserSessions']>) { return this.settingsStore.revokeOtherUserSessions(...args) }
  async appendSafeAuditEvent(...args: Parameters<SettingsMySqlStore['appendSafeAuditEvent']>) {
    return this.settingsStore.appendSafeAuditEventFrom(this.dataTransferConnection.getStore() ?? this.pool, ...args)
  }
  async listSafeAuditEvents(...args: Parameters<SettingsMySqlStore['listSafeAuditEvents']>) { return this.settingsStore.listSafeAuditEvents(...args) }
  async persistDataTransferRestorePoint(userId: string, snapshot: DataExportResult) {
    return this.settingsStore.persistDataTransferRestorePoint(userId, snapshot)
  }
  async readOwnedData(userId: string): Promise<DataTransferOwnedData> {
    const goals = await this.goalsStore.listGoals(userId)
    const projects = (await Promise.all(goals.map((goal) => this.goalsStore.listProjects(userId, goal.id)))).flat()
    const milestones = (await Promise.all(projects.map((project) => this.goalsStore.listMilestones(userId, project.id)))).flat()
    const lifeExport = await this.lifeCommerceStore.createLifeExport(userId, { format: 'json', includeAttachments: false }, `full-data-export:${this.createId()}`)
    const trashRows = await queryRows<SqlRow>(this.pool, `SELECT 'record' entity_type,id entity_id FROM life_records WHERE user_id=? AND deleted_at IS NOT NULL
      UNION ALL SELECT 'review',id FROM period_reviews WHERE user_id=? AND deleted_at IS NOT NULL
      UNION ALL SELECT 'knowledge',id FROM knowledge_notes WHERE user_id=? AND deleted_at IS NOT NULL`, [userId, userId, userId])
    return {
      original: {
        goals: structuredClone(goals), projects: structuredClone(projects), milestones: structuredClone(milestones),
        tasks: structuredClone(await this.tasksStore.listTasks(userId)),
        scheduleBlocks: structuredClone(await this.tasksStore.listScheduleBlocks(userId)),
        habits: structuredClone(await this.habitsStore.listHabits(userId)),
        habitEntries: structuredClone(await this.habitsStore.listHabitEntries(userId)),
        records: structuredClone(await this.recordsStore.listRecordsForDataTransfer(userId)),
        reviews: structuredClone(await this.reviewsStore.listReviewsForDataTransfer(userId)),
        knowledge: structuredClone((await this.knowledgeStore.listKnowledge(userId, { includeArchived: true, includeDeleted: true })).items),
        publications: structuredClone(await this.publishingStore.listPublicDrafts(userId)),
        trash: trashRows.map((row) => ({ entityType: String(row.entity_type), entityId: String(row.entity_id) })),
      },
      life: structuredClone((lifeExport.payload ?? {}) as Record<string, Array<Record<string, unknown>>>),
      settings: await this.settingsStore.getUserSettings(userId) as unknown as Record<string, unknown>,
    }
  }
  async applyOwnedData(userId: string, data: DataTransferOwnedData) {
    const connection = this.dataTransferConnection.getStore()
    if (!connection) throw new Error('DATA_TRANSFER_TRANSACTION_REQUIRED')
    await this.replaceOriginalDataFrom(connection, userId, data.original)
    await this.lifeCommerceStore.replaceOwnerPortableDataFrom(connection, userId, data.life)
    const settings = data.settings as Partial<UserSettings>
    const safeSettings = {
      appearance: settings.appearance,
      locale: settings.locale,
      defaults: settings.defaults,
      life: settings.life,
      publicSite: settings.publicSite,
    }
    const timestamp = toSqlDateTime(this.now())
    await connection.execute(`INSERT INTO user_settings (user_id,settings_json,version,created_at,updated_at)
      VALUES (?,?,2,?,?) AS incoming
      ON DUPLICATE KEY UPDATE settings_json=incoming.settings_json,version=user_settings.version+1,updated_at=incoming.updated_at`, [
      userId, JSON.stringify(safeSettings), timestamp, timestamp,
    ])
  }
  async transaction<T>(userId: string, work: () => Promise<T>): Promise<T> {
    return this.withOwnerMutationLock(userId, async () => {
      const connection = await this.pool.getConnection()
      try {
        await connection.beginTransaction()
        const result = await this.dataTransferConnection.run(connection, work)
        await connection.commit()
        return result
      } catch (error) {
        await connection.rollback()
        throw error
      } finally {
        connection.release()
      }
    })
  }

  private async replaceOriginalDataFrom(connection: PoolConnection, userId: string, original: DataTransferOwnedData['original']) {
    const value = (row: PortableRow, key: string, fallback: unknown = null) => row[key] ?? fallback
    const timestamp = (row: PortableRow, key: string, fallback = this.now()) => toSqlDateTime(String(value(row, key, fallback)))
    const nullableTimestamp = (row: PortableRow, key: string) => value(row, key) == null ? null : toSqlDateTime(String(value(row, key)))
    const json = (item: unknown, fallback: unknown[] | Record<string, unknown> = []) => JSON.stringify(item ?? fallback)

    await connection.execute(`DELETE revisions FROM public_revisions revisions
      INNER JOIN public_drafts drafts ON drafts.id=revisions.draft_id WHERE drafts.user_id=?`, [userId])
    for (const table of ['public_drafts', 'knowledge_notes', 'goal_updates', 'review_actions']) {
      await connection.execute(`DELETE FROM ${table} WHERE user_id=?`, [userId])
    }
    await connection.execute('DELETE evidence FROM review_evidence evidence INNER JOIN period_reviews reviews ON reviews.id=evidence.review_id WHERE reviews.user_id=?', [userId])
    for (const table of ['period_reviews', 'record_links', 'record_media', 'life_records', 'habit_entries', 'habit_schedules', 'habits', 'schedule_blocks', 'task_checklist_items', 'task_recurrence_rules', 'tasks', 'milestones', 'projects', 'goals']) {
      await connection.execute(`DELETE FROM ${table} WHERE user_id=?`, [userId])
    }

    for (const row of original.goals) await connection.execute(`INSERT INTO goals
      (id,user_id,title,description,status,priority,starts_on,target_on,progress_mode,manual_progress,version,created_at,updated_at,deleted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      row.id, userId, value(row, 'title', ''), value(row, 'description', ''), value(row, 'status', 'active'), value(row, 'priority', 2),
      value(row, 'startsOn'), value(row, 'targetOn'), value(row, 'progressMode', 'manual'), value(row, 'manualProgress', 0), value(row, 'version', 1),
      timestamp(row, 'createdAt'), timestamp(row, 'updatedAt'), nullableTimestamp(row, 'deletedAt'),
    ])
    for (const row of original.projects) await connection.execute(`INSERT INTO projects
      (id,user_id,goal_id,title,description,risk_note,status,starts_on,target_on,progress,next_task_id,version,created_at,updated_at,deleted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      row.id, userId, value(row, 'goalId'), value(row, 'title', ''), value(row, 'description', ''), value(row, 'riskNote', ''), value(row, 'status', 'active'),
      value(row, 'startsOn'), value(row, 'targetOn'), value(row, 'progress', 0), value(row, 'nextTaskId'), value(row, 'version', 1),
      timestamp(row, 'createdAt'), timestamp(row, 'updatedAt'), nullableTimestamp(row, 'deletedAt'),
    ])
    for (const row of original.milestones) await connection.execute(`INSERT INTO milestones
      (id,user_id,project_id,title,due_on,completed_at,position,version,created_at,updated_at,deleted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
      row.id, userId, value(row, 'projectId'), value(row, 'title', ''), value(row, 'dueOn'), nullableTimestamp(row, 'completedAt'), value(row, 'position', 0), value(row, 'version', 1),
      timestamp(row, 'createdAt'), timestamp(row, 'updatedAt'), nullableTimestamp(row, 'deletedAt'),
    ])
    for (const row of original.tasks) {
      await connection.execute(`INSERT INTO tasks
        (id,user_id,goal_id,project_id,milestone_id,legacy_plan_id,legacy_scheduled_for,title,description,starts_at,ends_at,due_at,estimate_minutes,priority,tags,status,completed_at,version,created_at,updated_at,deleted_at)
        VALUES (?,?,?,?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        row.id, userId, value(row, 'goalId'), value(row, 'projectId'), value(row, 'milestoneId'), value(row, 'title', ''), value(row, 'description', ''),
        nullableTimestamp(row, 'startsAt'), nullableTimestamp(row, 'endsAt'), nullableTimestamp(row, 'dueAt'), value(row, 'estimateMinutes'), value(row, 'priority', 2),
        json(value(row, 'tags', [])), value(row, 'status', 'inbox'), nullableTimestamp(row, 'completedAt'), value(row, 'version', 1),
        timestamp(row, 'createdAt'), timestamp(row, 'updatedAt'), nullableTimestamp(row, 'deletedAt'),
      ])
      for (const checklist of Array.isArray(row.checklist) ? row.checklist as PortableRow[] : []) await connection.execute(`INSERT INTO task_checklist_items
        (id,user_id,task_id,title,is_completed,completed_at,position,version,created_at,updated_at,deleted_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,NULL)`, [
        checklist.id, userId, row.id, value(checklist, 'title', ''), Boolean(value(checklist, 'isCompleted', false)), nullableTimestamp(checklist, 'completedAt'),
        value(checklist, 'position', 0), value(checklist, 'version', 1), timestamp(row, 'createdAt'), timestamp(row, 'updatedAt'),
      ])
      const recurrence = row.recurrence as PortableRow | null | undefined
      if (recurrence) await connection.execute(`INSERT INTO task_recurrence_rules
        (id,user_id,task_id,frequency,interval_value,weekdays,month_day,until_on,timezone,version,created_at,updated_at,deleted_at)
        VALUES (?,?,?,?,?,?,?,?,?,1,?,?,NULL)`, [
        this.createId(), userId, row.id, value(recurrence, 'frequency'), value(recurrence, 'interval', 1),
        value(recurrence, 'weekdays') == null ? null : json(value(recurrence, 'weekdays')), value(recurrence, 'monthDay'), value(recurrence, 'until'),
        'Asia/Shanghai', timestamp(row, 'createdAt'), timestamp(row, 'updatedAt'),
      ])
    }
    for (const row of original.scheduleBlocks) await connection.execute(`INSERT INTO schedule_blocks
      (id,user_id,task_id,starts_at,ends_at,version,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,NULL)`, [
      row.id, userId, value(row, 'taskId'), timestamp(row, 'startsAt'), timestamp(row, 'endsAt'), value(row, 'version', 1),
      timestamp(row, 'createdAt', String(value(row, 'startsAt'))), timestamp(row, 'updatedAt', String(value(row, 'startsAt'))),
    ])
    for (const row of original.habits) {
      await connection.execute(`INSERT INTO habits
        (id,user_id,goal_id,project_id,title,description,measure,unit,target_value,status,paused_at,timezone,version,created_at,updated_at,deleted_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        row.id, userId, value(row, 'goalId'), value(row, 'projectId'), value(row, 'title', ''), value(row, 'description', ''), value(row, 'measure', 'boolean'),
        value(row, 'unit'), value(row, 'targetValue'), value(row, 'status', 'active'), nullableTimestamp(row, 'pausedAt'), value(row, 'timezone', 'Asia/Shanghai'),
        value(row, 'version', 1), timestamp(row, 'createdAt'), timestamp(row, 'updatedAt'), nullableTimestamp(row, 'deletedAt'),
      ])
      const schedule = row.schedule as PortableRow
      await connection.execute(`INSERT INTO habit_schedules
        (id,user_id,habit_id,schedule_type,weekdays,times_per_week,interval_days,starts_on,ends_on,version,created_at,updated_at,deleted_at)
        VALUES (?,?,?,?,?,?,?,?,?,1,?,?,NULL)`, [
        this.createId(), userId, row.id, value(schedule, 'scheduleType', 'daily'), value(schedule, 'weekdays') == null ? null : json(value(schedule, 'weekdays')),
        value(schedule, 'timesPerWeek'), value(schedule, 'intervalDays'), value(schedule, 'startsOn', '2026-01-01'), value(schedule, 'endsOn'),
        timestamp(row, 'createdAt'), timestamp(row, 'updatedAt'),
      ])
    }
    for (const row of original.habitEntries) await connection.execute(`INSERT INTO habit_entries
      (id,user_id,habit_id,entry_date,status,value,note,version,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
      row.id, userId, value(row, 'habitId'), value(row, 'entryDate'), value(row, 'status'), value(row, 'value'), value(row, 'note', ''), value(row, 'version', 1),
      timestamp(row, 'createdAt'), timestamp(row, 'updatedAt'), nullableTimestamp(row, 'deletedAt'),
    ])
    for (const row of original.records) {
      await connection.execute(`INSERT INTO life_records
        (id,user_id,plan_id,title,body,occurred_at,tags,pinned,archived_at,cover_media_id,version,created_at,updated_at,deleted_at)
        VALUES (?,?,NULL,?,?,?,?,?,?,NULL,?,?,?,?)`, [
        row.id, userId, value(row, 'title', ''), value(row, 'body', ''), timestamp(row, 'occurredAt'), json(value(row, 'tags', [])), Boolean(value(row, 'pinned', false)),
        nullableTimestamp(row, 'archivedAt'), value(row, 'version', 1), timestamp(row, 'createdAt'), timestamp(row, 'updatedAt'), nullableTimestamp(row, 'deletedAt'),
      ])
      for (const [position, link] of (Array.isArray(row.links) ? row.links as PortableRow[] : []).entries()) await connection.execute(
        'INSERT INTO record_links (record_id,user_id,link_type,link_id,position,created_at) VALUES (?,?,?,?,?,?)',
        [row.id, userId, value(link, 'type'), value(link, 'id'), position, timestamp(row, 'createdAt')],
      )
    }
    for (const row of original.reviews) {
      const period = row.period as PortableRow
      await connection.execute(`INSERT INTO period_reviews
        (id,user_id,review_type,period_start,period_end,status,summary,achievements,problems,causes,insights,next_changes,evidence_json,version,created_at,updated_at,deleted_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        row.id, userId, value(row, 'type', 'custom'), value(period, 'from'), value(period, 'to'), value(row, 'status', 'draft'),
        (Array.isArray(row.achievements) ? row.achievements : []).join('\n'), json(value(row, 'achievements', [])), json(value(row, 'problems', [])),
        json(value(row, 'causes', [])), json(value(row, 'insights', [])), json(value(row, 'nextChanges', [])), json(value(row, 'evidence', {}), {}),
        value(row, 'version', 1), timestamp(row, 'createdAt'), timestamp(row, 'updatedAt'), nullableTimestamp(row, 'deletedAt'),
      ])
      for (const action of Array.isArray(row.actions) ? row.actions as PortableRow[] : []) await connection.execute(`INSERT INTO review_actions
        (id,user_id,review_id,action_text,status,converted_target,converted_id,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, [
        action.id, userId, row.id, value(action, 'text', ''), value(action, 'status', 'pending'), value(action, 'convertedTarget'), value(action, 'convertedId'),
        value(action, 'version', 1), timestamp(action, 'createdAt'), timestamp(action, 'updatedAt'),
      ])
    }
    for (const row of original.knowledge) {
      const sourceLinks = Array.isArray(row.sourceLinks) ? row.sourceLinks as PortableRow[] : []
      const legacy = sourceLinks.find((link) => ['record', 'review'].includes(String(value(link, 'type'))))
      await connection.execute(`INSERT INTO knowledge_notes
        (id,user_id,source_type,source_id,title,body,tags,collection_ids,source_links,related_ids,pinned,favorite,review_on,version,created_at,updated_at,archived_at,deleted_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        row.id, userId, legacy ? value(legacy, 'type') : null, legacy ? value(legacy, 'id') : null, value(row, 'title', ''), value(row, 'body', ''),
        json(value(row, 'tags', [])), json(value(row, 'collectionIds', [])), json(sourceLinks), json(value(row, 'relatedIds', [])),
        Boolean(value(row, 'pinned', false)), Boolean(value(row, 'favorite', false)), value(row, 'reviewOn'), value(row, 'version', 1),
        timestamp(row, 'createdAt'), timestamp(row, 'updatedAt'), nullableTimestamp(row, 'archivedAt'), nullableTimestamp(row, 'deletedAt'),
      ])
    }
    for (const row of original.publications) {
      const source = row.source as PortableRow | null | undefined
      const seo = row.seo as PortableRow | undefined
      await connection.execute(`INSERT INTO public_drafts
        (id,user_id,category,source_type,source_id,source_version,title,excerpt,body,cover_url,tags,slug,scheduled_at,featured,seo_title,seo_description,status,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        row.id, userId, value(row, 'category', 'now'), source ? value(source, 'type') : null, source ? value(source, 'id') : null, source ? value(source, 'version') : null,
        value(row, 'title', ''), value(row, 'excerpt', ''), value(row, 'body', ''), value(row, 'coverUrl'), json(value(row, 'tags', [])), value(row, 'slug'),
        nullableTimestamp(row, 'scheduledAt'), Boolean(value(row, 'featured', false)), value(seo ?? {}, 'title', ''), value(seo ?? {}, 'description', ''),
        value(row, 'status', 'draft'), value(row, 'version', 1), timestamp(row, 'createdAt'), timestamp(row, 'updatedAt'),
      ])
    }
  }

  private async restorePortableMediaAssetsFrom(connection: PoolConnection, userId: string, portableAssets: PortableMediaAsset[]) {
    const storage = this.mediaStorage
    if (!storage) throw new LifeCommerceDomainError('ATTACHMENT_STORAGE_UNAVAILABLE', 'Attachment storage is unavailable for this restore.', 409)
    const createdStorageKeys: string[] = []
    const oldStorageKeys: string[] = []
    try {
      for (const portable of portableAssets) {
        const existing = (await queryRows<SqlRow>(connection, 'SELECT user_id,storage_key FROM media_assets WHERE id=? LIMIT 1 FOR UPDATE', [portable.id]))[0]
        if (existing && String(existing.user_id) !== userId) {
          throw new LifeCommerceDomainError('IMPORT_MEDIA_ID_CONFLICT', `Media asset ${portable.id} belongs to another owner.`, 409)
        }
        const bytes = Buffer.from(portable.bytesBase64, 'base64')
        const stored = await storage.put({ originalName: portable.originalName, mimeType: portable.mimeType, bytes })
        createdStorageKeys.push(stored.storageKey)
        if (stored.sizeBytes !== portable.sizeBytes || stored.checksum.toUpperCase() !== portable.checksum.toUpperCase()
          || stored.mimeType !== portable.mimeType) {
          throw new LifeCommerceDomainError('ATTACHMENT_CONTENT_MISMATCH', `Attachment ${portable.id} failed storage verification.`, 409)
        }
        if (existing) {
          oldStorageKeys.push(String(existing.storage_key))
          await connection.execute(`UPDATE media_assets SET visibility=?,mime_type=?,original_name=?,size_bytes=?,storage_key=?,checksum=?,width=?,height=?,version=?,created_at=?,updated_at=?,deleted_at=NULL WHERE id=? AND user_id=?`, [
            portable.visibility,portable.mimeType,portable.originalName,portable.sizeBytes,stored.storageKey,portable.checksum,
            portable.width,portable.height,portable.version,toSqlDateTime(portable.createdAt),toSqlDateTime(portable.updatedAt),portable.id,userId,
          ])
        } else {
          await connection.execute(`INSERT INTO media_assets
            (id,user_id,visibility,mime_type,original_name,size_bytes,storage_key,checksum,width,height,version,created_at,updated_at,deleted_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`, [
            portable.id,userId,portable.visibility,portable.mimeType,portable.originalName,portable.sizeBytes,stored.storageKey,
            portable.checksum,portable.width,portable.height,portable.version,toSqlDateTime(portable.createdAt),toSqlDateTime(portable.updatedAt),
          ])
        }
      }
    } catch (error) {
      await Promise.allSettled(createdStorageKeys.map((storageKey) => storage.remove(storageKey)))
      throw error
    }
    return {
      commit: async () => { await Promise.allSettled(oldStorageKeys.filter((key) => !createdStorageKeys.includes(key)).map((key) => storage.remove(key))) },
      rollback: async () => { await Promise.allSettled(createdStorageKeys.map((storageKey) => storage.remove(storageKey))) },
    }
  }

  private createId = () => this.options.createId?.() ?? randomUUID()
  private now = () => this.options.now?.() ?? new Date().toISOString()

  private async withOwnerMutationLock<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection()
    const lockName = `lifeops:owner:${userId}`
    try {
      const acquired = await queryRows<SqlRow>(connection, 'SELECT GET_LOCK(?,30) acquired', [lockName])
      if (Number(acquired[0]?.acquired) !== 1) throw new Error('LIFE_OWNER_MUTATION_LOCK_TIMEOUT')
      return await work()
    } finally {
      try { await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]) } finally { connection.release() }
    }
  }

  async createUser(input: { account: string; displayName: string; passwordHash: string }) {
    const user: User = { id: this.createId(), account: clean(input.account, '账号').toLowerCase(), displayName: clean(input.displayName, '显示名称'), passwordHash: input.passwordHash, createdAt: this.now() }
    await this.pool.execute('INSERT INTO users (id, account, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', [user.id, user.account, user.displayName, user.passwordHash, toSqlDateTime(user.createdAt)])
    return user
  }

  async findUserByAccount(account: string) {
    const rows = await queryRows<SqlRow>(this.pool, 'SELECT id, account, display_name, password_hash, created_at FROM users WHERE account = ? LIMIT 1', [account.trim().toLowerCase()])
    return rows[0] ? this.mapUser(rows[0]) : undefined
  }
  async findUserById(id: string) {
    const rows = await queryRows<SqlRow>(this.pool, 'SELECT id, account, display_name, password_hash, created_at FROM users WHERE id = ? LIMIT 1', [id])
    return rows[0] ? this.mapUser(rows[0]) : undefined
  }

  async createSession(input: { userId: string; tokenHash: string; csrfToken: string; expiresAt: string }) {
    const session: Session = { id: this.createId(), ...input, createdAt: this.now() }
    await this.pool.execute('INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)', [session.id, session.userId, session.tokenHash, session.csrfToken, toSqlDateTime(session.expiresAt), toSqlDateTime(session.createdAt)])
    return session
  }
  async findSessionByTokenHash(tokenHash: string) {
    const rows = await queryRows<SqlRow>(this.pool, 'SELECT id, user_id, token_hash, csrf_token, expires_at, created_at FROM sessions WHERE token_hash = ? LIMIT 1', [tokenHash])
    const row = rows[0]
    return row ? { id: String(row.id), userId: String(row.user_id), tokenHash: String(row.token_hash), csrfToken: String(row.csrf_token), expiresAt: iso(row.expires_at), createdAt: iso(row.created_at) } : undefined
  }
  async deleteSession(id: string) { await this.pool.execute('DELETE FROM sessions WHERE id = ?', [id]) }
  async getLoginFailure(key: string) {
    const rows = await queryRows<SqlRow>(this.pool, 'SELECT failure_count, reset_at FROM login_rate_limits WHERE rate_key = ? LIMIT 1', [key])
    return rows[0] ? { count: Number(rows[0].failure_count), resetAt: iso(rows[0].reset_at) } : undefined
  }
  async recordLoginFailure(key: string, now: string, resetAt: string) {
    const nowSql = toSqlDateTime(now)
    await this.pool.execute(`INSERT INTO login_rate_limits (rate_key, failure_count, reset_at, updated_at)
      VALUES (?, 1, ?, ?) AS incoming
      ON DUPLICATE KEY UPDATE
        failure_count = IF(login_rate_limits.reset_at <= incoming.updated_at, 1, login_rate_limits.failure_count + 1),
        reset_at = IF(login_rate_limits.reset_at <= incoming.updated_at, incoming.reset_at, login_rate_limits.reset_at),
        updated_at = incoming.updated_at`, [key, toSqlDateTime(resetAt), nowSql])
  }
  async clearLoginFailures(key: string) { await this.pool.execute('DELETE FROM login_rate_limits WHERE rate_key = ?', [key]) }

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

  async listRecords(...args: Parameters<RecordsStore['listRecords']>) { return this.recordsStore.listRecords(...args) }
  async getRecord(...args: Parameters<RecordsStore['getRecord']>) { return this.recordsStore.getRecord(...args) }
  async createRecord(...args: Parameters<RecordsStore['createRecord']>) { return this.recordsStore.createRecord(...args) }
  async updateRecord(...args: Parameters<RecordsStore['updateRecord']>) { return this.recordsStore.updateRecord(...args) }
  async deleteRecord(...args: Parameters<RecordsStore['deleteRecord']>) { return this.recordsStore.deleteRecord(...args) }
  async restoreRecord(...args: Parameters<RecordsStore['restoreRecord']>) { return this.recordsStore.restoreRecord(...args) }
  async createMediaAsset(...args: Parameters<RecordsStore['createMediaAsset']>) { return this.recordsStore.createMediaAsset(...args) }
  async getMediaAsset(...args: Parameters<RecordsStore['getMediaAsset']>) { return this.recordsStore.getMediaAsset(...args) }
  async getPublicMediaAsset(...args: Parameters<RecordsStore['getPublicMediaAsset']>) { return this.recordsStore.getPublicMediaAsset(...args) }

  async listReviews(...args: Parameters<ReviewsStore['listReviews']>) { return this.reviewsStore.listReviews(...args) }
  async getReview(...args: Parameters<ReviewsStore['getReview']>) { return this.reviewsStore.getReview(...args) }
  async createReview(...args: Parameters<ReviewsStore['createReview']>) { return this.reviewsStore.createReview(...args) }
  async updateReview(...args: Parameters<ReviewsStore['updateReview']>) { return this.reviewsStore.updateReview(...args) }
  async deleteReview(...args: Parameters<ReviewsStore['deleteReview']>) { return this.reviewsStore.deleteReview(...args) }
  async restoreReview(...args: Parameters<ReviewsStore['restoreReview']>) { return this.reviewsStore.restoreReview(...args) }
  async refreshReviewEvidence(...args: Parameters<ReviewsStore['refreshReviewEvidence']>) { return this.reviewsStore.refreshReviewEvidence(...args) }
  async convertReviewAction(...args: Parameters<ReviewsStore['convertReviewAction']>) { return this.reviewsStore.convertReviewAction(...args) }

  async listKnowledge(...args: Parameters<KnowledgeStore['listKnowledge']>) { return this.knowledgeStore.listKnowledge(...args) }
  async getKnowledgeNote(...args: Parameters<KnowledgeStore['getKnowledgeNote']>) { return this.knowledgeStore.getKnowledgeNote(...args) }
  async createKnowledgeNote(...args: Parameters<KnowledgeStore['createKnowledgeNote']>) { return this.knowledgeStore.createKnowledgeNote(...args) }
  async updateKnowledgeNote(...args: Parameters<KnowledgeStore['updateKnowledgeNote']>) { return this.knowledgeStore.updateKnowledgeNote(...args) }
  async archiveKnowledgeNote(...args: Parameters<KnowledgeStore['archiveKnowledgeNote']>) { return this.knowledgeStore.archiveKnowledgeNote(...args) }
  async deleteKnowledgeNote(...args: Parameters<KnowledgeStore['deleteKnowledgeNote']>) { return this.knowledgeStore.deleteKnowledgeNote(...args) }
  async restoreKnowledgeNote(...args: Parameters<KnowledgeStore['restoreKnowledgeNote']>) { return this.knowledgeStore.restoreKnowledgeNote(...args) }
  async addKnowledgeRelation(...args: Parameters<KnowledgeStore['addKnowledgeRelation']>) { return this.knowledgeStore.addKnowledgeRelation(...args) }
  async removeKnowledgeRelation(...args: Parameters<KnowledgeStore['removeKnowledgeRelation']>) { return this.knowledgeStore.removeKnowledgeRelation(...args) }
  async listKnowledgeCollections(...args: Parameters<KnowledgeStore['listKnowledgeCollections']>) { return this.knowledgeStore.listKnowledgeCollections(...args) }
  async createKnowledgeCollection(...args: Parameters<KnowledgeStore['createKnowledgeCollection']>) { return this.knowledgeStore.createKnowledgeCollection(...args) }
  async updateKnowledgeCollection(...args: Parameters<KnowledgeStore['updateKnowledgeCollection']>) { return this.knowledgeStore.updateKnowledgeCollection(...args) }
  async deleteKnowledgeCollection(...args: Parameters<KnowledgeStore['deleteKnowledgeCollection']>) { return this.knowledgeStore.deleteKnowledgeCollection(...args) }
  async resurfaceKnowledge(...args: Parameters<KnowledgeStore['resurfaceKnowledge']>) { return this.knowledgeStore.resurfaceKnowledge(...args) }

  async listPublicDrafts(...args: Parameters<PublishingStore['listPublicDrafts']>) { return this.publishingStore.listPublicDrafts(...args) }
  async getPublicDraft(...args: Parameters<PublishingStore['getPublicDraft']>) { return this.publishingStore.getPublicDraft(...args) }
  async createPublicDraft(...args: Parameters<PublishingStore['createPublicDraft']>) { return this.publishingStore.createPublicDraft(...args) }
  async updatePublicDraft(...args: Parameters<PublishingStore['updatePublicDraft']>) { return this.publishingStore.updatePublicDraft(...args) }
  async deletePublicDraft(...args: Parameters<PublishingStore['deletePublicDraft']>) { return this.publishingStore.deletePublicDraft(...args) }
  async previewPublicDraft(...args: Parameters<PublishingStore['previewPublicDraft']>) { return this.publishingStore.previewPublicDraft(...args) }
  async publishPublicDraft(...args: Parameters<PublishingStore['publishPublicDraft']>) { return this.publishingStore.publishPublicDraft(...args) }
  async schedulePublicDraft(...args: Parameters<PublishingStore['schedulePublicDraft']>) { return this.publishingStore.schedulePublicDraft(...args) }
  async revokePublicDraft(...args: Parameters<PublishingStore['revokePublicDraft']>) { return this.publishingStore.revokePublicDraft(...args) }
  async listPublicRevisions(...args: Parameters<PublishingStore['listPublicRevisions']>) { return this.publishingStore.listPublicRevisions(...args) }
  async diffPublicRevisionHistory(...args: Parameters<PublishingStore['diffPublicRevisionHistory']>) { return this.publishingStore.diffPublicRevisionHistory(...args) }
  async listPublishedRevisions(...args: Parameters<PublishingStore['listPublishedRevisions']>) { return this.publishingStore.listPublishedRevisions(...args) }
  async getPublishedRevision(...args: Parameters<PublishingStore['getPublishedRevision']>) { return this.publishingStore.getPublishedRevision(...args) }
  async listDuePublicDraftIds(...args: Parameters<PublishingStore['listDuePublicDraftIds']>) { return this.publishingStore.listDuePublicDraftIds(...args) }
  async publishDuePublicDraft(...args: Parameters<PublishingStore['publishDuePublicDraft']>) { return this.publishingStore.publishDuePublicDraft(...args) }

  async listCatalogItems(...args: Parameters<LifeCatalogStore['listCatalogItems']>) { return this.lifeCatalogStore.listCatalogItems(...args) }
  async getCatalogItem(...args: Parameters<LifeCatalogStore['getCatalogItem']>) { return this.lifeCatalogStore.getCatalogItem(...args) }
  async createCatalogItem(...args: Parameters<LifeCatalogStore['createCatalogItem']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCatalogStore.createCatalogItem(...args)) }
  async updateCatalogItem(...args: Parameters<LifeCatalogStore['updateCatalogItem']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCatalogStore.updateCatalogItem(...args)) }
  async batchUpdateCatalogItems(...args: Parameters<LifeCatalogStore['batchUpdateCatalogItems']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCatalogStore.batchUpdateCatalogItems(...args)) }
  async previewCatalogItemDelete(...args: Parameters<LifeCatalogStore['previewCatalogItemDelete']>) { return this.lifeCatalogStore.previewCatalogItemDelete(...args) }
  async deleteCatalogItem(...args: Parameters<LifeCatalogStore['deleteCatalogItem']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCatalogStore.deleteCatalogItem(...args)) }
  async listDeletedCatalogItems(...args: Parameters<LifeCatalogStore['listDeletedCatalogItems']>) { return this.lifeCatalogStore.listDeletedCatalogItems(...args) }
  async restoreCatalogItem(...args: Parameters<LifeCatalogStore['restoreCatalogItem']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCatalogStore.restoreCatalogItem(...args)) }
  async listTaxonomy(...args: Parameters<LifeCatalogStore['listTaxonomy']>) { return this.lifeCatalogStore.listTaxonomy(...args) }
  async createTaxonomy(...args: Parameters<LifeCatalogStore['createTaxonomy']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCatalogStore.createTaxonomy(...args)) }
  async updateTaxonomy(...args: Parameters<LifeCatalogStore['updateTaxonomy']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCatalogStore.updateTaxonomy(...args)) }
  async deleteTaxonomy(...args: Parameters<LifeCatalogStore['deleteTaxonomy']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCatalogStore.deleteTaxonomy(...args)) }
  async restoreTaxonomy(...args: Parameters<LifeCatalogStore['restoreTaxonomy']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCatalogStore.restoreTaxonomy(...args)) }
  async listUnits(...args: Parameters<LifeCatalogStore['listUnits']>) { return this.lifeCatalogStore.listUnits(...args) }
  async createUnit(...args: Parameters<LifeCatalogStore['createUnit']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCatalogStore.createUnit(...args)) }
  async updateUnit(...args: Parameters<LifeCatalogStore['updateUnit']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCatalogStore.updateUnit(...args)) }
  async deleteUnit(...args: Parameters<LifeCatalogStore['deleteUnit']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCatalogStore.deleteUnit(...args)) }
  async restoreUnit(...args: Parameters<LifeCatalogStore['restoreUnit']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCatalogStore.restoreUnit(...args)) }

  async listInventoryBalances(...args: Parameters<LifeInventoryStore['listInventoryBalances']>) { return this.lifeInventoryStore.listInventoryBalances(...args) }
  async listUsableInventoryBalances(...args: Parameters<LifeInventoryStore['listUsableInventoryBalances']>) { return this.lifeInventoryStore.listUsableInventoryBalances(...args) }
  async listInventoryTransactions(...args: Parameters<LifeInventoryStore['listInventoryTransactions']>) { return this.lifeInventoryStore.listInventoryTransactions(...args) }
  async createInventoryTransaction(...args: Parameters<LifeInventoryStore['createInventoryTransaction']>) { return this.withOwnerMutationLock(args[0], () => this.lifeInventoryStore.createInventoryTransaction(...args)) }
  async reverseInventoryTransaction(...args: Parameters<LifeInventoryStore['reverseInventoryTransaction']>) { return this.withOwnerMutationLock(args[0], () => this.lifeInventoryStore.reverseInventoryTransaction(...args)) }
  async listInventoryForecasts(...args: Parameters<LifeInventoryStore['listInventoryForecasts']>) { return this.lifeInventoryStore.listInventoryForecasts(...args) }

  async listRecipes(...args: Parameters<LifeRecipeStore['listRecipes']>) { return this.lifeRecipeStore.listRecipes(...args) }
  async listDeletedRecipes(...args: Parameters<LifeRecipeStore['listDeletedRecipes']>) { return this.lifeRecipeStore.listDeletedRecipes(...args) }
  async getRecipe(...args: Parameters<LifeRecipeStore['getRecipe']>) { return this.lifeRecipeStore.getRecipe(...args) }
  async createRecipe(...args: Parameters<LifeRecipeStore['createRecipe']>) { return this.withOwnerMutationLock(args[0], () => this.lifeRecipeStore.createRecipe(...args)) }
  async previewRecipeImpact(...args: Parameters<LifeRecipeStore['previewRecipeImpact']>) { return this.lifeRecipeStore.previewRecipeImpact(...args) }
  async updateRecipe(...args: Parameters<LifeRecipeStore['updateRecipe']>) { return this.withOwnerMutationLock(args[0], () => this.lifeRecipeStore.updateRecipe(...args)) }
  async deleteRecipe(...args: Parameters<LifeRecipeStore['deleteRecipe']>) { return this.withOwnerMutationLock(args[0], () => this.lifeRecipeStore.deleteRecipe(...args)) }
  async restoreRecipe(...args: Parameters<LifeRecipeStore['restoreRecipe']>) { return this.withOwnerMutationLock(args[0], () => this.lifeRecipeStore.restoreRecipe(...args)) }
  async listRecipeVersions(...args: Parameters<LifeRecipeStore['listRecipeVersions']>) { return this.lifeRecipeStore.listRecipeVersions(...args) }
  async calculateStoredRecipe(...args: Parameters<LifeRecipeStore['calculateStoredRecipe']>) { return this.lifeRecipeStore.calculateStoredRecipe(...args) }
  async listRecipeRelations(...args: Parameters<LifeRecipeStore['listRecipeRelations']>) { return this.lifeRecipeStore.listRecipeRelations(...args) }
  async createCookingSession(...args: Parameters<LifeRecipeStore['createCookingSession']>) { return this.withOwnerMutationLock(args[0], () => this.lifeRecipeStore.createCookingSession(...args)) }
  async getCookingSession(...args: Parameters<LifeRecipeStore['getCookingSession']>) { return this.lifeRecipeStore.getCookingSession(...args) }
  async updateCookingSession(...args: Parameters<LifeRecipeStore['updateCookingSession']>) { return this.withOwnerMutationLock(args[0], () => this.lifeRecipeStore.updateCookingSession(...args)) }
  async promoteCookingNote(...args: Parameters<LifeRecipeStore['promoteCookingNote']>) { return this.withOwnerMutationLock(args[0], () => this.lifeRecipeStore.promoteCookingNote(...args)) }
  async completeCookingSession(...args: Parameters<LifeRecipeStore['completeCookingSession']>) { return this.withOwnerMutationLock(args[0], () => this.lifeRecipeStore.completeCookingSession(...args)) }
  async listPreparedFood(...args: Parameters<LifeRecipeStore['listPreparedFood']>) { return this.lifeRecipeStore.listPreparedFood(...args) }

  async getPlanningCatalogReferences(...args: Parameters<LifePlanningStore['getPlanningCatalogReferences']>) { return this.lifePlanningStore.getPlanningCatalogReferences(...args) }
  async listPlanTemplates(...args: Parameters<LifePlanningStore['listPlanTemplates']>) { return this.lifePlanningStore.listPlanTemplates(...args) }
  async getPlanTemplate(...args: Parameters<LifePlanningStore['getPlanTemplate']>) { return this.lifePlanningStore.getPlanTemplate(...args) }
  async createPlanTemplate(...args: Parameters<LifePlanningStore['createPlanTemplate']>) { return this.withOwnerMutationLock(args[0], () => this.lifePlanningStore.createPlanTemplate(...args)) }
  async updatePlanTemplate(...args: Parameters<LifePlanningStore['updatePlanTemplate']>) { return this.withOwnerMutationLock(args[0], () => this.lifePlanningStore.updatePlanTemplate(...args)) }
  async getDayPlan(...args: Parameters<LifePlanningStore['getDayPlan']>) { return this.lifePlanningStore.getDayPlan(...args) }
  async getDayPlanProjection(...args: Parameters<LifePlanningStore['getDayPlanProjection']>) { return this.lifePlanningStore.getDayPlanProjection(...args) }
  async listDayPlanProjections(...args: Parameters<LifePlanningStore['listDayPlanProjections']>) { return this.lifePlanningStore.listDayPlanProjections(...args) }
  async createDayPlan(...args: Parameters<LifePlanningStore['createDayPlan']>) { return this.withOwnerMutationLock(args[0], () => this.lifePlanningStore.createDayPlan(...args)) }
  async updateDayPlan(...args: Parameters<LifePlanningStore['updateDayPlan']>) { return this.withOwnerMutationLock(args[0], () => this.lifePlanningStore.updateDayPlan(...args)) }
  async previewTemplateApplication(...args: Parameters<LifePlanningStore['previewTemplateApplication']>) { return this.lifePlanningStore.previewTemplateApplication(...args) }
  async applyTemplateToDayPlan(...args: Parameters<LifePlanningStore['applyTemplateToDayPlan']>) { return this.withOwnerMutationLock(args[0], () => this.lifePlanningStore.applyTemplateToDayPlan(...args)) }
  async copyDayPlan(...args: Parameters<LifePlanningStore['copyDayPlan']>) { return this.withOwnerMutationLock(args[0], () => this.lifePlanningStore.copyDayPlan(...args)) }
  async previewTemplateSync(...args: Parameters<LifePlanningStore['previewTemplateSync']>) { return this.lifePlanningStore.previewTemplateSync(...args) }
  async syncPlanTemplate(...args: Parameters<LifePlanningStore['syncPlanTemplate']>) { return this.withOwnerMutationLock(args[0], () => this.lifePlanningStore.syncPlanTemplate(...args)) }
  async previewMedicineRecurrence(...args: Parameters<LifePlanningStore['previewMedicineRecurrence']>) { return this.lifePlanningStore.previewMedicineRecurrence(...args) }
  async listMedicineRecurrenceRules(...args: Parameters<LifePlanningStore['listMedicineRecurrenceRules']>) { return this.lifePlanningStore.listMedicineRecurrenceRules(...args) }
  async createMedicineRecurrenceRule(...args: Parameters<LifePlanningStore['createMedicineRecurrenceRule']>) { return this.withOwnerMutationLock(args[0], () => this.lifePlanningStore.createMedicineRecurrenceRule(...args)) }
  async updateMedicineRecurrenceRule(...args: Parameters<LifePlanningStore['updateMedicineRecurrenceRule']>) { return this.withOwnerMutationLock(args[0], () => this.lifePlanningStore.updateMedicineRecurrenceRule(...args)) }
  async deleteMedicineRecurrenceRule(...args: Parameters<LifePlanningStore['deleteMedicineRecurrenceRule']>) { return this.withOwnerMutationLock(args[0], () => this.lifePlanningStore.deleteMedicineRecurrenceRule(...args)) }
  async transitionMedicineOccurrence(...args: Parameters<LifePlanningStore['transitionMedicineOccurrence']>) { return this.withOwnerMutationLock(args[0], () => this.lifePlanningStore.transitionMedicineOccurrence(...args)) }
  async listCalendar(...args: Parameters<LifePlanningStore['listCalendar']>) { return this.lifePlanningStore.listCalendar(...args) }
  async getPlanningTimeline(...args: Parameters<LifePlanningStore['getPlanningTimeline']>) { return this.lifePlanningStore.getPlanningTimeline(...args) }
  async listFitnessActivities(...args: Parameters<LifePlanningStore['listFitnessActivities']>) { return this.lifePlanningStore.listFitnessActivities(...args) }
  async createFitnessActivity(...args: Parameters<LifePlanningStore['createFitnessActivity']>) { return this.withOwnerMutationLock(args[0], () => this.lifePlanningStore.createFitnessActivity(...args)) }
  async transitionDayPlanItem(...args: Parameters<LifePlanningStore['transitionDayPlanItem']>) { return this.withOwnerMutationLock(args[0], () => this.lifePlanningStore.transitionDayPlanItem(...args)) }
  async createPlanningCompletion(...args: Parameters<LifePlanningStore['createPlanningCompletion']>) { return this.withOwnerMutationLock(args[0], () => this.lifePlanningStore.createPlanningCompletion(...args)) }
  async createPlanningCompletionFromSource(...args: Parameters<LifePlanningStore['createPlanningCompletionFromSource']>) { return this.withOwnerMutationLock(args[0], () => this.lifePlanningStore.createPlanningCompletionFromSource(...args)) }
  async undoPlanningCompletion(...args: Parameters<LifePlanningStore['undoPlanningCompletion']>) { return this.withOwnerMutationLock(args[0], () => this.lifePlanningStore.undoPlanningCompletion(...args)) }

  async listInventoryPolicies(...args: Parameters<LifeCommerceStore['listInventoryPolicies']>) { return this.lifeCommerceStore.listInventoryPolicies(...args) }
  async upsertInventoryPolicy(...args: Parameters<LifeCommerceStore['upsertInventoryPolicy']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCommerceStore.upsertInventoryPolicy(...args)) }
  async recalculateShopping(...args: Parameters<LifeCommerceStore['recalculateShopping']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCommerceStore.recalculateShopping(...args)) }
  async createShoppingSuggestion(...args: Parameters<LifeCommerceStore['createShoppingSuggestion']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCommerceStore.createShoppingSuggestion(...args)) }
  async listShopping(...args: Parameters<LifeCommerceStore['listShopping']>) { return this.lifeCommerceStore.listShopping(...args) }
  async createShoppingItem(...args: Parameters<LifeCommerceStore['createShoppingItem']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCommerceStore.createShoppingItem(...args)) }
  async createPurchase(...args: Parameters<LifeCommerceStore['createPurchase']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCommerceStore.createPurchase(...args)) }
  async createRefund(...args: Parameters<LifeCommerceStore['createRefund']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCommerceStore.createRefund(...args)) }
  async createBudget(...args: Parameters<LifeCommerceStore['createBudget']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCommerceStore.createBudget(...args)) }
  async listBudgetSummaries(...args: Parameters<LifeCommerceStore['listBudgetSummaries']>) { return this.lifeCommerceStore.listBudgetSummaries(...args) }
  async getLifeAnalytics(...args: Parameters<LifeCommerceStore['getLifeAnalytics']>) { return this.lifeCommerceStore.getLifeAnalytics(...args) }
  async createLifeExport(...args: Parameters<LifeCommerceStore['createLifeExport']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCommerceStore.createLifeExport(...args)) }
  async listLifeExports(...args: Parameters<LifeCommerceStore['listLifeExports']>) { return this.lifeCommerceStore.listLifeExports(...args) }
  async previewLifeImport(...args: Parameters<LifeCommerceStore['previewLifeImport']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCommerceStore.previewLifeImport(...args)) }
  async applyLifeImport(...args: Parameters<LifeCommerceStore['applyLifeImport']>) { return this.withOwnerMutationLock(args[0], () => this.lifeCommerceStore.applyLifeImport(...args)) }

  async getState(userId: string): Promise<LifeState> {
    const [planRows, records, reviewRows, evidenceRows, knowledgeResult, snapshotRows] = await Promise.all([
      queryRows<SqlRow>(this.pool, 'SELECT * FROM plans WHERE user_id = ? ORDER BY created_at', [userId]),
      this.recordsStore.listRecords(userId, { includeArchived: true }),
      queryRows<SqlRow>(this.pool, 'SELECT * FROM period_reviews WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at', [userId]),
      queryRows<SqlRow>(this.pool, 'SELECT e.* FROM review_evidence e INNER JOIN period_reviews r ON r.id = e.review_id WHERE r.user_id = ? ORDER BY e.id', [userId]),
      this.knowledgeStore.listKnowledge(userId, { includeArchived: true }),
      queryRows<SqlRow>(this.pool, 'SELECT * FROM public_snapshots WHERE user_id = ? ORDER BY created_at', [userId]),
    ])
    const evidence = new Map<string, ReviewEvidence[]>()
    for (const row of evidenceRows) {
      const key = String(row.review_id)
      const items = evidence.get(key) ?? []
      items.push({ type: row.source_type as 'plan' | 'record', sourceId: String(row.source_id), title: String(row.title), excerpt: String(row.excerpt) })
      evidence.set(key, items)
    }
    return {
      schemaVersion: 1,
      plans: planRows.map((row) => this.mapPlan(row)),
      records,
      reviews: reviewRows.map((row) => this.mapReview(row, evidence.get(String(row.id)) ?? [])),
      knowledge: knowledgeResult.items,
      snapshots: snapshotRows.map((row) => this.mapSnapshot(row)),
    }
  }

  async createPlan(userId: string, input: { title: string; scheduledFor?: string }) {
    const timestamp = this.now()
    const plan: PlanItem = { id: this.createId(), title: clean(input.title, '计划'), scheduledFor: input.scheduledFor || undefined, status: 'planned', createdAt: timestamp, updatedAt: timestamp }
    await this.pool.execute('INSERT INTO plans (id, user_id, title, scheduled_for, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [plan.id, userId, plan.title, plan.scheduledFor ?? null, plan.status, toSqlDateTime(plan.createdAt), toSqlDateTime(plan.updatedAt)])
    return plan
  }
  async completePlan(userId: string, id: string) {
    const timestamp = this.now()
    const [result] = await this.pool.execute<ResultSetHeader>('UPDATE plans SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?', ['done', toSqlDateTime(timestamp), toSqlDateTime(timestamp), id, userId])
    if (!result.affectedRows) return undefined
    const rows = await queryRows<SqlRow>(this.pool, 'SELECT * FROM plans WHERE id = ? AND user_id = ?', [id, userId])
    return this.mapPlan(rows[0])
  }

  async createKnowledge(userId: string, input: { sourceType: 'record' | 'review'; sourceId: string; title: string; body: string; tags?: string[] }) {
    return this.knowledgeStore.createKnowledgeNote(userId, {
      title: input.title,
      body: input.body,
      tags: input.tags,
      sourceLinks: [{ type: input.sourceType, id: input.sourceId }],
    })
  }

  async createSnapshot(userId: string, input: { slug: string; sourceType: SourceType; sourceId: string; title: string; excerpt: string }) {
    const tables: Record<SourceType, string> = { plan: 'plans', record: 'life_records', review: 'period_reviews', knowledge: 'knowledge_notes' }
    const rows = await queryRows<SqlRow>(this.pool, `SELECT id FROM ${tables[input.sourceType]} WHERE id = ? AND user_id = ? LIMIT 1`, [input.sourceId, userId])
    if (!rows[0]) throw new Error('找不到公开快照来源')
    const snapshot: PublicSnapshot = { id: this.createId(), slug: input.slug, source: { type: input.sourceType, id: input.sourceId }, title: clean(input.title, '公开标题'), excerpt: clean(input.excerpt, '公开摘录'), visibility: 'private', createdAt: this.now() }
    await this.pool.execute('INSERT INTO public_snapshots (id, user_id, slug, source_type, source_id, title, excerpt, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [snapshot.id, userId, snapshot.slug, snapshot.source.type, snapshot.source.id, snapshot.title, snapshot.excerpt, snapshot.visibility, toSqlDateTime(snapshot.createdAt)])
    return snapshot
  }
  async publishSnapshot(userId: string, id: string) { return this.updateSnapshot(userId, id, 'public') }
  async revokeSnapshot(userId: string, id: string) { return this.updateSnapshot(userId, id, 'private') }
  async listPublicSnapshots() {
    const rows = await queryRows<SqlRow>(this.pool, "SELECT * FROM public_snapshots WHERE visibility = 'public' AND revoked_at IS NULL ORDER BY published_at DESC, created_at DESC, id ASC")
    return rows.map((row) => this.mapSnapshot(row))
  }
  async getPublicSnapshot(slug: string) {
    const rows = await queryRows<SqlRow>(this.pool, "SELECT * FROM public_snapshots WHERE slug = ? AND visibility = 'public' AND revoked_at IS NULL LIMIT 1", [slug])
    return rows[0] ? this.mapSnapshot(rows[0]) : undefined
  }
  async ping() { await this.pool.query('SELECT 1') }
  async close() { await this.pool.end() }

  private async updateSnapshot(userId: string, id: string, visibility: 'private' | 'public') {
    const timestamp = this.now()
    const sql = visibility === 'public'
      ? 'UPDATE public_snapshots SET visibility = ?, published_at = ?, revoked_at = NULL WHERE id = ? AND user_id = ?'
      : 'UPDATE public_snapshots SET visibility = ?, revoked_at = ? WHERE id = ? AND user_id = ?'
    const [result] = await this.pool.execute<ResultSetHeader>(sql, [visibility, toSqlDateTime(timestamp), id, userId])
    if (!result.affectedRows) return undefined
    const rows = await queryRows<SqlRow>(this.pool, 'SELECT * FROM public_snapshots WHERE id = ? AND user_id = ?', [id, userId])
    return this.mapSnapshot(rows[0])
  }

  private mapUser(row: SqlRow): User { return { id: String(row.id), account: String(row.account), displayName: String(row.display_name), passwordHash: String(row.password_hash), createdAt: iso(row.created_at) } }
  private mapPlan(row: SqlRow): PlanItem { return { id: String(row.id), title: String(row.title), scheduledFor: row.scheduled_for == null ? undefined : String(row.scheduled_for), status: row.status as PlanItem['status'], createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), completedAt: optionalIso(row.completed_at) } }
  private mapReview(row: SqlRow, evidence: ReviewEvidence[]): PeriodReview { return { id: String(row.id), periodStart: String(row.period_start).slice(0, 10), periodEnd: String(row.period_end).slice(0, 10), summary: String(row.summary), insights: parseArray(row.insights), evidence, createdAt: iso(row.created_at) } }
  private mapSnapshot(row: SqlRow): PublicSnapshot { return { id: String(row.id), slug: String(row.slug), source: { type: row.source_type as SourceType, id: String(row.source_id) }, title: String(row.title), excerpt: String(row.excerpt), visibility: row.visibility as 'private' | 'public', createdAt: iso(row.created_at), publishedAt: optionalIso(row.published_at), revokedAt: optionalIso(row.revoked_at) } }
}
