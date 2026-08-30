import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-30-p6-t6-ci21-remote-production-preview-remediation-uncommitted-local-checkpoint.json'
const refreshPath = 'outputs/evidence/p6-t6-ci20-webkit-sampling-manifest-refresh.mjs'
const evidenceManifestPath = 'docs/traceability/evidence-manifest.json'
const taskExecutionPath = 'docs/traceability/task-execution.json'
const visualManifestPath = 'outputs/final/visual-evidence-manifest.json'
const retainedMetricsPath = 'outputs/evidence/browser/p6-t6-ci19-theme-switch-final/metrics.json'
const protectedPaths = new Set([
  'outputs/evidence/source-checkpoints/2026-08-27-p6-t6-ci7-webkit-motion-engine-change-control-soft-pause-uncommitted-local-checkpoint.json',
])

const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, ...relativePath.split('/')), 'utf8'))
const writeJson = async (relativePath, value) => writeFile(
  path.join(root, ...relativePath.split('/')),
  `${JSON.stringify(value, null, 2)}\n`,
)
const sha256 = (contents) => createHash('sha256').update(contents).digest('hex').toUpperCase()
const hashRelative = async (relativePath) => sha256(await readFile(path.join(root, ...relativePath.split('/'))))
const sortPaths = (values) => [...new Set(values)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)

function worktreeRows() {
  return execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({ code: line.slice(0, 2), path: line.slice(3).replaceAll('\\', '/') }))
}

const statusRows = worktreeRows()
const dirtyHistoricalEvidence = statusRows.filter(({ code, path: relativePath }) => (
  code !== '??' && relativePath.startsWith('outputs/evidence/browser/')
))
if (dirtyHistoricalEvidence.length > 0) {
  throw new Error(`Tracked historical browser evidence changed during CI21: ${JSON.stringify(dirtyHistoricalEvidence)}`)
}

const currentPaths = sortPaths([
  ...statusRows
    .map((row) => row.path)
    .filter((relativePath) => !relativePath.startsWith('outputs/evidence/browser/p6-t6-ci6-full-browser-failures/'))
    .filter((relativePath) => !protectedPaths.has(relativePath)),
  refreshPath,
  checkpointPath,
])

const sourceReasons = new Map([
  ['src/motionProbeContract.test.ts', 'The deterministic foreground-WebKit contract requires continuity sampling to finish with at least ten healthy frames even when requestAnimationFrame callbacks are dropped.'],
  ['tests/helpers/motionProbe.ts', 'Each continuity sample now races requestAnimationFrame against a 16 ms timer fallback while preserving the original 360 ms duration and ten-frame threshold.'],
  ['tests/accessibility-full.spec.ts', 'The homepage Axe gate waits for the five authored orbit labels to reach their stable opacity endpoint before scanning without suppressing any accessibility rule.'],
  ['scripts/validate-observability.ps1', 'The observability validator now accepts both external process stdin and direct PowerShell pipeline records, preserving every rendered-manifest assertion across Windows PowerShell and Linux pwsh.'],
  ['scripts/validate-observability.test.ps1', 'The focused contract reproduces the release workflow direct-pipeline failure and proves both direct and external stdin modes accept the reviewed Helm render.'],
  ['package.json', 'The real-Fastify remote acceptance command now builds both the production Web bundle and server before Playwright starts, so every browser exercises shipped assets rather than on-demand development transforms.'],
  ['src/playwrightConfig.test.ts', 'The focused harness contract requires the production build prerequisite, Vite preview, fixed loopback port and removal of the development server from remote acceptance.'],
  ['tests-remote/globalSetup.ts', 'Remote real-Fastify journeys now serve the prebuilt dist bundle with Vite preview while retaining the same loopback API, teardown, workers, retries and browser coverage.'],
  ['outputs/final/data-rehearsal-summary.md', 'The fresh disposable official MySQL 8.4.10 rehearsal records all 16 migrations and matching source/restored logical checksums.'],
  [refreshPath, 'The deterministic CI21 refresh preserves all 462 evidence IDs and order, rehashes current sources/artifacts and refuses tracked historical-browser drift.'],
  [checkpointPath, 'The deterministic checkpoint binds the CI21 remote production-preview correction, current local gates and honest external blockers to the sorted source set.'],
])

