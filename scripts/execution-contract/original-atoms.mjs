import { PARENT_REQUIREMENT_IDS } from './constants.mjs'
import { REQUIRED_SURFACES, validateAcceptanceMatrix } from './acceptance.mjs'

export const ORIGINAL_PARENT_REQUIREMENT_IDS = Object.freeze(PARENT_REQUIREMENT_IDS.slice(0, 20))
const ORIGINAL_PARENT_SET = new Set(ORIGINAL_PARENT_REQUIREMENT_IDS)
const ORIGINAL_TRANSACTION_SURFACE_IDS = new Set([
  'TX_PUBLISH_VERSION_REVOKE',
  'TX_IMAGE_REGISTRY_HANDOFF',
])
export const ORIGINAL_SURFACE_IDS = Object.freeze(REQUIRED_SURFACES
  .map((surface) => surface.id)
  .filter((surfaceId) => (
    !surfaceId.startsWith('LIFE_')
    && (!surfaceId.startsWith('TX_') || ORIGINAL_TRANSACTION_SURFACE_IDS.has(surfaceId))
  )))
const ORIGINAL_SURFACE_SET = new Set(ORIGINAL_SURFACE_IDS)

const SURFACE_LABELS = Object.freeze({
  PUBLIC_HOME: 'public orbit home',
  PUBLIC_NOW: 'Now public detail',
  PUBLIC_DOING: 'Doing public detail',
  PUBLIC_LEARNING: 'Learning public detail',
  PUBLIC_MOMENTS: 'Moments public detail',
  PUBLIC_ARCHIVE: 'Archive public detail',
  LOGIN_OVERLAY: 'login overlay',
  PUBLIC_NAVIGATION_FLOW: 'public enter and return flow',
  PRIVATE_SHELL: 'Daylight Command Center shell',
  PRIVATE_OVERVIEW: 'private overview',
  GLOBAL_SEARCH_OVERLAY: 'global search overlay',
  QUICK_CREATE_OVERLAY: 'quick-create overlay',
  GLOBAL_RETURN_FLOW: 'cross-page return flow',
  GOALS_ROUTE: 'goals and projects workspace',
  SCHEDULE_ROUTE: 'schedule workspace',
  HABITS_ROUTE: 'habit rhythm workspace',
  RECORDS_ROUTE: 'record stream and editor',
  REVIEWS_ROUTE: 'evidence review workspace',
  KNOWLEDGE_ROUTE: 'knowledge workspace',
  PUBLISH_ROUTE: 'publishing workbench',
  SETTINGS_ROUTE: 'settings and data-management workspace',
  PLATFORM_OVERVIEW: 'platform overview',
  PLATFORM_KUBERNETES: 'Kubernetes status subtab',
  PLATFORM_MONITORING: 'monitoring subtab',
  PLATFORM_ALERTS: 'alerts subtab',
  PLATFORM_LOGS: 'logs subtab',
  PLATFORM_RELEASES: 'release status subtab',
  PLATFORM_TECHNOLOGY: 'technology dossier subtab',
  TX_PUBLISH_VERSION_REVOKE: 'publish, version and revoke transaction',
  TX_IMAGE_REGISTRY_HANDOFF: 'image, registry and handoff transaction',
})

const FEATURE_CONTRACTS = Object.freeze({
  PUBLIC_HOME: 'renders the authored ellipse, visible day/night tracks and the five fixed semantic objects without forbidden orbit patterns or technology-logo primaries',
  PUBLIC_NOW: 'renders the current published Now copy with a stable canonical route and fixed return control',
  PUBLIC_DOING: 'renders the current published Doing copy with a stable canonical route and fixed return control',
  PUBLIC_LEARNING: 'renders the current published Learning copy with a stable canonical route and fixed return control',
  PUBLIC_MOMENTS: 'renders the current published Moments copy with a stable canonical route and fixed return control',
  PUBLIC_ARCHIVE: 'renders the current published Archive copy with a stable canonical route and fixed return control',
  LOGIN_OVERLAY: 'opens, submits real credentials, reports failure honestly, closes and transfers authenticated users into the private shell',
  PUBLIC_NAVIGATION_FLOW: 'supports direct routes, legacy redirects, browser back, Escape and focus restoration without wheel-only navigation',
  PRIVATE_SHELL: 'keeps the approved bright continuous canvas, exact top navigation, account entry and route state restoration',
  PRIVATE_OVERVIEW: 'shows server-backed status, timeline, goals, projects, habits, trends, records, reviews, knowledge and the bounded today summary',
  GLOBAL_SEARCH_OVERLAY: 'searches authorized server-backed entities, groups results, preserves context and never exposes private data across users',
  QUICK_CREATE_OVERLAY: 'creates only supported entities through real APIs, validates context and reports success or failure without fake actions',
  GLOBAL_RETURN_FLOW: 'restores route, selection, filters, scroll and focus after forward, reverse and interrupted navigation',
  GOALS_ROUTE: 'supports goals, projects, milestones, risks and next actions with real create, edit, archive and relation flows',
  SCHEDULE_ROUTE: 'supports day, week and month views, task pool, drag and keyboard scheduling, recurrence, conflicts and undo',
  HABITS_ROUTE: 'supports today habits, the 28-day rhythm matrix, rules, quantitative values and all four recording states',
  RECORDS_ROUTE: 'supports filters, timeline, Markdown editing, autosave versions, authenticated media and bidirectional relations',
  REVIEWS_ROUTE: 'builds evidence catalogs and narratives, preserves drafts and converts reviewed insights into traceable actions',
  KNOWLEDGE_ROUTE: 'supports collections, list, reading/editing, sources, relations, review dates and resurfacing',
  PUBLISH_ROUTE: 'supports source selection, editing, preview, scheduling, immutable versions, revoke and public/private auditing',
  SETTINGS_ROUTE: 'supports account, preference and integration settings plus export, import preview, restore point, destructive confirmation and audit',
  PLATFORM_OVERVIEW: 'summarizes only truthful allowlisted server-adapter states and exposes no fabricated platform values',
  PLATFORM_KUBERNETES: 'shows read-only allowlisted Kubernetes application status with honest connected, degraded, disabled and unverified states',
  PLATFORM_MONITORING: 'shows read-only Prometheus and Grafana summaries through bounded server adapters',
  PLATFORM_ALERTS: 'shows read-only Alertmanager state through bounded server adapters',
  PLATFORM_LOGS: 'shows redacted bounded Elasticsearch and Kibana summaries without raw secret-bearing payloads',
  PLATFORM_RELEASES: 'shows GitHub Actions, Argo CD and UHub release facts without treating cluster sync as a Web completion gate',
  PLATFORM_TECHNOLOGY: 'shows the approved technology dossier as a private platform subtab rather than a public primary object',
  TX_PUBLISH_VERSION_REVOKE: 'creates immutable public versions, preserves privacy isolation and makes revoke an explicit audited transaction',
  TX_IMAGE_REGISTRY_HANDOFF: 'binds reproducible Web/API images, immutable digests, exact-digest smoke, supply-chain evidence, production values and the user deployment package',
})

