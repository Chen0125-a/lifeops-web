import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-30-p6-t6-ci18-prepaint-local-full-gates-uncommitted-local-checkpoint.json'
const refreshPath = 'outputs/evidence/p6-t6-ci18-prepaint-manifest-refresh.mjs'
const auditPath = 'outputs/evidence/p6-t6-ci18-prepaint-visual-audit.mjs'
const evidenceManifestPath = 'docs/traceability/evidence-manifest.json'
const taskExecutionPath = 'docs/traceability/task-execution.json'
const visualManifestPath = 'outputs/final/visual-evidence-manifest.json'
const metricsPath = 'outputs/evidence/browser/p6-t6-ci18-prepaint-final/metrics.json'
const visualRoot = 'outputs/evidence/browser/p6-t6-ci18-prepaint-final'
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
  throw new Error(`Tracked historical browser evidence changed outside CI18 root: ${JSON.stringify(dirtyHistoricalEvidence)}`)
}

function currentWorktreePaths() {
  return statusRows
    .map((row) => row.path)
    .filter((relativePath) => !relativePath.startsWith('outputs/evidence/browser/p6-t6-ci6-full-browser-failures/'))
    .filter((relativePath) => !protectedPaths.has(relativePath))
}

const sourceReasons = new Map([
  ['src/pages/PublicHomePage.tsx', 'The decoded raster star field remains visible on a promoted layer and theme switching waits for two paint frames before the day overlay changes.'],
  ['src/styles/public.css', 'The persistent raster star layer and promoted day overlay remove first-use WebKit texture upload while preserving the approved day/night appearance.'],
  ['src/publicThemeCompositor.test.ts', 'The focused compositor contract locks visible raster prepaint, the day overlay and the unchanged WebKit performance budgets.'],
  ['src/pages/PublicHomePage.test.tsx', 'The public-page contracts verify the two-frame prepaint readiness boundary and keep the independent default-night override test on real paint timers.'],
  ['tests/public-home.spec.ts', 'The browser contract verifies the visible raster layer, atomic theme switch and unchanged public geometry and motion.'],
  ['tests/accessibility-full.spec.ts', 'The accessibility matrix now waits only for route-specific visible surfaces before scanning, avoiding animation-race false failures without suppressing violations.'],
  ['tests/adr029-login-orbit.spec.ts', 'The mobile geometry harness waits for the one-shot title and stable ring width before measuring the unchanged safe-inset contract.'],
  ['scripts/run-lighthouse.mjs', 'The Lighthouse child process receives Playwright Chromium through the supported CHROME_PATH environment contract instead of an ignored CLI flag.'],
  ['src/lighthouseRunner.test.ts', 'The focused launcher contract requires CHROME_PATH and forbids the unsupported --chrome-path argument.'],
  [auditPath, 'The evidence-only audit reads all eight current theme/login states and records geometry, overflow, labels, center copy, overlay opacity and decoded raster readiness without replacing screenshots.'],
  [refreshPath, 'The deterministic CI18 refresh preserves all 462 evidence IDs and order, rehashes current sources and artifacts, and refuses tracked historical-browser drift.'],
  [checkpointPath, 'The deterministic checkpoint binds the CI18 prepaint correction and fresh complete local gates to the ordinal-sorted current source set.'],
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
      ? 'This primary-agent-opened CI18 frame or numerical audit records the approved prepainted theme result at a desktop or phone rest/login state.'
      : relativePath.startsWith('outputs/')
        ? 'This CI18 evidence artifact is regenerated from current on-disk sources and its exact bytes are rebound by the evidence manifest.'
        : 'This bounded CI18 path is covered by focused RED/GREEN, the complete local gate replay and current visual review.')
}
task.externalBlockers = [
  {
    code: 'ORDINARY_CI_PENDING',
    fact: 'Ordinary CI run 33261353542 at 56611eaf passed frontend unit/type/build, official MySQL and browser installation, then failed only WebKit theme performance because the decoded raster image was hidden until the first theme click, causing first-use texture upload and paint. The persistent promoted raster plus two-frame day-overlay prepaint passes focused TDD, frontend 425/425, typecheck/build, the official Linux Playwright matrix 336/336, real-Fastify 12/12, Lighthouse and direct eight-state review. A new ordinary CI must still become genuinely green.',
  },
  {
    code: 'RELEASE_PREREQUISITES_PENDING',
    fact: 'The user authorized exactly one additional 1.0.0 dispatch only after the next ordinary CI is green. UHub digests, digest-bound SBOM/provenance, exact-digest image smoke and release success remain absent; no release was dispatched from failed CI run 33261353542.',
  },
]
const prepaintRed = {
  classification: 'behavioral',
  command: 'GitHub Actions ordinary CI run 33261353542 / job 99123743985: WebKit theme-performance',
  exitCode: 1,
  failure: 'The unchanged WebKit theme budget failed at transition P95/max 53/81 ms because the decoded raster image remained visibility:hidden until first theme use; baseline P95/max was 18/18 ms.',
}
if (!task.redEvidence.some((entry) => entry.failure === prepaintRed.failure)) task.redEvidence.push(prepaintRed)
const lighthouseRed = {
  classification: 'behavioral',
  command: 'npm.cmd test -- src/lighthouseRunner.test.ts --run',
  exitCode: 1,
  failure: 'The focused launcher contract failed exactly because run-lighthouse.mjs passed unsupported --chrome-path instead of the Lighthouse-supported CHROME_PATH environment variable.',
}
if (!task.redEvidence.some((entry) => entry.failure === lighthouseRed.failure)) task.redEvidence.push(lighthouseRed)
await writeJson(taskExecutionPath, taskExecution)