const taskExecution = await readJson(taskExecutionPath)
const task = taskExecution.tasks.find((entry) => entry.id === 'P6-T6')
if (!task) throw new Error('P6-T6 task execution row is missing')
task.changedPaths = sortPaths([...task.changedPaths, ...currentPaths])
task.declaredPaths = sortPaths([...task.declaredPaths, ...task.changedPaths])
task.extraPathReasons ??= {}
for (const relativePath of currentPaths) {
  if (task.extraPathReasons[relativePath]) continue
  task.extraPathReasons[relativePath] = sourceReasons.get(relativePath)
    ?? (relativePath.startsWith('outputs/')
      ? 'This release-remediation evidence artifact is regenerated from current on-disk sources and rebound by the evidence manifest.'
      : 'This bounded release-remediation path records the focused RED/GREEN, current-source gates or required execution handoff state.')
}
task.externalBlockers = [
  {
    code: 'ORDINARY_CI_PENDING',
    fact: 'Ordinary CI run 33282198354 / job 99179121484 at 39e5b5d passed frontend unit/type/build, official MySQL 8.4.10 and the complete 338-case browser matrix, then failed only the remote real-Fastify WebKit login/write journey after 11/12 remote cases. The old remote harness served an on-demand Vite development graph; the focused production-preview correction is green for Chromium and WebKit locally, while a new ordinary Linux CI must verify the committed correction including Firefox.',
  },
  {
    code: 'RELEASE_AUTHORIZATION_REQUIRED',
    fact: 'The single authorized 1.0.0 dispatch was consumed by failed release run 33280128021. It stopped before UHub sign-in, image build or push, so immutable digests, digest-bound SBOM/provenance, exact-digest image smoke and release success remain absent. Another dispatch requires new explicit authorization after a fresh ordinary CI is green.',
  },
]
for (const red of [
  {
    classification: 'behavioral',
    command: 'GitHub Actions ordinary CI run 33282198354 / job 99179121484: npm run test:e2e:remote',
    exitCode: 1,
    failure: 'Eleven remote real-Fastify cases passed, but the final WebKit login/write case timed out after navigation to /app/overview while waiting 15 seconds for the schedule link; all preceding unit, build, MySQL and complete browser-matrix gates were green.',
  },
  {
    classification: 'behavioral',
    command: 'npm.cmd test -- src/playwrightConfig.test.ts',
    exitCode: 1,
    failure: 'The new production-bundle remote-harness contract passed 14 assertions and failed exactly one because test:e2e:remote omitted the Web build and globalSetup used Vite createServer instead of preview.',
  },
  {
    classification: 'environment',
    command: 'npx.cmd playwright test --config playwright.remote.config.ts --project=desktop-firefox --grep "real Fastify session creates, edits, relates and reloads private knowledge"',
    exitCode: 1,
    failure: 'The local Windows Playwright Firefox process never created a page: Juggler reported tab subprocess SpawnTarget Error:0, three GPU-process failures and D3D11_NO_DEVICE before browserContext.newPage; no LifeOps URL or assertion executed. CI21 had already passed all four Firefox remote journeys on Linux, and the next ordinary CI must verify Firefox again on the corrected production-preview source.',
  },
  {
    classification: 'behavioral',
    command: 'GitHub Actions release run 33280128021 / job 99173780692: Validate deployable manifests',
    exitCode: 1,
    failure: 'The direct Linux pwsh Helm pipeline reached validate-observability.ps1 with empty Console stdin after every application, MySQL and browser gate had passed; registry sign-in and all image publication steps remained unstarted.',
  },
  {
    classification: 'behavioral',
    command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-observability.test.ps1',
    exitCode: 1,
    failure: 'The new direct PowerShell pipeline contract reproduced Observability render is empty while the existing external-process stdin contract still passed.',
  },
  {
    classification: 'behavioral',
    command: 'GitHub Actions ordinary CI run 33271354230 / job 99150269743: WebKit private-route continuity',
    exitCode: 1,
    failure: 'The unchanged WebKit continuity gate retained nine healthy frames against the required minimum of ten while the private shell, main content, route panel and non-white background all remained correct.',
  },
  {
    classification: 'behavioral',
    command: 'npm.cmd test -- src/motionProbeContract.test.ts --run',
    exitCode: 1,
    failure: 'The deterministic foreground-WebKit fixture timed out before 500 ms when requestAnimationFrame delivered no callbacks, proving the continuity sampler lacked an independent scheduling fallback.',
  },
  {
    classification: 'behavioral',
    command: 'official mcr.microsoft.com/playwright:v1.62.1-noble repeated 768 night-home accessibility gate',
    exitCode: 1,
    failure: 'The exact repeated Axe run passed 17/20 and failed three times because the final 时间档案 orbit label was sampled during its authored opacity fade; no Axe rule or contrast threshold was changed.',
  },
]) {
  if (!task.redEvidence.some((entry) => entry.failure === red.failure)) task.redEvidence.push(red)
}
await writeJson(taskExecutionPath, taskExecution)