const TASKS_BY_PARENT = Object.freeze({
  'PUB-01': ['P2-T1', 'P2-T2'],
  'PUB-02': ['P2-T4'],
  'AUTH-01': ['P2-T3'],
  'APP-01': ['P3-T1'],
  'GOAL-01': ['P1-T3', 'P3-T2'],
  'SCHEDULE-01': ['P1-T4', 'P3-T3'],
  'HABIT-01': ['P1-T5', 'P3-T4'],
  'RECORD-01': ['P1-T6', 'P3-T5', 'P6-T1'],
  'REVIEW-01': ['P1-T7', 'P3-T6'],
  'KNOW-01': ['P4-T1', 'P4-T2', 'P4-T6'],
  'OBS-01': ['P4-T3', 'P4-T6'],
  'PUBLISH-01': ['P4-T4', 'P4-T5', 'P4-T6'],
  'PLATFORM-01': ['P5-T1', 'P5-T2', 'P5-T3', 'P5-T7'],
  'GLOBAL-01': ['P5-T4', 'P5-T5', 'P5-T6', 'P5-T7'],
  'MOTION-01': ['P1-T2', 'P2-T3', 'P2-T4', 'P2-T5', 'P3-T7', 'P6-T5'],
  'SPACE-01': ['P2-T5', 'P3-T7', 'P6-T5'],
  'STATE-01': ['P1-T2', 'P2-T5', 'P3-T7', 'P5-T7'],
  'DATA-01': ['P1-T1', 'P1-T13', 'P6-T1'],
  'SEC-01': ['P1-T1', 'P4-T4', 'P5-T1', 'P6-T2'],
  'DELIVERY-01': ['P6-T4', 'P6-T6', 'P6-T7', 'P6-T8'],
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
  CALC: ['unit', 'mysql', 'e2e-local'],
  TXN: ['api', 'mysql', 'e2e-local'],
  STATE: ['unit', 'api', 'e2e-local'],
  NAV: ['unit', 'e2e-local'],
  RESP: ['e2e-local', 'visual', 'manual-review'],
  A11Y: ['unit', 'e2e-local', 'a11y', 'manual-review'],
  MOTION: ['unit', 'e2e-local', 'visual', 'manual-review'],
  SEC: ['api', 'security', 'e2e-local'],
  OPS: ['api', 'security', 'e2e-local'],
})

const IMAGE_BOUNDARY_PARENTS = new Set(['PUB-01', 'PUB-02', 'AUTH-01', 'APP-01', 'RECORD-01', 'PUBLISH-01', 'SEC-01'])
const CROSS_CUTTING_PARENTS = new Set(['MOTION-01', 'SPACE-01', 'STATE-01', 'SEC-01'])
const DEFERRED_PURE_LIFE_CLAUSE_IDS = new Set([
  'SC-FINAL_REDESIGN-0045',
  'SC-FINAL_REDESIGN-0185',
  'SC-FINAL_REDESIGN-0228',
])

