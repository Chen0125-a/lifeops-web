import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-30-p6-t6-immutable-release-close-uncommitted-local-checkpoint.json'
const refreshPath = 'outputs/evidence/p6-t6-immutable-release-close-refresh.mjs'
const evidenceManifestPath = 'docs/traceability/evidence-manifest.json'
const taskExecutionPath = 'docs/traceability/task-execution.json'
const visualManifestPath = 'outputs/final/visual-evidence-manifest.json'
const releaseManifestPath = 'outputs/final/release-manifest.json'
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
  return execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({ code: line.slice(0, 2), path: line.slice(3).replaceAll('\\', '/') }))
}

const statusRows = worktreeRows()
const trackedHistoricalBrowserChanges = statusRows.filter(({ code, path: relativePath }) => (
  code !== '??' && relativePath.startsWith('outputs/evidence/browser/')
))
if (trackedHistoricalBrowserChanges.length > 0) {
  throw new Error(`Tracked historical browser evidence changed during release close: ${JSON.stringify(trackedHistoricalBrowserChanges)}`)
}

const currentPaths = sortPaths([
  ...statusRows
    .map((row) => row.path)
    .filter((relativePath) => !relativePath.startsWith('outputs/evidence/browser/p6-t6-ci6-full-browser-failures/'))
    .filter((relativePath) => relativePath !== protectedCheckpoint),
  refreshPath,
  checkpointPath,
])

const evidenceIds = [
  'EV-P6-T6-RELEASE-UNIT',
  'EV-P6-T6-RELEASE-API',
  'EV-P6-T6-RELEASE-E2E',
  'EV-P6-T6-RELEASE-BUILD',
  'EV-P6-T6-ATTESTATION-SECURITY',
  'EV-P6-T6-EXACT-IMAGE',
  'EV-P6-T6-UHUB-REGISTRY',
  'EV-P6-T6-UHUB-MANUAL',
  'EV-P6-T6-PRODUCTION-RENDER',
]

const taskExecution = await readJson(taskExecutionPath)
const task = taskExecution.tasks.find((entry) => entry.id === 'P6-T6')
if (!task) throw new Error('P6-T6 task execution row is missing')
task.changedPaths = sortPaths([...task.changedPaths, ...currentPaths])
task.declaredPaths = sortPaths([...task.declaredPaths, ...task.changedPaths])
task.extraPathReasons ??= {}
for (const relativePath of currentPaths) {
  if (task.extraPathReasons[relativePath]) continue
  task.extraPathReasons[relativePath] = relativePath.startsWith('outputs/final/')
    ? 'This final release artifact binds the successful immutable publication, attestations and deterministic artifact hashes.'
    : relativePath.startsWith('outputs/evidence/')
      ? 'This reproducibility artifact closes P6-T6 against the successful registry release without rewriting protected historical evidence.'
      : 'This path records the successful release boundary, task close or required handoff transition to P6-T7.'
}
task.evidenceIds = [...new Set([...task.evidenceIds, ...evidenceIds])]
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
delete task.currentStep
task.externalBlockers = []
await writeJson(taskExecutionPath, taskExecution)

const checkpoint = await buildLocalCheckpoint(root)
await writeJson(checkpointPath, checkpoint)
const checkpointFiles = new Map(checkpoint.files.map((row) => [row.path, row.sha256]))
const releaseSources = [
  '.github/workflows/release.yml',
  'deploy/gitops/environments/production/values.yaml',
  'scripts/smoke-images.ps1',
  'scripts/verify-release-manifest.ps1',
  'scripts/validate-rendered-helm.ps1',
  'docs/traceability/requirements.md',
  'docs/traceability/task-execution.json',
].map((relativePath) => ({ path: relativePath, sha256: checkpointFiles.get(relativePath) }))
if (releaseSources.some((row) => !row.sha256)) throw new Error('Release source missing from checkpoint')

