import { PARENT_REQUIREMENT_IDS } from './constants.mjs'

const REQUIRED_VISUAL_BREAKPOINTS = Object.freeze([
  '1440x900',
  '1024x768',
  '768x1024',
  '390x844',
])

const STATUS_RANK = Object.freeze({
  invalidated: -1,
  pending: 0,
  partial: 1,
  'verified-local': 2,
  'verified-image': 3,
  'verified-registry': 4,
})

const TASK_STATE_RANK = Object.freeze({
  pending: 0,
  in_progress: 1,
  red_verified: 2,
  implementation_complete: 3,
  focused_green: 4,
  regression_green: 5,
  visually_verified: 6,
  not_applicable: 6,
  checkpointed: 7,
  completed: 8,
})

const REQUIRED_FINAL_GATES = Object.freeze([
  'web',
  'api',
  'mysql',
  'e2e',
  'visual',
  'accessibility',
  'security',
  'build',
  'helm',
])

const REQUIRED_DELIVERY_DOCUMENTS = Object.freeze([
  'postDeploySmokeDocument',
  'backupRestoreDocument',
  'mediaStorageDocument',
  'platformIntegrationDocument',
  'rollbackDocument',
])

function array(value) {
  return Array.isArray(value) ? value : []
}

function map(value) {
  return value instanceof Map ? value : new Map(Object.entries(value ?? {}))
}

function validSha256(value) {
  return typeof value === 'string' && /^[A-F0-9]{64}$/i.test(value)
}

function validDigest(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/i.test(value)
}

function evidencePasses(row, checkpoint) {
  return row?.exitCode === 0
    && row?.skipped === false
    && (!checkpoint || row?.checkpoint === checkpoint)
}

function stateHistoryIssues(task) {
  const history = array(task?.stateHistory)
  if (!history.length) return [{ code: 'TASK_STATE_HISTORY_MISSING', taskId: task?.id ?? null }]
  const ranks = history.map((state) => TASK_STATE_RANK[state])
  const invalidState = history.find((state) => TASK_STATE_RANK[state] === undefined)
  if (invalidState) {
    return [{ code: 'TASK_STATE_UNKNOWN', taskId: task.id, state: invalidState }]
  }
  const jumped = ranks.some((rank, index) => index > 0 && (rank < ranks[index - 1] || rank - ranks[index - 1] > 1))
  if (ranks[0] !== 0 || ranks.at(-1) !== TASK_STATE_RANK.completed || jumped) {
    return [{ code: 'TASK_STATE_SEQUENCE_INVALID', taskId: task.id, stateHistory: history }]
  }
  return []
}

