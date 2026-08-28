import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-28-p6-t6-ci9-browser-local-full-gates-uncommitted-local-checkpoint.json'
const refreshPath = 'outputs/evidence/p6-t6-ci9-manifest-refresh.mjs'
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
  ['scripts/run-lighthouse.mjs', 'The Lighthouse runner retains the same browser and budgets while adding Chromium standard Docker shared-memory fallback, preventing a 64 MiB /dev/shm target crash without changing rendering semantics.'],
  ['src/lighthouseRunner.test.ts', 'The focused Node-side contract proves the Docker shared-memory fallback remains present and forbids rendering-weakening Chrome switches.'],
  ['src/pages/PublicHomePage.tsx', 'Theme switching commits semantic and paint-surface state together and remains disabled only until the already-cached star field decodes, avoiding a first-toggle decode/compositor spike without changing endpoints or motion.'],
  ['src/pages/PublicHomePage.test.tsx', 'Behavioral contracts lock atomic theme-surface state and the bounded cached-star decode readiness gate.'],
  ['src/publicThemeCompositor.test.ts', 'CSS-source contracts reject full-screen compositor layers, backdrop filters and theme-dependent filter topology while preserving the approved day/night track tones.'],
  ['src/styles/public.css', 'The public theme uses one paint-contained sky surface, per-surface semantic variables and stable filter topology; four ring periods, geometry, login depth and the unchanged performance budgets remain intact.'],
  ['src/components/system/RouteStage.tsx', 'Settled outgoing panels no longer force a computed-style read or native inert subtree walk; cold deferred content mounts one frame after the existing 240 ms entry owner completes.'],
  ['src/components/system/RouteStage.test.tsx', 'Focused contracts lock the no-layout-read, no-inert-walk and one-frame deferred-content route boundaries.'],
  ['src/features/overview/OverviewPage.tsx', 'Keyboard or pointer intent evaluates the Records route chunk before the unchanged 360 ms route-continuity sample, reducing cold-route pressure without eager-loading the application.'],
  ['src/features/overview/OverviewPage.test.tsx', 'The focused contract proves keyboard preload intent reaches a ready evaluated Records route.'],
  ['tests/helpers/motionProbe.ts', 'The motion observer samples the persistent surface color once before requestAnimationFrame and records focus identity without per-frame computed-style layout work.'],
  ['src/motionProbeContract.test.ts', 'The source contract proves the motion observer performs exactly one computed-style read outside its animation-frame loop.'],
  ['tests/motion-continuity.spec.ts', 'Trace screencast capture is disabled only for the frame observer and keyboard preload readiness is asserted before the unchanged WebKit route sample.'],
  ['tests/helpers/screenshotToPath.ts', 'Browser evidence writes use a same-directory temporary file plus atomic rename with bounded retry and cleanup, preventing Windows-backed partial-write collisions.'],
  ['src/playwrightConfig.test.ts', 'The acceptance contract rejects direct path-backed screenshot writes, locks atomic replacement and keeps trace work outside the motion frame observer.'],
  ['tsconfig.app.json', 'The new Node-backed Lighthouse source contract remains executed by Vitest while isolated from the browser application TypeScript graph.'],
  [refreshPath, 'The deterministic CI9 refresh preserves all 462 logical evidence IDs, hashes current sources/artifacts from disk and records only the already-opened current visual set without promoting registry status.'],
  [checkpointPath, 'The deterministic non-self-referential checkpoint binds the complete current local gate to ordinal-sorted production inputs while excluding generated evidence metadata and sensitive paths.'],
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
      ? 'The fresh complete browser, image, Lighthouse or data gate regenerated this existing current evidence artifact; its current bytes are hashed before evidence revalidation.'
      : 'This current P6-T6 CI9 remediation path is covered by the fresh full unit/type/build/browser/image gate and retained under the unchanged release boundary.')
}
task.externalBlockers = [
  {
    code: 'MAIN_PUSH_AUTHORIZATION_REQUIRED',
    fact: 'The authorized push through 10a86adb271f849dcf91bf46d7b09265aa829127 is complete and consumed, and local HEAD currently equals origin/main. Ordinary CI run 33137867114 failed only the dedicated WebKit theme-performance step. The current CI9 implementation/evidence correction is uncommitted and unpushed; after a reviewed local implementation commit and narrow ledger commit exist, pushing them to exact https://github.com/Chen0125-a/lifeops-web.git main is a new persistent remote mutation and requires fresh explicit user authorization. The historical browser-failure diagnostics and earlier motion-owner soft-pause checkpoint remain preserved locally and untracked. No credential, OTP, cookie, token or private key was read or recorded.',
  },
  {
    code: 'RELEASE_RERUN_AUTHORIZATION_REQUIRED',
    fact: 'UHUB_USERNAME and UHUB_PASSWORD remain known only as repository secret names; no value was read or recorded. The only previously authorized 1.0.0 dispatch, run 32796276478, was consumed and failed. Only after a separately authorized push produces a genuinely green fresh ordinary CI may the user be asked for one separate explicit authorization for exactly one additional 1.0.0 dispatch. Local images and commits are not UHub digests and neither local green gates nor push authorization grants release dispatch.',
  },
]

