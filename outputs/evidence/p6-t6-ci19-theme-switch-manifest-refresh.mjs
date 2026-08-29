import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-30-p6-t6-ci19-theme-switch-local-full-gates-uncommitted-local-checkpoint.json'
const refreshPath = 'outputs/evidence/p6-t6-ci19-theme-switch-manifest-refresh.mjs'
const evidenceManifestPath = 'docs/traceability/evidence-manifest.json'
const taskExecutionPath = 'docs/traceability/task-execution.json'
const visualManifestPath = 'outputs/final/visual-evidence-manifest.json'
const metricsPath = 'outputs/evidence/browser/p6-t6-ci19-theme-switch-final/metrics.json'
const visualRoot = 'outputs/evidence/browser/p6-t6-ci19-theme-switch-final'
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
  code !== '??'
  && relativePath.startsWith('outputs/evidence/browser/')
  && !relativePath.startsWith(`${visualRoot}/`)
))
if (dirtyHistoricalEvidence.length > 0) {
  throw new Error(`Tracked historical browser evidence changed outside CI19 root: ${JSON.stringify(dirtyHistoricalEvidence)}`)
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
  ['src/styles/public.css', 'The decorative theme-control mark no longer animates transform during a public theme switch, removing the isolated WebKit header compositor spike without changing the final theme state.'],
  ['src/publicThemeCompositor.test.ts', 'The focused compositor contract requires an atomic theme control with no theme-triggered transition while preserving the existing endpoint transform and compositor ownership.'],
  ['outputs/final/data-rehearsal-summary.md', 'The fresh disposable MySQL 8.4.10 rehearsal applies all 16 migrations and verifies dump/restore checksum identity.'],
  ['outputs/final/lighthouse-public.json', 'The current production build passes the unchanged Lighthouse budgets.'],
  ['outputs/final/private-performance.json', 'The current private production route performance sample is regenerated after the CI19 correction.'],
  [refreshPath, 'The deterministic CI19 refresh preserves all 462 evidence IDs and order, rehashes current sources and artifacts, and refuses tracked historical-browser drift.'],
  [checkpointPath, 'The deterministic checkpoint binds the CI19 theme-control correction and complete current-source local gates to the ordinal-sorted source set.'],
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
    ?? (relativePath.startsWith(`${visualRoot}/`)
      ? 'This primary-agent-opened CI19 frame or metrics artifact records the approved desktop or phone day/night rest/login result after the theme-control correction.'
      : relativePath.startsWith('outputs/')
        ? 'This CI19 evidence artifact is regenerated from current on-disk sources and its exact bytes are rebound by the evidence manifest.'
        : 'This bounded CI19 path is covered by focused RED/GREEN and the complete current-source gate replay.')
}
task.externalBlockers = [
  {
    code: 'ORDINARY_CI_PENDING',
    fact: 'Ordinary CI run 33267670149 at 13b7a54 passed frontend unit/type/build, official MySQL and browser installation, then failed only the dedicated WebKit theme-performance gate at transition P95/max 41/76 ms against unchanged 34/100 ms budgets. Isolated diagnostics identified the decorative 420 ms theme-control mark transition; removing only that transition now passes the focused contract, repeated official WebKit gate and complete current-source local verification. A new ordinary CI must still become genuinely green.',
  },
  {
    code: 'RELEASE_PREREQUISITES_PENDING',
    fact: 'The user authorized exactly one additional 1.0.0 dispatch only after the next ordinary CI is green. UHub digests, digest-bound SBOM/provenance, exact-digest image smoke and release success remain absent; no release was dispatched from failed CI run 33267670149.',
  },
]
for (const red of [
  {
    classification: 'behavioral',
    command: 'GitHub Actions ordinary CI run 33267670149 / job 99140524702: WebKit theme-performance',
    exitCode: 1,
    failure: 'The unchanged WebKit theme budget failed at transition P95/max 41/76 ms against 34/100 ms while baseline P95/max was 17/18 ms.',
  },
  {
    classification: 'behavioral',
    command: 'npm.cmd test -- src/publicThemeCompositor.test.ts --run',
    exitCode: 1,
    failure: 'The focused compositor contract failed exactly because .theme-switch__mark still declared a 420 ms theme-triggered transform transition.',
  },
]) {
  if (!task.redEvidence.some((entry) => entry.failure === red.failure)) task.redEvidence.push(red)
}
await writeJson(taskExecutionPath, taskExecution)

const checkpoint = await buildLocalCheckpoint(root)
await writeJson(checkpointPath, checkpoint)
const revalidatedAt = new Date().toISOString()
const metrics = await readJson(metricsPath)
if (metrics.performance.frames !== 71 || metrics.performance.p95Ms > 34 || metrics.performance.maxMs > 100) {
  throw new Error(`CI19 performance metrics exceed the unchanged budget: ${JSON.stringify(metrics.performance)}`)
}
if (metrics.viewportDiagnostics.length !== 8 || metrics.viewportDiagnostics.some((entry) => (
  entry.overflow !== 0 || entry.labels !== 5 || entry.loginBounds.width !== entry.width || entry.loginBounds.height !== entry.height
))) {
  throw new Error('CI19 viewport diagnostics are not a clean eight-state result')
}

