import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-28-p6-t6-ci13-trace-isolation-uncommitted-local-checkpoint.json'
const refreshPath = 'outputs/evidence/p6-t6-ci13-trace-isolation-manifest-refresh.mjs'
const evidenceManifestPath = 'docs/traceability/evidence-manifest.json'
const taskExecutionPath = 'docs/traceability/task-execution.json'
const visualManifestPath = 'outputs/final/visual-evidence-manifest.json'
const metricsPath = 'outputs/evidence/browser/p2-t5/public-browser-performance-manifest.json'

const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, ...relativePath.split('/')), 'utf8'))
const writeJson = async (relativePath, value) => writeFile(
  path.join(root, ...relativePath.split('/')),
  `${JSON.stringify(value, null, 2)}\n`,
)
const sha256 = (contents) => createHash('sha256').update(contents).digest('hex').toUpperCase()
const hashRelative = async (relativePath) => sha256(await readFile(path.join(root, ...relativePath.split('/'))))
const sortPaths = (values) => [...new Set(values)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)

function currentWorktreePaths() {
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  })
  return status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).replaceAll('\\', '/'))
    .filter((relativePath) => !relativePath.startsWith('outputs/evidence/browser/p6-t6-ci6-full-browser-failures/'))
    .filter((relativePath) => relativePath !== 'outputs/evidence/source-checkpoints/2026-08-27-p6-t6-ci7-webkit-motion-engine-change-control-soft-pause-uncommitted-local-checkpoint.json')
}

const sourceReasons = new Map([
  ['playwright.config.ts', 'The timing-only Firefox and WebKit theme projects disable trace collection so the observer cannot compete with the unchanged post-click rAF measurement; global and critical-project failure tracing remains intact.'],
  ['src/playwrightConfig.test.ts', 'The configuration contract requires trace isolation on both dedicated theme-performance projects while preserving browser coverage, worker/retry policy, test selection, timeout and unchanged performance thresholds.'],
  [refreshPath, 'The deterministic CI13 refresh preserves all 462 evidence IDs, rehashes current sources and artifacts and records the fresh official Linux 338/338 browser replay without promoting registry status.'],
  [checkpointPath, 'The deterministic checkpoint binds the CI13 trace-observer isolation to the current ordinal-sorted source set while excluding generated evidence metadata and sensitive paths.'],
])

const taskExecution = await readJson(taskExecutionPath)
const task = taskExecution.tasks.find((entry) => entry.id === 'P6-T6')
if (!task) throw new Error('P6-T6 task execution row is missing')

const currentPaths = sortPaths([...currentWorktreePaths(), refreshPath, checkpointPath])
task.changedPaths = sortPaths([...task.changedPaths, ...currentPaths])
task.declaredPaths = sortPaths([...task.declaredPaths, ...task.changedPaths])
task.extraPathReasons ??= {}
for (const relativePath of currentPaths) {
  if (task.extraPathReasons[relativePath]) continue
  task.extraPathReasons[relativePath] = sourceReasons.get(relativePath)
    ?? (relativePath.startsWith('outputs/')
      ? 'This CI13 evidence metadata is regenerated deterministically from current on-disk sources and artifacts.'
      : 'This bounded CI13 path is covered by the focused configuration RED/GREEN, complete frontend replay and fresh official Linux Playwright matrix.')
}
task.externalBlockers = [
  {
    code: 'ORDINARY_CI_PENDING',
    fact: 'Ordinary CI run 33175188848 passed unit/type/build, the official MySQL 8.4 step and browser installation, then failed only the WebKit theme-performance project because inherited trace capture overlapped the first two post-click rAF samples. The two-project trace isolation passes focused TDD, frontend gates and a fresh official Linux 338/338 browser replay. The user\'s continuing authorization covers committing and pushing it; a new ordinary CI must still become genuinely green.',
  },
  {
    code: 'RELEASE_PREREQUISITES_PENDING',
    fact: 'The user authorized exactly one additional 1.0.0 dispatch only after the next ordinary CI is green. UHub digests, digest-bound SBOM/provenance, exact-digest image smoke and release success remain absent; no release was dispatched from failed CI run 33175188848.',
  },
]
const observerRed = {
  classification: 'behavioral',
  command: 'npm.cmd test -- src/playwrightConfig.test.ts',
  exitCode: 1,
  failure: 'The focused Playwright configuration contract failed 1/14 because both dedicated non-Chromium theme-performance projects still inherited trace collection. The implementation disables trace only for those timing projects while leaving global and critical-project failure tracing unchanged.',
}
if (!task.redEvidence.some((entry) => entry.failure === observerRed.failure)) task.redEvidence.push(observerRed)
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
  metricsPath,
  metricsSha256: await hashRelative(metricsPath),
  openedOriginalResolution: true,
  captureCount: 9,
  conclusion: 'pass',
  note: 'The CI13 change is confined to Playwright timing-project trace collection; no product, style, image, browser-test or visual artifact source changed after the nine CI11 images were opened individually at original resolution.',
}
await writeJson(visualManifestPath, visualManifest)

