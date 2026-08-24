# LifeOps Web P4 content verification

Date: 2026-08-22  
Scope: P4 knowledge, controlled Obsidian projection, revisioned publishing, dynamic public reads, and Life-specific Obsidian projection.  
Boundary: local product and evidence closure only. P5, P6, immutable Web/API images, UHub digests, SBOM/provenance, Helm/GitOps handoff and user-owned deployment remain outside this closure.

## Environment and reproducibility

| Item | Recorded value |
|---|---|
| Host | Microsoft Windows NT 10.0.22631, x64 |
| Runtime | Node.js v24.15.0; npm 11.12.1 |
| Browser runner | Playwright 1.62.1 |
| Browser | Chromium 151.0.7922.34; desktop user agent recorded in `outputs/evidence/browser/p4-t8-content-metadata.json` |
| Product font | `"Noto Sans SC Variable", "Microsoft YaHei UI", sans-serif`; the shared browser baseline reports the bundled font loaded and the P4 captures use the same font layer |
| DPR / zoom | Desktop Chrome context DPR 1; direct 200% CSS zoom at a 640 px host produces the required 320 CSS px acceptance width |
| Viewports | 1440×900, 1024×768, 768×1024, 390×844, 320×900, plus 640×900 at 200% zoom |
| Color scheme | Private Knowledge/Settings/Publishing/Life routes use daylight; public compatibility covers day and night |
| Motion | `no-preference` and `reduce`; reduced-motion captures and computed-duration assertions are retained |
| Dependency lock | `package-lock.json` SHA-256 `27397928C37E339A7F8AD360608877DC2AC4D254268B2C5E933FCCC7FD718100` |

The machine-readable environment, artifact hashes and trace integrity results are in `outputs/evidence/browser/p4-t8-content-metadata.json`. It contains synthetic identifiers and results only; no actual private note body, credential, Cookie, token, API key, private key or authentication file is included.

## Automated gates

| Gate | Fresh result |
|---|---|
| P4-T7 focused Web | 10 files / 43 tests passed |
| Complete Web | 77 files / 352 tests passed in the final exclusive run |
| Complete server | 39 files passed plus one exact-only file skipped; 239 tests passed and 48 exact-only tests skipped |
| Exact MySQL | Official MySQL Community Server 8.4.10, fourteen migrations, 48/48 passed with zero skip; normal shutdown exit 0; post-shutdown ping exit 1; task PID and listener absent |
| Typecheck/build | Web and server typechecks and production builds passed; Web retained only the existing large-chunk advisory |
| Ordinary Chromium | 75/75 passed in the final exclusive run |
| Real Fastify Chromium | 4/4 passed against real Fastify Memory-store sessions |
| P4-T8 trace run | `npm.cmd run test:e2e -- tests/knowledge-obsidian.spec.ts tests/publishing-public.spec.ts tests/life-obsidian.spec.ts --trace on` passed 11/11 |
| Execution contract | 95/95 passed; P4-T7 task-close, startup and handoff all returned `ok: true` |

The ordinary server skips are the explicit exact-MySQL-only cases and are covered by the separate zero-skip 48/48 run. They are not treated as database proof in the Memory-store suite.

## Visual, filmstrip and trace evidence

- `outputs/evidence/browser/p4-t6/` contains 36 final PNGs for Knowledge, Settings, Publishing, public Learning and public Article at the four standard viewports, 320 px, 200% zoom, and normal/reduced filmstrips.
- `outputs/evidence/browser/p4-t7/` contains eight final Life Obsidian conflict/offline PNGs at 1440, 1024, 768, 390, 320, 200% zoom and reduced motion.
- `outputs/evidence/visual/p4-t6-visual-review.json` and `outputs/evidence/visual/p4-t7-visual-review.json` record that the primary agent opened the final images and accepted hierarchy, composition/continuity, typography, color/state and craft/motion.
- `outputs/evidence/browser/p4-t2/knowledge-responsive-keyboard-trace.zip` retains the Knowledge responsive/keyboard trace.
- `outputs/evidence/browser/p4-t8/knowledge-obsidian-conflict-backup-trace.zip` retains the controlled Knowledge conflict/backup journey.
- `outputs/evidence/browser/p4-t8/life-obsidian-roundtrip-trace.zip` and `life-obsidian-responsive-trace.zip` retain Life projection, backup, responsive, keyboard, Back, zoom and reduced-motion journeys.
- `outputs/evidence/browser/p4-t8/publishing-rss-revoke-trace.zip` retains copy, preview, privacy gate, revision, scheduling, revoke/404 and RSS behavior.

