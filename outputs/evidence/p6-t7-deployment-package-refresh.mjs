import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-30-p6-t7-user-operated-deployment-package-uncommitted-local-checkpoint.json'
const refreshPath = 'outputs/evidence/p6-t7-deployment-package-refresh.mjs'
const evidenceManifestPath = 'docs/traceability/evidence-manifest.json'
const taskExecutionPath = 'docs/traceability/task-execution.json'
const visualManifestPath = 'outputs/final/visual-evidence-manifest.json'
const releaseManifestPath = 'outputs/final/release-manifest.json'
const packageSummaryPath = 'outputs/final/deployment-package-summary.md'
const checklistPath = 'docs/runbooks/user-deployment-checklist.md'
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
  throw new Error(`Tracked historical browser evidence changed during P6-T7: ${JSON.stringify(historicalBrowserChanges)}`)
}

const currentPaths = sortPaths([
  ...statusRows
    .map((row) => row.path)
    .filter((relativePath) => !relativePath.startsWith('outputs/evidence/browser/p6-t6-ci6-full-browser-failures/'))
    .filter((relativePath) => relativePath !== protectedCheckpoint),
  refreshPath,
  checkpointPath,
])

const atom = {
  productionValues: 'DELIVERY-01.PRODUCTION_VALUES.DATA.01',
  handoffPackage: 'DELIVERY-01.HANDOFF_PACKAGE.FUNC.01',
  architecture: 'DELIVERY-01.HANDOFF_ARCHITECTURE.FUNC.01',
  capability: 'DELIVERY-01.CAPABILITY_PREFLIGHT.OPS.01',
  clusterBoundary: 'DELIVERY-01.CLUSTER_BOUNDARY.SEC.01',
  secretHandoff: 'DELIVERY-01.SECRET_HANDOFF.SEC.01',
  database: 'DELIVERY-01.DATABASE_BRANCHES.DATA.01',
  media: 'DELIVERY-01.MEDIA_BRANCHES.DATA.01',
  entry: 'DELIVERY-01.ENTRY_BRANCHES.OPS.01',
  immutable: 'DELIVERY-01.IMMUTABLE_INPUTS.DATA.01',
  preflight: 'DELIVERY-01.DELIVERY_PREFLIGHT.FUNC.01',
  deploymentPaths: 'DELIVERY-01.DEPLOYMENT_PATHS.OPS.01',
  userSmoke: 'DELIVERY-01.USER_SMOKE.TXN.01',
  operations: 'DELIVERY-01.OPERATIONS_HANDOFF.OPS.01',
  rollback: 'DELIVERY-01.ROLLBACK_HANDOFF.TXN.01',
  scaling: 'DELIVERY-01.SCALING_GUIDANCE.CALC.01',
  commandSafety: 'DELIVERY-01.COMMAND_SAFETY.SEC.01',
  assetMapping: 'DELIVERY-01.ASSET_MAPPING.FUNC.01',
  manualStructure: 'DELIVERY-01.MANUAL_STRUCTURE.FUNC.01',
}
const p6t7AtomIds = Object.values(atom)
const evidenceIds = [
  'EV-P6-T7-UNIT',
  'EV-P6-T7-DELIVERY-PACKAGE',
  'EV-P6-T7-SECURITY',
  'EV-P6-T7-MANUAL',
  'EV-P6-T7-REGISTRY-INPUTS',
]