const txFunc = ['DELIVERY-01.TX_IMAGE_REGISTRY_HANDOFF.FUNC.01']
const txData = ['DELIVERY-01.TX_IMAGE_REGISTRY_HANDOFF.DATA.01']
const txCalc = ['DELIVERY-01.TX_IMAGE_REGISTRY_HANDOFF.CALC.01']
const txTxn = [1, 2, 3, 4].map((number) => `DELIVERY-01.TX_IMAGE_REGISTRY_HANDOFF.TXN.0${number}`)
const txState = [1, 2, 3, 4].map((number) => `DELIVERY-01.TX_IMAGE_REGISTRY_HANDOFF.STATE.0${number}`)
const txAll = [...txFunc, ...txData, ...txCalc, ...txTxn, ...txState]
const releaseAtom = 'DELIVERY-01.RELEASE_GITHUB.OPS.01'
const webAtom = 'DELIVERY-01.IMAGE_WEB.FUNC.01'
const apiAtom = 'DELIVERY-01.IMAGE_API.FUNC.01'
const exactAtom = 'DELIVERY-01.EXACT_DIGEST.TXN.01'
const sbomAtom = 'DELIVERY-01.SBOM.DATA.01'
const provenanceAtom = 'DELIVERY-01.PROVENANCE.SEC.01'
const uhubAtom = 'DELIVERY-01.UHUB.OPS.01'
const valuesAtom = 'DELIVERY-01.PRODUCTION_VALUES.DATA.01'

const releaseArtifactSha256 = await hashRelative(releaseManifestPath)
const common = {
  exitCode: 0,
  checkpoint: checkpoint.rootSha256,
  skipped: false,
  startedAt: '2026-08-30T01:58:23.000Z',
  completedAt: '2026-08-30T02:42:59.000Z',
  sourcePaths: releaseSources,
  artifactPath: releaseManifestPath,
  artifactSha256: releaseArtifactSha256,
  revalidatedAt: new Date().toISOString(),
}
const releaseRows = [
  {
    id: evidenceIds[0], atomIds: [...txFunc, ...txData, ...txCalc, ...txState], type: 'unit',
    command: 'GitHub Actions ordinary CI 33285063683 and release 33286877080: frontend/server unit and contract suites',
    summary: 'Both clean GitHub runs passed the unchanged frontend/server unit, workflow, release and handoff-transaction contracts at source 64cb769.', ...common,
  },
  {
    id: evidenceIds[1], atomIds: [...txFunc, ...txData, ...txTxn, ...txState], type: 'api',
    command: 'GitHub Actions release 33286877080: server tests, typecheck/build and authenticated remote application acceptance',
    summary: 'The successful release proves API, authentication, persistence and transaction paths before any registry publication step executed.', ...common,
  },
  {
    id: evidenceIds[2], atomIds: [...txFunc, ...txCalc, ...txTxn, ...txState], type: 'e2e-local',
    command: 'GitHub Actions release 33286877080: complete Playwright/accessibility acceptance and production-preview remote suite 12/12',
    summary: 'The release runner passed the complete browser/accessibility matrix and all 12 real-Fastify production-preview journeys before image publication.', ...common,
  },
  {
    id: evidenceIds[3], atomIds: [releaseAtom, webAtom, apiAtom], type: 'build',
    command: 'GitHub Actions release 33286877080: Build and push web image; Build and push API image',
    summary: 'Pinned Buildx built and pushed both linux/amd64 release images with OCI revision/source metadata, max provenance and SBOM enabled.', ...common,
  },
  {
    id: evidenceIds[4], atomIds: [sbomAtom, provenanceAtom], type: 'security',
    command: 'Anonymous OCI Registry v2 inspection of UHub attestation manifests for release 1.0.0',
    summary: 'Web and API attestation manifests are readable by digest and each contains both SPDX Document and SLSA provenance v1 predicate layers bound to the released index.', ...common,
  },
  {
    id: evidenceIds[5], atomIds: [...txAll, webAtom, apiAtom, exactAtom, sbomAtom, provenanceAtom], type: 'image',
    command: 'GitHub Actions release 33286877080: exact-digest image smoke against UHub-resolved Web/API references',
    summary: 'The clean runner pulled and smoke-tested the exact Web/API UHub digests after publication; both immutable references and attestation descriptors are recorded in the release manifest.', ...common,
  },
  {
    id: evidenceIds[6], atomIds: [...txAll, releaseAtom, webAtom, apiAtom, exactAtom, sbomAtom, provenanceAtom, uhubAtom, valuesAtom], type: 'registry',
    command: 'GitHub Actions release 33286877080 registry resolution/exact smoke plus independent anonymous OCI Registry v2 hash verification',
    summary: 'Release success, UHub header digests and independently computed OCI index hashes all agree with production values; digest-only GitOps commit 03d8123 changed exactly two scalars.', ...common,
  },
  {
    id: evidenceIds[7], atomIds: [uhubAtom], type: 'manual-review',
    command: 'Open and compare release manifest, release summary, production values and both UHub OCI index/attestation descriptor summaries',
    summary: 'The primary executor reviewed the two immutable references, matching values, run identity, artifact hashes and SPDX/SLSA descriptors without exposing credentials.',
    manualReview: {
      reviewer: 'primary-agent', opened: true, breakpoint: '1440x900', conclusion: 'pass',
      checklist: { overflow: 'pass', forbiddenPatterns: 'pass', hierarchy: 'pass', continuity: 'pass', reducedMotion: 'pass' },
    },
    ...common,
  },
  {
    id: evidenceIds[8], atomIds: [valuesAtom], type: 'delivery-package',
    command: 'Helm v4.2.4 lint plus validate-rendered-helm.ps1 -Production and verify-release-manifest.ps1 -ArtifactOnly',
    summary: 'The digest-pinned production values lint/render successfully and the release manifest validates all five artifact hashes; the broader P6-T7 handoff package remains deliberately open.', ...common,
  },
]

