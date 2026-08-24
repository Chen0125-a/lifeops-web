# LifeOps Web Final Delivery Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement every approved LifeOps Web requirement, publish immutable Web/API images to UHub, and deliver a validated user-operated Kubernetes deployment package without losing any feature or overstating availability.

**Architecture:** Work is split into six ordered vertical plans. Every plan delivers a runnable, testable slice and closes its requirement IDs before the next plan starts; the master ledger is the only completion authority. GSAP exclusively owns the public home/detail/login/aperture animation subtree, Motion exclusively owns private interruptible layout/overlay transitions, and neither engine may control the same element property. Fastify exposes versioned domain APIs, and MySQL migrations preserve existing plans/snapshots while adding life catalog, inventory, recipe, planning, commerce and analytics transactions. Future life forecasts follow current facts; completed history is immutable unless explicitly recalculated.

**Tech Stack:** React 19.2.8, TypeScript 7.0.2, React Router 7.18.2, Motion 12.43.0, GSAP 3.15.0, @gsap/react 2.1.2, TanStack React Query 5.101.4, React Markdown 10.1.0, Remark GFM 4.0.1, Rehype Sanitize 6.0.0, fflate 0.8.3, Fastify 5.11.3, Fastify Multipart 10.1.0, MySQL 8.4.10, AWS S3 Client 3.1097.0, prom-client 15.1.3, Vitest 4.1.10, Playwright 1.62.1, Axe Playwright 4.12.1, Lighthouse 13.4.1, Helm 3.19.0, GitHub Actions, UHub, Argo CD.

## Global Constraints

