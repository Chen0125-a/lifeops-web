import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-30-p6-t6-ci20-webkit-sampling-local-full-gates-uncommitted-local-checkpoint.json'
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
      ? 'This CI20 evidence artifact is regenerated from current on-disk sources and rebound by the evidence manifest.'
      : 'This bounded CI20 path records the focused RED/GREEN, full current-source gates or required execution handoff state.')
}
task.externalBlockers = [
  {
    code: 'ORDINARY_CI_PENDING',
    fact: 'Ordinary CI run 33271354230 at 386de70 passed all non-browser gates and 335/336 browser cases, then failed only WebKit private-route continuity with nine healthy retained frames against the unchanged minimum of ten. The deterministic fallback correction and stable Axe surface now pass the complete official Linux browser sequence at 338/338 locally; a new ordinary CI must still become genuinely green.',
  },
  {
    code: 'RELEASE_PREREQUISITES_PENDING',
    fact: 'The user authorized exactly one additional 1.0.0 dispatch only after the next ordinary CI is green. UHub digests, digest-bound SBOM/provenance, exact-digest image smoke and release success remain absent; no release was dispatched from failed CI run 33271354230.',
  },
]
for (const red of [
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
  note: 'CI20 changes only browser test/probe scheduling. The CI19 final 1440x900 and 390x844 day/night rest/login images remain product-source-current and were already opened individually at original resolution; their hashes and 71-frame 16.8 ms metrics remain unchanged.',
}
await writeJson(visualManifestPath, visualManifest)

const manifest = await readJson(evidenceManifestPath)
const evidenceIdsBefore = manifest.evidence.map((row) => row.id)
const summaries = {
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
  basis: 'Ordinary CI run 33271354230 at 386de70 passed all non-browser gates and 335/336 browser cases, then failed only WebKit private-route continuity at nine healthy retained frames versus the unchanged minimum ten. Deterministic TDD added a 16 ms timer fallback that races rAF without changing the 360 ms duration or threshold. A separate repeated 768 night-home Axe run exposed a final orbit label mid-fade at 17/20; waiting for all five labels to reach opacity 1 produced 20/20 with unchanged rules and colors. Fresh gates pass frontend 426/426, both typechecks/builds, server 362 ordinary plus 50 exact skips, official MySQL 50/50, all declared Helm/media/security/observability/workflow/release/data contracts, local current-source Web/API image smoke and official Linux browser 338/338 with workers=1/retries=0. CI19 final images remain product-source-current and previously opened. The eight protected historical untracked files remain untouched. All 462 evidence IDs retain exact order; parent truth remains 30/10/4. A new ordinary CI must be green before the single authorized 1.0.0 dispatch; no UHub digest, attestation, release, DNS/TLS or cluster state is claimed.',
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
