# LifeOps Private Core Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the thin private workspace with a bright, layered, fully functional overview, goals, schedule, habits, records, reviews, and complete life operations workspace backed by the Plan 1 domain APIs.

**Architecture:** A stable `PrivateAppLayout` owns top navigation, Motion-scoped route continuity and global overlays while each domain feature owns its page, hooks, calculations and stylesheet. The life workspace adds one exact secondary command strip, corner calendar overlay and task-specific canvases without adding a second app shell. React Query caches domain resources; mutations update or invalidate only affected keys. Pages use asymmetric continuous canvases, embedded bands and persistent inspectors rather than a generic panel/card abstraction. Private Motion never owns the public astrolabe/login subtree, and CSS never competes for the same transform.

**Tech Stack:** React 19.2.8, React Router 7.18.2, Motion 12.43.0, TanStack React Query 5.101.4, TypeScript 7.0.2, CSS/SVG, Vitest, Testing Library, Playwright.

## Global Constraints

- Default private route is `/app/overview`; `/app`, `/app/today` and `/app/plans` redirect without losing valid deep links.
- Top navigation is exactly `总览｜目标与项目｜日程｜习惯｜记录｜回顾｜知识｜生活｜发布｜平台` plus search, quick create and account/settings.
- Private background stays bright. No planet, orbit, galaxy, dark NOC theme, left sidebar, right-angle paper sheet, or equal-card wall may remain.
- Blue means planning/time, warm yellow goal/focus, green habits/rhythm, purple review/knowledge, orange warning; red is reserved for destructive or critical state.
- Base tokens are fixed to surface `#FBFDFC`, canvas `#F3F8F5`, wash `#EAF1ED`, line `#CCD9D3`, strong-line `#7B9186`, quiet `#63716C`, secondary `#52625D` and ink `#17211E`; Noto Sans SC Variable is the only product typeface, body copy is at least 16px and controls at least 14px.
- The stable shell does not remount across routes; private Motion uses feedback 120ms, local state 180ms, task region 240ms and task-layer enter/exit 320/220ms, with directional reverse return and no spring/bounce spectacle.
- Every detail/editor preserves scroll, filters, selection and unsaved state where the approved spec requires it.
- All core data comes from Plan 1 APIs; a UI is incomplete until create, read, edit, archive/delete/restore and error/conflict behavior work.
- Mobile uses task-priority layers, never a simple stack of desktop cards.
- Life screens distinguish forecast from actual, cash expenditure from consumption cost, missing data from zero, and system suggestions from a user-confirmed shopping list.
- Details, cooking mode and calendar overlays always expose close/back without requiring a scroll to the page top.
- Every private route must survive 1440×900, 1024×768, 768×1024 and 390×844, 200% zoom and 320 CSS px reflow with 44px targets, visible focus and WCAG 2.2 AA contrast.
- Overview plus the goals/outcome workspace is the private golden slice. It must pass the five-axis whole-page veto before schedule, habits, records or reviews replicate its language. Life today plus unified inventory/library is a second domain slice before recipe/planning/commerce replication.
- Follow the master plan's Git-or-SHA checkpoint rule after every task.

---

### P3-T1: Stable private shell and layered overview

**Files:**
- Create: `src/components/private/PrivateAppLayout.tsx`
- Create: `src/components/private/PrivateAppLayout.test.tsx`
- Replace: `src/components/private/WorkspaceHeader.tsx`
- Create: `src/components/system/RouteStage.tsx`
- Create: `src/components/system/RouteStage.test.tsx`
- Create: `src/features/overview/OverviewPage.tsx`
- Create: `src/features/overview/OverviewPage.test.tsx`
- Create: `src/features/overview/overviewModel.ts`
- Create: `src/features/overview/overviewModel.test.ts`
- Create: `src/styles/private-shell.css`
- Create: `src/styles/overview.css`
- Modify: `src/App.tsx`
- Delete after passing tests: `src/components/private/PrivateUniverseLayout.tsx`
- Delete after passing tests: `src/components/private/PrivateUniverseLayout.test.tsx`

**Interfaces:**
- Produces `<PrivateAppLayout />`, `<RouteStage routeKey direction>`, `/app/overview` and compatibility redirects.
- `buildOverviewModel({ goals, projects, tasks, habits, entries, records, reviews, knowledge, now })` returns status strip, today timeline, top goals, habit week, trends, recent records, prior insight and resurfaced knowledge.

- [x] **Step 1: Write failing shell tests** for exact top nav, stable shell, `/app/overview`, search/quick-add/account controls, no universe language/markup and focus movement after navigation.

```tsx
expect(screen.getByRole('navigation', { name: '私人空间导航' })).toHaveTextContent('总览目标与项目日程习惯记录回顾知识生活发布平台')
expect(screen.queryByText(/星球|银河|轨道/)).not.toBeInTheDocument()
```

- [x] **Step 2: Write failing overview-model tests** for empty state, current timeline, three priority goals, seven-day habit cells, deterministic week totals, most recent review insight and due knowledge ordering.
- [x] **Step 3: Write failing overview component tests** for the 7/5 primary layout, top status strip, localized component error and actionable empty states.
- [x] **Step 4: Run focused tests and verify failures.**

```powershell
npm.cmd test -- src/components/private/PrivateAppLayout.test.tsx src/components/system/RouteStage.test.tsx src/features/overview/overviewModel.test.ts src/features/overview/OverviewPage.test.tsx
```