const checkpoint = await buildLocalCheckpoint(root)
await writeJson(checkpointPath, checkpoint)
const revalidatedAt = new Date().toISOString()
const metrics = await readJson(metricsPath)
if (!metrics.ok || metrics.failures.length !== 0 || metrics.results.length !== 8) {
  throw new Error(`CI18 visual metrics are not a clean eight-state result: ${JSON.stringify(metrics.failures)}`)
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
visualManifest.states = visualManifest.states.filter((state) => !state.id.startsWith('p6-t6-ci18-'))
for (const [suffix, captureKey, viewport, colorScheme, theme, stateName, login, fileName] of visualCases) {
  const diagnostic = metrics.results.find((entry) => entry.capture === captureKey && entry.theme === theme && entry.state === stateName)
  if (!diagnostic) throw new Error(`Missing visual diagnostic for ${captureKey}/${theme}/${stateName}`)
  visualManifest.states.push({
    id: `p6-t6-ci18-${suffix}`,
    browser: 'Playwright Chromium 1.62.1 current-source acceptance capture',
    viewport,
    dpr: 1,
    colorScheme,
    reducedMotion: 'no-preference',
    fixtureSeedId: `p6-t6-ci18-${suffix}`,
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
      dayOverlayOpacity: diagnostic.dayOverlayOpacity,
      preloadedStarFieldSource: diagnostic.preloadedStarFieldSource,
      preloadedStarFieldVisibility: diagnostic.preloadedStarFieldVisibility,
      preloadedStarFieldNaturalSize: diagnostic.preloadedStarFieldNaturalSize,
      outerRingSafeInset: 'pass',
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
  note: 'The primary executor opened all eight CI18 1440x900 and 390x844 day/night rest/login frames individually at original resolution. A separate eight-state audit confirms zero overflow, five labels, the complete safe-inset outer ring, plain 05 center, correct login surface and the decoded visible 1440x900 raster beneath the day overlay.',
}
await writeJson(visualManifestPath, visualManifest)

const manifest = await readJson(evidenceManifestPath)
const evidenceIdsBefore = manifest.evidence.map((row) => row.id)
for (const row of manifest.evidence) {
  if (row.id === 'EV-P6-T5-ADR029-UNIT') {
    row.summary = 'Fresh affected contracts pass 19/19. They require the decoded raster to remain visible, require two prepaint frames before theme switching, preserve default night/manual day behavior and retain the original orbit geometry and motion contracts.'
  }
  if (row.id === 'EV-P6-T5-ADR029-E2E-CHROMIUM') {
    row.summary = 'Fresh official Linux Chromium coverage passes the complete current-source matrix, including visible raster prepaint, atomic theme switching, login focus and all approved desktop/phone geometry.'
  }
  if (row.id === 'EV-P6-T5-ADR029-E2E-WEBKIT') {
    row.summary = 'Fresh official Linux WebKit coverage passes its complete current-source critical and unchanged-ceiling theme-performance matrix after the raster remains decoded and visible beneath the day overlay; workers=1 and retries=0 remain unchanged.'
  }
  if (row.id === 'EV-P6-T5-ADR029-E2E-FIREFOX') {
    row.summary = 'Fresh official Linux Firefox coverage passes its complete current-source critical and theme-performance matrix with the same worker, retry, geometry and timing contracts.'
  }
  if (row.id === 'EV-P6-T5-ADR029-VISUAL-1440') {
    row.command = `view_image ${visualRoot}/public-login-night-1440.png`
    row.summary = 'The opened current 1440x900 night-login frame preserves the plain 05 center, four complete rings, orbit-left/title-recede depth, dark login task surface, high contrast and zero overflow.'
  }
  if (row.id === 'EV-P6-T5-ADR029-VISUAL-390') {
    row.command = `view_image ${visualRoot}/public-home-night-390.png`
    row.summary = 'The opened current 390x844 night-rest frame preserves a complete outer ring with about 16px bottom safety, readable labels, the plain unlit center and zero horizontal overflow.'
  }
  if (row.id === 'EV-P6-T5-ADR029-VISUAL-MOTION') {
    row.summary = 'Fresh Chromium, Firefox and WebKit browser checks prove all four original ring transforms continue under their exact 30/40/50/60-second owners while the persistent raster prepaint changes neither geometry nor motion rate.'
  }
  if (row.id === 'EV-P6-T5-FULL-UNIT') {
    row.summary = 'Fresh current-source gates pass frontend 88/88 files and 425/425 tests, the affected theme contracts 19/19, the Lighthouse launcher contract 1/1, frontend typecheck and an 885-module production build. Server gates remain source-current at 362 ordinary tests plus 50 exact-only skips and server typecheck/build.'
  }
  if (row.id === 'EV-P6-T5-FULL-API') {
    row.summary = 'Fresh official Linux real-Fastify browser coverage passes 12/12 across Chromium, Firefox and WebKit; unchanged server unit/type/build evidence remains 362 ordinary tests plus 50 exact-only skips.'
  }
  if (row.id === 'EV-P6-T5-FULL-MYSQL') {
    row.summary = 'A current disposable official MySQL 8.4.10 rehearsal applied all 16 migrations, passed 50/50 exact tests and verified dump/restore checksums before exact cleanup; no user or cluster database was accessed.'
  }
  if (row.id === 'EV-P6-T5-FULL-E2E') {
    row.command = 'official mcr.microsoft.com/playwright:v1.62.1-noble: npm run test:e2e after npm run build'
    row.summary = 'The fresh CI-order official Linux Playwright matrix passes 336/336 in 29.1 minutes with workers=1 and retries=0. It includes Chromium, Firefox, WebKit, accessibility, responsive, visual, performance and unchanged compressed-asset budgets.'
  }
  if (row.id === 'EV-P6-T5-FULL-E2E-REMOTE') {
    row.summary = 'Fresh official Linux real-Fastify coverage passes 12/12 across Chromium, Firefox and WebKit, including authenticated writes, reload, failure recovery and Back reversal.'
  }
  if (row.id === 'EV-P6-T5-FULL-VISUAL-1440') {
    row.command = `view_image ${visualRoot}/{public-home-day-1440,public-login-day-1440,public-home-night-1440,public-login-night-1440}.png`
    row.summary = 'The primary executor opened all four current 1440x900 day/night rest/login images individually; complete rings, approved depth, correct theme surfaces and zero overflow pass.'
  }
  if (row.id === 'EV-P6-T5-FULL-VISUAL-390') {
    row.command = `view_image ${visualRoot}/{public-home-day-390,public-login-day-390,public-home-night-390,public-login-night-390}.png`
    row.summary = 'The primary executor opened all four current 390x844 day/night rest/login images individually; the safe outer-ring inset, uncluttered rest scene, full-screen mobile login and zero overflow pass.'
  }
  if (row.id === 'EV-P6-T5-FULL-MANUAL-REVIEW') {
    row.command = `view_image ${visualRoot}/*.png individually at original resolution`
    row.summary = 'The primary executor directly opened all eight current desktop/phone day/night rest/login images. Direct review and the separate numerical audit confirm complete moving rings, the plain 05 center, orbit-left/title-recede depth, dark night login, mobile breathing space, decoded visible raster prepaint and zero overflow.'
  }
  row.checkpoint = checkpoint.rootSha256
  for (const source of row.sourcePaths) source.sha256 = await hashRelative(source.path)
  if (row.artifactPath) row.artifactSha256 = await hashRelative(row.artifactPath)
  row.revalidatedAt = revalidatedAt
}
if (manifest.evidence.length !== 462 || manifest.evidence.some((row, index) => row.id !== evidenceIdsBefore[index])) {
  throw new Error('Evidence row count or ID order changed during CI18 refresh')
}
manifest.checkpoint = checkpoint.rootSha256
manifest.revalidation = {
  taskId: 'P6-T6',
  step: 7,
  revalidatedAt,
  basis: 'Ordinary CI run 33261353542 at 56611eaf passed frontend unit/type/build, official MySQL and browser installation, then failed only WebKit theme performance because the decoded raster image was hidden until first use. Focused TDD retained the decoded raster as a visible promoted layer beneath a day overlay and delayed theme availability for two paint frames without changing workers, retries, browsers, geometry, timing budgets, ring periods or motion rate. Fresh current-source evidence passes affected theme contracts 19/19, frontend 88/88 files and 425/425 tests, typecheck and 885-module build, the Lighthouse launcher contract 1/1 and official Linux Lighthouse scores 1.00/1.00/0.96/0.91, official Linux Playwright 336/336, real-Fastify 12/12, source-current server 362 ordinary plus 50 exact-only skips, official MySQL 50/50 with 16-migration dump/restore, Helm/media/security/observability/workflow/release contracts, audits and current-source image smoke. All eight current screenshots were opened individually and a separate eight-state audit passed. The eight protected historical untracked files remain untouched. All 462 evidence IDs retain exact order; parent truth remains 30/10/4. A new ordinary CI must be green before the single authorized 1.0.0 dispatch; no UHub digest, attestation, release, DNS/TLS or cluster state is claimed.',
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
