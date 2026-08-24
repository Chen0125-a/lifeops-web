import path from 'node:path'
import { readFile } from 'node:fs/promises'

import { PARENT_REQUIREMENT_IDS } from './constants.mjs'
import { readAuthoritySnapshot, verifyAuthorityHashes } from './authority.mjs'
import { validateAcceptanceMatrix } from './acceptance.mjs'
import { deriveAtomStatus, deriveParentStatus, validateEvidenceManifest } from './evidence.mjs'
import { readJson } from './load-json.mjs'
import { loadProjectState, parseFrontmatter } from './project-state.mjs'
import { buildLocalCheckpoint } from './source-checkpoint.mjs'
import { buildSourceClauseCandidates, validateSourceClauses } from './source-clauses.mjs'

const STATE_FIELDS = Object.freeze([
  'authorityRevision',
  'status',
  'activePlan',
  'activeTask',
  'activeStep',
  'requirementsVerified',
])

function comparablePath(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function duplicateValues(values) {
  const seen = new Set()
  const duplicates = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function stateMismatches(execution, state, expectedNextAction) {
  const mismatches = []
  for (const field of STATE_FIELDS) {
    if (state?.[field] !== execution?.[field]) {
      mismatches.push({ field, expected: execution?.[field] ?? null, actual: state?.[field] ?? null })
    }
  }
  if (state?.nextAction !== expectedNextAction) {
    mismatches.push({ field: 'nextAction', expected: expectedNextAction ?? null, actual: state?.nextAction ?? null })
  }
  return mismatches
}

export function validateStartup(context) {
  const issues = []
  const workspaceRoot = comparablePath(context?.workspaceRoot)
  const expectedWorkspaceRoot = comparablePath(context?.expectedWorkspaceRoot)
  if (!workspaceRoot || !expectedWorkspaceRoot || workspaceRoot !== expectedWorkspaceRoot) {
    issues.push({
      code: 'WRONG_WORKSPACE_ROOT',
      expected: context?.expectedWorkspaceRoot ?? null,
      actual: context?.workspaceRoot ?? null,
    })
  }

  for (const key of ['authorityIssues', 'sourceIssues', 'acceptanceIssues', 'evidenceIssues']) {
    const nested = Array.isArray(context?.[key]) ? context[key] : []
    issues.push(...nested.map((issue) => ({ ...issue, source: issue.source ?? key })))
  }

  const requirementIds = Array.isArray(context?.requirementIds) ? context.requirementIds : []
  for (const requirementId of duplicateValues(requirementIds)) {
    issues.push({ code: 'DUPLICATE_REQUIREMENT_ID', requirementId })
  }
  const requirementSet = new Set(requirementIds)
  const missingRequirements = PARENT_REQUIREMENT_IDS.filter((requirementId) => !requirementSet.has(requirementId))
  const unknownRequirements = [...requirementSet].filter((requirementId) => !PARENT_REQUIREMENT_IDS.includes(requirementId))
  if (missingRequirements.length || unknownRequirements.length) {
    issues.push({ code: 'REQUIREMENT_SET_MISMATCH', missingRequirements, unknownRequirements })
  }

  const atoms = Array.isArray(context?.matrix?.atoms) ? context.matrix.atoms : []
  for (const parentRequirementId of PARENT_REQUIREMENT_IDS) {
    if (!atoms.some((atom) => atom?.parentRequirementId === parentRequirementId)) {
      issues.push({ code: 'PARENT_WITHOUT_ATOM', parentRequirementId })
    }
  }

  const execution = context?.execution ?? {}
  const activeTaskIds = Array.isArray(execution.activeTaskIds) ? execution.activeTaskIds : []
  if (activeTaskIds.length !== 1) {
    issues.push({ code: 'MULTIPLE_ACTIVE_TASKS', activeTaskIds })
  } else if (activeTaskIds[0] !== execution.activeTask) {
    issues.push({
      code: 'ACTIVE_TASK_STATE_MISMATCH',
      expected: execution.activeTask ?? null,
      actual: activeTaskIds[0],
    })
  }

  const nextActions = Array.isArray(execution.nextActions)
    ? execution.nextActions.filter((action) => typeof action === 'string' && action.trim())
    : []
  if (nextActions.length !== 1) {
    issues.push({ code: 'NEXT_ACTION_NOT_UNIQUE', nextActions })
  }
  if (typeof execution.firstCommand !== 'string' || !execution.firstCommand.trim()) {
    issues.push({ code: 'FIRST_COMMAND_MISSING' })
  }

  const expectedNextAction = nextActions.length === 1 ? nextActions[0] : null
  const requirementsNextAction = context?.requirementsBoundary?.nextAction ?? null
  if (requirementsNextAction !== expectedNextAction) {
    issues.push({
      code: 'REQUIREMENTS_TASK_BOUNDARY_MISMATCH',
      expected: expectedNextAction,
      actual: requirementsNextAction,
    })
  }
  const currentMismatches = stateMismatches(execution, context?.current, expectedNextAction)
  if (currentMismatches.length) {
    issues.push({ code: 'CURRENT_STATE_MISMATCH', mismatches: currentMismatches })
  }
  const sessionMismatches = stateMismatches(execution, context?.session, expectedNextAction)
  if (sessionMismatches.length) {
    issues.push({ code: 'SESSION_STATE_MISMATCH', mismatches: sessionMismatches })
  }

  return issues
}

function normalizedTaskStep(match) {
  return match[2]
    ? `${match[2].toUpperCase()} Step ${Number(match[3])}`
    : `Task ${Number(match[1])} Step ${Number(match[3])}`
}

function taskStepMatches(text) {
  return [...String(text ?? '').matchAll(/(?:Task\s+(\d+)|(P\d+-T\d+)),?\s+Step\s+(\d+)/gi)]
    .map(normalizedTaskStep)
}

export function parseRequirementsBoundary(text) {
  const match = String(text ?? '').match(/^\*\*Latest task-boundary truth:\*\*\s*(.+)$/mi)
  const actions = taskStepMatches(match?.[1] ?? '')
  return { nextAction: actions.at(-1) ?? null }
}

export function parseExecutionState(text) {
  const frontmatter = parseFrontmatter(text)
  const nextSection = String(text ?? '').split(/^## Next atomic action\s*$/mi)[1] ?? ''
  const nextActions = [...new Set(taskStepMatches(nextSection))]
  const commandMatch = nextSection.match(/first(?:\s+verification)?\s+command[^`]*`([^`]+)`/i)
  const activeTaskIds = [...String(text ?? '').matchAll(/^active_task:\s*(\S+)\s*$/gmi)]
    .map((match) => match[1])
  return {
    authorityRevision: frontmatter.authority_revision ?? null,
    status: frontmatter.status ?? null,
    activePlan: frontmatter.active_plan ?? null,
    activeTask: frontmatter.active_task ?? null,
    activeStep: /^\d+$/.test(frontmatter.active_step ?? '') ? Number(frontmatter.active_step) : null,
    requirementsVerified: frontmatter.requirements_verified ?? null,
    activeTaskIds,
    nextActions,
    firstCommand: commandMatch?.[1]?.trim() ?? null,
  }
}

export function parseMirrorState(text, execution) {
  const body = String(text ?? '')
  const taskSteps = taskStepMatches(body)
  const activeTask = typeof execution?.activeTask === 'string' && body.includes(execution.activeTask)
    ? execution.activeTask
    : null
  const tuplePattern = activeTask && Number.isInteger(execution?.activeStep)
    ? new RegExp(`${activeTask.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]{0,120}?Step\\s*${execution.activeStep}`, 'i')
    : null
  return {
    authorityRevision: typeof execution?.authorityRevision === 'string' && body.includes(execution.authorityRevision)
      ? execution.authorityRevision
      : null,
    status: typeof execution?.status === 'string' && body.includes(execution.status)
      ? execution.status
      : null,
    activePlan: activeTask?.startsWith(`${execution?.activePlan}-`) ? execution.activePlan : null,
    activeTask,
    activeStep: tuplePattern?.test(body) ? execution.activeStep : null,
    requirementsVerified: typeof execution?.requirementsVerified === 'string' && body.includes(execution.requirementsVerified)
      ? execution.requirementsVerified
      : null,
    nextAction: taskSteps.at(-1) ?? null,
  }
}

export function buildStartupReport({
  mode,
  context,
  issues,
  checkpoint,
  parentStatuses,
  projectMemoryRootSource,
}) {
  const rows = parentStatuses instanceof Map ? [...parentStatuses.values()] : []
  const rollups = {}
  for (const status of ['pending', 'partial', 'verified-local', 'verified-image', 'verified-registry', 'invalidated']) {
    const count = rows.filter((row) => row === status).length
    if (count) rollups[status] = count
  }
  const currentIssues = Array.isArray(issues) ? issues : []
  const nextActions = Array.isArray(context?.execution?.nextActions)
    ? context.execution.nextActions
    : []
  return {
    ok: currentIssues.length === 0,
    mode,
    authorityRevision: context?.execution?.authorityRevision ?? null,
    status: context?.execution?.status ?? null,
    activePlan: context?.execution?.activePlan ?? null,
    activeTask: context?.execution?.activeTask ?? null,
    activeStep: context?.execution?.activeStep ?? null,
    requirementsVerified: context?.execution?.requirementsVerified ?? null,
    rollups,
    checkpoint: {
      kind: checkpoint?.kind ?? null,
      rootSha256: checkpoint?.rootSha256 ?? null,
    },
    blockers: [...new Set(currentIssues.map((issue) => issue.code))],
    nextAction: nextActions.length === 1 ? nextActions[0] : null,
    firstCommand: context?.execution?.firstCommand ?? null,
    projectMemoryRootSource,
    issues: currentIssues,
  }
}

function requirementIdsFromMarkdown(markdown) {
  const ids = []
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    const match = line.match(/^\|\s*((?:[A-Z]+|LIFE)-\d{2})\s*\|/)
    if (match) ids.push(match[1])
  }
  return ids
}

async function loadStaticArtifacts(workspaceRoot) {
  const artifactPaths = {
    sourceRegistry: 'docs/traceability/source-clauses.json',
    matrix: 'docs/traceability/acceptance-matrix.json',
    manifest: 'docs/traceability/evidence-manifest.json',
    requirements: 'docs/traceability/requirements.md',
  }
  const [sourceRegistry, matrix, manifest, requirementsText] = await Promise.all([
    readJson(path.join(workspaceRoot, ...artifactPaths.sourceRegistry.split('/'))),
    readJson(path.join(workspaceRoot, ...artifactPaths.matrix.split('/'))),
    readJson(path.join(workspaceRoot, ...artifactPaths.manifest.split('/'))),
    readFile(path.join(workspaceRoot, ...artifactPaths.requirements.split('/')), 'utf8'),
  ])
  return { sourceRegistry, matrix, manifest, requirementsText }
}

export async function buildStartupContext({ workspaceRoot, expectedWorkspaceRoot, memoryRoot }) {
  const state = await loadProjectState(expectedWorkspaceRoot, memoryRoot)
  const artifacts = await loadStaticArtifacts(expectedWorkspaceRoot)
  const checkpoint = await buildLocalCheckpoint(expectedWorkspaceRoot)
  const execution = parseExecutionState(state.executionControl.text)
  const authoritySnapshot = readAuthoritySnapshot(state.executionControl.text)
  const authorityIssues = await verifyAuthorityHashes(expectedWorkspaceRoot, authoritySnapshot)
  let sourceIssues
  try {
    const currentCandidates = await buildSourceClauseCandidates(expectedWorkspaceRoot)
    sourceIssues = validateSourceClauses(artifacts.sourceRegistry, currentCandidates)
  } catch (error) {
    sourceIssues = [{
      code: 'CURRENT_SOURCE_MISSING',
      error: error instanceof Error ? error.message : String(error),
    }]
  }
  const acceptanceIssues = validateAcceptanceMatrix(artifacts.matrix, artifacts.sourceRegistry)
  const evidenceIssues = await validateEvidenceManifest(artifacts.manifest, artifacts.matrix, checkpoint)
  const context = {
    workspaceRoot: path.resolve(workspaceRoot),
    expectedWorkspaceRoot: path.resolve(expectedWorkspaceRoot),
    authorityIssues,
    sourceIssues,
    acceptanceIssues,
    evidenceIssues,
    requirementIds: requirementIdsFromMarkdown(artifacts.requirementsText),
    requirementsBoundary: parseRequirementsBoundary(artifacts.requirementsText),
    matrix: artifacts.matrix,
    execution,
    current: parseMirrorState(state.current.text, execution),
    session: parseMirrorState(state.latestSession.text, execution),
  }
  const atomStatuses = new Map(artifacts.matrix.atoms.map((atom) => [
    atom.id,
    deriveAtomStatus(atom, artifacts.manifest.evidence, checkpoint),
  ]))
  const parentStatuses = new Map(PARENT_REQUIREMENT_IDS.map((parentId) => [
    parentId,
    deriveParentStatus(parentId, artifacts.matrix.atoms
      .filter((atom) => atom.parentRequirementId === parentId)
      .map((atom) => atomStatuses.get(atom.id))),
  ]))
  return { context, checkpoint, parentStatuses, state, artifacts }
}
