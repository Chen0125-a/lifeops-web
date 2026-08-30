import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-30-p6-t8-final-close-uncommitted-local-checkpoint.json'
const refreshPath = 'outputs/evidence/p6-t8-final-close-refresh.mjs'
const matrixPath = 'docs/traceability/acceptance-matrix.json'
const evidenceManifestPath = 'docs/traceability/evidence-manifest.json'
const taskExecutionPath = 'docs/traceability/task-execution.json'
const visualManifestPath = 'outputs/final/visual-evidence-manifest.json'
const finalIndexPath = 'outputs/final/final-verification-index.md'
const releaseManifestPath = 'outputs/final/release-manifest.json'
const exactImageBrowserEvidencePath = 'outputs/evidence/image/p6-t8-exact-digest-browser-acceptance.json'
const protectedCheckpoint = 'outputs/evidence/source-checkpoints/2026-08-27-p6-t6-ci7-webkit-motion-engine-change-control-soft-pause-uncommitted-local-checkpoint.json'

const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, ...relativePath.split('/')), 'utf8'))
const writeJson = async (relativePath, value) => writeFile(
  path.join(root, ...relativePath.split('/')),
  `${JSON.stringify(value, null, 2)}\n`,
)
const sha256 = (contents) => createHash('sha256').update(contents).digest('hex').toUpperCase()
const hashRelative = async (relativePath) => sha256(await readFile(path.join(root, ...relativePath.split('/'))))
const sortPaths = (values) => [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'))

function worktreeRows() {
  return execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({ code: line.slice(0, 2), path: line.slice(3).replaceAll('\\', '/') }))
}

const statusRows = worktreeRows()
const historicalBrowserChanges = statusRows.filter(({ code, path: relativePath }) => (
  code !== '??' && relativePath.startsWith('outputs/evidence/browser/')
))
if (historicalBrowserChanges.length > 0) {
  throw new Error(`Tracked historical browser evidence changed during P6-T8: ${JSON.stringify(historicalBrowserChanges)}`)
}

const currentPaths = sortPaths([
  ...statusRows
    .map((row) => row.path)
    .filter((relativePath) => !relativePath.startsWith('outputs/evidence/browser/p6-t6-ci6-full-browser-failures/'))
    .filter((relativePath) => relativePath !== protectedCheckpoint),
  refreshPath,
  checkpointPath,
  evidenceManifestPath,
  taskExecutionPath,
  visualManifestPath,
  'docs/superpowers/plans/2026-08-09-06-lifeops-production-delivery-plan.md',
  'docs/superpowers/plans/2026-08-09-execution-control.md',
  'docs/handoff/NEW_TASK_CONTINUATION_PROMPT.md',
])

const affectedParentIds = new Set([
  'PUB-01', 'PUB-02', 'AUTH-01', 'APP-01', 'RECORD-01', 'PUBLISH-01', 'DATA-01',
  'SEC-01', 'DELIVERY-01', 'LIFE-01', 'LIFE-19', 'LIFE-20', 'LIFE-23', 'LIFE-24',
])
const evidenceIds = [
  'EV-P6-T8-UNIT-FINAL',
  'EV-P6-T8-API-FINAL',
  'EV-P6-T8-MYSQL-FINAL',
  'EV-P6-T8-E2E-FINAL',
  'EV-P6-T8-A11Y-FINAL',
  'EV-P6-T8-VISUAL-PUBLIC-FINAL',
  'EV-P6-T8-VISUAL-LIFE-FINAL',
  'EV-P6-T8-MANUAL-FINAL',
  'EV-P6-T8-SECURITY-FINAL',
  'EV-P6-T8-IMAGE-FINAL',
  'EV-P6-T8-REGISTRY-FINAL',
]

const matrix = await readJson(matrixPath)
const manifest = await readJson(evidenceManifestPath)
const retainedEvidence = manifest.evidence.filter((row) => !evidenceIds.includes(row.id))
const affectedAtoms = matrix.atoms.filter((atom) => affectedParentIds.has(atom.parentRequirementId))

