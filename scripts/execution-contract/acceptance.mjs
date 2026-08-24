import { PARENT_REQUIREMENT_IDS } from './constants.mjs'

export const VALID_DIMENSIONS = Object.freeze([
  'LAYOUT',
  'FUNC',
  'DATA',
  'CALC',
  'TXN',
  'STATE',
  'NAV',
  'RESP',
  'A11Y',
  'MOTION',
  'SEC',
  'OPS',
])

export const MINIMUM_VISIBLE_DIMENSIONS = Object.freeze([
  'LAYOUT',
  'FUNC',
  'DATA',
  'STATE',
  'NAV',
  'RESP',
  'A11Y',
  'MOTION',
])

export const VALID_EVIDENCE_TYPES = Object.freeze([
  'unit',
  'api',
  'mysql',
  'e2e-local',
  'e2e-remote',
  'visual',
  'a11y',
  'build',
  'security',
  'image',
  'registry',
  'delivery-package',
  'manual-review',
])

const PUBLIC_DIMENSIONS = Object.freeze([...MINIMUM_VISIBLE_DIMENSIONS, 'SEC'])
const PRIVATE_DIMENSIONS = Object.freeze([...MINIMUM_VISIBLE_DIMENSIONS, 'SEC'])
const WRITE_DIMENSIONS = Object.freeze([...MINIMUM_VISIBLE_DIMENSIONS, 'CALC', 'TXN', 'SEC'])
const PLATFORM_DIMENSIONS = Object.freeze([...MINIMUM_VISIBLE_DIMENSIONS, 'SEC', 'OPS'])
const FLOW_DIMENSIONS = Object.freeze(['FUNC', 'DATA', 'STATE', 'NAV', 'A11Y', 'MOTION', 'SEC'])
const TRANSACTION_DIMENSIONS = Object.freeze(['FUNC', 'DATA', 'CALC', 'TXN', 'STATE', 'SEC'])

function requiredSurface(id, kind, surfacePath, parentRequirementIds, requiredDimensions) {
  return Object.freeze({
    id,
    kind,
    path: surfacePath,
    parentRequirementIds: Object.freeze([...parentRequirementIds]),
    requiredDimensions: Object.freeze([...requiredDimensions]),
  })
}

function lifeVisibleParents(...parentRequirementIds) {
  return [...new Set([...parentRequirementIds, 'STATE-01', 'LIFE-22', 'LIFE-23', 'LIFE-24'])]
}

function lifeTransactionParents(...parentRequirementIds) {
  return [...new Set([...parentRequirementIds, 'LIFE-22', 'LIFE-24'])]
}

