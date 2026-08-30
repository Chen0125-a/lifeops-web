import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildStartupContext,
  buildStartupReport,
  validateStartup,
} from './execution-contract/startup.mjs'
import { resolveProjectMemoryRoot } from './execution-contract/project-state.mjs'
import { deriveAtomStatus } from './execution-contract/evidence.mjs'
import { WORK_PACKAGE_FILES } from './execution-contract/constants.mjs'
import {
  buildPhaseCloseContext,
  validateHandoff,
  validatePhaseClose,
  validateProjectClose,
  validateTaskClose,
} from './execution-contract/close-modes.mjs'

function argumentValue(args, name) {
  const directIndex = args.indexOf(name)
  if (directIndex >= 0) return args[directIndex + 1] ?? null
  const prefix = `${name}=`
  return args.find((entry) => entry.startsWith(prefix))?.slice(prefix.length) ?? null
}

function memoryRootSource(args, env) {
  if (argumentValue(args, '--project-memory-root')) return 'cli'
  if (typeof env.LIFEOPS_PROJECT_MEMORY_ROOT === 'string' && env.LIFEOPS_PROJECT_MEMORY_ROOT.trim()) return 'environment'
  return 'AGENTS.md'
}

function completedGuardTasks(planText) {
  const sections = String(planText ?? '').split(/^### Task\s+(\d+):.*$/gmi)
  const completed = []
  for (let index = 1; index < sections.length; index += 2) {
    const taskNumber = Number(sections[index])
    const body = sections[index + 1] ?? ''
    const checkboxes = [...body.matchAll(/^- \[([ x])\]/gmi)]
    if (checkboxes.length && checkboxes.every((match) => match[1].toLowerCase() === 'x')) {
      completed.push(`Task ${taskNumber}`)
    }
  }
  return completed
}

function executionCompletedGuardTasks(executionControlText) {
  const match = String(executionControlText ?? '').match(/Execution-guard Tasks 1 through (\d+) are checkpointed/i)
  const lastCompleted = match ? Number(match[1]) : 0
  return Array.from({ length: lastCompleted }, (_, index) => `Task ${index + 1}`)
}

function requirementStatuses(requirementsText) {
  const statuses = new Map()
  for (const line of String(requirementsText ?? '').split(/\r?\n/)) {
    const match = line.match(/^\|\s*((?:[A-Z]+|LIFE)-\d{2})\s*\|(?:[^|]*\|){2}\s*([^|]+?)\s*\|/)
    if (match) statuses.set(match[1], match[2].trim())
  }
  return statuses
}

async function buildHandoffModeContext(built, workspaceRoot) {
  const guardPlanText = await readFile(path.join(
    workspaceRoot,
    'docs',
    'superpowers',
    'plans',
    '2026-08-11-lifeops-execution-guard-implementation-plan.md',
  ), 'utf8')
  const execution = {
    ...built.context.execution,
    completedTaskIds: executionCompletedGuardTasks(built.state.executionControl.text),
  }
  const nextAction = execution.nextActions.length === 1 ? execution.nextActions[0] : null
  return {
    execution,
    planState: {
      activePlan: execution.activePlan,
      activeTask: execution.activeTask,
      activeStep: execution.activeStep,
      completedTaskIds: completedGuardTasks(guardPlanText),
      nextAction,
    },
    requirementStatuses: requirementStatuses(built.artifacts.requirementsText),
    parentStatuses: built.parentStatuses,
    current: built.context.current,
    session: built.context.session,
    sessionPaths: [built.state.latestSession.path],
    nextSessionPath: path.join(
      built.state.memoryRoot,
      'sessions',
      `S${String(built.state.latestSession.nextNumber).padStart(3, '0')}_next.md`,
    ),
  }
}

async function buildTaskCloseModeContext(built, taskId, workspaceRoot) {
  const taskExecution = JSON.parse(await readFile(path.join(
    workspaceRoot,
    'docs',
    'traceability',
    'task-execution.json',
  ), 'utf8'))
  const recorded = array(taskExecution.tasks).find((task) => task?.id === taskId)
  if (!recorded) return { tasks: [], atomStatuses: currentAtomStatuses(built) }
  const atomIds = new Set(array(recorded.requiredAtomIds))
  const evidenceIds = new Set(array(recorded.evidenceIds))
  const evidence = built.artifacts.manifest.evidence.filter((row) => evidenceIds.has(row.id))
  return {
    tasks: [{
      ...recorded,
      requiredAtomIds: [...atomIds],
      requiredAtomBoundaries: new Map(Object.entries(recorded.requiredAtomBoundaries ?? {})),
      evidence,
      checkpoint: built.checkpoint,
    }],
    atomStatuses: currentAtomStatuses(built),
  }
}

async function buildPhaseCloseModeContext(built, phaseId, workspaceRoot) {
  const planTexts = {}
  await Promise.all(WORK_PACKAGE_FILES.map(async (relativePath, index) => {
    planTexts[`P${index + 1}`] = await readFile(path.join(workspaceRoot, ...relativePath.split('/')), 'utf8')
  }))
  return buildPhaseCloseContext({
    phaseId,
    planTexts,
    matrix: built.artifacts.matrix,
    checkpoint: built.checkpoint,
    atomStatuses: currentAtomStatuses(built),
  })
}

async function buildProjectCloseModeContext(built, manifestPath) {
  let releaseMetadata
  try {
    releaseMetadata = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw Object.assign(new Error(`Project-close manifest must contain valid JSON: ${error instanceof Error ? error.message : String(error)}`), {
      code: 'PROJECT_CLOSE_MANIFEST_INVALID',
    })
  }
  if (!releaseMetadata || typeof releaseMetadata !== 'object' || Array.isArray(releaseMetadata)) {
    throw Object.assign(new Error('Project-close manifest must be a JSON object'), {
      code: 'PROJECT_CLOSE_MANIFEST_INVALID',
    })
  }
  if (releaseMetadata.schemaVersion !== 1) {
    throw Object.assign(new Error('Project-close manifest must use schema version 1'), {
      code: 'PROJECT_CLOSE_MANIFEST_INVALID',
    })
  }
  const atomStatuses = currentAtomStatuses(built)
  return {
    ...releaseMetadata,
    parentStatuses: built.parentStatuses,
    projectAtoms: built.artifacts.matrix.atoms.map((atom) => ({
      id: atom.id,
      status: atomStatuses.get(atom.id),
      finalBoundary: atom.finalBoundary,
    })),
  }
}

function array(value) {
  return Array.isArray(value) ? value : []
}

function currentAtomStatuses(built) {
  return new Map(built.artifacts.matrix.atoms.map((atom) => [
    atom.id,
    deriveAtomStatus(atom, built.artifacts.manifest.evidence, built.checkpoint),
  ]))
}

const args = process.argv.slice(2)
const mode = argumentValue(args, '--mode') ?? 'startup'
const expectedWorkspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const actualWorkspaceRoot = process.cwd()
let report

try {
  const supportedModes = ['startup', 'task-close', 'phase-close', 'handoff', 'project-close']
  if (!supportedModes.includes(mode)) {
    throw Object.assign(new Error(`Mode ${mode} is not implemented yet`), { code: 'UNSUPPORTED_MODE' })
  }
  const agentsText = await readFile(path.join(expectedWorkspaceRoot, 'AGENTS.md'), 'utf8')
  const projectMemoryRoot = resolveProjectMemoryRoot(args, process.env, agentsText)
  const built = await buildStartupContext({
    workspaceRoot: actualWorkspaceRoot,
    expectedWorkspaceRoot,
    memoryRoot: projectMemoryRoot,
  })
  const issues = validateStartup(built.context)
  if (mode === 'task-close') {
    const taskId = argumentValue(args, '--task')
    if (!taskId) throw Object.assign(new Error('--task is required for task-close'), { code: 'TASK_REQUIRED' })
    issues.push(...validateTaskClose(await buildTaskCloseModeContext(built, taskId, expectedWorkspaceRoot), taskId))
  } else if (mode === 'phase-close') {
    const phaseId = argumentValue(args, '--phase')
    if (!phaseId) throw Object.assign(new Error('--phase is required for phase-close'), { code: 'PHASE_REQUIRED' })
    issues.push(...validatePhaseClose(await buildPhaseCloseModeContext(built, phaseId, expectedWorkspaceRoot), phaseId))
  } else if (mode === 'handoff') {
    issues.push(...validateHandoff(await buildHandoffModeContext(built, expectedWorkspaceRoot)))
  } else if (mode === 'project-close') {
    const projectCloseManifestPath = argumentValue(args, '--project-close-manifest')
      ?? path.join(expectedWorkspaceRoot, 'outputs', 'final', 'project-close-manifest.json')
    issues.push(...validateProjectClose(await buildProjectCloseModeContext(built, projectCloseManifestPath)))
  }
  report = buildStartupReport({
    mode,
    context: built.context,
    issues,
    checkpoint: built.checkpoint,
    parentStatuses: built.parentStatuses,
    projectMemoryRootSource: memoryRootSource(args, process.env),
  })
} catch (error) {
  report = {
    ok: false,
    mode,
    authorityRevision: null,
    status: null,
    activePlan: null,
    activeTask: null,
    activeStep: null,
    requirementsVerified: null,
    rollups: {},
    checkpoint: { kind: null, rootSha256: null },
    blockers: [error?.code ?? 'STARTUP_LOAD_FAILED'],
    nextAction: null,
    firstCommand: null,
    projectMemoryRootSource: memoryRootSource(args, process.env),
    issues: [{
      code: error?.code ?? 'STARTUP_LOAD_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }],
  }
}

console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exitCode = 1