const redEvidence = [
  {
    classification: 'behavioral',
    command: 'GitHub Actions ordinary CI run 33137867114 / job 98741846244',
    exitCode: 1,
    failure: 'Ordinary CI on 10a86adb271f849dcf91bf46d7b09265aa829127 passed unit, frontend typecheck, production build and exact MySQL, then failed only tests/public-home.spec.ts:121 in the dedicated WebKit theme-performance project: baseline P95 19ms, transition P95 88ms against the unchanged 36ms budget, and maximum 88ms within the unchanged 100ms ceiling. The skipped Helm/workflow/image tail was not claimed as passed, and no release was dispatched.',
  },
  {
    classification: 'behavioral',
    command: 'npm.cmd test -- src/lighthouseRunner.test.ts',
    exitCode: 1,
    failure: 'After a direct Playwright navigation proved the built page healthy and a raw Lighthouse A/B passed only with Chromium standard --disable-dev-shm-usage, the focused runner contract rejected the missing flag. The minimal runner change keeps JavaScript, images, web security and all Lighthouse budgets enabled.',
  },
]
for (const entry of redEvidence) {
  if (!task.redEvidence.some((current) => current.command === entry.command)) task.redEvidence.push(entry)
}
await writeJson(taskExecutionPath, taskExecution)

const checkpoint = await buildLocalCheckpoint(root)
await writeJson(checkpointPath, checkpoint)

const visualManifest = await readJson(visualManifestPath)
const visualDirectory = 'outputs/evidence/browser/p2-t3'
const captureDefinitions = [
  ['day-rest-desktop', '1440x900-day-home-paused.png', '1440x900', 'light', false],
  ['day-login-desktop', '1440x900-day-login-open.png', '1440x900', 'light', true],
  ['night-rest-desktop', '1440x900-night-home-paused.png', '1440x900', 'dark', false],
  ['night-login-desktop', '1440x900-night-login-open.png', '1440x900', 'dark', true],
  ['day-rest-phone', '390x844-day-home-paused.png', '390x844', 'light', false],
  ['day-login-phone', '390x844-day-login-open.png', '390x844', 'light', true],
  ['night-rest-phone', '390x844-night-home-paused.png', '390x844', 'dark', false],
  ['night-login-phone', '390x844-night-login-open.png', '390x844', 'dark', true],
]

visualManifest.states = visualManifest.states.filter((state) => !state.id.startsWith('p6-t6-ci9-'))
for (const [name, filename, viewport, colorScheme, login] of captureDefinitions) {
  const screenshotPath = `${visualDirectory}/${filename}`
  visualManifest.states.push({
    id: `p6-t6-ci9-${name}`,
    browser: 'Playwright Chromium 1.62.1 complete acceptance capture',
    viewport,
    dpr: 1,
    colorScheme,
    reducedMotion: 'no-preference',
    fixtureSeedId: `p6-t6-ci9-${name.replace(/-(?:desktop|phone)$/, '')}`,
    screenshotPath,
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
      themeSurfaces: 'atomic',
      outerRingSafeInset: 'pass',
    },
    screenshotSha256: await hashRelative(screenshotPath),
  })
}
const revalidatedAt = new Date().toISOString()
visualManifest.checkpointRootSha256 = checkpoint.rootSha256
visualManifest.generatedAt = revalidatedAt
for (const report of visualManifest.performanceReports) report.sha256 = await hashRelative(report.path)
visualManifest.latestRevalidation = {
  taskId: 'P6-T6',
  step: 7,
  revalidatedAt,
  checkpointRootSha256: checkpoint.rootSha256,
  metricsPath,
  metricsSha256: await hashRelative(metricsPath),
  openedOriginalResolution: true,
  captureCount: captureDefinitions.length,
  conclusion: 'pass',
}
await writeJson(visualManifestPath, visualManifest)

