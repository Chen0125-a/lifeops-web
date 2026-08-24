# LifeOps Foundation and Domain Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish migration-safe MySQL domains, versioned Fastify APIs, frontend query/state foundations, and tested CRUD/transaction contracts for the original private domains plus the complete life catalog, recipe, inventory, planning, purchase, budget and analysis foundation.

**Architecture:** Ordered checksum migrations preserve `001_initial.sql` and backfill legacy plans without deletion. Fastify route plugins consume a composed `LifeStore`; MySQL domain stores and a deterministic memory store implement the same contracts. Life forecasts reference current catalog and recipe versions, while confirmed completion/purchase events save immutable snapshots and update inventory/cost through idempotent transactions. Frontend data moves from one monolithic `/state` refresh toward React Query domain resources while compatibility selectors keep existing pages running until their replacement plan lands.

**Tech Stack:** Fastify 5.11.3, MySQL 8.4.10, mysql2 3.23.2, React 19.2.8, TanStack React Query 5.101.4, Motion 12.43.0, TypeScript 7.0.2, Vitest 4.1.10.

## Global Constraints

- Keep `server/migrations/001_initial.sql` byte-for-byte unchanged; new behavior starts at migration 002.
- Existing plans, records, reviews, knowledge and snapshots survive migration and remain owned by the same `user_id`.
- Domain responses include `version`, `createdAt`, `updatedAt`, and nullable `deletedAt` where the model supports recovery.
- Every mutation validates ownership, uses a transaction for cross-table changes, and rejects stale `version` with HTTP 409 `VERSION_CONFLICT`.
- Repeated create requests with the same `Idempotency-Key` and user return the original result, not a duplicate row.
- Memory and MySQL stores run the same contract suite.
- Life plans never decrement actual inventory; only confirmed completion, purchase, return, waste, adjustment and undo events write inventory transactions.
- Future life forecasts use current effective data. Confirmed historical nutrition, cost, recipe and quantity snapshots never change without an explicit audited recalculation.
- Cash expenditure and consumption cost are separate measures and must never be summed into one total.
- Missing nutrition, unit conversion or price data remains `incomplete`; it is never coerced to zero.
- Medicine APIs store user-authored facts, inventory, expiry and schedules only; they expose no diagnosis, dosage recommendation, stop-medication or unverified interaction result.
- Local preview remains explicitly marked; production continues to use real API/MySQL.
- Follow the master plan's Git-or-SHA checkpoint rule after every task.

---

### P1-T1: Ordered migration runner and legacy compatibility

**Files:**
- Create: `server/src/db/migrate.test.ts`
- Modify: `server/src/db/migrate.ts`
- Create: `server/migrations/002_domain_foundation.sql`
- Test: `server/src/mysql.integration.test.ts`
- Create: the next unoccupied project session, selected at task start as `S{max existing numeric session + 1}_基础数据与API.md`; record its exact absolute path in execution-control before the red test and never reuse or overwrite S015/S016 or any later occupied number
- Modify: project `CURRENT.md`

**Interfaces:**
- Produces: `runMigrations(pool: Pool): Promise<AppliedMigration[]>`.
- Produces: `AppliedMigration { version: string; name: string; checksum: string }`.
- Produces tables: `schema_migrations`, `goals`, `projects`, `milestones`, `tasks`, `task_checklist_items`, `task_recurrence_rules`, `schedule_blocks`, `habits`, `habit_schedules`, `habit_entries`, `media_assets`, `audit_events`, `idempotency_keys`.
- Preserves: `plans`, `life_records`, `period_reviews`, `knowledge_notes`, `public_snapshots`.

- [x] **Step 1: Write a failing migration-order/checksum test** using a temporary migration directory and a fake pool that records SQL calls.

```ts
it('applies pending files in numeric order and rejects checksum drift', async () => {
  const first = await runMigrations(pool, { directory: fixtureDir })
  expect(first.map((item) => item.version)).toEqual(['001', '002'])
  await writeFile(join(fixtureDir, '002_second.sql'), 'SELECT 2')
  await expect(runMigrations(pool, { directory: fixtureDir })).rejects.toThrow('MIGRATION_CHECKSUM_MISMATCH')
})
```

- [x] **Step 2: Run the focused test and confirm the old one-file runner fails.**

```powershell
npm.cmd run test:server -- server/src/db/migrate.test.ts
```

Expected: FAIL because `runMigrations` has no directory option, ledger, ordering, or checksum validation.

- [x] **Step 3: Implement ordered discovery, SHA-256 validation, and the migration ledger.**

```ts
export interface AppliedMigration { version: string; name: string; checksum: string }

export async function runMigrations(
  pool: Pool,
  options: { directory?: string } = {},
): Promise<AppliedMigration[]> {
  const directory = options.directory ?? fileURLToPath(new URL('../../migrations/', import.meta.url))
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(16) PRIMARY KEY, name VARCHAR(190) NOT NULL,
    checksum CHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  // Read ^\d{3}_.+\.sql$, sort by version, compare existing checksums,
  // execute every pending statement, then insert its ledger row.
  return applied
}
```

The implementation must reject duplicate numeric prefixes and any changed checksum before executing a pending migration.

- [x] **Step 4: Write `002_domain_foundation.sql` with exact ownership, index, version, and soft-delete columns.**

Use `CHAR(36)` IDs, `BIGINT UNSIGNED NOT NULL DEFAULT 1` versions, `DATETIME(3)` timestamps, `utf8mb4_0900_ai_ci`, foreign keys to `users(id)`, and composite indexes beginning with `user_id`. Backfill legacy plans as tasks with `legacy_plan_id = plans.id`; use `INSERT ... SELECT ... WHERE NOT EXISTS` so reruns are safe. Do not remove or rewrite legacy rows.

