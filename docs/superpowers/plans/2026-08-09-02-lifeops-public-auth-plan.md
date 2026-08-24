# LifeOps Public Orbit and Authentication Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the final four-track public entrance, five content-specific detail routes, and a real-authentication transition that continuously moves the orbit scene into the bright private application.

**Architecture:** One typed `OrbitDefinition` array drives the four authored SVG tracks and the five objects through one shared geometric source. GSAP 3.15.0 Core plus MotionPathPlugin, scoped through `@gsap/react` 2.1.2 `useGSAP`, owns every public/detail/login transform and timeline; React owns semantic state and routing. The public home and login form the first golden slice and must pass the whole-page visual gate before any detail layout is replicated. Details use a bounded continuity clone and fixed exits. Authentication enters a pre-painted private daylight canvas only after both real authentication and private-shell readiness resolve.

**Tech Stack:** React 19.2.8, React Router 7.18.2, GSAP 3.15.0, `@gsap/react` 2.1.2, GSAP Core and MotionPathPlugin, TypeScript 7.0.2, SVG, CSS, Vitest, Testing Library, Playwright. Motion 12.43.0 is not used inside the public/detail/login animation subtree.

## Global Constraints

- Keep S012's four offset/discontinuous/non-concentric ellipse feeling and `#020306` night; never restore three neat paths or a regular blue-gray star grid.
- Object and label geometry must be sourced from the same coordinate definitions as the rendered track.
- Tracks are static; the exact object periods are 47, 59, 68, 79 and 87 seconds with deterministic independent phases.
- Labels remain visible at every breakpoint; collision handling moves labels and never hides meaning.
- Desktop public home uses approximately 36% copy and 64% scene; the center is a quiet daylight aperture, never a black `PRIVATE SYSTEM` sphere or a metric widget.
- Wheel/trackpad never enters or exits a route. Mobile may naturally scroll when its content exceeds `100dvh`.
- Every public detail has fixed return, browser-back, Escape, scroll restoration and published-copy isolation.
- Login desktop panel is about 460px and fits in one viewport; mobile login is full-screen with a fixed exit.
- Login scene shift is 14–18vw left, about 90% scale, lower brightness and one-third orbit speed; closing reverses from the live phase and current playheads.
- The 390px login is a full-screen task layer over a stable astrolabe background. Login success takes 680ms in normal motion and at most 80ms under reduced motion, with no white flash.
- A visible pause control, `visibilitychange`, offscreen suspension, keyboard focus continuity and `prefers-reduced-motion` are acceptance requirements, not optional polish.
- Never reuse the rejected beige/monotone/right-angle/generic-workbench visual board.
- Public home plus login is the P2 golden slice. No public detail pattern may be replicated until its day/night, desktop/mobile, keyboard, reduced-motion, filmstrip and performance evidence passes the five-axis veto: identity, page-native structure, state truth, accessibility, and performance/motion.
- Follow the master plan's Git-or-SHA checkpoint rule after every task.

---

### P2-T1: Public destination model, glyphs, and exact ellipse geometry

**Files:**
- Replace: `src/content/publicDestinations.ts`
- Modify: `src/content/publicDestinations.test.ts`
- Create: `src/components/public/orbitGeometry.ts`
- Create: `src/components/public/orbitGeometry.test.ts`
- Replace: `src/components/public/OrbitGlyph.tsx`
- Replace: `src/components/public/PublicOrbit.tsx`
- Modify: `src/components/public/PublicOrbit.test.tsx`

**Interfaces:**
- `PublicCategory = 'now' | 'doing' | 'learning' | 'moments' | 'archive'`.
- `PublicDestination { slug, label, shortLabel, description, glyph, orbitId, periodSeconds, phase, color }`.
- `OrbitDefinition { id, cx, cy, rx, ry, dash, opacity }`.
- Produces: `pointOnEllipse(orbit, phase): { x: number; y: number }`, `ellipsePath(orbit): string`, `ellipseError(orbit, point): number`.
- Produces: `<PublicOrbit sceneState="rest|login|entering" paused={boolean} />` with all five links and one daylight aperture.

- [x] **Step 1: Write failing destination tests** asserting exactly five slugs/routes/glyphs, four unique orbit definitions, exact 47/59/68/79/87 second periods, always-present labels and no technology marks.

