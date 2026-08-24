# LifeOps Knowledge Publishing and Obsidian Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a complete knowledge workspace, safe manual Obsidian synchronization for approved knowledge/review/life projections, revisioned public publishing workbench, five dynamic public categories, stable links and RSS.

**Architecture:** Knowledge and publishing receive independent versioned APIs and MySQL stores. Browser-local Obsidian access is isolated behind a `VaultAdapter`, scans before writes, computes conflicts by stable `lifeops_id` and revision, and creates a vault backup before every batch. Life data enters Obsidian only through approved human-readable projections; real-time inventory, transaction, idempotency, budget-computation and schedule-conflict state never becomes a Markdown authority. Publishing copies selected private fields into drafts, creates immutable public revisions, and serves only those revisions through public routes.

**Tech Stack:** React 19.2.8, React Markdown 10.1.0, remark-gfm 4.0.1, rehype-sanitize 6.0.0, fflate 0.8.3, File System Access API, Obsidian URI, Fastify 5.11.3, MySQL 8.4.10, Vitest, Playwright.

## Global Constraints

- Knowledge supports direct creation and derivation from records, reviews, goals and projects; source links remain traceable.
- No decorative knowledge graph is added.
- Obsidian V1 handles knowledge, reviews and approved life projections: recipes, cooking notes, fitness summaries, life reviews and user-selected shopping/budget summaries. Account, sessions, raw inventory transactions, idempotency records, schedule conflicts, platform and secret data never enter vault files.
- First vault connection scans and previews only; synchronization is always manually confirmed.
- Delete is never auto-propagated in either direction.
- Conflicts show both versions and offer keep Web, keep Obsidian, manual merge or create copy.
- Every confirmed batch write creates a timestamped backup inside the selected LifeOps folder before changing files.
- Unsupported browsers receive Markdown/ZIP import/export and Obsidian URI opening, not a fake connected state.
- A production deployment never hardcodes or claims direct access to a personal Windows `D:` path; the browser adapter can access only the directory the user explicitly selected.
- Public content is a copied draft plus immutable revision; private changes never silently alter published output.
- Revoked content returns 404 from public APIs immediately after revocation commits.
- Knowledge preserves the approved 2.5/3.5/6 library/list/reader-editor geometry and publishing preserves the approved 3/5/4 source/editor/preview geometry on wide screens; neither becomes an equal-card dashboard.
- Below 768px, knowledge is library → list → reader/editor and publishing is source → editor → preview, each as a full task layer with fixed back/save and exact focus/scroll restoration.
- All UI evidence covers 1440×900, 1024×768, 768×1024 and 390×844, 200% zoom, 320 CSS px reflow, keyboard-only operation, visible focus, WCAG 2.2 AA and semantic reduced motion.
- New content pages must extend the accepted private/public golden-slice languages. A locally attractive component cannot pass if the whole page regresses into the rejected beige/monotone/right-angle/generic-workbench board or a generic card wall.
- Follow the master plan's Git-or-SHA checkpoint rule after every task.

---

### P4-T1: Knowledge collections, relations, review dates, and full CRUD API

**Files:**
- Create: `server/migrations/013_knowledge.sql`
- Create: `server/src/domain/knowledge.ts`
- Create: `server/src/domain/knowledge.test.ts`
- Modify: `server/src/domain/types.ts`
- Modify: `server/src/store/lifeStore.ts`
- Modify: `server/src/store/memoryLifeStore.ts`
- Create: `server/src/store/mysql/knowledgeMySqlStore.ts`
- Modify: `server/src/store/mysqlLifeStore.ts`
- Modify: `server/src/store/mysql/reviewsMySqlStore.ts`
- Create: `server/src/routes/knowledge.ts`
- Create: `server/src/routes/knowledge.test.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/mysql.integration.test.ts`
- Create: `src/domain/knowledge.ts`
- Create: `src/api/knowledgeApi.ts`
- Create: `src/api/knowledgeApi.test.ts`