- [x] **Step 5: Implement the stable shell and route stage.** Use React Router `NavLink`, `useNavigationType` for forward/back direction and Motion `AnimatePresence mode="popLayout"`; do not enable Router View Transitions. Route focus moves to `<h1 tabIndex={-1}>` only after the stable header has announced the destination, and interrupted back/forward motion resolves from the current visual state.
- [x] **Step 6: Implement the overview as one continuous 12-column canvas.** Status strip spans 12 columns; today occupies 7, goals 5; habit, trend, record, review and knowledge bands share edges instead of equal cards. Platform health is truthful `healthy|degraded|disconnected|unknown` data, never a random percentage.
- [x] **Step 7: Add precise redirects**: `/app` and `/app/today` → `/app/overview`; `/app/plans` → `/app/schedule`; `/app/snapshots` → `/app/publish`.
- [x] **Step 8: Run focused and frontend gates, then delete old layout only when green.**

```powershell
npm.cmd test -- src/components/private/PrivateAppLayout.test.tsx src/features/overview/OverviewPage.test.tsx
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

- [x] **Step 9: Commit or hash P3-T1** with message `feat(app): add stable daylight shell and overview`.

### P3-T2: Goals and projects outcome map

**Files:**
- Create: `src/features/goals/useGoals.ts`
- Create: `src/features/goals/GoalsPage.tsx`
- Create: `src/features/goals/GoalsPage.test.tsx`
- Create: `src/features/goals/OutcomeMap.tsx`
- Create: `src/features/goals/OutcomeMap.test.tsx`
- Create: `src/features/goals/GoalInspector.tsx`
- Create: `src/features/goals/GoalEditor.tsx`
- Create: `src/styles/goals.css`
- Modify: `src/App.tsx`
- Create: `server/migrations/011_goal_hierarchy_recovery.sql`
- Modify: `server/src/domain/goals.ts`
- Modify: `server/src/store/memory/goalsMemoryStore.ts`
- Modify: `server/src/store/mysql/goalsMySqlStore.ts`
- Modify: `server/src/routes/goals.ts`
- Modify: `server/src/routes/goals.test.ts`
- Modify: `server/src/mysql.integration.test.ts`
- Modify: `src/domain/goals.ts`
- Modify: `src/api/goalsApi.ts`
- Modify: `src/api/goalsApi.test.ts`

**Interfaces:**
- Produces `/app/goals` and nested selection through `?goal=<id>&project=<id>`.
- `useGoals()` returns `{ goals, projects, milestones, status, createGoal, updateGoal, archiveGoal, restoreGoal, createProject, updateProject, archiveProject, restoreProject, createMilestone, updateMilestone, completeMilestone, archiveMilestone, restoreMilestone }`.
- `OutcomeMap` receives a date range and emits selection/edit callbacks; it does not own network state.
- Project create/update/read persists an independent `riskNote`; every goal/project/milestone restore keeps the same ID, requires the archived version and owner, invalidates the complete hierarchy and writes a compensating reversal audit event linked to the archive event it reverses.

- [x] **Step 1: Write failing hook tests** for list loading, optimistic version update, 409 conflict rollback, archive/restore and query invalidation.
- [x] **Step 2: Write failing page tests** for top-three priorities, quarterly progress, 8/4 outcome map/inspector, milestone/current-date bands, stalled/overdue/no-next-action groups and full editor fields.

```tsx
expect(screen.getByRole('heading', { name: '目标与项目' })).toBeVisible()
expect(screen.getByTestId('outcome-map')).toHaveAttribute('data-layout', 'timeline')
expect(screen.getByRole('region', { name: '需要处理的项目' })).toHaveTextContent('缺少下一步')
```

- [x] **Step 3: Run focused tests and verify missing-feature failures.**

```powershell
npm.cmd test -- src/features/goals
```

- [x] **Step 4: Add the ADR-025 contract RED, then implement the additive compatibility slice, query hook and editors.** First write and run server/frontend API/Memory/MySQL behavior tests for independent project `riskNote`, same-ID owner/version restore, archive→restore audited reversal linkage, stale/cross-owner rejection and failed-operation rollback. Only after valid RED, add migration 011 and the domain/store/routes/API implementation. Required editor fields remain title, description, priority, dates, status and progress mode; project adds goal, next task and risk note; milestone adds project, due date and order.
- [x] **Step 5: Implement OutcomeMap as accessible SVG/HTML hybrid.** Time coordinates derive from dates; each bar has a keyboard-focusable corresponding row and inspector action. Motion layout identity is local to the private subtree and active only while navigating to an object detail; no CSS `view-transition-name` participates.
- [x] **Step 6: Implement mobile goal → project → milestone → next-action layering** using a full-screen inspector with fixed back/save controls.
- [x] **Step 7: Run focused, frontend and goals API regression gates.**

```powershell
npm.cmd test -- src/features/goals
npm.cmd test -- src/api/goalsApi.test.ts
npm.cmd run test:server -- server/src/routes/goals.test.ts
npm.cmd run test:mysql
npm.cmd run typecheck:server
npm.cmd run typecheck
```

- [x] **Step 8: Pass the private golden-slice browser gate before P3-T3 begins.** Open overview and goals/outcome map at all four required viewports, 200% zoom and 320 CSS px reflow. Exercise keyboard-only navigation, empty/loading/error/offline/403/409 states, inspectors, mobile task layers, browser back, scroll/focus restoration and reduced motion. Save and open screenshots plus route/inspector filmstrips and reject generic dashboard composition, equal cards, false metrics, inaccessible charts, clipped task layers or unexplained animation work.

- [x] **Step 9: Commit or hash P3-T2** with message `feat(goals): complete private golden slice and outcome map`.

### P3-T3: Week schedule, task pool, drag and keyboard scheduling

**Files:**
- Create: `src/features/schedule/useSchedule.ts`
- Create: `src/features/schedule/SchedulePage.tsx`
- Create: `src/features/schedule/SchedulePage.test.tsx`
- Create: `src/features/schedule/WeekCalendar.tsx`
- Create: `src/features/schedule/WeekCalendar.test.tsx`
- Create: `src/features/schedule/TaskPool.tsx`
- Create: `src/features/schedule/TaskEditor.tsx`
- Create: `src/features/schedule/dragSchedule.ts`
- Create: `src/features/schedule/dragSchedule.test.ts`
- Create: `src/styles/schedule.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces `/app/schedule?view=day|week|month&date=YYYY-MM-DD`.
- `minutesToGridPosition`, `gridPositionToMinutes`, `moveScheduleBlock`, `resizeScheduleBlock` are pure functions.
- Drag and keyboard operations both call `scheduleTask(taskId, startsAt, endsAt, version)` and expose one undo token.

