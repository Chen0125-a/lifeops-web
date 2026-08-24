import { PARENT_REQUIREMENT_IDS } from './constants.mjs'
import { REQUIRED_SURFACES, validateAcceptanceMatrix } from './acceptance.mjs'

export const LIFE_PARENT_REQUIREMENT_IDS = Object.freeze(PARENT_REQUIREMENT_IDS.slice(20))
const LIFE_PARENT_SET = new Set(LIFE_PARENT_REQUIREMENT_IDS)
export const LIFE_SURFACE_IDS = Object.freeze(REQUIRED_SURFACES
  .filter((surface) => surface.parentRequirementIds.some((parentId) => LIFE_PARENT_SET.has(parentId)))
  .map((surface) => surface.id))
const LIFE_SURFACE_SET = new Set(LIFE_SURFACE_IDS)
export const LIFE_TRANSACTION_SURFACE_IDS = Object.freeze(LIFE_SURFACE_IDS
  .filter((surfaceId) => surfaceId.startsWith('TX_')))

const SURFACE_LABELS = Object.freeze({
  PRIVATE_OVERVIEW: 'private overview life summary',
  GLOBAL_SEARCH_OVERLAY: 'global life search overlay',
  QUICK_CREATE_OVERLAY: 'global life quick-create overlay',
  SETTINGS_ROUTE: 'life data-management settings',
  LIFE_TODAY_ROUTE: 'life today command surface',
  LIFE_CALENDAR_OVERLAY: 'life corner calendar overlay',
  LIFE_CALENDAR_ROUTE: 'life calendar workspace',
  LIFE_PLANS_ROUTE: 'life plans and templates workspace',
  LIFE_INGREDIENTS_ROUTE: 'ingredients, supplements and inventory workspace',
  LIFE_RECIPES_ROUTE: 'recipes and prepared-food workspace',
  LIFE_MEDICINES_ROUTE: 'medicine facts and schedule workspace',
  LIFE_FITNESS_ROUTE: 'fitness plans and completion workspace',
  LIFE_HOUSEHOLD_ROUTE: 'household inventory workspace',
  LIFE_SHOPPING_ROUTE: 'shopping, receiving and refund workspace',
  LIFE_ANALYTICS_ROUTE: 'life nutrition, cost and budget analytics',
  LIFE_DATA_ROUTE: 'life taxonomy, trash, import and Obsidian workspace',
  TX_MASTER_DATA_RECALCULATION: 'master-data recalculation transaction',
  TX_MEAL_COMPLETION: 'meal completion transaction',
  TX_MEAL_REVERSAL: 'meal reversal transaction',
  TX_MEDICINE_OCCURRENCE: 'medicine recurrence occurrence transaction',
  TX_PREPARED_FOOD: 'prepared-food transaction',
  TX_SHOPPING_RECALCULATION: 'shopping recalculation transaction',
  TX_PURCHASE: 'purchase and partial-receipt transaction',
  TX_RETURN_REFUND: 'return and refund transaction',
  TX_TEMPLATE_SYNC_COPY: 'template apply, sync and date-copy transaction',
  TX_TRASH_IMPORT_OBSIDIAN: 'trash, import and Obsidian transaction',
})

const FEATURE_CONTRACTS = Object.freeze({
  PRIVATE_OVERVIEW: 'shows a bounded server-backed today-life summary without duplicating life-domain source data',
  GLOBAL_SEARCH_OVERLAY: 'finds only authorized life entities and returns users to the exact prior route, selection and focus',
  QUICK_CREATE_OVERLAY: 'creates supported life entities through real APIs with validation, idempotency and server-confirmed feedback',
  SETTINGS_ROUTE: 'exports, previews imports, creates restore points and performs confirmed life-data management without hidden writes',
  LIFE_TODAY_ROUTE: 'connects the selected date to meals, medicines, training, household work, completion, inventory, nutrition, cost and shopping facts',
  LIFE_CALENDAR_OVERLAY: 'shows plan and completion truth for nearby dates and opens the selected day without losing the underlying context',
  LIFE_CALENDAR_ROUTE: 'supports date navigation, plan state, completion state and direct return to the selected life day',
  LIFE_PLANS_ROUTE: 'supports templates, independent date plans, deliberate future sync, date copy and conflict-safe editing',
  LIFE_INGREDIENTS_ROUTE: 'supports effective catalog facts, units, conversions, nutrition, prices, batches, stock, taxonomy and bidirectional usage',
  LIFE_RECIPES_ROUTE: 'supports versioned ingredients, steps, yields, nutrition, cost, cooking history, prepared food and bidirectional catalog relations',
  LIFE_MEDICINES_ROUTE: 'records only user-authored medicine facts, stock, expiry, schedules and history without medical advice',
  LIFE_FITNESS_ROUTE: 'supports training plans, exercises, equipment, quantitative completion snapshots and historical analysis',
  LIFE_HOUSEHOLD_ROUTE: 'supports household items, locations, batches, stock, low-stock rules, consumption and shopping closure',
  LIFE_SHOPPING_ROUTE: 'closes plan gaps and low stock through editable shopping, partial receipt, purchase, return and refund flows',
  LIFE_ANALYTICS_ROUTE: 'derives traceable nutrition, cash expenditure, consumption cost, stock and budget summaries without double counting',
  LIFE_DATA_ROUTE: 'supports taxonomy, soft delete, reference-safe restore/permanent delete, import preview/rollback and controlled Obsidian projection',
  TX_MASTER_DATA_RECALCULATION: 'recalculates only future or uncompleted plans from current effective master data while completed history remains snapshot-based',
  TX_MEAL_COMPLETION: 'atomically records the actual meal snapshot, inventory ledger effects, nutrition and consumption cost exactly once',
  TX_MEAL_REVERSAL: 'reverses a completed meal with linked compensating events rather than deleting historical evidence',
  TX_MEDICINE_OCCURRENCE: 'persists and reconciles bounded medicine occurrences and completes or reverses one discriminated occurrence source without rewriting history',
  TX_PREPARED_FOOD: 'converts ingredient consumption into versioned prepared-food yield, stock and later consumption without losing traceability',
  TX_SHOPPING_RECALCULATION: 'derives owner shopping shortages from one through-date plan, inventory, policy and formal-shopping snapshot and atomically replaces only system suggestions',
  TX_PURCHASE: 'records ordered and received quantities, batches, stock, price and cash expenditure through idempotent partial receipt',
  TX_RETURN_REFUND: 'records returned quantities, inventory effects and refunds as linked compensating events without rewriting the purchase',
  TX_TEMPLATE_SYNC_COPY: 'keeps template apply, deliberate future sync and date copy as three distinct operations that never copy actuals or ledger events',
  TX_TRASH_IMPORT_OBSIDIAN: 'keeps delete/restore, import and controlled Obsidian projection previewable, reference-safe, atomic and recoverable',
})