- [x] **Step 5: Extend the real MySQL test to prove migration replay and legacy backfill.**

```ts
expect((await rows('SELECT COUNT(*) count FROM tasks WHERE legacy_plan_id = ?', [plan.id]))[0].count).toBe(1)
await runMigrations(pool)
expect((await rows('SELECT COUNT(*) count FROM tasks WHERE legacy_plan_id = ?', [plan.id]))[0].count).toBe(1)
```

- [x] **Step 6: Run migration, server, and MySQL gates.**

```powershell
npm.cmd run test:server -- server/src/db/migrate.test.ts
npm.cmd run test:mysql
npm.cmd run typecheck:server
```

Expected: all pass; MySQL is not skipped.

- [x] **Step 7: Commit or create the SHA-backed P1-T1 checkpoint.**

```powershell
git rev-parse --show-toplevel
```

If it succeeds, commit only the task files with message `feat(api): add ordered domain migrations`. If it fails, generate the execution-completeness specification's sorted allowlisted file/SHA-256 manifest and root SHA-256, create the next unoccupied session selected above with P1-T1 as the active task, and record the same `uncommitted-local-checkpoint` root in that session, execution-control and `CURRENT.md`.

### P1-T2: Query client, API transport, motion provider, and state boundary

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/api/httpClient.ts`
- Create: `src/api/httpClient.test.ts`
- Create: `src/api/queryClient.ts`
- Create: `src/api/queryKeys.ts`
- Create: `src/components/system/AppMotionProvider.tsx`
- Create: `src/components/system/AppMotionProvider.test.tsx`
- Create: `src/components/system/AsyncStateBoundary.tsx`
- Create: `src/components/system/AsyncStateBoundary.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `http.request<T>(path, options): Promise<T>` with CSRF, abort, JSON and typed errors.
- Produces: `queryClient`, `queryKeys`, `<AppMotionProvider>`, `<AsyncStateBoundary>`.
- `AsyncStateBoundary` states: `loading | ready | empty | saving | saved | forbidden | network-error | conflict | deleted | disconnected`.

- [x] **Step 1: Add exact dependencies and lock them.**

```powershell
npm.cmd install --save-exact motion@12.43.0 @tanstack/react-query@5.101.4
```

Verify both exact versions appear in `package.json` and `package-lock.json`.

- [x] **Step 2: Write failing transport tests** for CSRF headers, `AbortSignal`, 409 conflict decoding, 204 responses, and request IDs.

```ts
await expect(http.request('/goals/1', { method: 'PATCH', csrf: 'token', body: { version: 1 } }))
  .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409, requestId: 'req-7' })
```

- [x] **Step 3: Write failing motion/state tests.**

```tsx
render(<AppMotionProvider><Probe /></AppMotionProvider>)
expect(screen.getByTestId('motion-config')).toHaveAttribute('data-reduced-motion', 'user')

render(<AsyncStateBoundary state="network-error" onRetry={retry}><p>content</p></AsyncStateBoundary>)
await user.click(screen.getByRole('button', { name: '重试' }))
expect(retry).toHaveBeenCalledOnce()
```

- [x] **Step 4: Run focused tests and verify missing-module failures.**

```powershell
npm.cmd test -- src/api/httpClient.test.ts src/components/system/AppMotionProvider.test.tsx src/components/system/AsyncStateBoundary.test.tsx
```

- [x] **Step 5: Implement transport, query defaults, motion and state components.**

```ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
})
```

```tsx
export function AppMotionProvider({ children }: PropsWithChildren) {
  return <MotionConfig reducedMotion="user" transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
    <div data-testid="motion-config" data-reduced-motion="user">{children}</div>
  </MotionConfig>
}
```

`AsyncStateBoundary` must preserve its allocated layout, put actionable errors beside the failed region, and never replace a ready page with a full-screen spinner during background refresh.

- [x] **Step 6: Wrap the app in QueryClientProvider and AppMotionProvider without removing AuthProvider.**

- [x] **Step 7: Run frontend regression gates.**

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

- [x] **Step 8: Commit or hash the P1-T2 files** with commit message `refactor(web): add query motion and state foundations` when Git exists; otherwise record exact SHA-256 values in the active session.

### P1-T3: Goals, projects, and milestones domain

**Files:**
- Create: `server/src/domain/goals.ts`
- Modify: `server/src/store/lifeStore.ts`
- Create: `server/src/store/memory/goalsMemoryStore.ts`
- Create: `server/src/store/mysql/goalsMySqlStore.ts`
- Create: `server/src/routes/goals.ts`
- Create: `server/src/routes/goals.test.ts`
- Modify: `server/src/app.ts`
- Create: `src/domain/goals.ts`
- Create: `src/api/goalsApi.ts`
- Create: `src/api/goalsApi.test.ts`

**Interfaces:**
- `Goal { id, title, description, status, priority, startsOn, targetOn, progressMode, manualProgress, version, createdAt, updatedAt, deletedAt }`.
- `Project { id, goalId, title, description, riskNote, status, startsOn, targetOn, progress, nextTaskId, version, createdAt, updatedAt, deletedAt }`.
- `Milestone { id, projectId, title, dueOn, completedAt, position, version }`.
- Routes: `GET/POST /api/v1/goals`, `GET/PATCH/DELETE /goals/:id`, explicit `POST /goals/:id/restore`, and equivalent project/milestone endpoints. ADR-025 assigns the additive compatibility work to active P3-T2 through `011_goal_hierarchy_recovery.sql`; applied migrations 001–010 remain immutable, and every archive/restore pair uses owner/version checks plus linked compensating reversal `audit_events`.