- S012 remains the protected baseline only where ADR-016 does not supersede it.
- Public night is `#020306`; public geometry is the ADR-029 reference-locked four-ring system on a `1132×750` stage with center `(792,371)`, scale `.85`, base diameters `353/501/649/797` and one uncompensated 1px masked gradient, never three tidy SVG paths or the rejected offset-ellipse candidate.
- Public primary objects are sundial, navigation flag, open book, viewfinder, and tree/archive ring; technology logos never become primary orbit navigation.
- The public center is `05 / 此刻正在发生`, never the `PRIVATE SYSTEM` black sphere, a dashboard pulse or a second information widget. Object labels remain visible at every breakpoint.
- The outer ring must remain wholly inside the viewport safe inset in default, login, day/night, reduced-motion and every required breakpoint; clipping or hiding overflow is not acceptance evidence.
- The four tracks rotate `CCW30/CW40/CW50/CCW60`. Five objects use the approved 0.72-second staggered `0.3R / A-180°` spiral contract with independent path/upright/material counters, then join the live rings without a frame jump. Pause/resume lives in the header; focus pauses the owning ring and hidden/offscreen/reduced motion suspends the environment.
- Night login uses a deep indigo translucent identity surface, not a white panel. At 1440px the target relationship is approximately `520px` outer ring, `32px` visible gap and `460px` login panel; compact and full-screen task-layer variants must preserve the same hierarchy and complete-ring visibility.
- Mouse wheel only performs native document scrolling; entry and exit are click, keyboard, browser-back, or fixed-return actions.
- Private UI contains no planets, galaxy, left navigation plus generic content frame, right-angle paper sheets, or equal-card dashboard wall.
- Private layout uses a bright continuous canvas and soft-volume hierarchy; orange/red only communicate real warning/critical state.
- Route, panel, filter, detail, and return transitions preserve spatial context and state. Approved tokens are feedback 120ms, state 180ms, private route 240ms, task-layer in/out 320/220ms, login open/close 480/360ms, aperture 680ms and day/night 900ms; reduced motion removes ambient and large spatial movement and uses at most about 80ms for necessary continuity.
- GSAP Core + MotionPathPlugin + @gsap/react are code-split to public/detail/login only; Motion remains private-only. ScrollTrigger, ScrollSmoother, wheel navigation, generic scroll reveals, global parallax and competing transform owners are forbidden.
- `1440×900`, `1024×768`, `768×1024` and `390×844` are mandatory evidence viewports; 200% text zoom and 320 CSS px reflow are supplemental gates. Tablet and mobile reorder by task priority instead of shrinking desktop cards.
- Every page implements loading, data, empty, saving/saved, permission, network error, conflict, delete/undo, and disconnected states that apply to that page.
- Production data comes from Fastify/MySQL. Sample data is allowed only in an explicitly marked local-preview adapter and never in a production image.
- Records persist nullable `coverMediaId` independently from ordered `mediaIds`; create/omit/clear/select semantics, same-owner attached-image validation, active-cover removal atomicity and private-media authorization are server truths. The page alone decodes one `source=<goal|project|task|habit>:<id>` into existing `linkType + linkId`; malformed or duplicate values remain a scoped filter error and never trigger table inference or a malformed API request.
- All private data is scoped by `user_id`; public endpoints return published copies only.
- Platform adapters are read-only, allowlisted, bounded, sanitized, and credential-free in the browser. Kubernetes access never includes Secret read, exec, create, update, patch, or delete.
- Obsidian V1 sync covers knowledge, reviews and approved life projections only; it is user-triggered, previews first, never propagates deletion automatically, and backs up before batch writes. Raw inventory transactions, idempotency, schedule conflicts, secrets and platform data never enter Markdown.
- Private top navigation is exactly `总览｜目标与项目｜日程｜习惯｜记录｜回顾｜知识｜生活｜发布｜平台`; search, quick record and account/settings remain utilities, not extra primary tabs. The life secondary navigation is exactly `今日｜计划｜食谱｜库存｜健身｜采购｜分析｜数据`, with a persistent calendar entry. The life workspace inherits the approved bright continuous canvas and must not introduce a second shell, fixed global sidebar or equal-card wall.
- Future/uncompleted life plans use current effective catalog/recipe facts; completed meals, uses, purchases and training keep actual snapshots. Cash expenditure and consumption cost remain separate.
- `LIFE-03`/`LIFE-13` catalog supplement/household facts use one optional `profile` discriminated by the exact item kind. Supplement serving/ingredients/frequency/user instructions/reminders, household-consumable purchase/cycle/depletion and household-durable value/lifecycle/warranty/maintenance/retirement/set relations are factual-only, kind-compatible and persisted in the existing migration-006 `life_item_profiles.profile_data JSON`; unknown or advice-like fields are rejected and no new migration is created.
- Release remains GitHub Actions → UHub → GitOps values. Argo CD is the recommended user-operated deployment consumer; Jenkins is a later equivalent learning track and Harbor is optional.
- Phase-1 remains `2 LB + 1 control-plane + 2 worker`; single MySQL/NFS/control-plane boundaries must be stated, not marketed as HA.
- Tests are written before behavior, and a requirement cannot be marked complete without current automated and visual evidence.
- P2 must establish a public-home/login golden slice before repeating public details; P3 must establish a private-shell/overview/complex-operation golden slice before repeating private/life surfaces. A golden slice is a living craft baseline, not permission to clone one generic page skeleton.
- Every UI task has five independent veto axes: visual identity, page-native structure, state/data truth, accessibility, and performance/motion. Passing tests or atom counts cannot compensate for a generic, ordinary or brand-inconsistent whole page; the primary executor must open and review every required visual artifact.
- Current source and project-memory directories are not Git repositories. Never claim a commit exists; at execution start locate the intended repository or request explicit authority before initialization.
- Until a formal Git repository exists, every evidence-bearing task uses a deterministic `uncommitted-local-checkpoint`: a sorted allowlisted file/SHA-256 manifest plus a root SHA-256. Directory timestamps and ad hoc changed-file hashes are not sufficient freshness evidence; formal publication still requires an approved Git revision.
- The source-clause registry covers all five hash-locked authority files and all six P1–P6 work packages before P1 starts; future-package clauses cannot remain outside the initial completeness audit.
- This plan never builds or administers the Kubernetes cluster and never deploys, reconciles, rolls back or smoke-tests LifeOps in the user's cluster. The user owns cluster construction and application deployment; P6 ends at UHub digests plus a validated deployment handoff package.
- Both final image digests require an actually generated, digest-bound and verifiable SBOM plus provenance. Missing/unknown attestations cannot close DELIVERY-01; registry referrer limitations may change artifact storage, not the evidence requirement.
- `build-ha-k8s-platform` is retired from this Web project and must not be invoked as an execution or portability dependency.
- The older files `2026-08-09-01-private-universe-motion.md`, `2026-08-09-02-api-mysql.md`, `2026-08-09-03-kubernetes-cicd.md`, and `2026-08-09-lifeops-daylight-workbench.md` are superseded historical records and must not be executed. This master plus the ordered `01`–`06` plans below are the only implementation authority.

