import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildOriginalAcceptance, collectOriginalAcceptanceCoverageGaps } from './execution-contract/original-atoms.mjs'

const args = new Set(process.argv.slice(2))
const workspaceRoot = process.cwd()
const matrixPath = path.join(workspaceRoot, 'docs', 'traceability', 'acceptance-matrix.json')
const registryPath = path.join(workspaceRoot, 'docs', 'traceability', 'source-clauses.json')
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'))
const sourceRegistry = JSON.parse(await readFile(registryPath, 'utf8'))
const built = buildOriginalAcceptance(matrix, sourceRegistry)
const gaps = collectOriginalAcceptanceCoverageGaps(built.matrix, built.sourceRegistry)

if (gaps.missingParents.length || gaps.missingMappedClauseIds.length || gaps.missingSurfaceDimensions.length) {
  throw new Error(`Original acceptance coverage remains incomplete: ${JSON.stringify(gaps)}`)
}

const summary = {
  mode: args.has('--apply') ? 'apply' : 'preview',
  originalAtoms: built.matrix.atoms.filter((atom) => !atom.parentRequirementId.startsWith('LIFE-')).length,
  mappedOriginalClauses: built.sourceRegistry.clauses.filter((clause) => (
    clause.atomIds.some((atomId) => built.matrix.atoms.some((atom) => atom.id === atomId))
  )).length,
  missingParents: gaps.missingParents.length,
  missingMappedClauses: gaps.missingMappedClauseIds.length,
  missingSurfaceDimensions: gaps.missingSurfaceDimensions.length,
}

if (args.has('--apply')) {
  await writeFile(matrixPath, `${JSON.stringify(built.matrix, null, 2)}\n`, 'utf8')
  await writeFile(registryPath, `${JSON.stringify(built.sourceRegistry, null, 2)}\n`, 'utf8')
}

console.log(JSON.stringify(summary, null, 2))