**Interfaces:**
- `KnowledgeNote { id, title, body, tags, collectionIds, sourceLinks, relatedIds, pinned, favorite, reviewOn, version, createdAt, updatedAt, archivedAt, deletedAt }`.
- `KnowledgeCollection { id, name, color, position, version }`.
- Routes: full CRUD under `/api/v1/knowledge`, `/knowledge/:id/relations`, `/knowledge/collections`, `/knowledge/resurface`.
- Produces: `rankResurfacedKnowledge(notes, now)` using due review, recency decay, pinned state and deterministic ID tie-break.

- [x] **Step 1: Write failing domain tests** for due-first resurfacing, archived/deleted exclusion, stable tie-break, related-note cycle tolerance and source-link validation.
- [x] **Step 2: Write failing route tests** for create/direct and derived notes, edit with version, search title/body/tags/source, collection CRUD, relation add/remove, pin/favorite/archive/delete/restore and user isolation.

```ts
const response = await owner.inject({ method: 'GET', url: '/api/v1/knowledge?q=高可用&tag=k8s&source=review' })
expect(response.json().items.every((item: KnowledgeNote) => item.tags.includes('k8s'))).toBe(true)
```

- [x] **Step 3: Run focused tests and verify failures.**

```powershell
npm.cmd run test:server -- server/src/domain/knowledge.test.ts server/src/routes/knowledge.test.ts
```

- [x] **Step 4: Implement migration, domain, MySQL store and routes.** Preserve current `knowledge_notes` IDs and source rows; backfill new version/timestamp columns and move tag arrays without dropping content.
- [x] **Step 5: Implement frontend contracts/API and query keys.** Searches use debounced server queries with abort signals; no Elastic dependency is introduced.
- [x] **Step 6: Run knowledge, MySQL and type gates.**

```powershell
npm.cmd run test:server -- server/src/domain/knowledge.test.ts server/src/routes/knowledge.test.ts
npm.cmd run test:mysql
npm.cmd run typecheck:server
npm.cmd run typecheck
```

- [x] **Step 7: Commit or hash P4-T1** with message `feat(knowledge): add collections relations and resurfacing`.

### P4-T2: Three-pane knowledge workspace and safe Markdown editing

**Files:**
- Create: `src/features/knowledge/useKnowledge.ts`
- Create: `src/features/knowledge/KnowledgePage.tsx`
- Create: `src/features/knowledge/KnowledgePage.test.tsx`
- Create: `src/features/knowledge/KnowledgeSidebar.tsx`
- Create: `src/features/knowledge/KnowledgeList.tsx`
- Create: `src/features/knowledge/KnowledgeEditor.tsx`
- Create: `src/features/knowledge/KnowledgeEditor.test.tsx`
- Create: `src/styles/knowledge.css`
- Modify: `src/styles/index.css`
- Modify: `src/App.tsx`
- Create: `tests/knowledge.spec.ts`
- Create: `tests-remote/knowledge.spec.ts`

**Interfaces:**
- Produces `/app/knowledge?collection=&tag=&source=&q=&note=<id>`.
- Desktop columns are 2.5/3.5/6; mobile levels are library → list → reading/editor.
- Reuses `MarkdownView` and `useAutosave` from Plan 3.

- [x] **Step 1: Write failing page tests** for collections/topics/tags, search results, note list, editor/reader, source links, relations, pin/favorite/archive/delete/restore, review date and resurfaced section.
- [x] **Step 2: Write failing keyboard/focus tests** for library selection, list navigation, open note, edit/save, Escape/back and returning to the same list scroll position.
- [x] **Step 3: Run focused tests and verify failures.**

```powershell
npm.cmd test -- src/features/knowledge
```

- [x] **Step 4: Implement the query hook and three-pane page.** The selected note URL is shareable only inside the authenticated app; changing filters preserves the current note if it still matches.
- [x] **Step 5: Implement editor autosave/conflict behavior** and source/related note controls. A derived note stores source IDs but edits never mutate its source record/review.
- [x] **Step 6: Implement mobile layered navigation** with fixed back/save controls, no side-by-side tiny panes and reverse shared-title transitions.
- [x] **Step 7: Run knowledge frontend/API and build gates.**

