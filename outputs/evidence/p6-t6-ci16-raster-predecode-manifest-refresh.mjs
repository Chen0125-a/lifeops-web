import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-29-p6-t6-ci16-raster-predecode-local-full-gates-uncommitted-local-checkpoint.json'
const refreshPath = 'outputs/evidence/p6-t6-ci16-raster-predecode-manifest-refresh.mjs'
const evidenceManifestPath = 'docs/traceability/evidence-manifest.json'
const taskExecutionPath = 'docs/traceability/task-execution.json'
const visualManifestPath = 'outputs/final/visual-evidence-manifest.json'
const metricsPath = 'outputs/evidence/browser/p6-t6-ci16-raster-predecode/metrics.json'
const visualRoot = 'outputs/evidence/browser/p6-t6-ci16-raster-predecode'
const rasterPath = 'public/public-stars-raster.png'
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
    .map((line) => ({
      code: line.slice(0, 2),
      path: line.slice(3).replaceAll('\\', '/'),
    }))
}

const statusRows = worktreeRows()
const dirtyHistoricalEvidence = statusRows.filter(({ code, path: relativePath }) => (
  code !== '??'
  && relativePath.startsWith('outputs/evidence/browser/')
  && !relativePath.startsWith(`${visualRoot}/`)
))
if (dirtyHistoricalEvidence.length > 0) {
  throw new Error(`Tracked historical browser evidence changed outside CI16 root: ${JSON.stringify(dirtyHistoricalEvidence)}`)
}

function currentWorktreePaths() {
  return statusRows
    .map((row) => row.path)
    .filter((relativePath) => !relativePath.startsWith('outputs/evidence/browser/p6-t6-ci6-full-browser-failures/'))
    .filter((relativePath) => !protectedPaths.has(relativePath))
}