const TASKS_BY_PARENT = Object.freeze({
  'LIFE-01': ['P3-T8', 'P3-T13'],
  'LIFE-02': ['P1-T11', 'P3-T8', 'P3-T13'],
  'LIFE-03': ['P1-T8', 'P3-T9'],
  'LIFE-04': ['P1-T8', 'P1-T11', 'P3-T9', 'P3-T11'],
  'LIFE-05': ['P1-T8', 'P3-T9'],
  'LIFE-06': ['P1-T8', 'P1-T10', 'P1-T11', 'P3-T9'],
  'LIFE-07': ['P1-T10', 'P3-T10'],
  'LIFE-08': ['P1-T10', 'P3-T10'],
  'LIFE-09': ['P1-T11', 'P3-T11'],
  'LIFE-10': ['P1-T11', 'P3-T11'],
  'LIFE-11': ['P1-T9', 'P1-T11', 'P1-T12', 'P3-T11'],
  'LIFE-12': ['P1-T10', 'P3-T10'],
  'LIFE-13': ['P1-T8', 'P3-T9'],
  'LIFE-14': ['P1-T12', 'P3-T12'],
  'LIFE-15': ['P1-T12', 'P3-T8', 'P3-T12'],
  'LIFE-16': ['P1-T12', 'P3-T12'],
  'LIFE-17': ['P1-T8', 'P3-T9'],
  'LIFE-18': ['P1-T8', 'P3-T9'],
  'LIFE-19': ['P1-T12', 'P3-T12', 'P5-T6'],
  'LIFE-20': ['P4-T7', 'P4-T8'],
  'LIFE-21': ['P3-T13', 'P5-T4', 'P5-T5'],
  'LIFE-22': ['P1-T9', 'P1-T10', 'P1-T11', 'P1-T12', 'P3-T13', 'P5-T6'],
  'LIFE-23': ['P3-T8', 'P3-T9', 'P3-T10', 'P3-T11', 'P3-T12', 'P3-T13', 'P6-T5'],
  'LIFE-24': ['P1-T8', 'P3-T9', 'P3-T13', 'P6-T2'],
})

const TASK_PARENT_MAP = new Map()
for (const [parentId, tasks] of Object.entries(TASKS_BY_PARENT)) {
  for (const taskId of tasks) {
    const parents = TASK_PARENT_MAP.get(taskId) ?? []
    parents.push(parentId)
    TASK_PARENT_MAP.set(taskId, parents)
  }
}

const EVIDENCE_BY_DIMENSION = Object.freeze({
  LAYOUT: ['unit', 'e2e-local', 'visual', 'manual-review'],
  FUNC: ['unit', 'api', 'e2e-local'],
  DATA: ['unit', 'api', 'mysql'],
  CALC: ['unit', 'api', 'mysql', 'e2e-local'],
  TXN: ['api', 'mysql', 'e2e-local'],
  STATE: ['unit', 'api', 'e2e-local'],
  NAV: ['unit', 'e2e-local'],
  RESP: ['e2e-local', 'visual', 'manual-review'],
  A11Y: ['unit', 'e2e-local', 'a11y', 'manual-review'],
  MOTION: ['unit', 'e2e-local', 'visual', 'manual-review'],
  SEC: ['api', 'security', 'e2e-local'],
})

const IMAGE_BOUNDARY_PARENTS = new Set(['LIFE-01', 'LIFE-19', 'LIFE-20', 'LIFE-23', 'LIFE-24'])
const CROSS_CUTTING_PARENTS = new Set(['LIFE-22', 'LIFE-23', 'LIFE-24'])