const manifest = await readJson(evidenceManifestPath)
for (const row of manifest.evidence) {
  row.sourcePaths.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  if (row.id === 'EV-P6-T5-FULL-UNIT') {
    row.summary = 'Fresh CI13 gates pass frontend 88/88 files and 425/425 tests, including the Playwright configuration contract at 14/14, plus frontend typecheck and an 885-module production build. The unchanged server source retains the fresh CI12 362 ordinary tests plus 50 exact-only skips and dual server typecheck/build evidence.'
  }
  if (row.id === 'EV-P6-T5-FULL-API') {
    row.summary = 'The CI12 ordinary run and local gates passed the unchanged server unit/type/build surface with 362 ordinary tests and 50 exact-only skips; the unchanged product/server source retains the prior official real-Fastify browser matrix 12/12 across Chromium, Firefox and WebKit.'
  }
  if (row.id === 'EV-P6-T5-FULL-MYSQL') {
    row.command = 'GitHub Actions ordinary CI run 33175188848 official mysql:8.4.10 step; prior fresh owned official mysql:8.4.10 50/50 exact gate with cleanup'
    row.summary = 'Ordinary CI run 33175188848 passed its official MySQL 8.4 integration step. The unchanged database source also retains the fresh owned MySQL 8.4.10 run that applied all 16 migrations and passed 50/50 exact tests with zero skip before exact cleanup.'
  }
  if (row.id === 'EV-P6-T5-FULL-E2E') {
    row.command = 'official mcr.microsoft.com/playwright:v1.62.1-noble: isolated WebKit theme 1/1; isolated Firefox theme 1/1; npm run test:e2e:matrix -- --output=/tmp/test-results --reporter=list'
    row.summary = 'Fresh official Playwright 1.62.1 Linux gates pass 338/338 current checks: isolated WebKit theme 1/1, isolated Firefox theme 1/1 and the complete six-project matrix 336/336 in 24.0 minutes with workers=1 and retries=0. The exact CI13 containers and owned work/dependency volumes were removed.'
  }
  if (row.id === 'EV-P6-T5-ADR029-E2E-WEBKIT') {
    row.summary = 'Fresh official Linux WebKit evidence passes the dedicated unchanged-ceiling theme-performance project 1/1 and the complete matrix WebKit-critical segment 25/25 with workers=1 and retries=0 after isolating only timing-project trace collection.'
  }
  if (row.id === 'EV-P6-T5-ADR029-E2E-FIREFOX') {
    row.summary = 'Fresh official Linux Firefox evidence passes the dedicated unchanged-ceiling theme-performance project 1/1 and the complete matrix Firefox-critical segment 25/25 with workers=1 and retries=0 after isolating only timing-project trace collection.'
  }
  row.checkpoint = checkpoint.rootSha256
  for (const source of row.sourcePaths ?? []) source.sha256 = await hashRelative(source.path)
  if (row.artifactPath) row.artifactSha256 = await hashRelative(row.artifactPath)
  row.revalidatedAt = revalidatedAt
}
manifest.checkpoint = checkpoint.rootSha256
manifest.revalidation = {
  taskId: 'P6-T6',
  step: 7,
  revalidatedAt,
  basis: 'Ordinary CI run 33175188848 passed unit/type/build, official MySQL 8.4 and browser installation, then failed only WebKit theme-performance: baseline P95/max 18/18 ms and transition 72/70 ms followed by 22 frames at 9–19 ms, so P95 70 ms exceeded the unchanged 35 ms budget while max 72 ms stayed below the unchanged 100 ms ceiling. Focused configuration TDD failed 1/14 until trace was disabled only on the Firefox/WebKit timing projects; global and critical-project failure tracing, workers=1, retries=0, browser coverage, test, 1.2-second sample, thresholds, product geometry and motion remain unchanged. Fresh frontend gates pass 425/425, typecheck and an 885-module build; workflow contract/validator pass. Fresh official Linux Playwright passes WebKit theme 1/1, Firefox theme 1/1 and the complete matrix 336/336 in 24.0 minutes, totaling 338/338. Product/server/image/visual source is unchanged, so the fresh CI12 server/MySQL evidence plus existing real-Fastify 12/12, Helm/security/workflow/image/data/Lighthouse gates and nine opened visual frames remain source-current. All 462 evidence IDs retain exact order; parent truth remains 30/10/4. The next ordinary CI must be green before the single authorized 1.0.0 dispatch; no UHub, attestation, release, DNS/TLS or cluster state is claimed.',
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