const checkpoint = await buildLocalCheckpoint(root)
await writeJson(checkpointPath, checkpoint)
const revalidatedAt = new Date().toISOString()

const visualManifest = await readJson(visualManifestPath)
visualManifest.checkpointRootSha256 = checkpoint.rootSha256
visualManifest.generatedAt = revalidatedAt
for (const state of visualManifest.states) {
  if (state.screenshotPath) state.screenshotSha256 = await hashRelative(state.screenshotPath)
  if (state.filmstripPath) state.filmstripSha256 = await hashRelative(state.filmstripPath)
  if (state.tracePath) state.traceSha256 = await hashRelative(state.tracePath)
}
for (const report of visualManifest.performanceReports) report.sha256 = await hashRelative(report.path)
visualManifest.latestRevalidation = {
  taskId: 'P6-T6',
  step: 7,
  revalidatedAt,
  checkpointRootSha256: checkpoint.rootSha256,
  metricsPath: retainedMetricsPath,
  metricsSha256: await hashRelative(retainedMetricsPath),
  openedOriginalResolution: true,
  captureCount: 8,
  conclusion: 'pass',
  note: 'This CI21 remediation changes only the remote acceptance harness, its package command and focused contract. The CI19 final 1440x900 and 390x844 day/night rest/login images remain product-source-current and were already opened individually at original resolution; their hashes and 71-frame 16.8 ms metrics remain unchanged.',
}
await writeJson(visualManifestPath, visualManifest)