const sourceReasons = new Map([
  [rasterPath, 'The transparent 1440x900 PNG remains both the rendered night-sky asset and the exact hidden image decoded before theme switching.'],
  ['src/pages/PublicHomePage.tsx', 'The hidden star-field image now predecodes the exact raster asset consumed by CSS instead of decoding the retained SVG source.'],
  ['src/pages/PublicHomePage.test.tsx', 'The focused unit contract requires the raster preload source and proves theme switching stays disabled until its decode boundary resolves.'],
  ['src/components/public/DaylightAperture.test.tsx', 'The aperture contract now expects the same raster preload source as the public page.'],
  ['tests/public-home.spec.ts', 'The browser contract still fetches and audits all three SVG source layers while requiring the hidden preloader and computed night sky to use the raster asset.'],
  ['vitest.config.ts', 'The four-worker jsdom ceiling keeps unchanged lazy-route assertion budgets deterministic on high-core memory-constrained hosts without reducing test count or coverage.'],
  ['outputs/evidence/p6-t6-ci16-raster-predecode-visual-capture.mjs', 'This reproducible evidence-only capture records eight approved desktop/phone day/night rest/login states, exact geometry and the raster preload source without altering product behavior.'],
  [refreshPath, 'The deterministic CI16 refresh preserves all 462 evidence IDs and order, rehashes current sources/artifacts, records fresh complete local gates and refuses dirty tracked historical browser evidence.'],
  [checkpointPath, 'The deterministic checkpoint binds the CI16 raster-predecode correction to the current ordinal-sorted source set while excluding generated evidence metadata and sensitive paths.'],
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
    ?? (relativePath.startsWith(`${visualRoot}/`)
      ? 'This primary-agent-opened CI16 frame or geometry manifest records the final raster-predecoded rendering at an approved desktop or phone theme/login state.'
      : relativePath.startsWith('outputs/')
        ? 'This CI16 evidence metadata is regenerated deterministically from current on-disk sources and artifacts.'
        : 'This bounded CI16 path is covered by the focused RED/GREEN, complete local gate replay and current visual review.')
}
task.externalBlockers = [
  {
    code: 'ORDINARY_CI_PENDING',
    fact: 'Ordinary CI run 33255141653 passed unit/type/build, official MySQL 8.4 and browser installation, then failed only WebKit theme-performance because the hidden preload still decoded public-stars.svg instead of the raster PNG consumed by CSS. Baseline P95/max were 17/19 ms and transition P95/max were 52/70 ms against unchanged 34/100 ms budgets. Predecoding the exact raster asset passes focused TDD and fresh complete local gates. The user\'s continuing authorization covers committing and pushing this correction; a new ordinary CI must still become genuinely green.',
  },
  {
    code: 'RELEASE_PREREQUISITES_PENDING',
    fact: 'The user authorized exactly one additional 1.0.0 dispatch only after the next ordinary CI is green. UHub digests, digest-bound SBOM/provenance, exact-digest image smoke and release success remain absent; no release was dispatched from failed CI run 33255141653.',
  },
]
const rasterPredecodeRed = {
  classification: 'behavioral',
  command: 'npm.cmd test -- src/pages/PublicHomePage.test.tsx',
  exitCode: 1,
  failure: 'The focused public-page contract passed 13 assertions and failed exactly two because the hidden data-star-field image still decoded public-stars.svg instead of the raster PNG actually used by the night sky.',
}
if (!task.redEvidence.some((entry) => entry.failure === rasterPredecodeRed.failure)) task.redEvidence.push(rasterPredecodeRed)
await writeJson(taskExecutionPath, taskExecution)

const checkpoint = await buildLocalCheckpoint(root)
await writeJson(checkpointPath, checkpoint)
const revalidatedAt = new Date().toISOString()
const metrics = await readJson(metricsPath)
if (!metrics.ok || metrics.failures.length !== 0 || metrics.results.length !== 8) {
  throw new Error(`CI16 visual metrics are not a clean eight-state result: ${JSON.stringify(metrics.failures)}`)
}

const visualCases = [
  ['day-rest-desktop', '1440', '1440x900', 'light', 'day', 'rest', false, 'public-home-day-1440.png'],
  ['day-login-desktop', '1440', '1440x900', 'light', 'day', 'login', true, 'public-login-day-1440.png'],
  ['night-rest-desktop', '1440', '1440x900', 'dark', 'night', 'rest', false, 'public-home-night-1440.png'],
  ['night-login-desktop', '1440', '1440x900', 'dark', 'night', 'login', true, 'public-login-night-1440.png'],
  ['day-rest-phone', '390', '390x844', 'light', 'day', 'rest', false, 'public-home-day-390.png'],
  ['day-login-phone', '390', '390x844', 'light', 'day', 'login', true, 'public-login-day-390.png'],
  ['night-rest-phone', '390', '390x844', 'dark', 'night', 'rest', false, 'public-home-night-390.png'],
  ['night-login-phone', '390', '390x844', 'dark', 'night', 'login', true, 'public-login-night-390.png'],
]
const visualManifest = await readJson(visualManifestPath)
visualManifest.checkpointRootSha256 = checkpoint.rootSha256
visualManifest.generatedAt = revalidatedAt
visualManifest.states = visualManifest.states.filter((state) => !state.id.startsWith('p6-t6-ci16-'))
for (const [suffix, captureKey, viewport, colorScheme, theme, stateName, login, fileName] of visualCases) {
  const diagnostic = metrics.results.find((entry) => entry.capture === captureKey && entry.theme === theme && entry.state === stateName)
  if (!diagnostic) throw new Error(`Missing visual diagnostic for ${captureKey}/${theme}/${stateName}`)
  visualManifest.states.push({
    id: `p6-t6-ci16-${suffix}`,
    browser: 'Playwright Chromium 1.62.1 raster-predecode acceptance capture',
    viewport,
    dpr: 1,
    colorScheme,
    reducedMotion: 'no-preference',
    fixtureSeedId: `p6-t6-ci16-${suffix}`,
    screenshotPath: `${visualRoot}/${fileName}`,
    filmstripPath: null,
    tracePath: null,
    reviewer: 'primary-agent',
    openedOriginalResolution: true,
    result: 'pass',
    diagnostics: {
      login,
      overflow: diagnostic.overflowX,
      labels: diagnostic.visibleLabels,
      center: { count: '05', label: '此刻正在发生' },
      outerRing: diagnostic.outerRing,
      dialog: diagnostic.dialog,
      publicTheme: diagnostic.publicTheme,
      skyBackgroundImage: diagnostic.skyBackgroundImage,
      preloadedStarFieldSource: diagnostic.preloadedStarFieldSource,
      outerRingSafeInset: 'pass',
      trackRendering: 'static complete boundary plus promoted 6x2 moving marker',
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
  note: 'The primary executor opened all eight CI16 1440x900 and 390x844 day/night rest/login frames individually at original resolution. The exact raster preload source, visible stars, complete rings, orbit-left/title-recede depth, dark night login, mobile safe inset and the unlit 05 center all pass.',
}
await writeJson(visualManifestPath, visualManifest)

const manifest = await readJson(evidenceManifestPath)
const evidenceIdsBefore = manifest.evidence.map((row) => row.id)
for (const row of manifest.evidence) {
  row.sourcePaths ??= []
  if (
    row.sourcePaths.some((source) => source.path === 'public/public-stars.svg')
    && !row.sourcePaths.some((source) => source.path === rasterPath)
  ) {
    row.sourcePaths.push({ path: rasterPath, sha256: '' })
  }
  row.sourcePaths.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  if (row.id === 'EV-P6-T5-ADR029-UNIT') {
    row.summary = 'The focused public-page contract first passed 13 assertions and failed exactly two until the hidden preload decoded the same raster PNG consumed by CSS; the combined affected contracts now pass 21/21 while retaining the original SVG source and unchanged orbit contracts.'
  }
  if (row.id === 'EV-P6-T5-ADR029-E2E-CHROMIUM') {
    row.summary = 'Fresh Chromium public-home coverage verifies the computed night sky points to the raster asset, and the complete official Linux matrix passes every Chromium 1440/1024/768/390 acceptance under workers=1 and retries=0.'
  }
  if (row.id === 'EV-P6-T5-ADR029-E2E-WEBKIT') {
    row.summary = 'Fresh official Linux WebKit evidence passes the dedicated unchanged-ceiling theme-performance project 1/1, ten repeated focused theme runs 10/10, public-home critical 5/5 and the complete matrix WebKit-critical segment 25/25 with workers=1 and retries=0.'
  }
  if (row.id === 'EV-P6-T5-ADR029-E2E-FIREFOX') {
    row.summary = 'Fresh official Linux Firefox evidence passes the dedicated unchanged-ceiling theme-performance project 1/1, public-home critical 5/5 and the complete matrix Firefox-critical segment 25/25 with workers=1 and retries=0.'
  }
  if (row.id === 'EV-P6-T5-ADR029-VISUAL-1440') {
    row.command = `view_image ${visualRoot}/public-login-night-1440.png`
    row.summary = 'The opened current 1440x900 night-login frame preserves visible stars, the unlit 05 center, four complete rings, orbit-left/title-recede depth, dark task surface, high-contrast login and zero overflow.'
  }
  if (row.id === 'EV-P6-T5-ADR029-VISUAL-390') {
    row.command = `view_image ${visualRoot}/public-home-night-390.png`
    row.summary = 'The opened current 390x844 night-rest frame preserves visible stars, the complete outer ring with safe bottom inset, readable zones, unlit center and zero horizontal overflow.'
  }
  if (row.id === 'EV-P6-T5-ADR029-VISUAL-MOTION') {
    row.summary = 'Fresh official Chromium, Firefox and WebKit checks prove all four original ring transforms continue under their exact 30/40/50/60-second owners while the raster star field removes theme-switch SVG painting without changing motion.'
  }
  if (row.id === 'EV-P6-T5-FULL-UNIT') {
    row.summary = 'Fresh CI16 gates pass frontend 88/88 files and 425/425 tests, including combined affected contracts 21/21, plus frontend typecheck and an 885-module production build. The explicit four-worker Vitest ceiling keeps the unchanged lazy-route assertion budgets deterministic on memory-constrained high-core hosts. Server gates pass 362 ordinary tests plus 50 exact-only skips and dual server typecheck/build.'
  }
  if (row.id === 'EV-P6-T5-FULL-API') {
    row.summary = 'Fresh server unit/type/build gates pass 362 ordinary tests and 50 exact-only skips; the official Linux real-Fastify browser matrix passes 12/12 across Chromium, Firefox and WebKit.'
  }
  if (row.id === 'EV-P6-T5-FULL-MYSQL') {
    row.command = 'fresh owned official mysql:8.4.10 integration: 16 migrations and 50/50 exact tests with cleanup'
    row.summary = 'A fresh owned official MySQL 8.4.10 run applied all 16 migrations and passed 50/50 exact tests with zero skip before exact cleanup; no user or cluster database was accessed.'
  }
  if (row.id === 'EV-P6-T5-FULL-E2E') {
    row.command = 'official mcr.microsoft.com/playwright:v1.62.1-noble: npm run test:e2e after npm run build'
    row.summary = 'Fresh CI-order official Playwright 1.62.1 Linux gates pass 338/338 current checks: WebKit theme 1/1, Firefox theme 1/1 and the complete six-project matrix 336/336 in 25.8 minutes with workers=1 and retries=0. The production compressed-asset budget passes under its unchanged thresholds.'
  }
  if (row.id === 'EV-P6-T5-FULL-E2E-REMOTE') {
    row.summary = 'Fresh official Linux real-Fastify browser coverage passes 12/12 across Chromium, Firefox and WebKit, including authenticated writes, reload, failure recovery and Back reversal.'
  }
  if (row.id === 'EV-P6-T5-FULL-VISUAL-1440') {
    row.command = `view_image ${visualRoot}/{public-home-day-1440,public-login-day-1440,public-home-night-1440,public-login-night-1440}.png`
    row.summary = 'The primary executor opened and accepted all four current 1440x900 day/night rest/login images individually; they preserve visible stars, complete rings, approved depth, stable geometry and zero overflow.'
  }
  if (row.id === 'EV-P6-T5-FULL-VISUAL-390') {
    row.command = `view_image ${visualRoot}/{public-home-day-390,public-login-day-390,public-home-night-390,public-login-night-390}.png`
    row.summary = 'The primary executor opened and accepted all four current 390x844 day/night rest/login images individually; they preserve visible stars, separate content zones, complete outer-ring inset, full-screen mobile login and zero horizontal overflow.'
  }
  if (row.id === 'EV-P6-T5-FULL-MANUAL-REVIEW') {
    row.command = `view_image ${visualRoot}/*.png individually at original resolution`
    row.summary = 'The primary executor directly opened all eight current desktop/phone day/night rest/login images. Direct review confirms visible raster stars, four complete moving rings, the unlit center, orbit-left/title-recede depth, dark night login, mobile breathing space and zero horizontal overflow.'
  }
  row.checkpoint = checkpoint.rootSha256
  for (const source of row.sourcePaths) source.sha256 = await hashRelative(source.path)
  if (row.artifactPath) row.artifactSha256 = await hashRelative(row.artifactPath)
  row.revalidatedAt = revalidatedAt
}
if (manifest.evidence.length !== 462 || manifest.evidence.some((row, index) => row.id !== evidenceIdsBefore[index])) {
  throw new Error('Evidence row count or ID order changed during CI16 refresh')
}
manifest.checkpoint = checkpoint.rootSha256
manifest.revalidation = {
  taskId: 'P6-T6',
  step: 7,
  revalidatedAt,
  basis: 'Ordinary CI run 33255141653 passed unit/type/build, official MySQL 8.4 and browser installation, then failed only WebKit theme-performance: baseline P95/max 17/19 ms and transition P95/max 52/70 ms against unchanged 34/100 ms budgets. The CSS already consumed the transparent raster star field, but the hidden preload still decoded public-stars.svg; focused TDD passed 13 assertions and failed exactly two until the hidden image decoded the exact raster PNG consumed by CSS. No Playwright worker, retry, browser, timing sample, threshold, geometry, direction, 30/40/50/60-second period or approved scene motion changed. A four-worker Vitest ceiling was added after a memory-constrained 16-core host reproduced seven lazy-route timeouts; raw npm test then passed all 88 files and 425 tests without changing test timeouts, assertions or coverage. Fresh current-source gates pass frontend 425/425, typecheck/build; server 362 ordinary plus 50 exact-only skips, typecheck/build; official MySQL 50/50; Helm/media/security/observability/workflow/release contracts; current-source Web/API image smoke and data rehearsal; official Linux Playwright 338/338 plus ten repeated WebKit theme runs; real-Fastify 12/12; Lighthouse 1.00/1.00/0.96/0.91; and eight individually opened CI16 final images. The first complete browser attempt passed all 334 behavior cases but exposed two EROFS artifact writes under a deliberately read-only outputs mount; the corrected owned outputs volume then passed the entire visual-capture file and the complete 336-case matrix. The eight protected older untracked files remain untouched. All 462 evidence IDs retain exact order; parent truth remains 30/10/4. A new ordinary CI must be green before the single authorized 1.0.0 dispatch; no UHub, attestation, release, DNS/TLS or cluster state is claimed.',
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