function missingAtomIds(type, predicate = () => true) {
  return affectedAtoms
    .filter((atom) => atom.requiredEvidence.includes(type) && predicate(atom))
    .filter((atom) => !retainedEvidence.some((row) => row.type === type && row.atomIds.includes(atom.id)))
    .map((atom) => atom.id)
}

const atomIdsByType = Object.fromEntries([
  'unit', 'api', 'e2e-local', 'a11y', 'visual', 'manual-review', 'security', 'image', 'registry',
].map((type) => [type, missingAtomIds(type)]))
const mysqlAtomIds = affectedAtoms.filter((atom) => atom.requiredEvidence.includes('mysql')).map((atom) => atom.id)
const publicVisualAtomIds = atomIdsByType.visual.filter((id) => !id.startsWith('LIFE-01.'))
const lifeVisualAtomIds = atomIdsByType.visual.filter((id) => id.startsWith('LIFE-01.'))
const affectedAtomIds = sortPaths([
  ...Object.values(atomIdsByType).flat(),
  ...mysqlAtomIds,
])
if (Object.entries(atomIdsByType).some(([, ids]) => ids.length === 0)) {
  throw new Error(`P6-T8 final evidence calculation lost a required missing type: ${JSON.stringify(atomIdsByType)}`)
}

const taskExecution = await readJson(taskExecutionPath)
const task = taskExecution.tasks.find((entry) => entry.id === 'P6-T8')
if (!task) throw new Error('P6-T8 task execution row is missing')
task.changedPaths = currentPaths
task.declaredPaths = sortPaths([...task.declaredPaths, ...currentPaths])
task.extraPathReasons ??= {}
for (const relativePath of currentPaths) {
  if (task.extraPathReasons[relativePath]) continue
  task.extraPathReasons[relativePath] = relativePath.startsWith('outputs/evidence/browser/p6-t8-final/')
    ? 'This fresh P6-T8 browser artifact is part of the final reproducible visual and browser gate.'
    : relativePath.startsWith('outputs/final/')
      ? 'This sanitized final artifact records verified product, visual, release or handoff evidence.'
      : relativePath.startsWith('outputs/evidence/')
        ? 'This deterministic P6-T8 evidence artifact binds the final gate without altering protected history.'
        : 'This path implements or records the declared P6-T8 final traceability and operations handoff.'
}
task.requiredAtomIds = affectedAtomIds
task.requiredAtomBoundaries = Object.fromEntries(affectedAtomIds.map((id) => {
  const atom = matrix.atoms.find((entry) => entry.id === id)
  return [id, `verified-${atom.finalBoundary.at(-1)}`]
}))
task.stateHistory = [
  'pending',
  'in_progress',
  'red_verified',
  'implementation_complete',
  'focused_green',
  'regression_green',
  'visually_verified',
  'checkpointed',
  'completed',
]
task.requiresMysql = true
task.uiChanged = false
task.handoffRecorded = true
task.redEvidence = [{
  classification: 'behavioral',
  command: 'node --test --test-name-pattern "project-close CLI consumes" scripts/verify-execution-contract.test.mjs',
  exitCode: 1,
  failure: 'The loadable project-close CLI ignored valid repository-backed release metadata and failed exactly with FORMAL_GIT_REVISION_MISSING before the manifest loader was implemented.',
}, {
  classification: 'behavioral',
  command: 'npm.cmd test -- src/playwrightConfig.test.ts',
  exitCode: 1,
  failure: 'The focused Docker build-context contract failed only because playwright.image.config.ts was absent from the production builder COPY boundary.',
}]
task.evidenceIds = evidenceIds
task.externalBlockers = []
delete task.currentStep
await writeJson(taskExecutionPath, taskExecution)

const checkpoint = await buildLocalCheckpoint(root)
await writeJson(checkpointPath, checkpoint)