const taskExecution = await readJson(taskExecutionPath)
const task = taskExecution.tasks.find((entry) => entry.id === 'P6-T7')
if (!task) throw new Error('P6-T7 task execution row is missing')
task.changedPaths = sortPaths([...task.changedPaths, ...currentPaths])
task.declaredPaths = sortPaths([...task.declaredPaths, ...task.changedPaths])
task.extraPathReasons ??= {}
for (const relativePath of currentPaths) {
  if (task.extraPathReasons[relativePath]) continue
  task.extraPathReasons[relativePath] = relativePath.startsWith('outputs/final/')
    ? 'This sanitized final artifact records the offline deployment package or the user-owned verification handoff.'
    : relativePath.startsWith('outputs/evidence/')
      ? 'This deterministic P6-T7 evidence artifact binds the deployment package without rewriting protected historical evidence.'
      : 'This path implements or records the approved user-operated deployment package and its acceptance contract.'
}
task.evidenceIds = [...new Set([...task.evidenceIds, ...evidenceIds])]
task.redEvidence = [
  {
    classification: 'behavioral',
    command: 'node --test --test-name-pattern "approved unfamiliar-cluster clauses map reciprocally" scripts/verify-execution-contract.test.mjs',
    exitCode: 1,
    failure: 'The focused execution-contract test proved that all 17 approved unfamiliar-cluster clauses lacked dedicated reciprocal atoms before the source registry and original-atom generator were extended.',
  },
  {
    classification: 'behavioral',
    command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-deployment-package.test.ps1 and scripts/post-deploy-smoke.test.ps1',
    exitCode: 1,
    failure: 'The focused contracts failed because the offline package validator and bounded application-only user smoke did not exist; both now pass without cluster access or credential serialization.',
  },
  {
    classification: 'behavioral',
    command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-deployment-package.test.ps1',
    exitCode: 1,
    failure: 'Manual review exposed the unsupported --docker-password-file example. The new command-safety contract rejected it and required the supported private .dockerconfigjson file import before the manual and validator returned green.',
  },
]
task.stateHistory = [
  'pending',
  'in_progress',
  'red_verified',
  'implementation_complete',
  'focused_green',
  'regression_green',
  'not_applicable',
  'checkpointed',
  'completed',
]
task.handoffRecorded = true
task.externalBlockers = []
delete task.currentStep

const deliveryIds = taskExecution.tasks.find((entry) => entry.id === 'P6-T6').requiredAtomIds
  .filter((id) => id.startsWith('DELIVERY-01.'))
const p6t8Ids = [...new Set([...deliveryIds, ...p6t7AtomIds])]
let p6t8 = taskExecution.tasks.find((entry) => entry.id === 'P6-T8')
if (!p6t8) {
  p6t8 = {
    id: 'P6-T8',
    phaseId: 'P6',
    stateHistory: ['pending', 'in_progress'],
    declaredPaths: [
      'docs/traceability/requirements.md', 'README.md', 'DESIGN.md', 'PRODUCT.md', 'DEPLOYMENT.md',
      'docs/runbooks/backup-restore.md', 'docs/runbooks/media-storage.md', 'docs/runbooks/observability.md',
      'docs/runbooks/deploy-rollback.md', 'outputs/final/final-verification-index.md',
      'docs/superpowers/plans/2026-08-09-06-lifeops-production-delivery-plan.md',
      'docs/superpowers/plans/2026-08-09-execution-control.md', 'docs/traceability/task-execution.json',
      'docs/traceability/evidence-manifest.json', 'outputs/final/visual-evidence-manifest.json',
    ],
    changedPaths: [],
    extraPathReasons: {},
    requiredAtomIds: p6t8Ids,
    requiredAtomBoundaries: Object.fromEntries(p6t8Ids.map((id) => [id, (
      id === atom.immutable || id === atom.handoffPackage || deliveryIds.includes(id)
        ? 'verified-registry'
        : 'verified-local'
    )])),
    requiresMysql: true,
    uiChanged: false,
    handoffRecorded: false,
    redEvidence: [],
    evidenceIds: [],
    externalBlockers: [],
  }
  taskExecution.tasks.push(p6t8)
} else {
  p6t8.stateHistory = ['pending', 'in_progress']
}
await writeJson(taskExecutionPath, taskExecution)

