# LifeOps Platform Center and Global Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a truthful read-only platform operations center, unified personal search across original and life domains, context-aware quick creation, complete settings/account/security controls, and safe full-product data export/import.

**Architecture:** Server-side integration adapters wrap one bounded HTTP client and return normalized status models; browser code receives no external credentials or arbitrary query capability. Platform responses use a 15-second per-source cache and localized error results. Personal search is maintained in a MySQL `search_documents` table inside domain transactions. Global overlays live in the stable app shell and use domain APIs rather than a generic mutation endpoint.

**Tech Stack:** Fastify 5.11.3, Node 24 fetch, prom-client 15.1.3, MySQL 8.4.10, React 19.2.8, Motion 12.43.0, SVG/CSS charts, Vitest, Playwright, Kubernetes read-only API, Prometheus, Alertmanager, Elasticsearch, Grafana/Kibana/Argo CD deep links.

## Global Constraints

- Platform page is private and bright; it is not a dark NOC screen or fake KPI wall.
- Status values are `connected | degraded | disconnected | disabled | unknown`; sample data is never returned by production platform routes.
- Browser requests select predefined view/filter keys only; they never supply an upstream URL, PromQL, Elasticsearch DSL, Kubernetes path or credentials.
- Outbound HTTP permits only configured origins, uses `redirect: 'error'`, deadline, response-size limit and JSON content-type checks.
- Kubernetes adapter reads only approved resource types; no Secret, exec, log, create, update, patch or delete path exists.
- Logs are sanitized and bounded; request/response bodies, authorization, cookies, passwords and token-like values are removed.
- A single source failure remains inside that source panel and does not change other panels to failure.
- Search includes personal LifeOps content only; platform logs/alerts never enter the personal search index.
- Life search and quick-create results use stable source IDs and routes; they never duplicate life facts into a second store.
- The global utility label is `快速记录`; `QuickCreate` remains only an internal component/type name. Its default path is a low-friction record, while an explicit type switch exposes the wider approved create set without turning the overlay into a generic command console.
- Platform overview preserves the approved bright 7/5 topology/active-alert hierarchy and the mobile order overall status → alerts → delivery → technical modules. It is read-only and never implies authority to deploy, sync, roll back or administer Kubernetes.
- Search, quick record, platform and settings must extend the accepted private golden-slice language, pass the five whole-page veto axes and cover all four viewports, 200% zoom, 320 CSS px reflow, keyboard/focus/return and semantic reduced motion.
- Settings never return configured secret values; integration status returns enabled/connected/last checked and safe deep links only.
- Export excludes password hashes, sessions, login limits, platform secrets and raw audit request data.
- Follow the master plan's Git-or-SHA checkpoint rule after every task.

---

### P5-T1: Integration configuration, bounded fetch, redaction, and security contracts

**Files:**
- Modify: `server/src/config.ts`
- Create: `server/src/config.test.ts`
- Create: `server/src/integrations/types.ts`
- Create: `server/src/integrations/safeFetch.ts`
- Create: `server/src/integrations/safeFetch.test.ts`
- Create: `server/src/integrations/redact.ts`
- Create: `server/src/integrations/redact.test.ts`

**Interfaces:**
- `IntegrationConfig { enabled, baseUrl, timeoutMs, maxResponseBytes, deepLinkUrl, auth }`.
- `safeIntegrationFetch<T>(config, path, options): Promise<T>`.
- `sanitizeLabels`, `sanitizeLogEvent`, `sanitizeExternalError`.
- `PlatformSourceStatus { source, state, checkedAt, latencyMs, message }`.

- [x] **Step 1: Write failing config tests** for disabled defaults, required URL when enabled, `http|https` only, credentials separated from status serialization, 500–10,000ms timeout and 64KiB–2MiB response limits.
- [x] **Step 2: Write failing SSRF/bounds tests** for absolute-path injection, alternate origin, user-info URL, redirect, DNS-independent origin mismatch, timeout, oversized body and non-JSON response.

```ts
await expect(safeIntegrationFetch(config, 'https://evil.example/metrics')).rejects.toThrow('INTEGRATION_PATH_REJECTED')
await expect(safeIntegrationFetch(config, '/api/v1/query', { query: { query: userPromql } })).rejects.toThrow('RAW_QUERY_REJECTED')
```