- [x] **Step 1: Write failing coordinate tests** for 15-minute snapping, timezone-local week, minimum 15-minute duration, crossing-midnight rejection and exact undo state.
- [x] **Step 2: Write failing calendar/page tests** for default week view, today/week/month controls, project/status filters, today/due/unscheduled/overdue pools, overload/conflict warnings and empty-state actions.
- [x] **Step 3: Write failing accessibility tests** proving a focused task can be scheduled with Enter, arrow keys and a confirm button without drag.
- [x] **Step 4: Run focused tests and confirm failures.**

```powershell
npm.cmd test -- src/features/schedule
```

- [x] **Step 5: Implement query hook, pure scheduling functions and task editor.** Editor fields exactly match Plan 1 task contract, including checklist and recurrence; field errors remain next to their inputs.
- [x] **Step 6: Implement pointer drag/resize with transform-only preview.** Commit one API mutation on pointer release; conflict response keeps the preview and offers `恢复原时间` or `选择新时间`.
- [x] **Step 7: Implement mobile single-day default** with horizontal date strip, bottom task pool and full-screen editor; month view becomes an agenda list below 768px.
- [x] **Step 8: Run schedule, task API and frontend gates.**

```powershell
npm.cmd test -- src/features/schedule
npm.cmd run test:server -- server/src/domain/tasks.test.ts server/src/routes/tasks.test.ts
npm.cmd run typecheck
```

- [x] **Step 9: Commit or hash P3-T3** with message `feat(schedule): add week calendar and task pool`.

### P3-T4: Habit rhythm matrix

**Files:**
- Create: `src/features/habits/useHabits.ts`
- Create: `src/features/habits/HabitsPage.tsx`
- Create: `src/features/habits/HabitsPage.test.tsx`
- Create: `src/features/habits/HabitMatrix.tsx`
- Create: `src/features/habits/HabitMatrix.test.tsx`
- Create: `src/features/habits/HabitInspector.tsx`
- Create: `src/features/habits/HabitEditor.tsx`
- Create: `src/styles/habits.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces `/app/habits` with `?habit=<id>` selection.
- Matrix cell statuses: `not-expected | future | done | partial | intentional-skip | missed`.
- `useHabits({ from, to })` exposes CRUD, pause/archive, and `upsertEntry`.

- [x] **Step 1: Write failing component tests** for today's habits, 28-day grid, all six cell states, selected-habit statistics, linked goal/project and no badge/flame/coin copy.
- [x] **Step 2: Write failing interaction tests** for boolean toggle, numeric value, duration, quantity unit, partial state, intentional skip reason, edit, pause and archive.
- [x] **Step 3: Run focused tests and verify failures.**

```powershell
npm.cmd test -- src/features/habits
```

- [x] **Step 4: Implement query hook, editor and matrix.** Each cell is a button with a full accessible label such as `阅读，8月9日，部分完成 20/30 分钟`; color is never the only status channel.
- [x] **Step 5: Implement right-side inspector statistics** from deterministic domain summaries: completed expected days, partial total, intentional skips and trend; do not call consecutive missed days a streak failure.
- [x] **Step 6: Implement mobile today list plus seven-day horizontal matrix** and open the full 28-day view on demand without tiny cells.
- [x] **Step 7: Run habit API/domain and frontend gates.**

```powershell
npm.cmd test -- src/features/habits
npm.cmd run test:server -- server/src/domain/habits.test.ts server/src/routes/habits.test.ts
npm.cmd run typecheck
```

- [x] **Step 8: Commit or hash P3-T4** with message `feat(habits): build non-gamified rhythm matrix`.

### P3-T5: Record stream, Markdown editor, links, and media

**Files:**
- Create: `server/migrations/012_record_cover_identity.sql`
- Create: `server/src/domain/records.test.ts`
- Modify: `server/src/domain/types.ts`
- Modify: `server/src/domain/records.ts`
- Modify: `server/src/store/memoryLifeStore.ts`
- Modify: `server/src/store/mysql/recordsMySqlStore.ts`
- Modify: `server/src/routes/records.ts`
- Modify: `server/src/routes/records.test.ts`
- Modify: `server/src/mysql.integration.test.ts`
- Create: `src/components/system/MarkdownView.tsx`
- Create: `src/components/system/MarkdownView.test.tsx`
- Modify: `src/domain/records.ts`
- Modify: `src/api/recordsApi.ts`
- Modify: `src/api/recordsApi.test.ts`
- Create: `src/features/records/useRecords.ts`
- Create: `src/features/records/RecordsPage.tsx`
- Create: `src/features/records/RecordsPage.test.tsx`
- Create: `src/features/records/RecordStream.tsx`
- Create: `src/features/records/RecordEditor.tsx`
- Create: `src/features/records/useAutosave.ts`
- Create: `src/features/records/useAutosave.test.tsx`
- Create: `src/features/records/MediaUploader.tsx`
- Create: `src/styles/records.css`
- Create: `tests/records.spec.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces `/app/records?record=<id>&from=&to=&tag=&source=&q=`.
- `LifeRecord.coverMediaId: string | null` is a persisted display identity, not array position: create defaults to `null`; PATCH omission preserves; explicit `null` clears; non-null selects only a same-owner image already included in that record's `mediaIds`. Removing an active cover must clear or replace it in the same versioned transaction, and cover identity never changes private-media authorization.
- The page decodes one `source=<goal|project|task|habit>:<non-empty-id>` exactly once and splits at the first colon, preserving later colons in the ID. Empty means no source filter; valid values map only to existing `linkType + linkId`; malformed or duplicate values show a scoped filter error and send no malformed request, with no table inference or fallback.
- `useAutosave({ value, version, save, delay: 800 })` states `idle | dirty | saving | saved | conflict | offline` and stores one encrypted-at-rest claim nowhere; local draft uses session-local IndexedDB/plain browser storage only with an explicit privacy note.
- `MarkdownView` renders GFM through a sanitization schema and blocks unsafe URL protocols.