const manifest = await readJson(evidenceManifestPath)
const evidenceIdsBefore = manifest.evidence.map((row) => row.id)
const summaries = {
  'EV-P6-T3-SECURITY': 'Fresh focused observability validation passes in both external-process stdin and direct PowerShell pipeline modes on Windows PowerShell 5.1 and PowerShell 7. The release failure was reproduced before implementation; no assertion, metric, alert, route or security rule was removed.',
  'EV-P6-T3-BUILD': 'The exact release-style Helm template pipeline now passes observability-validation: ok. Helm lint/render semantics and every ServiceMonitor, metrics Service, PrometheusRule, dashboard, runbook and non-public /metrics assertion remain enforced.',
  'EV-P6-T4-SUPPLY-CHAIN': 'Ordinary CI 33278665288 passed fully. Release 33280128021 passed app, MySQL and browser acceptance, then failed before UHub sign-in; its observability pipeline correction is committed. CI21 passed all pre-remote gates and exposed only the remote WebKit development-server latency. Production-preview harness and release contracts pass locally; publication evidence remains pending.',
  'EV-P6-T5-ADR029-UNIT': 'Fresh focused motion-probe and remote-harness contracts remain green, and the complete frontend suite passes 88/88 files and 427/427 tests. The deterministic no-rAF fixture still proves the unchanged ten-frame continuity gate remains observable in foreground WebKit.',
  'EV-P6-T5-ADR029-E2E-CHROMIUM': 'Fresh official Linux Chromium coverage passes the complete current-source matrix, including stable accessibility surfaces, login focus and approved desktop/phone geometry.',
  'EV-P6-T5-ADR029-E2E-WEBKIT': 'Fresh official Linux WebKit coverage passes the dedicated theme gate and complete current-source matrix after the continuity probe gained a scheduler fallback; workers=1, retries=0, duration and thresholds remain unchanged.',
  'EV-P6-T5-ADR029-E2E-FIREFOX': 'Fresh official Linux Firefox coverage passes the dedicated theme gate and complete current-source matrix with unchanged worker, retry, geometry and timing contracts.',
  'EV-P6-T5-ADR029-VISUAL-MOTION': 'Fresh Chromium, Firefox and WebKit checks preserve all four original ring owners and exact 30/40/50/60-second periods; the CI21 production-preview remediation changes no product motion source.',
  'EV-P6-T5-FULL-UNIT': 'Fresh current-source gates pass frontend 88/88 files and 427/427 tests, frontend typecheck and an 885-module production build. CI21 independently passed its unchanged server, official MySQL and complete browser prerequisites before the remote suite.',
  'EV-P6-T5-FULL-MYSQL': 'A fresh disposable official MySQL 8.4.10 run applied all 16 migrations and passed 50/50 exact tests; the separate rehearsal verified matching source/restored logical checksums and exact cleanup without accessing user or cluster data.',
  'EV-P6-T5-FULL-E2E': 'The fresh official Linux sequence passes WebKit theme 1/1, Firefox theme 1/1 and the complete six-project matrix 336/336 for 338/338 total with workers=1 and retries=0. No browser, threshold, duration or assertion was removed.',
  'EV-P6-T5-FULL-E2E-REMOTE': 'CI21 passed 11/12 remote real-Fastify cases and exposed only the final WebKit lazy production-route delay under Vite development transforms. The corrected harness uses a prebuilt production bundle: focused contract 15/15, exact WebKit journey 1/1, WebKit repeat 10/10, and complete local Chromium plus WebKit remote coverage 8/8 pass. Local Firefox could not create a page because the Windows browser process failed before context setup; the next Linux ordinary CI remains required for the current-source Firefox and full 12/12 claim.',
  'EV-P6-T5-FULL-A11Y-KEYBOARD': 'The fresh complete browser matrix includes unchanged Axe rules, keyboard journeys and responsive coverage. An exact repeated 768 night-home reproduction moved from 17/20 to 20/20 only after waiting for all five authored orbit labels to reach opacity 1 before the scan.',
  'EV-P6-T5-FULL-E2E-REDUCED-MOTION': 'Fresh normal and reduced-motion browser coverage passes within the 336/336 matrix. The 64 ms entry carry, focus/state preservation and original continuity threshold remain unchanged.',
  'EV-P6-T5-FULL-MANUAL-REVIEW': 'The CI19 final desktop/phone day/night rest/login images remain current because the CI21 remediation changes no product or visual source. Their original-resolution review still confirms complete rings, plain 05 center, approved login depth, dark night surface, mobile breathing room and zero overflow.',
}
for (const row of manifest.evidence) {
  if (summaries[row.id]) row.summary = summaries[row.id]
  row.checkpoint = checkpoint.rootSha256
  for (const source of row.sourcePaths) source.sha256 = await hashRelative(source.path)
  if (row.artifactPath) row.artifactSha256 = await hashRelative(row.artifactPath)
  row.revalidatedAt = revalidatedAt
}
if (manifest.evidence.length !== 462 || manifest.evidence.some((row, index) => row.id !== evidenceIdsBefore[index])) {
  throw new Error('Evidence row count or ID order changed during CI21 refresh')
}
manifest.checkpoint = checkpoint.rootSha256
manifest.revalidation = {
  taskId: 'P6-T6',
  step: 7,
  revalidatedAt,
  basis: 'Ordinary CI run 33282198354 / job 99179121484 at 39e5b5d passed frontend unit/type/build, official MySQL 8.4.10 and the complete 338-case browser/accessibility matrix, then completed 11/12 remote real-Fastify cases. Its sole failure was the final WebKit login/write case waiting for the schedule link after /app/overview navigation while the old remote harness compiled lazy private chunks on demand through Vite createServer. Focused TDD failed exactly one of 15 harness assertions until test:e2e:remote built the Web production bundle and globalSetup served dist with Vite preview. Current local gates pass the focused harness 15/15, exact WebKit journey 1/1, WebKit repeat 10/10, Chromium plus WebKit remote 8/8, frontend 88/88 files and 427/427 tests, typecheck, 885-module production build, observability direct/external pipeline, exact release-style Helm, workflow, release, image-smoke and Helm render/media contracts. The local Windows Firefox executable failed before opening any page with SpawnTarget Error:0, GPU-process failures and D3D11_NO_DEVICE; this is retained as an environment blocker, not hidden or called green, and the next Linux ordinary CI must verify current-source Firefox and full 12/12 remote coverage. Product and visual sources are unchanged, so the already opened CI19 final images remain current. The eight protected historical untracked files remain untouched. All 462 evidence IDs retain exact order; parent truth remains 30/10/4. The failed authorized release produced no UHub sign-in, image build/push, digest, attestation, exact-digest smoke or GitOps update. A new ordinary CI must be green and new explicit release authorization is required before another dispatch. No UHub digest, release success, DNS/TLS or cluster state is claimed.',
}
await writeJson(evidenceManifestPath, manifest)

const fresh = await buildLocalCheckpoint(root)
if (fresh.rootSha256 !== checkpoint.rootSha256 || fresh.files.length !== checkpoint.files.length) {
  throw new Error(`Checkpoint changed during refresh: ${checkpoint.rootSha256}/${checkpoint.files.length} -> ${fresh.rootSha256}/${fresh.files.length}`)
}

console.log(JSON.stringify({
  checkpointPath,
  rootSha256: checkpoint.rootSha256,
  inputs: checkpoint.files.length,
  evidenceRows: manifest.evidence.length,
  declaredPaths: task.declaredPaths.length,
  changedPaths: task.changedPaths.length,
  visualStates: visualManifest.states.length,
}))
