import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLifeAcceptance, collectLifeAcceptanceCoverageGaps } from './execution-contract/life-atoms.mjs'

const args = new Set(process.argv.slice(2))
const workspaceRoot = process.cwd()
const matrixPath = path.join(workspaceRoot, 'docs', 'traceability', 'acceptance-matrix.json')
const registryPath = path.join(workspaceRoot, 'docs', 'traceability', 'source-clauses.json')
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'))
const sourceRegistry = JSON.parse(await readFile(registryPath, 'utf8'))
const built = buildLifeAcceptance(matrix, sourceRegistry)
const gaps = collectLifeAcceptanceCoverageGaps(built.matrix, built.sourceRegistry)

if (
  gaps.missingParents.length
  || gaps.missingMappedClauseIds.length
  || gaps.missingSurfaceDimensions.length
  || gaps.missingTransactions.length
) {
  throw new Error(`Life acceptance coverage remains incomplete: ${JSON.stringify(gaps)}`)
}

const summary = {
  mode: args.has('--apply') ? 'apply' : 'preview',
  lifeAtoms: built.matrix.atoms.filter((atom) => atom.parentRequirementId.startsWith('LIFE-')).length,
  mappedLifeClauses: built.sourceRegistry.clauses.filter((clause) => (
    clause.atomIds.some((atomId) => atomId.startsWith('LIFE-'))
  )).length,
  unresolvedMappedPlaceholders: built.sourceRegistry.clauses.filter((clause) => (
    clause.classification === 'mapped' && clause.atomIds.some((atomId) => atomId === `ATOM-${clause.id}`)
  )).length,
  missingParents: gaps.missingParents.length,
  missingMappedClauses: gaps.missingMappedClauseIds.length,
  missingSurfaceDimensions: gaps.missingSurfaceDimensions.length,
  missingTransactions: gaps.missingTransactions.length,
}

if (summary.unresolvedMappedPlaceholders) {
  throw new Error(`Mapped source clauses still contain ${summary.unresolvedMappedPlaceholders} unresolved placeholders`)
}

if (args.has('--apply')) {
  await writeFile(matrixPath, `${JSON.stringify(built.matrix, null, 2)}\n`, 'utf8')
  await writeFile(registryPath, `${JSON.stringify(built.sourceRegistry, null, 2)}\n`, 'utf8')
}

console.log(JSON.stringify(summary, null, 2))