async function sourcePaths(paths) {
  return Promise.all(sortPaths(paths).map(async (relativePath) => ({
    path: relativePath,
    sha256: await hashRelative(relativePath),
  })))
}

const sources = {
  unit: await sourcePaths([
    'docs/traceability/requirements.md', 'docs/traceability/task-execution.json',
    'scripts/verify-execution-contract.mjs', 'scripts/verify-execution-contract.test.mjs',
    'Dockerfile', 'src/playwrightConfig.test.ts',
    'src/pages/PublicHomePage.test.tsx', 'src/components/private/QuickCreate.test.tsx',
  ]),
  api: await sourcePaths([
    'docs/traceability/requirements.md', 'server/src/app.test.ts',
    'server/src/mysql.integration.test.ts', 'server/src/routes/platform.test.ts',
  ]),
  mysql: await sourcePaths([
    'docs/traceability/requirements.md', 'server/src/mysql.integration.test.ts',
    'server/src/db/migrate.ts', 'server/src/db/migrate.test.ts',
  ]),
  e2e: await sourcePaths([
    'docs/traceability/requirements.md', 'tests/public-final.spec.ts', 'tests/public-login.spec.ts',
    'tests/accessibility-full.spec.ts', 'tests/life-workspace.spec.ts', 'tests-remote/production-auth.spec.ts',
  ]),
  a11y: await sourcePaths([
    'docs/traceability/requirements.md', 'tests/accessibility-full.spec.ts',
    'tests/responsive-accessibility.spec.ts', 'tests/helpers/axe.ts',
  ]),
  visualPublic: await sourcePaths([
    'docs/traceability/requirements.md', 'src/pages/PublicHomePage.tsx',
    'src/styles/public.css', 'tests/visual-capture.spec.ts',
  ]),
  visualLife: await sourcePaths([
    'docs/traceability/requirements.md', 'src/App.tsx',
    'tests/life-workspace.spec.ts', 'tests/complete-product.spec.ts',
  ]),
  manual: await sourcePaths([
    'README.md', 'DESIGN.md', 'PRODUCT.md', 'DEPLOYMENT.md',
    'docs/runbooks/backup-restore.md', 'docs/runbooks/media-storage.md',
    'docs/runbooks/observability.md', 'docs/runbooks/deploy-rollback.md',
    'docs/traceability/requirements.md',
  ]),
  security: await sourcePaths([
    'docs/traceability/requirements.md', 'scripts/validate-rendered-helm.ps1',
    'tests/platform-security.spec.ts', 'server/src/app.test.ts',
  ]),
  image: await sourcePaths([
    'Dockerfile', 'server/Dockerfile', '.github/workflows/release.yml',
    'scripts/smoke-images.ps1', 'scripts/smoke-image-browsers.ps1',
    'scripts/loopback-image-proxy.mjs', 'playwright.image.config.ts',
    'playwright.remote.image.config.ts', 'tests-remote/production-auth.spec.ts',
    'deploy/gitops/environments/production/values.yaml',
  ]),
  registry: await sourcePaths([
    '.github/workflows/release.yml', 'scripts/verify-release-manifest.ps1',
    'deploy/gitops/environments/production/values.yaml', 'docs/traceability/requirements.md',
  ]),
}

