# LifeOps Daylight Workbench Implementation Plan

> **Status: superseded; historical audit only; do not execute.** ADR-016 and `2026-08-09-00-lifeops-final-master-plan.md` plus its ordered `01`–`06` work packages are the only current implementation authority.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the public scroll-driven technology universe and private galaxy with a semantic public exploration page and a bright, task-first LifeOps workspace while preserving the complete data loop and production backend/deployment assets.

**Architecture:** Public navigation is driven by a five-item `PublicDestination` content model and one SVG path geometry source shared by visible tracks and motion. The authenticated application keeps a stable top shell, adds command search and quick capture, and renders route-specific task surfaces on a white twelve-column canvas. Existing repository ports remain unchanged.

**Tech Stack:** React 19, TypeScript 7, React Router 7, CSS, Vitest, Testing Library, Playwright, Vite.

## Global Constraints

- Public page uses native vertical scrolling; scroll never performs navigation.
- Public orbit contains exactly five semantic content destinations and no technology logos.
- Private application is always light and contains no planets, orbits, galaxy, left sidebar, or card-wall dashboard.
- First authenticated view prioritizes “what should I do today?”.
- All behavior changes follow red-green-refactor; no production behavior is added before a failing test.
- Preserve server/API/MySQL/Helm/GitHub workflow behavior.
- Reduced motion, keyboard navigation, 44px touch targets, and mobile overflow are release gates.

---

### Task 1: Public destination model and path-bound orbit

**Files:**
- Create: `src/content/publicDestinations.ts`
- Create: `src/content/publicDestinations.test.ts`
- Modify: `src/components/public/PublicOrbit.tsx`
- Modify: `src/components/public/PublicOrbit.test.tsx`
- Create: `src/components/public/OrbitGlyph.tsx`

**Interfaces:**
- Produces: `PublicDestination`, `publicDestinations`, `getPublicDestination(slug)`.
- Produces: `<PublicOrbit />` links under `/explore/:slug` with `data-public-object` and `data-path-id`.

- [ ] **Step 1: Write failing model and component tests** asserting exactly five unique destinations, semantic glyphs, `/explore/:slug` routes, no technology mark, and every node references one rendered SVG path.
- [ ] **Step 2: Run `npm.cmd test -- src/content/publicDestinations.test.ts src/components/public/PublicOrbit.test.tsx`** and verify failure is caused by missing model/markup.
- [ ] **Step 3: Implement the typed model, authored SVG glyphs, three SVG paths and five path-bound links**; use the same path IDs for visible geometry and CSS `offset-path` values.
- [ ] **Step 4: Re-run the focused tests** and keep existing tests green.

### Task 2: Native-scroll public home

**Files:**
- Modify: `src/pages/PublicHomePage.tsx`
- Modify: `src/pages/PublicHomePage.test.tsx`
- Delete: `src/motion/publicStoryMachine.ts`
- Delete: `src/motion/publicStoryMachine.test.ts`
- Modify: `src/styles/index.css`

**Interfaces:**
- Consumes: `publicDestinations`, `<PublicOrbit />`.
- Produces: `data-native-scroll="true"`, `#life-loop`, `#selected-work`, `#public-notes`, `#public-close` sections.

- [ ] **Step 1: Replace old unit expectations with failing assertions** for native-scroll sections, absence of flight nodes/technology foundation, and accessible login/theme controls.
- [ ] **Step 2: Run the focused public page test** and confirm it fails against the scroll state machine.
- [ ] **Step 3: Rebuild the page as a normal document** with one viewport hero, real loop demonstration, selected K8s/LifeOps project evidence, recent notes/snapshots and a closing login action.
- [ ] **Step 4: Remove the obsolete scroll state machine and flight geometry code**, then run all unit tests.

### Task 3: Public destination pages and persistent exit

**Files:**
- Create: `src/pages/PublicDestinationPage.tsx`
- Create: `src/pages/PublicDestinationPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/content/technologyWorlds.ts`
- Modify: `src/pages/TechnologyWorldPage.tsx`

**Interfaces:**
- Produces: `/explore/:slug`, sticky `返回首页` control, Escape/back behavior, and project-only technology foundation.
- Preserves: legacy `/worlds/:slug` pages for direct links.

- [ ] **Step 1: Write failing route tests** for all five pages, sticky return control and semantic content; assert K8s/React/Docker content appears only under the project destination.
- [ ] **Step 2: Verify the route tests fail** because `/explore/:slug` is absent.
- [ ] **Step 3: Implement destination-specific long-form layouts** and a persistent navigation bar; restore focus to the selected public object on return.
- [ ] **Step 4: Run focused and full unit tests**.

### Task 4: One-time login boundary transition

**Files:**
- Create: `src/components/auth/EntryTransition.tsx`
- Create: `src/components/auth/EntryTransition.test.tsx`
- Modify: `src/pages/PublicHomePage.tsx`
- Modify: `src/components/auth/LoginWindow.tsx`
- Modify: `src/styles/index.css`

**Interfaces:**
- Produces: `EntryTransition` phases `idle | entering | complete` and `onComplete` callback.
- Consumes: current public theme; sends `portalEntry` route state.

- [ ] **Step 1: Write failing fake-timer tests** for one 760ms transition, reduced-motion completion, and duplicate-submit protection.
- [ ] **Step 2: Confirm failure**, then implement the white aperture/straightening-line overlay with content visible by default.
- [ ] **Step 3: Integrate login success and route navigation** without changing authentication semantics.
- [ ] **Step 4: Re-run authentication and entry tests**.

### Task 5: Stable daylight workspace shell, search and quick capture