export const REQUIRED_SURFACES = Object.freeze([
  requiredSurface('PUBLIC_HOME', 'route', '/', ['PUB-01', 'MOTION-01', 'SPACE-01', 'STATE-01'], PUBLIC_DIMENSIONS),
  requiredSurface('PUBLIC_NOW', 'route', '/now', ['PUB-02', 'PUBLISH-01', 'MOTION-01', 'STATE-01'], PUBLIC_DIMENSIONS),
  requiredSurface('PUBLIC_DOING', 'route', '/doing', ['PUB-02', 'PUBLISH-01', 'MOTION-01', 'STATE-01'], PUBLIC_DIMENSIONS),
  requiredSurface('PUBLIC_LEARNING', 'route', '/learning', ['PUB-02', 'PUBLISH-01', 'MOTION-01', 'STATE-01'], PUBLIC_DIMENSIONS),
  requiredSurface('PUBLIC_MOMENTS', 'route', '/moments', ['PUB-02', 'PUBLISH-01', 'MOTION-01', 'STATE-01'], PUBLIC_DIMENSIONS),
  requiredSurface('PUBLIC_ARCHIVE', 'route', '/archive', ['PUB-02', 'PUBLISH-01', 'MOTION-01', 'STATE-01'], PUBLIC_DIMENSIONS),
  requiredSurface('LOGIN_OVERLAY', 'overlay', 'overlay:login', ['AUTH-01', 'MOTION-01', 'STATE-01', 'SEC-01'], PUBLIC_DIMENSIONS),
  requiredSurface('PUBLIC_NAVIGATION_FLOW', 'flow', 'flow:public-navigation-return', ['PUB-02', 'AUTH-01', 'MOTION-01', 'STATE-01'], FLOW_DIMENSIONS),

  requiredSurface('PRIVATE_SHELL', 'shell', 'shell:/app', ['APP-01', 'GLOBAL-01', 'MOTION-01', 'SPACE-01', 'STATE-01'], PRIVATE_DIMENSIONS),
  requiredSurface('PRIVATE_OVERVIEW', 'route', '/app/overview', ['APP-01', 'LIFE-01', 'STATE-01'], PRIVATE_DIMENSIONS),
  requiredSurface('GLOBAL_SEARCH_OVERLAY', 'overlay', 'overlay:global-search', ['GLOBAL-01', 'LIFE-21', 'STATE-01'], PRIVATE_DIMENSIONS),
  requiredSurface('QUICK_CREATE_OVERLAY', 'overlay', 'overlay:quick-create', ['GLOBAL-01', 'LIFE-21', 'STATE-01'], WRITE_DIMENSIONS),
  requiredSurface('GLOBAL_RETURN_FLOW', 'flow', 'flow:cross-page-return', ['GLOBAL-01', 'MOTION-01', 'STATE-01'], FLOW_DIMENSIONS),

  requiredSurface('GOALS_ROUTE', 'route', '/app/goals', ['GOAL-01', 'STATE-01'], WRITE_DIMENSIONS),
  requiredSurface('SCHEDULE_ROUTE', 'route', '/app/schedule', ['SCHEDULE-01', 'STATE-01'], WRITE_DIMENSIONS),
  requiredSurface('HABITS_ROUTE', 'route', '/app/habits', ['HABIT-01', 'STATE-01'], WRITE_DIMENSIONS),
  requiredSurface('RECORDS_ROUTE', 'route', '/app/records', ['RECORD-01', 'STATE-01', 'SEC-01'], WRITE_DIMENSIONS),
  requiredSurface('REVIEWS_ROUTE', 'route', '/app/reviews', ['REVIEW-01', 'STATE-01'], WRITE_DIMENSIONS),
  requiredSurface('KNOWLEDGE_ROUTE', 'route', '/app/knowledge', ['KNOW-01', 'OBS-01', 'STATE-01'], WRITE_DIMENSIONS),
  requiredSurface('PUBLISH_ROUTE', 'route', '/app/publish', ['PUBLISH-01', 'STATE-01', 'SEC-01'], WRITE_DIMENSIONS),
  requiredSurface('SETTINGS_ROUTE', 'route', '/app/settings', ['GLOBAL-01', 'LIFE-19', 'STATE-01', 'SEC-01'], WRITE_DIMENSIONS),

  requiredSurface('LIFE_TODAY_ROUTE', 'route', '/app/life', lifeVisibleParents('LIFE-01', 'LIFE-02', 'LIFE-15'), WRITE_DIMENSIONS),
  requiredSurface('LIFE_CALENDAR_OVERLAY', 'overlay', 'overlay:life-calendar', lifeVisibleParents('LIFE-02', 'LIFE-09'), WRITE_DIMENSIONS),
  requiredSurface('LIFE_CALENDAR_ROUTE', 'route', '/app/life/calendar', lifeVisibleParents('LIFE-02', 'LIFE-09'), WRITE_DIMENSIONS),
  requiredSurface('LIFE_PLANS_ROUTE', 'route', '/app/life/plans', lifeVisibleParents('LIFE-09', 'LIFE-10'), WRITE_DIMENSIONS),
  requiredSurface('LIFE_INGREDIENTS_ROUTE', 'route', '/app/life/ingredients', lifeVisibleParents('LIFE-03', 'LIFE-05', 'LIFE-06', 'LIFE-11', 'LIFE-17', 'LIFE-18'), WRITE_DIMENSIONS),
  requiredSurface('LIFE_RECIPES_ROUTE', 'route', '/app/life/recipes', lifeVisibleParents('LIFE-07', 'LIFE-08', 'LIFE-12'), WRITE_DIMENSIONS),
  requiredSurface('LIFE_MEDICINES_ROUTE', 'route', '/app/life/medicines', lifeVisibleParents('LIFE-04', 'LIFE-10'), WRITE_DIMENSIONS),
  requiredSurface('LIFE_FITNESS_ROUTE', 'route', '/app/life/fitness', lifeVisibleParents('LIFE-10', 'LIFE-16'), WRITE_DIMENSIONS),
  requiredSurface('LIFE_HOUSEHOLD_ROUTE', 'route', '/app/life/household', lifeVisibleParents('LIFE-13', 'LIFE-17', 'LIFE-18'), WRITE_DIMENSIONS),
  requiredSurface('LIFE_SHOPPING_ROUTE', 'route', '/app/life/shopping', lifeVisibleParents('LIFE-14', 'LIFE-15'), WRITE_DIMENSIONS),
  requiredSurface('LIFE_ANALYTICS_ROUTE', 'route', '/app/life/analytics', lifeVisibleParents('LIFE-15', 'LIFE-16'), WRITE_DIMENSIONS),
  requiredSurface('LIFE_DATA_ROUTE', 'route', '/app/life/data', lifeVisibleParents('LIFE-17', 'LIFE-18', 'LIFE-19', 'LIFE-20'), WRITE_DIMENSIONS),

  requiredSurface('PLATFORM_OVERVIEW', 'platform-subtab', '/app/platform', ['PLATFORM-01', 'STATE-01', 'SEC-01'], PLATFORM_DIMENSIONS),
  requiredSurface('PLATFORM_KUBERNETES', 'platform-subtab', '/app/platform/kubernetes', ['PLATFORM-01', 'STATE-01', 'SEC-01'], PLATFORM_DIMENSIONS),
  requiredSurface('PLATFORM_MONITORING', 'platform-subtab', '/app/platform/monitoring', ['PLATFORM-01', 'STATE-01'], PLATFORM_DIMENSIONS),
  requiredSurface('PLATFORM_ALERTS', 'platform-subtab', '/app/platform/alerts', ['PLATFORM-01', 'STATE-01'], PLATFORM_DIMENSIONS),
  requiredSurface('PLATFORM_LOGS', 'platform-subtab', '/app/platform/logs', ['PLATFORM-01', 'STATE-01', 'SEC-01'], PLATFORM_DIMENSIONS),
  requiredSurface('PLATFORM_RELEASES', 'platform-subtab', '/app/platform/releases', ['PLATFORM-01', 'DELIVERY-01', 'STATE-01'], PLATFORM_DIMENSIONS),
  requiredSurface('PLATFORM_TECHNOLOGY', 'platform-subtab', '/app/platform/technology', ['PLATFORM-01', 'STATE-01'], PLATFORM_DIMENSIONS),

  requiredSurface('TX_MASTER_DATA_RECALCULATION', 'transaction', 'transaction:master-data-recalculation', lifeTransactionParents('LIFE-03', 'LIFE-06', 'LIFE-07', 'LIFE-09', 'LIFE-11'), TRANSACTION_DIMENSIONS),
  requiredSurface('TX_MEAL_COMPLETION', 'transaction', 'transaction:meal-completion', lifeTransactionParents('LIFE-06', 'LIFE-11', 'LIFE-15', 'LIFE-16'), TRANSACTION_DIMENSIONS),
  requiredSurface('TX_MEAL_REVERSAL', 'transaction', 'transaction:meal-reversal', lifeTransactionParents('LIFE-11', 'LIFE-15'), TRANSACTION_DIMENSIONS),
  requiredSurface('TX_MEDICINE_OCCURRENCE', 'transaction', 'transaction:medicine-occurrence', lifeTransactionParents('LIFE-04', 'LIFE-10', 'LIFE-11'), TRANSACTION_DIMENSIONS),
  requiredSurface('TX_PREPARED_FOOD', 'transaction', 'transaction:prepared-food', lifeTransactionParents('LIFE-07', 'LIFE-11', 'LIFE-12'), TRANSACTION_DIMENSIONS),
  requiredSurface('TX_SHOPPING_RECALCULATION', 'transaction', 'transaction:shopping-recalculation', lifeTransactionParents('LIFE-05', 'LIFE-11', 'LIFE-14'), TRANSACTION_DIMENSIONS),
  requiredSurface('TX_PURCHASE', 'transaction', 'transaction:purchase', lifeTransactionParents('LIFE-11', 'LIFE-14', 'LIFE-15'), TRANSACTION_DIMENSIONS),
  requiredSurface('TX_RETURN_REFUND', 'transaction', 'transaction:return-refund', lifeTransactionParents('LIFE-11', 'LIFE-14', 'LIFE-15'), TRANSACTION_DIMENSIONS),
  requiredSurface('TX_TEMPLATE_SYNC_COPY', 'transaction', 'transaction:template-sync-copy', lifeTransactionParents('LIFE-02', 'LIFE-09', 'LIFE-10'), TRANSACTION_DIMENSIONS),
  requiredSurface('TX_TRASH_IMPORT_OBSIDIAN', 'transaction', 'transaction:trash-import-obsidian', lifeTransactionParents('LIFE-18', 'LIFE-19', 'LIFE-20'), TRANSACTION_DIMENSIONS),
  requiredSurface('TX_PUBLISH_VERSION_REVOKE', 'transaction', 'transaction:publish-version-revoke', ['PUBLISH-01', 'SEC-01'], TRANSACTION_DIMENSIONS),
  requiredSurface('TX_IMAGE_REGISTRY_HANDOFF', 'transaction', 'transaction:image-registry-handoff', ['DELIVERY-01', 'SEC-01'], TRANSACTION_DIMENSIONS),
])