- [x] **Step 1: Install exact Markdown dependencies.**

```powershell
npm.cmd install --save-exact react-markdown@10.1.0 remark-gfm@4.0.1 rehype-sanitize@6.0.0
```

- [x] **Step 2: Write failing Markdown security tests** for script, iframe, event attributes, `javascript:` URL, safe table/task list and external link `rel="noreferrer noopener"`.
- [x] **Step 3: Write failing autosave tests** using fake timers for 800ms debounce, save state, offline draft, unmount flush, stale version conflict and no duplicate save.
- [x] **Step 4: Write failing page and record-contract tests** for date-grouped stream, filters, selected editor, linked objects, image/cover, pin/archive/delete/restore, task-to-record source and private-by-default behavior. Add independent frontend/domain/API/Memory/MySQL expectations for cover create default, PATCH omit/clear/select, owner/media-set validation, active-cover removal atomicity, unchanged private authorization, legal `source=` parsing/mapping and malformed/duplicate request suppression.
- [x] **Step 5: Run focused tests and verify failures.**

```powershell
npm.cmd test -- src/components/system/MarkdownView.test.tsx src/features/records
npm.cmd test -- src/api/recordsApi.test.ts
npm.cmd run test:server -- server/src/domain/records.test.ts server/src/routes/records.test.ts
npm.cmd run test:mysql
```

- [x] **Step 6: Implement sanitized Markdown, autosave and editor.** Show `保存中`, timestamped `已保存`, `离线草稿`, or conflict actions beside the editor; never rely only on toast.
- [x] **Step 7: Implement media upload** with preview, progress, retry, remove and cover selection; object URLs are revoked and private media URLs are never placed in public Markdown automatically.
- [x] **Step 8: Implement mobile stream → full-screen editor** with fixed back/save state and unsaved-leave confirmation.
- [x] **Step 9: Run record/media API, official isolated MySQL 8.4.10, frontend, dual type/build and real Chromium gates.** Inspect 1440×900, 1024×768, 768×1024, 390×844, 200% text zoom and 320 CSS px reflow; cover normal/error states, keyboard/focus/Back, normal/reduced Motion, autosave/offline/409, upload retry/removal, archive/delete/restore and private denial. Open every final screenshot and applicable trace/filmstrip before closing.

```powershell
npm.cmd test -- src/components/system/MarkdownView.test.tsx src/features/records
npm.cmd test -- src/api/recordsApi.test.ts src/api/mediaApi.test.ts
npm.cmd run test:server -- server/src/domain/records.test.ts server/src/routes/records.test.ts server/src/media/fileSystemStorage.test.ts
npm.cmd run test:mysql
npm.cmd run typecheck:server
npm.cmd run typecheck
npm.cmd run build:server
npm.cmd run build
npm.cmd run test:e2e -- tests/records.spec.ts --project=chromium
```

- [x] **Step 10: Commit or hash P3-T5** with message `feat(records): add contextual record stream and autosave editor`.

### P3-T6: Evidence review workspace and action conversion

**Files:**
- Create: `src/features/reviews/useReviews.ts`
- Create: `src/features/reviews/ReviewsPage.tsx`
- Create: `src/features/reviews/ReviewsPage.test.tsx`
- Create: `src/features/reviews/EvidenceRail.tsx`
- Create: `src/features/reviews/ReviewEditor.tsx`
- Create: `src/features/reviews/ReviewActions.tsx`
- Create: `src/styles/reviews.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces `/app/reviews?review=<id>&period=weekly|monthly|custom`.
- `useReviews` exposes create draft, autosave, refresh evidence, archive/delete/restore and convert action.
- Three desktop regions use 3/6/3 columns; mobile order is evidence → writing → action.

- [x] **Step 1: Write failing page tests** for weekly/monthly/custom modes, deterministic evidence groups, achievements/problems/causes/insights/next changes, autosave status and prior commitments.
- [x] **Step 2: Write failing conversion tests** for action → task, goal update, knowledge draft and public draft; a converted action cannot create a second target.
- [x] **Step 3: Run focused tests and verify failures.**

```powershell
npm.cmd test -- src/features/reviews
```

- [x] **Step 4: Implement the 3/6/3 workspace.** Evidence rail filters by source but never edits facts; editor owns narrative; action rail shows destination, result link and conversion status.
- [x] **Step 5: Implement autosave/conflict/error states** using the shared autosave/state components and keep evidence visible if saving narrative fails.
- [x] **Step 6: Implement mobile ordered layers** with progress navigation `证据 1/3`, `书写 2/3`, `行动 3/3` and fixed back/continue controls.
- [x] **Step 7: Run reviews API/domain and frontend gates.**

```powershell
npm.cmd test -- src/features/reviews
npm.cmd run test:server -- server/src/domain/reviews.test.ts server/src/routes/reviews.test.ts
npm.cmd run typecheck
```

- [x] **Step 8: Commit or hash P3-T6** with message `feat(reviews): build evidence narrative action workspace`.

### P3-T7: Original private-core responsive, transitions, state failure journeys, and visual review

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/private-shell.css`
- Modify: domain styles created in P3-T1 through P3-T6
- Create: `tests/private-overview.spec.ts`
- Create: `tests/goals-schedule-habits.spec.ts`
- Create: `tests/records-reviews.spec.ts`
- Modify: `tests/responsive-accessibility.spec.ts`
- Modify: `tests/visual-capture.spec.ts`