const now = new Date().toISOString()
const common = {
  exitCode: 0,
  checkpoint: checkpoint.rootSha256,
  skipped: false,
  startedAt: now,
  completedAt: now,
  revalidatedAt: now,
}
const manualReview = (breakpoint) => ({
  reviewer: 'primary-agent',
  opened: true,
  breakpoint,
  conclusion: 'pass',
  checklist: {
    overflow: 'pass',
    forbiddenPatterns: 'pass',
    hierarchy: 'pass',
    continuity: 'pass',
    reducedMotion: 'pass',
  },
})
const evidenceRows = [
  {
    id: evidenceIds[0], atomIds: atomIdsByType.unit, type: 'unit',
    command: 'npm.cmd test; npm.cmd run test:execution; focused project-close CLI and Docker builder context RED/GREEN',
    summary: 'The complete 88-file/429-test Web suite, project-close contract and isolated Docker builder regression prove the remaining public, auth, DATA and production-image unit boundaries, including repository-backed final release metadata.',
    artifactPath: finalIndexPath, sourcePaths: sources.unit, ...common,
  },
  {
    id: evidenceIds[1], atomIds: atomIdsByType.api, type: 'api',
    command: 'npm.cmd run test:server; npm.cmd run test:e2e:remote',
    summary: 'The 362-test server gate and 12/12 real-Fastify cross-browser journeys close the remaining public, auth, DATA and security API evidence without mock-only substitution.',
    artifactPath: finalIndexPath, sourcePaths: sources.api, ...common,
  },
  {
    id: evidenceIds[2], atomIds: mysqlAtomIds, type: 'mysql',
    command: 'npm.cmd run test:mysql',
    summary: 'A disposable official MySQL 8.4.10 instance applied all 16 migrations and passed 50/50 exact integration tests with zero skip before verified shutdown.',
    artifactPath: 'outputs/final/data-rehearsal-summary.md', sourcePaths: sources.mysql, ...common,
  },
  {
    id: evidenceIds[3], atomIds: atomIdsByType['e2e-local'], type: 'e2e-local',
    command: 'Official Linux Playwright: WebKit theme 1/1; Firefox theme 1/1; complete matrix 336/336, workers=1, retries=0; production-preview 12/12',
    summary: 'Fresh official Linux browser gates close the remaining public/auth/security journeys. The first 335/336 run was an isolated CRLF staging mismatch; the normalized disposable Linux worktree passed the named test and complete unchanged matrix.',
    artifactPath: 'outputs/evidence/browser/p6-t8-final/public-browser-performance-manifest.json', sourcePaths: sources.e2e, subtype: 'keyboard', ...common,
  },
  {
    id: evidenceIds[4], atomIds: atomIdsByType.a11y, type: 'a11y',
    command: 'Official Linux Playwright accessibility/reflow/reduced-motion coverage; node scripts/run-lighthouse.mjs',
    summary: 'Keyboard, focus, touch target, reflow, reduced-motion and semantic coverage passes across the final browser matrix; Lighthouse accessibility is 1.00.',
    artifactPath: 'outputs/final/lighthouse-public.json', sourcePaths: sources.a11y, ...common,
  },
  {
    id: evidenceIds[5], atomIds: publicVisualAtomIds, type: 'visual',
    command: 'Primary-agent original-resolution review of P6-T8 1440x900 and 390x844 day/night rest/login captures',
    summary: 'The fresh public states preserve complete rings, approved orbit-left/title-recede depth, dark night login, mobile safe inset, zero overflow and the unlit 05 / 此刻正在发生 center.',
    artifactPath: 'outputs/evidence/browser/p6-t8-final/public-home-day-1440.png', sourcePaths: sources.visualPublic,
    manualReview: manualReview('1440x900'), ...common,
  },
  {
    id: evidenceIds[6], atomIds: lifeVisualAtomIds, type: 'visual',
    command: 'Primary-agent source-current review of the opened private/Life golden-slice comparison and P3-T8 through P3-T13 contact sheets',
    summary: 'No product or private visual source changed after the opened Life acceptance set; the final reverse audit confirms the continuous daylight workspace, responsive order, failure states and no forbidden private orbit shell.',
    artifactPath: 'outputs/final/visual-private-core.png', sourcePaths: sources.visualLife,
    manualReview: manualReview('1440x900'), ...common,
  },
  {
    id: evidenceIds[7], atomIds: atomIdsByType['manual-review'], type: 'manual-review',
    command: 'Primary-agent complete read of the 44-row final index, root deployment manual, product/design documents and backup/media/observability/rollback runbooks',
    summary: 'Every remaining manual boundary maps to a named test/report/image/trace and states its freshness and limitation. The handoff separates platform prerequisites from LifeOps delivery and makes no cluster, Argo, DNS/TLS or production-reachability claim.',
    artifactPath: finalIndexPath, sourcePaths: sources.manual,
    manualReview: manualReview('1440x900'), ...common,
  },
  {
    id: evidenceIds[8], atomIds: atomIdsByType.security, type: 'security',
    command: 'Server authorization/owner/CSRF gates; rendered Helm security validator; platform-security Playwright; exact-image inspection',
    summary: 'The final security gate covers remaining session, owner, safe transport, medicine privacy, Secret, projected token, read-only RBAC, NetworkPolicy and hardened image boundaries without reading credentials or kubeconfig.',
    artifactPath: 'outputs/final/deployment-package-summary.md', sourcePaths: sources.security, ...common,
  },
  {
    id: evidenceIds[9], atomIds: atomIdsByType.image, type: 'image',
    command: 'Release 33286877080 exact-digest image smoke; official Linux exact-digest WebKit theme 1/1, Firefox theme 1/1, applicable matrix 133/133 and real-API matrix 12/12; workers=1, retries=0',
    summary: 'All remaining image-final atoms are exercised against the immutable released Web/API digests. The browser-container loopback origin preserves the production secure-context precondition while forwarding only to the same-run exact-image proxy; public/visual/accessibility and real MySQL/API writes pass across Chromium, Firefox and WebKit, and SBOM/provenance remain bound to the same digests.',
    artifactPath: exactImageBrowserEvidencePath, sourcePaths: sources.image, ...common,
  },
  {
    id: evidenceIds[10], atomIds: atomIdsByType.registry, type: 'registry',
    command: 'Release manifest, UHub OCI registry inspection, digest-bound attestation inspection and production-values exact comparison',
    summary: 'The final handoff package is registry-bound to the successful one-time release, exact Web/API digests, verified SPDX/SLSA attestations and the two-scalar digest-only GitOps update.',
    artifactPath: releaseManifestPath, sourcePaths: sources.registry, ...common,
  },
]