---

## Plan Set and Order

| Order | Plan | Runnable deliverable | Entry gate | Exit gate |
|---|---|---|---|---|
| 1 | `2026-08-09-01-lifeops-foundation-data-plan.md` | Versioned schema, original/life domain APIs, transactions, query/motion foundations | Execution-guard plan approved; validator startup/handoff and fresh-context drill green | Original/life API/MySQL compatibility suite green |
| 2 | `2026-08-09-02-lifeops-public-auth-plan.md` | Final public orbit, details, published reads, login transition | Plan 1 green | Public/auth unit + E2E + visual green |
| 3 | `2026-08-09-03-lifeops-private-core-plan.md` | Original private domains plus full life workspace | Plan 2 green | Original/life CRUD + E2E + visual green |
| 4 | `2026-08-09-04-lifeops-knowledge-publishing-obsidian-plan.md` | Knowledge, approved life Obsidian projections, publishing, RSS/public versions | Plan 3 green | Content/privacy/sync tests green |
| 5 | `2026-08-09-05-lifeops-platform-global-plan.md` | Platform center, original/life search, quick create, settings, export | Plan 4 green | Adapter/security/global-tool tests green |
| 6 | `2026-08-09-06-lifeops-production-delivery-plan.md` | Images, Helm/GitOps, UHub, exact-digest smoke and user deployment handoff | Plans 1–5 green | All DoD rows verified through registry/package boundary |

Do not begin a later plan because its UI appears easier. A failed exit gate keeps the current plan active.

## Locked File Architecture

- `AGENTS.md`: mandatory project-wide execution contract for every future session or agent.
- `docs/superpowers/plans/2026-08-09-execution-control.md`: live single-task state machine, authority-hash guard and pause/resume ledger.

### Frontend

- `src/App.tsx`: provider shell and route table only.
- `src/api/httpClient.ts`: cookies, CSRF, JSON/error decoding, abort signals.
- `src/api/queryKeys.ts`: stable cache keys.
- `src/api/*Api.ts`: one API client per domain.
- `src/domain/*.ts`: frontend contracts and deterministic calculations; no React.
- `src/components/system/`: app shell, route motion, overlays, state boundary, accessible charts and Markdown.
- `src/features/<domain>/`: domain pages, editors, inspectors, hooks, and focused tests.
- `src/features/life/`: life shell, today/calendar, libraries, recipes/cooking, plans/fitness, household, shopping/budgets, analytics and data-management surfaces; no generic card-wall abstraction.
- `src/pages/public/`: public home/detail/public-entry route composition.
- `src/styles/`: `tokens.css`, `base.css`, `motion.css`, `public.css`, `private-shell.css`, and domain CSS files. `src/styles/index.css` becomes import-only.

### API

- `server/src/app.ts`: Fastify construction, shared hooks, route registration only.
- `server/src/routes/*.ts`: auth, each life domain, public content, media, search, platform, settings.
- `server/src/domain/life/`: catalog, inventory, recipes, planning and commerce calculations with explicit complete/incomplete results and no React/Fastify dependencies.
- `server/src/domain/*.ts`: API contracts and validation-independent domain calculations.
- `server/src/store/lifeStore.ts`: composed store interfaces.
- `server/src/store/memory/`: deterministic in-memory implementation for route tests.
- `server/src/store/mysql/`: facade plus focused domain stores; files stay below one responsibility.
- `server/src/integrations/`: Kubernetes, Prometheus, Alertmanager, Elasticsearch, Argo CD, GitHub and bounded cache.
- `server/src/media/`: storage port, filesystem adapter, S3-compatible boundary, validation.
- `server/migrations/NNN_*.sql`: ordered, checksum-tracked migrations; no mutation of applied 001–011 after their compatibility gates. ADR-025 assigns `011_goal_hierarchy_recovery.sql`; ADR-026 assigns `012_record_cover_identity.sql`; the still-uncreated knowledge, publishing, search and settings/audit migrations shift intact to 013–016, keeping the sequence unique and contiguous through `016_settings_audit.sql`.

