import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { VALID_EVIDENCE_TYPES } from './acceptance.mjs'
import { normalizeRelativePath } from './load-json.mjs'

const SHA256 = /^[A-F0-9]{64}$/
const EVIDENCE_ID = /^EV-[A-Z0-9][A-Z0-9-]*$/
const BREAKPOINTS = new Set(['1440x900', '1024x768', '768x1024', '390x844'])
const MANUAL_CHECKLIST_KEYS = Object.freeze([
  'overflow',
  'forbiddenPatterns',
  'hierarchy',
  'continuity',
  'reducedMotion',
])
const MANUAL_RESULT = new Set(['pass', 'fail'])
const EVIDENCE_TYPE_SET = new Set(VALID_EVIDENCE_TYPES)
const STATUS_ORDER = new Map([
  ['pending', 0],
  ['partial', 1],
  ['verified-local', 2],
  ['verified-image', 3],
  ['verified-registry', 4],
])
const SENSITIVE_ARTIFACT_PATH = /(?:^|[-_.\/])(?:credential(?:s)?|cookie(?:s)?|kubeconfig|private[-_]?key|service[-_]?token|session[-_]?cookie|token(?:s)?|id[-_]?(?:rsa|ed25519))(?:[-_.\/]|$)/i

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex').toUpperCase()
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
    : []
}

function checkpointFileMap(checkpoint) {
  return new Map((Array.isArray(checkpoint?.files) ? checkpoint.files : [])
    .filter((row) => typeof row?.path === 'string' && typeof row?.sha256 === 'string')
    .map((row) => [safeNormalizeRelativePath(row.path), row.sha256])
    .filter(([relativePath]) => relativePath))
}

function safeNormalizeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const raw = value.replaceAll('\\', '/')
  if (path.posix.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw) || raw.split('/').includes('..')) return null
  try {
    return normalizeRelativePath(raw)
  } catch {
    return null
  }
}

function sourceFreshness(row, checkpoint) {
  if (row?.checkpoint !== checkpoint?.rootSha256) return false
  const currentFiles = checkpointFileMap(checkpoint)
  const sourcePaths = Array.isArray(row?.sourcePaths) ? row.sourcePaths : []
  if (sourcePaths.length === 0) return false
  return sourcePaths.every((source) => (
    typeof source?.path === 'string'
    && typeof source?.sha256 === 'string'
    && currentFiles.get(safeNormalizeRelativePath(source.path)) === source.sha256
  ))
}

function manualReviewComplete(row) {
  if (!['visual', 'manual-review'].includes(row?.type)) return true
  const review = row?.manualReview
  if (
    typeof review?.reviewer !== 'string'
    || !review.reviewer.trim()
    || review.opened !== true
    || !BREAKPOINTS.has(review.breakpoint)
    || typeof review.conclusion !== 'string'
    || !review.conclusion.trim()
  ) {
    return false
  }
  return MANUAL_CHECKLIST_KEYS.every((key) => MANUAL_RESULT.has(review.checklist?.[key]))
}

function rowPassesIntrinsicGate(row) {
  return row?.exitCode === 0
    && row?.skipped === false
    && typeof row?.command === 'string'
    && row.command.trim().length > 0
    && typeof row?.summary === 'string'
    && row.summary.trim().length > 0
    && manualReviewComplete(row)
}

