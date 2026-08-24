import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpointRelativePath = 'outputs/evidence/source-checkpoints/2026-08-23-adr-028-public-starfield-concentric-orbit-formalization-uncommitted-local-checkpoint.json'
const manifestRelativePath = 'docs/traceability/evidence-manifest.json'
const sha256 = (contents) => createHash('sha256').update(contents).digest('hex').toUpperCase()
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, ...relativePath.split('/')), 'utf8'))
const hashRelative = async (relativePath) => sha256(await readFile(path.join(root, ...relativePath.split('/'))))

const checkpoint = await buildLocalCheckpoint(root)
checkpoint.workspaceRoot = root
await writeFile(
  path.join(root, ...checkpointRelativePath.split('/')),
  `${JSON.stringify(checkpoint, null, 2)}\n`,
  'utf8',
)

const manifest = await readJson(manifestRelativePath)
for (const row of manifest.evidence) {
  row.checkpoint = checkpoint.rootSha256
  for (const source of row.sourcePaths ?? []) source.sha256 = await hashRelative(source.path)
  if (row.artifactPath) row.artifactSha256 = await hashRelative(row.artifactPath)
}
manifest.checkpoint = checkpoint.rootSha256
await writeFile(
  path.join(root, ...manifestRelativePath.split('/')),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
)

console.log(JSON.stringify({
  output: checkpointRelativePath,
  rootSha256: checkpoint.rootSha256,
  files: checkpoint.files.length,
  evidenceRows: manifest.evidence.length,
}, null, 2))