- [x] **Step 3: Write failing redaction tests** covering `authorization`, `cookie`, `set-cookie`, `password`, `token`, `secret`, request body, nested headers and Kubernetes sensitive annotations.
- [x] **Step 4: Run focused tests and verify missing-module failures.**

```powershell
npm.cmd run test:server -- server/src/config.test.ts server/src/integrations/safeFetch.test.ts server/src/integrations/redact.test.ts
```

- [x] **Step 5: Implement configuration and security utilities.** Resolve every request path with `new URL(path, baseUrl)`, compare exact `origin`, reject redirects, stream/count bytes before JSON parse, and wrap errors in safe source/status messages without upstream response bodies.
- [x] **Step 6: Run focused and server type gates.**

```powershell
npm.cmd run test:server -- server/src/config.test.ts server/src/integrations/safeFetch.test.ts server/src/integrations/redact.test.ts
npm.cmd run typecheck:server
```

- [x] **Step 7: Commit or hash P5-T1** with message `feat(platform): add bounded integration security layer`.

### P5-T2: Kubernetes, monitoring, alert, log, delivery adapters, and cache

**Files:**
- Create: `server/src/integrations/cache.ts`
- Create: `server/src/integrations/cache.test.ts`
- Create: `server/src/integrations/kubernetes.ts`
- Create: `server/src/integrations/kubernetes.test.ts`
- Create: `server/src/integrations/prometheus.ts`
- Create: `server/src/integrations/prometheus.test.ts`
- Create: `server/src/integrations/alertmanager.ts`
- Create: `server/src/integrations/alertmanager.test.ts`
- Create: `server/src/integrations/elasticsearch.ts`
- Create: `server/src/integrations/elasticsearch.test.ts`
- Create: `server/src/integrations/delivery.ts`
- Create: `server/src/integrations/delivery.test.ts`

**Interfaces:**
- `TimedCache.get(key, loader, ttlMs=15_000)` coalesces concurrent loads and never caches failures longer than 3 seconds.
- Kubernetes produces node/workload/pod/service/HTTPRoute summaries only.
- Prometheus accepts keys `availability|request-rate|error-rate|p95-latency|cpu|memory|storage|restarts|readiness` mapped to server constants.
- Alertmanager produces current and recently resolved alert summaries.
- Elasticsearch accepts namespace/pod/level/requestId filters and returns totals plus at most 100 sanitized events.
- Delivery produces Web/API image tag/digest, GitHub Actions latest run and Argo CD sync/health/revision.

- [x] **Step 1: Write failing cache tests** for 15-second hit, visibility-independent server cache, concurrent coalescing, three-second failure cache and key isolation.
- [x] **Step 2: Write failing Kubernetes fixture tests** for Ready/NotReady nodes, deployment availability, pod restart totals, Service/HTTPRoute status and absence of Secret/exec/log paths.
- [x] **Step 3: Write failing Prometheus/Alertmanager tests** for each allowlisted metric key, matrix/vector normalization, missing series, firing/resolved alerts and deep-link metadata.
- [x] **Step 4: Write failing Elasticsearch tests** for fixed query template, filter escaping, 100-event cap, secret/body redaction and malformed event tolerance.
- [x] **Step 5: Write failing delivery tests** for image digest parsing, GitHub run state, Argo Synced/OutOfSync/Healthy/Degraded and partial source failure.
- [x] **Step 6: Run adapter tests and verify failures.**

```powershell
npm.cmd run test:server -- server/src/integrations
```

- [x] **Step 7: Implement adapters using only `safeIntegrationFetch`.** Kubernetes in-cluster auth reads the service-account token/CA from configured filesystem paths; tokens never appear in thrown errors. Deep links are configured output values, not API response-derived URLs.
- [x] **Step 8: Run all adapter and type gates.**

```powershell
npm.cmd run test:server -- server/src/integrations
npm.cmd run typecheck:server
```

- [x] **Step 9: Commit or hash P5-T2** with message `feat(platform): add read-only operations adapters`.

### P5-T3: Platform API, application metrics, and bright operations UI