function isSafeArtifactPath(artifactPath) {
  if (typeof artifactPath !== 'string' || !artifactPath.trim()) return false
  const raw = artifactPath.replaceAll('\\', '/')
  if (path.posix.isAbsolute(raw) || /^[A-Za-z]:\//.test(raw)) return false
  if (raw.split('/').includes('..')) return false
  const normalized = safeNormalizeRelativePath(raw)
  if (!normalized) return false
  if (
    normalized !== 'outputs/evidence'
    && !normalized.startsWith('outputs/evidence/')
    && normalized !== 'outputs/final'
    && !normalized.startsWith('outputs/final/')
  ) return false
  return !SENSITIVE_ARTIFACT_PATH.test(normalized)
}

function validIsoTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

export async function validateEvidenceManifest(manifest, matrix, checkpoint) {
  const issues = []
  const atoms = Array.isArray(matrix?.atoms) ? matrix.atoms : []
  const atomById = new Map(atoms.map((atom) => [atom.id, atom]))
  const currentFiles = checkpointFileMap(checkpoint)
  const rows = Array.isArray(manifest?.evidence) ? manifest.evidence : []

  if (manifest?.schemaVersion !== 1) {
    issues.push({ code: 'INVALID_EVIDENCE_SCHEMA', expected: 1, actual: manifest?.schemaVersion ?? null })
  }
  if (!SHA256.test(manifest?.checkpoint ?? '')) {
    issues.push({ code: 'INVALID_MANIFEST_CHECKPOINT', checkpoint: manifest?.checkpoint ?? null })
  } else if (manifest.checkpoint !== checkpoint?.rootSha256) {
    issues.push({ code: 'MANIFEST_CHECKPOINT_STALE', expected: checkpoint?.rootSha256 ?? null, actual: manifest.checkpoint })
  }
  if (!Array.isArray(manifest?.evidence)) {
    issues.push({ code: 'INVALID_EVIDENCE_ROWS' })
  }

  const seenIds = new Set()
  for (const row of rows) {
    const evidenceId = typeof row?.id === 'string' ? row.id : null
    if (!EVIDENCE_ID.test(evidenceId ?? '')) {
      issues.push({ code: 'INVALID_EVIDENCE_ID', evidenceId })
    } else if (seenIds.has(evidenceId)) {
      issues.push({ code: 'DUPLICATE_EVIDENCE_ID', evidenceId })
    }
    if (evidenceId) seenIds.add(evidenceId)

    const atomIds = stringArray(row?.atomIds)
    if (atomIds.length === 0) issues.push({ code: 'EVIDENCE_WITHOUT_ATOM', evidenceId })
    for (const atomId of atomIds) {
      if (!atomById.has(atomId)) {
        issues.push({ code: 'UNKNOWN_EVIDENCE_ATOM', evidenceId, atomId })
      }
    }

    if (!EVIDENCE_TYPE_SET.has(row?.type)) {
      issues.push({ code: 'UNKNOWN_EVIDENCE_TYPE', evidenceId, type: row?.type ?? null })
    } else if (atomIds.every((atomId) => !atomById.get(atomId)?.requiredEvidence?.includes(row.type))) {
      issues.push({ code: 'EVIDENCE_TYPE_NOT_REQUIRED', evidenceId, type: row.type })
    }

    if (typeof row?.command !== 'string' || !row.command.trim()) {
      issues.push({ code: 'EVIDENCE_COMMAND_REQUIRED', evidenceId })
    }
    if (row?.exitCode !== 0) {
      issues.push({ code: 'EVIDENCE_COMMAND_FAILED', evidenceId, exitCode: row?.exitCode ?? null })
    }
    if (!validIsoTime(row?.startedAt) || !validIsoTime(row?.completedAt)) {
      issues.push({ code: 'INVALID_EVIDENCE_TIME', evidenceId })
    } else if (Date.parse(row.completedAt) < Date.parse(row.startedAt)) {
      issues.push({ code: 'EVIDENCE_TIME_REVERSED', evidenceId })
    }
    if (typeof row?.summary !== 'string' || !row.summary.trim()) {
      issues.push({ code: 'EVIDENCE_SUMMARY_REQUIRED', evidenceId })
    }
    if (row?.skipped !== false) {
      issues.push({ code: 'REQUIRED_SUITE_SKIPPED', evidenceId, type: row?.type ?? null })
    }

    if (!SHA256.test(row?.checkpoint ?? '')) {
      issues.push({ code: 'INVALID_EVIDENCE_CHECKPOINT', evidenceId, checkpoint: row?.checkpoint ?? null })
    } else if (row.checkpoint !== checkpoint?.rootSha256) {
      issues.push({ code: 'EVIDENCE_CHECKPOINT_STALE', evidenceId, expected: checkpoint?.rootSha256 ?? null, actual: row.checkpoint })
    }

    const sourcePaths = Array.isArray(row?.sourcePaths) ? row.sourcePaths : []
    if (sourcePaths.length === 0) issues.push({ code: 'EVIDENCE_SOURCE_PATH_REQUIRED', evidenceId })
    const seenSourcePaths = new Set()
    for (const source of sourcePaths) {
      const sourcePath = safeNormalizeRelativePath(source?.path)
      if (!sourcePath) {
        issues.push({ code: 'INVALID_EVIDENCE_SOURCE_PATH', evidenceId, path: source?.path ?? null })
        continue
      }
      if (seenSourcePaths.has(sourcePath)) {
        issues.push({ code: 'DUPLICATE_EVIDENCE_SOURCE_PATH', evidenceId, path: sourcePath })
      }
      seenSourcePaths.add(sourcePath)
      if (!SHA256.test(source?.sha256 ?? '')) {
        issues.push({ code: 'INVALID_EVIDENCE_SOURCE_HASH', evidenceId, path: sourcePath })
        continue
      }
      if (!currentFiles.has(sourcePath)) {
        issues.push({ code: 'EVIDENCE_SOURCE_PATH_NOT_CHECKPOINTED', evidenceId, path: sourcePath })
      } else if (currentFiles.get(sourcePath) !== source.sha256) {
        issues.push({
          code: 'EVIDENCE_SOURCE_HASH_MISMATCH',
          evidenceId,
          path: sourcePath,
          expected: currentFiles.get(sourcePath),
          actual: source.sha256,
        })
      }
    }

    const hasArtifactPath = row?.artifactPath != null
    const hasArtifactHash = row?.artifactSha256 != null
    if (hasArtifactPath !== hasArtifactHash) {
      issues.push({ code: 'INCOMPLETE_ARTIFACT_REFERENCE', evidenceId })
    } else if (hasArtifactPath) {
      if (!isSafeArtifactPath(row.artifactPath)) {
        issues.push({ code: 'UNSAFE_ARTIFACT_PATH', evidenceId, artifactPath: row.artifactPath })
      } else if (!SHA256.test(row.artifactSha256)) {
        issues.push({ code: 'INVALID_ARTIFACT_HASH', evidenceId, artifactSha256: row.artifactSha256 })
      } else {
        const workspaceRoot = checkpoint?.workspaceRoot ?? process.cwd()
        const artifactPath = safeNormalizeRelativePath(row.artifactPath)
        try {
          const contents = await readFile(path.join(workspaceRoot, ...artifactPath.split('/')))
          const currentHash = sha256(contents)
          if (currentHash !== row.artifactSha256) {
            issues.push({ code: 'ARTIFACT_HASH_MISMATCH', evidenceId, artifactPath, expected: currentHash, actual: row.artifactSha256 })
          }
        } catch (error) {
          issues.push({ code: 'ARTIFACT_MISSING', evidenceId, artifactPath, error: error?.code ?? 'READ_FAILED' })
        }
      }
    }

    if (['visual', 'manual-review'].includes(row?.type)) {
      if (row?.manualReview?.opened !== true) {
        issues.push({ code: 'VISUAL_NOT_OPENED', evidenceId })
      }
      if (!manualReviewComplete(row)) {
        issues.push({ code: 'MANUAL_REVIEW_INCOMPLETE', evidenceId })
      } else if (
        row.manualReview.conclusion.toLowerCase() !== 'pass'
        || MANUAL_CHECKLIST_KEYS.some((key) => row.manualReview.checklist[key] !== 'pass')
      ) {
        issues.push({ code: 'MANUAL_REVIEW_FAILED', evidenceId })
      }
    } else if (row?.manualReview != null) {
      issues.push({ code: 'UNEXPECTED_MANUAL_REVIEW', evidenceId, type: row?.type ?? null })
    }
  }

  return issues
}

export function deriveAtomStatus(atom, evidence, checkpoint) {
  if (atom?.notApplicable) {
    const boundary = stringArray(atom.finalBoundary)
    if (boundary.includes('registry')) return 'verified-registry'
    if (boundary.includes('image')) return 'verified-image'
    return 'verified-local'
  }
  const rows = (Array.isArray(evidence) ? evidence : [])
    .filter((row) => stringArray(row?.atomIds).includes(atom?.id))
  if (rows.length === 0) return 'pending'

  const currentRows = checkpoint
    ? rows.filter((row) => sourceFreshness(row, checkpoint))
    : rows
  const passingRows = currentRows.filter(rowPassesIntrinsicGate)
  const passingTypes = new Set(passingRows.map((row) => row.type))
  const requiredTypes = stringArray(atom?.requiredEvidence)
  const allRequired = requiredTypes.length > 0 && requiredTypes.every((type) => passingTypes.has(type))

  if (allRequired) {
    const boundary = stringArray(atom?.finalBoundary)
    if (boundary.includes('registry')) return 'verified-registry'
    if (boundary.includes('image')) return 'verified-image'
    return 'verified-local'
  }
  if (passingTypes.size > 0) return 'partial'
  if (checkpoint && rows.some((row) => !sourceFreshness(row, checkpoint))) return 'invalidated'
  return 'pending'
}

export function deriveParentStatus(_parentId, atomStatuses) {
  const statuses = Array.isArray(atomStatuses) ? atomStatuses : []
  if (statuses.length === 0) return 'pending'
  if (statuses.includes('invalidated')) return 'invalidated'
  const valid = statuses.filter((status) => STATUS_ORDER.has(status))
  if (valid.length !== statuses.length) return 'pending'
  return valid.reduce((lowest, status) => (
    STATUS_ORDER.get(status) < STATUS_ORDER.get(lowest) ? status : lowest
  ), valid[0])
}