```ts
expect(publicDestinations.map((item) => [item.slug, item.glyph])).toEqual([
  ['now', 'sundial'], ['doing', 'navigation-flag'], ['learning', 'open-book'],
  ['moments', 'viewfinder'], ['archive', 'tree-ring'],
])
expect(new Set(publicDestinations.map((item) => item.orbitId))).toEqual(new Set(['orbit-a', 'orbit-b', 'orbit-c', 'orbit-d']))
```

- [x] **Step 2: Write failing geometry tests** for phase 0/0.25/0.5/0.75, normalized ellipse error below `0.0001`, and stable paths from the same definition.

```ts
expect(pointOnEllipse({ cx: 500, cy: 360, rx: 300, ry: 180 }, 0)).toEqual({ x: 800, y: 360 })
expect(ellipseError(orbit, pointOnEllipse(orbit, 0.317))).toBeLessThan(0.0001)
```

- [x] **Step 3: Run focused tests and confirm they fail against S012's current model.**

```powershell
npm.cmd test -- src/content/publicDestinations.test.ts src/components/public/orbitGeometry.test.ts src/components/public/PublicOrbit.test.tsx
```

- [x] **Step 4: Implement geometry and semantic glyphs.** `pointOnEllipse` uses `angle = phase * Math.PI * 2`; `ellipsePath` emits two SVG arc commands; all glyphs use authored SVG paths matching their semantic object.

- [x] **Step 5: Implement scoped GSAP astrolabe timelines.** Register `useGSAP` and MotionPathPlugin once, create one scoped timeline per object from the rendered authored path, seed deterministic phases, and use `gsap.matchMedia()` for responsive and reduced-motion branches. The component must expose a pause control, suspend on `document.hidden` and offscreen state, preserve current playheads across login/reverse, and call `context.revert()` on cleanup. No custom `requestAnimationFrame`, ScrollTrigger, wheel handler, parallax or CSS transform animation may compete with GSAP.

- [x] **Step 6: Re-run focused and frontend regression tests.**

```powershell
npm.cmd test -- src/content/publicDestinations.test.ts src/components/public/orbitGeometry.test.ts src/components/public/PublicOrbit.test.tsx
npm.cmd run typecheck
```

- [x] **Step 7: Commit or hash P2-T1** with message `feat(public): bind life objects to exact orbit geometry`.

### P2-T2: Final public home composition and day/night scene

**Files:**
- Replace: `src/pages/PublicHomePage.tsx`
- Modify: `src/pages/PublicHomePage.test.tsx`
- Create: `src/components/public/DaylightAperture.tsx`
- Create: `src/components/public/DaylightAperture.test.tsx`
- Create: `src/styles/public.css`
- Modify: `src/styles/index.css`
- Modify: `src/theme/theme.ts`
- Modify: `src/theme/theme.test.ts`

**Interfaces:**
- Produces `data-public-scene="rest|login|entering"`, `data-public-theme="day|night"`, one `public-hero` and no duplicate content nav.
- `DaylightAperture` is a quiet, non-clickable light opening with no status label, metric, date or technology copy.

- [x] **Step 1: Write failing home tests** for header-only wordmark/theme/login, 36/64 scene semantics, quiet daylight aperture, five visible object labels, explicit pause/resume, absence of lower duplicate navigation and absence of wheel listeners.

```tsx
expect(screen.getByRole('navigation', { name: '公开内容导航' })).not.toBeInTheDocument()
expect(screen.getAllByTestId('orbit-object')).toHaveLength(5)
expect(screen.getByTestId('daylight-aperture')).toHaveAttribute('aria-hidden', 'true')
```

- [x] **Step 2: Write failing theme tests** for automatic 07:00 day, 19:00 night, manual override until the next boundary, and unchanged private daylight state.
- [x] **Step 3: Run focused tests and confirm the existing long landing page fails.**

```powershell
npm.cmd test -- src/pages/PublicHomePage.test.tsx src/components/public/DaylightAperture.test.tsx src/theme/theme.test.ts
```

- [x] **Step 4: Implement the one-scene public home.** Desktop fits in `100dvh`; mobile uses natural block flow. Remove homepage loop/project/note sections, technology blueprint and scroll-state behaviors. Keep content discoverable through the five objects.

- [x] **Step 5: Implement day/night CSS.** Night background is `#020306`, track strokes stay visible at minimum 0.34 opacity, stars use at least three irregular layers with deterministic CSS positions, and no large blue-gray gradient covers the canvas.

- [x] **Step 6: Run tests, typecheck and production build.**

