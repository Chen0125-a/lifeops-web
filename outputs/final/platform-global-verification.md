# LifeOps Web P5 platform and global-tools verification

Date: 2026-08-23  
Scope: P5 bounded platform integrations, truthful operations center, personal search, context-aware Quick Create, settings/account/data transfer, and formal cross-surface acceptance.  
Boundary: local product/evidence closure only. P6 migration jobs, media persistence in images, rendered RBAC, immutable Web/API images, UHub digests, digest-bound SBOM/provenance, exact-digest smoke and the user-owned deployment handoff remain outside this closure.

## Environment and reproducibility

| Item | Recorded value |
|---|---|
| Host | Microsoft Windows NT 10.0.22631, x64 |
| Runtime | Node.js v24.15.0; npm 11.12.1 |
| Browser runner | Playwright 1.62.1 |
| Browser | Chromium 151.0.7922.34; fresh headless UA `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.7922.34 Safari/537.36` |
| Product font | `"Noto Sans SC Variable", "Microsoft YaHei UI", sans-serif`; P5 uses the shared bundled font layer |
| DPR / zoom | Browser context DPR 1; direct 200% CSS zoom evidence is retained at the required 320 CSS px acceptance width |
| Viewports | 1440×900, 1024×768, 768×1024, 390×844, 320×900/844, plus 200% zoom |
| Color scheme | Private Daylight only; fresh browser default is light |
| Motion | `no-preference` and `reduce`; both filmstrips are retained and the reduced behavior is equivalent rather than hidden work |
| Web dependency lock | `package-lock.json` SHA-256 `27397928C37E339A7F8AD360608877DC2AC4D254268B2C5E933FCCC7FD718100` |
| Server dependency lock | `server/package-lock.json` SHA-256 `B0BE5AB42889B09EBD23ADCA34702B79C786359207278E28C125057EBAA97814` |

All fixtures are synthetic. This report and its referenced artifacts contain no credential, Cookie, bearer token, API key, private key, kubeconfig, authentication file, raw private note body or raw upstream request/response body.

## Adapter fixtures, cache and security boundaries

- Configuration fixtures cover six integrations as disabled by default and enabled only with validated `http|https` origins, bounded timeouts and response limits. Browser inputs select only server-defined tab, metric and log keys.
- Kubernetes fixtures normalize only nodes, deployments, pods, Services and HTTPRoutes. The transport has no Secret, exec, arbitrary log, create, update, patch or delete path.
- Prometheus fixtures exercise all nine server-owned metric keys, matrix/vector normalization and honest empty series. Alertmanager separates firing/recently-resolved alerts. Elasticsearch uses one fixed query template, treats namespace/pod/level/request ID as values, caps output at 100 events and tolerates malformed events. Delivery fixtures normalize GitHub/Argo state and immutable Web/API digest-shaped values while containing one-source failure.
- `TimedCache` reuses success for 15 seconds, coalesces same-key work, isolates keys and holds a failure for no more than three seconds. Server cache freshness is independent of browser visibility.
- Browser polling is 30 seconds only while `document.visibilityState === 'visible'`; hiding pauses requests, showing resumes, and tab change/unmount aborts in-flight work. A failed source retries locally without replacing healthy panels.
- The bounded fetch layer rejects absolute/alternate-origin paths, raw upstream query languages, redirects, deadline overruns, oversized bodies and non-JSON success responses before unsafe data can reach the UI.
- Recursive redaction removes authorization, Cookie/set-Cookie, password, token, secret, request body, nested sensitive header and Kubernetes sensitive-annotation fields. Arbitrary upstream errors become a fixed safe shape. A fresh focused command covering cache, safe fetch, recursive redaction, Elasticsearch and platform routes passed 5 files / 28 tests.
- Real Fastify injection proves authenticated-only platform routes, raw-query rejection, read-only mutation 404 and secret-free serialization. The anonymous browser journey cannot render the private platform route.

## Search, Quick Create and settings journeys