```powershell
npm.cmd test -- src/features/knowledge
npm.cmd run test:server -- server/src/routes/knowledge.test.ts
npm.cmd run typecheck
npm.cmd run build
```

- [x] **Step 8: Commit or hash P4-T2** with message `feat(knowledge): build three-pane library workspace`.

### P4-T3: Manual Obsidian scan, preview, conflict, backup, and fallback

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/integrations/obsidian/types.ts`
- Create: `src/integrations/obsidian/frontmatter.ts`
- Create: `src/integrations/obsidian/frontmatter.test.ts`
- Create: `src/integrations/obsidian/fileSystemVault.ts`
- Create: `src/integrations/obsidian/fileSystemVault.test.ts`
- Create: `src/integrations/obsidian/syncPlan.ts`
- Create: `src/integrations/obsidian/syncPlan.test.ts`
- Create: `src/integrations/obsidian/zipFallback.ts`
- Create: `src/integrations/obsidian/zipFallback.test.ts`
- Create: `src/features/settings/ObsidianSettings.tsx`
- Create: `src/features/settings/ObsidianSettings.test.tsx`

**Interfaces:**
- `VaultAdapter { scan(); read(path); writeAtomic(path, bytes); mkdir(path); copy(source, target); }`.
- `VaultDocument { lifeopsId, type: 'knowledge'|'review', title, tags, source, updatedAt, syncRevision, body, path }`.
- `SyncAction = create-web | update-web | create-vault | update-vault | conflict | unchanged`.
- `buildSyncPlan(webDocuments, vaultDocuments): SyncPlan` is pure and never contains delete actions.

- [x] **Step 1: Install exact ZIP dependency.**

```powershell
npm.cmd install --save-exact fflate@0.8.3
```

- [x] **Step 2: Write failing frontmatter tests** for stable key order, YAML-safe quoting, Unicode, tags, invalid/missing IDs, review type rejection and round-trip body preservation.

```ts
expect(serializeVaultDocument(document).split('\n').slice(0, 8)).toEqual([
  '---', 'lifeops_id: "note-1"', 'type: "knowledge"', 'tags:', '  - "k8s"',
  'source: "review:review-1"', 'updated_at: "2026-08-09T10:00:00.000Z"', 'sync_revision: 3',
])
```

- [x] **Step 3: Write failing sync-plan tests** for unchanged, Web newer, vault newer, same-revision divergent conflict, new-on-each-side and absence of deletion propagation.
- [x] **Step 4: Write failing fake-directory tests** for `LifeOps/Knowledge`, `LifeOps/Reviews`, first scan read-only, permission denial, backup creation, atomic temp write/rename and failure recovery.
- [x] **Step 5: Write failing ZIP tests** for deterministic paths, knowledge/review inclusion only, zip-slip path rejection on import and preview-before-apply.
- [x] **Step 6: Run focused tests and verify failures.**

```powershell
npm.cmd test -- src/integrations/obsidian src/features/settings/ObsidianSettings.test.tsx
```

- [x] **Step 7: Implement adapters and sync planner.** `connect()` calls `showDirectoryPicker({ mode: 'readwrite' })`; it stores the handle in IndexedDB only after permission, scans without writes, and displays every proposed action before confirm.
- [x] **Step 8: Implement backup and apply.** Before a batch, copy affected files into `LifeOps/.lifeops-backup/<ISO timestamp>/`; then write temp files and replace targets. If any write fails, stop and present completed/failed paths without deleting the backup.
- [x] **Step 9: Implement settings UI and fallback.** Unsupported browsers show ZIP export/import and `obsidian://open?vault=<encoded>&file=<encoded>` links; connected status is never shown without a valid handle and permission query.
- [x] **Step 10: Run integration, type and build gates.**

```powershell
npm.cmd test -- src/integrations/obsidian src/features/settings/ObsidianSettings.test.tsx
npm.cmd run typecheck
npm.cmd run build
```