```powershell
npm.cmd test -- src/pages/PublicHomePage.test.tsx src/components/public/DaylightAperture.test.tsx src/theme/theme.test.ts
npm.cmd run typecheck
npm.cmd run build
```

- [x] **Step 7: Commit or hash P2-T2** with message `feat(public): compose final day and night entrance`.

### P2-T3: Orbit-shift login golden slice and authenticated aperture transition

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Replace: `src/components/auth/LoginWindow.tsx`
- Modify: `src/components/auth/LoginWindow.test.tsx`
- Replace: `src/components/auth/EntryTransition.tsx`
- Modify: `src/components/auth/EntryTransition.test.tsx`
- Modify: `src/pages/PublicHomePage.tsx`
- Create: `src/motion/publicGsap.ts`
- Create: `src/motion/publicGsap.test.ts`
- Create: `src/motion/loginScene.ts`
- Create: `src/motion/loginScene.test.ts`
- Create: `src/styles/motion.css`

**Interfaces:**
- `LoginSceneState = 'closed' | 'opening' | 'open' | 'authenticating' | 'entering' | 'closing'`.
- `loginSceneReducer(state, event)` rejects duplicate submits and illegal completion events.
- `LoginWindow` emits `onSceneStateChange`, calls real `auth.login`, and calls `onAuthenticated` only after success.
- `PublicMotionController` owns scoped object playheads, scene speed, reversible login state and aperture entry; it exposes semantic commands and never exposes DOM nodes to application state.

- [x] **Step 1: Write failing engine-boundary and reducer tests** for exact package versions, one GSAP owner inside the public subtree, open, close from current object playheads, failed-auth return, duplicate-submit rejection, success entering, interruption/reversal and reduced-motion completion.

```ts
expect(loginSceneReducer({ phase: 'authenticating' }, { type: 'SUBMIT' }).phase).toBe('authenticating')
expect(loginSceneReducer({ phase: 'authenticating' }, { type: 'AUTH_FAILED' }).phase).toBe('open')
```

- [x] **Step 2: Write failing component tests** for the 460px desktop task layer, 390px full-screen mobile task layer over a stable astrolabe, visible close, account/password/show-password, progress/error, focus trap, Escape, backdrop, password-manager attributes, one-viewport fit and focus restoration.
- [x] **Step 3: Run focused tests and confirm the expected missing-engine and behavioral failures.** A registry/import error caused only by absent exact GSAP packages is acceptable here; unrelated infrastructure or syntax failure is not.

```powershell
npm.cmd test -- src/motion/publicGsap.test.ts src/motion/loginScene.test.ts src/components/auth/LoginWindow.test.tsx src/components/auth/EntryTransition.test.tsx
```

- [x] **Step 4: Install and lock the approved public engine** with `npm.cmd install --save-exact gsap@3.15.0 @gsap/react@2.1.2`, register `useGSAP` and MotionPathPlugin once, and implement scoped cleanup through `context.revert()`. Do not add ScrollTrigger, ScrollSmoother or another animation dependency.

- [x] **Step 5: Implement the reducer and reversible GSAP login scene.** The astrolabe shifts left 14–18vw, scales to about 90%, reduces noise and speed to one-third. CSS may style non-transform properties but cannot compete for `transform`; close/Escape reverses from the live playhead.

- [x] **Step 6: Implement the successful aperture entry.** Wait for both `auth.login` and private-shell readiness, pre-paint the private daylight canvas, then enter through the aperture in 680ms without `document.startViewTransition`, a white intermediate frame or a fake timeout. Reduced motion completes the same semantic handoff in at most 80ms.

- [x] **Step 7: Test real remote authentication behavior** for rejected credentials, network error, success, double submit, browser back and session refresh; no credential, cookie or raw authorization header enters evidence.

- [x] **Step 8: Re-run focused, type and build gates.**

```powershell
npm.cmd test -- src/motion/publicGsap.test.ts src/motion/loginScene.test.ts src/components/auth/LoginWindow.test.tsx src/components/auth/EntryTransition.test.tsx
npm.cmd run typecheck
npm.cmd run build
```

- [x] **Step 9: Pass the P2 golden-slice browser gate before P2-T4 begins.** Open and inspect public home day/night and login at 1440×900, 1024×768, 768×1024 and 390×844, plus 200% zoom and 320 CSS px reflow. Exercise keyboard, focus restoration, pause/resume, normal/reduced motion and an interrupted reverse. Save screenshots, normal/reduced filmstrips and a performance trace proving no white flash, detached object, hidden label, generic workbench composition, transform contention or persistent animation while paused/hidden.