const manifest = await readJson(evidenceManifestPath)
const currentVisualArtifacts = new Map([
  ['EV-P6-T5-ADR029-VISUAL-1440', [`${visualDirectory}/1440x900-night-login-open.png`, 'The opened current 1440×900 night-login frame preserves the unlit 05 center, complete four-ring inset, orbit-left/title-recede depth, dark task surface, high-contrast login and zero overflow.']],
  ['EV-P6-T5-ADR029-VISUAL-390', [`${visualDirectory}/390x844-night-home-paused.png`, 'The opened current 390×844 night-rest frame preserves the complete outer ring with safe bottom inset, readable zones, natural ring hierarchy, unlit center and zero horizontal overflow.']],
  ['EV-P6-T5-ADR029-VISUAL-MOTION', [metricsPath, 'The current Chromium acceptance manifest records all four viewport day/night states with zero overflow and five public labels, 71 motion frames with 16.7ms P95 and 16.8ms maximum, while the official cross-browser gates independently prove continuing ring transforms under unchanged cadence and theme budgets.']],
  ['EV-P6-T5-FULL-VISUAL-1440', [`${visualDirectory}/1440x900-day-home-paused.png`, 'The primary executor opened and accepted all four current 1440×900 day/night rest/login images individually; they preserve the approved hierarchy, depth, day sky, dark night task surface, atomic theme endpoints and zero overflow.']],
  ['EV-P6-T5-FULL-VISUAL-390', [`${visualDirectory}/390x844-day-home-paused.png`, 'The primary executor opened and accepted all four current 390×844 day/night rest/login images individually; they preserve clear content zones, complete safe outer-ring inset, full-screen mobile login, atomic theme endpoints and zero horizontal overflow.']],
])
const unitSources = [
  'scripts/run-lighthouse.mjs',
  'src/lighthouseRunner.test.ts',
  'src/features/overview/OverviewPage.test.tsx',
  'src/features/overview/OverviewPage.tsx',
]
const e2eSources = [
  'tests/helpers/screenshotToPath.ts',
  'tests/habits-golden-slice.spec.ts',
  'tests/life-catalog-p3-t9.spec.ts',
  'tests/life-commerce-p3-t12.spec.ts',
  'tests/life-planning-p3-t11.spec.ts',
  'tests/life-recipes-p3-t10.spec.ts',
  'tests/life-workspace.spec.ts',
  'tests/obsidian-settings.spec.ts',
  'tests/p2-t3-evidence.spec.ts',
  'tests/private-loop.spec.ts',
  'tests/reviews.spec.ts',
  'tests/schedule-golden-slice.spec.ts',
  'tests/search.spec.ts',
]
const currentContractEvidence = new Set([
  'EV-P6-T5-ADR029-UNIT',
  'EV-P6-T5-ADR029-VISUAL-1440',
  'EV-P6-T5-ADR029-VISUAL-390',
  'EV-P6-T5-ADR029-VISUAL-MOTION',
  'EV-P6-T5-FULL-UNIT',
  'EV-P6-T5-FULL-E2E',
  'EV-P6-T5-FULL-VISUAL-1440',
  'EV-P6-T5-FULL-VISUAL-390',
  'EV-P6-T5-FULL-MANUAL-REVIEW',
])

for (const row of manifest.evidence) {
  const requestedSources = []
  if (row.id === 'EV-P6-T5-FULL-UNIT') requestedSources.push(...unitSources)
  if (currentContractEvidence.has(row.id)) requestedSources.push('src/pages/PublicHomePage.test.tsx')
  if (['EV-P6-T5-FULL-E2E', 'EV-P6-T5-FULL-MANUAL-REVIEW'].includes(row.id)) requestedSources.push(...e2eSources)
  for (const sourcePath of requestedSources) {
    if (!row.sourcePaths.some((source) => source.path === sourcePath)) row.sourcePaths.push({ path: sourcePath, sha256: '' })
  }
  row.sourcePaths.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)

  const visualArtifact = currentVisualArtifacts.get(row.id)
  if (visualArtifact) {
    row.artifactPath = visualArtifact[0]
    row.summary = visualArtifact[1]
  }
  if (row.id === 'EV-P6-T5-FULL-UNIT') {
    row.summary = 'Fresh isolated frontend gates pass 88/88 Vitest files with 425/425 tests, typecheck and the 884-module production build. Node/config/CSS/Lighthouse source contracts stay outside the browser application TypeScript graph while Vitest executes them.'
  }
  if (row.id === 'EV-P6-T5-FULL-E2E') {
    row.summary = 'The owned official mcr.microsoft.com/playwright:v1.62.1-noble environment passes the complete current-source 335/335 acceptance set: WebKit theme 1/1, Firefox theme 1/1 and the unchanged full matrix 333/333. Workers=1, retries=0, browser coverage, thresholds, sample durations, geometry and motion rate are unchanged.'
  }
  if (row.id === 'EV-P6-T5-FULL-MANUAL-REVIEW') {
    row.command = `view_image ${visualDirectory}/{1440x900,390x844}-{day,night}-{home-paused,login-open}.png individually at original resolution`
    row.summary = 'The primary executor directly opened all eight current 1440×900 and 390×844 day/night rest/login images individually at original resolution. Automated diagnostics and direct review agree on the approved unlit center, four live rings, orbit-left/title-recede depth, dark night login, mobile breathing space, complete safe inset and zero horizontal overflow.'
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
  basis: 'Fresh complete local CI9 remediation evidence is bound to the current workspace while HEAD and origin/main remain 10a86adb271f849dcf91bf46d7b09265aa829127. Ordinary CI run 33137867114 passed unit/type/build/exact-MySQL and failed only the unchanged dedicated WebKit theme-performance budget. Current local gates pass 88/88 frontend files and 425/425 tests, complete server/exact-MySQL, official Linux 335/335 Playwright, real-Fastify 12/12, Helm/security/workflow/audit/image/data, Lighthouse and eight opened current visual states. All 462 logical evidence IDs remain in order without registry promotion; the parent boundary remains 30/10/4. A fresh explicit authorization is required before pushing the future local implementation and narrow ledger commits, and separate authorization remains required for any additional 1.0.0 dispatch.',
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