- [x] **Step 11: Commit or hash P4-T3** with message `feat(obsidian): add previewed manual knowledge sync`.

### P4-T4: Revisioned publishing domain, scheduler, privacy boundary, and RSS API

**Files:**
- Create: `server/migrations/014_publishing.sql`
- Create: `server/src/domain/publishing.ts`
- Create: `server/src/domain/publishing.test.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/config.ts`
- Modify: `server/src/main.ts`
- Modify: `server/src/store/lifeStore.ts`
- Modify: `server/src/store/memoryLifeStore.ts`
- Modify: `server/src/store/mysqlLifeStore.ts`
- Create: `server/src/store/publishingStore.ts`
- Create: `server/src/store/mysql/publishingMySqlStore.ts`
- Create: `server/src/services/publicationScheduler.ts`
- Create: `server/src/services/publicationScheduler.test.ts`
- Create: `server/src/routes/publishing.ts`
- Create: `server/src/routes/publishing.test.ts`
- Replace: `server/src/routes/publicContent.ts`
- Modify: `server/src/routes/publicContent.test.ts`
- Modify: `server/src/runtime.ts`
- Modify: `server/src/mysql.integration.test.ts`
- Create: `src/domain/publishing.ts`
- Create: `src/api/publishingApi.ts`
- Create: `src/api/publishingApi.test.ts`

**Interfaces:**
- `PublicDraftStatus = 'draft' | 'scheduled' | 'published' | 'revoked'`.
- `PublicDraft` includes category, source copy, title, excerpt, body, cover media, tags, slug, scheduledAt, featured, SEO, version and timestamps.
- `PublicRevision` is immutable and contains only public fields plus revision number and publication timestamp.
- Scheduler: `publishDueDrafts(now): Promise<PublicationResult[]>` safe under two API replicas.
- Routes: private CRUD `/publishing/drafts`; actions `/preview`, `/publish`, `/schedule`, `/revoke`; public `/public/content`, `/public/content/:slug`, `/public/feed.xml`.

- [x] **Step 1: Write failing domain tests** for valid five categories, slug normalization/uniqueness, copied-source fields, privacy whitelist, immutable revisions, scheduled timestamp and revision diffs.
- [x] **Step 2: Write failing route tests** for standalone/source-derived draft, preview, immediate publish, schedule, update/new revision, revoke/404, revision history/diff and private-field exclusion.

```ts
expect(Object.keys(publicResponse.json()).sort()).toEqual([
  'body', 'category', 'coverUrl', 'excerpt', 'featured', 'publishedAt', 'revision', 'slug', 'tags', 'title', 'updatedAt',
])
```

- [x] **Step 3: Write failing two-scheduler test** proving one due draft creates one revision when two workers run concurrently.
- [x] **Step 4: Run focused tests and verify failures.**

```powershell
npm.cmd run test:server -- server/src/domain/publishing.test.ts server/src/services/publicationScheduler.test.ts server/src/routes/publishing.test.ts server/src/routes/publicContent.test.ts
```

- [x] **Step 5: Implement migration/store/routes.** Use a unique key on `(draft_id, source_version)` and an atomic status/version update before revision insertion. Never serialize source object JSON wholesale; copy the explicit whitelist.
- [x] **Step 6: Implement scheduler lifecycle** with a 60-second interval, immediate run after readiness, clean shutdown, failure logging without secrets, and no overlapping run in one process.
- [x] **Step 7: Implement RSS** as XML containing only currently published revisions, stable absolute links from configured public origin, latest 50 items and valid escaped text.
- [x] **Step 8: Implement frontend publishing contracts/API.**
- [x] **Step 9: Run publishing, MySQL and type gates.**

```powershell
npm.cmd run test:server -- server/src/domain/publishing.test.ts server/src/services/publicationScheduler.test.ts server/src/routes/publishing.test.ts server/src/routes/publicContent.test.ts
npm.cmd run test:mysql
npm.cmd run typecheck:server
npm.cmd run typecheck
```