**Files:**
- Modify: `server/package.json`
- Modify: `server/package-lock.json`
- Create: `server/src/observability/metrics.ts`
- Create: `server/src/observability/metrics.test.ts`
- Create: `server/src/routes/platform.ts`
- Create: `server/src/routes/platform.test.ts`
- Modify: `server/src/app.ts`
- Create: `src/domain/platform.ts`
- Create: `src/api/platformApi.ts`
- Create: `src/features/platform/usePlatform.ts`
- Create: `src/features/platform/PlatformPage.tsx`
- Create: `src/features/platform/PlatformPage.test.tsx`
- Create: `src/features/platform/ServiceTopology.tsx`
- Create: `src/features/platform/AccessibleTrend.tsx`
- Create: `src/features/platform/AccessibleTrend.test.tsx`
- Create: `src/features/platform/TechnologyArchive.tsx`
- Create: `src/styles/platform.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Routes: `/api/v1/platform/overview`, `/kubernetes`, `/metrics/:key`, `/alerts`, `/logs`, `/delivery`, `/technologies`, plus public scrape `/metrics` protected by network policy rather than session cookie.
- Platform tabs: `overview|kubernetes|monitoring|alerts|logs|delivery|technologies`.
- Client polls every 30 seconds only while `document.visibilityState === 'visible'`.

- [x] **Step 1: Install and lock Prometheus client.**

```powershell
npm.cmd --prefix server install --save-exact prom-client@15.1.3
```

- [x] **Step 2: Write failing metrics tests** for process defaults, HTTP duration/count labels limited to method/route/status class, active request gauge and absence of account/URL/query labels.
- [x] **Step 3: Write failing platform route tests** for authenticated access, disabled/connected/degraded sources, predefined filters, cache timestamps, partial failures and credential omission.
- [x] **Step 4: Write failing UI tests** for top connection strip, 7/5 topology/alerts, lower trends/log/delivery regions, all tabs, honest disconnected state, deep links and no dark-dashboard/card-wall classes.
- [x] **Step 5: Write failing accessible chart tests** requiring SVG title/description, tabular fallback, units and no color-only series identification.
- [x] **Step 6: Run focused tests and verify failures.**

```powershell
npm.cmd run test:server -- server/src/observability/metrics.test.ts server/src/routes/platform.test.ts
npm.cmd test -- src/features/platform
```

- [x] **Step 7: Implement metrics hook/route registration and normalized platform routes.** `/metrics` sets Prometheus content type; private platform routes call adapters with allowlisted inputs only.
- [x] **Step 8: Implement PlatformPage.** Overview uses a bright continuous topology, active alerts and latest deployment; technical tabs use filters and accessible SVG trends; technology archive contains all technologies and correct Jenkins/UHub/Harbor status.
- [x] **Step 9: Implement polling lifecycle** with AbortController on tab change/unmount and paused intervals while hidden.
- [x] **Step 10: Run platform/server/frontend/build gates.**

```powershell
npm.cmd run test:server -- server/src/observability/metrics.test.ts server/src/routes/platform.test.ts
npm.cmd test -- src/features/platform
npm.cmd run typecheck
npm.cmd run typecheck:server
npm.cmd run build
npm.cmd run build:server
```

- [x] **Step 11: Commit or hash P5-T3** with message `feat(platform): build truthful operations center`.

### P5-T4: MySQL personal search index and global command search

**Files:**
- Create: `server/migrations/015_search.sql`
- Create: `server/src/domain/search.ts`
- Create: `server/src/domain/search.test.ts`
- Create: `server/src/store/mysql/searchMySqlStore.ts`
- Create: `server/src/routes/search.ts`
- Create: `server/src/routes/search.test.ts`
- Modify: domain MySQL stores to update index in their transaction
- Create: `src/api/searchApi.ts`
- Replace: `src/components/private/CommandCenter.tsx`
- Create: `src/components/private/CommandCenter.test.tsx`
- Replace: `src/components/private/workspaceSearch.ts`
- Modify: `src/components/private/workspaceSearch.test.ts`

**Interfaces:**
- `SearchDocument { userId, type, sourceId, title, bodyText, tagsText, sourceText, updatedAt, deletedAt }`.
- `SearchResult { type, id, title, excerpt, context, updatedAt, route }`.
- Route: `GET /api/v1/search?q=&types=&limit=`; minimum query 2 characters, maximum limit 50.
- Search types: goal, project, task, record, review, knowledge, public-draft, life-item, recipe, medicine, fitness, household-item, shopping-item, day-plan, cooking-record.

- [x] **Step 1: Write failing ranking tests** for exact title > title contains > tags > body, Chinese substring, original/life type filters, recipe ingredient context, day-plan date context, deleted/private-user exclusion and deterministic recency tie-break.
- [x] **Step 2: Write failing route tests** for query validation, 50 cap, ownership and proof that log/alert/platform types are rejected.
- [x] **Step 3: Write failing CommandCenter tests** for `Ctrl/Cmd+K`, grouped results, recent items, keyboard selection, Escape/focus restore, aborting stale request and route navigation.
- [x] **Step 4: Run focused tests and verify failures.**

```powershell
npm.cmd run test:server -- server/src/domain/search.test.ts server/src/routes/search.test.ts
npm.cmd test -- src/components/private/CommandCenter.test.tsx src/components/private/workspaceSearch.test.ts
```

- [x] **Step 5: Implement migration/index updates and bounded LIKE search.** Each domain transaction upserts its search document after a successful mutation; soft delete marks `deleted_at`. Search escapes `%` and `_`, scopes by user/type and returns highlighted excerpts computed server-side without HTML.
- [x] **Step 6: Implement CommandCenter with a 180ms debounce** and grouped sections; use plain text matching and never `dangerouslySetInnerHTML` for highlights.
- [x] **Step 7: Run search, MySQL, frontend and type gates.**

```powershell
npm.cmd run test:server -- server/src/domain/search.test.ts server/src/routes/search.test.ts
npm.cmd run test:mysql
npm.cmd test -- src/components/private/CommandCenter.test.tsx
npm.cmd run typecheck
```

- [x] **Step 8: Commit or hash P5-T4** with message `feat(search): add unified personal command search`.

### P5-T5: Context-aware quick create

**Files:**
- Create: `src/components/private/QuickCreate.tsx`
- Create: `src/components/private/QuickCreate.test.tsx`
- Create: `src/components/private/quickCreateContext.ts`
- Create: `src/components/private/quickCreateContext.test.ts`
- Modify: `src/components/private/PrivateAppLayout.tsx`
- Delete after replacement: `src/components/private/QuickCapture.tsx`

**Interfaces:**
- `QuickCreateType = 'task' | 'record' | 'knowledge' | 'goal' | 'project' | 'habit' | 'review' | 'life-item' | 'recipe' | 'medicine' | 'fitness' | 'household-item' | 'shopping-item' | 'day-plan' | 'actual-meal'`.
- `deriveQuickCreateContext(location, selection)` returns inherited goal/project/date/habit/source IDs.
- The overlay creates through domain APIs and offers `stay | open | undo | create-another`.

- [x] **Step 1: Write failing context tests** for invocation from goal, project, schedule date, habit, record, knowledge, life date, recipe, item, shopping and analytics drill-down routes; untrusted query IDs are ignored unless present in loaded user data.
- [x] **Step 2: Write failing overlay tests** for the global `快速记录` control, keyboard shortcut, record-first default, explicit type selection, minimal required fields, expandable advanced fields, inherited context, submit progress, duplicate-click idempotency, success actions, focus restoration and undo.
- [x] **Step 3: Run focused tests and verify failures.**

```powershell
npm.cmd test -- src/components/private/QuickCreate.test.tsx src/components/private/quickCreateContext.test.ts
```

- [x] **Step 4: Implement context derivation and Motion overlay.** Initial fields are title plus type-specific minimum; advanced fields reuse domain editor field components rather than duplicating validation.
- [x] **Step 5: Implement one idempotency key per open/submission.** `create-another` creates a fresh key; retries reuse the original key. Undo uses the domain soft-delete/cancel endpoint and displays its expiry.
- [x] **Step 6: Replace old QuickCapture only after new tests and existing record capture flow pass.**
- [x] **Step 7: Run frontend/domain API gates.**

```powershell
npm.cmd test -- src/components/private/QuickCreate.test.tsx src/components/private/quickCreateContext.test.ts
npm.cmd run typecheck
npm.cmd test
```

- [x] **Step 8: Commit or hash P5-T5** with message `feat(app): add context-aware quick creation`.

### P5-T6: Account, preferences, integration status, export/import preview, and audit

**Files:**
- Create: `server/migrations/016_settings_audit.sql`
- Modify: `server/src/domain/types.ts`
- Modify: `server/src/store/lifeStore.ts`
- Create: `server/src/store/mysql/settingsMySqlStore.ts`
- Create: `server/src/services/dataTransfer.ts`
- Create: `server/src/services/dataTransfer.test.ts`
- Create: `server/src/routes/settings.ts`
- Create: `server/src/routes/settings.test.ts`
- Modify: `server/src/security/password.ts`
- Create: `src/domain/settings.ts`
- Create: `src/api/settingsApi.ts`
- Create: `src/features/settings/SettingsPage.tsx`
- Create: `src/features/settings/SettingsPage.test.tsx`
- Create: `src/features/settings/AccountSettings.tsx`
- Create: `src/features/settings/AppearanceSettings.tsx`
- Create: `src/features/settings/PlatformConnections.tsx`
- Create: `src/features/settings/DataSecuritySettings.tsx`
- Create: `src/styles/settings.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Settings categories: account/sessions, appearance/motion, time/locale, defaults, life thresholds/reminders, Obsidian, platform status, public site, data/security.
- Routes: `/settings`, `/account/password`, `/account/sessions`, `/account/sessions/:id/revoke`, `/data/export`, `/data/import/preview`, `/data/import/apply`, `/audit`.
- Import preview returns counts, conflicts, rejected records and checksum; apply requires the preview checksum and current password.