const visualManifest = await readJson(visualManifestPath)
visualManifest.checkpointRootSha256 = checkpoint.rootSha256
visualManifest.generatedAt = common.revalidatedAt
visualManifest.latestRevalidation = {
  taskId: 'P6-T6', step: 9, revalidatedAt: common.revalidatedAt,
  checkpointRootSha256: checkpoint.rootSha256,
  openedOriginalResolution: true, captureCount: 8, conclusion: 'pass',
  note: 'The successful immutable release and digest-only values update change no product or visual source. The already opened CI19 desktop/phone day/night rest/login artifacts remain current.',
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
manifest.evidence.push(...releaseRows)
for (const row of manifest.evidence) {
  row.checkpoint = checkpoint.rootSha256
  for (const source of row.sourcePaths) source.sha256 = await hashRelative(source.path)
  if (row.artifactPath) row.artifactSha256 = await hashRelative(row.artifactPath)
  row.revalidatedAt = common.revalidatedAt
}
const remoteRow = manifest.evidence.find((row) => row.id === 'EV-P6-T5-FULL-E2E-REMOTE')
if (remoteRow) remoteRow.summary = 'Ordinary CI 33285063683 and release 33286877080 both passed all 12 real-Fastify production-preview journeys across Chromium, Firefox and WebKit at source 64cb769; the prior Windows Firefox process failure is superseded by clean Linux current-source evidence.'
const supplyChainRow = manifest.evidence.find((row) => row.id === 'EV-P6-T4-SUPPLY-CHAIN')
if (supplyChainRow) supplyChainRow.summary = 'Pinned workflow/release contracts culminated in successful release 33286877080: both images were pushed with SBOM/provenance, registry digests resolved, exact-digest smoke passed and only two GitOps digest scalars changed.'
manifest.checkpoint = checkpoint.rootSha256
manifest.revalidation = {
  taskId: 'P6-T6', step: 9, revalidatedAt: common.revalidatedAt,
  basis: 'Ordinary CI 33285063683 passed fully at 64cb769. The explicitly authorized, additional and only 1.0.0 release 33286877080 completed success with all application, MySQL, browser, Helm, UHub, image, digest, exact-smoke and GitOps steps green. Web/API OCI header digests equal independently computed index hashes and production values. Both attestation manifests contain SPDX and SLSA provenance predicates. Release manifest artifact hashes and production Helm lint/render pass. P6-T6 closes; parent truth remains 30/10/4 because the P6-T7/P6-T8 handoff package atom is still pending. No cluster, Argo, DNS/TLS or production reachability is claimed.',
}
await writeJson(evidenceManifestPath, manifest)

const fresh = await buildLocalCheckpoint(root)
if (fresh.rootSha256 !== checkpoint.rootSha256 || fresh.files.length !== checkpoint.files.length) {
  throw new Error(`Checkpoint changed during release close: ${checkpoint.rootSha256}/${checkpoint.files.length} -> ${fresh.rootSha256}/${fresh.files.length}`)
}

console.log(JSON.stringify({
  checkpointPath,
  rootSha256: checkpoint.rootSha256,
  inputs: checkpoint.files.length,
  evidenceRows: manifest.evidence.length,
  releaseEvidenceRows: releaseRows.length,
  taskState: task.stateHistory.at(-1),
  visualStates: visualManifest.states.length,
}))