- [x] **Step 1: Write the store contract and failing route tests** for create, list, patch with version, pause, complete, soft-delete, ownership isolation and milestone ordering.

```ts
const created = await owner.inject({ method: 'POST', url: '/api/v1/goals', headers: writeHeaders('goal-create-1'), payload: { title: '完成 LifeOps', priority: 1 } })
expect(created.statusCode).toBe(201)
const stale = await owner.inject({ method: 'PATCH', url: `/api/v1/goals/${created.json().id}`, headers: writeHeaders(), payload: { title: '冲突写入', version: 0 } })
expect(stale.statusCode).toBe(409)
```

- [x] **Step 2: Run focused server tests and verify 404/missing-route failures.**

```powershell
npm.cmd run test:server -- server/src/routes/goals.test.ts
```

- [x] **Step 3: Implement deterministic domain validation and both stores.** Progress mode accepts `manual | task-ratio | milestone-ratio`; priority accepts `1 | 2 | 3`; completed goals cannot accept new active projects until reopened.

- [x] **Step 4: Register routes with shared authentication, CSRF and idempotency.** Every query passes `auth.user.id`; DELETE sets `deleted_at` and increments `version`.

- [x] **Step 5: Write failing frontend API tests and implement `goalsApi`.**

```ts
export const goalsApi = {
  list: (signal?: AbortSignal) => http.request<Goal[]>('/goals', { signal }),
  create: (input: CreateGoalInput, idempotencyKey: string) => http.request<Goal>('/goals', { method: 'POST', body: input, idempotencyKey }),
  update: (id: string, input: UpdateGoalInput) => http.request<Goal>(`/goals/${id}`, { method: 'PATCH', body: input }),
}
```

- [x] **Step 6: Run focused, server, MySQL and frontend type gates.**

```powershell
npm.cmd run test:server -- server/src/routes/goals.test.ts
npm.cmd run test:mysql
npm.cmd run typecheck:server
npm.cmd test -- src/api/goalsApi.test.ts
npm.cmd run typecheck
```

- [x] **Step 7: Commit or hash P1-T3** with message `feat(goals): add goal project milestone contracts`.

### P1-T4: Tasks, recurrence, checklist, and schedule blocks

**Files:**
- Create: `server/src/domain/tasks.ts`
- Create: `server/src/domain/tasks.test.ts`
- Modify: `server/src/store/lifeStore.ts`
- Create: `server/src/store/memory/tasksMemoryStore.ts`
- Create: `server/src/store/mysql/tasksMySqlStore.ts`
- Create: `server/src/routes/tasks.ts`
- Create: `server/src/routes/tasks.test.ts`
- Create: `src/domain/tasks.ts`
- Create: `src/domain/tasks.test.ts`
- Create: `src/api/tasksApi.ts`

**Interfaces:**
- `TaskStatus = 'inbox' | 'planned' | 'doing' | 'done' | 'skipped' | 'cancelled'`.
- `Task` includes goal/project, title, description, start/end/due, estimateMinutes, priority, tags, status, checklist, recurrence, version and timestamps.
- `RecurrenceRule { frequency: 'daily'|'weekly'|'monthly'; interval; weekdays; monthDay; until }`.
- `ScheduleBlock { id, taskId, startsAt, endsAt, version }`.
- Produces: `expandRecurrence(rule, window): Occurrence[]` and `detectScheduleConflicts(blocks): Conflict[]`.

- [x] **Step 1: Write failing pure-domain tests** for weekly weekdays, month-end clamping, recurrence end date, overlapping blocks and exact-boundary non-conflict.

```ts
expect(expandRecurrence({ frequency: 'weekly', interval: 1, weekdays: [1, 3] }, { from: '2026-08-10', to: '2026-08-16' }))
  .toEqual([{ date: '2026-08-10' }, { date: '2026-08-12' }])
```

- [x] **Step 2: Write failing route/store tests** for CRUD, checklist ordering, complete/undo, schedule move/resize, keyboard-equivalent PATCH payload, idempotency and ownership.

- [x] **Step 3: Run focused tests and verify failures.**

```powershell
npm.cmd run test:server -- server/src/domain/tasks.test.ts server/src/routes/tasks.test.ts
npm.cmd test -- src/domain/tasks.test.ts
```

- [x] **Step 4: Implement domain functions, memory/MySQL stores and routes.** Route set: `/tasks`, `/tasks/:id`, `/tasks/:id/complete`, `/tasks/:id/checklist`, `/schedule-blocks`, `/schedule/conflicts`.

- [x] **Step 5: Implement frontend contracts/API and compatibility mapping.** Legacy `PlanItem` becomes a read-only compatibility projection of backfilled `Task` until P3 replaces old pages; writes use task routes.

- [x] **Step 6: Run domain, API, MySQL and type gates.**

```powershell
npm.cmd run test:server -- server/src/domain/tasks.test.ts server/src/routes/tasks.test.ts
npm.cmd run test:mysql
npm.cmd test -- src/domain/tasks.test.ts
npm.cmd run typecheck
npm.cmd run typecheck:server
```

- [x] **Step 7: Commit or hash P1-T4** with message `feat(tasks): add schedule recurrence and conflict domain`.

### P1-T5: Habits and rhythm entries