export function isOriginalDomainClause(clause) {
  if (clause?.classification !== 'mapped' || clause.sourceKey === 'LIFE_DOMAIN') {
    return false
  }
  if (DEFERRED_PURE_LIFE_CLAUSE_IDS.has(clause.id)) return false
  const heading = Array.isArray(clause.headingPath) ? clause.headingPath.join(' / ') : ''
  const text = typeof clause.textSummary === 'string' ? clause.textSummary : ''
  if (/^(?:\|\s*|`)?LIFE-\d+/.test(text)) return false
  if (clause.sourceKey === 'P1' && /P1-T(?:8|9|10|11|12):/.test(heading)) return false
  if (clause.sourceKey === 'P3' && /P3-T(?:8|9|10|11|12|13):/.test(heading)) return false
  if (clause.sourceKey === 'P4' && /P4-T7:/.test(heading)) return false
  if (
    clause.sourceKey === 'MASTER_PLAN'
    && (
      heading.includes('ADR-023 P1-T11 medicine occurrence execution contract')
      || heading.includes('ADR-024 P1-T12 inventory-policy and shopping-recalculation contract')
    )
  ) return false
  if (clause.sourceKey === 'FINAL_REDESIGN' && heading.includes('6.7 生活')) return false
  if (clause.sourceKey === 'EXECUTION_COMPLETENESS' && heading.includes('6.4 生活专区')) return false
  if (clause.sourceKey === 'EXECUTION_COMPLETENESS' && heading.includes('11. 数据闭环审查')) return false
  if (
    clause.sourceKey === 'EXECUTION_COMPLETENESS'
    && heading.includes('6.6 跨页面业务事务')
    && !/发布复制|镜像构建/.test(text)
  ) return false
  return true
}

function originalParentsForSurface(surface) {
  return surface.parentRequirementIds.filter((parentId) => ORIGINAL_PARENT_SET.has(parentId))
}

function selectParent(surface, dimension) {
  const parents = originalParentsForSurface(surface)
  const preferred = {
    STATE: 'STATE-01',
    MOTION: 'MOTION-01',
    SEC: 'SEC-01',
    OPS: 'PLATFORM-01',
  }[dimension]
  if (preferred && parents.includes(preferred)) return preferred
  if ((dimension === 'LAYOUT' || dimension === 'RESP') && parents.includes('SPACE-01')) return 'SPACE-01'
  return parents.find((parentId) => !CROSS_CUTTING_PARENTS.has(parentId)) ?? parents[0]
}

function variantsFor(surface, dimension) {
  if (dimension === 'RESP') {
    return [
      ['desktop-1440', 'at 1440x900 without clipping, card-wall regression or unreachable controls'],
      ['compact-desktop-1024', 'at 1024x768 without clipping, overlap or loss of hierarchy'],
      ['tablet-768', 'at 768x1024 with reachable navigation, content and exit controls'],
      ['mobile-390', 'at 390x844 without horizontal overflow, top-scroll escape or hidden actions'],
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
      ['reverse', 'uses the spatially consistent reverse transition and restores prior state'],
      ['reduced', 'honors prefers-reduced-motion while preserving orientation, feedback and reachability'],
    ]
  }
  if (dimension === 'NAV') {
    return [
      ['enter', 'supports direct entry, stable canonical routes and forward navigation'],
      ['return', 'supports browser back, explicit return or close without losing prior context'],
      ['restore', 'restores selection, filters, scroll and focus after reverse or interrupted navigation'],
    ]
  }
  if (dimension === 'STATE') {
    if (surface.kind === 'platform-subtab') {
      return [
        ['connected', 'shows connected facts only when the allowlisted server adapter verifies them'],
        ['degraded', 'shows degraded or partial data explicitly without converting it into healthy data'],
        ['disabled', 'shows disabled or not-connected integrations as disabled and non-actionable'],
        ['unverified', 'shows unverified state when current evidence is unavailable'],
        ['failure-retry', 'contains adapter failures and offers a bounded retry without fabricated fallback values'],
      ]
    }
    if (surface.id === 'LOGIN_OVERLAY') {
      return [
        ['idle', 'shows a usable initial form without leaking authentication state'],
        ['submitting', 'prevents duplicate submission while preserving cancel and reduced-motion behavior'],
        ['success', 'enters the private shell only after a server-confirmed authenticated session'],
        ['invalid', 'reports invalid credentials without enumeration or fake success'],
        ['offline', 'reports unavailable network state and preserves safe retry behavior'],
      ]
    }
    if (surface.kind === 'route' || surface.kind === 'overlay' || surface.kind === 'shell') {
      const variants = [
        ['loading', 'shows a stable non-flashing loading state'],
        ['empty', 'shows a truthful empty state with a valid next action where creation is allowed'],
        ['error-retry', 'shows a bounded error and retry path without replacing real data with fixtures'],
        ['offline', 'shows offline or pending state honestly and never confirms a write before the server'],
      ]
      if (!surface.id.startsWith('PUBLIC_')) {
        variants.push(['conflict', 'preserves both sides of a version conflict until the user resolves it'])
        variants.push(['permission', 'denies unauthorized data or writes without exposing private content'])
      }
      variants.push(['success', 'shows successful data or completion only after current server confirmation'])
      return variants
    }
    return [
      ['pending', 'exposes a non-final pending state before server confirmation'],
      ['success', 'records success only after the whole contract commits'],
      ['failure', 'leaves no partial committed state after failure'],
      ['conflict', 'reports version or idempotency conflict without duplicate effects'],
    ]
  }
  if (dimension === 'TXN') {
    return [
      ['commit', 'commits the complete write atomically and emits an auditable result'],
      ['retry', 'handles duplicate retry idempotently without duplicating effects'],
      ['rollback', 'rolls back every partial effect on failure and preserves the prior valid state'],
      ['reversal', 'records an explicit undo, revoke or reversal as an audited compensating action linked to the original write'],
    ]
  }
  if (dimension === 'SEC') {
    return [
      ['authorization', 'enforces session, CSRF, ownership and least-privilege authorization before data or actions are exposed'],
      ['sanitization', 'sanitizes content and redacts credentials, secrets and private payloads from output, logs and evidence'],
    ]
  }
  if (dimension === 'OPS') {
    return [
      ['adapter-truth', 'uses only bounded read-only allowlisted server adapters and labels connection truth explicitly'],
      ['limits', 'applies timeout, size, cache, redaction and minimum-RBAC limits without privileged browser access'],
      ['failure', 'contains upstream failures and never invents a platform metric or release state'],
    ]
  }
  const contract = {
    LAYOUT: 'preserves the approved continuous spatial hierarchy, readable density and non-card-wall composition',
    FUNC: FEATURE_CONTRACTS[surface.id],
    DATA: 'uses production Fastify/MySQL or allowlisted adapter data, preserves stable identifiers and ships no preview fixture as production truth',
    CALC: 'derives displayed counts, summaries and impacts from traceable current inputs with deterministic rounding and no fabricated totals',
  }[dimension]
  return [['primary', contract]]
}

function finalBoundaryFor(parentId) {
  if (parentId === 'DELIVERY-01') return ['local', 'image', 'registry']
  if (IMAGE_BOUNDARY_PARENTS.has(parentId)) return ['local', 'image']
  return ['local']
}

function requiredEvidenceFor(parentId, dimension) {
  const evidence = new Set(EVIDENCE_BY_DIMENSION[dimension] ?? ['unit'])
  const boundary = finalBoundaryFor(parentId)
  if (boundary.includes('image')) evidence.add('image')
  if (boundary.includes('registry')) evidence.add('registry')
  return [...evidence]
}

function buildSurfaceAtoms() {
  const atoms = []
  for (const surface of REQUIRED_SURFACES.filter((row) => ORIGINAL_SURFACE_SET.has(row.id))) {
    for (const dimension of surface.requiredDimensions) {
      const parentRequirementId = selectParent(surface, dimension)
      if (!parentRequirementId) continue
      const variants = variantsFor(surface, dimension)
      variants.forEach(([variant, contract], index) => {
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
  ['DATA-01.DATA_MODEL.DATA.01', 'DATA-01', 'ordered migration discovery', 'Discovers numeric migrations in deterministic order, records checksums and refuses unknown gaps or modified applied files.', ['PRIVATE_SHELL'], ['P1-T1', 'P1-T13'], ['unit', 'mysql'], ['local']],
  ['DATA-01.DATA_MODEL.TXN.01', 'DATA-01', 'transactional migration application', 'Applies each migration once inside the planned transaction boundary and records success only after commit.', ['PRIVATE_SHELL'], ['P1-T1'], ['unit', 'mysql'], ['local']],
  ['DATA-01.DATA_MODEL.STATE.01', 'DATA-01', 'legacy compatibility state', 'Upgrades the legacy schema without losing existing rows and reports incompatible drift before mutation.', ['PRIVATE_SHELL'], ['P1-T1', 'P1-T13'], ['unit', 'mysql'], ['local']],
  ['DATA-01.DATA_MODEL.DATA.02', 'DATA-01', 'memory and MySQL parity', 'Keeps memory-test and MySQL production contracts behaviorally equivalent while production remains Fastify/MySQL only.', ['PRIVATE_SHELL'], ['P1-T1', 'P1-T13'], ['unit', 'api', 'mysql'], ['local']],
  ['DATA-01.DATA_MODEL.SEC.01', 'DATA-01', 'tenant data isolation', 'Scopes every persisted entity, query, migration and export to the authenticated owner.', ['PRIVATE_SHELL'], ['P1-T1', 'P6-T1'], ['mysql', 'security'], ['local']],
  ['DATA-01.DATA_MODEL.DATA.03', 'DATA-01', 'history snapshot integrity', 'Preserves completed historical snapshots and changes them only through an explicit audited recalculation.', ['PRIVATE_OVERVIEW'], ['P1-T13'], ['unit', 'mysql'], ['local']],
  ['RECORD-01.RECORDS_ROUTE.DATA.02', 'RECORD-01', 'record cover create default', 'Creates every record with a persisted nullable cover identity whose default is null.', ['RECORDS_ROUTE'], ['P1-T6', 'P3-T5'], ['unit', 'api', 'mysql', 'e2e-local', 'image'], ['local', 'image']],
  ['RECORD-01.RECORDS_ROUTE.DATA.03', 'RECORD-01', 'record cover PATCH omission', 'Preserves the current cover identity when a PATCH omits coverMediaId.', ['RECORDS_ROUTE'], ['P1-T6', 'P3-T5'], ['unit', 'api', 'mysql', 'e2e-local', 'image'], ['local', 'image']],
  ['RECORD-01.RECORDS_ROUTE.DATA.04', 'RECORD-01', 'record cover explicit clear', 'Clears the current cover identity when a PATCH sends coverMediaId as null.', ['RECORDS_ROUTE'], ['P1-T6', 'P3-T5'], ['unit', 'api', 'mysql', 'e2e-local', 'image'], ['local', 'image']],
  ['RECORD-01.RECORDS_ROUTE.DATA.05', 'RECORD-01', 'record cover selection persistence', 'Selects and persists a non-null coverMediaId only when it belongs to the record media set.', ['RECORDS_ROUTE'], ['P1-T6', 'P3-T5'], ['unit', 'api', 'mysql', 'e2e-local', 'image'], ['local', 'image']],
  ['RECORD-01.RECORDS_ROUTE.TXN.05', 'RECORD-01', 'active record cover removal', 'Rejects removing the active cover unless the same atomic request clears it or replaces it with another attached image.', ['RECORDS_ROUTE'], ['P1-T6', 'P3-T5'], ['api', 'mysql', 'e2e-local', 'image'], ['local', 'image']],
  ['RECORD-01.RECORDS_ROUTE.SEC.01', 'RECORD-01', 'record cover owner and privacy boundary', 'Requires the selected cover media to belong to the record owner and never lets cover identity weaken private media authorization.', ['RECORDS_ROUTE'], ['P1-T6', 'P3-T5'], ['api', 'security', 'e2e-local', 'image'], ['local', 'image']],
  ['RECORD-01.RECORDS_ROUTE.NAV.04', 'RECORD-01', 'record source URL parsing', 'Decodes one source query value once, accepts exactly goal|project|task|habit followed by a non-empty ID, and splits only at the first colon.', ['RECORDS_ROUTE'], ['P1-T6', 'P3-T5'], ['unit', 'e2e-local', 'image'], ['local', 'image']],
  ['RECORD-01.RECORDS_ROUTE.FUNC.02', 'RECORD-01', 'record source filter adapter', 'Maps a valid source value only to the existing linkType plus linkId transport filters without table inference or fallback.', ['RECORDS_ROUTE'], ['P1-T6', 'P3-T5'], ['unit', 'api', 'e2e-local', 'image'], ['local', 'image']],
  ['RECORD-01.RECORDS_ROUTE.STATE.01', 'RECORD-01', 'invalid record source filter', 'Contains malformed or duplicate source values as a scoped filter validation error and sends no malformed records request.', ['RECORDS_ROUTE'], ['P1-T6', 'P3-T5'], ['unit', 'api', 'e2e-local', 'image'], ['local', 'image']],
  ['OBS-01.KNOWLEDGE_ROUTE.FUNC.01', 'OBS-01', 'manual Obsidian preview', 'Scans only the configured allowlisted path, previews changes and performs no automatic bidirectional sync.', ['KNOWLEDGE_ROUTE'], ['P4-T3'], ['api', 'e2e-local'], ['local']],
  ['OBS-01.KNOWLEDGE_ROUTE.STATE.01', 'OBS-01', 'Obsidian conflict state', 'Preserves both versions and requires explicit user resolution when file and server versions conflict.', ['KNOWLEDGE_ROUTE'], ['P4-T3'], ['api', 'e2e-local'], ['local']],
  ['OBS-01.KNOWLEDGE_ROUTE.TXN.01', 'OBS-01', 'Obsidian backup and rollback', 'Creates a restorable backup before an approved write and rolls back all affected files if apply fails.', ['KNOWLEDGE_ROUTE'], ['P4-T3'], ['api', 'e2e-local'], ['local']],
  ['OBS-01.KNOWLEDGE_ROUTE.SEC.01', 'OBS-01', 'Obsidian path and privacy boundary', 'Rejects traversal and non-allowlisted paths and excludes credentials and private bodies from logs and evidence.', ['KNOWLEDGE_ROUTE'], ['P4-T3'], ['security', 'e2e-local'], ['local']],
  ['DELIVERY-01.RELEASE_GITHUB.OPS.01', 'DELIVERY-01', 'GitHub release workflow', 'A reproducible GitHub Actions release binds the reviewed source revision to immutable Web and API image outputs.', ['PLATFORM_RELEASES', 'TX_IMAGE_REGISTRY_HANDOFF'], ['P6-T4', 'P6-T6'], ['build', 'security', 'registry'], ['local', 'image', 'registry']],
  ['DELIVERY-01.IMAGE_WEB.FUNC.01', 'DELIVERY-01', 'production Web image', 'Builds and publishes the production lifeops-web image without preview fixtures, mutable-only evidence or embedded credentials.', ['TX_IMAGE_REGISTRY_HANDOFF'], ['P6-T4', 'P6-T6'], ['build', 'image', 'registry'], ['local', 'image', 'registry']],
  ['DELIVERY-01.IMAGE_API.FUNC.01', 'DELIVERY-01', 'production API image', 'Builds and publishes the production lifeops-api image with the Fastify runtime, migrations and no embedded credentials.', ['TX_IMAGE_REGISTRY_HANDOFF'], ['P6-T4', 'P6-T6'], ['build', 'image', 'registry'], ['local', 'image', 'registry']],
  ['DELIVERY-01.EXACT_DIGEST.TXN.01', 'DELIVERY-01', 'exact-digest image smoke', 'Runs Web, API, MySQL, persistence, transaction and media smoke against the exact immutable Web/API digests.', ['TX_IMAGE_REGISTRY_HANDOFF'], ['P6-T6'], ['image', 'mysql', 'e2e-remote', 'registry'], ['local', 'image', 'registry']],
  ['DELIVERY-01.SBOM.DATA.01', 'DELIVERY-01', 'digest-bound SBOM', 'Records a machine-readable SBOM bound to each immutable Web and API digest.', ['TX_IMAGE_REGISTRY_HANDOFF'], ['P6-T4', 'P6-T6'], ['security', 'image', 'registry'], ['local', 'image', 'registry']],
  ['DELIVERY-01.PROVENANCE.SEC.01', 'DELIVERY-01', 'digest-bound provenance', 'Records verifiable build provenance bound to the reviewed source revision and each immutable image digest.', ['TX_IMAGE_REGISTRY_HANDOFF'], ['P6-T4', 'P6-T6'], ['security', 'image', 'registry'], ['local', 'image', 'registry']],
  ['DELIVERY-01.UHUB.OPS.01', 'DELIVERY-01', 'UHub digest inspection', 'Verifies both repositories and immutable digests through UHub inspection after push; a local tar or mutable tag cannot satisfy the gate.', ['PLATFORM_RELEASES', 'TX_IMAGE_REGISTRY_HANDOFF'], ['P6-T6'], ['registry', 'manual-review'], ['local', 'image', 'registry']],
  ['DELIVERY-01.PRODUCTION_VALUES.DATA.01', 'DELIVERY-01', 'production digest values', 'Pins the exact published Web/API digests in production GitOps values with no placeholder or mutable-tag fallback.', ['PLATFORM_RELEASES', 'TX_IMAGE_REGISTRY_HANDOFF'], ['P6-T6', 'P6-T7'], ['registry', 'delivery-package'], ['local', 'image', 'registry']],
  ['DELIVERY-01.HANDOFF_PACKAGE.FUNC.01', 'DELIVERY-01', 'validated user deployment package', 'Validates Helm render, GitOps values, Argo example, post-deploy smoke, backup/restore, media storage, platform integration and rollback instructions without deploying to the user cluster.', ['PLATFORM_RELEASES', 'TX_IMAGE_REGISTRY_HANDOFF'], ['P6-T7', 'P6-T8'], ['delivery-package', 'manual-review', 'registry'], ['local', 'image', 'registry']],
])

function materializeDedicatedAtoms() {
  return DEDICATED_ATOMS.map(([id, parentRequirementId, title, contract, surfaces, plannedTasks, requiredEvidence, finalBoundary]) => ({
    id,
    parentRequirementId,
    title,
    contract,
    sourceClauseIds: [],
    surfaces,
    plannedTasks,
    requiredEvidence,
    finalBoundary,
    notApplicable: null,
  }))
}

function extractExplicitParents(text) {
  return ORIGINAL_PARENT_REQUIREMENT_IDS.filter((parentId) => text.includes(parentId))
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
  for (const surface of REQUIRED_SURFACES.filter((row) => ORIGINAL_SURFACE_SET.has(row.id))) {
    if (surface.path !== '/' && searchable.includes(surface.path.replace(/^\w+:/, ''))) {
      routeParents.push(...originalParentsForSurface(surface).filter((parentId) => !CROSS_CUTTING_PARENTS.has(parentId)))
    }
  }
  if (routeParents.length) return [...new Set(routeParents)]

  if (clause.sourceKey === 'IMAGE_DELIVERY_BOUNDARY' || clause.sourceKey === 'P6') return ['DELIVERY-01']
  if (clause.sourceKey === 'P2') return ['PUB-01']
  if (clause.sourceKey === 'P3') return ['APP-01']
  if (clause.sourceKey === 'P4') return ['KNOW-01']
  if (clause.sourceKey === 'P5') return ['PLATFORM-01']
  if (/security|session|CSRF|secret|privacy|RBAC|权限|安全|凭据|隐私/i.test(searchable)) return ['SEC-01']
  if (/motion|transition|animation|reduced|动效|转场|动态/i.test(searchable)) return ['MOTION-01']
  if (/visual|layout|canvas|geometry|视觉|布局|画布|几何/i.test(searchable)) return ['SPACE-01']
  if (/state|loading|empty|error|conflict|offline|状态|空态|错误|冲突|离线/i.test(searchable)) return ['STATE-01']
  return ['DATA-01']
}

function inferDimensions(clause) {
  const text = `${clause.headingPath.join(' / ')} ${clause.textSummary}`
  const dimensions = []
  const rules = [
    ['RESP', /responsive|breakpoint|1440|1024|768|390|mobile|tablet|响应式|断点|移动端|平板/i],
    ['A11Y', /accessib|keyboard|focus|aria|screen reader|键盘|焦点|无障碍/i],
    ['MOTION', /motion|transition|animation|reduced|interrupt|动效|转场|动态|中断/i],
    ['NAV', /route|navigation|redirect|back|return|close|Escape|Esc|deep link|路由|导航|返回|关闭/i],
    ['SEC', /security|session|CSRF|secret|privacy|sanitize|redact|RBAC|permission|auth|安全|会话|凭据|隐私|脱敏|权限|认证/i],
    ['OPS', /Prometheus|Grafana|Alertmanager|Kubernetes|Kibana|Elasticsearch|Argo|UHub|adapter|platform|监控|告警|平台|适配器/i],
    ['TXN', /transaction|atomic|idempoten|rollback|reversal|undo|commit|事务|原子|幂等|回滚|撤销|提交/i],
    ['CALC', /calculate|calculation|formula|aggregate|cost|budget|count|计算|公式|聚合|成本|预算/i],
    ['STATE', /loading|empty|error|conflict|offline|degraded|disabled|unverified|retry|failure|状态|空态|错误|冲突|离线|降级|禁用|未验证|重试|失败/i],
    ['DATA', /schema|model|data|MySQL|migration|snapshot|storage|version|checksum|数据|模型|迁移|快照|存储|版本|校验和/i],
    ['LAYOUT', /layout|geometry|spacing|typography|canvas|orbit|visual|布局|几何|间距|排版|画布|轨道|视觉/i],
  ]
  for (const [dimension, pattern] of rules) {
    if (pattern.test(text)) dimensions.push(dimension)
  }
  return dimensions.length ? dimensions.slice(0, 4) : ['FUNC']
}

function inferSurfaceIds(clause) {
  const text = `${clause.headingPath.join(' / ')} ${clause.textSummary}`
  const ids = []
  for (const surface of REQUIRED_SURFACES.filter((row) => ORIGINAL_SURFACE_SET.has(row.id))) {
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
  const preferences = {
    LAYOUT: ['SPACE-01'],
    RESP: ['SPACE-01'],
    MOTION: ['MOTION-01'],
    STATE: ['STATE-01'],
    SEC: ['SEC-01'],
    OPS: ['PLATFORM-01', 'DELIVERY-01'],
  }[dimension] ?? []
  return preferences.find((parentId) => parents.includes(parentId)) ?? null
}

const RECORD_CONTRACT_CLAUSE_RULES = Object.freeze([
  ['封面以持久化的可空 `coverMediaId` 表达', ['RECORD-01.RECORDS_ROUTE.DATA.02', 'RECORD-01.RECORDS_ROUTE.DATA.03', 'RECORD-01.RECORDS_ROUTE.DATA.04', 'RECORD-01.RECORDS_ROUTE.DATA.05', 'RECORD-01.RECORDS_ROUTE.TXN.05', 'RECORD-01.RECORDS_ROUTE.SEC.01']],
  ['页面 URL 的单个 `source=` 只接受一次解码', ['RECORD-01.RECORDS_ROUTE.NAV.04', 'RECORD-01.RECORDS_ROUTE.FUNC.02', 'RECORD-01.RECORDS_ROUTE.STATE.01']],
  ['`RECORD-01` 的封面生命周期必须拆成独立可判定条目', ['RECORD-01.RECORDS_ROUTE.DATA.02', 'RECORD-01.RECORDS_ROUTE.DATA.03', 'RECORD-01.RECORDS_ROUTE.DATA.04', 'RECORD-01.RECORDS_ROUTE.DATA.05', 'RECORD-01.RECORDS_ROUTE.TXN.05']],
  ['`RECORD-01` 的封面 owner/私有媒体授权必须独立于展示身份验证', ['RECORD-01.RECORDS_ROUTE.SEC.01', 'RECORD-01.RECORDS_ROUTE.NAV.04', 'RECORD-01.RECORDS_ROUTE.FUNC.02', 'RECORD-01.RECORDS_ROUTE.STATE.01']],
  ['Records persist nullable `coverMediaId` independently', ['RECORD-01.RECORDS_ROUTE.DATA.02', 'RECORD-01.RECORDS_ROUTE.DATA.03', 'RECORD-01.RECORDS_ROUTE.DATA.04', 'RECORD-01.RECORDS_ROUTE.DATA.05', 'RECORD-01.RECORDS_ROUTE.TXN.05', 'RECORD-01.RECORDS_ROUTE.SEC.01', 'RECORD-01.RECORDS_ROUTE.NAV.04', 'RECORD-01.RECORDS_ROUTE.FUNC.02', 'RECORD-01.RECORDS_ROUTE.STATE.01']],
  ['ADR-026 extends this closed P1 contract additively', ['RECORD-01.RECORDS_ROUTE.DATA.02', 'RECORD-01.RECORDS_ROUTE.DATA.03', 'RECORD-01.RECORDS_ROUTE.DATA.04', 'RECORD-01.RECORDS_ROUTE.DATA.05', 'RECORD-01.RECORDS_ROUTE.TXN.05', 'RECORD-01.RECORDS_ROUTE.SEC.01']],
  ['Create: `server/migrations/012_record_cover_identity.sql`', ['RECORD-01.RECORDS_ROUTE.DATA.02', 'RECORD-01.RECORDS_ROUTE.DATA.03', 'RECORD-01.RECORDS_ROUTE.DATA.04', 'RECORD-01.RECORDS_ROUTE.DATA.05', 'RECORD-01.RECORDS_ROUTE.TXN.05']],
  ['`LifeRecord.coverMediaId: string | null` is a persisted display identity', ['RECORD-01.RECORDS_ROUTE.DATA.02', 'RECORD-01.RECORDS_ROUTE.DATA.03', 'RECORD-01.RECORDS_ROUTE.DATA.04', 'RECORD-01.RECORDS_ROUTE.DATA.05', 'RECORD-01.RECORDS_ROUTE.TXN.05', 'RECORD-01.RECORDS_ROUTE.SEC.01']],
  ['The page decodes one `source=<goal|project|task|habit>:<non-empty-id>`', ['RECORD-01.RECORDS_ROUTE.NAV.04', 'RECORD-01.RECORDS_ROUTE.FUNC.02', 'RECORD-01.RECORDS_ROUTE.STATE.01']],
  ['[ ] **Step 4: Write failing page and record-contract tests**', ['RECORD-01.RECORDS_ROUTE.DATA.02', 'RECORD-01.RECORDS_ROUTE.DATA.03', 'RECORD-01.RECORDS_ROUTE.DATA.04', 'RECORD-01.RECORDS_ROUTE.DATA.05', 'RECORD-01.RECORDS_ROUTE.TXN.05', 'RECORD-01.RECORDS_ROUTE.SEC.01', 'RECORD-01.RECORDS_ROUTE.NAV.04', 'RECORD-01.RECORDS_ROUTE.FUNC.02', 'RECORD-01.RECORDS_ROUTE.STATE.01']],
])

function explicitRecordContractAtoms(clause, atoms) {
  const rule = RECORD_CONTRACT_CLAUSE_RULES.find(([prefix]) => clause.textSummary.startsWith(prefix))
  if (!rule) return null
  const atomIds = rule[1]
  const knownAtomIds = new Set(atoms.map((atom) => atom.id))
  const missing = atomIds.filter((atomId) => !knownAtomIds.has(atomId))
  if (missing.length) throw new Error(`Record contract clause references unknown atoms: ${missing.join(', ')}`)
  return atomIds
}

function selectAtomsForClause(clause, atoms) {
  const explicit = explicitRecordContractAtoms(clause, atoms)
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
      const matchedDimension = candidates.length > 0
      if (!matchedDimension) candidates = parentAtoms
      if (!candidates.length) continue
      const broadVariantClause = dimension === 'RESP' && /1440|1024|768|390|four breakpoints|四个断点/i.test(clause.textSummary)
      const picked = broadVariantClause && matchedDimension
        ? candidates
        : [candidates[stableIndex(clause.id, candidates.length)]]
      selected.push(...picked.map((atom) => atom.id))
    }
  }
  return [...new Set(selected)]
}

function canonicalClauseByParent(clauses, parentId) {
  return clauses.find((clause) => clause.textSummary.startsWith(`| ${parentId} |`))
    ?? clauses.find((clause) => inferParents(clause).includes(parentId))
}

export function buildOriginalAcceptance(matrix, sourceRegistry) {
  const originalClauses = sourceRegistry.clauses.filter(isOriginalDomainClause)
  const preservedAtoms = matrix.atoms.filter((atom) => !ORIGINAL_PARENT_SET.has(atom.parentRequirementId))
  const originalAtoms = [...buildSurfaceAtoms(), ...materializeDedicatedAtoms()]
  const atomById = new Map(originalAtoms.map((atom) => [atom.id, atom]))
  const clauseToAtoms = new Map()

  for (const clause of originalClauses) {
    clauseToAtoms.set(clause.id, selectAtomsForClause(clause, originalAtoms))
  }

  for (const atom of originalAtoms) {
    const canonical = canonicalClauseByParent(originalClauses, atom.parentRequirementId)
    if (!canonical) throw new Error(`No canonical source clause for ${atom.parentRequirementId}`)
    atom.sourceClauseIds.push(canonical.id)
    const mapped = clauseToAtoms.get(canonical.id) ?? []
    mapped.push(atom.id)
    clauseToAtoms.set(canonical.id, [...new Set(mapped)])
  }

  for (const [clauseId, atomIds] of clauseToAtoms) {
    if (!atomIds.length) throw new Error(`Original source clause ${clauseId} did not map to an atom`)
    for (const atomId of atomIds) {
      const atom = atomById.get(atomId)
      if (!atom) throw new Error(`Unknown generated atom ${atomId}`)
      if (!atom.sourceClauseIds.includes(clauseId)) atom.sourceClauseIds.push(clauseId)
    }
  }

  for (const atom of originalAtoms) atom.sourceClauseIds.sort()
  const clauses = sourceRegistry.clauses.map((clause) => {
    if (clauseToAtoms.has(clause.id)) {
      const preservedCrossDomainAtomIds = clause.atomIds.filter((atomId) => (
        !atomById.has(atomId) && !atomId.startsWith('ATOM-')
      ))
      return {
        ...clause,
        atomIds: [...new Set([...preservedCrossDomainAtomIds, ...clauseToAtoms.get(clause.id)])].sort(),
      }
    }
    if (clause.classification !== 'mapped') return clause
    const preservedAtomIds = clause.atomIds.filter((atomId) => !atomById.has(atomId))
    return {
      ...clause,
      atomIds: preservedAtomIds.length ? preservedAtomIds : [`ATOM-${clause.id}`],
    }
  })
  const nextMatrix = { ...matrix, atoms: [...preservedAtoms, ...originalAtoms] }
  const nextRegistry = { ...sourceRegistry, clauses }
  const issues = validateAcceptanceMatrix(nextMatrix, nextRegistry)
  if (issues.length) throw new Error(`Generated acceptance matrix is invalid: ${JSON.stringify(issues.slice(0, 20))}`)
  return { matrix: nextMatrix, sourceRegistry: nextRegistry }
}

export function collectOriginalAcceptanceCoverageGaps(matrix, sourceRegistry) {
  const atoms = Array.isArray(matrix?.atoms) ? matrix.atoms : []
  const originalAtoms = atoms.filter((atom) => ORIGINAL_PARENT_SET.has(atom.parentRequirementId))
  const atomsById = new Map(originalAtoms.map((atom) => [atom.id, atom]))
  const missingParents = ORIGINAL_PARENT_REQUIREMENT_IDS.filter((parentId) => (
    !originalAtoms.some((atom) => atom.parentRequirementId === parentId)
  ))
  const missingMappedClauseIds = sourceRegistry.clauses
    .filter(isOriginalDomainClause)
    .filter((clause) => !clause.atomIds.some((atomId) => {
      const atom = atomsById.get(atomId)
      return atom?.sourceClauseIds.includes(clause.id)
    }))
    .map((clause) => clause.id)

  const surfacesById = new Map(matrix.surfaces.map((surface) => [surface.id, surface]))
  const missingSurfaceDimensions = []
  for (const surfaceId of ORIGINAL_SURFACE_IDS) {
    const surface = surfacesById.get(surfaceId)
    for (const dimension of surface?.requiredDimensions ?? []) {
      if (!originalAtoms.some((atom) => atom.surfaces.includes(surfaceId) && atom.id.split('.')[2] === dimension)) {
        missingSurfaceDimensions.push(`${surfaceId}:${dimension}`)
      }
    }
  }
  return { missingParents, missingMappedClauseIds, missingSurfaceDimensions }
}
