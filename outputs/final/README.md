# LifeOps P6-T5 final quality evidence

This directory contains the approved local final-quality evidence for P6-T5. It is evidence for the current non-Git source checkpoint only; it is not a registry publication, immutable-image digest, SBOM, provenance, or cluster-deployment claim.

## Fresh gates

- Web unit regression: `npm.cmd test` — 84 files, 392 tests passed.
- Server regression: `npm.cmd run test:server` — 361 passed, 50 exact-MySQL cases skipped by design in the ordinary runner.
- Exact MySQL 8.4.10: `powershell -NoProfile -ExecutionPolicy Bypass -File work/run-p6-t5-exact-mysql.ps1` — 50/50 passed with 16 migrations; normal shutdown succeeded and the listener/PID were absent afterward. The ordinary all-skipped `npm.cmd run test:mysql` invocation is not counted as passing evidence.
- Type/build: Web and server typechecks passed; Web production build passed with 883 modules; server build passed.
- Browser matrix, serialized by project: Chromium 141/141, 1024 acceptance 48/48, 768 acceptance 48/48, 390 acceptance 48/48, Windows headed Firefox critical 25/25, and Windows headed WebKit critical 25/25.
- Real Fastify remote matrix: Chromium, Windows headed Firefox, and WebKit passed 12/12. Windows Firefox is headed only on Windows because Playwright 1.62.1 headless Firefox failed before page creation; Linux CI remains headless.
- Lighthouse production preview: public performance 1.00, accessibility 1.00, best practices 0.96, SEO 0.91; authenticated overview performance evidence is recorded separately.

## Visual decision

The primary executor opened the seven final ADR-029 captures and all four final contact sheets at original resolution. The user approved the composition and requested removal of only the visible center light orb. The regenerated result preserves the plain `05 / 此刻正在发生` center, natural orbit rotation, desktop orbit-left/title-recede login depth, coordinated night login surface, complete safe-inset outer ring, and mobile full-screen task layer without horizontal overflow.

The reproducibility contract, artifact hashes, state coverage, environment, and reviewer decisions are recorded in `visual-evidence-manifest.json`.