**Files:**
- Create: `server/migrations/003_habit_goal_project_links.sql`, `server/src/domain/habits.ts`
- Create: `server/src/domain/habits.test.ts`
- Modify: `server/src/store/lifeStore.ts`
- Create: `server/src/store/memory/habitsMemoryStore.ts`
- Create: `server/src/store/mysql/habitsMySqlStore.ts`
- Create: `server/src/routes/habits.ts`
- Create: `server/src/routes/habits.test.ts`
- Create: `src/domain/habits.ts`
- Create: `src/api/habitsApi.ts`

**Interfaces:**
- `Habit` carries nullable `goalId`/`projectId` links validated within the same owner; `HabitMeasure = 'boolean' | 'count' | 'duration' | 'quantity'`.
- `HabitEntryStatus = 'done' | 'partial' | 'intentional-skip' | 'missed'`.
- `HabitSchedule` supports daily, selected weekdays, times-per-week and custom interval.
- Produces: `getHabitExpectation(habit, date)` and `summarizeHabitWindow(entries, expectation)`.

- [x] **Step 1: Write failing expectation/statistics tests** for each schedule type, partial completion, intentional skip, pause interval and timezone-local date boundaries.
- [x] **Step 2: Write failing route tests** for create, edit, pause, archive, entry upsert, entry correction, user isolation, valid nullable goal/project links, cross-user/wrong-level rejection and clearing an existing link.
- [x] **Step 3: Run focused tests and verify missing behavior.**

```powershell
npm.cmd run test:server -- server/src/domain/habits.test.ts server/src/routes/habits.test.ts
```

- [x] **Step 4: Implement the additive 003 migration plus domain/store/routes and return 28-day matrix-ready responses.** `GET /habits?from&to` returns habits plus entries, never fabricated missed rows; the client derives missed status from expectation and current date.
- [x] **Step 5: Implement frontend contracts/API and query keys.**
- [x] **Step 6: Run server, MySQL and frontend type gates.**

```powershell
npm.cmd run test:server -- server/src/domain/habits.test.ts server/src/routes/habits.test.ts
npm.cmd run test:mysql
npm.cmd run typecheck:server
npm.cmd run typecheck
```

- [x] **Step 7: Commit or hash P1-T5** with message `feat(habits): add rhythm schedules and entries`.

### P1-T6: Records, autosave versions, and authenticated media

**Files:**
- Create: `server/migrations/004_records_media.sql`
- Create: `server/src/media/storagePort.ts`
- Create: `server/src/media/fileSystemStorage.ts`
- Create: `server/src/media/fileSystemStorage.test.ts`
- Modify: `server/src/store/lifeStore.ts`
- Create: `server/src/store/mysql/recordsMySqlStore.ts`
- Create: `server/src/routes/records.ts`
- Create: `server/src/routes/media.ts`
- Create: `server/src/routes/records.test.ts`
- Modify: `server/src/config.ts`
- Create: `src/domain/records.ts`
- Create: `src/api/recordsApi.ts`
- Create: `src/api/mediaApi.ts`

**Interfaces:**
- `LifeRecord` gains Markdown body, pin/archive/soft-delete, version, updatedAt and generic links to task/project/goal/habit.
- ADR-026 extends this closed P1 contract additively in active P3-T5: `coverMediaId: string | null` is persisted through `012_record_cover_identity.sql`; applied 001–011 remain immutable. Create defaults to null; PATCH omit preserves, null clears and non-null selects only a same-owner image already in `mediaIds`; removing the active cover without same-request clear/replacement fails atomically and never weakens private-media authorization.
- `MediaAsset { id, ownerId, visibility, mimeType, originalName, size, storageKey, width, height, createdAt }`.
- Upload route: `POST /api/v1/media` multipart field `file`; read routes: authenticated `/media/:id`, public `/public/media/:id` only for media linked to a published revision.

- [x] **Step 1: Install and lock the multipart plugin.**

```powershell
npm.cmd --prefix server install --save-exact @fastify/multipart@10.1.0
```

- [x] **Step 2: Write failing storage tests** for random keys, path traversal rejection, 10MiB limit, allowed JPEG/PNG/WebP/GIF MIME signatures, SVG rejection, missing file and atomic write.

```ts
await expect(storage.put({ originalName: '../x.png', mimeType: 'image/png', bytes: pngBytes }))
  .resolves.toMatchObject({ storageKey: expect.stringMatching(/^[a-f0-9]{2}\/[a-f0-9-]+\.png$/) })
```

- [x] **Step 3: Write failing records/media route tests** for create, autosave PATCH with version, filters, archive, soft-delete/restore, upload ownership and public denial.
- [x] **Step 4: Run focused tests and verify failures.**

```powershell
npm.cmd run test:server -- server/src/media/fileSystemStorage.test.ts server/src/routes/records.test.ts
```

- [x] **Step 5: Implement config, storage adapter, SQL store and routes.** Filesystem root comes from `LIFEOPS_MEDIA_ROOT`; use `open(..., 'wx')`, never trust client paths, and delete stored bytes only after the database transaction confirms no live reference.
- [x] **Step 6: Implement frontend record/media API contracts** with upload progress represented as `queued | uploading | stored | failed`; browser object URLs are revoked after preview.
- [x] **Step 7: Run server, MySQL and frontend gates.**

```powershell
npm.cmd run test:server -- server/src/media/fileSystemStorage.test.ts server/src/routes/records.test.ts
npm.cmd run test:mysql
npm.cmd run typecheck:server
npm.cmd run typecheck
```

- [x] **Step 8: Commit or hash P1-T6** with message `feat(records): add versioned records and private media`.

### P1-T7: Evidence-based reviews and action conversion

