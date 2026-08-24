import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

function normalizeText(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Expected text to be a string')
  }

  return value.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

export function normalizeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Relative path must be a non-empty string')
  }

  const slashPath = value.replaceAll('\\', '/')
  if (slashPath.startsWith('/') || /^[A-Za-z]:\//.test(slashPath)) {
    throw new Error(`Expected a relative path: ${value}`)
  }

  const normalized = path.posix.normalize(slashPath).replace(/^\.\//, '')
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Relative path escapes the workspace: ${value}`)
  }

  return normalized
}

export function sha256Text(value) {
  return createHash('sha256').update(normalizeText(value), 'utf8').digest('hex').toUpperCase()
}

export async function readJson(filePath) {
  let text
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    throw new Error(`Unable to read JSON file ${filePath}: ${error.message}`, { cause: error })
  }

  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`Unable to parse JSON file ${filePath}: ${error.message}`, { cause: error })
  }
}