- Personal search is owner-scoped, excludes deleted/other-owner/platform sources, escapes literal SQL wildcard characters, caps at 50, ranks title/tag/body deterministically, supports Chinese substrings and emits plain-text recipe/day-plan context. The global overlay uses a 180ms debounce, aborts stale work, groups results and preserves keyboard/Enter/Escape/focus/recent behavior.
- `快速记录` defaults to a record and exposes the 15 approved types. Route context inherits only IDs present in loaded user data. One idempotency key belongs to an open/submission; retry reuses it, create-another rotates it, duplicate pending clicks are suppressed, and undo is checked again at execution time.
- All nine settings categories are covered at desktop and mobile. Account/password/session flows, truthful integration status, side-by-side local save state, no-write import preview, explicit impact/recovery confirmation, checksum/current-password-bound apply and mobile enter/return/state retention have current browser evidence.
- P5-T7 focused Chromium passed 17/17; real Fastify Chromium passed 4/4. The complete Web suite passed 84 files / 386 tests, the ordinary server suite passed 54 files / 334 tests with 50 exact-only skips, and the exact official MySQL Community Server 8.4.10 gate passed 50/50 with zero skip and fourteen migrations. MySQL then shut down normally; post-shutdown ping failed and the task PID/listener were absent. Both typechecks and both builds passed; Vite retained only the existing large-chunk advisory.

## Visual, filmstrip and trace inventory

The primary executor opened the four P5-T7 review sheets and key original-resolution images. The first review rejected mobile platform region order, off-screen late tabs and the first correction that scrolled the entire route-stage. Only the final rail-only correction was accepted. Final evidence preserves the bright continuous Daylight canvas, mobile status → alerts → delivery → technical order, visible selected late tabs, readable settings/security copy, reachable controls and no whole-page horizontal clipping.

Every P5 screenshot and filmstrip path follows.

### P5-T3 platform foundation

```text
outputs/evidence/browser/p5-t3/platform-320x844.png
outputs/evidence/browser/p5-t3/platform-390x844.png
outputs/evidence/browser/p5-t3/platform-overview-1024x768.png
outputs/evidence/browser/p5-t3/platform-overview-1024x900.png
outputs/evidence/browser/p5-t3/platform-overview-1440x900.png
outputs/evidence/browser/p5-t3/platform-overview-390x844-reduced-motion.png
outputs/evidence/browser/p5-t3/platform-overview-390x844.png
outputs/evidence/browser/p5-t3/platform-overview-768x1024.png
outputs/evidence/browser/p5-t3/platform-technologies-1440x900.png
```

Geometry metadata: `outputs/evidence/browser/p5-t3/platform-breakpoints.json`.

### P5-T4 search

```text
outputs/evidence/browser/p5-t4/search-1024x768.png
outputs/evidence/browser/p5-t4/search-1440x900.png
outputs/evidence/browser/p5-t4/search-320x900-reflow.png
outputs/evidence/browser/p5-t4/search-390x844-reduced-motion.png
outputs/evidence/browser/p5-t4/search-390x844.png
outputs/evidence/browser/p5-t4/search-768x1024.png
```

### P5-T5 Quick Create

```text
outputs/evidence/browser/p5-t5/quick-create-1024x768.png
outputs/evidence/browser/p5-t5/quick-create-1440x900.png
outputs/evidence/browser/p5-t5/quick-create-320x900-reflow.png
outputs/evidence/browser/p5-t5/quick-create-390x844-reduced-motion.png
outputs/evidence/browser/p5-t5/quick-create-390x844.png
outputs/evidence/browser/p5-t5/quick-create-768x1024.png
```

### P5-T6 settings

```text
outputs/evidence/browser/p5-t6/settings-account-1024x768.png
outputs/evidence/browser/p5-t6/settings-account-1440x900.png
outputs/evidence/browser/p5-t6/settings-categories-320x900-200pct.png
outputs/evidence/browser/p5-t6/settings-categories-390x844.png
outputs/evidence/browser/p5-t6/settings-categories-768x1024.png
outputs/evidence/browser/p5-t6/settings-data-390x844-reduced-motion.png
outputs/evidence/browser/p5-t6/settings-locale-390x844.png
```