- [x] **Step 1: Write failing settings/account tests** for update preferences, current-password verification, new password policy, active session list, revoke-other-session and inability to revoke current session without explicit logout.
- [x] **Step 2: Write failing export tests** proving inclusion of user-owned original domains plus life catalog, recipes/versions, plans, completion snapshots, inventory ledger, purchases, budgets, trash and settings; exclude password hashes, session tokens/digests, CSRF, login limits, platform credentials and raw sanitized log samples.
- [x] **Step 3: Write failing import tests** for schema version, ownership remap, life relation ordering, recipe/item/version collisions, inventory-ledger integrity, invalid foreign keys, checksum mismatch, no-write preview and all-or-nothing apply transaction.
- [x] **Step 4: Write failing settings UI tests** for every category, local save state, integration status without secrets, dangerous confirmation, impact/recovery copy and mobile category navigation.
- [x] **Step 5: Run focused tests and verify failures.**

```powershell
npm.cmd run test:server -- server/src/services/dataTransfer.test.ts server/src/routes/settings.test.ts
npm.cmd test -- src/features/settings/SettingsPage.test.tsx
```

- [x] **Step 6: Implement migration, settings store, routes and audit events.** Audit records actor, action, target type/id, timestamp and safe metadata; never request bodies or secret values.
- [x] **Step 7: Implement deterministic export and preview/apply.** Export JSON includes schema version and SHA-256; import maps IDs in memory, validates all links, returns preview, then repeats checksum/validation inside the apply transaction.
- [x] **Step 8: Implement continuous settings UI.** Left category rail and right content share one soft-volume surface; save status remains beside the changed setting; mobile enters categories with reverse transitions.
- [x] **Step 9: Run settings, MySQL, frontend and build gates.**

