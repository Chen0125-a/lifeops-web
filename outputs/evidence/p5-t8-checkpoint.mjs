import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpoint = await buildLocalCheckpoint(root)
checkpoint.workspaceRoot = root
const output = path.join(root, 'outputs/evidence/source-checkpoints/2026-08-23-p5-t8-platform-global-closure-uncommitted-local-checkpoint.json')
await writeFile(output, `${JSON.stringify(checkpoint, null, 2)}\n`)
console.log(JSON.stringify({ output: path.relative(root, output).replaceAll('\\', '/'), rootSha256: checkpoint.rootSha256, files: checkpoint.files.length }))