const visualCases = [
  ['day-rest-desktop', '1440x900', 'light', 'day', false, 'public-home-day-1440.png'],
  ['day-login-desktop', '1440x900', 'light', 'day', true, 'public-login-day-1440.png'],
  ['night-rest-desktop', '1440x900', 'dark', 'night', false, 'public-home-night-1440.png'],
  ['night-login-desktop', '1440x900', 'dark', 'night', true, 'public-login-night-1440.png'],
  ['day-rest-phone', '390x844', 'light', 'day', false, 'public-home-day-390.png'],
  ['day-login-phone', '390x844', 'light', 'day', true, 'public-login-day-390.png'],
  ['night-rest-phone', '390x844', 'dark', 'night', false, 'public-home-night-390.png'],
  ['night-login-phone', '390x844', 'dark', 'night', true, 'public-login-night-390.png'],
]
const visualManifest = await readJson(visualManifestPath)
visualManifest.checkpointRootSha256 = checkpoint.rootSha256
visualManifest.generatedAt = revalidatedAt
visualManifest.states = visualManifest.states.filter((state) => !state.id.startsWith('p6-t6-ci19-'))
for (const [suffix, viewport, colorScheme, theme, login, fileName] of visualCases) {
  const viewportName = viewport.startsWith('1440') ? '1440' : '390'
  const diagnostic = metrics.viewportDiagnostics.find((entry) => entry.name === viewportName && entry.theme === theme)
  if (!diagnostic) throw new Error(`Missing CI19 diagnostic for ${viewportName}/${theme}`)
  visualManifest.states.push({
    id: `p6-t6-ci19-${suffix}`,
    browser: 'Playwright Chromium 1.62.1 current-source acceptance capture',
    viewport,
    dpr: 1,
    colorScheme,
    reducedMotion: 'no-preference',
    fixtureSeedId: `p6-t6-ci19-${suffix}`,
    screenshotPath: `${visualRoot}/${fileName}`,
    filmstripPath: null,
    tracePath: null,
    reviewer: 'primary-agent',
    openedOriginalResolution: true,
    result: 'pass',
    diagnostics: {
      login,
      overflow: diagnostic.overflow,
      labels: diagnostic.labels,
      center: { count: '05', label: '此刻正在发生' },
      publicTheme: theme,
      loginBounds: diagnostic.loginBounds,
      outerRingSafeInset: 'pass-by-direct-original-resolution-review',
      titleRecession: login ? 'pass-by-direct-original-resolution-review' : 'not-applicable',
      themeControlEndpoint: 'pass-without-theme-triggered-transition',
      ringPeriods: '30/40/50/60s',
    },
  })
}
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
  captureCount: 8,
  conclusion: 'pass',
  note: 'The primary executor opened all eight CI19 1440x900 and 390x844 day/night rest/login frames individually at original resolution. Metrics show 71 frames at 16.8 ms P95/max and eight viewport/theme diagnostics with zero overflow, five labels and full-viewport login bounds. Direct review confirms complete safe-inset rings, the plain 05 center, orbit-left/title-recede depth, dark night login and unchanged theme-control endpoint.',
}
await writeJson(visualManifestPath, visualManifest)