- [x] **Step 10: Commit or hash P2-T3** with message `feat(auth): complete public login golden slice`.

### P2-T4: Five public details, published-copy reads, and phase-exact return restoration

**Files:**
- Create: `server/src/routes/publicContent.ts`
- Create: `server/src/routes/publicContent.test.ts`
- Modify: `server/src/store/lifeStore.ts`
- Create: `src/api/publicContentApi.ts`
- Replace: `src/pages/PublicDestinationPage.tsx`
- Modify: `src/pages/PublicDestinationPage.test.tsx`
- Create: `src/components/public/PublicDetailShell.tsx`
- Create: `src/components/public/PublicDetailShell.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- `PublicContentSummary { id, slug, category, title, excerpt, coverUrl, publishedAt, featured }`.
- `PublicContentDetail` adds sanitized Markdown body, tags, related items and revision timestamp.
- Routes: `GET /api/v1/public/content?category=`, `GET /api/v1/public/content/:slug`.
- Frontend routes: `/now`, `/doing`, `/learning`, `/moments`, `/archive`.
- `PublicReturnState { sourceObjectId, objectPlayheads, homeScrollY, theme, sourceFocusId }` stores all five live playheads rather than one approximate elapsed value.

- [x] **Step 1: Assert the approved P2-T3 golden-slice evidence is complete and accepted.** If any identity, whole-page structure, state-truth, accessibility or performance/motion veto is open, stop; do not replicate a public detail layout.
- [x] **Step 2: Write failing API tests** proving only public/non-revoked snapshots are returned, private fields are absent, category filtering is strict and unknown slugs return 404.
- [x] **Step 3: Write failing page/shell tests** for five page-native layouts, fixed 64px top return, mobile bottom return, Escape, related contexts, direct-entry behavior, continuity clone cleanup and source focus restoration.

```tsx
expect(screen.getByRole('button', { name: '返回公开星盘' })).toBeVisible()
expect(screen.getByTestId('public-detail-related').children.length).toBeGreaterThanOrEqual(2)
```

- [x] **Step 4: Run focused tests and verify the route/API/return-state failures.**

```powershell
npm.cmd run test:server -- server/src/routes/publicContent.test.ts
npm.cmd test -- src/pages/PublicDestinationPage.test.tsx src/components/public/PublicDetailShell.test.tsx
```

- [x] **Step 5: Implement public read store/route and five distinct page-native layout modules.** When no published item exists, show a truthful category introduction and actionable return; never synthesize articles or metrics. Do not reduce the five destinations to an equal-card template.

- [x] **Step 6: Add route compatibility redirects.** `/explore/now` → `/now`, `/explore/projects` → `/doing`, `/explore/notes` → `/learning`, `/explore/timeline` → `/archive`; direct `/snapshots/:id` keeps its existing published-only behavior until Plan 4 migration.

- [x] **Step 7: Implement bounded GSAP continuity and exact restoration.** A clicked object may create one `data-flip-id` continuity clone inside the public motion subtree; the clone is always removed after entry or interruption. Persist source object ID, all five object playheads, home scroll, theme and focus identity in router/session state. Browser Back, fixed return and Escape reverse to the exact source phase; a direct detail URL has no fabricated source-object animation.

- [x] **Step 8: Run server/frontend/type gates.**

```powershell
npm.cmd run test:server -- server/src/routes/publicContent.test.ts
npm.cmd test -- src/pages/PublicDestinationPage.test.tsx src/components/public/PublicDetailShell.test.tsx
npm.cmd run typecheck
npm.cmd run typecheck:server
```

- [x] **Step 9: Open all five layouts at four required breakpoints** and verify fixed exits, history/scroll/focus restoration, direct entry, interruption, normal/reduced motion, empty/error states and no public-home identity regression.

- [x] **Step 10: Commit or hash P2-T4** with message `feat(public): add published details and phase-exact return`.

### P2-T5: Public responsive, motion, focus, and visual anti-regression

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/base.css`
- Modify: `src/styles/public.css`
- Modify: `src/styles/motion.css`
- Modify: `src/styles/index.css`
- Modify: `src/test/setup.ts`
- Create: `tests/public-final.spec.ts`
- Modify: `tests/responsive-accessibility.spec.ts`
- Modify: `tests/visual-capture.spec.ts`