export function isLifeDomainClause(clause) {
  if (clause?.classification !== 'mapped') return false
  const heading = Array.isArray(clause.headingPath) ? clause.headingPath.join(' / ') : ''
  const text = typeof clause.textSummary === 'string' ? clause.textSummary : ''
  if (clause.sourceKey === 'LIFE_DOMAIN') return true
  if (/^\|?\s*`?LIFE-\d+/.test(text)) return true
  if (clause.sourceKey === 'P1') return /P1-T(?:8|9|10|11|12|13):/.test(heading)
  if (clause.sourceKey === 'P3') return /P3-T(?:8|9|10|11|12|13):/.test(heading)
  if (clause.sourceKey === 'P4') return /P4-T7:/.test(heading)
  if (clause.sourceKey === 'MASTER_PLAN') {
    return heading.includes('ADR-023 P1-T11 medicine occurrence execution contract')
      || heading.includes('ADR-024 P1-T12 inventory-policy and shopping-recalculation contract')
  }
  if (clause.sourceKey === 'FINAL_REDESIGN') {
    return clause.id === 'SC-FINAL_REDESIGN-0045'
      || clause.id === 'SC-FINAL_REDESIGN-0185'
      || clause.id === 'SC-FINAL_REDESIGN-0228'
      || heading.includes('6.7 生活')
  }
  if (clause.sourceKey === 'EXECUTION_COMPLETENESS') {
    if (heading.includes('6.4 生活专区') || heading.includes('11. 数据闭环审查')) return true
    return heading.includes('6.6 跨页面业务事务')
      && !/发布复制|镜像构建/.test(text)
  }
  return false
}

function lifeParentsForSurface(surface) {
  return surface.parentRequirementIds.filter((parentId) => LIFE_PARENT_SET.has(parentId))
}

function selectParent(surface, dimension) {
  const parents = lifeParentsForSurface(surface)
  const preferred = {
    LAYOUT: 'LIFE-23',
    RESP: 'LIFE-23',
    A11Y: 'LIFE-23',
    MOTION: 'LIFE-23',
    STATE: 'LIFE-22',
    SEC: 'LIFE-24',
  }[dimension]
  if (preferred && parents.includes(preferred)) return preferred
  return parents.find((parentId) => !CROSS_CUTTING_PARENTS.has(parentId)) ?? parents[0]
}

function variantsFor(surface, dimension) {
  if (dimension === 'RESP') {
    return [
      ['desktop-1440', 'works at 1440x900 without clipping, card-wall regression or unreachable controls'],
      ['compact-desktop-1024', 'works at 1024x768 without clipping, overlap or loss of hierarchy'],
      ['tablet-768', 'works at 768x1024 with reachable navigation, editing and exit controls'],
      ['mobile-390', 'works at 390x844 without horizontal overflow, top-scroll escape or hidden actions'],
    ]
  }
  if (dimension === 'A11Y') {
    return [
      ['keyboard', 'supports complete keyboard operation with visible focus and no pointer-only action'],
      ['focus', 'moves, traps where required and restores focus predictably on open, close and return'],
      ['semantics', 'exposes meaningful landmarks, names, states, order and non-color-only cues'],
    ]
  }
  if (dimension === 'MOTION') {
    return [
      ['forward', 'uses a continuous interruptible forward transition with no whole-page white flash'],
      ['reverse', 'uses a spatially consistent reverse transition and restores the prior state'],
      ['reduced', 'honors prefers-reduced-motion while preserving orientation, feedback and reachability'],
    ]
  }
  if (dimension === 'NAV') {
    return [
      ['enter', 'supports direct entry, stable canonical routes and forward navigation'],
      ['return', 'supports browser back, explicit return or close without losing prior context'],
      ['restore', 'restores date, selection, filters, scroll and focus after reverse or interrupted navigation'],
    ]
  }
  if (dimension === 'STATE') {
    if (surface.kind === 'transaction') {
      return [
        ['pending', 'exposes a non-final pending state before server confirmation'],
        ['success', 'records success only after the entire transaction commits'],
        ['failure', 'reports failure and leaves no partially committed state'],
        ['conflict', 'preserves the valid version and reports version or idempotency conflict without duplicate effects'],
      ]
    }
    return [
      ['loading', 'shows a stable non-flashing loading state'],
      ['empty', 'shows a truthful empty state with a valid next action where creation is allowed'],
      ['error-retry', 'shows a bounded error and retry path without replacing production truth with fixtures'],
      ['offline', 'shows offline or draft state honestly and never confirms a write before the server'],
      ['conflict', 'preserves both versions until the user resolves the conflict'],
      ['permission', 'denies unauthorized data or writes without exposing private content'],
      ['success', 'shows successful data or completion only after current server confirmation'],
    ]
  }
  if (dimension === 'TXN') {
    return [
      ['commit', 'commits the complete write atomically and emits an auditable result'],
      ['retry', 'handles duplicate retry idempotently without duplicating inventory, cost, completion or history effects'],
      ['rollback', 'rolls back every partial effect on failure and preserves the prior valid state'],
      ['reversal', 'records undo as a linked audited compensating action rather than deleting history'],
    ]
  }
  if (dimension === 'SEC') {
    return [
      ['authorization', 'enforces session, CSRF, ownership and least-privilege authorization before private facts or actions are exposed'],
      ['privacy', 'sanitizes content and excludes medical inference, credentials, secrets and private bodies from logs, evidence and public output'],
    ]
  }
  const contract = {
    LAYOUT: 'preserves the bright continuous Daylight Command Center hierarchy without equal rounded-card walls or unreachable nested regions',
    FUNC: FEATURE_CONTRACTS[surface.id],
    DATA: 'uses Fastify/MySQL production facts with stable identifiers, effective dating, actual snapshots and no preview fixture as production truth',
    CALC: 'derives quantities, nutrition, cost, stock, budget and summaries from traceable inputs with deterministic conversion and rounding',
  }[dimension]
  return [['primary', contract]]
}

function finalBoundaryFor(parentId) {
  return IMAGE_BOUNDARY_PARENTS.has(parentId) ? ['local', 'image'] : ['local']
}

function requiredEvidenceFor(parentId, dimension) {
  const evidence = new Set(EVIDENCE_BY_DIMENSION[dimension] ?? ['unit'])
  if (finalBoundaryFor(parentId).includes('image')) evidence.add('image')
  return [...evidence]
}

function buildSurfaceAtoms() {
  const atoms = []
  for (const surface of REQUIRED_SURFACES.filter((row) => LIFE_SURFACE_SET.has(row.id))) {
    for (const dimension of surface.requiredDimensions) {
      const parentRequirementId = selectParent(surface, dimension)
      if (!parentRequirementId) continue
      variantsFor(surface, dimension).forEach(([variant, contract], index) => {
        atoms.push({
          id: `${parentRequirementId}.${surface.id}.${dimension}.${String(index + 1).padStart(2, '0')}`,
          parentRequirementId,
          title: `${SURFACE_LABELS[surface.id]} ${dimension.toLowerCase()} ${variant}`,
          contract: `${SURFACE_LABELS[surface.id]} ${contract}.`,
          sourceClauseIds: [],
          surfaces: [surface.id],
          plannedTasks: [...TASKS_BY_PARENT[parentRequirementId]],
          requiredEvidence: requiredEvidenceFor(parentRequirementId, dimension),
          finalBoundary: finalBoundaryFor(parentRequirementId),
          notApplicable: null,
        })
      })
    }
  }
  return atoms
}

const DEDICATED_ATOMS = Object.freeze([
  ['LIFE-01.DOMAIN_LOOP.FUNC.01', 'LIFE-01', 'life domain end-to-end closure', 'Connects master data, recipes or training, templates, date plans, actual snapshots, inventory, nutrition, cost, budget, shopping, review and Obsidian without duplicate sources of truth.', ['LIFE_TODAY_ROUTE', 'PRIVATE_OVERVIEW'], ['unit', 'api', 'mysql', 'e2e-local']],
  ['LIFE-02.CALENDAR.STATE.01', 'LIFE-02', 'calendar distinguishes every plan and completion state', 'Shows no-plan, planned, completed, partially completed and past-incomplete dates with non-color-only distinctions and reachable day detail.', ['LIFE_CALENDAR_OVERLAY', 'LIFE_CALENDAR_ROUTE'], ['unit', 'e2e-local', 'a11y']],
  ['LIFE-03.MASTER_DATA.DATA.01', 'LIFE-03', 'effective-dated master catalog facts', 'Stores stable catalog identity and effective-dated units, nutrition, price, location and lifecycle facts without rewriting historical actuals.', ['LIFE_INGREDIENTS_ROUTE', 'TX_MASTER_DATA_RECALCULATION'], ['unit', 'api', 'mysql']],
  ['LIFE-04.MEDICINE.SEC.01', 'LIFE-04', 'medicine stores user facts without medical advice', 'Stores only user-authored medicine identity, stock, batch, expiry, schedule and history; it never generates diagnosis, dosage, stop-medication or unverified interaction advice.', ['LIFE_MEDICINES_ROUTE'], ['unit', 'api', 'security', 'manual-review']],
  ['LIFE-04.MEDICINE_OCCURRENCE.DATA.01', 'LIFE-04', 'medicine recurrence occurrence has stable bounded persisted identity', 'Persists each occurrence under a stable owner, rule, original date and original time identity, limits expansion to 366 inclusive days and 10,000 rows, and stores only user-authored medicine facts.', ['LIFE_MEDICINES_ROUTE', 'TX_MEDICINE_OCCURRENCE'], ['unit', 'api', 'mysql', 'security']],
  ['LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01', 'LIFE-02', 'medicine occurrence-only dates merge into calendar and timeline', 'Merges active persisted occurrences into calendar and date-timeline reads with a discriminated source and stable ordering, including occurrence-only dates, without eager day-plan JSON writes or unrelated day-plan version changes.', ['LIFE_CALENDAR_OVERLAY', 'LIFE_CALENDAR_ROUTE'], ['unit', 'api', 'mysql']],
  ['LIFE-05.UNITS.CALC.01', 'LIFE-05', 'deterministic unit conversion and rounding', 'Converts only compatible dimensions through an explicit base unit and deterministic rounding, and rejects missing or incompatible conversions.', ['LIFE_INGREDIENTS_ROUTE'], ['unit', 'api', 'mysql']],
  ['LIFE-06.FUTURE_RECALC.CALC.01', 'LIFE-06', 'future plans recalculate from current master data', 'Recomputes future or uncompleted forecasts from the current effective catalog, recipe and serving facts while preserving explicit user overrides.', ['TX_MASTER_DATA_RECALCULATION'], ['unit', 'api', 'mysql']],
  ['LIFE-06.HISTORY_SNAPSHOT.DATA.01', 'LIFE-06', 'completed history remains an actual snapshot', 'Completed history preserves the actual ingredient, amount, unit, nutrition, price, recipe version and serving facts recorded at completion.', ['TX_MASTER_DATA_RECALCULATION', 'TX_MEAL_COMPLETION'], ['unit', 'api', 'mysql']],
  ['LIFE-06.HISTORY_RECALC.TXN.01', 'LIFE-06', 'completed history explicit audited recalculation', 'Changes a completed historical calculation only through an explicit authorized recalculation that records before, after, reason and actor.', ['TX_MASTER_DATA_RECALCULATION'], ['api', 'mysql', 'security']],
  ['LIFE-07.RECIPE_VERSION.DATA.01', 'LIFE-07', 'recipe versions preserve ingredient and yield facts', 'Versions recipe ingredients, steps, servings and yields so plans and actual cooking can reference an immutable effective recipe version.', ['LIFE_RECIPES_ROUTE', 'TX_PREPARED_FOOD'], ['unit', 'api', 'mysql']],
  ['LIFE-08.BIDIRECTIONAL.FUNC.01', 'LIFE-08', 'catalog and recipe relations are bidirectionally reachable', 'Makes every recipe usage reachable from its ingredient and every ingredient reachable from the recipe without duplicating relation data.', ['LIFE_INGREDIENTS_ROUTE', 'LIFE_RECIPES_ROUTE'], ['unit', 'api', 'e2e-local']],
  ['LIFE-09.TEMPLATE_APPLY.TXN.01', 'LIFE-09', 'template apply creates an independent date plan', 'Applying a template snapshots it into an independent editable date plan and does not create actual completion or inventory events.', ['LIFE_PLANS_ROUTE', 'TX_TEMPLATE_SYNC_COPY'], ['api', 'mysql', 'e2e-local']],
  ['LIFE-09.TEMPLATE_SYNC.TXN.01', 'LIFE-09', 'template sync updates only uncompleted future items', 'An explicit sync previews and updates only selected uncompleted future plan items, preserving completed actuals and user overrides.', ['LIFE_PLANS_ROUTE', 'TX_TEMPLATE_SYNC_COPY'], ['api', 'mysql', 'e2e-local']],
  ['LIFE-09.DATE_COPY.TXN.01', 'LIFE-09', 'date copy creates an independent editable plan', 'Copying a date creates a new independently editable plan and excludes actual completions, inventory transactions and historical spending.', ['LIFE_PLANS_ROUTE', 'TX_TEMPLATE_SYNC_COPY'], ['api', 'mysql', 'e2e-local']],
  ['LIFE-10.MULTI_PLAN.DATA.01', 'LIFE-10', 'meal medicine and fitness plans share date truth', 'Keeps meal, medicine and fitness plan items independently editable on the same date while sharing date identity, state and conflict rules.', ['LIFE_PLANS_ROUTE', 'LIFE_MEDICINES_ROUTE', 'LIFE_FITNESS_ROUTE'], ['unit', 'api', 'mysql']],
  ['LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01', 'LIFE-10', 'medicine rule reconciliation preserves past and terminal history', 'Reconciles only future incomplete occurrences when a rule changes or is deleted, while preserving past incomplete, skipped, cancelled, completed, snapshot and reversal history unchanged.', ['TX_MEDICINE_OCCURRENCE'], ['api', 'mysql']],
  ['LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01', 'LIFE-10', 'medicine occurrence completion has a discriminated immutable source', 'Accepts exactly one day-plan-item or medicine-occurrence source, binds the immutable completion snapshot to it, and atomically writes the occurrence snapshot, one inventory deduction, actual cost and completed status.', ['TX_MEDICINE_OCCURRENCE'], ['api', 'mysql', 'e2e-local']],
  ['LIFE-11.MEAL_COMPLETE.TXN.01', 'LIFE-11', 'meal completion atomic snapshot and inventory write', 'Atomically records the actual meal snapshot and idempotent inventory consumption ledger before nutrition and consumption cost are considered confirmed.', ['TX_MEAL_COMPLETION'], ['api', 'mysql', 'e2e-local']],
  ['LIFE-11.MEAL_REVERSE.TXN.01', 'LIFE-11', 'meal reversal compensating ledger event', 'Reversing a meal creates linked compensating completion, inventory, nutrition and consumption-cost events without deleting the original history.', ['TX_MEAL_REVERSAL'], ['api', 'mysql', 'e2e-local']],
  ['LIFE-11.MEDICINE_OCCURRENCE_REVERSE.TXN.01', 'LIFE-11', 'medicine occurrence undo is a compensating state-aware reversal', 'Reverses an occurrence through linked compensating inventory and completion facts without deleting history, restoring planned only when the active rule still includes it and cancelled otherwise.', ['TX_MEDICINE_OCCURRENCE'], ['api', 'mysql', 'e2e-local']],
  ['LIFE-12.PREPARED_FOOD.TXN.01', 'LIFE-12', 'prepared food yield and stock lifecycle', 'Cooking consumes ingredient batches and creates a traceable prepared-food yield whose later consumption, waste or reversal uses ledger events.', ['LIFE_RECIPES_ROUTE', 'TX_PREPARED_FOOD'], ['api', 'mysql', 'e2e-local']],
  ['LIFE-13.HOUSEHOLD.DATA.01', 'LIFE-13', 'household stock uses the shared event ledger', 'Tracks household catalog, location, batches, expiry, minimum stock and consumption through the same idempotent event and audit model.', ['LIFE_HOUSEHOLD_ROUTE'], ['unit', 'api', 'mysql']],
  ['LIFE-11.INVENTORY_POLICY.DATA.01', 'LIFE-11', 'inventory policy is owner scoped and unit explicit', 'Stores one versioned owner policy per catalog item with non-negative minimum stock, positive package quantity and an explicit compatible unit; missing conversion remains incomplete rather than guessed.', ['LIFE_INGREDIENTS_ROUTE', 'TX_SHOPPING_RECALCULATION'], ['unit', 'api', 'mysql']],
  ['LIFE-14.SHOPPING_RECALC.CALC.01', 'LIFE-14', 'shopping recalculation uses server-derived facts and deterministic package rounding', 'For an inclusive through date, derives future incomplete planned demand, effective usable stock and outstanding formal quantity in the policy unit, calculates max(0, demand + minimum - stock - outstanding), and rounds a positive shortage up to the package quantity.', ['LIFE_SHOPPING_ROUTE', 'TX_SHOPPING_RECALCULATION'], ['unit', 'api', 'mysql']],
  ['LIFE-14.SHOPPING_RECALC.TXN.01', 'LIFE-14', 'shopping recalculation atomically replaces only derived suggestions', 'Reads one owner-consistent snapshot and atomically replaces system-derived suggestions and reasons while preserving manual suggestions, formal lists, purchases, refunds and immutable history.', ['LIFE_SHOPPING_ROUTE', 'TX_SHOPPING_RECALCULATION'], ['api', 'mysql', 'e2e-local']],
  ['LIFE-14.PURCHASE_LIFECYCLE.TXN.01', 'LIFE-14', 'purchase partial receipt and refund lifecycle', 'Supports planned quantity, partial receipt, remaining quantity, batch creation, return and refund as linked idempotent events.', ['LIFE_SHOPPING_ROUTE', 'TX_PURCHASE', 'TX_RETURN_REFUND'], ['api', 'mysql', 'e2e-local']],
  ['LIFE-15.COST_SEPARATION.CALC.01', 'LIFE-15', 'cash expenditure stays separate from consumption cost', 'Reports purchase cash expenditure and actual consumption cost as separate traceable measures and never adds them together as one expense.', ['LIFE_SHOPPING_ROUTE', 'LIFE_ANALYTICS_ROUTE', 'TX_PURCHASE'], ['unit', 'api', 'mysql', 'e2e-local']],
  ['LIFE-16.ANALYTICS.CALC.01', 'LIFE-16', 'nutrition fitness and budget analytics remain traceable', 'Builds date-bounded nutrition, fitness, stock, consumption-cost and budget summaries from actual snapshots and linked ledger entries.', ['LIFE_ANALYTICS_ROUTE', 'LIFE_FITNESS_ROUTE'], ['unit', 'api', 'mysql']],
  ['LIFE-17.TAXONOMY.DATA.01', 'LIFE-17', 'taxonomy changes preserve stable entity identity', 'Edits categories, tags and locations without changing stable item identity or silently rewriting referenced history.', ['LIFE_DATA_ROUTE', 'LIFE_INGREDIENTS_ROUTE', 'LIFE_HOUSEHOLD_ROUTE'], ['unit', 'api', 'mysql']],
  ['LIFE-18.TRASH_RESTORE.TXN.01', 'LIFE-18', 'soft delete and restore preserves references', 'Soft delete hides an entity from normal selection while retaining its references, and restore returns the same stable identity.', ['LIFE_DATA_ROUTE', 'TX_TRASH_IMPORT_OBSIDIAN'], ['api', 'mysql', 'e2e-local']],
  ['LIFE-18.PERMANENT_DELETE.SEC.01', 'LIFE-18', 'permanent delete blocks live references', 'Permanent delete requires explicit confirmation and refuses entities with live references until the user resolves those references.', ['LIFE_DATA_ROUTE', 'TX_TRASH_IMPORT_OBSIDIAN'], ['api', 'mysql', 'security']],
  ['LIFE-19.IMPORT_PREVIEW.STATE.01', 'LIFE-19', 'import preview and restore point', 'Parses and validates an import into a non-mutating preview and creates a verified restore point before apply becomes available.', ['SETTINGS_ROUTE', 'LIFE_DATA_ROUTE', 'TX_TRASH_IMPORT_OBSIDIAN'], ['unit', 'api', 'mysql', 'e2e-local']],
  ['LIFE-19.IMPORT_ROLLBACK.TXN.01', 'LIFE-19', 'import all-or-nothing apply and rollback', 'Applies the approved import as one audited transaction and restores the prior valid state when any row, relation or file operation fails.', ['SETTINGS_ROUTE', 'LIFE_DATA_ROUTE', 'TX_TRASH_IMPORT_OBSIDIAN'], ['api', 'mysql', 'e2e-local']],
  ['LIFE-20.OBSIDIAN_CONNECTED.STATE.01', 'LIFE-20', 'Obsidian projection connected state', 'Shows connected only after the allowlisted projection path and adapter are verified and the preview matches the current server version.', ['LIFE_DATA_ROUTE', 'TX_TRASH_IMPORT_OBSIDIAN'], ['api', 'e2e-local', 'manual-review']],
  ['LIFE-20.OBSIDIAN_CONFLICT.STATE.01', 'LIFE-20', 'Obsidian projection conflict state', 'Preserves both server and file versions and requires explicit resolution when the controlled projection detects a version conflict.', ['LIFE_DATA_ROUTE', 'TX_TRASH_IMPORT_OBSIDIAN'], ['api', 'e2e-local', 'manual-review']],
  ['LIFE-20.OBSIDIAN_DEGRADED.STATE.01', 'LIFE-20', 'Obsidian projection degraded state', 'Shows degraded with bounded diagnostics when only part of the projection can be scanned, previewed or applied.', ['LIFE_DATA_ROUTE', 'TX_TRASH_IMPORT_OBSIDIAN'], ['api', 'e2e-local', 'manual-review']],
  ['LIFE-20.OBSIDIAN_UNSUPPORTED.STATE.01', 'LIFE-20', 'Obsidian projection unsupported state', 'Shows unsupported and disables apply when the adapter, path, format or operation is outside the controlled allowlist.', ['LIFE_DATA_ROUTE', 'TX_TRASH_IMPORT_OBSIDIAN'], ['api', 'security', 'e2e-local']],
  ['LIFE-21.GLOBAL_RELATIONS.FUNC.01', 'LIFE-21', 'global tools preserve life relation context', 'Search and quick-create return authorized life results and preserve originating date, entity, relation, route, selection and focus.', ['GLOBAL_SEARCH_OVERLAY', 'QUICK_CREATE_OVERLAY'], ['unit', 'api', 'e2e-local']],
  ['LIFE-22.OFFLINE_CONFIRMATION.STATE.01', 'LIFE-22', 'offline draft is not a confirmed server write', 'May preserve a clearly labeled local draft while offline but never reports completion, inventory, purchase or import success before server commit.', ['LIFE_TODAY_ROUTE', 'TX_MEAL_COMPLETION', 'TX_PURCHASE', 'TX_TRASH_IMPORT_OBSIDIAN'], ['unit', 'api', 'e2e-local']],
  ['LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01', 'LIFE-22', 'medicine occurrence writes enforce owner version idempotency and snapshot consistency', 'Scopes every occurrence read and write to the owner, enforces optimistic versions and idempotency, uses one consistent-snapshot transaction connection with a stable lock order, preserves Memory/MySQL parity, and returns explicit conflicts with no partial state.', ['TX_MEDICINE_OCCURRENCE'], ['unit', 'api', 'mysql']],
  ['LIFE-22.SHOPPING_RECALC_CONCURRENCY.STATE.01', 'LIFE-22', 'shopping recalculation enforces owner idempotency and snapshot consistency', 'Scopes policy and recalculation facts to one owner, replays the same key and payload, conflicts on key reuse with different input, and preserves Memory/MySQL consistent-snapshot rollback without half-written suggestions.', ['TX_SHOPPING_RECALCULATION'], ['unit', 'api', 'mysql']],
  ['LIFE-23.EXIT_A11Y.A11Y.01', 'LIFE-23', 'every life surface has a reachable keyboard exit', 'Keeps navigation, panels, overlays, editors and mobile nested regions operable by keyboard with visible focus and a reachable return or close path.', ['LIFE_TODAY_ROUTE', 'LIFE_CALENDAR_OVERLAY', 'LIFE_DATA_ROUTE'], ['unit', 'e2e-local', 'a11y', 'manual-review']],
  ['LIFE-24.PRIVACY.SEC.01', 'LIFE-24', 'life facts remain owner-private and safely exportable', 'Scopes all life reads, writes, search, media, imports, exports and projections to the authenticated owner and excludes secrets and medical inference.', ['LIFE_TODAY_ROUTE', 'LIFE_DATA_ROUTE'], ['api', 'security', 'e2e-local']],
])

function materializeDedicatedAtoms() {
  return DEDICATED_ATOMS.map(([id, parentRequirementId, title, contract, surfaces, requiredEvidence]) => ({
    id,
    parentRequirementId,
    title,
    contract,
    sourceClauseIds: [],
    surfaces,
    plannedTasks: [...TASKS_BY_PARENT[parentRequirementId]],
    requiredEvidence: [...new Set([
      ...requiredEvidence,
      ...(finalBoundaryFor(parentRequirementId).includes('image') ? ['image'] : []),
    ])],
    finalBoundary: finalBoundaryFor(parentRequirementId),
    notApplicable: null,
  }))
}

function extractExplicitParents(text) {
  return LIFE_PARENT_REQUIREMENT_IDS.filter((parentId) => text.includes(parentId))
}

function inferParents(clause) {
  const heading = clause.headingPath.join(' / ')
  const searchable = `${heading} ${clause.textSummary}`
  const explicit = extractExplicitParents(searchable)
  if (explicit.length) return explicit

  const taskIds = [...searchable.matchAll(/P[1-6]-T\d+/g)].map((match) => match[0])
  const taskParents = [...new Set(taskIds.flatMap((taskId) => TASK_PARENT_MAP.get(taskId) ?? []))]
  if (taskParents.length) return taskParents

  const routeParents = []
  for (const surface of REQUIRED_SURFACES.filter((row) => LIFE_SURFACE_SET.has(row.id))) {
    if (searchable.includes(surface.id)) routeParents.push(...lifeParentsForSurface(surface))
    if (surface.path !== '/' && searchable.includes(surface.path.replace(/^\w+:/, ''))) {
      routeParents.push(...lifeParentsForSurface(surface))
    }
  }
  if (routeParents.length) return [...new Set(routeParents)]

  const rules = [
    [['LIFE-20'], /Obsidian|projection|投影|受控写回/i],
    [['LIFE-19'], /import|export|restore point|导入|导出|恢复点/i],
    [['LIFE-18'], /trash|soft delete|permanent delete|回收站|软删除|永久删除/i],
    [['LIFE-14', 'LIFE-15'], /purchase|refund|shopping|cash expenditure|采购|退款|现金支出/i],
    [['LIFE-11', 'LIFE-12'], /inventory|batch|prepared food|consume|库存|批次|成品|消耗/i],
    [['LIFE-09', 'LIFE-10'], /template|date plan|calendar|模板|日期计划|日历/i],
    [['LIFE-07', 'LIFE-08'], /recipe|cooking|ingredient relation|食谱|做菜|原料/i],
    [['LIFE-04', 'LIFE-24'], /medicine|dosage|interaction|药品|剂量|相互作用/i],
    [['LIFE-03', 'LIFE-05', 'LIFE-06'], /master data|catalog|unit conversion|effective|snapshot|基础数据|单位换算|生效|快照/i],
    [['LIFE-16'], /analytics|nutrition|fitness|budget|分析|营养|健身|预算/i],
    [['LIFE-22'], /offline|conflict|idempot|离线|冲突|幂等/i],
    [['LIFE-23'], /responsive|keyboard|focus|motion|1440|1024|768|390|响应式|键盘|焦点|动效/i],
    [['LIFE-24'], /privacy|authorization|owner|security|隐私|权限|安全/i],
  ]
  for (const [parents, pattern] of rules) {
    if (pattern.test(searchable)) return parents
  }
  return ['LIFE-01']
}

function inferDimensions(clause) {
  const text = `${clause.headingPath.join(' / ')} ${clause.textSummary}`
  const dimensions = []
  const rules = [
    ['RESP', /responsive|breakpoint|1440|1024|768|390|mobile|tablet|响应式|断点|移动端|平板/i],
    ['A11Y', /accessib|keyboard|focus|aria|screen reader|键盘|焦点|无障碍/i],
    ['MOTION', /motion|transition|animation|reduced|interrupt|动效|转场|动态|中断/i],
    ['NAV', /route|navigation|redirect|back|return|close|Escape|deep link|路由|导航|返回|关闭/i],
    ['SEC', /security|session|CSRF|secret|privacy|sanitize|redact|permission|auth|medicine advice|安全|会话|凭据|隐私|脱敏|权限|认证|医疗建议/i],
    ['TXN', /transaction|atomic|idempoten|rollback|reversal|undo|commit|refund|事务|原子|幂等|回滚|撤销|提交|退款/i],
    ['CALC', /calculate|formula|aggregate|conversion|nutrition|cost|budget|count|计算|公式|聚合|换算|营养|成本|预算/i],
    ['STATE', /loading|empty|error|conflict|offline|degraded|unsupported|retry|failure|状态|空态|错误|冲突|离线|降级|不支持|重试|失败/i],
    ['DATA', /schema|model|data|MySQL|migration|snapshot|storage|version|catalog|history|数据|模型|迁移|快照|存储|版本|目录|历史/i],
    ['LAYOUT', /layout|spacing|typography|canvas|visual|页面|布局|间距|排版|画布|视觉/i],
  ]
  for (const [dimension, pattern] of rules) {
    if (pattern.test(text)) dimensions.push(dimension)
  }
  return dimensions.length ? dimensions.slice(0, 4) : ['FUNC']
}

function inferSurfaceIds(clause) {
  const text = `${clause.headingPath.join(' / ')} ${clause.textSummary}`
  const ids = []
  for (const surface of REQUIRED_SURFACES.filter((row) => LIFE_SURFACE_SET.has(row.id))) {
    if (text.includes(surface.id)) ids.push(surface.id)
    if (surface.path !== '/' && text.includes(surface.path.replace(/^\w+:/, ''))) ids.push(surface.id)
  }
  return [...new Set(ids)]
}

function stableIndex(text, modulo) {
  let hash = 0
  for (const character of text) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0
  return modulo ? hash % modulo : 0
}

function preferredParentForDimension(parents, dimension) {
  const preferred = {
    LAYOUT: 'LIFE-23',
    RESP: 'LIFE-23',
    A11Y: 'LIFE-23',
    MOTION: 'LIFE-23',
    STATE: 'LIFE-22',
    SEC: 'LIFE-24',
  }[dimension]
  return preferred && parents.includes(preferred) ? preferred : null
}

const MEDICINE_OCCURRENCE_CLAUSE_RULES = Object.freeze([
  ['用户保存药品周期规则时，在同一事务内生成或调和 owner-scoped、versioned occurrence', ['LIFE-04.MEDICINE_OCCURRENCE.DATA.01', 'LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01', 'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01']],
  ['occurrence 的稳定身份由用户、规则、原始排程日期和原始排程时间组成', ['LIFE-04.MEDICINE_OCCURRENCE.DATA.01']],
  ['active occurrence 只投影到日历和日期时间线', ['LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01']],
  ['日历和日期时间线合并持久化 day-plan items 与 active occurrence', ['LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01']],
  ['`/completions` 保持 day-plan item 分支向后兼容', ['LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01']],
  ['完成 occurrence 在一个 owner-scoped、幂等、乐观版本和一致快照事务内', ['LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01', 'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01']],
  ['撤销不删除完成快照，而是生成一次反向库存流水', ['LIFE-11.MEDICINE_OCCURRENCE_REVERSE.TXN.01']],
  ['规则更新只调和未来未完成 occurrence', ['LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01']],
  ['过去未完成、已跳过、已取消、已完成 occurrence', ['LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01']],
  ['规则与 occurrence 调和在同一事务中完成', ['LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01']],
  ['eager day-plan JSON 与纯虚拟 occurrence 均为已否决方案', ['LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01', 'LIFE-04.MEDICINE_OCCURRENCE.DATA.01', 'LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01', 'LIFE-11.MEDICINE_OCCURRENCE_REVERSE.TXN.01']],
  ['药品周期规则保存/更新/删除 → 有界 occurrence 生成/调和', ['LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01', 'LIFE-04.MEDICINE_OCCURRENCE.DATA.01', 'LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01', 'LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01', 'LIFE-11.MEDICINE_OCCURRENCE_REVERSE.TXN.01', 'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01']],
  ['`009_life_planning.sql` owns a bounded, owner-scoped and versioned', ['LIFE-04.MEDICINE_OCCURRENCE.DATA.01', 'LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01', 'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01']],
  ['Calendar and date timeline reads merge day-plan items', ['LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01']],
  ['Unified completion accepts exactly one discriminated source', ['LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01', 'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01']],
  ['Rule update/delete reconciles only future incomplete occurrences', ['LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01', 'LIFE-11.MEDICINE_OCCURRENCE_REVERSE.TXN.01']],
  ['P1-T11 cannot close without focused API/store behavior', ['LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01', 'LIFE-04.MEDICINE_OCCURRENCE.DATA.01', 'LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01', 'LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01', 'LIFE-11.MEDICINE_OCCURRENCE_REVERSE.TXN.01', 'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01']],
  ["Produces `LifePlanItemKind = 'meal' | 'supplement' | 'medicine'", ['LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01', 'LIFE-04.MEDICINE_OCCURRENCE.DATA.01']],
  ['Produces `/api/v1/life/calendar`, `/day-plans`, `/templates`, `/fitness` and `/completions` routes', ['LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01', 'LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01']],
  ['[ ] **Step 3: Add migration 009 and planning contracts.**', ['LIFE-04.MEDICINE_OCCURRENCE.DATA.01', 'LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01']],
  ['[ ] **Step 4: Implement conflict preview/apply/copy/sync and merged calendar/date timeline summaries.**', ['LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01']],
  ['[ ] **Step 5: Implement supplement/medicine/fitness scheduling and transactional completion/undo.**', ['LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01', 'LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01', 'LIFE-11.MEDICINE_OCCURRENCE_REVERSE.TXN.01', 'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01']],
  ['[ ] **Step 7: Add frontend contracts/API and run focused, MySQL and type gates.**', ['LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01', 'LIFE-04.MEDICINE_OCCURRENCE.DATA.01', 'LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01', 'LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01', 'LIFE-11.MEDICINE_OCCURRENCE_REVERSE.TXN.01', 'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01']],
])