export function validateTaskClose(context, taskId) {
  const issues = []
  const task = array(context?.tasks).find((candidate) => candidate?.id === taskId)
  if (!task) return [{ code: 'TASK_NOT_FOUND', taskId }]

  issues.push(...stateHistoryIssues(task))

  const redEvidence = array(task.redEvidence)
  if (!redEvidence.length) {
    issues.push({ code: 'BEHAVIORAL_RED_EVIDENCE_MISSING', taskId })
  } else if (!redEvidence.some((row) => (
    row?.classification === 'behavioral'
    && row?.exitCode !== 0
    && typeof row?.command === 'string'
    && row.command.trim()
    && typeof row?.failure === 'string'
    && row.failure.trim()
  ))) {
    issues.push({ code: 'RED_EVIDENCE_NOT_BEHAVIORAL', taskId })
  }

  const declaredPaths = new Set(array(task.declaredPaths))
  const extraPathReasons = task.extraPathReasons ?? {}
  for (const changedPath of array(task.changedPaths)) {
    const reason = extraPathReasons[changedPath]
    if (!declaredPaths.has(changedPath) && !(typeof reason === 'string' && reason.trim())) {
      issues.push({ code: 'UNDECLARED_CHANGED_PATH', taskId, path: changedPath })
    }
  }

  const checkpoint = task?.checkpoint?.rootSha256
  if (!validSha256(checkpoint)) {
    issues.push({ code: 'TASK_CHECKPOINT_MISSING', taskId })
  }

  const atomStatuses = map(context?.atomStatuses)
  const requiredAtomBoundaries = map(task.requiredAtomBoundaries)
  for (const atomId of array(task.requiredAtomIds)) {
    const requiredStatus = requiredAtomBoundaries.get(atomId) ?? 'verified-local'
    const requiredRank = STATUS_RANK[requiredStatus] ?? STATUS_RANK['verified-local']
    if ((STATUS_RANK[atomStatuses.get(atomId)] ?? -1) < requiredRank) {
      issues.push({ code: 'TASK_ATOM_INCOMPLETE', taskId, atomId, status: atomStatuses.get(atomId) ?? null, requiredStatus })
    }
  }

  const evidence = array(task.evidence)
  if (validSha256(checkpoint)) {
    for (const row of evidence) {
      if (row?.checkpoint !== checkpoint) {
        issues.push({ code: 'TASK_EVIDENCE_CHECKPOINT_MISMATCH', taskId, type: row?.type ?? null })
      }
    }
  }

  if (task.requiresMysql) {
    const mysqlRows = evidence.filter((row) => row?.type === 'mysql')
    if (!mysqlRows.length) {
      issues.push({ code: 'REQUIRED_MYSQL_EVIDENCE_MISSING', taskId })
    } else if (mysqlRows.some((row) => row?.skipped === true)) {
      issues.push({ code: 'REQUIRED_MYSQL_SKIPPED', taskId })
    } else if (!mysqlRows.some((row) => evidencePasses(row, checkpoint))) {
      issues.push({ code: 'REQUIRED_MYSQL_FAILED', taskId })
    }
  }

  if (task.uiChanged) {
    const visualRows = evidence.filter((row) => row?.type === 'visual')
    for (const breakpoint of REQUIRED_VISUAL_BREAKPOINTS) {
      if (!visualRows.some((row) => (
        row?.manualReview?.breakpoint === breakpoint
        && evidencePasses(row, checkpoint)
      ))) {
        issues.push({ code: 'VISUAL_BREAKPOINT_MISSING', taskId, breakpoint })
      }
    }
    if (!visualRows.length || visualRows.some((row) => (
      row?.manualReview?.opened !== true
      || row?.manualReview?.conclusion !== 'pass'
      || !row?.manualReview?.reviewer
    ))) {
      issues.push({ code: 'MANUAL_VISUAL_REVIEW_MISSING', taskId })
    }
    if (!evidence.some((row) => (
      row?.subtype === 'keyboard'
      && ['a11y', 'e2e-local'].includes(row?.type)
      && evidencePasses(row, checkpoint)
    ))) {
      issues.push({ code: 'KEYBOARD_EVIDENCE_MISSING', taskId })
    }
    if (!evidence.some((row) => (
      row?.subtype === 'reduced-motion'
      && ['e2e-local', 'visual'].includes(row?.type)
      && evidencePasses(row, checkpoint)
    ))) {
      issues.push({ code: 'REDUCED_MOTION_EVIDENCE_MISSING', taskId })
    }
  }

  if (task.handoffRecorded !== true) {
    issues.push({ code: 'TASK_HANDOFF_MISSING', taskId })
  }
  return issues
}

export function validatePhaseClose(context, phaseId) {
  const issues = []
  const phases = array(context?.phases)
  const phase = phases.find((candidate) => candidate?.id === phaseId)
  if (!phase) return [{ code: 'PHASE_NOT_FOUND', phaseId }]
  const tasks = array(context?.tasks)
  const phaseTasks = array(phase.taskIds).map((taskId) => tasks.find((task) => task?.id === taskId))

  for (const [index, task] of phaseTasks.entries()) {
    const taskId = phase.taskIds[index]
    if (!task || task.currentState !== 'completed') {
      issues.push({ code: 'PHASE_TASK_INCOMPLETE', phaseId, taskId, state: task?.currentState ?? null })
    }
  }

  const checkpoints = new Set(phaseTasks
    .map((task) => task?.checkpoint?.rootSha256)
    .filter(validSha256))
  if (checkpoints.size !== 1 || phaseTasks.some((task) => !validSha256(task?.checkpoint?.rootSha256))) {
    issues.push({ code: 'PHASE_CHECKPOINT_MISMATCH', phaseId, checkpoints: [...checkpoints] })
  }

  const atomStatuses = map(context?.atomStatuses)
  const requiredAtomBoundaries = map(phase.requiredAtomBoundaries)
  for (const atomId of array(phase.requiredAtomIds)) {
    const status = atomStatuses.get(atomId)
    const requiredStatus = requiredAtomBoundaries.get(atomId) ?? phase.finalBoundary ?? 'verified-local'
    const requiredRank = STATUS_RANK[requiredStatus] ?? STATUS_RANK['verified-local']
    if ((STATUS_RANK[status] ?? -1) < requiredRank) {
      issues.push({
        code: 'PHASE_ATOM_INCOMPLETE',
        phaseId,
        atomId,
        status: status ?? null,
        requiredStatus,
      })
    }
  }

  const order = array(context?.phaseOrder)
  const currentIndex = order.indexOf(phaseId)
  for (const implementedTaskId of array(context?.implementedTaskIds)) {
    const implementedTask = tasks.find((task) => task?.id === implementedTaskId)
    const implementedIndex = order.indexOf(implementedTask?.phaseId)
    if (currentIndex >= 0 && implementedIndex > currentIndex) {
      issues.push({
        code: 'LATER_PHASE_IMPLEMENTED_EARLY',
        phaseId,
        taskId: implementedTaskId,
        laterPhaseId: implementedTask.phaseId,
      })
    }
  }
  return issues
}