### P5-T7 final platform/global acceptance

```text
outputs/evidence/browser/p5-t7/global-search-1024x768.png
outputs/evidence/browser/p5-t7/global-search-1440x900.png
outputs/evidence/browser/p5-t7/global-search-390x844.png
outputs/evidence/browser/p5-t7/global-search-768x1024.png
outputs/evidence/browser/p5-t7/global-search-normal-filmstrip.png
outputs/evidence/browser/p5-t7/global-search-reduced-filmstrip.png
outputs/evidence/browser/p5-t7/platform-alerts-1440x900.png
outputs/evidence/browser/p5-t7/platform-alerts-390x844.png
outputs/evidence/browser/p5-t7/platform-delivery-1440x900.png
outputs/evidence/browser/p5-t7/platform-delivery-390x844.png
outputs/evidence/browser/p5-t7/platform-kubernetes-1440x900.png
outputs/evidence/browser/p5-t7/platform-kubernetes-390x844.png
outputs/evidence/browser/p5-t7/platform-logs-1440x900.png
outputs/evidence/browser/p5-t7/platform-logs-390x844.png
outputs/evidence/browser/p5-t7/platform-monitoring-1440x900.png
outputs/evidence/browser/p5-t7/platform-monitoring-390x844.png
outputs/evidence/browser/p5-t7/platform-overview-1024x768.png
outputs/evidence/browser/p5-t7/platform-overview-1440x900.png
outputs/evidence/browser/p5-t7/platform-overview-320x900.png
outputs/evidence/browser/p5-t7/platform-overview-390x844.png
outputs/evidence/browser/p5-t7/platform-overview-768x1024.png
outputs/evidence/browser/p5-t7/platform-overview-zoom-200.png
outputs/evidence/browser/p5-t7/platform-tabs-normal-filmstrip.png
outputs/evidence/browser/p5-t7/platform-tabs-reduced-filmstrip.png
outputs/evidence/browser/p5-t7/platform-technologies-1440x900.png
outputs/evidence/browser/p5-t7/platform-technologies-390x844.png
outputs/evidence/browser/p5-t7/quick-create-1024x768.png
outputs/evidence/browser/p5-t7/quick-create-1440x900.png
outputs/evidence/browser/p5-t7/quick-create-390x844.png
outputs/evidence/browser/p5-t7/quick-create-768x1024.png
outputs/evidence/browser/p5-t7/quick-create-normal-filmstrip.png
outputs/evidence/browser/p5-t7/quick-create-reduced-filmstrip.png
outputs/evidence/browser/p5-t7/review-filmstrips.png
outputs/evidence/browser/p5-t7/review-global-tools.png
outputs/evidence/browser/p5-t7/review-platform.png
outputs/evidence/browser/p5-t7/review-settings.png
outputs/evidence/browser/p5-t7/settings-01-1440x900.png
outputs/evidence/browser/p5-t7/settings-01-390x844.png
outputs/evidence/browser/p5-t7/settings-02-1440x900.png
outputs/evidence/browser/p5-t7/settings-02-390x844.png
outputs/evidence/browser/p5-t7/settings-03-1440x900.png
outputs/evidence/browser/p5-t7/settings-03-390x844.png
outputs/evidence/browser/p5-t7/settings-04-1440x900.png
outputs/evidence/browser/p5-t7/settings-04-390x844.png
outputs/evidence/browser/p5-t7/settings-05-1440x900.png
outputs/evidence/browser/p5-t7/settings-05-390x844.png
outputs/evidence/browser/p5-t7/settings-06-1440x900.png
outputs/evidence/browser/p5-t7/settings-06-390x844.png
outputs/evidence/browser/p5-t7/settings-07-1440x900.png
outputs/evidence/browser/p5-t7/settings-07-390x844.png
outputs/evidence/browser/p5-t7/settings-08-1440x900.png
outputs/evidence/browser/p5-t7/settings-08-390x844.png
outputs/evidence/browser/p5-t7/settings-09-1440x900.png
outputs/evidence/browser/p5-t7/settings-09-390x844.png
outputs/evidence/browser/p5-t7/settings-categories-normal-filmstrip.png
outputs/evidence/browser/p5-t7/settings-categories-reduced-filmstrip.png
```