**Files:**
- Create: `server/migrations/005_reviews.sql`
- Create: `server/src/domain/reviews.ts`
- Create: `server/src/domain/reviews.test.ts`
- Modify: `server/src/store/lifeStore.ts`
- Create: `server/src/store/mysql/reviewsMySqlStore.ts`
- Create: `server/src/routes/reviews.ts`
- Create: `server/src/routes/reviews.test.ts`
- Create: `src/domain/reviews.ts`
- Create: `src/api/reviewsApi.ts`

**Interfaces:**
- `ReviewType = 'weekly' | 'monthly' | 'custom'`.
- `Review` includes period, status, achievements, problems, causes, insights, nextChanges, evidence, actions, version and timestamps.
- `ReviewActionTarget = 'task' | 'goal-update' | 'knowledge' | 'public-draft'`.
- Produces deterministic `buildReviewEvidence(state, period)` and transactional `convertReviewAction(reviewId, actionId, target)`.

- [x] **Step 1: Write failing evidence tests** proving period boundaries, task/habit/record totals, intentional skips, prior commitments and zero-data periods.
- [x] **Step 2: Write failing route tests** for draft autosave, archive/delete/restore, evidence refresh, version conflicts and one-time action conversion.
- [x] **Step 3: Run focused tests and verify failures.**

```powershell
npm.cmd run test:server -- server/src/domain/reviews.test.ts server/src/routes/reviews.test.ts
```

- [x] **Step 4: Implement review calculations, store and routes.** Evidence values are computed from persisted facts; narrative fields are user-authored and never generated as fake insights.
- [x] **Step 5: Implement frontend contracts/API and invalidate review, task, goal and knowledge query keys after conversions.**
- [x] **Step 6: Run focused, MySQL and type gates.**

```powershell
npm.cmd run test:server -- server/src/domain/reviews.test.ts server/src/routes/reviews.test.ts
npm.cmd run test:mysql
npm.cmd run typecheck:server
npm.cmd run typecheck
```

- [x] **Step 7: Commit or hash P1-T7** with message `feat(reviews): add evidence reviews and action conversion`.

### P1-T8: Life catalog, units, price history, taxonomy, trash, and medicine safety

**Files:**
- Create: `server/migrations/006_life_catalog.sql`
- Create: `server/src/domain/life/catalog.ts`
- Create: `server/src/domain/life/catalog.test.ts`
- Create: `server/src/routes/lifeCatalog.ts`
- Create: `server/src/routes/lifeCatalog.test.ts`
- Create: `server/src/store/lifeCatalogStore.ts`
- Create: `server/src/store/mysql/mysqlLifeCatalogStore.ts`
- Create: `server/src/store/memory/memoryLifeCatalogStore.ts`
- Modify: `server/src/store/lifeStore.ts`
- Modify: `server/src/app.ts`
- Create: `src/domain/lifeCatalog.ts`
- Create: `src/api/lifeCatalogApi.ts`
- Create: `src/api/lifeCatalogApi.test.ts`

**Interfaces:**
- Produces `LifeItemKind = 'ingredient' | 'supplement' | 'medicine' | 'household_consumable' | 'household_durable'`, stable category/tag/location IDs, effective-dated `PricePoint`, and `UnitConversionResult = { status: 'complete'; baseQuantity: number } | { status: 'incomplete'; reason: 'missing_conversion' | 'cross_dimension' }`.
- Produces user-scoped CRUD, batch mutation, soft-delete/restore and impact-preview routes under `/api/v1/life/catalog`, `/api/v1/life/taxonomy`, `/api/v1/life/units` and `/api/v1/life/trash`.
- Medicine response contracts contain user-authored schedule text and inventory facts only; no recommendation field exists.

- [x] **Step 1: Write failing catalog domain and route tests.** Cover fixed kilogram/gram, jin/gram and litre/millilitre conversions; item-specific egg/box/package conversions; cross-dimension rejection without density; effective price selection; nutrition `incomplete`; category cycle rejection; batch tag/category changes; soft delete/restore; and medicine payload rejection when a recommendation field is supplied.
- [x] **Step 2: Run the red tests.**

```powershell
npm.cmd run test:server -- server/src/domain/life/catalog.test.ts server/src/routes/lifeCatalog.test.ts
```

Expected: behavioral failures because the catalog contracts, routes and migration do not exist; a module-resolution or MySQL-connection failure is not an acceptable red result.

- [x] **Step 3: Add migration 006 and catalog contracts.** Create user-scoped items/profiles, category tree, tags, item-tag links, locations, units, item conversions, price history, attachments metadata and trash references with foreign keys, unique constraints, `version`, timestamps and nullable `deleted_at`.
- [x] **Step 4: Implement deterministic conversions, effective-price selection and data-completeness results.** Never coerce missing nutrition, price or conversion to zero.
- [x] **Step 5: Implement memory/MySQL stores and Fastify routes.** All batch writes use one transaction, category moves reject descendant cycles, stale versions return `VERSION_CONFLICT`, and delete impact previews list recipe/template/future-plan references without reading another user's data.
- [x] **Step 6: Add frontend contracts/API and focused cache invalidation for item, taxonomy, unit and trash keys.**
- [x] **Step 7: Run focused, MySQL and type gates.**

```powershell
npm.cmd run test:server -- server/src/domain/life/catalog.test.ts server/src/routes/lifeCatalog.test.ts
npm.cmd run test:mysql
npm.cmd run typecheck:server
npm.cmd run typecheck
```

- [x] **Step 8: Commit or hash P1-T8** with message `feat(life): add catalog units taxonomy and medicine boundaries`.

### P1-T9: Inventory batches, immutable ledger, forecasts, and idempotent reversal