**Interfaces:**
- Produces visual evidence for APP-01, GOAL-01, SCHEDULE-01, HABIT-01, RECORD-01, REVIEW-01, MOTION-01, SPACE-01 and STATE-01.

- [x] **Step 1: Write failing E2E journeys** for every CRUD/edit/archive/restore path, schedule drag and keyboard path, all habit states, record autosave/media and review action conversion.
- [x] **Step 2: Add transition assertions** that the header node remains mounted, the outgoing route is present during exit, the new `<h1>` receives focus, browser back restores query/filter/scroll, and no full-page white frame appears in a 60fps video trace.
- [x] **Step 3: Add failure-route fixtures** for 403, 409, 500, offline and delayed response; assert only the affected module changes state and retry is available.
- [x] **Step 4: Run the focused E2E set and confirm failures before final CSS/behavior fixes.**

```powershell
npm.cmd run test:e2e -- tests/private-overview.spec.ts tests/goals-schedule-habits.spec.ts tests/records-reviews.spec.ts
```

- [x] **Step 5: Complete desktop/tablet/mobile CSS** at 1440×900, 1024×768, 768×1024 and 390×844. Reject any first screen with equal floating cards, large unused half-pages, clipped fixed actions, tiny charts or horizontal overflow.
- [x] **Step 6: Capture named screenshots** for every page at desktop and mobile plus overview/tablet, and normal/reduced route and inspector filmstrips. Open each artifact and record pass/fail against visual identity, page-native structure, data/state truth, accessibility, performance/motion, hierarchy, color semantics, soft-volume depth and content density.
- [x] **Step 7: Run the original private-core interim gate.** Life routes are not closed until P3-T13 and P3-T14.

```powershell
npm.cmd test
npm.cmd run test:server
npm.cmd run test:mysql
npm.cmd run typecheck
npm.cmd run typecheck:server
npm.cmd run build
npm.cmd run build:server
npm.cmd run test:e2e -- tests/private-overview.spec.ts tests/goals-schedule-habits.spec.ts tests/records-reviews.spec.ts tests/responsive-accessibility.spec.ts
npm.cmd run test:e2e:remote
```

- [x] **Step 8: Commit or hash P3-T7** with message `test(app): lock private core responsive and motion acceptance`.

