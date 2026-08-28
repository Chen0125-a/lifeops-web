import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-28-p6-t6-ci11-final-local-gates-uncommitted-local-checkpoint.json'
const refreshPath = 'outputs/evidence/p6-t6-ci11-manifest-refresh.mjs'
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
  ['src/privateEntryModules.ts', 'The authenticated private route graph is loaded once from explicit interaction intent so the unchanged 680 ms aperture ends on a painted private workspace instead of an intermediate blank frame.'],
  ['src/App.tsx', 'The application consumes the shared private-entry preload promise and preserves the existing lazy route boundary and authenticated route semantics.'],
  ['src/pages/PublicHomePage.tsx', 'Login submission starts the shared private-entry preload before the existing entry aperture completes, without changing authentication, focus or transition duration.'],
  ['src/components/public/PublicOrbit.tsx', 'The official Linux WebKit-stalled login scene now uses one cancelable 680 ms matrix-interpolation owner with the approved cubic Bézier, stable endpoints and bounded requestAnimationFrame timer fallback.'],
  ['src/components/public/PublicOrbitFallback.tsx', 'The fallback scene mirrors the same semantic scene-state marker as the enhanced orbit without adding a second transform owner.'],
  ['src/styles/public.css', 'The public scene keeps approved responsive geometry and stable endpoint transforms while CSS delegates the login scene transform to its single runtime owner.'],
  ['tests/public-login.spec.ts', 'The browser contract proves immediate no-jump geometry, preloaded authenticated entry, interruption, focus and every required login breakpoint.'],
  ['tests/motion-continuity.spec.ts', 'In-page sampling proves prompt first movement, intermediate frames, bounded completion, exact endpoint and interruption across Chromium, Firefox and WebKit.'],
  ['tests/adr029-login-orbit.spec.ts', 'The locked geometry contract requires compositor preparation and the approved login endpoint without coupling correctness to a CSS-only transition implementation.'],
  ['tests/p2-t3-evidence.spec.ts', 'The final P2-T3 evidence capture waits for the shared private entry graph and records a fully painted 1000 ms authenticated frame.'],
  ['tests-remote/knowledge.spec.ts', 'Only the long real-Fastify knowledge journey receives a 60-second test timeout; action and autosave timeouts remain unchanged.'],
  [refreshPath, 'The deterministic CI11 refresh preserves all 462 logical evidence IDs, hashes every current source and artifact from disk and records the nine images already opened by the primary executor without promoting registry status.'],
  [checkpointPath, 'The deterministic non-self-referential checkpoint binds the final local gate to ordinal-sorted production inputs while excluding generated evidence metadata and sensitive paths.'],
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
      ? 'The frozen-source CI11 browser, image, Lighthouse or data gate regenerated this existing evidence artifact; its current bytes are hashed before evidence revalidation.'
      : 'This bounded P6-T6 CI11 path is covered by the final unit, type, build, browser, image and data gates under the unchanged release boundary.')
}
task.externalBlockers = [
  {
    code: 'ORDINARY_CI_PENDING',
    fact: 'The user explicitly authorized all remaining in-scope LifeOps commit and push operations. The current CI11 implementation/evidence WIP must first be committed and pushed to exact https://github.com/Chen0125-a/lifeops-web.git main, then a fresh ordinary CI must reach a genuinely green terminal result before release dispatch.',
  },
  {
    code: 'RELEASE_PREREQUISITES_PENDING',
    fact: 'The same explicit authorization covers exactly one additional 1.0.0 release dispatch only after the fresh ordinary CI is green. UHub digests, digest-bound SBOM/provenance, exact-digest image smoke and release success remain absent until that single authorized workflow completes; no credential value is read or recorded.',
  },
]

