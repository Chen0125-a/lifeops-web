import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { SOURCE_FILE_ENTRIES, SOURCE_PATH_BY_KEY } from './constants.mjs'
import { extractClauseCandidates } from './markdown-clauses.mjs'

const CLASSIFICATIONS = new Set(['mapped', 'context-only', 'superseded'])
const SOURCE_ROWS = Object.freeze(SOURCE_FILE_ENTRIES.map(([sourceKey, sourcePath]) => Object.freeze({
  sourceKey,
  sourcePath,
})))

function locatorKey(value) {
  return JSON.stringify([
    value?.sourceKey,
    Array.isArray(value?.headingPath) ? value.headingPath : null,
    value?.kind,
    value?.ordinal,
  ])
}

function summarizeText(text) {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length <= 280 ? compact : `${compact.slice(0, 279)}…`
}

function normalizedStringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
    : []
}

function hasReplacementEvidence(value) {
  if (typeof value === 'string') {
    return value.trim().length > 0
  }
  return normalizedStringArray(value).length > 0
}

function createIssue(code, clause, details = {}) {
  return {
    code,
    ...(clause?.id ? { id: clause.id } : {}),
    ...(clause?.sourceKey ? { sourceKey: clause.sourceKey } : {}),
    ...(clause ? { locator: locatorKey(clause) } : {}),
    ...details,
  }
}

export async function buildSourceClauseCandidates(workspaceRoot) {
  const candidates = []
  for (const [sourceKey, sourcePath] of SOURCE_FILE_ENTRIES) {
    const absolutePath = path.join(workspaceRoot, ...sourcePath.split('/'))
    let markdown
    try {
      markdown = await readFile(absolutePath, 'utf8')
    } catch (error) {
      throw new Error(`Unable to read source-clause input ${sourcePath}: ${error.message}`, { cause: error })
    }
    candidates.push(...extractClauseCandidates(sourceKey, markdown))
  }
  return candidates
}

export function validateSourceClauses(registry, currentCandidates) {
  const issues = []
  const sources = Array.isArray(registry?.sources) ? registry.sources : []
  const clauses = Array.isArray(registry?.clauses) ? registry.clauses : []
  const candidates = Array.isArray(currentCandidates) ? currentCandidates : []
  const expectedSourceSet = new Set(SOURCE_ROWS.map((row) => `${row.sourceKey}\u0000${row.sourcePath}`))
  const actualSourceRows = sources.map((row) => `${row?.sourceKey}\u0000${row?.sourcePath}`)
  const actualSourceSet = new Set(actualSourceRows)

  if (registry?.schemaVersion !== 1) {
    issues.push({
      code: 'INVALID_SOURCE_REGISTRY_SCHEMA',
      expected: 1,
      actual: registry?.schemaVersion ?? null,
    })
  }

  if (
    actualSourceRows.length !== expectedSourceSet.size
    || actualSourceSet.size !== expectedSourceSet.size
    || [...expectedSourceSet].some((row) => !actualSourceSet.has(row))
  ) {
    issues.push({
      code: 'SOURCE_FILE_SET_MISMATCH',
      expected: SOURCE_ROWS.map((row) => ({ ...row })),
      actual: sources,
    })
  }

  const idCounts = new Map()
  const locatorCounts = new Map()
  const clausesByLocator = new Map()
  for (const clause of clauses) {
    if (typeof clause?.id !== 'string' || !clause.id.trim()) {
      issues.push(createIssue('INVALID_SOURCE_CLAUSE_ID', clause))
    } else {
      idCounts.set(clause.id, (idCounts.get(clause.id) ?? 0) + 1)
    }
    if (
      !Array.isArray(clause?.headingPath)
      || clause.headingPath.some((heading) => typeof heading !== 'string' || !heading.trim())
      || !['heading', 'paragraph', 'list-item', 'table-row'].includes(clause?.kind)
      || !Number.isInteger(clause?.ordinal)
      || clause.ordinal < 1
    ) {
      issues.push(createIssue('INVALID_SOURCE_CLAUSE_LOCATOR', clause))
    }
    if (typeof clause?.textSummary !== 'string' || !clause.textSummary.trim()) {
      issues.push(createIssue('INVALID_SOURCE_CLAUSE_SUMMARY', clause))
    }
    const locator = locatorKey(clause)
    locatorCounts.set(locator, (locatorCounts.get(locator) ?? 0) + 1)
    if (!clausesByLocator.has(locator)) {
      clausesByLocator.set(locator, clause)
    }

    if (SOURCE_PATH_BY_KEY[clause?.sourceKey] !== clause?.sourcePath) {
      issues.push(createIssue('SOURCE_CLAUSE_SOURCE_MISMATCH', clause, {
        expectedPath: SOURCE_PATH_BY_KEY[clause?.sourceKey] ?? null,
        actualPath: clause?.sourcePath ?? null,
      }))
    }
    if (!/^[A-F0-9]{64}$/.test(clause?.textSha256 ?? '')) {
      issues.push(createIssue('INVALID_SOURCE_CLAUSE_HASH', clause))
    }

    if (!CLASSIFICATIONS.has(clause?.classification)) {
      issues.push(createIssue('UNCLASSIFIED_SOURCE_CLAUSE', clause))
    } else if (clause.classification === 'mapped' && normalizedStringArray(clause.atomIds).length === 0) {
      issues.push(createIssue('MAPPED_CLAUSE_WITHOUT_ATOM', clause))
    } else if (
      clause.classification === 'context-only'
      && (typeof clause.reason !== 'string' || clause.reason.trim().length === 0)
    ) {
      issues.push(createIssue('CONTEXT_REASON_REQUIRED', clause))
    } else if (clause.classification === 'superseded' && !hasReplacementEvidence(clause.supersededBy)) {
      issues.push(createIssue('SUPERSEDED_EVIDENCE_REQUIRED', clause))
    }
  }

  for (const [id, count] of idCounts) {
    if (count > 1) {
      issues.push({ code: 'DUPLICATE_SOURCE_CLAUSE_ID', id, count })
    }
  }
  for (const [locator, count] of locatorCounts) {
    if (count > 1) {
      issues.push({ code: 'DUPLICATE_SOURCE_CLAUSE_LOCATOR', locator, count })
    }
  }

  const candidateLocators = new Map()
  for (const candidate of candidates) {
    const locator = locatorKey(candidate)
    if (candidateLocators.has(locator)) {
      issues.push(createIssue('DUPLICATE_CURRENT_SOURCE_LOCATOR', candidate))
      continue
    }
    candidateLocators.set(locator, candidate)

    const clause = clausesByLocator.get(locator)
    if (!clause) {
      issues.push(createIssue('CURRENT_SOURCE_CLAUSE_MISSING', candidate))
    } else if (clause.textSha256 !== candidate.textSha256) {
      issues.push(createIssue('SOURCE_CLAUSE_TEXT_CHANGED', clause, {
        expected: candidate.textSha256,
        actual: clause.textSha256,
      }))
    }
  }

  for (const clause of clauses) {
    if (!candidateLocators.has(locatorKey(clause))) {
      issues.push(createIssue('ORPHAN_SOURCE_CLAUSE', clause))
    }
  }

  return issues
}