**Files:**
- Create: `server/migrations/007_life_inventory.sql`
- Create: `server/src/domain/life/inventory.ts`
- Create: `server/src/domain/life/inventory.test.ts`
- Create: `server/src/routes/lifeInventory.ts`
- Create: `server/src/routes/lifeInventory.test.ts`
- Create: `server/src/store/lifeInventoryStore.ts`
- Create: `server/src/store/mysql/mysqlLifeInventoryStore.ts`
- Create: `server/src/store/memory/memoryLifeInventoryStore.ts`
- Modify: `server/src/store/lifeStore.ts`
- Modify: `server/src/app.ts`
- Create: `src/domain/lifeInventory.ts`
- Create: `src/api/lifeInventoryApi.ts`

**Interfaces:**
- Consumes catalog item IDs, base units, conversions and price points from P1-T8.
- Produces append-only `InventoryTransactionKind = 'purchase' | 'consume' | 'return' | 'waste' | 'adjustment' | 'reversal'`, optional batches, calculated balances and `InventoryForecast { onHand; plannedDemand; projectedBalance; shortage; suggestedPurchase }`.
- Produces `/api/v1/life/inventory/balances`, `/transactions`, `/forecasts` and `/transactions/:id/reverse` with `Idempotency-Key` support.

- [x] **Step 1: Write failing inventory tests.** Cover purchase/consume/return/waste/adjustment, earliest-expiry batch selection, negative inventory with a reconciliation warning, duplicate idempotency keys returning the original event, reversal exactly once, planned demand not changing actual balance, minimum-stock buffer and package rounding.
- [x] **Step 2: Run the red tests.**

```powershell
npm.cmd run test:server -- server/src/domain/life/inventory.test.ts server/src/routes/lifeInventory.test.ts
```

- [x] **Step 3: Add migration 007 and inventory contracts.** Store batches and append-only transactions; calculate balance from transactions or a transactionally maintained projection that can be rebuilt and verified from the ledger.
- [x] **Step 4: Implement transactional memory/MySQL stores and routes.** Idempotency is scoped by user and operation; reversal points to the original transaction and a second reversal is rejected or returns the first result.
- [x] **Step 5: Implement forecasts from current stock, non-expired batches, future demand, minimum line and outstanding shopping quantity.** Missing conversions produce an incomplete forecast and never subtract an invented quantity.
- [x] **Step 6: Add frontend contracts/API and run focused, MySQL and type gates.**

```powershell
npm.cmd run test:server -- server/src/domain/life/inventory.test.ts server/src/routes/lifeInventory.test.ts
npm.cmd run test:mysql
npm.cmd run typecheck:server
npm.cmd run typecheck
```

- [x] **Step 7: Commit or hash P1-T9** with message `feat(life): add idempotent inventory ledger and forecasts`.

### P1-T10: Recipe versions, calculations, cooking sessions, and prepared-food stock

**Files:**
- Create: `server/migrations/008_life_recipes.sql`
- Create: `server/src/domain/life/recipes.ts`
- Create: `server/src/domain/life/recipes.test.ts`
- Create: `server/src/routes/lifeRecipes.ts`
- Create: `server/src/routes/lifeRecipes.test.ts`
- Create: `server/src/store/lifeRecipeStore.ts`
- Create: `server/src/store/mysql/mysqlLifeRecipeStore.ts`
- Create: `server/src/store/memory/memoryLifeRecipeStore.ts`
- Modify: `server/src/store/lifeStore.ts`
- Modify: `server/src/app.ts`
- Create: `src/domain/lifeRecipes.ts`
- Create: `src/api/lifeRecipesApi.ts`

**Interfaces:**
- Consumes catalog conversions/prices/nutrition and the inventory transaction port.
- Produces immutable `RecipeVersion`, derived `RecipeCalculation` with explicit completeness, bidirectional ingredient-recipe queries, `CookingSession`, `CookingCompletionSnapshot` and `PreparedFoodStock`.
- Produces `/api/v1/life/recipes`, `/versions`, `/relations`, `/cooking-sessions` and `/prepared-food` routes.

- [x] **Step 1: Write failing recipe tests.** Cover per-dish/per-serving calculations, item-specific unit conversion, missing-data completeness, proportional and ingredient-locked scaling, version diff, future latest-version lookup, pinned version, ingredient-to-recipe/reverse relation, cooking-note promotion, and four-made/one-eaten leaving three prepared portions.
- [x] **Step 2: Run the red tests.**

```powershell
npm.cmd run test:server -- server/src/domain/life/recipes.test.ts server/src/routes/lifeRecipes.test.ts
```

- [x] **Step 3: Add migration 008, recipe/version/component/step/cooking/prepared-food models and deterministic calculations.** Nutrition and cost remain derived for future views; completion stores the resolved snapshot.
- [x] **Step 4: Implement recipe CRUD, impact preview and version promotion.** Editing ingredients, standard quantities, servings or steps creates a version; a cooking note remains session-only until an explicit promote request.
- [x] **Step 5: Implement one cooking-completion transaction.** It writes the completion snapshot, consumes actual ingredient batches, creates prepared-food stock for remaining portions and never counts uneaten portions in daily intake.
- [x] **Step 6: Implement bidirectional relation queries and frontend contracts/API.** Return list-ready data even when graph layout is unavailable.
- [x] **Step 7: Run focused, MySQL and type gates.**

```powershell
npm.cmd run test:server -- server/src/domain/life/recipes.test.ts server/src/routes/lifeRecipes.test.ts
npm.cmd run test:mysql
npm.cmd run typecheck:server
npm.cmd run typecheck
```

- [x] **Step 8: Commit or hash P1-T10** with message `feat(life): add recipe versions cooking and prepared stock`.

### P1-T11: Day plans, templates, supplements, medicines, fitness, and completion snapshots

