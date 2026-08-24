import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { normalizeRelativePath } from './execution-contract/load-json.mjs'
import {
  applySourceClauseReviewRules,
  buildSourceClauseCandidates,
  mergeSourceClauseRegistry,
} from './execution-contract/source-clauses.mjs'

const REGISTRY_PATH = 'docs/traceability/source-clauses.json'

async function readExistingRegistry(workspaceRoot) {
  const absolutePath = path.join(workspaceRoot, ...REGISTRY_PATH.split('/'))
  try {
    return JSON.parse(await readFile(absolutePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw new Error(`Unable to read existing ${REGISTRY_PATH}: ${error.message}`, { cause: error })
  }
}

function parseArguments(arguments_) {
  let apply = false
  let replaceClassifications = false
  let reviewRulesPath = null
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--apply') {
      apply = true
    } else if (argument === '--replace-classifications') {
      replaceClassifications = true
    } else if (argument === '--review-rules') {
      const value = arguments_[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('--review-rules requires a relative JSON path')
      }
      reviewRulesPath = normalizeRelativePath(value)
      if (!reviewRulesPath.startsWith('docs/traceability/') || !reviewRulesPath.endsWith('.json')) {
        throw new Error('--review-rules must name a JSON file under docs/traceability/')
      }
      index += 1
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }

  if (replaceClassifications && !apply) {
    throw new Error('--replace-classifications requires --apply')
  }
  return { apply, replaceClassifications, reviewRulesPath }
}

function containsReviewedClassifications(registry) {
  return Array.isArray(registry?.clauses)
    && registry.clauses.some((clause) => clause?.classification != null)
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const workspaceRoot = process.cwd()
  const existingRegistry = await readExistingRegistry(workspaceRoot)
  if (
    options.apply
    && containsReviewedClassifications(existingRegistry)
    && !options.replaceClassifications
  ) {
    throw new Error(
      `Refusing to replace classified ${REGISTRY_PATH}; pass --replace-classifications after review`,
    )
  }

  const candidates = await buildSourceClauseCandidates(workspaceRoot)
  let registry = mergeSourceClauseRegistry(candidates, existingRegistry)
  if (options.reviewRulesPath) {
    const absoluteRulesPath = path.join(workspaceRoot, ...options.reviewRulesPath.split('/'))
    let reviewRules
    try {
      reviewRules = JSON.parse(await readFile(absoluteRulesPath, 'utf8'))
    } catch (error) {
      throw new Error(`Unable to read review rules ${options.reviewRulesPath}: ${error.message}`, { cause: error })
    }
    registry = applySourceClauseReviewRules(registry, reviewRules)
  }
  const rendered = `${JSON.stringify(registry, null, 2)}\n`

  if (options.apply) {
    const absolutePath = path.join(workspaceRoot, ...REGISTRY_PATH.split('/'))
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, rendered, 'utf8')
  }
  process.stdout.write(rendered)
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