### Delivery and evidence

- `deploy/helm/lifeops-web/templates/`: workload, migration, media, RBAC, monitoring and network resources.
- `scripts/`: deterministic GitOps update, image/registry release validation and user-run deployment smoke commands.
- `tests/`: Playwright journeys grouped by public, core, publishing, platform, accessibility and exact-image remote smoke.
- `outputs/final/`: visual captures, JSON test summaries, image/registry evidence and sanitized delivery manifests; never credentials or raw sensitive logs.
- `docs/traceability/requirements.md`: live requirement ledger with evidence links.

## Requirement Coverage Ledger

| Requirement | Implemented by | Final evidence |
|---|---|---|
| PUB-01 | P2-T1, P2-T2 | orbit unit geometry + public visual/E2E |
| PUB-02 | P2-T4 | five page-native detail journeys + phase-exact return-state E2E |
| AUTH-01 | P2-T3 | login-first golden slice + real-login remote E2E + reduced-motion aperture test |
| APP-01 | P3-T1 | overview component/E2E/visual |
| GOAL-01 | P1-T3, P3-T2 | MySQL risk-note persistence + owner/version archive/restore audited reversal linkage + goals E2E |
| SCHEDULE-01 | P1-T4, P3-T3 | recurrence/conflict unit + schedule E2E |
| HABIT-01 | P1-T5, P3-T4 | habit rule unit + rhythm E2E |
| RECORD-01 | P1-T6, P3-T5 | media/auth integration + record E2E |
| REVIEW-01 | P1-T7, P3-T6 | aggregation unit + review E2E |
| KNOW-01 | P4-T1, P4-T2 | knowledge API/Markdown/search tests |
| OBS-01 | P4-T3 | filesystem adapter + conflict/backup tests |
| PUBLISH-01 | P4-T4, P4-T5 | public-copy/privacy/scheduling E2E |
| PLATFORM-01 | P5-T1, P5-T2, P5-T3 | adapter contract/security/UI E2E |
| GLOBAL-01 | P5-T4, P5-T5, P5-T6 | search/quick-create/settings E2E |
| MOTION-01 | P1-T2, P2-T3, P2-T4, P6-T5 | engine ownership, motion unit, filmstrip/trace, interruption and reduced motion |
| SPACE-01 | P2-T5, P3-T7, P6-T5 | breakpoint visual review |
| STATE-01 | P1-T2 and every page task | state-boundary unit + failure journeys |
| DATA-01 | P1-T1 through P1-T13 | migration checksum + original/life MySQL integration |
| SEC-01 | P1-T1, P4-T4, P5-T1, P6-T2 | isolation, XSS, SSRF, RBAC and manifest checks |
| DELIVERY-01 | P6-T1 through P6-T8 | double UHub digest, exact-image smoke, SBOM/provenance and validated deployment package |
| LIFE-01 | P3-T8, P3-T13 | life shell/today overview E2E + visual |
| LIFE-02 | P1-T11, P3-T8, P3-T13 | calendar/day-plan API + desktop/mobile E2E |
| LIFE-03 | P1-T8, P3-T9 | catalog API/MySQL + ingredient/supplement UI |
| LIFE-04 | P1-T8, P1-T11, P3-T9, P3-T11 | medicine data/schedule + safety UI/E2E |
| LIFE-05 | P1-T8, P3-T9 | deterministic conversion unit/API/UI tests |
| LIFE-06 | P1-T8, P1-T10, P1-T11, P3-T9 | effective facts + future/history integration |
| LIFE-07 | P1-T10, P3-T10 | recipe/cooking API + UI/E2E |
| LIFE-08 | P1-T10, P3-T10 | bidirectional query + list/graph UI |
| LIFE-09 | P1-T11, P3-T11 | template/apply/sync/copy API + UI/E2E |
| LIFE-10 | P1-T11, P3-T11 | unified schedule/completion API + UI |
| LIFE-11 | P1-T9, P1-T11, P1-T12, P3-T11 | ledger/idempotency/policy/forecast MySQL + E2E |
| LIFE-12 | P1-T10, P3-T10 | prepared-food transaction + cooking E2E |
| LIFE-13 | P1-T8, P3-T9 | household model + hierarchy/value UI |
| LIFE-14 | P1-T12, P3-T12 | shopping/purchase/refund API + E2E |
| LIFE-15 | P1-T12, P3-T8, P3-T12 | separate cost/budget calculations + UI |
| LIFE-16 | P1-T12, P3-T12 | traceable analytics API + accessible charts |
| LIFE-17 | P1-T8, P3-T9 | taxonomy/batch/ordering + impact preview |
| LIFE-18 | P1-T8, P3-T9 | trash/restore/reference protection |
| LIFE-19 | P1-T12, P3-T12, P5-T6 | versioned export/import + transaction rollback |
| LIFE-20 | P4-T7, P4-T8 | life projection/conflict/backup/fallback |
| LIFE-21 | P3-T13, P5-T4, P5-T5 | stable routes/search/quick create/return state |
| LIFE-22 | P1-T9 through P1-T12, P3-T13, P5-T6 | idempotency/version/offline/import conflict |
| LIFE-23 | P3-T8 through P3-T13, P6-T5 | responsive/a11y/motion visual acceptance |
| LIFE-24 | P1-T8, P3-T9, P3-T13, P6-T2 | medicine boundary/privacy/security evidence |