**Files:**
- Modify: `src/components/private/PrivateUniverseLayout.tsx`
- Modify: `src/components/private/PrivateUniverseLayout.test.tsx`
- Delete: `src/components/private/PrivateOrrery.tsx`
- Delete: `src/motion/privateOrbit.ts`
- Delete: `src/motion/privateOrbit.test.ts`
- Create: `src/components/private/WorkspaceHeader.tsx`
- Create: `src/components/private/CommandCenter.tsx`
- Create: `src/components/private/QuickCapture.tsx`
- Create: `src/components/private/workspaceSearch.ts`
- Create: `src/components/private/workspaceSearch.test.ts`

**Interfaces:**
- Produces: stable top nav routes, `Ctrl/Cmd+K` search, quick plan/record capture and always-light `data-workspace-theme="daylight"` shell.
- Consumes: `LifeState`, `RepositoryPort`.

- [ ] **Step 1: Write failing component and pure search tests** covering no galaxy/sidebar, six top routes, keyboard search, relevant result routing and quick capture.
- [ ] **Step 2: Run focused tests and verify expected failures**.
- [ ] **Step 3: Implement the stable shell and overlays** with focus traps, Escape recovery, loading/error states and 44px targets.
- [ ] **Step 4: Delete orbital runtime code only after new tests pass**, then run the full unit suite.

### Task 6: Task-first Today canvas and Plans route

**Files:**
- Modify: `src/pages/private/PrivateHomePage.tsx`
- Modify: `src/pages/private/PrivateHomePage.test.tsx`
- Create: `src/pages/private/PlansPage.tsx`
- Create: `src/pages/private/PlansPage.test.tsx`
- Modify: `src/pages/private/TodayPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `/app` day canvas, `/app/plans` planning surface, legacy `/app/today` redirect.
- Preserves: `createPlan` and `completePlan` repository methods.

- [ ] **Step 1: Write failing tests** for 06:00–22:00 timeline, pending/done placement, next actions, review reminder, recent records, plan creation and completion.
- [ ] **Step 2: Verify failures against the galaxy overview**.
- [ ] **Step 3: Implement composition A** as an unframed 8/4 column canvas and a dedicated plan list/editor.
- [ ] **Step 4: Run focused tests and the repository suite**.

### Task 7: Redesign task-specific loop surfaces

**Files:**
- Modify: `src/components/private/PrivateSurface.tsx`
- Modify: `src/pages/private/RecordsPage.tsx`
- Modify: `src/pages/private/ReviewsPage.tsx`
- Modify: `src/pages/private/KnowledgePage.tsx`
- Modify: `src/pages/private/SnapshotsPage.tsx`
- Modify: related existing tests under `src/pages/private/`

**Interfaces:**
- Preserves: plan → record → review → knowledge → snapshot field selection → publish/revoke.
- Produces: route-specific DOM structures and consistent route focus behavior.

- [ ] **Step 1: Add failing layout/behavior assertions** for record stream, evidence review, search-first knowledge list and editor/preview publishing studio.
- [ ] **Step 2: Run focused tests and verify the failures**.
- [ ] **Step 3: Remove constellation/galaxy language and reshape each surface** without changing repository method signatures.
- [ ] **Step 4: Run all unit tests** and fix only regressions proven by failures.

### Task 8: Design tokens, motion, responsive and accessibility floor

**Files:**
- Modify: `src/styles/index.css`
- Modify: `src/theme/theme.ts`
- Modify: `src/theme/theme.test.ts`
- Modify: `index.html`

**Interfaces:**
- Produces: restrained daylight tokens, public day/night fields, 160–260ms workspace transitions, 700–900ms one-time entry, reduced-motion fallbacks.

- [ ] **Step 1: Add failing theme tests** proving automatic day/night boundaries remain public-only while private shell stays daylight.
- [ ] **Step 2: Implement tokens and responsive rules** for 1440px, 1024px, 768px and 390px; use 12–16px radii only where a bounded control is necessary.
- [ ] **Step 3: Add the emitted direction contract as the first body child** and verify `cb94c32e` survives `npm.cmd run build`.
- [ ] **Step 4: Run typecheck and unit tests**.

### Task 9: Browser journeys, performance and release evidence

**Files:**
- Modify: `tests/public-home.spec.ts`
- Modify: `tests/private-loop.spec.ts`
- Modify: `tests/responsive-accessibility.spec.ts`
- Modify: `tests/visual-capture.spec.ts`
- Modify: `README.md`
- Modify at finish: `DESIGN.md`

**Interfaces:**
- Produces: fresh desktop/mobile screenshots and a final verification report.

- [ ] **Step 1: Rewrite Playwright expectations** for five path-bound objects, native scroll, persistent exit, public day/night, one-time entry, daylight workspace, command search, quick capture and complete data loop.
- [ ] **Step 2: Run `npm.cmd run test:e2e` and verify failures before completing missing browser behavior**, then make the smallest fixes.
- [ ] **Step 3: Run `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build`, `npm.cmd run test:server`, `npm.cmd run typecheck:server`, and `npm.cmd run test:e2e`**.
- [ ] **Step 4: Capture desktop and 390px screenshots in one round**, fix all material visual defects in one batch, and confirm with one final round.
- [ ] **Step 5: Run Impeccable detector once, document the built design in `DESIGN.md`, and update README truthfully**; do not claim UHub or Kubernetes deployment.

## Self-review

- Spec coverage: all approved public, detail, login, private, functional, responsive, accessibility and performance requirements map to Tasks 1–9.
- Placeholder scan: no `TBD`, `TODO`, “similar to” or unspecified error-handling step remains.
- Type consistency: public destinations use `slug`; private repository interfaces remain unchanged; new workspace utilities consume existing `LifeState` and `RepositoryPort`.
- Execution choice: user delegated implementation and requested goal mode, so this plan will be executed inline with checkpoints rather than pausing for a second execution-choice prompt.
