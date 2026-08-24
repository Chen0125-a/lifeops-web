import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { AUTHORITY_FILES } from './constants.mjs'
import { normalizeRelativePath } from './load-json.mjs'

const AUTHORITY_FILE_SET = new Set(AUTHORITY_FILES)
const AUTHORITY_TABLE_ROW = /^\s*\|\s*`([^`]+)`\s*\|\s*`([A-Fa-f0-9]{64})`\s*\|\s*$/

function sha256Buffer(contents) {
  return createHash('sha256').update(contents).digest('hex').toUpperCase()
}

export function readAuthoritySnapshot(executionControlText) {
  if (typeof executionControlText !== 'string') {
    throw new TypeError('Execution-control source must be a string')
  }

  const discovered = new Map()
  for (const line of executionControlText.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(AUTHORITY_TABLE_ROW)
    if (!match) {
      continue
    }

    const relativePath = normalizeRelativePath(match[1].trim())
    if (!AUTHORITY_FILE_SET.has(relativePath)) {
      continue
    }
    if (discovered.has(relativePath)) {
      throw new Error(`Duplicate authority snapshot row: ${relativePath}`)
    }

    discovered.set(relativePath, match[2].toUpperCase())
  }

  return new Map(
    AUTHORITY_FILES
      .filter((relativePath) => discovered.has(relativePath))
      .map((relativePath) => [relativePath, discovered.get(relativePath)]),
  )
}

export async function verifyAuthorityHashes(workspaceRoot, snapshot) {
  if (!(snapshot instanceof Map)) {
    throw new TypeError('Authority snapshot must be a Map')
  }

  const issues = []
  for (const relativePath of AUTHORITY_FILES) {
    const expected = snapshot.get(relativePath)
    if (!expected) {
      issues.push({
        code: 'AUTHORITY_SNAPSHOT_MISSING',
        path: relativePath,
      })
      continue
    }

    try {
      const contents = await readFile(path.join(workspaceRoot, ...relativePath.split('/')))
      const actual = sha256Buffer(contents)
      if (actual !== expected.toUpperCase()) {
        issues.push({
          code: 'AUTHORITY_HASH_MISMATCH',
          path: relativePath,
          expected: expected.toUpperCase(),
          actual,
        })
      }
    } catch (error) {
      issues.push({
        code: error?.code === 'ENOENT' ? 'AUTHORITY_FILE_MISSING' : 'AUTHORITY_FILE_READ_FAILED',
        path: relativePath,
        expected: expected.toUpperCase(),
        message: error.message,
      })
    }
  }

  return issues
}