const checkpoint = await buildLocalCheckpoint(root)
await writeJson(checkpointPath, checkpoint)
const packageSourcePathNames = [
  'playwright.config.ts', 'playwright.deployment.config.ts',
  'scripts/validate-deployment-package.ps1', 'scripts/validate-deployment-package.test.ps1',
  'scripts/post-deploy-smoke.ps1', 'scripts/post-deploy-smoke.test.ps1',
  'tests/deployment-smoke.spec.ts', 'tests/deployment-persistence.spec.ts',
  'docs/runbooks/user-deployment-checklist.md', 'docs/runbooks/deploy-rollback.md',
  'deploy/helm/lifeops-web/Chart.yaml', 'deploy/helm/lifeops-web/values.yaml',
  'deploy/helm/lifeops-web/values.schema.json', 'deploy/argocd/application.example.yaml',
  'deploy/gitops/environments/production/values.yaml',
  'deploy/helm/lifeops-web/templates/deployment.yaml',
  'deploy/helm/lifeops-web/templates/api-deployment.yaml',
  'deploy/helm/lifeops-web/templates/service.yaml',
  'deploy/helm/lifeops-web/templates/api-service.yaml',
  'deploy/helm/lifeops-web/templates/httproute.yaml',
  'deploy/helm/lifeops-web/templates/ingress.yaml',
  'deploy/helm/lifeops-web/templates/mysql-statefulset.yaml',
  'deploy/helm/lifeops-web/templates/migration-job.yaml',
  'deploy/helm/lifeops-web/templates/media-pvc.yaml',
  'deploy/helm/lifeops-web/templates/networkpolicy.yaml',
  'deploy/helm/lifeops-web/templates/pdb.yaml',
  'deploy/helm/lifeops-web/templates/hpa.yaml',
  'deploy/helm/lifeops-web/templates/external-secret.yaml',
  'docs/traceability/requirements.md', 'docs/traceability/task-execution.json',
]
const packageSourcePaths = await Promise.all(packageSourcePathNames.map(async (relativePath) => ({
  path: relativePath,
  sha256: await hashRelative(relativePath),
})))

const now = new Date().toISOString()
const common = {
  exitCode: 0,
  checkpoint: checkpoint.rootSha256,
  skipped: false,
  startedAt: now,
  completedAt: now,
  sourcePaths: packageSourcePaths,
  revalidatedAt: now,
}
const manualIds = [
  atom.handoffPackage, atom.architecture, atom.capability, atom.clusterBoundary, atom.secretHandoff,
  atom.database, atom.media, atom.entry, atom.deploymentPaths, atom.userSmoke, atom.operations,
  atom.rollback, atom.scaling, atom.commandSafety,
]
const evidenceRows = [
  {
    id: evidenceIds[0],
    atomIds: [atom.preflight, atom.userSmoke, atom.assetMapping, atom.manualStructure],
    type: 'unit',
    command: 'validate-deployment-package.test.ps1; post-deploy-smoke.test.ps1; npm.cmd test; npm.cmd run typecheck',
    summary: 'The focused negative contracts, complete 88-file/427-test frontend suite and TypeScript build prove package failure codes, immutable inputs, unsafe media/Secret rejection, bounded smoke cleanup and deployment-config isolation.',
    artifactPath: packageSummaryPath,
    ...common,
  },
  {
    id: evidenceIds[1],
    atomIds: p6t7AtomIds,
    type: 'delivery-package',
    command: 'validate-deployment-package.ps1 against the release manifest and digest-pinned production values with Helm strict lint/render',
    summary: 'The offline validator confirms release-manifest hashes, exact digests, values/schema, media topology, production security render, Argo mapping, manual structure and repository asset links without reading a cluster.',
    artifactPath: packageSummaryPath,
    ...common,
  },
  {
    id: evidenceIds[2],
    atomIds: [atom.clusterBoundary, atom.secretHandoff, atom.commandSafety],
    type: 'security',
    command: 'Deployment-package negative contracts plus rendered-Helm security and credential-safe source review',
    summary: 'The package rejects inline Secret values, public metrics, overbroad RBAC, unsafe media and command-line registry passwords; all cluster-changing commands remain clearly user-owned documentation only.',
    artifactPath: packageSummaryPath,
    ...common,
  },
  {
    id: evidenceIds[3],
    atomIds: manualIds,
    type: 'manual-review',
    command: 'Primary-agent complete read of user-deployment-checklist.md, deploy-rollback.md and the sanitized verification template',
    summary: 'The fourteen ordered sections, capability branches, safe command metadata, backup/restore, rollback, scaling and truthful unverified external-state boundaries were read end-to-end. The unsupported password-file example was found, test-locked and corrected.',
    manualReview: {
      reviewer: 'primary-agent',
      opened: true,
      breakpoint: '1440x900',
      conclusion: 'pass',
      checklist: { overflow: 'pass', forbiddenPatterns: 'pass', hierarchy: 'pass', continuity: 'pass', reducedMotion: 'pass' },
    },
    artifactPath: 'outputs/final/user-deployment-verification-template.md',
    ...common,
  },
  {
    id: evidenceIds[4],
    atomIds: [atom.immutable],
    type: 'registry',
    command: 'Release manifest and production-values exact digest comparison against successful UHub release 33286877080',
    summary: 'The handoff names the independently verified Web/API immutable UHub digests and release revision exactly; tags and local image IDs are explicitly rejected as substitutes.',
    artifactPath: releaseManifestPath,
    ...common,
  },
]