## ADR-023 P1-T11 medicine occurrence execution contract

- `009_life_planning.sql` owns a bounded, owner-scoped and versioned `life_medicine_recurrence_occurrences` ledger. Rule create/update/delete and occurrence generation/reconciliation are one transaction and never renumber migration 010 or later work.
- Calendar and date timeline reads merge day-plan items with active medicine occurrences without copying occurrences into day-plan JSON or changing unrelated day-plan versions. Occurrence-only dates remain reachable.
- Unified completion accepts exactly one discriminated source: an existing day-plan item or a medicine occurrence. The immutable snapshot stores that source identity; occurrence completion, actual inventory deduction, actual cost and status update are one idempotent consistent-snapshot transaction.
- Rule update/delete reconciles only future incomplete occurrences. Past incomplete and every skipped, cancelled, completed, reversed or snapshot history row remain stable. Undo restores `planned` only when the current active rule still contains the occurrence; otherwise it restores `cancelled`.
- P1-T11 cannot close without focused API/store behavior, exact MySQL 8.4.10 constraints/transactions/concurrency, Memory/MySQL parity, owner/version/idempotency coverage, frontend transport contracts, full regressions, typechecks and both builds. This API/domain slice does not waive later P3 browser evidence.

## ADR-024 P1-T12 inventory-policy and shopping-recalculation contract

- Add one owner-scoped, versioned inventory policy per catalog item in still-unreleased migration 010: non-negative minimum stock, positive package quantity and an explicit compatible unit. Never modify applied migrations 001–009.
- Add a service-side idempotent recalculation operation with an inclusive `through` date. It derives future incomplete planned demand from day plans, effective usable stock from the inventory ledger/batches and outstanding quantity from formal open/partial shopping rows; clients do not author these derived facts.
- Convert every input to the policy unit, calculate `max(0, planned demand + minimum stock - effective stock - outstanding formal quantity)`, then round positive shortages up to the package quantity. Missing or incompatible conversion returns an incomplete item and writes no invented suggestion.
- Read all inputs from one owner-consistent snapshot and atomically replace only system-derived suggestions/reasons. Preserve manual suggestions, formal lists, purchases, refunds and immutable history. Version/idempotency conflicts, rollback and Memory/MySQL parity are mandatory.
- P1-T12 cannot close until focused behavior, exact MySQL 8.4.10 and full regression/type/build gates pass. P1-T13 must prove policy persistence, recalculation, partial-purchase remainder and reconnect behavior before the project advances to P2.