const PHASE_ORDER = Object.freeze(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'])

function planTasks(planText, phaseId) {
  const text = String(planText ?? '')
  const matches = [...text.matchAll(/^###\s+(P\d+-T\d+):.*$/gmi)]
    .filter((match) => match[1].startsWith(`${phaseId}-`))
  return matches.map((match, index) => {
    const bodyStart = (match.index ?? 0) + match[0].length
    const bodyEnd = matches[index + 1]?.index ?? text.length
    const body = text.slice(bodyStart, bodyEnd)
    const checkboxes = [...body.matchAll(/^- \[([ x])\]/gmi)]
    const completed = checkboxes.length > 0
      && checkboxes.every((checkbox) => checkbox[1].toLowerCase() === 'x')
    return {
      id: match[1],
      phaseId,
      body,
      completed,
      implemented: checkboxes.some((checkbox) => checkbox[1].toLowerCase() === 'x'),
    }
  })
}

function closingParentIds(tasks) {
  const body = tasks.at(-1)?.body ?? ''
  const ids = new Set(body.match(/\b(?:[A-Z]+|LIFE)-\d{2}\b/g) ?? [])
  for (const match of body.matchAll(/\b([A-Z]+)-(\d{2})\s+(?:through|to|至)\s+(?:\1-)?(\d{2})\b/gi)) {
    const start = Number(match[2])
    const end = Number(match[3])
    for (let value = start; value <= end; value += 1) {
      ids.add(`${match[1].toUpperCase()}-${String(value).padStart(2, '0')}`)
    }
  }
  return ids
}

function phaseRequiredStatus(atom, phaseId) {
  const phaseIndex = PHASE_ORDER.indexOf(phaseId)
  const hasLaterTask = array(atom?.plannedTasks).some((taskId) => (
    PHASE_ORDER.indexOf(String(taskId).split('-')[0]) > phaseIndex
  ))
  const boundaries = array(atom?.finalBoundary)
  const hasLaterArtifactBoundary = phaseId !== 'P6' && boundaries.length > 1
  if (hasLaterTask || hasLaterArtifactBoundary) return 'partial'
  const boundary = phaseId === 'P6' ? boundaries.at(-1) : boundaries[0]
  return `verified-${boundary ?? 'local'}`
}

export function buildPhaseCloseContext({ phaseId, planTexts, matrix, checkpoint, atomStatuses }) {
  const tasksByPhase = new Map(PHASE_ORDER.map((candidatePhase) => [
    candidatePhase,
    planTasks(planTexts?.[candidatePhase], candidatePhase),
  ]))
  const phaseTasks = tasksByPhase.get(phaseId) ?? []
  const taskIds = phaseTasks.map((task) => task.id)
  const parentIds = closingParentIds(phaseTasks)
  const requiredAtoms = array(matrix?.atoms).filter((atom) => (
    parentIds.has(atom?.parentRequirementId)
    && array(atom.plannedTasks).some((taskId) => taskIds.includes(taskId))
  ))
  return {
    phaseOrder: [...PHASE_ORDER],
    phases: [{
      id: phaseId,
      taskIds,
      requiredAtomIds: requiredAtoms.map((atom) => atom.id),
      requiredAtomBoundaries: new Map(requiredAtoms.map((atom) => [
        atom.id,
        phaseRequiredStatus(atom, phaseId),
      ])),
      finalBoundary: 'verified-local',
    }],
    tasks: phaseTasks.map((task) => ({
      id: task.id,
      phaseId,
      currentState: task.completed ? 'completed' : 'pending',
      checkpoint: task.completed ? checkpoint : null,
    })),
    atomStatuses,
    implementedTaskIds: [...tasksByPhase.values()]
      .flat()
      .filter((task) => task.implemented)
      .map((task) => task.id),
  }
}

function stateDifferences(expected, actual, fields) {
  return fields.filter((field) => expected?.[field] !== actual?.[field]).map((field) => ({
    field,
    expected: expected?.[field] ?? null,
    actual: actual?.[field] ?? null,
  }))
}

function equalSets(left, right) {
  const a = [...new Set(array(left))].sort()
  const b = [...new Set(array(right))].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function normalizedRollupStatus(status) {
  if (status === 'in_progress' || status === 'api-complete/ui-pending') return 'partial'
  if (status === 'blocked') return 'invalidated'
  return status
}

export function validateHandoff(context) {
  const issues = []
  const execution = context?.execution ?? {}
  const plan = context?.planState ?? {}
  const nextActions = array(execution.nextActions).filter((value) => typeof value === 'string' && value.trim())
  if (nextActions.length !== 1) {
    issues.push({ code: 'HANDOFF_NEXT_ACTION_NOT_UNIQUE', nextActions })
  }
  const nextAction = nextActions.length === 1 ? nextActions[0] : null

  const planDifferences = stateDifferences(execution, plan, ['activePlan', 'activeTask', 'activeStep'])
  if (plan.nextAction !== nextAction) {
    planDifferences.push({ field: 'nextAction', expected: nextAction, actual: plan.nextAction ?? null })
  }
  if (planDifferences.length) {
    issues.push({ code: 'HANDOFF_PLAN_STATE_MISMATCH', differences: planDifferences })
  }
  if (!equalSets(execution.completedTaskIds, plan.completedTaskIds)) {
    issues.push({ code: 'HANDOFF_PLAN_CHECKBOX_MISMATCH' })
  }

  const requirementStatuses = map(context?.requirementStatuses)
  const parentStatuses = map(context?.parentStatuses)
  for (const parentId of PARENT_REQUIREMENT_IDS) {
    if (normalizedRollupStatus(requirementStatuses.get(parentId)) !== normalizedRollupStatus(parentStatuses.get(parentId))) {
      issues.push({
        code: 'HANDOFF_REQUIREMENT_STATUS_MISMATCH',
        parentId,
        expected: parentStatuses.get(parentId) ?? null,
        actual: requirementStatuses.get(parentId) ?? null,
      })
    }
  }

  const mirrorExpected = { ...execution, nextAction }
  const mirrorFields = [
    'authorityRevision',
    'status',
    'activePlan',
    'activeTask',
    'activeStep',
    'requirementsVerified',
    'nextAction',
  ]
  const currentDifferences = stateDifferences(mirrorExpected, context?.current, mirrorFields)
  if (currentDifferences.length) {
    issues.push({ code: 'HANDOFF_CURRENT_STATE_MISMATCH', differences: currentDifferences })
  }
  const sessionDifferences = stateDifferences(mirrorExpected, context?.session, mirrorFields)
  if (sessionDifferences.length) {
    issues.push({ code: 'HANDOFF_SESSION_STATE_MISMATCH', differences: sessionDifferences })
  }

  const normalizedPaths = new Set(array(context?.sessionPaths).map((value) => String(value).replaceAll('\\', '/').toLowerCase()))
  const nextSessionPath = typeof context?.nextSessionPath === 'string'
    ? context.nextSessionPath.replaceAll('\\', '/').toLowerCase()
    : null
  if (!nextSessionPath) {
    issues.push({ code: 'HANDOFF_NEXT_SESSION_PATH_MISSING' })
  } else if (normalizedPaths.has(nextSessionPath)) {
    issues.push({ code: 'HANDOFF_SESSION_PATH_REUSED', path: context.nextSessionPath })
  }
  return issues
}

function releaseComponentName(key) {
  return key === 'web' ? 'WEB' : 'API'
}

export function validateProjectClose(context) {
  const issues = []
  const parentStatuses = map(context?.parentStatuses)
  for (const parentId of PARENT_REQUIREMENT_IDS) {
    const status = parentStatuses.get(parentId)
    if ((STATUS_RANK[status] ?? -1) < STATUS_RANK['verified-local']) {
      issues.push({ code: 'PROJECT_REQUIREMENT_INCOMPLETE', parentId, status: status ?? null })
    }
  }
  for (const atom of array(context?.projectAtoms)) {
    const boundary = array(atom?.finalBoundary).at(-1)
    const requiredStatus = boundary ? `verified-${boundary}` : null
    if (!requiredStatus || (STATUS_RANK[atom?.status] ?? -1) < (STATUS_RANK[requiredStatus] ?? Infinity)) {
      issues.push({
        code: 'PROJECT_ATOM_BOUNDARY_INCOMPLETE',
        atomId: atom?.id ?? null,
        status: atom?.status ?? null,
        requiredStatus,
      })
    }
  }

  const revision = context?.finalRevision?.revision
  const validRevision = context?.finalRevision?.kind === 'git'
    && typeof revision === 'string'
    && /^[a-f0-9]{40,64}$/i.test(revision)
  if (!validRevision) {
    issues.push({ code: 'FORMAL_GIT_REVISION_MISSING' })
  }

  const gates = array(context?.finalGates)
  const gateCheckpoints = new Set(gates.map((gate) => gate?.checkpoint).filter(Boolean))
  for (const requiredType of REQUIRED_FINAL_GATES) {
    const row = gates.find((gate) => gate?.type === requiredType)
    if (!row || row.exitCode !== 0 || row.skipped === true) {
      issues.push({ code: 'FINAL_GATE_MISSING_OR_FAILED', type: requiredType })
    }
  }
  if (gateCheckpoints.size !== 1 || (validRevision && !gateCheckpoints.has(revision))) {
    issues.push({ code: 'FINAL_GATE_CHECKPOINT_MISMATCH', checkpoints: [...gateCheckpoints] })
  }

  const images = context?.images ?? {}
  for (const key of ['web', 'api']) {
    const image = images[key]
    const component = releaseComponentName(key)
    if (!validDigest(image?.digest)) {
      issues.push({ code: `${component}_IMAGE_DIGEST_MISSING`, component: key })
    }
    if (typeof image?.reference === 'string' && !image.reference.includes('@sha256:')) {
      issues.push({ code: 'MUTABLE_IMAGE_REFERENCE', component: key, reference: image.reference })
    }
  }

  const productionValues = context?.productionValues ?? {}
  const placeholderValues = [
    ...array(productionValues.placeholders),
    productionValues.revision,
    productionValues.webDigest,
    productionValues.apiDigest,
  ].filter((value) => typeof value === 'string')
  if (placeholderValues.some((value) => /\$\{|REPLACE_ME|CHANGE_ME|<[^>]+>|:latest\b/i.test(value))) {
    issues.push({ code: 'PRODUCTION_VALUES_PLACEHOLDER' })
  }
  if (productionValues.webDigest !== images.web?.digest || productionValues.apiDigest !== images.api?.digest) {
    issues.push({ code: 'PRODUCTION_VALUES_DIGEST_MISMATCH' })
  }
  if (validRevision && productionValues.revision !== revision) {
    issues.push({ code: 'PRODUCTION_VALUES_REVISION_MISMATCH' })
  }

  const smokeRows = array(context?.exactDigestSmoke)
  for (const key of ['web', 'api']) {
    const expectedDigest = images[key]?.digest
    if (!smokeRows.some((row) => (
      row?.component === key
      && validDigest(expectedDigest)
      && row.digest === expectedDigest
      && row.exitCode === 0
      && row.skipped === false
      && (!validRevision || row.checkpoint === revision)
    ))) {
      issues.push({ code: 'EXACT_DIGEST_SMOKE_MISSING', component: key })
    }
  }

  for (const key of ['web', 'api']) {
    const expectedDigest = images[key]?.digest
    const supplyChain = context?.supplyChain?.[key]
    if (supplyChain?.sbom?.verified !== true || supplyChain?.sbom?.digest !== expectedDigest) {
      issues.push({ code: 'SBOM_MISSING', component: key })
    }
    if (supplyChain?.provenance?.verified !== true || supplyChain?.provenance?.digest !== expectedDigest) {
      issues.push({ code: 'PROVENANCE_MISSING', component: key })
    }
    if (!array(context?.registryInspect).some((row) => (
      row?.component === key
      && row?.digest === expectedDigest
      && row?.exitCode === 0
    ))) {
      issues.push({ code: 'REGISTRY_INSPECT_FAILED', component: key })
    }
  }

  const deliveryPackage = context?.deliveryPackage ?? {}
  for (const requiredField of ['helm', 'gitops', 'argoExample', ...REQUIRED_DELIVERY_DOCUMENTS]) {
    if (deliveryPackage[requiredField] !== true) {
      issues.push({ code: 'DELIVERY_DOCUMENT_MISSING', document: requiredField })
    }
  }
  if (context?.runtimeTruth?.knownSinglePointsRecorded !== true) {
    issues.push({ code: 'KNOWN_SINGLE_POINTS_NOT_RECORDED' })
  }
  if (context?.runtimeTruth?.disconnectedPlatformsRecorded !== true) {
    issues.push({ code: 'DISCONNECTED_PLATFORM_STATE_NOT_RECORDED' })
  }
  return issues
}
