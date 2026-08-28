import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-28-p6-t6-ci12-mysql-hook-uncommitted-local-checkpoint.json'
const refreshPath = 'outputs/evidence/p6-t6-ci12-mysql-hook-manifest-refresh.mjs'
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
  ['server/src/deployment.test.ts', 'The delivery harness contract requires only the cold MySQL setup hook to declare a 60-second budget and forbids a global Vitest hook-timeout relaxation.'],
  ['server/src/mysql.integration.test.ts', 'The official MySQL suite retains every exact behavioral assertion while its cold concurrent-migration setup receives an explicit 60-second hook budget instead of Vitest\'s 10-second default.'],
  [refreshPath, 'The deterministic CI12 refresh preserves all 462 evidence IDs, rehashes current sources and artifacts and records the bounded MySQL harness revalidation without promoting registry status.'],
  [checkpointPath, 'The deterministic checkpoint binds the CI12 MySQL harness correction to the current ordinal-sorted source set while excluding generated evidence metadata and sensitive paths.'],
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
      ? 'This CI12 evidence metadata is regenerated deterministically from current on-disk sources and artifacts.'
      : 'This bounded CI12 path is covered by the focused harness RED/GREEN, complete unit/type/build replay and exact MySQL 8.4.10 gate.')
}
task.externalBlockers = [
  {
    code: 'ORDINARY_CI_PENDING',
    fact: 'Ordinary CI run 33173546102 passed unit, type and build, then the official MySQL setup exceeded Vitest\'s default 10-second beforeAll budget and skipped all 50 exact tests. The bounded two-file harness correction passes local focused/full/unit/type/build and a fresh official MySQL 8.4.10 50/50 gate. The user\'s continuing authorization covers committing and pushing it; a new ordinary CI must still become genuinely green.',
  },
  {
    code: 'RELEASE_PREREQUISITES_PENDING',
    fact: 'The user authorized exactly one additional 1.0.0 dispatch only after the next ordinary CI is green. UHub digests, digest-bound SBOM/provenance, exact-digest image smoke and release success remain absent; no release was dispatched from failed CI run 33173546102.',
  },
]
const harnessRed = {
  classification: 'behavioral',
  command: 'npm.cmd run test:server -- server/src/deployment.test.ts',
  exitCode: 1,
  failure: 'The focused delivery-harness contract failed 1/5 because the cold concurrent-migration beforeAll still inherited Vitest\'s 10-second default. The implementation adds only a 60-second setup-hook argument and leaves every behavioral test timeout and global hookTimeout unchanged.',
}
if (!task.redEvidence.some((entry) => entry.command === harnessRed.command)) task.redEvidence.push(harnessRed)
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
  note: 'The CI12 change is confined to the server MySQL test harness; no product, browser, style, image or visual artifact source changed after the nine CI11 images were opened.',
}
await writeJson(visualManifestPath, visualManifest)

const manifest = await readJson(evidenceManifestPath)
for (const row of manifest.evidence) {
  if (row.id === 'EV-P6-T5-FULL-UNIT' && !row.sourcePaths.some((source) => source.path === 'server/src/deployment.test.ts')) {
    row.sourcePaths.push({ path: 'server/src/deployment.test.ts', sha256: '' })
  }
  row.sourcePaths.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  if (row.id === 'EV-P6-T5-FULL-UNIT') {
    row.summary = 'Fresh CI12 gates pass frontend 88/88 files and 425/425 tests plus server 59 passed files, one exact-only skipped file, 362 ordinary tests and 50 exact-only skips; both typechecks and both production builds pass, and the cold-MySQL hook budget contract passes 5/5.'
  }
  if (row.id === 'EV-P6-T5-FULL-API') {
    row.summary = 'Fresh server gates pass 362 ordinary tests with 50 exact-integration skips, followed by server typecheck/build; the unchanged product source retains the prior official real-Fastify browser matrix 12/12 across Chromium, Firefox and WebKit.'
  }
  if (row.id === 'EV-P6-T5-FULL-MYSQL') {
    row.command = 'owned official mysql:8.4.10 container with SQL-readiness probe; npm.cmd run test:mysql; exact owned-resource cleanup'
    row.summary = 'A fresh owned official MySQL 8.4.10 container accepts SQL readiness, applies all 16 migrations and passes 50/50 exact integration tests in 26.39 seconds with zero skip; the exact container is removed after the run.'
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
  basis: 'Ordinary CI run 33173546102 passed unit/type/build and then exposed only a cold official-MySQL setup-hook timeout before any exact behavior ran. Focused delivery-harness TDD failed 1/5 then passed 5/5 after adding a 60-second timeout only to that beforeAll. Fresh local replay passes frontend 425/425, server 362 ordinary plus 50 exact-only skips, both typechecks/builds and a new official MySQL 8.4.10 exact 50/50 in 26.39 seconds with owned cleanup. Product/browser/image sources did not change, so the existing official Linux Playwright 338/338, real-Fastify 12/12, Helm/security/workflow/image/data/Lighthouse gates and nine opened visual frames remain source-current. All 462 evidence IDs retain exact order; parent truth remains 30/10/4. The next ordinary CI must be green before the single authorized 1.0.0 dispatch; no UHub, attestation, release, DNS/TLS or cluster state is claimed.',
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
