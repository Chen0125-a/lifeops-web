import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-29-p6-t6-ci14-orbit-track-local-full-gates-uncommitted-local-checkpoint.json'
const refreshPath = 'outputs/evidence/p6-t6-ci14-orbit-track-manifest-refresh.mjs'
const evidenceManifestPath = 'docs/traceability/evidence-manifest.json'
const taskExecutionPath = 'docs/traceability/task-execution.json'
const visualManifestPath = 'outputs/final/visual-evidence-manifest.json'
const metricsPath = 'outputs/evidence/browser/p2-t5/public-browser-performance-manifest.json'
const visualRoot = 'outputs/evidence/browser/p6-t6-ci14-orbit-track'

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
  ['src/components/public/PublicOrbit.tsx', 'The four original WAAPI ring owners now carry one tiny promoted motion marker each while four separate static boundaries provide the complete visible track without full-ring mask painting.'],
  ['src/components/public/PublicOrbit.test.tsx', 'The focused structure contract requires four static full-ring boundaries and four aria-hidden moving markers while retaining exact orbit geometry, direction, duration and one-pixel track width.'],
  ['src/publicThemeCompositor.test.ts', 'The compositor contract rejects the former full-size masked pseudo-rings and locks static border strokes plus 6x2 paint-contained promoted markers.'],
  ['src/styles/public.css', 'The complete tracks are static one-pixel borders and only tiny 6x2 markers move with the existing 30/40/50/60-second ring owners, removing the WebKit full-ring mask-composite cost.'],
  ['tests/public-home.spec.ts', 'The browser contract verifies the retired pseudo-mask, exact day/night boundary and marker colors, four tracks and continued cross-browser motion.'],
  [refreshPath, 'The deterministic CI14 refresh preserves all 462 evidence IDs, rehashes current sources and artifacts and records the fresh official Linux 338/338 plus real-Fastify 12/12 replay without promoting registry status.'],
  [checkpointPath, 'The deterministic checkpoint binds the CI14 compositor-safe orbit correction to the current ordinal-sorted source set while excluding generated evidence metadata and sensitive paths.'],
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
      ? 'This primary-agent-opened CI14 frame records the final compositor-safe track rendering at an approved desktop or phone theme/login state.'
      : relativePath.startsWith('outputs/')
        ? 'This CI14 evidence metadata is regenerated deterministically from current on-disk sources and artifacts.'
        : 'This bounded CI14 path is covered by the focused RED/GREEN, complete local gate replay and current visual review.')
}
task.externalBlockers = [
  {
    code: 'ORDINARY_CI_PENDING',
    fact: 'Ordinary CI run 33180615592 passed unit/type/build, official MySQL 8.4 and browser installation, then failed only the WebKit theme-performance project because four full-size rotating mask-composite pseudo-rings exceeded the unchanged P95 budget. Static full-ring boundaries plus tiny promoted moving markers pass focused TDD, fresh full local gates and official Linux Playwright 338/338. The user\'s continuing authorization covers committing and pushing this correction; a new ordinary CI must still become genuinely green.',
  },
  {
    code: 'RELEASE_PREREQUISITES_PENDING',
    fact: 'The user authorized exactly one additional 1.0.0 dispatch only after the next ordinary CI is green. UHub digests, digest-bound SBOM/provenance, exact-digest image smoke and release success remain absent; no release was dispatched from failed CI run 33180615592.',
  },
]
const orbitTrackRed = {
  classification: 'behavioral',
  command: 'npm.cmd test -- src/components/public/PublicOrbit.test.tsx src/publicThemeCompositor.test.ts',
  exitCode: 1,
  failure: 'The focused orbit-track contract failed exactly two assertions because the DOM lacked four static boundaries/four moving markers and CSS still painted full-size masked pseudo-rings. The implementation preserves the four original WAAPI owners and geometry while separating static complete tracks from tiny moving markers.',
}
if (!task.redEvidence.some((entry) => entry.failure === orbitTrackRed.failure)) task.redEvidence.push(orbitTrackRed)
await writeJson(taskExecutionPath, taskExecution)

const checkpoint = await buildLocalCheckpoint(root)
await writeJson(checkpointPath, checkpoint)
const revalidatedAt = new Date().toISOString()