**Files:**
- Create: `server/migrations/009_life_planning.sql`
- Create: `server/src/domain/life/planning.ts`
- Create: `server/src/domain/life/planning.test.ts`
- Create: `server/src/routes/lifePlanning.ts`
- Create: `server/src/routes/lifePlanning.test.ts`
- Create: `server/src/store/lifePlanningStore.ts`
- Create: `server/src/store/mysql/mysqlLifePlanningStore.ts`
- Create: `server/src/store/memory/memoryLifePlanningStore.ts`
- Modify: `server/src/store/lifeStore.ts`
- Modify: `server/src/app.ts`
- Create: `src/domain/lifePlanning.ts`
- Create: `src/api/lifePlanningApi.ts`

**Interfaces:**
- Consumes recipe versions, catalog items, inventory forecasts and prepared-food stock.
- Produces `LifePlanItemKind = 'meal' | 'supplement' | 'medicine' | 'fitness' | 'custom'`, plan templates, date plans, recurrence rules, bounded owner-scoped/versioned medicine occurrences, copy/apply/sync conflict previews, merged calendar/date timeline summaries, fitness activities and immutable completion snapshots.
- Produces `/api/v1/life/calendar`, `/day-plans`, `/templates`, `/fitness` and `/completions` routes. Calendar/date reads merge day-plan items with active occurrences without copying recurrence rows into day-plan JSON; completion accepts exactly one discriminated day-plan-item or medicine-occurrence source.

- [x] **Step 1: Write failing planning tests.** Cover custom meal slots, template apply without overwriting, merge/replace/skip conflict choices, explicit future sync, date copy excluding actuals, meal-linked supplement time, medicine recurrence without medical advice, fitness duration calculation, complete/skip/delay/backfill states, and undo restoring exactly one inventory event.
- [x] **Step 2: Run the red tests.**

```powershell
npm.cmd run test:server -- server/src/domain/life/planning.test.ts server/src/routes/lifePlanning.test.ts
```

- [x] **Step 3: Add migration 009 and planning contracts.** Templates, date plans, bounded medicine occurrences and completions are separate tables; a template application records origin but date edits stay independent. Completion snapshots use a database-enforced discriminated source and occurrence identity is unique by owner/rule/original date/time.
- [x] **Step 4: Implement conflict preview/apply/copy/sync and merged calendar/date timeline summaries.** Calendar marks planned, complete, past-incomplete and conflicted dates from persisted day-plan plus active occurrence facts; occurrence-only dates remain reachable without eager day-plan JSON writes.
- [x] **Step 5: Implement supplement/medicine/fitness scheduling and transactional completion/undo.** Rule create/update/delete reconciles only future incomplete occurrences in the rule transaction; past and terminal history stays frozen. Occurrence completion/undo reuses the immutable snapshot and inventory reversal ledger, is owner/version/idempotency safe, and restores `planned` only when the current rule still contains the occurrence. Fitness uses user-authored kcal/hour and actual minutes; medicine output stays factual.
- [x] **Step 6: Implement future nutrition/cost/inventory projections with source references and completeness status.** Completed records read their stored snapshot.
- [x] **Step 7: Add frontend contracts/API and run focused, MySQL and type gates.** Cover discriminated occurrence reads/completion, reconciliation, owner isolation, version conflicts, retry idempotency, consistent-snapshot transaction reads and Memory/MySQL parity.

```powershell
npm.cmd run test:server -- server/src/domain/life/planning.test.ts server/src/routes/lifePlanning.test.ts
npm.cmd run test:mysql
npm.cmd run typecheck:server
npm.cmd run typecheck
```

- [x] **Step 8: Commit or hash P1-T11** with message `feat(life): add templates day plans and unified completion`.

### P1-T12: Shopping, purchases, budgets, analytics, backup, and transactional restore

**Files:**
- Create: `server/migrations/010_life_commerce.sql`
- Create: `server/src/domain/life/commerce.ts`
- Create: `server/src/domain/life/commerce.test.ts`
- Create: `server/src/routes/lifeCommerce.ts`
- Create: `server/src/routes/lifeCommerce.test.ts`
- Create: `server/src/routes/lifePortability.ts`
- Create: `server/src/routes/lifePortability.test.ts`
- Create: `server/src/store/lifeCommerceStore.ts`
- Create: `server/src/store/mysql/mysqlLifeCommerceStore.ts`
- Create: `server/src/store/memory/memoryLifeCommerceStore.ts`
- Modify: `server/src/store/lifeStore.ts`
- Modify: `server/src/app.ts`
- Create: `src/domain/lifeCommerce.ts`
- Create: `src/api/lifeCommerceApi.ts`

**Interfaces:**

ADR-024 approved file additions: modify `server/src/store/lifeCatalogStore.ts`, `server/src/store/lifeInventoryStore.ts`, `server/src/store/lifePlanningStore.ts`, `server/src/store/memory/memoryLifeCatalogStore.ts`, `server/src/store/memory/memoryLifeCommerceStore.ts`, `server/src/store/mysql/mysqlLifeCatalogStore.ts` and `server/src/store/mysql/mysqlLifeCommerceStore.ts`; any further path must be explained before it is retained.
- Consumes versioned owner inventory policies, catalog units/conversions, inventory ledger/batches, day-plan demand, formal open shopping, catalog price history, completion snapshots and taxonomy.
- Produces deduplicated shopping suggestions, formal shopping items, purchase/partial purchase/refund transactions, separate `CashExpenditure` and `ConsumptionCost`, scoped budgets, drill-down analytics and versioned export/import preview jobs.
- Produces `/api/v1/life/inventory-policies`, `/shopping/recalculate`, `/shopping`, `/purchases`, `/budgets`, `/analytics`, `/exports` and `/imports` routes.