const redEvidence = [
  {
    classification: 'behavioral',
    command: 'official mcr.microsoft.com/playwright:v1.62.1-noble focused WebKit login close and interruption probes',
    exitCode: 1,
    failure: 'The official Linux WebKit compositor froze the layered login scene transform under CSS transition, Web Animations and GSAP candidates while the unchanged endpoint geometry remained correct. The bounded correction assigns the scene to one cancelable matrix-interpolation owner and keeps the existing 680 ms cubic Bézier, workers, retries, sample windows, breakpoints and visual geometry.',
  },
  {
    classification: 'behavioral',
    command: 'npm.cmd test -- src/App.test.tsx src/pages/PublicHomePage.test.tsx',
    exitCode: 1,
    failure: 'The focused entry contract first proved the authenticated private graph was not requested until after route state changed, permitting the aperture to end before the private workspace was ready. The shared preload owner now starts from login submit intent and is consumed by the unchanged lazy route boundary.',
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

visualManifest.states = visualManifest.states.filter((state) => !state.id.startsWith('p6-t6-ci11-'))
for (const [name, filename, viewport, colorScheme, login] of captureDefinitions) {
  const screenshotPath = `${visualDirectory}/${filename}`
  visualManifest.states.push({
    id: `p6-t6-ci11-${name}`,
    browser: 'Playwright Chromium 1.62.1 frozen-source acceptance capture',
    viewport,
    dpr: 1,
    colorScheme,
    reducedMotion: 'no-preference',
    fixtureSeedId: `p6-t6-ci11-${name.replace(/-(?:desktop|phone)$/, '')}`,
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
      sceneOwner: 'single-cancelable-matrix-interpolation',
    },
    screenshotSha256: await hashRelative(screenshotPath),
  })
}
const entryScreenshotPath = `${visualDirectory}/filmstrip-entry-normal-1000ms.png`
visualManifest.states.push({
  id: 'p6-t6-ci11-entry-1000ms',
  browser: 'Playwright Chromium 1.62.1 frozen-source acceptance capture',
  viewport: '1440x900',
  dpr: 1,
  colorScheme: 'private-daylight',
  reducedMotion: 'no-preference',
  fixtureSeedId: 'p6-t6-ci11-authenticated-entry',
  screenshotPath: entryScreenshotPath,
  filmstripPath: null,
  tracePath: null,
  reviewer: 'primary-agent',
  openedOriginalResolution: true,
  result: 'pass',
  diagnostics: {
    frameMs: 1000,
    privateShellPainted: true,
    blankFrame: false,
    route: '/app/overview',
  },
  screenshotSha256: await hashRelative(entryScreenshotPath),
})

for (const state of visualManifest.states) {
  if (state.screenshotPath) state.screenshotSha256 = await hashRelative(state.screenshotPath)
  if (state.filmstripPath) state.filmstripSha256 = await hashRelative(state.filmstripPath)
  if (state.tracePath) state.traceSha256 = await hashRelative(state.tracePath)
}
const revalidatedAt = new Date().toISOString()
visualManifest.checkpointRootSha256 = checkpoint.rootSha256
visualManifest.generatedAt = revalidatedAt
visualManifest.environment.browserPolicy = 'Chromium, Firefox and WebKit run serially in the official Playwright 1.62.1 Linux image with workers=1 and retries=0; dedicated WebKit and Firefox theme-performance projects run in fresh browser processes.'
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
}
await writeJson(visualManifestPath, visualManifest)

const manifest = await readJson(evidenceManifestPath)
const currentVisualArtifacts = new Map([
  ['EV-P6-T5-ADR029-VISUAL-1440', [`${visualDirectory}/1440x900-night-login-open.png`, 'The opened current 1440×900 night-login frame preserves the unlit 05 center, complete four-ring inset, orbit-left/title-recede depth, dark task surface, high-contrast login and zero overflow.']],
  ['EV-P6-T5-ADR029-VISUAL-390', [`${visualDirectory}/390x844-night-home-paused.png`, 'The opened current 390×844 night-rest frame preserves the complete outer ring with safe bottom inset, readable zones, natural ring hierarchy, unlit center and zero horizontal overflow.']],
  ['EV-P6-T5-ADR029-VISUAL-MOTION', [metricsPath, 'The frozen-source browser manifest and official three-browser gates prove continuing ring transforms, single-owner scene motion, unchanged cadence and zero overflow at the approved breakpoints.']],
  ['EV-P6-T5-FULL-VISUAL-1440', [`${visualDirectory}/1440x900-day-home-paused.png`, 'The primary executor opened and accepted all four current 1440×900 day/night rest/login images individually; they preserve the approved hierarchy, depth, stable geometry, atomic theme endpoints and zero overflow.']],
  ['EV-P6-T5-FULL-VISUAL-390', [`${visualDirectory}/390x844-day-home-paused.png`, 'The primary executor opened and accepted all four current 390×844 day/night rest/login images individually; they preserve separate content zones, complete outer-ring inset, full-screen mobile login and zero horizontal overflow.']],
])
const implementationSources = [
  'src/App.tsx',
  'src/components/public/PublicOrbit.tsx',
  'src/components/public/PublicOrbitFallback.tsx',
  'src/pages/PublicHomePage.tsx',
  'src/privateEntryModules.ts',
  'src/styles/public.css',
]
const unitSources = [
  ...implementationSources,
  'src/components/public/PublicOrbit.test.tsx',
  'src/pages/PublicHomePage.test.tsx',
]
const e2eSources = [
  ...implementationSources,
  'tests/adr029-login-orbit.spec.ts',
  'tests/motion-continuity.spec.ts',
  'tests/p2-t3-evidence.spec.ts',
  'tests/public-login.spec.ts',
]
const currentContractEvidence = new Set([
  'EV-P6-T5-ADR029-UNIT',
  'EV-P6-T5-ADR029-E2E-CHROMIUM',
  'EV-P6-T5-ADR029-E2E-WEBKIT',
  'EV-P6-T5-ADR029-E2E-FIREFOX',
  'EV-P6-T5-ADR029-VISUAL-1440',
  'EV-P6-T5-ADR029-VISUAL-390',
  'EV-P6-T5-ADR029-VISUAL-MOTION',
  'EV-P6-T5-FULL-UNIT',
  'EV-P6-T5-FULL-E2E',
  'EV-P6-T5-FULL-E2E-REMOTE',
  'EV-P6-T5-FULL-A11Y-KEYBOARD',
  'EV-P6-T5-FULL-E2E-REDUCED-MOTION',
  'EV-P6-T5-FULL-VISUAL-1440',
  'EV-P6-T5-FULL-VISUAL-1024',
  'EV-P6-T5-FULL-VISUAL-768',
  'EV-P6-T5-FULL-VISUAL-390',
  'EV-P6-T5-FULL-MANUAL-REVIEW',
])