All four P4-T8 trace archives were opened structurally: each contains Playwright trace and network event streams. Per-file byte counts and SHA-256 values are recorded in the machine-readable metadata without exposing request credentials or private source bodies.

## Controlled Obsidian and ZIP results

Knowledge and Life first scans remain read-only. A conflict cannot apply until the user selects an explicit resolution; Life recipe conflicts additionally require an explicit current-version intent. The browser fixtures assert that backup creation occurs before the atomic temporary content write. Permission denial never claims a connection, write failure becomes a bounded degraded state, the surrounding MySQL-backed Life data workspace remains usable, and neither flow proposes automatic deletion.

The deterministic synthetic ZIP fixture is `outputs/evidence/fixtures/p4-t8-life-obsidian-fixture.zip`:

- SHA-256: `F22BC4DF6E5801616ACB48007394F3922B5E23BED31C8B9ED3676B309B6B617B`
- Size: 310 bytes
- Entry: `LifeOps/Life/Recipes/recipe-1.md`
- Determinism: two consecutive builds produced the same checksum
- Safety: ZIP fallback remains preview-only, direct apply is disabled, no connection is claimed, and the fixture contains no actual private note body

## Publishing revision, revoke and RSS results

The synthetic public fixture creates `draft-1` from a selected Knowledge source and `draft-2` as an independent scheduled draft. Fresh browser evidence covers these immutable publication revision IDs:

- `revision-draft-1-1`
- `revision-draft-1-2`
- `revision-draft-2-1`

The user-authored public copy is independently editable, the privacy confirmation resets after edits, immediate and scheduled publication are version-bound, and Revision 1 → 2 diff remains available. After revoke, `/p/knowledge-knowledge-source` returns the 404-backed unavailable-snapshot surface rather than stale public content. RSS remains valid `application/rss+xml`, includes the still-published scheduled item, excludes the revoked revision, and excludes the synthetic private-source sentinel.

## Reverse requirement audit

| Parent | Atom result | API/persistence → UI/state → browser/visual evidence | Honest remaining boundary |
|---|---:|---|---|
| KNOW-01 | 23/23 `verified-local` | Knowledge domain/Memory/MySQL/Fastify/client → three-pane safe Markdown workspace, search/relations/resurface/archive/conflict/offline → P4-T2/P4-T6 unit, E2E, four-viewport, keyboard, Back, 200% and opened visual/trace evidence | none in P4 |
| OBS-01 | 4/4 `verified-local` | allowlisted FSA/ZIP adapter and preview/apply contract → Settings permission/unsupported/conflict/backup states → P4-T3/P4-T6 browser, keyboard, responsive, reduced-motion and opened visual evidence | none in P4 |
| PUBLISH-01 | 32/32 `partial` | revisioned Memory/MySQL/Fastify/client → publishing workbench, dynamic public pages, privacy/schedule/revoke/error states → P4-T4–T6 unit, exact MySQL, E2E, four-viewport, filmstrip, manual review and P4-T8 trace | later immutable-container-image evidence for every atom; no local behavior gap |
| LIFE-20 | 4/4 `partial` | current P1 export/import facts plus strict Life projection/import planner → connected/conflict/degraded/unsupported states → P4-T7 unit, exact MySQL, E2E, four-viewport, keyboard, Back, zoom, reduced-motion, opened visual and P4-T8 trace | later immutable-container-image evidence for every atom; no local behavior gap |

The least-complete-child rule is preserved. Screenshots are visual/manual evidence, not the `image` evidence type, which means immutable container images at the later delivery boundary. Therefore PUBLISH-01 and LIFE-20 are deliberately not hand-advanced to `verified-local`. This corrects the stale P4-T8 interface sentence under the higher-priority execution-completeness and image-delivery-boundary contracts.

## Closure conclusion

P4's local implementation, database, responsive, accessibility, motion, error, privacy, visual and handoff responsibilities are complete. KNOW-01 and OBS-01 are `verified-local`; PUBLISH-01 and LIFE-20 remain truthfully `partial` only at the later immutable-image boundary. Completing P4 does not complete LifeOps Web.

Next action after the P4 phase-close and final handoff: `P5 / P5-T1 / Step 1 — platform adapter security contract test`. No P5 implementation is included in this report.