- [x] **Step 1: Write failing commerce tests.** Cover suggestion deduplication with multiple reasons, minimum-stock/package rounding, formal-list separation, partial purchase, purchase transaction closing stock/spend/price/list, refund reversal, cash-versus-consumption separation, budget thresholds/forecast, missing-day versus zero, drill-down source IDs, export checksum, import conflict preview and all-or-nothing rollback.
- [x] **Step 2: Run the red tests.**

```powershell
npm.cmd run test:server -- server/src/domain/life/commerce.test.ts server/src/routes/lifeCommerce.test.ts server/src/routes/lifePortability.test.ts
```

- [x] **Step 3: Add migration 010 and commerce/portability contracts.** Shopping reasons are child facts of one user/item suggestion; purchase and refund rows retain actual quantity, unit, amount and effective dates.
- [x] **Step 4: Implement inventory policy plus shopping, purchase, refund and budget transactions.** Persist one versioned owner policy per item with non-negative minimum stock, positive package quantity and explicit compatible unit. `POST /shopping/recalculate` requires an inclusive `through` date and idempotency key; from one consistent owner snapshot it derives future incomplete day-plan demand, effective usable inventory and outstanding formal open/partial shopping, converts them to the policy unit, applies `max(0, demand + minimum - stock - outstanding)` and package rounding, then atomically replaces only system-derived suggestions/reasons while preserving manual suggestions and formal/history rows. Missing conversion returns incomplete without an invented write. Confirming a purchase writes purchase, cash expenditure, inventory and optional current-price update atomically; partial purchase leaves the remainder open.
- [x] **Step 5: Implement analytics aggregations and trace drill-down.** Results distinguish planned/actual/incomplete/no-record and never merge cash expenditure with consumption cost.
- [x] **Step 6: Implement versioned ZIP/JSON export and import preview/transaction.** Exclude credentials, sessions and secrets; create a restore point before a destructive replace; any row failure rolls back the import.
- [x] **Step 7: Add frontend contracts/API and run focused, MySQL and type gates.**

```powershell
npm.cmd run test:server -- server/src/domain/life/commerce.test.ts server/src/routes/lifeCommerce.test.ts server/src/routes/lifePortability.test.ts
npm.cmd run test:mysql
npm.cmd run typecheck:server
npm.cmd run typecheck
```

- [x] **Step 8: Commit or hash P1-T12** with message `feat(life): add shopping budgets analytics and portable data`.

### P1-T13: Foundation regression, compatibility proof, and ledger closure

**Files:**
- Modify: `server/src/mysql.integration.test.ts`
- Modify: `server/src/app.test.ts`
- Modify: `src/api/lifeApi.test.ts`
- Modify: `docs/traceability/requirements.md`
- Modify: project `CURRENT.md`
- Modify: the exact P1 implementation session path reserved and recorded by P1-T1 in execution-control

**Interfaces:**
- Produces current evidence for DATA-01; the API/store portions of GOAL-01, SCHEDULE-01, HABIT-01, RECORD-01 and REVIEW-01; and the P1/API portions of LIFE-02 through LIFE-19, LIFE-22 and LIFE-24.

- [x] **Step 1: Add real-MySQL journeys** that (a) create a legacy plan, migrate, read the backfilled task, create goal/project/task/habit/record/review and reconnect; and (b) create an ingredient with units/prices and a versioned inventory policy, a recipe, template/day plan, completion, prepared-food remainder, derive a through-date shopping suggestion from future incomplete demand and ledger stock, partially purchase it, recalculate only the remaining rounded shortage, perform refund and export/import preview, then reconnect and prove balances, snapshots, separate cost measures, user isolation and preservation of manual suggestions/formal rows.
- [x] **Step 2: Add API compatibility assertions** that old `/state`, `/plans` and snapshot reads remain available until replacement clients are complete, while new writes use domain routes.
- [x] **Step 3: Run the complete Plan 1 gate.**

```powershell
npm.cmd test
npm.cmd run test:server
npm.cmd run test:mysql
npm.cmd run typecheck
npm.cmd run typecheck:server
npm.cmd run build
npm.cmd run build:server
```

Expected: every command exits 0; MySQL suite reports executed tests, not skipped tests.

- [x] **Step 4: Populate the traceability ledger** with P1 task statuses, exact commands, test counts, changed-file hashes/commits and known external state. DATA-01 can be `verified-local`; applicable LIFE rows become `api-complete/ui-pending`; UI and real-cluster evidence remain open.
- [x] **Step 5: Update the reserved P1 implementation session and CURRENT** with the exact next action `P2-T1 public destination model and orbit geometry test` and no cluster claims.
- [x] **Step 6: Commit or hash P1-T13** with message `test(api): close foundation compatibility gate`.

## Plan 1 Self-Review

- Spec coverage: migration preservation, user isolation, versions, idempotency, goals, schedule, habits, records/media, reviews, life catalog, units, prices, inventory, recipes, plans, completions, prepared stock, shopping, budgets, analytics and portability all have store, route, frontend contract and test tasks.
- Placeholder scan: each behavior step names exact types, routes, states, limits and commands; no deferred implementation phrase remains.
- Type consistency: `version` is numeric, ownership is `user_id`, recurrence/habit/life-plan/status unions match across server and frontend interfaces, inventory events are append-only, cash and consumption costs remain distinct, and old plans are compatibility projections only.
- Scope: Plan 1 stops after the tested data/API foundation; it does not create unfinished final pages.