- [x] **Step 10: Commit or hash P4-T4** with message `feat(publish): add immutable public revisions and scheduler`.

### P4-T5: Publishing workbench, live preview, revisions, and dynamic public pages

**Files:**
- Create: `src/features/publishing/usePublishing.ts`
- Create: `src/features/publishing/PublishingPage.tsx`
- Create: `src/features/publishing/PublishingPage.test.tsx`
- Create: `src/features/publishing/SourceLibrary.tsx`
- Create: `src/features/publishing/PublicDraftEditor.tsx`
- Create: `src/features/publishing/PublicPreview.tsx`
- Create: `src/features/publishing/PrivacyReview.tsx`
- Create: `src/features/publishing/RevisionHistory.tsx`
- Create: `src/styles/publishing.css`
- Modify: `src/components/public/PublicDetailShell.tsx`
- Modify: `src/domain/publishing.ts`
- Modify: `src/pages/PublicDestinationPage.test.tsx`
- Modify: `src/pages/PublicDestinationPage.tsx`
- Modify: `src/pages/PublicSnapshotPage.test.tsx`
- Modify: `src/pages/PublicSnapshotPage.tsx`
- Modify: `src/styles/index.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces `/app/publish?status=&draft=<id>` with 3/5/4 desktop columns and source → edit → preview mobile levels.
- Preview supports `day|night` and `desktop|mobile` without publishing.
- Public category pages and stable `/p/:slug` routes read `PublicRevision` only.

- [x] **Step 1: Write failing workbench tests** for source library types, status tabs, copy/private separation, all draft fields, desktop/mobile/day/night preview, privacy checklist, immediate/scheduled publish, revoke and revision diff.
- [x] **Step 2: Write failing public-route tests** for five category feeds, stable slug, RSS link, featured ordering, revoked 404 and no source identifiers in rendered DOM.
- [x] **Step 3: Run focused tests and verify failures.**

```powershell
npm.cmd test -- src/features/publishing src/pages/PublicDestinationPage.test.tsx src/pages/PublicSnapshotPage.test.tsx
```

- [x] **Step 4: Implement workbench query hooks and three-region layout.** Source click copies allowed fields into a new draft and records a private source reference; editing the draft never mutates the source.
- [x] **Step 5: Implement `PrivacyReview`.** It lists public title/excerpt/body/media/tags/SEO and separately lists omitted private fields; publish controls stay disabled until the user checks `我已确认公开字段` for the current version.
- [x] **Step 6: Implement live preview and revision history.** Preview uses the same public renderer as `/p/:slug`; revision diff shows added/removed text and metadata changes without exposing private source values.
- [x] **Step 7: Replace legacy snapshot URLs with compatibility redirects** to `/p/:slug` when published; private/revoked IDs return the existing not-found result.
- [x] **Step 8: Implement mobile source → edit → preview transitions** with fixed back/save/publish controls and unsaved-leave protection.
- [x] **Step 9: Run publishing frontend/API and build gates.**

```powershell
npm.cmd test -- src/features/publishing src/pages/PublicDestinationPage.test.tsx src/pages/PublicSnapshotPage.test.tsx
npm.cmd run test:server -- server/src/routes/publishing.test.ts server/src/routes/publicContent.test.ts
npm.cmd run typecheck
npm.cmd run build
```

- [x] **Step 10: Commit or hash P4-T5** with message `feat(publish): build source editor preview workbench`.

### P4-T6: Knowledge, Obsidian, publishing E2E and visual acceptance

**Files:**
- Create: `tests/knowledge-obsidian.spec.ts`
- Create: `tests/publishing-public.spec.ts`
- Create: `src/features/settings/SettingsPage.tsx`
- Create: `src/styles/settings.css`
- Modify: `src/App.tsx`
- Modify: `src/features/publishing/PublicDraftEditor.tsx`
- Modify: `src/features/publishing/PublishingPage.tsx`
- Modify: `src/features/publishing/usePublishing.ts`
- Modify: `src/features/settings/ObsidianSettings.tsx`
- Modify: `src/features/settings/ObsidianSettings.test.tsx`
- Modify: `src/styles/index.css`
- Modify: `src/styles/public.css`
- Modify: `tests/obsidian-settings.spec.ts`
- Modify: `tests/private-core-fixtures.ts`
- Modify: `tests/public-final.spec.ts`
- Modify: `tests/responsive-accessibility.spec.ts`
- Modify: `tests/visual-capture.spec.ts`
- Modify: domain styles from P4-T2 and P4-T5

**Interfaces:**
- Produces evidence for KNOW-01, OBS-01, PUBLISH-01, MOTION-01, SPACE-01 and STATE-01.

- [x] **Step 1: Write failing knowledge journeys** for create/derive/edit/search/relation/review date/resurface/archive/restore and Markdown XSS fixtures.
- [x] **Step 2: Write failing Obsidian browser-fixture journeys** for unsupported fallback, permission denied, first scan no writes, conflict choices, backup before apply and no delete action.
- [x] **Step 3: Write failing publishing journeys** for source copy, privacy check, live preview, publish, update/revision, schedule through a controlled clock, revoke/404, RSS and private-source absence.
- [x] **Step 4: Run focused E2E and confirm failures.**

```powershell
npm.cmd run test:e2e -- tests/knowledge-obsidian.spec.ts tests/publishing-public.spec.ts
```

- [x] **Step 5: Complete desktop/tablet/mobile CSS** and capture knowledge, Obsidian settings, publishing workbench, public category and public article at 1440×900, 1024×768, 768×1024 and 390×844, plus 200% zoom and 320 CSS px reflow. Record normal/reduced transitions for mobile task layers and public preview/return.
- [x] **Step 6: Open every capture and filmstrip** and apply the five veto axes. Reject unreadable 2.5/3.5/6 or 3/5/4 geometry, missing state truth, clipped fixed controls, inaccessible diff/conflict/privacy content, public-preview drift, paper/card-wall language, focus/scroll loss or animation work that persists after interruption.
- [x] **Step 7: Run the knowledge/publishing interim gate.** The plan remains open until life projections pass P4-T7.

```powershell
npm.cmd test
npm.cmd run test:server
npm.cmd run test:mysql
npm.cmd run typecheck
npm.cmd run typecheck:server
npm.cmd run build
npm.cmd run build:server
npm.cmd run test:e2e -- tests/knowledge-obsidian.spec.ts tests/publishing-public.spec.ts tests/responsive-accessibility.spec.ts
npm.cmd run test:e2e:remote
```

- [x] **Step 8: Commit or hash P4-T6** with message `test(content): lock knowledge sync and publishing acceptance`.

### P4-T7: Life knowledge projections and controlled Obsidian round trip

**Files:**
- Create: `src/integrations/obsidian/lifeProjection.ts`
- Create: `src/integrations/obsidian/lifeProjection.test.ts`
- Create: `src/integrations/obsidian/lifeImportPlan.ts`
- Create: `src/integrations/obsidian/lifeImportPlan.test.ts`
- Create: `src/features/life/data/LifeObsidianPanel.tsx`
- Create: `src/features/life/data/LifeObsidianPanel.test.tsx`
- Modify: `src/features/life/data/LifeDataPage.tsx`
- Modify: `src/features/life/LifeSubnav.tsx`
- Modify: `src/features/life/LifeTodayPage.test.tsx`
- Modify: `src/integrations/obsidian/fileSystemVault.ts`
- Modify: `src/styles/life-commerce.css`
- Modify: `tests/knowledge-obsidian.spec.ts`
- Create: `tests/life-obsidian.spec.ts`

**Interfaces:**
- Consumes the P4-T3 `VaultAdapter`, frontmatter/sync planner and P1 life export/import-preview APIs.
- Produces deterministic Markdown projections with `lifeops_id`, `type`, `version`, `updated_at` and user tags for recipes, cooking notes, fitness summaries, life reviews and selected shopping/budget summaries.
- Produces preview-only import candidates; recipe content changes require an explicit “create recipe version” action before any API mutation.

- [x] **Step 1: Write failing projection and UI tests.** Cover stable paths/frontmatter, readable recipe/cooking/fitness/review Markdown, exclusion of raw inventory/idempotency/credentials, first-connect preview, selected-type export, conflict actions, backup-before-write, recipe change as a version draft, no automatic delete, unsupported-browser ZIP fallback and degraded status after permission loss.
- [x] **Step 2: Run the red tests.**

```powershell
npm.cmd test -- src/integrations/obsidian/lifeProjection.test.ts src/integrations/obsidian/lifeImportPlan.test.ts src/features/life/data/LifeObsidianPanel.test.tsx
```

- [x] **Step 3: Implement deterministic serializers and import planning.** No serializer accepts raw inventory transactions, sessions, secrets or platform payloads; frontmatter identity is stable across repeated exports.
- [x] **Step 4: Implement the life data-panel flow.** Scan and preview precede every write; conflicts show both versions; confirmed batches create the timestamped backup through P4-T3 before modifying the selected folder.
- [x] **Step 5: Add E2E journeys for File System Access and ZIP fallback.** Assert that a sync failure leaves MySQL-backed life screens operational and never changes connection state to connected without permission.
- [x] **Step 6: Run focused and complete Plan 4 regression gates.**

```powershell
npm.cmd test -- src/integrations/obsidian src/features/settings/ObsidianSettings.test.tsx src/features/life/data/LifeObsidianPanel.test.tsx
npm.cmd run test:server
npm.cmd run test:mysql
npm.cmd run typecheck
npm.cmd run typecheck:server
npm.cmd run build
npm.cmd run build:server
npm.cmd run test:e2e -- tests/knowledge-obsidian.spec.ts tests/life-obsidian.spec.ts tests/publishing-public.spec.ts tests/responsive-accessibility.spec.ts
npm.cmd run test:e2e:remote
```

- [x] **Step 7: Commit or hash P4-T7** with message `feat(obsidian): add controlled life knowledge projections`.

### P4-T8: Content plan closure and handoff

**Files:**
- Modify: `docs/traceability/requirements.md`
- Modify: project `CURRENT.md`
- Modify: the active implementation session selected at P4 entry under ADR-020; scan the highest occupied `SNNN` and never reuse S015–S018.
- Create: `outputs/final/content-verification.md`

**Interfaces:**
- Closes KNOW-01 and OBS-01 as `verified-local`; PUBLISH-01 and LIFE-20 remain `partial` only at their later immutable-container-image boundary, with no open P4 local behavior atom.

- [x] **Step 1: Record current automated/visual evidence** including browser/OS/font/DPR/viewport/color-scheme/reduced-motion metadata, dependency-lock hash, screenshot/filmstrip/trace paths, ZIP fixture checksum, conflict/backup results, publication revision IDs, revoked 404 and RSS validation; exclude actual private note bodies.
- [x] **Step 2: Reverse-audit KNOW-01, OBS-01, PUBLISH-01 and LIFE-20** and reopen any row lacking API, UI, error, mobile or privacy evidence.
- [x] **Step 3: Update traceability, the selected session and CURRENT** with next action `P5-T1 platform adapter security contract test`.
- [x] **Step 4: Commit or hash P4-T8** with message `docs(content): close knowledge life sync and publishing gate`.

## Plan 4 Self-Review

- Spec coverage: complete knowledge CRUD/resurfacing, browser-only Obsidian sync/backup/conflicts/fallback, approved life projections, copy-based publishing, preview, scheduling, revisions, revocation, stable links and RSS are all mapped.
- Placeholder scan: directory paths, frontmatter keys, conflict actions, statuses, public fields, scheduler interval and test commands are exact.
- Type consistency: public categories match the orbit; `lifeops_id`/`sync_revision` are stable across serializer and planner; published revisions never share the private source shape.
- Scope: only knowledge/reviews and the explicitly approved life projections enter Obsidian; raw operational state, platform data and secrets remain excluded. Global settings connections remain for Plan 5.