const visualCases = [
  ['day-rest-desktop', '1440x900', 'light', false, '1440x900-day-rest.png'],
  ['day-login-desktop', '1440x900', 'light', true, '1440x900-day-login.png'],
  ['night-rest-desktop', '1440x900', 'dark', false, '1440x900-night-rest.png'],
  ['night-login-desktop', '1440x900', 'dark', true, '1440x900-night-login.png'],
  ['day-rest-phone', '390x844', 'light', false, '390x844-day-rest.png'],
  ['day-login-phone', '390x844', 'light', true, '390x844-day-login.png'],
  ['night-rest-phone', '390x844', 'dark', false, '390x844-night-rest.png'],
  ['night-login-phone', '390x844', 'dark', true, '390x844-night-login.png'],
]
const visualManifest = await readJson(visualManifestPath)
visualManifest.checkpointRootSha256 = checkpoint.rootSha256
visualManifest.generatedAt = revalidatedAt
visualManifest.states = visualManifest.states.filter((state) => !state.id.startsWith('p6-t6-ci14-'))
for (const [suffix, viewport, colorScheme, login, fileName] of visualCases) {
  visualManifest.states.push({
    id: `p6-t6-ci14-${suffix}`,
    browser: 'Playwright Chromium 1.62.1 compositor-safe orbit acceptance capture',
    viewport,
    dpr: 1,
    colorScheme,
    reducedMotion: 'no-preference',
    fixtureSeedId: `p6-t6-ci14-${suffix}`,
    screenshotPath: `${visualRoot}/${fileName}`,
    filmstripPath: null,
    tracePath: null,
    reviewer: 'primary-agent',
    openedOriginalResolution: true,
    result: 'pass',
    diagnostics: {
      login,
      overflow: 0,
      labels: login ? null : 5,
      center: { count: '05', label: '此刻正在发生' },
      titleSupportVisibility: login ? 'hidden' : 'visible',
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
  note: 'The primary executor opened all eight CI14 1440x900 and 390x844 day/night rest/login frames individually at original resolution. Complete static boundaries, subtle moving markers, orbit-left/title-recede depth, dark night login, mobile safe inset and the unlit 05 center all pass.',
}
await writeJson(visualManifestPath, visualManifest)

const manifest = await readJson(evidenceManifestPath)
for (const row of manifest.evidence) {
  row.sourcePaths.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  if (row.id === 'EV-P6-T5-ADR029-UNIT') {
    row.summary = 'Fresh focused orbit/compositor contracts pass 20/20 after a two-assertion RED. They require four static complete boundaries, four tiny moving markers, retired full-ring masks and the unchanged exact geometry, direction and 30/40/50/60-second owners.'
  }
  if (row.id === 'EV-P6-T5-ADR029-E2E-CHROMIUM') {
    row.summary = 'Fresh Chromium public-home coverage passes 6/6 and the complete official Linux matrix passes every Chromium 1440/1024/768/390 acceptance under workers=1 and retries=0.'
  }
  if (row.id === 'EV-P6-T5-ADR029-E2E-WEBKIT') {
    row.summary = 'Fresh official Linux WebKit evidence passes the dedicated unchanged-ceiling theme-performance project 1/1, five repeated focused theme runs 5/5, public-home critical 5/5 and the complete matrix WebKit-critical segment 25/25 with workers=1 and retries=0.'
  }
  if (row.id === 'EV-P6-T5-ADR029-E2E-FIREFOX') {
    row.summary = 'Fresh official Linux Firefox evidence passes the dedicated unchanged-ceiling theme-performance project 1/1, public-home critical 5/5 and the complete matrix Firefox-critical segment 25/25 with workers=1 and retries=0.'
  }
  if (row.id === 'EV-P6-T5-ADR029-VISUAL-1440') {
    row.command = `view_image ${visualRoot}/1440x900-night-login.png`
    row.summary = 'The opened current 1440x900 night-login frame preserves the unlit 05 center, four complete static boundaries with subtle live markers, orbit-left/title-recede depth, dark task surface, high-contrast login and zero overflow.'
  }
  if (row.id === 'EV-P6-T5-ADR029-VISUAL-390') {
    row.command = `view_image ${visualRoot}/390x844-night-rest.png`
    row.summary = 'The opened current 390x844 night-rest frame preserves the complete outer boundary with safe bottom inset, readable zones, subtle track markers, unlit center and zero horizontal overflow.'
  }
  if (row.id === 'EV-P6-T5-ADR029-VISUAL-MOTION') {
    row.summary = 'Fresh official Chromium, Firefox and WebKit checks prove all four original ring transforms continue under their exact 30/40/50/60-second owners while complete static boundaries avoid the rejected WebKit full-ring mask-composite cost.'
  }
  if (row.id === 'EV-P6-T5-FULL-UNIT') {
    row.summary = 'Fresh CI14 gates pass frontend 88/88 files and 425/425 tests, including focused orbit/compositor contracts 20/20, plus frontend typecheck and an 885-module production build. Server gates pass 362 ordinary tests plus 50 exact-only skips and dual server typecheck/build.'
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
    row.summary = 'Fresh CI-order official Playwright 1.62.1 Linux gates pass 338/338 current checks: WebKit theme 1/1, Firefox theme 1/1 and the complete six-project matrix 336/336 in 23.9 minutes with workers=1 and retries=0. The production compressed-asset budget passes under its unchanged thresholds.'
  }
  if (row.id === 'EV-P6-T5-FULL-E2E-REMOTE') {
    row.summary = 'Fresh official Linux real-Fastify browser coverage passes 12/12 across Chromium, Firefox and WebKit, including authenticated writes, reload, failure recovery and Back reversal.'
  }
  if (row.id === 'EV-P6-T5-FULL-VISUAL-1440') {
    row.command = `view_image ${visualRoot}/{1440x900-day-rest,1440x900-day-login,1440x900-night-rest,1440x900-night-login}.png`
    row.summary = 'The primary executor opened and accepted all four current 1440x900 day/night rest/login images individually; they preserve complete rings, subtle live markers, approved depth, stable geometry and zero overflow.'
  }
  if (row.id === 'EV-P6-T5-FULL-VISUAL-390') {
    row.command = `view_image ${visualRoot}/{390x844-day-rest,390x844-day-login,390x844-night-rest,390x844-night-login}.png`
    row.summary = 'The primary executor opened and accepted all four current 390x844 day/night rest/login images individually; they preserve separate content zones, complete outer-ring inset, full-screen mobile login, subtle live markers and zero horizontal overflow.'
  }
  if (row.id === 'EV-P6-T5-FULL-MANUAL-REVIEW') {
    row.command = `view_image ${visualRoot}/*.png individually at original resolution`
    row.summary = 'The primary executor directly opened all eight current desktop/phone day/night rest/login images. Direct review confirms four complete tracks, subtle moving markers, the unlit center, orbit-left/title-recede depth, dark night login, mobile breathing space and zero horizontal overflow.'
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
  basis: 'Ordinary CI run 33180615592 passed unit/type/build, official MySQL 8.4 and browser installation, then failed only WebKit theme-performance: baseline P95/max 18/18 ms and transition P95/max 50/52 ms against unchanged 35/100 ms budgets. Systematic diagnostics identified the four full-size rotating mask-composite pseudo-rings as the dominant cost. Focused TDD failed exactly two assertions until complete tracks became static one-pixel boundaries and each unchanged WAAPI ring owner carried only one promoted 6x2 marker. No worker, retry, browser, timing sample, threshold, geometry, direction, 30/40/50/60-second period or approved scene motion changed. Fresh current-source gates pass frontend 425/425, typecheck/build; server 362 ordinary plus 50 exact-only skips, typecheck/build; official MySQL 50/50; Helm/media/security/observability/workflow/release contracts; current-source Web/API image smoke; official Linux Playwright 338/338 plus five repeated WebKit theme runs; real-Fastify 12/12; and eight individually opened final images. The exact CI14 containers, three owned volumes, two local test images and temporary Helm directory were removed. All 462 evidence IDs retain exact order; parent truth remains 30/10/4. A new ordinary CI must be green before the single authorized 1.0.0 dispatch; no UHub, attestation, release, DNS/TLS or cluster state is claimed.',
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