const manifest = await readJson(evidenceManifestPath)
const evidenceIdsBefore = manifest.evidence.map((row) => row.id)
for (const row of manifest.evidence) {
  const summaries = {
    'EV-P6-T5-ADR029-UNIT': 'Fresh focused compositor contracts pass 4/4 and the complete frontend suite passes 88/88 files and 425/425 tests. The contract forbids the isolated theme-control transition while preserving atomic day/night surfaces and the existing endpoint transform.',
    'EV-P6-T5-ADR029-E2E-CHROMIUM': 'Fresh official Linux Chromium coverage passes the current-source matrix, including the unchanged theme budget, login focus and approved desktop/phone geometry.',
    'EV-P6-T5-ADR029-E2E-WEBKIT': 'The original dedicated official Linux WebKit theme gate passes 20/20 repeated runs after removing only the decorative theme-control transition; the complete matrix behavior passes with workers=1, retries=0 and unchanged 34/100 ms budgets.',
    'EV-P6-T5-ADR029-E2E-FIREFOX': 'Fresh official Linux Firefox theme coverage passes with the unchanged worker, retry, geometry and timing contracts.',
    'EV-P6-T5-ADR029-VISUAL-MOTION': 'Fresh Chromium, Firefox and WebKit checks prove all four original ring transforms continue under their exact 30/40/50/60-second owners; only the independent decorative theme-control transition was removed.',
    'EV-P6-T5-FULL-UNIT': 'Fresh current-source gates pass frontend 88/88 files and 425/425 tests, frontend typecheck and an 885-module production build. Server gates pass 362 ordinary tests plus 50 exact-only skips and server typecheck/build.',
    'EV-P6-T5-FULL-API': 'Fresh official Linux real-Fastify browser coverage passes 12/12 across Chromium, Firefox and WebKit; server unit/type/build evidence is 362 ordinary tests plus 50 exact-only skips.',
    'EV-P6-T5-FULL-MYSQL': 'A fresh disposable official MySQL 8.4.10 run applied all 16 migrations and passed 50/50 exact tests. The separate two-instance rehearsal verified dump/restore checksum identity and exact cleanup; no user or cluster database was accessed.',
    'EV-P6-T5-FULL-E2E': 'The official Linux current-source run passed dedicated WebKit and Firefox theme gates and 335/336 matrix cases; the sole failure was an exact LF assertion after Windows git-archive introduced CRLF in the isolated volume. After restoring the source LF bytes, the entire affected public-final file passed 5/5. All behavioral coverage is green without changing workers, retries, browsers, thresholds or tests.',
    'EV-P6-T5-FULL-E2E-REMOTE': 'Fresh official Linux real-Fastify coverage passes 12/12 across Chromium, Firefox and WebKit, including authenticated writes, reload, failure recovery and Back reversal.',
    'EV-P6-T5-FULL-MANUAL-REVIEW': 'The primary executor directly opened all eight current desktop/phone day/night rest/login images. Direct review and numerical diagnostics confirm complete rings, the plain 05 center, orbit-left/title-recede depth, dark night login, mobile breathing space, zero overflow and the unchanged theme-control endpoint.',
  }
  if (summaries[row.id]) row.summary = summaries[row.id]
  if (row.id === 'EV-P6-T5-ADR029-VISUAL-1440') row.command = `view_image ${visualRoot}/public-login-night-1440.png`
  if (row.id === 'EV-P6-T5-ADR029-VISUAL-390') row.command = `view_image ${visualRoot}/public-home-night-390.png`
  if (row.id === 'EV-P6-T5-FULL-VISUAL-1440') row.command = `view_image ${visualRoot}/{public-home-day-1440,public-login-day-1440,public-home-night-1440,public-login-night-1440}.png`
  if (row.id === 'EV-P6-T5-FULL-VISUAL-390') row.command = `view_image ${visualRoot}/{public-home-day-390,public-login-day-390,public-home-night-390,public-login-night-390}.png`
  if (row.id === 'EV-P6-T5-FULL-MANUAL-REVIEW') row.command = `view_image ${visualRoot}/*.png individually at original resolution`
  row.checkpoint = checkpoint.rootSha256
  for (const source of row.sourcePaths) source.sha256 = await hashRelative(source.path)
  if (row.artifactPath) row.artifactSha256 = await hashRelative(row.artifactPath)
  row.revalidatedAt = revalidatedAt
}
if (manifest.evidence.length !== 462 || manifest.evidence.some((row, index) => row.id !== evidenceIdsBefore[index])) {
  throw new Error('Evidence row count or ID order changed during CI19 refresh')
}
manifest.checkpoint = checkpoint.rootSha256
manifest.revalidation = {
  taskId: 'P6-T6',
  step: 7,
  revalidatedAt,
  basis: 'Ordinary CI run 33267670149 at 13b7a54 passed unit/type/build, official MySQL and browser installation, then failed only dedicated WebKit theme performance at transition P95/max 41/76 ms against unchanged 34/100 ms budgets. Official-image subtree diagnostics isolated the independent 420 ms theme-control mark transition; focused TDD removed only that decorative transition and retained final state, ring geometry, ring motion, workers, retries, browsers, sample duration and budgets. Fresh evidence passes focused 4/4, frontend 425/425, both typechecks/builds, server 362 ordinary plus 50 exact skips, official MySQL 50/50, dedicated WebKit 20/20 repeated, Firefox theme, complete behavioral browser coverage with the sole initial exact-LF environment mismatch corrected by a full affected-file 5/5 rerun, real-Fastify 12/12, Helm/media/security/observability/workflow/release contracts, zero-vulnerability audits, current-source image smoke, 16-migration dump/restore and Lighthouse 1.00/1.00/0.96/0.91. All eight CI19 screenshots were opened individually; metrics are 71 frames at 16.8 ms P95/max with zero overflow and five labels across eight viewport/theme diagnostics. The eight protected historical untracked files remain untouched. All 462 evidence IDs retain exact order; parent truth remains 30/10/4. A new ordinary CI must be green before the single authorized 1.0.0 dispatch; no UHub digest, attestation, release, DNS/TLS or cluster state is claimed.',
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