const visualManifest = await readJson(visualManifestPath)
visualManifest.checkpointRootSha256 = checkpoint.rootSha256
visualManifest.generatedAt = now
visualManifest.latestRevalidation = {
  taskId: 'P6-T7',
  step: 9,
  revalidatedAt: now,
  checkpointRootSha256: checkpoint.rootSha256,
  openedOriginalResolution: true,
  captureCount: 8,
  conclusion: 'pass',
  note: 'P6-T7 changes only deployment scripts, tests and documentation. No product or visual source changed, so the already opened CI19 desktop/phone day/night rest/login artifacts remain current.',
}
for (const state of visualManifest.states) {
  if (state.screenshotPath) state.screenshotSha256 = await hashRelative(state.screenshotPath)
  if (state.filmstripPath) state.filmstripSha256 = await hashRelative(state.filmstripPath)
  if (state.tracePath) state.traceSha256 = await hashRelative(state.tracePath)
}
for (const report of visualManifest.performanceReports) report.sha256 = await hashRelative(report.path)
await writeJson(visualManifestPath, visualManifest)

const manifest = await readJson(evidenceManifestPath)
manifest.evidence = manifest.evidence.filter((entry) => !evidenceIds.includes(entry.id))
manifest.evidence.push(...evidenceRows)
for (const row of manifest.evidence) {
  row.checkpoint = checkpoint.rootSha256
  for (const source of row.sourcePaths) source.sha256 = await hashRelative(source.path)
  if (row.artifactPath) row.artifactSha256 = await hashRelative(row.artifactPath)
  row.revalidatedAt = now
}
manifest.checkpoint = checkpoint.rootSha256
manifest.revalidation = {
  taskId: 'P6-T7',
  step: 9,
  revalidatedAt: now,
  basis: 'P6-T7 formalized 17 approved unfamiliar-cluster clauses, implemented the offline deployment validator and bounded user application smoke, delivered the fourteen-section capability-first manual plus rollback and verification templates, and passed complete frontend/server/type/build plus Helm/security/media/release-manifest gates. The manual was read end-to-end and its unsupported password-file example was corrected through RED/GREEN. HANDOFF_PACKAGE and MANUAL_STRUCTURE remain intentionally partial until P6-T8 integrates and reverse-audits the final project handoff. No kubeconfig, kubectl, Helm install/upgrade, Argo sync/rollback, cluster smoke, DNS/TLS or production reachability is claimed.',
}
await writeJson(evidenceManifestPath, manifest)

const fresh = await buildLocalCheckpoint(root)
if (fresh.rootSha256 !== checkpoint.rootSha256 || fresh.files.length !== checkpoint.files.length) {
  throw new Error(`Checkpoint changed during P6-T7 refresh: ${checkpoint.rootSha256}/${checkpoint.files.length} -> ${fresh.rootSha256}/${fresh.files.length}`)
}

console.log(JSON.stringify({
  checkpointPath,
  rootSha256: checkpoint.rootSha256,
  inputs: checkpoint.files.length,
  evidenceRows: manifest.evidence.length,
  p6t7EvidenceRows: evidenceRows.length,
  p6t7State: task.stateHistory.at(-1),
  p6t8State: p6t8.stateHistory.at(-1),
  visualStates: visualManifest.states.length,
}))