```powershell
npm.cmd run test:server -- server/src/services/dataTransfer.test.ts server/src/routes/settings.test.ts
npm.cmd run test:mysql
npm.cmd test -- src/features/settings/SettingsPage.test.tsx
npm.cmd run typecheck
npm.cmd run typecheck:server
npm.cmd run build
```

- [x] **Step 10: Commit or hash P5-T6** with message `feat(settings): add account integrations and safe data transfer`.

### P5-T7: Platform/global E2E, security, responsive, and visual acceptance

**Files:**
- Create: `tests/platform-center.spec.ts`
- Create: `tests/global-tools-settings.spec.ts`
- Create: `tests/platform-security.spec.ts`
- Modify: `tests/responsive-accessibility.spec.ts`
- Modify: `tests/visual-capture.spec.ts`
- Modify: `src/styles/platform.css`
- Modify: `src/styles/settings.css`
- Modify: `src/styles/private-shell.css`

**Interfaces:**
- Produces evidence for PLATFORM-01, GLOBAL-01, SEC-01, MOTION-01, SPACE-01 and STATE-01.

- [x] **Step 1: Write failing platform journeys** for all tabs, connected/degraded/disabled fixtures, filter changes, deep links, visibility-paused polling and partial errors.
- [x] **Step 2: Write failing security journeys** proving raw URL/query injection is rejected, responses contain no configured token/password/cookie, Kubernetes mutation paths return 404 and private platform routes reject anonymous users.
- [x] **Step 3: Write failing global-tool journeys** for command search, keyboard navigation, quick create/context/undo, all settings categories, password/session flow and import preview/no-write/apply.
- [x] **Step 4: Run focused E2E and confirm failures.**