The inventory contains exactly 84 screenshots/filmstrips across P5-T3 through P5-T7. P5 did not retain any Playwright trace archive, so there is no P5 trace path to list; trace is not claimed or substituted with screenshots. The acceptance matrix requires current E2E, visual and manual-review evidence for these atoms, all of which is present, and does not require a separate trace evidence type.

## Reverse requirement audit

| Parent | Full atom-derived result | P5-owned atoms | API/persistence → UI/state → browser/visual evidence | Honest remaining boundary |
|---|---:|---:|---|---|
| PLATFORM-01 | 141/141 `verified-local` | 141 | bounded adapters/cache/metrics/authenticated routes → seven-tab bright operations center with honest mixed states and accessible trends → P5-T3/P5-T7 unit, security, responsive, keyboard, visual, filmstrip and opened-review evidence | external connections, ServiceMonitor/Grafana resources and rendered RBAC are P6/user-environment facts, not a local PLATFORM-01 gap |
| GLOBAL-01 | 72/72 `verified-local` | 72 | owner-scoped search, 15-type domain API Quick Create and versioned settings/data-transfer routes → global overlays and nine-category settings → P5-T4–T7 unit, exact MySQL, keyboard, Back, mobile, zoom, reduced-motion and opened-review evidence | none in P5 |
| LIFE-19 | 32/32 `partial` | 2 | P5-T6 deterministic full-account preview/apply and restore-point evidence closes the two P5 data-transfer atoms locally | all 32 atoms require later immutable-container-image evidence; no local behavior gap is hand-advanced |
| LIFE-21 | 56/56 `verified-local` | 56 | loaded-user context plus 15 domain clients → type-aware fields/idempotency/undo/open/create-another → P5-T5/P5-T7 unit and browser evidence | none in P5 |
| LIFE-22 | 127/127 `verified-local` | 4 | account preferences, life defaults/threshold settings, relation-safe full-account transfer → continuous desktop/mobile settings → P5-T6/P5-T7 server, exact MySQL, UI and browser evidence | none in P5 |
| SEC-01 | 18/18 `partial` | 14 | P5 bounded fetch/redaction/authentication/read-only evidence provides six platform atoms; the P5-T8 reverse audit reopened eight missing login/record/settings/image-handoff foundation rows and a fresh 5-file/32-test authorization, ownership, no-secret and safe-transport gate supplies their honest partial evidence | Plan 6 migration-image, network-policy, exact-image and rendered least-privilege/RBAC evidence remains required; SEC-01 is only `partial` |

The reverse audit reopened eight SEC-01 rows that the P5-T7 rollup had left pending. The fresh command `npm.cmd run test:server -- server/src/app.test.ts server/src/routes/records.test.ts server/src/routes/settings.test.ts server/src/integrations/safeFetch.test.ts server/src/integrations/redact.test.ts` passed 5 files / 32 tests and now supplies current partial security evidence; every other planned P5 API, UI, error, mobile, accessibility, motion, security and manual-review evidence type was already present. The least-complete-child rule is preserved, so image-bound LIFE-19 and later security/delivery work are not promoted by documentation. The final P5-T8 checkpoint supersedes the P5-T7 checkpoint named earlier in this report.

## Closure conclusion

P5 local product, database, platform/global, responsive, accessibility, motion, privacy, security and visual responsibilities are complete. PLATFORM-01, GLOBAL-01, LIFE-21, LIFE-22 and STATE-01 are atom-derived `verified-local`; LIFE-19 and SEC-01 remain `partial` at their P6 image/RBAC boundaries. Completing P5 does not complete LifeOps Web.

Next action after P5 phase-close and final handoff: `P6 / P6-T1 / Step 1 — migration job and media storage Helm test`.