const VISIBLE_SURFACE_KINDS = new Set(['route', 'overlay', 'shell', 'platform-subtab'])
const VALID_SURFACE_KINDS = new Set([...VISIBLE_SURFACE_KINDS, 'flow', 'transaction'])
const UNIVERSAL_NON_APPLICABLE_DENYLIST = new Set(['NAV', 'RESP', 'A11Y', 'MOTION'])
const VALID_DIMENSION_SET = new Set(VALID_DIMENSIONS)
const VALID_EVIDENCE_SET = new Set(VALID_EVIDENCE_TYPES)
const PARENT_REQUIREMENT_SET = new Set(PARENT_REQUIREMENT_IDS)
const BOUNDARY_ORDER = new Map([['local', 0], ['image', 1], ['registry', 2]])
const TASK_LIMITS = new Map([['P1', 13], ['P2', 6], ['P3', 14], ['P4', 8], ['P5', 8], ['P6', 8]])
const ATOM_ID = /^([A-Z]+-\d{2})\.([A-Z0-9_-]+)\.([A-Z0-9]+)\.(\d{2})$/

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
    : []
}

function isKnownTask(taskId) {
  if (typeof taskId !== 'string') {
    return false
  }
  const match = taskId.match(/^(P[1-6])-T(\d+)$/)
  return Boolean(match) && Number(match[2]) >= 1 && Number(match[2]) <= TASK_LIMITS.get(match[1])
}

