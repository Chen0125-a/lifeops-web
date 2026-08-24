import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const baselinePath = path.join(root, 'outputs', 'evidence', 'source-checkpoints', '2026-08-23-adr-028-public-starfield-concentric-orbit-formalization-uncommitted-local-checkpoint.json')
const outputRelativePath = 'outputs/evidence/source-checkpoints/2026-08-23-p6-t5-rejected-concentric-candidate-safe-pause-uncommitted-local-checkpoint.json'
const outputPath = path.join(root, ...outputRelativePath.split('/'))
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
const checkpoint = await buildLocalCheckpoint(root)
checkpoint.workspaceRoot = root

const baselineByPath = new Map(baseline.files.map((row) => [row.path, row.sha256]))
const currentByPath = new Map(checkpoint.files.map((row) => [row.path, row.sha256]))
const changedPaths = [...new Set([...baselineByPath.keys(), ...currentByPath.keys()])]
  .filter((filePath) => baselineByPath.get(filePath) !== currentByPath.get(filePath))
  .sort()

await writeFile(outputPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  output: outputRelativePath,
  rootSha256: checkpoint.rootSha256,
  files: checkpoint.files.length,
  changedPaths,
}, null, 2))