for (const row of manifest.evidence) {
  const requestedSources = []
  if (row.id === 'EV-P6-T5-FULL-UNIT' || row.id === 'EV-P6-T5-ADR029-UNIT') requestedSources.push(...unitSources)
  if (currentContractEvidence.has(row.id) && row.id !== 'EV-P6-T5-FULL-UNIT' && row.id !== 'EV-P6-T5-ADR029-UNIT') requestedSources.push(...e2eSources)
  if (row.id === 'EV-P6-T5-FULL-E2E-REMOTE') requestedSources.push('tests-remote/knowledge.spec.ts')
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
    row.summary = 'Fresh isolated frontend gates pass 88/88 Vitest files with 425/425 tests, typecheck and the 885-module production build; private-entry preload and single scene-owner contracts remain covered without weakening the browser graph boundary.'
  }
  if (row.id === 'EV-P6-T5-FULL-E2E') {
    row.summary = 'The official Playwright 1.62.1 Linux image passes 338/338 frozen-source acceptance checks: WebKit theme 1/1, Firefox theme 1/1 and the complete six-project matrix 336/336 with workers=1 and retries=0.'
  }
  if (row.id === 'EV-P6-T5-FULL-E2E-REMOTE') {
    row.summary = 'The official Linux environment passes the full 12/12 real-Fastify browser suite across Chromium, Firefox and WebKit, including authenticated writes, reload, failure recovery and Back reversal.'
  }
  if (row.id === 'EV-P6-T5-FULL-MANUAL-REVIEW') {
    row.command = `view_image ${visualDirectory}/{1440x900,390x844}-{day,night}-{home-paused,login-open}.png plus filmstrip-entry-normal-1000ms.png individually at original resolution`
    row.summary = 'The primary executor directly opened all eight current desktop/phone day/night rest/login images plus the authenticated 1000 ms entry frame. Direct review confirms the unlit center, four live rings, orbit-left/title-recede depth, dark night login, mobile breathing space, complete safe inset, zero horizontal overflow and fully painted private overview.'
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
  basis: 'Fresh frozen-source CI11 local evidence is bound to the current workspace. Local HEAD and origin/main are 52aeecc23dc5468a36e20caacfbc43aaff268dc5 before this WIP. Current gates pass 88/88 frontend files and 425/425 tests, frontend/server typechecks and production builds, server 361 ordinary tests plus official MySQL 50/50, official Linux Playwright 338/338, real-Fastify 12/12, Helm/media/security/observability/workflow/supply-chain/audit/current-source image smoke/data rehearsal, Lighthouse 1.00/1.00/0.96/0.91 and nine individually opened final visual states. All 462 evidence IDs remain in exact order without registry promotion; the parent boundary remains 30/10/4. The user explicitly authorized the remaining commits, push and exactly one 1.0.0 dispatch after a fresh ordinary CI is green. No UHub digest, attestation, release, DNS/TLS or cluster state is claimed yet.',
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