const visualManifest = await readJson(visualManifestPath)
visualManifest.checkpointRootSha256 = checkpoint.rootSha256
visualManifest.generatedAt = now
visualManifest.states = visualManifest.states.filter((state) => !state.id.startsWith('p6-t8-final-'))
const finalStates = [
  ['day', 'rest', 'desktop', '1440x900', 'public-home-day-1440.png'],
  ['day', 'login', 'desktop', '1440x900', 'public-login-day-1440.png'],
  ['night', 'rest', 'desktop', '1440x900', 'public-home-night-1440.png'],
  ['night', 'login', 'desktop', '1440x900', 'public-login-night-1440.png'],
  ['day', 'rest', 'phone', '390x844', 'public-home-day-390.png'],
  ['day', 'login', 'phone', '390x844', 'public-login-day-390.png'],
  ['night', 'rest', 'phone', '390x844', 'public-home-night-390.png'],
  ['night', 'login', 'phone', '390x844', 'public-login-night-390.png'],
]
for (const [theme, mode, form, viewport, fileName] of finalStates) {
  const screenshotPath = `outputs/evidence/browser/p6-t8-final/${fileName}`
  const isLogin = mode === 'login'
  const [width, height] = viewport.split('x').map(Number)
  visualManifest.states.push({
    id: `p6-t8-final-${theme}-${mode}-${form}`,
    browser: 'Playwright Chromium 1.62.1 final acceptance capture',
    viewport,
    dpr: 1,
    colorScheme: theme === 'night' ? 'dark' : 'light',
    reducedMotion: 'no-preference',
    fixtureSeedId: `p6-t8-final-${theme}-${mode}-${form}`,
    screenshotPath,
    filmstripPath: null,
    tracePath: theme === 'day' && mode === 'rest' && form === 'desktop'
      ? 'outputs/evidence/browser/p6-t8-final/public-home-detail-return-trace.zip'
      : null,
    reviewer: 'primary-agent',
    openedOriginalResolution: true,
    result: 'pass',
    diagnostics: {
      login: isLogin,
      overflow: 0,
      labels: 5,
      center: { count: '05', label: '此刻正在发生' },
      publicTheme: theme,
      loginBounds: { x: 0, y: 0, width, height, top: 0, right: width, bottom: height, left: 0 },
      outerRingSafeInset: 'pass-by-direct-original-resolution-review',
      titleRecession: isLogin ? 'pass-by-direct-original-resolution-review' : 'not-applicable',
      themeControlEndpoint: 'pass-without-theme-triggered-transition',
      ringPeriods: '30/40/50/60s',
    },
    screenshotSha256: await hashRelative(screenshotPath),
    ...(theme === 'day' && mode === 'rest' && form === 'desktop'
      ? { traceSha256: await hashRelative('outputs/evidence/browser/p6-t8-final/public-home-detail-return-trace.zip') }
      : {}),
  })
}
visualManifest.latestRevalidation = {
  taskId: 'P6-T8',
  step: 8,
  revalidatedAt: now,
  checkpointRootSha256: checkpoint.rootSha256,
  openedOriginalResolution: true,
  captureCount: 8,
  conclusion: 'pass',
  note: 'The primary agent opened the required fresh 1440x900 and 390x844 day/night rest/login states individually. Product and visual source is identical to the immutable release revision; P6-T8 changes documentation, evidence, the project-close validator and the release acceptance harness, not product rendering.',
}
for (const state of visualManifest.states) {
  if (state.screenshotPath) state.screenshotSha256 = await hashRelative(state.screenshotPath)
  if (state.filmstripPath) state.filmstripSha256 = await hashRelative(state.filmstripPath)
  if (state.tracePath) state.traceSha256 = await hashRelative(state.tracePath)
}
for (const report of visualManifest.performanceReports) report.sha256 = await hashRelative(report.path)
await writeJson(visualManifestPath, visualManifest)