## Task Completion Protocol

For every `P<plan>-T<task>` task:

1. Verify the authority hashes, then mark only the current task `in_progress` in `2026-08-09-execution-control.md`, the active plan and `docs/traceability/requirements.md`.
2. Write the named failing test and run the exact focused command.
3. Capture the expected failure reason; infrastructure failure does not count as a red test.
4. Implement only the behavior named by the task.
5. Run focused tests, then the plan's regression gate.
6. Inspect the changed UI in a real browser at all four required viewports when the task changes UI; also verify key states, keyboard/focus, reverse return, reduced motion and the applicable golden slice. Generated screenshots must be opened, not merely saved.
7. Record changed files, commands, exit codes, screenshots/filmstrip/trace, browser/version, viewport/DPR/zoom, fonts, theme, fixture/API scenario hash, motion preference and unresolved external facts.
8. Commit only when a valid Git repository exists. Without Git, generate the sorted allowlisted file/SHA-256 manifest and root SHA-256 required by the execution-completeness specification, then record that `uncommitted-local-checkpoint` in the session.
9. Mark the task complete only after all required evidence exists.

## Pause/Handoff Template

Every pause or session boundary first updates `2026-08-09-execution-control.md`, then writes this exact structure to the new project session file and updates `CURRENT.md`:

```markdown
## Active plan and task
- Plan: P3 Private Core
- Task: P3-T4 Habits
- Status: in_progress

## Completed requirement IDs
- HABIT-01: API/store green; UI visual review pending

## Fresh verification
- `npm.cmd test -- src/features/habits`: PASS, 14 tests
- `npm.cmd run test:mysql -- habits`: PASS, 5 tests

## Changed files
- Hash command: `Get-FileHash -Algorithm SHA256 server/src/domain/habits.ts,src/features/habits/HabitsPage.tsx`
- Saved result rule: record each path followed by the exact 64-character hash returned by the command; never save an output-description token in place of the hash.

## Unverified external state
- Docker, GitHub and UHub release access: not checked in this session

## Next atomic action
- Run the 390px habit page Playwright visual test and inspect `outputs/final/habits-mobile.png`.
```

The session must contain the literal hash values returned by `Get-FileHash -Algorithm SHA256` before the handoff is considered valid.

## Regression Gates

After every API task:

```powershell
npm.cmd run test:server
npm.cmd run typecheck:server
```

After every frontend task:

```powershell
npm.cmd test
npm.cmd run typecheck
```

After each plan:

```powershell
npm.cmd test
npm.cmd run test:server
npm.cmd run test:mysql
npm.cmd run typecheck
npm.cmd run typecheck:server
npm.cmd run build
npm.cmd run build:server
npm.cmd run test:e2e
npm.cmd run test:e2e:remote
```

MySQL and remote E2E commands require the documented real MySQL test environment; a skipped suite is not a pass.

## Master Completion Gate

LifeOps Web is complete only when all 44 ledger rows have current implementation and applicable local/image evidence, both immutable images exist in UHub by digest, exact-digest browser/API/MySQL smoke—including the life transaction sentinel—passes, and the Helm/GitOps/deployment/rollback handoff package passes its static, render and security gates. A local source build, mock adapter, unpushed image, rendered Helm YAML alone or partial platform connection cannot satisfy this gate. Argo `Synced/Healthy` and cluster-entry smoke are user deployment evidence and are intentionally outside this Web completion gate.

## Self-Review

- Spec coverage: all original 20 and LIFE-01 through LIFE-24 appear exactly once in the coverage ledger and map to concrete plan tasks.
- Scope: six independently testable plans match the six work packages approved in the design; no plan may leave placeholder screens for a later plan.
- Type and naming consistency: route names, requirement IDs, durations, technology choices, image registry, Phase-1 topology, storage boundaries and execution evidence match the approved specs and ADR-016 through ADR-024.
- Placeholder scan: the only angle-bracket field in the handoff example is explicitly an instruction to insert command output; no implementation task may save it literally.
- Git truth: plans require commits when a repository exists and SHA-backed local checkpoints otherwise; neither state is misreported.