function explicitMedicineOccurrenceAtoms(clause, atoms) {
  const rule = MEDICINE_OCCURRENCE_CLAUSE_RULES.find(([prefix]) => clause.textSummary.startsWith(prefix))
  if (!rule) return null
  const atomIds = rule[1]
  const knownAtomIds = new Set(atoms.map((atom) => atom.id))
  const missing = atomIds.filter((atomId) => !knownAtomIds.has(atomId))
  if (missing.length) throw new Error(`Medicine occurrence clause references unknown atoms: ${missing.join(', ')}`)
  return atomIds
}

const SHOPPING_RECALCULATION_CLAUSE_RULES = Object.freeze([
  ['每个 owner-scoped catalog item 可保存一份 versioned inventory policy', ['LIFE-11.INVENTORY_POLICY.DATA.01']],
  ['策略单位必须属于同一用户', ['LIFE-05.UNITS.CALC.01', 'LIFE-11.INVENTORY_POLICY.DATA.01']],
  ['计划需求、当前有效库存、正式采购剩余量、最低库存和包装量', ['LIFE-05.UNITS.CALC.01', 'LIFE-14.SHOPPING_RECALC.CALC.01']],
  ['采购重算请求必须包含显式含首尾 `through` 日期', ['LIFE-14.SHOPPING_RECALC.CALC.01']],
  ['当前有效库存只来自库存流水与可用、未过期批次', ['LIFE-14.SHOPPING_RECALC.CALC.01']],
  ['每个物品先计算 `rawShortage', ['LIFE-14.SHOPPING_RECALC.CALC.01']],
  ['一个物品只有一个系统派生建议', ['LIFE-14.SHOPPING_RECALC.CALC.01', 'LIFE-14.SHOPPING_RECALC.TXN.01']],
  ['服务端采购重算在一个 owner-scoped 一致快照事务内', ['LIFE-14.SHOPPING_RECALC.TXN.01', 'LIFE-22.SHOPPING_RECALC_CONCURRENCY.STATE.01']],
  ['重算不得修改人工建议、正式清单', ['LIFE-14.SHOPPING_RECALC.TXN.01']],
  ['操作使用版本和幂等键', ['LIFE-22.SHOPPING_RECALC_CONCURRENCY.STATE.01']],
  ['P1-T12 不能在策略持久化', ['LIFE-11.INVENTORY_POLICY.DATA.01', 'LIFE-14.SHOPPING_RECALC.CALC.01', 'LIFE-14.SHOPPING_RECALC.TXN.01', 'LIFE-22.SHOPPING_RECALC_CONCURRENCY.STATE.01']],
  ['库存策略/日期计划/库存流水/正式采购 → 指定 through 的服务端采购重算', ['LIFE-11.INVENTORY_POLICY.DATA.01', 'LIFE-14.SHOPPING_RECALC.CALC.01', 'LIFE-14.SHOPPING_RECALC.TXN.01']],
  ['Add one owner-scoped, versioned inventory policy', ['LIFE-11.INVENTORY_POLICY.DATA.01']],
  ['Add a service-side idempotent recalculation operation', ['LIFE-14.SHOPPING_RECALC.CALC.01', 'LIFE-22.SHOPPING_RECALC_CONCURRENCY.STATE.01']],
  ['Convert every input to the policy unit', ['LIFE-05.UNITS.CALC.01', 'LIFE-14.SHOPPING_RECALC.CALC.01']],
  ['Read all inputs from one owner-consistent snapshot', ['LIFE-14.SHOPPING_RECALC.TXN.01', 'LIFE-22.SHOPPING_RECALC_CONCURRENCY.STATE.01']],
  ['P1-T12 cannot close until focused behavior', ['LIFE-11.INVENTORY_POLICY.DATA.01', 'LIFE-14.SHOPPING_RECALC.CALC.01', 'LIFE-14.SHOPPING_RECALC.TXN.01']],
  ['[ ] **Step 4: Implement inventory policy plus shopping', ['LIFE-11.INVENTORY_POLICY.DATA.01', 'LIFE-14.SHOPPING_RECALC.CALC.01', 'LIFE-14.SHOPPING_RECALC.TXN.01', 'LIFE-22.SHOPPING_RECALC_CONCURRENCY.STATE.01']],
  ['[ ] The life journey must also persist an inventory policy', ['LIFE-11.INVENTORY_POLICY.DATA.01', 'LIFE-14.SHOPPING_RECALC.CALC.01', 'LIFE-14.SHOPPING_RECALC.TXN.01']],
])