```powershell
npm.cmd run test:e2e -- tests/platform-center.spec.ts tests/platform-security.spec.ts tests/global-tools-settings.spec.ts
```

- [x] **Step 5: Complete responsive CSS** for platform, search, quick record and settings at 1440×900, 1024×768, 768×1024 and 390×844, plus 200% zoom and 320 CSS px reflow. Mobile status order is overall status → alerts → delivery → technical modules; charts keep readable labels/table fallback; no compressed desktop dashboard is allowed.
- [x] **Step 6: Capture and open screenshots plus normal/reduced task-layer filmstrips** for platform overview, every tab, command search, quick record and every settings category. Apply the five veto axes and reject dark NOC styling, fake values, repeated cards, clipped security copy, focus/scroll loss, unreachable fixed controls or polling/animation work after hidden/close.
- [x] **Step 7: Run complete Plan 5 gate.**

```powershell
npm.cmd test
npm.cmd run test:server
npm.cmd run test:mysql
npm.cmd run typecheck
npm.cmd run typecheck:server
npm.cmd run build
npm.cmd run build:server
npm.cmd run test:e2e -- tests/platform-center.spec.ts tests/platform-security.spec.ts tests/global-tools-settings.spec.ts tests/responsive-accessibility.spec.ts
npm.cmd run test:e2e:remote
```

- [x] **Step 8: Commit or hash P5-T7** with message `test(platform): lock operations and global tools acceptance`.

### P5-T8: Platform/global closure and handoff

**Files:**
- Modify: `docs/traceability/requirements.md`
- Modify: project `CURRENT.md`
- Modify: the active implementation session selected at P5 entry under ADR-020; scan the highest occupied `SNNN` and never reuse S015–S018.
- Create: `outputs/final/platform-global-verification.md`

**Interfaces:**
- Closes PLATFORM-01 and GLOBAL-01 as `verified-local`; adds global-tool evidence to LIFE-19, LIFE-21 and LIFE-22; records SEC-01 local evidence pending Helm/RBAC verification in Plan 6.

- [x] **Step 1: Record adapter fixtures, cache behavior, polling, response-redaction scan, search/quick-record/settings journeys, browser/OS/font/DPR/viewport/color-scheme/reduced-motion metadata, dependency-lock hash and every screenshot/filmstrip/trace path** in the verification file without credentials or raw private data.
- [x] **Step 2: Reverse-audit PLATFORM-01, GLOBAL-01 and the P5 portions of LIFE-19/LIFE-21/LIFE-22** from spec to API/UI/security/error/mobile evidence; reopen rows with missing evidence.
- [x] **Step 3: Update traceability, the selected session and CURRENT** with next action `P6-T1 migration job and media storage Helm test` and current external-access status.
- [x] **Step 4: Commit or hash P5-T8** with message `docs(platform): close operations and global tools gate`.

## Plan 5 Self-Review

- Spec coverage: all platform tabs/adapters, honest connection states, security bounds, original/life personal search, context quick create, account/settings, complete life-aware export/import and audit are mapped.
- Placeholder scan: adapters, paths, metric keys, cache timings, limits, settings routes, excluded export data and validation commands are exact.
- Type consistency: platform statuses and tabs are stable across API/UI; search excludes platform types; settings responses never share secret configuration types.
- Scope: deployment RBAC, ServiceMonitor, Grafana resources and real external connections remain explicit Plan 6 gates rather than local claims.