export function mergeSourceClauseRegistry(currentCandidates, existingRegistry = null) {
  const candidates = Array.isArray(currentCandidates) ? currentCandidates : []
  const existingClauses = Array.isArray(existingRegistry?.clauses) ? existingRegistry.clauses : []
  const existingByLocator = new Map()
  const usedIds = new Set()
  const nextSequenceBySource = new Map()

  for (const clause of existingClauses) {
    const locator = locatorKey(clause)
    if (!existingByLocator.has(locator)) {
      existingByLocator.set(locator, clause)
    }
    if (typeof clause?.id === 'string' && clause.id.trim()) {
      usedIds.add(clause.id)
      const escapedSourceKey = String(clause.sourceKey ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const match = clause.id.match(new RegExp(`^SC-${escapedSourceKey}-(\\d+)$`))
      if (match) {
        nextSequenceBySource.set(
          clause.sourceKey,
          Math.max(nextSequenceBySource.get(clause.sourceKey) ?? 1, Number(match[1]) + 1),
        )
      }
    }
  }

  const allocateId = (sourceKey) => {
    let nextSequence = nextSequenceBySource.get(sourceKey) ?? 1
    let id
    do {
      id = `SC-${sourceKey}-${String(nextSequence).padStart(4, '0')}`
      nextSequence += 1
    } while (usedIds.has(id))
    nextSequenceBySource.set(sourceKey, nextSequence)
    usedIds.add(id)
    return id
  }

  const clauses = candidates.map((candidate) => {
    const previous = existingByLocator.get(locatorKey(candidate))
    const textUnchanged = previous?.textSha256 === candidate.textSha256
    return {
      id: previous?.id ?? allocateId(candidate.sourceKey),
      sourceKey: candidate.sourceKey,
      sourcePath: candidate.sourcePath,
      headingPath: [...candidate.headingPath],
      kind: candidate.kind,
      ordinal: candidate.ordinal,
      textSummary: summarizeText(candidate.text),
      textSha256: candidate.textSha256,
      classification: textUnchanged ? previous.classification : null,
      atomIds: textUnchanged ? normalizedStringArray(previous.atomIds) : [],
      reason: textUnchanged && typeof previous.reason === 'string' ? previous.reason : null,
      supersededBy: textUnchanged ? (previous.supersededBy ?? null) : null,
    }
  })

  return {
    schemaVersion: 1,
    sources: SOURCE_ROWS.map((row) => ({ ...row })),
    clauses,
  }
}

export function applySourceClauseReviewRules(registry, reviewRules) {
  if (reviewRules?.reviewStatus !== 'primary-executor-reviewed') {
    throw new Error('Source-clause review rules must be primary-executor-reviewed before application')
  }
  if (typeof reviewRules?.reviewedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reviewRules.reviewedOn)) {
    throw new Error('Source-clause review rules require a reviewedOn date')
  }
  if (!reviewRules?.defaultDecision || typeof reviewRules.defaultDecision.id !== 'string') {
    throw new Error('Source-clause review rules require a defaultDecision')
  }

  const rules = Array.isArray(reviewRules.rules) ? reviewRules.rules : []
  const ruleIds = [reviewRules.defaultDecision.id, ...rules.map((rule) => rule?.id)]
  if (ruleIds.some((id) => typeof id !== 'string' || !id.trim()) || new Set(ruleIds).size !== ruleIds.length) {
    throw new Error('Source-clause review rule IDs must be non-empty and unique')
  }

  const clauses = Array.isArray(registry?.clauses) ? registry.clauses : []
  const matchCounts = new Map(rules.map((rule) => [rule.id, 0]))
  const ruleCounts = {}

  const ruleMatches = (rule, clause) => {
    const match = rule?.match
    if (!match || typeof match !== 'object') {
      throw new Error(`Review rule ${rule.id} requires a match object`)
    }
    const supportedKeys = new Set(['ids', 'kind', 'sourceKey', 'textEquals'])
    const unknownKeys = Object.keys(match).filter((key) => !supportedKeys.has(key))
    if (unknownKeys.length > 0) {
      throw new Error(`Review rule ${rule.id} has unsupported match keys: ${unknownKeys.join(', ')}`)
    }

    return (match.ids === undefined || (Array.isArray(match.ids) && match.ids.includes(clause.id)))
      && (match.kind === undefined || match.kind === clause.kind)
      && (match.sourceKey === undefined || match.sourceKey === clause.sourceKey)
      && (
        match.textEquals === undefined
        || (Array.isArray(match.textEquals) && match.textEquals.includes(clause.textSummary))
      )
  }

  const applyDecision = (clause, decision) => {
    if (!CLASSIFICATIONS.has(decision?.classification)) {
      throw new Error(`Review decision ${decision?.id ?? '<unknown>'} has an invalid classification`)
    }

    if (decision.classification === 'mapped') {
      if (typeof decision.atomIdTemplate !== 'string' || !decision.atomIdTemplate.includes('{id}')) {
        throw new Error(`Mapped review decision ${decision.id} requires atomIdTemplate containing {id}`)
      }
      return {
        ...clause,
        classification: 'mapped',
        atomIds: [decision.atomIdTemplate.replaceAll('{id}', clause.id)],
        reason: null,
        supersededBy: null,
      }
    }
    if (decision.classification === 'context-only') {
      if (typeof decision.reason !== 'string' || !decision.reason.trim()) {
        throw new Error(`Context review decision ${decision.id} requires a concrete reason`)
      }
      return {
        ...clause,
        classification: 'context-only',
        atomIds: [],
        reason: decision.reason.trim(),
        supersededBy: null,
      }
    }
    if (!hasReplacementEvidence(decision.supersededBy)) {
      throw new Error(`Superseded review decision ${decision.id} requires replacement evidence`)
    }
    return {
      ...clause,
      classification: 'superseded',
      atomIds: [],
      reason: typeof decision.reason === 'string' && decision.reason.trim() ? decision.reason.trim() : null,
      supersededBy: decision.supersededBy,
    }
  }

  const reviewedClauses = clauses.map((clause) => {
    const matches = rules.filter((rule) => ruleMatches(rule, clause))
    if (matches.length > 1) {
      throw new Error(`Clause ${clause.id} matches multiple review rules: ${matches.map((rule) => rule.id).join(', ')}`)
    }
    const decision = matches[0] ?? reviewRules.defaultDecision
    if (matches[0]) {
      matchCounts.set(decision.id, matchCounts.get(decision.id) + 1)
    }
    ruleCounts[decision.id] = (ruleCounts[decision.id] ?? 0) + 1
    return applyDecision(clause, decision)
  })

  for (const [ruleId, matchCount] of matchCounts) {
    if (matchCount === 0) {
      throw new Error(`Review rule ${ruleId} did not match any source clause`)
    }
  }

  return {
    ...registry,
    clauses: reviewedClauses,
    review: {
      status: reviewRules.reviewStatus,
      reviewedOn: reviewRules.reviewedOn,
      ruleCounts,
    },
  }
}