function explicitShoppingRecalculationAtoms(clause, atoms) {
  const rule = SHOPPING_RECALCULATION_CLAUSE_RULES.find(([prefix]) => clause.textSummary.startsWith(prefix))
  if (!rule) return null
  const atomIds = rule[1]
  const knownAtomIds = new Set(atoms.map((atom) => atom.id))
  const missing = atomIds.filter((atomId) => !knownAtomIds.has(atomId))
  if (missing.length) throw new Error(`Shopping recalculation clause references unknown atoms: ${missing.join(', ')}`)
  return atomIds
}

function selectAtomsForClause(clause, atoms) {
  const explicit = explicitMedicineOccurrenceAtoms(clause, atoms)
    ?? explicitShoppingRecalculationAtoms(clause, atoms)
  if (explicit) return explicit
  const parents = inferParents(clause)
  const dimensions = inferDimensions(clause)
  const surfaces = inferSurfaceIds(clause)
  const selected = []
  for (const parentId of parents) {
    const parentAtoms = atoms.filter((atom) => atom.parentRequirementId === parentId)
    for (const dimension of dimensions) {
      const preferredParent = preferredParentForDimension(parents, dimension)
      if (preferredParent && parentId !== preferredParent) continue
      let candidates = parentAtoms.filter((atom) => atom.id.split('.')[2] === dimension)
      const surfaceCandidates = candidates.filter((atom) => atom.surfaces.some((surfaceId) => surfaces.includes(surfaceId)))
      if (surfaceCandidates.length) candidates = surfaceCandidates
      if (!candidates.length) candidates = parentAtoms
      if (!candidates.length) continue
      const broadVariantClause = dimension === 'RESP' && /1440|1024|768|390|four breakpoints|四个断点/i.test(clause.textSummary)
      const picked = broadVariantClause
        ? candidates
        : [candidates[stableIndex(clause.id, candidates.length)]]
      selected.push(...picked.map((atom) => atom.id))
    }
  }
  return [...new Set(selected)]
}