function isValidBoundary(boundary) {
  if (!Array.isArray(boundary) || boundary.length === 0 || boundary[0] !== 'local') {
    return false
  }
  const indexes = boundary.map((entry) => BOUNDARY_ORDER.get(entry))
  return indexes.every((index) => index !== undefined)
    && new Set(boundary).size === boundary.length
    && indexes.every((index, position) => position === 0 || index > indexes[position - 1])
}

function duplicateValues(values) {
  const counts = new Map()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts].filter(([, count]) => count > 1)
}

export function validateAcceptanceMatrix(matrix, sourceRegistry) {
  const issues = []
  const parentRequirementIds = stringArray(matrix?.parentRequirementIds)
  const surfaces = Array.isArray(matrix?.surfaces) ? matrix.surfaces : []
  const atoms = Array.isArray(matrix?.atoms) ? matrix.atoms : []
  const sourceClauses = Array.isArray(sourceRegistry?.clauses) ? sourceRegistry.clauses : []
  const sourceClauseIds = new Set(sourceClauses.map((clause) => clause?.id).filter(Boolean))

  if (matrix?.schemaVersion !== 1) {
    issues.push({ code: 'INVALID_ACCEPTANCE_SCHEMA', expected: 1, actual: matrix?.schemaVersion ?? null })
  }
  if (
    parentRequirementIds.length !== PARENT_REQUIREMENT_IDS.length
    || new Set(parentRequirementIds).size !== PARENT_REQUIREMENT_IDS.length
    || PARENT_REQUIREMENT_IDS.some((id) => !parentRequirementIds.includes(id))
  ) {
    issues.push({
      code: 'PARENT_REQUIREMENT_SET_MISMATCH',
      expected: [...PARENT_REQUIREMENT_IDS],
      actual: parentRequirementIds,
    })
  }

  const surfaceIds = surfaces.map((surface) => surface?.id).filter(Boolean)
  for (const [id, count] of duplicateValues(surfaceIds)) {
    issues.push({ code: 'DUPLICATE_SURFACE_ID', id, count })
  }
  const knownSurfaces = new Map()
  for (const surface of surfaces) {
    if (typeof surface?.id !== 'string' || !surface.id.trim()) {
      issues.push({ code: 'INVALID_SURFACE_ID', id: surface?.id ?? null })
      continue
    }
    if (!knownSurfaces.has(surface.id)) {
      knownSurfaces.set(surface.id, surface)
    }
    if (!VALID_SURFACE_KINDS.has(surface.kind)) {
      issues.push({ code: 'INVALID_SURFACE_KIND', id: surface.id, kind: surface.kind ?? null })
    }
    if (typeof surface.path !== 'string' || !surface.path.trim()) {
      issues.push({ code: 'INVALID_SURFACE_PATH', id: surface.id })
    }

    const surfaceParents = stringArray(surface.parentRequirementIds)
    if (surfaceParents.length === 0 || surfaceParents.some((id) => !PARENT_REQUIREMENT_SET.has(id))) {
      issues.push({ code: 'INVALID_SURFACE_PARENT', id: surface.id, parentRequirementIds: surfaceParents })
    }
    const dimensions = stringArray(surface.requiredDimensions)
    if (
      dimensions.length === 0
      || new Set(dimensions).size !== dimensions.length
      || dimensions.some((dimension) => !VALID_DIMENSION_SET.has(dimension))
    ) {
      issues.push({ code: 'INVALID_SURFACE_DIMENSIONS', id: surface.id, requiredDimensions: dimensions })
    }
    if (VISIBLE_SURFACE_KINDS.has(surface.kind)) {
      for (const dimension of MINIMUM_VISIBLE_DIMENSIONS) {
        if (!dimensions.includes(dimension)) {
          issues.push({
            code: 'SURFACE_DIMENSION_MISSING',
            surface: surface.path,
            surfaceId: surface.id,
            dimension,
          })
        }
      }
    }
  }

  for (const requiredSurface of REQUIRED_SURFACES) {
    const actualSurface = knownSurfaces.get(requiredSurface.id)
    if (!actualSurface) {
      issues.push({
        code: 'REQUIRED_SURFACE_MISSING',
        surfaceId: requiredSurface.id,
        path: requiredSurface.path,
      })
      continue
    }

    for (const field of ['kind', 'path', 'parentRequirementIds', 'requiredDimensions']) {
      const expected = requiredSurface[field]
      const actual = actualSurface[field]
      const matches = Array.isArray(expected)
        ? Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected)
        : actual === expected
      if (!matches) {
        issues.push({
          code: 'REQUIRED_SURFACE_DEFINITION_MISMATCH',
          surfaceId: requiredSurface.id,
          field,
          expected,
          actual: actual ?? null,
        })
      }
    }
  }

  const atomIds = atoms.map((atom) => atom?.id).filter(Boolean)
  for (const [id, count] of duplicateValues(atomIds)) {
    issues.push({ code: 'DUPLICATE_ATOM_ID', id, count })
  }

  for (const atom of atoms) {
    const idMatch = typeof atom?.id === 'string' ? atom.id.match(ATOM_ID) : null
    if (!idMatch || !VALID_DIMENSION_SET.has(idMatch[3])) {
      issues.push({ code: 'INVALID_ATOM_ID', id: atom?.id ?? null })
    }
    if (!PARENT_REQUIREMENT_SET.has(atom?.parentRequirementId)) {
      issues.push({
        code: 'UNKNOWN_PARENT_REQUIREMENT',
        id: atom?.id ?? null,
        parentRequirementId: atom?.parentRequirementId ?? null,
      })
    } else if (idMatch && idMatch[1] !== atom.parentRequirementId) {
      issues.push({
        code: 'ATOM_ID_PARENT_MISMATCH',
        id: atom.id,
        parentRequirementId: atom.parentRequirementId,
      })
    }
    if (typeof atom?.title !== 'string' || !atom.title.trim()) {
      issues.push({ code: 'INVALID_ATOM_TITLE', id: atom?.id ?? null })
    }
    if (typeof atom?.contract !== 'string' || !atom.contract.trim()) {
      issues.push({ code: 'INVALID_ATOM_CONTRACT', id: atom?.id ?? null })
    }

    const atomSources = stringArray(atom?.sourceClauseIds)
    if (atomSources.length === 0) {
      issues.push({ code: 'ATOM_WITHOUT_SOURCE_CLAUSE', id: atom?.id ?? null })
    }
    for (const sourceClauseId of atomSources) {
      if (!sourceClauseIds.has(sourceClauseId)) {
        issues.push({ code: 'UNKNOWN_SOURCE_CLAUSE', id: atom?.id ?? null, sourceClauseId })
      }
    }

    const atomSurfaces = stringArray(atom?.surfaces)
    if (atomSurfaces.length === 0) {
      issues.push({ code: 'ATOM_WITHOUT_SURFACE', id: atom?.id ?? null })
    }
    for (const surfaceId of atomSurfaces) {
      if (!knownSurfaces.has(surfaceId)) {
        issues.push({ code: 'UNKNOWN_ATOM_SURFACE', id: atom?.id ?? null, surfaceId })
      }
    }

    const plannedTasks = stringArray(atom?.plannedTasks)
    if (plannedTasks.length === 0) {
      issues.push({ code: 'ATOM_WITHOUT_PLANNED_TASK', id: atom?.id ?? null })
    }
    for (const taskId of plannedTasks) {
      if (!isKnownTask(taskId)) {
        issues.push({ code: 'UNKNOWN_PLANNED_TASK', id: atom?.id ?? null, taskId })
      }
    }

    const evidenceTypes = stringArray(atom?.requiredEvidence)
    if (evidenceTypes.length === 0) {
      issues.push({ code: 'ATOM_WITHOUT_EVIDENCE', id: atom?.id ?? null })
    }
    for (const evidenceType of evidenceTypes) {
      if (!VALID_EVIDENCE_SET.has(evidenceType)) {
        issues.push({ code: 'UNKNOWN_EVIDENCE_TYPE', id: atom?.id ?? null, evidenceType })
      }
    }
    if (!isValidBoundary(atom?.finalBoundary)) {
      issues.push({ code: 'INVALID_FINAL_BOUNDARY', id: atom?.id ?? null, finalBoundary: atom?.finalBoundary ?? null })
    }

    if (atom?.notApplicable != null) {
      const approvedSourceClauseId = atom.notApplicable?.approvedSourceClauseId
      if (
        typeof atom.notApplicable?.reason !== 'string'
        || !atom.notApplicable.reason.trim()
        || typeof approvedSourceClauseId !== 'string'
        || !sourceClauseIds.has(approvedSourceClauseId)
      ) {
        issues.push({ code: 'INVALID_NOT_APPLICABLE', id: atom?.id ?? null })
      }
      const atomDimension = idMatch?.[3]
      const hasVisibleSurface = atomSurfaces.some((surfaceId) => (
        VISIBLE_SURFACE_KINDS.has(knownSurfaces.get(surfaceId)?.kind)
      ))
      if (hasVisibleSurface && UNIVERSAL_NON_APPLICABLE_DENYLIST.has(atomDimension)) {
        issues.push({
          code: 'UNIVERSAL_VISIBLE_DIMENSION_NOT_APPLICABLE',
          id: atom?.id ?? null,
          dimension: atomDimension,
        })
      }
    }
  }

  return issues
}
