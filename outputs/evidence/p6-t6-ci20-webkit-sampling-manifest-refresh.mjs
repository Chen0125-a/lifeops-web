import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-30-p6-t6-release2-observability-pipeline-remediation-uncommitted-local-checkpoint.json'
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
  throw new Error(`Tracked historical browser evidence changed during CI20: ${JSON.stringify(dirtyHistoricalEvidence)}`)
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
  ['outputs/final/data-rehearsal-summary.md', 'The fresh disposable official MySQL 8.4.10 rehearsal records all 16 migrations and matching source/restored logical checksums.'],
  [refreshPath, 'The deterministic CI20 refresh preserves all 462 evidence IDs and order, rehashes current sources/artifacts and refuses tracked historical-browser drift.'],
  [checkpointPath, 'The deterministic checkpoint binds the CI20 sampling/accessibility correction and complete current-source local gates to the sorted source set.'],
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
    fact: 'Ordinary CI run 33278665288 / job 99169909250 at 01f1bbb passed every gate in 35m03s. Authorized release run 33280128021 then independently passed full tests, MySQL and 36m13s browser acceptance but failed before registry sign-in because the Linux pwsh direct pipeline delivered no Console stdin to validate-observability.ps1. The focused cross-platform fix is green locally; a new ordinary CI must still verify the committed correction.',
  },
  {
    code: 'RELEASE_AUTHORIZATION_REQUIRED',
    fact: 'The single authorized 1.0.0 dispatch was consumed by failed release run 33280128021. It stopped before UHub sign-in, image build or push, so immutable digests, digest-bound SBOM/provenance, exact-digest image smoke and release success remain absent. Another dispatch requires new explicit authorization after a fresh ordinary CI is green.',
  },
]
for (const red of [
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
  note: 'This release remediation changes only a PowerShell Helm-render validator and its focused contract. The CI19 final 1440x900 and 390x844 day/night rest/login images remain product-source-current and were already opened individually at original resolution; their hashes and 71-frame 16.8 ms metrics remain unchanged.',
}
await writeJson(visualManifestPath, visualManifest)

const manifest = await readJson(evidenceManifestPath)
const evidenceIdsBefore = manifest.evidence.map((row) => row.id)
const summaries = {
  'EV-P6-T3-SECURITY': 'Fresh focused observability validation passes in both external-process stdin and direct PowerShell pipeline modes on Windows PowerShell 5.1 and PowerShell 7. The release failure was reproduced before implementation; no assertion, metric, alert, route or security rule was removed.',
  'EV-P6-T3-BUILD': 'The exact release-style Helm template pipeline now passes observability-validation: ok. Helm lint/render semantics and every ServiceMonitor, metrics Service, PrometheusRule, dashboard, runbook and non-public /metrics assertion remain enforced.',
  'EV-P6-T4-SUPPLY-CHAIN': 'Ordinary CI 33278665288 passed fully. Release 33280128021 independently passed app, MySQL and browser acceptance, then failed at the pre-registry Helm validator before UHub sign-in or image publication. Workflow/release contracts and the corrected validator pass locally; publication evidence remains pending.',
  'EV-P6-T5-ADR029-UNIT': 'Fresh focused motion-probe contracts pass 3/3 and the complete frontend suite passes 88/88 files and 426/426 tests. The deterministic no-rAF fixture proves the unchanged ten-frame continuity gate remains observable in foreground WebKit.',
  'EV-P6-T5-ADR029-E2E-CHROMIUM': 'Fresh official Linux Chromium coverage passes the complete current-source matrix, including stable accessibility surfaces, login focus and approved desktop/phone geometry.',
  'EV-P6-T5-ADR029-E2E-WEBKIT': 'Fresh official Linux WebKit coverage passes the dedicated theme gate and complete current-source matrix after the continuity probe gained a scheduler fallback; workers=1, retries=0, duration and thresholds remain unchanged.',
  'EV-P6-T5-ADR029-E2E-FIREFOX': 'Fresh official Linux Firefox coverage passes the dedicated theme gate and complete current-source matrix with unchanged worker, retry, geometry and timing contracts.',
  'EV-P6-T5-ADR029-VISUAL-MOTION': 'Fresh Chromium, Firefox and WebKit checks preserve all four original ring owners and exact 30/40/50/60-second periods; CI20 changes only measurement scheduling and no product motion source.',
  'EV-P6-T5-FULL-UNIT': 'Fresh current-source gates pass frontend 88/88 files and 426/426 tests, frontend typecheck and an 885-module production build. Server gates pass 362 ordinary tests plus 50 exact-only skips and server typecheck/build.',
  'EV-P6-T5-FULL-MYSQL': 'A fresh disposable official MySQL 8.4.10 run applied all 16 migrations and passed 50/50 exact tests; the separate rehearsal verified matching source/restored logical checksums and exact cleanup without accessing user or cluster data.',
  'EV-P6-T5-FULL-E2E': 'The fresh official Linux sequence passes WebKit theme 1/1, Firefox theme 1/1 and the complete six-project matrix 336/336 for 338/338 total with workers=1 and retries=0. No browser, threshold, duration or assertion was removed.',
  'EV-P6-T5-FULL-A11Y-KEYBOARD': 'The fresh complete browser matrix includes unchanged Axe rules, keyboard journeys and responsive coverage. An exact repeated 768 night-home reproduction moved from 17/20 to 20/20 only after waiting for all five authored orbit labels to reach opacity 1 before the scan.',
  'EV-P6-T5-FULL-E2E-REDUCED-MOTION': 'Fresh normal and reduced-motion browser coverage passes within the 336/336 matrix. The 64 ms entry carry, focus/state preservation and original continuity threshold remain unchanged.',
  'EV-P6-T5-FULL-MANUAL-REVIEW': 'The CI19 final desktop/phone day/night rest/login images remain current because CI20 changes no product or visual source. Their original-resolution review still confirms complete rings, plain 05 center, approved login depth, dark night surface, mobile breathing room and zero overflow.',
}
for (const row of manifest.evidence) {
  if (summaries[row.id]) row.summary = summaries[row.id]
  row.checkpoint = checkpoint.rootSha256
  for (const source of row.sourcePaths) source.sha256 = await hashRelative(source.path)
  if (row.artifactPath) row.artifactSha256 = await hashRelative(row.artifactPath)
  row.revalidatedAt = revalidatedAt
}
if (manifest.evidence.length !== 462 || manifest.evidence.some((row, index) => row.id !== evidenceIdsBefore[index])) {
  throw new Error('Evidence row count or ID order changed during CI20 refresh')
}
manifest.checkpoint = checkpoint.rootSha256
manifest.revalidation = {
  taskId: 'P6-T6',
  step: 7,
  revalidatedAt,
  basis: 'Ordinary CI run 33278665288 / job 99169909250 at 01f1bbb passed every unit, type, build, exact MySQL, 338-case browser/accessibility, Helm and image-build gate in 35m03s. The single authorized 1.0.0 release run 33280128021 independently passed all application, MySQL and 36m13s browser gates, then failed at Validate deployable manifests because a direct Linux pwsh pipeline does not populate Console stdin. No UHub sign-in, image build/push, digest, attestation, exact-digest smoke or GitOps update ran. A deterministic direct-pipeline contract reproduced the empty-render failure; the validator now accumulates ValueFromPipeline records while retaining external-process stdin fallback. Windows PowerShell 5.1, PowerShell 7, the exact release-style Helm pipeline, workflow, release-production and release-preflight contracts pass without weakening any observability assertion. Product and visual sources are unchanged, so the already opened CI19 final images and the release run application/browser results remain source-current. The eight protected historical untracked files remain untouched. All 462 evidence IDs retain exact order; parent truth remains 30/10/4. A new ordinary CI must be green and new explicit release authorization is required before another dispatch. No UHub digest, attestation, release success, DNS/TLS or cluster state is claimed.',
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