**Interfaces:**
- Produces public breakpoints at 1440×900, 1024×768, 768×1024 and 390×844.
- Produces screenshot names `public-home-{day|night}-{1440|1024|768|390}.png`, `public-login-*`, `public-detail-*`, paired normal/reduced-motion filmstrips and a browser/performance manifest.

- [x] **Step 1: Write failing browser assertions** for no horizontal overflow, visible labels, at least 44px targets, fixed exit, focus restoration, no wheel navigation, pause/hidden suspension, 200% zoom, 320 CSS px reflow and semantically equivalent reduced motion.
- [x] **Step 2: Add a geometry and ownership sampler** that reads five object centers over 20 animation frames, verifies each center is within 4px of the rendered SVG path after viewBox scaling, and proves only the scoped GSAP owner mutates transforms.
- [x] **Step 3: Run the focused Playwright file and confirm failures.**

```powershell
npm.cmd run test:e2e -- tests/public-final.spec.ts
```

- [x] **Step 4: Split the 45KB monolithic CSS.** `index.css` contains only ordered imports; tokens define color, type, spacing, radius, elevation and motion durations. Public layout must not introduce right-angle paper panels or an equal-card grid.
- [x] **Step 5: Implement collision-safe mobile labels** using deterministic two-sided offsets and leader lines from the orbit point; if two label rectangles intersect, shift the later label along its normal until they no longer overlap.
- [x] **Step 6: Run public E2E at every breakpoint and capture all named screenshots, normal/reduced filmstrips and a trace.** Open every capture. Inspect night track contrast, actual orbit attachment, header crowding, login fit, detail exit position, aperture continuity, frame stability and the five visual-veto axes.
- [x] **Step 7: Run frontend regression gate.**

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e -- tests/public-final.spec.ts tests/responsive-accessibility.spec.ts
```

- [x] **Step 8: Commit or hash P2-T5** with message `test(public): lock responsive orbit and motion acceptance`.

### P2-T6: Public/auth plan closure and handoff

**Files:**
- Modify: `docs/traceability/requirements.md`
- Modify: project `CURRENT.md`
- Modify: the active implementation session selected at P2 entry under ADR-020; scan the highest occupied `SNNN` and never reuse S015–S018.
- Create: `outputs/final/public-auth-verification.md`

**Interfaces:**
- Records: PUB-01, PUB-02 and AUTH-01 as atom-derived `partial` with ledger `in_progress` after current unit, remote-auth E2E and visual evidence pass; P6 exact-digest `image` evidence upgrades them to `verified-image`.

- [x] **Step 1: Run the full Plan 2 regression gate.**

```powershell
npm.cmd test
npm.cmd run test:server
npm.cmd run typecheck
npm.cmd run typecheck:server
npm.cmd run build
npm.cmd run build:server
npm.cmd run test:e2e -- tests/public-final.spec.ts tests/responsive-accessibility.spec.ts
npm.cmd run test:e2e:remote
```

- [x] **Step 2: Write `public-auth-verification.md`** with exact command exit codes, test counts, browser/OS/font/DPR/viewport/color-scheme/reduced-motion metadata, dependency-lock hash, screenshot/filmstrip/trace paths, geometry maximum error, focus/scroll restoration and reduced-motion result. Do not include cookies, credentials or raw request headers.
- [x] **Step 3: Re-open all captures in one review pass** and reject the gate for detached objects, hidden labels, dim night tracks, the rejected beige/monotone/right-angle/generic-workbench language, equal-layout detail templates, unreachable exits, white flashes, login overflow, animation contention or unexplained trace work.
- [x] **Step 4: Update traceability, the selected session and CURRENT** with the next atomic action `P3-T1 stable private shell and overview failing test`.
- [x] **Step 5: Commit or hash P2-T6** with message `docs(public): close orbit and authentication gate`.

## Plan 2 Self-Review

- Spec coverage: public composition, quiet daylight aperture, five semantic objects, exact authored geometry, visible night tracks, click-only entry, login-first golden slice, five distinct details, fixed exit, phase-exact reverse and real authentication all map to tasks and evidence.
- Placeholder scan: routes, labels, periods, durations, breakpoints, geometry tolerance and failure conditions are exact.
- Type consistency: category slugs are `now|doing|learning|moments|archive` in content, API and routes; scene states and login states have separate explicit unions.
- Scope: Plan 2 delivers complete public/auth behavior and does not leave a mock private redesign; navigation lands on the existing authenticated shell until Plan 3 replaces it.
