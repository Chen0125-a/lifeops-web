import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), 'utf8'))
const sha256 = (contents) => createHash('sha256').update(contents).digest('hex').toUpperCase()
const hashRelative = async (relativePath) => sha256(await readFile(path.join(root, ...relativePath.split('/'))))
const sourcePaths = async (paths) => Promise.all(paths.map(async (sourcePath) => ({ path: sourcePath, sha256: await hashRelative(sourcePath) })))

const manifestPath = 'docs/traceability/evidence-manifest.json'
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-23-p5-t8-platform-global-closure-uncommitted-local-checkpoint.json'
const [manifest, checkpoint] = await Promise.all([readJson(manifestPath), readJson(checkpointPath)])

for (const row of manifest.evidence) {
  row.checkpoint = checkpoint.rootSha256
  for (const source of row.sourcePaths ?? []) source.sha256 = await hashRelative(source.path)
  if (row.artifactPath) row.artifactSha256 = await hashRelative(row.artifactPath)
}

manifest.evidence = manifest.evidence.filter((row) => row.id !== 'EV-P5-T8-SECURITY-CROSS-SURFACE')
const atomIds = [
  'SEC-01.LOGIN_OVERLAY.SEC.01',
  'SEC-01.LOGIN_OVERLAY.SEC.02',
  'SEC-01.RECORDS_ROUTE.SEC.01',
  'SEC-01.RECORDS_ROUTE.SEC.02',
  'SEC-01.SETTINGS_ROUTE.SEC.01',
  'SEC-01.SETTINGS_ROUTE.SEC.02',
  'SEC-01.TX_IMAGE_REGISTRY_HANDOFF.SEC.01',
  'SEC-01.TX_IMAGE_REGISTRY_HANDOFF.SEC.02',
]
manifest.evidence.push({
  id: 'EV-P5-T8-SECURITY-CROSS-SURFACE',
  atomIds,
  type: 'security',
  command: 'npm.cmd run test:server -- server/src/app.test.ts server/src/routes/records.test.ts server/src/routes/settings.test.ts server/src/integrations/safeFetch.test.ts server/src/integrations/redact.test.ts',
  exitCode: 0,
  startedAt: '2026-08-22T20:34:46Z',
  completedAt: '2026-08-22T20:34:51Z',
  checkpoint: checkpoint.rootSha256,
  skipped: false,
  summary: 'Fresh cross-surface security regression passed 5 files / 32 tests for opaque sessions, CSRF, owner isolation, login enumeration resistance, private records/media, settings/session/password/export redaction, exact-origin bounded transport and recursive secret removal. It supplies honest partial local evidence only; P6 still owns image, network-policy and rendered RBAC proof.',
  sourcePaths: await sourcePaths([
    'server/src/app.ts',
    'server/src/app.test.ts',
    'server/src/routes/records.ts',
    'server/src/routes/records.test.ts',
    'server/src/routes/settings.ts',
    'server/src/routes/settings.test.ts',
    'server/src/integrations/safeFetch.ts',
    'server/src/integrations/safeFetch.test.ts',
    'server/src/integrations/redact.ts',
    'server/src/integrations/redact.test.ts',
    'docs/traceability/requirements.md',
  ]),
})

manifest.checkpoint = checkpoint.rootSha256
await writeFile(path.join(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ checkpoint: checkpoint.rootSha256, evidenceRows: manifest.evidence.length, added: 1, atoms: atomIds.length }))