### P3-T8: Life workspace shell, today dashboard, and corner calendar

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/private/WorkspaceHeader.tsx`
- Modify: `src/features/overview/OverviewPage.tsx`
- Create: `src/features/life/LifeLayout.tsx`
- Create: `src/features/life/LifeSubnav.tsx`
- Create: `src/features/life/LifeTodayPage.tsx`
- Create: `src/features/life/LifeTodayPage.test.tsx`
- Create: `src/features/life/LifeCalendarOverlay.tsx`
- Create: `src/features/life/LifeCalendarPage.tsx`
- Create: `src/features/life/LifeCalendar.test.tsx`
- Create: `src/features/life/useLifeDay.ts`
- Create: `src/styles/life-shell.css`

**Interfaces:**
- Consumes P1-T11 calendar/day-plan/completion projections and P1-T12 budget/shopping summaries.
- Produces stable `/app/life` and `/app/life/calendar` routes, the exact secondary navigation `今日｜计划｜食谱｜库存｜健身｜采购｜分析｜数据`, an always-available calendar trigger and global-overview life summary. `库存` routes to the unified `/app/life/ingredients` item/inventory workspace rather than creating a duplicate route surface.

- [x] **Step 1: Write failing component/router tests.** Assert the exact main and life navigation orders, inventory route mapping, compact overview summary, today timeline state distinctions, forecast/actual nutrition and cost labels, incomplete-data copy, calendar markers, date selection, copy-without-actuals, focus trap, Esc/close and browser-back restoration.
- [x] **Step 2: Run the red tests.**

```powershell
npm.cmd test -- src/features/life/LifeTodayPage.test.tsx src/features/life/LifeCalendar.test.tsx
```

- [x] **Step 3: Add routes and stable shell without remounting `PrivateAppLayout`.** The life secondary command strip exists only inside the life domain and does not become a global left sidebar.
- [x] **Step 4: Implement the asymmetric today canvas.** Timeline is primary; nutrition/budget are secondary; inventory/action notices elevate only when actionable. No data becomes an explicit next step instead of sample content.
- [x] **Step 5: Implement the anchored calendar overlay and full calendar page.** Desktop uses month plus date summary; mobile uses month then summary with a visible back gesture/control. Opening, closing and rapid date changes are interruptible.
- [x] **Step 6: Run focused tests, typecheck and build.**

```powershell
npm.cmd test -- src/features/life/LifeTodayPage.test.tsx src/features/life/LifeCalendar.test.tsx
npm.cmd run typecheck
npm.cmd run build
```

- [x] **Step 7: Commit or hash P3-T8** with message `feat(life): add today workspace and calendar entry`.

### P3-T9: Life catalog libraries, taxonomy, batches, medicine, household, and trash

**Files:**
- Modify: `server/src/domain/life/catalog.ts`
- Modify: `server/src/domain/life/catalog.test.ts`
- Modify: `server/src/routes/lifeCatalog.ts`
- Modify: `server/src/routes/lifeCatalog.test.ts`
- Modify: `server/src/store/mysql/mysqlLifeCatalogStore.ts`
- Modify: `server/src/mysql.integration.test.ts`
- Modify: `src/domain/lifeCatalog.ts`
- Modify: `src/api/lifeCatalogApi.test.ts`
- Create: `src/features/life/catalog/LifeCatalogPage.tsx`
- Create: `src/features/life/catalog/LifeCatalogPage.test.tsx`
- Create: `src/features/life/catalog/ItemEditor.tsx`
- Create: `src/features/life/catalog/UnitConversionEditor.tsx`
- Create: `src/features/life/catalog/TaxonomyTree.tsx`
- Create: `src/features/life/catalog/InventoryLedger.tsx`
- Create: `src/features/life/medicines/MedicinesPage.tsx`
- Create: `src/features/life/household/HouseholdPage.tsx`
- Create: `src/features/life/data/TrashWorkspace.tsx`
- Create: `src/styles/life-catalog.css`

**Interfaces:**
- Consumes P1-T8 catalog/taxonomy/unit/trash APIs and P1-T9 balance/batch/forecast APIs.
- ADR-027 extends the P1-T8 catalog contract additively with one item-kind-discriminated supplement/household factual `profile`, persisted through the existing `life_item_profiles.profile_data JSON` without a migration.
- Produces `/app/life/ingredients`, `/medicines`, `/household` and the trash portion of `/data` with full CRUD, batch edits, impact preview and restore.

- [x] **Step 1: Write failing library tests.** Cover ingredient/supplement tabs, user-defined nutrition fields, package and item conversions, missing conversion error, price history, simple/batch inventory, category/location drag plus keyboard alternative, cycle rejection, batch selection, medicine factual copy, consumable/durable household fields, category value labels, batch change preview, soft delete and relationship-safe restore.
- [x] **Step 2: Run the red tests.**

```powershell
npm.cmd test -- src/features/life/catalog src/features/life/medicines src/features/life/household src/features/life/data
```

- [x] **Step 3: Implement task-specific library canvases.** A collapsible taxonomy tree may support the current library, but the private app shell stays top-navigation based. Lists support dense data without becoming a grid of equal cards.
- [x] **Step 4: Implement editors, bulk selection, impact previews and undo.** Destructive actions name affected recipes/templates/future plans; permanent delete is unavailable until the API says references are safe.
- [x] **Step 5: Implement medicine safety and privacy copy.** There is no recommendation, interaction diagnosis or suggested-dose control; user-authored instructions are visibly identified as such.
- [x] **Step 6: Run focused tests, typecheck and build.**

```powershell
npm.cmd test -- src/features/life/catalog src/features/life/medicines src/features/life/household src/features/life/data
npm.cmd run typecheck
npm.cmd run build
```

- [x] **Step 7: Pass the life-domain golden-slice gate before P3-T10 begins.** Open life today, calendar and unified inventory/library at all four viewports, 200% zoom and 320 CSS px reflow. Exercise missing/partial/forecast/actual/offline/conflict states, dense taxonomy, batch and medicine fact paths, keyboard alternatives, mobile task layers, focus/back restoration and reduced motion. Save and open the visual/filmstrip evidence and apply all five veto axes.

- [x] **Step 8: Commit or hash P3-T9** with message `feat(life): complete inventory golden slice and connected libraries`.

**Additional declared Files used by P3-T9:** Modify `.gitignore`, `playwright.life.config.ts`, `src/App.tsx`, `src/features/life/LifeTodayPage.test.tsx`, `src/styles/index.css` and `tests/public-final.spec.ts`; create `.finesse/log.json` (local design audit, ignored by Git/source checkpoint) and `tests/life-catalog-p3-t9.spec.ts`.

### P3-T10: Recipe library, cooking mode, growth history, and bidirectional composition view

**Files:**
- Create: `src/features/life/recipes/RecipesPage.tsx`
- Create: `src/features/life/recipes/RecipesPage.test.tsx`
- Create: `src/features/life/recipes/RecipeEditor.tsx`
- Create: `src/features/life/recipes/RecipeInspector.tsx`
- Create: `src/features/life/recipes/CookingMode.tsx`
- Create: `src/features/life/recipes/RecipeRelations.tsx`
- Create: `src/features/life/recipes/RecipeVersionDiff.tsx`
- Create: `src/styles/life-recipes.css`

**Interfaces:**
- Consumes P1-T10 recipe/cooking/prepared-food APIs and catalog/inventory lookups.
- Produces `/app/life/recipes`, route-addressable inspectors, list/graph relationship modes and cooking completion flows.

- [x] **Step 1: Write failing recipe UI tests.** Cover draft creation, multi-ingredient selection, unit error, step reorder/keyboard controls, serving scaling, calculation completeness, version-impact preview, pinned version, cooking progress persistence, actual-quantity confirmation, leftover portions, session-only note, promote-to-version, ingredient→recipes and recipe→ingredients navigation, and list fallback for a dense graph.
- [x] **Step 2: Run the red tests.**

```powershell
npm.cmd test -- src/features/life/recipes
```

- [x] **Step 3: Implement the recipe index/editor/inspector as one continuous task space.** Desktop inspector expands from the selected recipe; mobile uses a dismissible task layer and restores the original list/filter position.
- [x] **Step 4: Implement cooking mode with visible exit, timers, actual quantities and completion preview.** Completion clearly names inventory to consume, portions eaten, prepared-food remainder, nutrition and cost before submission.
- [x] **Step 5: Implement relation list/graph modes.** Graph nodes are interactive but never the only access path; “can make now”, “missing one item” and “use expiring stock” are query-driven facts.
- [x] **Step 6: Run focused tests, typecheck and build.**

```powershell
npm.cmd test -- src/features/life/recipes
npm.cmd run typecheck
npm.cmd run build
```

- [x] **Step 7: Commit or hash P3-T10** with message `feat(life): build recipes cooking and composition links`.

**Additional declared Files used by P3-T10:** Modify `playwright.config.ts`, `playwright.life.config.ts`, `src/App.tsx`, `src/styles/index.css` and `tests/public-final.spec.ts`; create `tests/life-recipes-p3-t10.spec.ts`.

### P3-T11: Weekly life planning, templates, unified schedule, and completion flows

**Files:**
- Create: `src/features/life/plans/LifePlansPage.tsx`
- Create: `src/features/life/plans/LifePlansPage.test.tsx`
- Create: `src/features/life/plans/WeekPlanningCanvas.tsx`
- Create: `src/features/life/plans/TemplateLibrary.tsx`
- Create: `src/features/life/plans/PlanConflictPreview.tsx`
- Create: `src/features/life/plans/LifePlanItemEditor.tsx`
- Create: `src/features/life/fitness/FitnessPage.tsx`
- Create: `src/features/life/fitness/FitnessPage.test.tsx`
- Create: `src/styles/life-plans.css`

**Interfaces:**
- Consumes P1-T11 template/day-plan/fitness/completion APIs and P1-T9 forecasts.
- Produces `/app/life/plans` and `/app/life/fitness`, with drag and keyboard scheduling, explicit template sync and actual completion/undo.

- [x] **Step 1: Write failing planning tests.** Cover custom meal slots, drag and menu placement, portion/time edits, template preview, keep/merge/replace/skip conflicts, explicit sync range, copy excluding actuals, supplement linked to meal time, medicine delay/skip/backfill, fitness combination and actual-duration estimate, completion, duplicate-submit protection and undo.
- [x] **Step 2: Run the red tests.**

```powershell
npm.cmd test -- src/features/life/plans src/features/life/fitness
```

- [x] **Step 3: Implement desktop week planning and mobile day-first planning.** Mobile uses horizontal day navigation plus a weekly summary, not seven squeezed columns.
- [x] **Step 4: Implement template and conflict preview flows.** Dates are independent after application; no template edit can silently overwrite a date.
- [x] **Step 5: Implement supplement, medicine and fitness editors/completion.** Forecast and actual are labelled separately; medicine copy remains factual and fitness burn is marked as user-estimated.
- [x] **Step 6: Run focused tests, typecheck and build.**

```powershell
npm.cmd test -- src/features/life/plans src/features/life/fitness
npm.cmd run typecheck
npm.cmd run build
```

- [x] **Step 7: Commit or hash P3-T11** with message `feat(life): build weekly planning and unified completion`.

**Additional declared Files used by P3-T11:** Modify `src/App.tsx`, `src/styles/index.css`, `src/domain/lifePlanning.ts`, `src/api/lifePlanningApi.ts`, `src/api/lifePlanningApi.test.ts`, `server/src/domain/life/planning.ts`, `server/src/domain/life/planning.test.ts`, `server/src/store/lifePlanningStore.ts`, `server/src/store/memory/memoryLifePlanningStore.ts`, `server/src/store/mysql/mysqlLifePlanningStore.ts`, `server/src/store/memoryLifeStore.ts`, `server/src/store/mysqlLifeStore.ts`, `server/src/routes/lifePlanning.ts`, `server/src/routes/lifePlanning.test.ts`, `server/src/mysql.integration.test.ts`, `playwright.config.ts`, `playwright.life.config.ts` and `tests/public-final.spec.ts`; create `tests/life-planning-p3-t11.spec.ts`. The additive day-plan reconciliation contract reuses `life_day_plans` JSON and adds no migration.

### P3-T12: Shopping, purchase, budget, analytics, and life data-management workspaces

**Files:**
- Modify: `src/App.tsx`
- Create: `src/features/life/shopping/ShoppingPage.tsx`
- Create: `src/features/life/shopping/ShoppingPage.test.tsx`
- Create: `src/features/life/shopping/PurchaseConfirm.tsx`
- Create: `src/features/life/budgets/BudgetSummary.tsx`
- Create: `src/features/life/analytics/LifeAnalyticsPage.tsx`
- Create: `src/features/life/analytics/LifeAnalyticsPage.test.tsx`
- Create: `src/features/life/data/LifeDataPage.tsx`
- Create: `src/features/life/data/LifeDataPage.test.tsx`
- Create: `src/features/life/data/ImportPreview.tsx`
- Modify: `src/features/life/data/TrashWorkspace.tsx`
- Create: `src/styles/life-commerce.css`
- Modify: `src/styles/index.css`
- Modify: `playwright.config.ts`
- Modify: `playwright.life.config.ts`
- Create: `tests/life-commerce-p3-t12.spec.ts`
- Modify: `tests/public-final.spec.ts`

**Interfaces:**
- Consumes P1-T12 shopping/purchase/budget/analytics/portability APIs and P1-T8 trash/taxonomy APIs.
- Produces `/app/life/shopping`, `/analytics` and `/data`, with source drill-down and safe import/export controls.

- [x] **Step 1: Write failing workspace tests.** Cover suggestion/formal-list distinction, merged reasons, priority/store grouping, partial purchase, actual-price choice, purchase closing inventory/spend/list, refund, cash-versus-consumption labels, budget thresholds/forecast, no-record versus zero, chart drill-down, export manifest, import preview/conflict/rollback, and return-state preservation.
- [x] **Step 2: Run the red tests.**

```powershell
npm.cmd test -- src/features/life/shopping src/features/life/analytics src/features/life/data
```

- [x] **Step 3: Implement the action-priority shopping canvas.** Immediate blockers, formal list, system suggestions and history remain distinct; confirming purchase exposes actual quantity/amount/batch/expiry/location in one flow.
- [x] **Step 4: Implement budget and analysis views with accessible SVG/table equivalents.** Every visual point links to source facts; animation updates only changed values and reduced motion is near-instant.
- [x] **Step 5: Implement data management.** Import cannot write until preview succeeds; destructive replace creates a restore point; failed import reports exact rows and leaves live data unchanged.
- [x] **Step 6: Run focused tests, typecheck and build.**

```powershell
npm.cmd test -- src/features/life/shopping src/features/life/analytics src/features/life/data
npm.cmd run typecheck
npm.cmd run build
```

- [x] **Step 7: Commit or hash P3-T12** with message `feat(life): build shopping budgets analytics and data tools`.

### P3-T13: Life responsive, motion, failure, traceability, and visual acceptance

**Files:**
- Modify: `src/styles/life-shell.css`
- Modify: `src/styles/life-catalog.css`
- Modify: `src/styles/life-recipes.css`
- Modify: `src/styles/life-plans.css`
- Modify: `src/styles/life-commerce.css`
- Create: `tests/life-today-calendar.spec.ts`
- Create: `tests/life-catalog-recipes.spec.ts`
- Create: `tests/life-planning-completion.spec.ts`
- Create: `tests/life-shopping-budget.spec.ts`
- Create: `tests/life-data-recovery.spec.ts`
- Modify: `tests/responsive-accessibility.spec.ts`
- Modify: `tests/visual-capture.spec.ts`

**Interfaces:**
- Produces local UI/E2E/visual evidence for LIFE-01 through LIFE-19 and LIFE-21 through LIFE-24; LIFE-20 completes in P4. Executed additive declared paths: `src/features/life/LifeCalendarOverlay.tsx`, `src/features/life/LifeCalendarPage.tsx`, `playwright.config.ts`, `tests/globalSetup.ts`, and `work/make-p3-t13-contact-sheets.py`.

- [x] **Step 1: Write failing E2E journeys for the 24 approved acceptance scenarios.** Include future recalculation/history freeze, unit conversion, exact-once complete/undo, prepared leftovers, template/copy rules, purchase/refund, cost separation, trash restore, import rollback, source drill-down, mobile close/back, browser history, missing data and retry idempotency.
- [x] **Step 2: Add 403, 409, 500, delayed, offline and duplicate-submit fixtures.** Only the affected module changes state; risky offline mutations remain pending instead of reporting success.
- [x] **Step 3: Run the focused life E2E set and confirm behavioral failures before final fixes.**

```powershell
npm.cmd run test:e2e -- tests/life-today-calendar.spec.ts tests/life-catalog-recipes.spec.ts tests/life-planning-completion.spec.ts tests/life-shopping-budget.spec.ts tests/life-data-recovery.spec.ts
```

- [x] **Step 4: Complete responsive and motion behavior at 1440×900, 1024×768, 768×1024 and 390×844, plus 200% zoom and 320 CSS px reflow.** Reject equal-card walls, clipped controls, route white flashes, graph-only access, hidden close actions, seven squeezed mobile columns, horizontal page overflow and any CSS/Motion transform contention.
- [x] **Step 5: Capture and open named screenshots and normal/reduced task-filmstrips for every life route at desktop and mobile plus planning/tablet.** Record the five veto axes, hierarchy, density, label clarity, forecast/actual distinction, color semantics, focus, reduced motion and empty/loading/partial/403/409/500/offline states with reproducibility metadata.
- [x] **Step 6: Run the complete Plan 3 gate including life journeys.**

```powershell
npm.cmd test
npm.cmd run test:server
npm.cmd run test:mysql
npm.cmd run typecheck
npm.cmd run typecheck:server
npm.cmd run build
npm.cmd run build:server
npm.cmd run test:e2e -- tests/private-overview.spec.ts tests/goals-schedule-habits.spec.ts tests/records-reviews.spec.ts tests/life-today-calendar.spec.ts tests/life-catalog-recipes.spec.ts tests/life-planning-completion.spec.ts tests/life-shopping-budget.spec.ts tests/life-data-recovery.spec.ts tests/responsive-accessibility.spec.ts
npm.cmd run test:e2e:remote
```

- [x] **Step 7: Commit or hash P3-T13** with message `test(life): lock life workspace responsive acceptance`.

### P3-T14: Private core and life workspace closure and handoff

**Files:**
- Modify: `docs/traceability/requirements.md`
- Modify: project `CURRENT.md`
- Modify: the active implementation session selected at P3 entry under ADR-020; scan the highest occupied `SNNN` and never reuse S015–S018.
- Create: `outputs/final/private-core-verification.md`

**Interfaces:**
- Closes P3-owned atoms for APP-01, GOAL-01, SCHEDULE-01, HABIT-01, RECORD-01, REVIEW-01, LIFE-01 through LIFE-19 and LIFE-21 through LIFE-24 at their declared phase boundaries; image-, P4- and P5-bound atoms remain partial or pending, so parent status is always the least-complete applicable child.

- [x] **Step 1: Record exact test counts, browser/OS/font/DPR/viewport/color-scheme/reduced-motion metadata, dependency-lock hash, screenshot/filmstrip/trace paths, maximum route-transition duration and every original/life failure-state result** in `private-core-verification.md`.
- [x] **Step 2: Perform a reverse requirement audit** from each original private and LIFE ID to API, page, state tests, E2E and screenshot; reopen any ID with a missing link.
- [x] **Step 3: Update traceability, the selected session and CURRENT** with next action `P4-T1 knowledge data/version API failing test` and truthful external state.
- [x] **Step 4: Commit or hash P3-T14** with message `docs(app): close private core and life gate`.

## Plan 3 Self-Review

- Spec coverage: overview, goals/projects, schedule/tasks, habits, records/media, reviews and every life route include data hooks, full interactions, page-specific layouts, mobile behavior, state failures and visual evidence.
- Placeholder scan: every editor field, route, duration, breakpoint, status and test command is named.
- Type consistency: page hooks consume the Plan 1 contracts; version conflicts are HTTP 409 throughout; forecast/actual, cash/consumption and suggestion/formal-list unions remain distinct; navigation paths match the approved route table.
- Scope: knowledge publishing, confirmed Obsidian file writes, platform adapters and final global tools remain in Plans 4–5. Life Obsidian controls may show export/connection status but cannot claim synchronization before P4-T7 passes.