function canonicalClauseByParent(clauses, parentId) {
  return clauses.find((clause) => /^\|?\s*`?LIFE-\d+/.test(clause.textSummary) && clause.textSummary.includes(parentId))
    ?? clauses.find((clause) => inferParents(clause).includes(parentId))
}

export function buildLifeAcceptance(matrix, sourceRegistry) {
  const lifeClauses = sourceRegistry.clauses.filter(isLifeDomainClause)
  const preservedAtoms = matrix.atoms.filter((atom) => !LIFE_PARENT_SET.has(atom.parentRequirementId))
  const lifeAtoms = [...buildSurfaceAtoms(), ...materializeDedicatedAtoms()]
  const atomById = new Map(lifeAtoms.map((atom) => [atom.id, atom]))
  const clauseToAtoms = new Map()

  for (const clause of lifeClauses) {
    clauseToAtoms.set(clause.id, selectAtomsForClause(clause, lifeAtoms))
  }
  for (const atom of lifeAtoms) {
    const canonical = canonicalClauseByParent(lifeClauses, atom.parentRequirementId)
    if (!canonical) throw new Error(`No canonical source clause for ${atom.parentRequirementId}`)
    atom.sourceClauseIds.push(canonical.id)
    clauseToAtoms.set(canonical.id, [...new Set([...(clauseToAtoms.get(canonical.id) ?? []), atom.id])])
  }
  for (const [clauseId, atomIds] of clauseToAtoms) {
    if (!atomIds.length) throw new Error(`Life source clause ${clauseId} did not map to an atom`)
    for (const atomId of atomIds) {
      const atom = atomById.get(atomId)
      if (!atom) throw new Error(`Unknown generated life atom ${atomId}`)
      if (!atom.sourceClauseIds.includes(clauseId)) atom.sourceClauseIds.push(clauseId)
    }
  }
  for (const atom of lifeAtoms) atom.sourceClauseIds.sort()

  const lifeAtomIdPattern = /^LIFE-\d{2}\./
  const clauses = sourceRegistry.clauses.map((clause) => {
    const preserved = clause.atomIds.filter((atomId) => !lifeAtomIdPattern.test(atomId) && atomId !== `ATOM-${clause.id}`)
    if (!clauseToAtoms.has(clause.id)) return { ...clause, atomIds: preserved }
    return { ...clause, atomIds: [...new Set([...preserved, ...clauseToAtoms.get(clause.id)])].sort() }
  })
  const nextMatrix = { ...matrix, surfaces: REQUIRED_SURFACES, atoms: [...preservedAtoms, ...lifeAtoms] }
  const nextRegistry = { ...sourceRegistry, clauses }
  const issues = validateAcceptanceMatrix(nextMatrix, nextRegistry)
  if (issues.length) throw new Error(`Generated life acceptance matrix is invalid: ${JSON.stringify(issues.slice(0, 20))}`)
  return { matrix: nextMatrix, sourceRegistry: nextRegistry }
}

export function collectLifeAcceptanceCoverageGaps(matrix, sourceRegistry) {
  const atoms = Array.isArray(matrix?.atoms) ? matrix.atoms : []
  const lifeAtoms = atoms.filter((atom) => LIFE_PARENT_SET.has(atom.parentRequirementId))
  const atomsById = new Map(lifeAtoms.map((atom) => [atom.id, atom]))
  const missingParents = LIFE_PARENT_REQUIREMENT_IDS.filter((parentId) => (
    !lifeAtoms.some((atom) => atom.parentRequirementId === parentId)
  ))
  const missingMappedClauseIds = sourceRegistry.clauses
    .filter(isLifeDomainClause)
    .filter((clause) => !clause.atomIds.some((atomId) => {
      const atom = atomsById.get(atomId)
      return atom?.sourceClauseIds.includes(clause.id)
    }))
    .map((clause) => clause.id)
  const surfacesById = new Map(matrix.surfaces.map((surface) => [surface.id, surface]))
  const missingSurfaceDimensions = []
  for (const surfaceId of LIFE_SURFACE_IDS) {
    const surface = surfacesById.get(surfaceId)
    for (const dimension of surface?.requiredDimensions ?? []) {
      if (!lifeAtoms.some((atom) => atom.surfaces.includes(surfaceId) && atom.id.split('.')[2] === dimension)) {
        missingSurfaceDimensions.push(`${surfaceId}:${dimension}`)
      }
    }
  }
  const missingTransactions = LIFE_TRANSACTION_SURFACE_IDS.filter((surfaceId) => (
    !lifeAtoms.some((atom) => atom.surfaces.includes(surfaceId))
  ))
  return { missingParents, missingMappedClauseIds, missingSurfaceDimensions, missingTransactions }
}