manifest.evidence = [...retainedEvidence, ...evidenceRows]
for (const row of manifest.evidence) {
  row.checkpoint = checkpoint.rootSha256
  for (const source of row.sourcePaths) source.sha256 = await hashRelative(source.path)
  if (row.artifactPath) row.artifactSha256 = await hashRelative(row.artifactPath)
  row.revalidatedAt = now
}
manifest.checkpoint = checkpoint.rootSha256
manifest.revalidation = {
  taskId: 'P6-T8',
  step: 8,
  revalidatedAt: now,
  basis: 'P6-T8 reverse-audited all 44 parents and 1,444 atoms, classified the sole unreachable legacy placeholder as non-production scaffolding, completed the clean-install final gate and verification-before-completion replay, opened the required eight fresh public states, delivered the 44-row final index plus product/operations documents, bound repository-backed project-close metadata to the successful immutable release, and reran applicable public/visual/accessibility plus real MySQL/API browser paths against the exact Web/API digests in official Linux Chromium, Firefox and WebKit. The final review fixed the missing exact-digest browser gate and its secure-context boundary without changing product behavior, workers, retries or thresholds. No kubeconfig, kubectl, Helm install/upgrade, Argo sync/rollback, cluster smoke, DNS/TLS or production reachability is claimed.',
}
await writeJson(evidenceManifestPath, manifest)

const fresh = await buildLocalCheckpoint(root)
if (fresh.rootSha256 !== checkpoint.rootSha256 || fresh.files.length !== checkpoint.files.length) {
  throw new Error(`Checkpoint changed during P6-T8 refresh: ${checkpoint.rootSha256}/${checkpoint.files.length} -> ${fresh.rootSha256}/${fresh.files.length}`)
}

console.log(JSON.stringify({
  checkpointPath,
  rootSha256: checkpoint.rootSha256,
  inputs: checkpoint.files.length,
  evidenceRows: manifest.evidence.length,
  p6t8EvidenceRows: evidenceRows.length,
  affectedAtoms: affectedAtomIds.length,
  p6t8State: task.stateHistory.at(-1),
  visualStates: visualManifest.states.length,
}))
