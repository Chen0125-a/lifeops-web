import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import {
  AUTHORITY_FILES,
  PARENT_REQUIREMENT_IDS,
  SOURCE_PATH_BY_KEY,
  WORK_PACKAGE_FILES,
} from './execution-contract/constants.mjs'
import {
  normalizeRelativePath,
  readJson,
  sha256Text,
} from './execution-contract/load-json.mjs'
import { extractClauseCandidates } from './execution-contract/markdown-clauses.mjs'
import {
  readAuthoritySnapshot,
  verifyAuthorityHashes,
} from './execution-contract/authority.mjs'
import {
  buildLocalCheckpoint,
  collectCheckpointInputs,
} from './execution-contract/source-checkpoint.mjs'
import {
  applySourceClauseReviewRules,
  buildSourceClauseCandidates,
  mergeSourceClauseRegistry,
  validateSourceClauses,
} from './execution-contract/source-clauses.mjs'
import {
  REQUIRED_SURFACES,
  validateAcceptanceMatrix,
} from './execution-contract/acceptance.mjs'
import {
  buildOriginalAcceptance,
  collectOriginalAcceptanceCoverageGaps,
  isOriginalDomainClause,
  ORIGINAL_PARENT_REQUIREMENT_IDS,
} from './execution-contract/original-atoms.mjs'
import {
  buildLifeAcceptance,
  collectLifeAcceptanceCoverageGaps,
  isLifeDomainClause,
  LIFE_PARENT_REQUIREMENT_IDS,
  LIFE_SURFACE_IDS,
  LIFE_TRANSACTION_SURFACE_IDS,
} from './execution-contract/life-atoms.mjs'
import {
  deriveAtomStatus,
  deriveParentStatus,
  validateEvidenceManifest,
} from './execution-contract/evidence.mjs'
import {
  buildStartupReport,
  parseExecutionState,
  parseMirrorState,
  parseRequirementsBoundary,
  validateStartup,
} from './execution-contract/startup.mjs'
import {
  loadProjectState,
  resolveProjectMemoryRoot,
} from './execution-contract/project-state.mjs'
import {
  buildPhaseCloseContext,
  validateHandoff,
  validatePhaseClose,
  validateProjectClose,
  validateTaskClose,
} from './execution-contract/close-modes.mjs'

const execFileAsync = promisify(execFile)

const EXPECTED_AUTHORITY_FILES = [
  'docs/superpowers/specs/2026-08-09-lifeops-web-final-redesign-design.md',
  'docs/superpowers/specs/2026-08-10-lifeops-life-domain-design.md',
  'docs/superpowers/specs/2026-08-10-lifeops-execution-completeness-design.md',
  'docs/superpowers/specs/2026-08-10-lifeops-web-image-delivery-boundary-design.md',
  'docs/superpowers/plans/2026-08-09-00-lifeops-final-master-plan.md',
]

const EXPECTED_WORK_PACKAGE_FILES = [
  'docs/superpowers/plans/2026-08-09-01-lifeops-foundation-data-plan.md',
  'docs/superpowers/plans/2026-08-09-02-lifeops-public-auth-plan.md',
  'docs/superpowers/plans/2026-08-09-03-lifeops-private-core-plan.md',
  'docs/superpowers/plans/2026-08-09-04-lifeops-knowledge-publishing-obsidian-plan.md',
  'docs/superpowers/plans/2026-08-09-05-lifeops-platform-global-plan.md',
  'docs/superpowers/plans/2026-08-09-06-lifeops-production-delivery-plan.md',
]

const EXPECTED_ORIGINAL_PARENT_IDS = [
  'PUB-01',
  'PUB-02',
  'AUTH-01',
  'APP-01',
  'GOAL-01',
  'SCHEDULE-01',
  'HABIT-01',
  'RECORD-01',
  'REVIEW-01',
  'KNOW-01',
  'OBS-01',
  'PUBLISH-01',
  'PLATFORM-01',
  'GLOBAL-01',
  'MOTION-01',
  'SPACE-01',
  'STATE-01',
  'DATA-01',
  'SEC-01',
  'DELIVERY-01',
]

async function writeFixtureTree(root, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(root, ...relativePath.split('/'))
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, contents, 'utf8')
  }
}

function rawSha256(contents) {
  return createHash('sha256').update(contents, 'utf8').digest('hex').toUpperCase()
}

async function fileExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function makeSourceCandidate(sourceKey, ordinal = 1, text = `Clause from ${sourceKey}`) {
  return {
    sourceKey,
    sourcePath: SOURCE_PATH_BY_KEY[sourceKey],
    headingPath: ['Fixture section'],
    kind: 'paragraph',
    ordinal,
    text,
    textSha256: sha256Text(text),
  }
}

function clauseFromCandidate(candidate, id, overrides = {}) {
  return {
    id,
    sourceKey: candidate.sourceKey,
    sourcePath: candidate.sourcePath,
    headingPath: candidate.headingPath,
    kind: candidate.kind,
    ordinal: candidate.ordinal,
    textSummary: candidate.text,
    textSha256: candidate.textSha256,
    classification: 'context-only',
    atomIds: [],
    reason: 'Fixture-only background used for structural validation.',
    supersededBy: null,
    ...overrides,
  }
}

function makeValidSourceRegistry() {
  const candidates = Object.keys(SOURCE_PATH_BY_KEY).map((sourceKey) => makeSourceCandidate(sourceKey))
  const registry = {
    schemaVersion: 1,
    sources: Object.entries(SOURCE_PATH_BY_KEY).map(([sourceKey, sourcePath]) => ({ sourceKey, sourcePath })),
    clauses: candidates.map((candidate, index) => clauseFromCandidate(
      candidate,
      `SC-${candidate.sourceKey}-${String(index + 1).padStart(4, '0')}`,
    )),
  }
  return { candidates, registry }
}

const MINIMUM_VISIBLE_DIMENSIONS = [
  'LAYOUT',
  'FUNC',
  'DATA',
  'STATE',
  'NAV',
  'RESP',
  'A11Y',
  'MOTION',
]

const EXPECTED_REQUIRED_SURFACE_IDS = [
  'PUBLIC_HOME',
  'PUBLIC_NOW',
  'PUBLIC_DOING',
  'PUBLIC_LEARNING',
  'PUBLIC_MOMENTS',
  'PUBLIC_ARCHIVE',
  'LOGIN_OVERLAY',
  'PUBLIC_NAVIGATION_FLOW',
  'PRIVATE_SHELL',
  'PRIVATE_OVERVIEW',
  'GLOBAL_SEARCH_OVERLAY',
  'QUICK_CREATE_OVERLAY',
  'GLOBAL_RETURN_FLOW',
  'GOALS_ROUTE',
  'SCHEDULE_ROUTE',
  'HABITS_ROUTE',
  'RECORDS_ROUTE',
  'REVIEWS_ROUTE',
  'KNOWLEDGE_ROUTE',
  'PUBLISH_ROUTE',
  'SETTINGS_ROUTE',
  'LIFE_TODAY_ROUTE',
  'LIFE_CALENDAR_OVERLAY',
  'LIFE_CALENDAR_ROUTE',
  'LIFE_PLANS_ROUTE',
  'LIFE_INGREDIENTS_ROUTE',
  'LIFE_RECIPES_ROUTE',
  'LIFE_MEDICINES_ROUTE',
  'LIFE_FITNESS_ROUTE',
  'LIFE_HOUSEHOLD_ROUTE',
  'LIFE_SHOPPING_ROUTE',
  'LIFE_ANALYTICS_ROUTE',
  'LIFE_DATA_ROUTE',
  'PLATFORM_OVERVIEW',
  'PLATFORM_KUBERNETES',
  'PLATFORM_MONITORING',
  'PLATFORM_ALERTS',
  'PLATFORM_LOGS',
  'PLATFORM_RELEASES',
  'PLATFORM_TECHNOLOGY',
  'TX_MASTER_DATA_RECALCULATION',
  'TX_MEAL_COMPLETION',
  'TX_MEAL_REVERSAL',
  'TX_MEDICINE_OCCURRENCE',
  'TX_PREPARED_FOOD',
  'TX_SHOPPING_RECALCULATION',
  'TX_PURCHASE',
  'TX_RETURN_REFUND',
  'TX_TEMPLATE_SYNC_COPY',
  'TX_TRASH_IMPORT_OBSIDIAN',
  'TX_PUBLISH_VERSION_REVOKE',
  'TX_IMAGE_REGISTRY_HANDOFF',
]

const LIFE_PARENT_REQUIREMENT_SET = new Set(LIFE_PARENT_REQUIREMENT_IDS)

function makeValidAcceptanceFixture() {
  const { candidates, registry: sourceRegistry } = makeValidSourceRegistry()
  const sourceClauseId = sourceRegistry.clauses[0].id
  const matrix = {
    schemaVersion: 1,
    parentRequirementIds: [...PARENT_REQUIREMENT_IDS],
    surfaces: structuredClone(REQUIRED_SURFACES),
    atoms: [{
      id: 'LIFE-07.RECIPES.FUNC.01',
      parentRequirementId: 'LIFE-07',
      title: 'Create a recipe',
      contract: 'A user can create one recipe with validated ingredients.',
      sourceClauseIds: [sourceClauseId],
      surfaces: ['LIFE_RECIPES_ROUTE'],
      plannedTasks: ['P1-T10', 'P3-T10'],
      requiredEvidence: ['unit', 'api', 'mysql', 'e2e-local'],
      finalBoundary: ['local'],
      notApplicable: null,
    }],
  }
  return { candidates, matrix, sourceRegistry }
}

test('locks the exact five authority files, six work packages and 44 parent IDs', () => {
  assert.deepEqual(AUTHORITY_FILES, EXPECTED_AUTHORITY_FILES)
  assert.deepEqual(WORK_PACKAGE_FILES, EXPECTED_WORK_PACKAGE_FILES)
  assert.deepEqual(PARENT_REQUIREMENT_IDS.slice(0, 20), EXPECTED_ORIGINAL_PARENT_IDS)
  assert.deepEqual(
    PARENT_REQUIREMENT_IDS.slice(20),
    Array.from({ length: 24 }, (_, index) => `LIFE-${String(index + 1).padStart(2, '0')}`),
  )
  assert.equal(new Set(PARENT_REQUIREMENT_IDS).size, 44)
})

test('keeps planned migrations unique and contiguous after the applied foundation migration', async () => {
  const declarations = []
  for (const sourcePath of WORK_PACKAGE_FILES) {
    const markdown = await readFile(path.resolve(sourcePath), 'utf8')
    for (const match of markdown.matchAll(/Create: `server\/migrations\/(\d{3}_[a-z0-9_]+\.sql)`/g)) {
      declarations.push(match[1])
    }
  }

  assert.deepEqual(declarations, [
    '002_domain_foundation.sql',
    '003_habit_goal_project_links.sql',
    '004_records_media.sql',
    '005_reviews.sql',
    '006_life_catalog.sql',
    '007_life_inventory.sql',
    '008_life_recipes.sql',
    '009_life_planning.sql',
    '010_life_commerce.sql',
    '011_goal_hierarchy_recovery.sql',
    '012_record_cover_identity.sql',
    '013_knowledge.sql',
    '014_publishing.sql',
    '015_search.sql',
    '016_settings_audit.sql',
  ])
})

test('normalizes paths and hashes equivalent CRLF and LF text identically', () => {
  assert.equal(normalizeRelativePath('docs\\traceability\\requirements.md'), 'docs/traceability/requirements.md')
  assert.equal(normalizeRelativePath('./docs//traceability/requirements.md'), 'docs/traceability/requirements.md')
  assert.match(sha256Text('first\r\nsecond\r\n'), /^[A-F0-9]{64}$/)
  assert.equal(sha256Text('first\r\nsecond\r\n'), sha256Text('first\nsecond\n'))
})

test('loads strict JSON and identifies the invalid file in parse failures', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lifeops-execution-contract-'))
  t.after(() => rm(directory, { recursive: true, force: true }))

  const validPath = path.join(directory, 'valid.json')
  const invalidPath = path.join(directory, 'invalid.json')
  await writeFile(validPath, '{"schemaVersion":1}\n', 'utf8')
  await writeFile(invalidPath, '{"schemaVersion":1,}\n', 'utf8')

  assert.deepEqual(await readJson(validPath), { schemaVersion: 1 })
  await assert.rejects(readJson(invalidPath), /invalid\.json/)
})

test('extracts headings, paragraphs, list items and table rows deterministically', () => {
  const fixtureMarkdown = [
    '# Delivery Contract',
    '',
    'First line of the paragraph.',
    'Second line of the paragraph.',
    '',
    '- Preserve source order.',
    '',
    '| immutable digest | required |',
    '',
  ].join('\r\n')

  const first = extractClauseCandidates('FINAL_REDESIGN', fixtureMarkdown)
  const second = extractClauseCandidates('FINAL_REDESIGN', fixtureMarkdown.replaceAll('\r\n', '\n'))

  assert.deepEqual(first, second)
  assert.deepEqual(first.map((row) => row.kind), [
    'heading',
    'paragraph',
    'list-item',
    'table-row',
  ])
  assert.deepEqual(first.map((row) => row.ordinal), [1, 1, 1, 1])
  assert.deepEqual(first[1].headingPath, ['Delivery Contract'])
  assert.equal(first[0].sourcePath, SOURCE_PATH_BY_KEY.FINAL_REDESIGN)
  assert.equal(first[1].text, 'First line of the paragraph.\nSecond line of the paragraph.')
  assert.match(first[2].textSha256, /^[A-F0-9]{64}$/)
})

test('normalizes work-package checkbox progress without changing clause identity', () => {
  const pending = extractClauseCandidates('P1', [
    '# Foundation',
    '- [ ] **Step 1: Write the failing migration test.**',
  ].join('\n'))
  const completed = extractClauseCandidates('P1', [
    '# Foundation',
    '- [x] **Step 1: Write the failing migration test.**',
  ].join('\n'))

  assert.deepEqual(completed, pending)
})

test('tracks nested heading paths and ordinals within the same heading and kind', () => {
  const rows = extractClauseCandidates('LIFE_DOMAIN', [
    '# Life',
    '## Inventory',
    '- Purchase',
    '- Consume',
    '## Budget',
    'One paragraph.',
  ].join('\n'))

  assert.deepEqual(rows.map((row) => row.headingPath), [
    ['Life'],
    ['Life', 'Inventory'],
    ['Life', 'Inventory'],
    ['Life', 'Inventory'],
    ['Life', 'Budget'],
    ['Life', 'Budget'],
  ])
  assert.deepEqual(rows.filter((row) => row.kind === 'list-item').map((row) => row.ordinal), [1, 2])
})

test('keeps heading paths dense when ATX levels are skipped', () => {
  const rows = extractClauseCandidates('FINAL_REDESIGN', [
    '# Parent',
    '### Skipped level',
    'Clause.',
  ].join('\n'))

  assert.deepEqual(rows.map((row) => row.headingPath), [
    ['Parent'],
    ['Parent', 'Skipped level'],
    ['Parent', 'Skipped level'],
  ])
})

test('rejects unknown source keys outside the fixed eleven-file set', () => {
  assert.throws(
    () => extractClauseCandidates('UNAPPROVED_SOURCE', '# Not approved'),
    /Unknown source key: UNAPPROVED_SOURCE/,
  )
})

test('parses the five approved authority rows from execution-control text', () => {
  const text = [
    '| Authority | SHA-256 at approval |',
    '|---|---|',
    '| `docs/superpowers/specs/2026-08-09-lifeops-web-final-redesign-design.md` | `39F514E8EC394CF930C89D29BFAF835E7CD52AD4F39912D1B599908116ED1D6C` |',
    '| `docs/superpowers/specs/2026-08-10-lifeops-life-domain-design.md` | `C8DEEC73C9A33FAE5803FD607A839BC3AEC66720377AD3F40B8C91D9D689D3BD` |',
    '| `docs/superpowers/specs/2026-08-10-lifeops-execution-completeness-design.md` | `6CAC018A448649D4543B6B42EFF1FAB7A8E167AECD04EDB3769D40A4533A7C47` |',
    '| `docs/superpowers/specs/2026-08-10-lifeops-web-image-delivery-boundary-design.md` | `CC245BCFF4F36F64672763683A5599BF4B9AE25BB4110B3C425C3B8837BB9261` |',
    '| `docs/superpowers/plans/2026-08-09-00-lifeops-final-master-plan.md` | `7723DE969A8E4A987DA333F91FBE333BE7213730AF734CE3F0ED5792565967C5` |',
    '| `docs/traceability/requirements.md` | `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` |',
  ].join('\n')

  assert.deepEqual(
    [...readAuthoritySnapshot(text)],
    [
      [EXPECTED_AUTHORITY_FILES[0], '39F514E8EC394CF930C89D29BFAF835E7CD52AD4F39912D1B599908116ED1D6C'],
      [EXPECTED_AUTHORITY_FILES[1], 'C8DEEC73C9A33FAE5803FD607A839BC3AEC66720377AD3F40B8C91D9D689D3BD'],
      [EXPECTED_AUTHORITY_FILES[2], '6CAC018A448649D4543B6B42EFF1FAB7A8E167AECD04EDB3769D40A4533A7C47'],
      [EXPECTED_AUTHORITY_FILES[3], 'CC245BCFF4F36F64672763683A5599BF4B9AE25BB4110B3C425C3B8837BB9261'],
      [EXPECTED_AUTHORITY_FILES[4], '7723DE969A8E4A987DA333F91FBE333BE7213730AF734CE3F0ED5792565967C5'],
    ],
  )
})

test('reports only the authority file whose content drifted', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lifeops-authority-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const snapshot = new Map()
  const files = {}
  for (const [index, relativePath] of AUTHORITY_FILES.entries()) {
    const contents = `approved authority ${index + 1}\n`
    files[relativePath] = contents
    snapshot.set(relativePath, rawSha256(contents))
  }
  await writeFixtureTree(root, files)
  await writeFixtureTree(root, { [AUTHORITY_FILES[2]]: 'drifted authority\n' })

  const issues = await verifyAuthorityHashes(root, snapshot)

  assert.deepEqual(issues.map((issue) => issue.code), ['AUTHORITY_HASH_MISMATCH'])
  assert.equal(issues[0].path, AUTHORITY_FILES[2])
  assert.equal(issues[0].expected, snapshot.get(AUTHORITY_FILES[2]))
  assert.equal(issues[0].actual, rawSha256('drifted authority\n'))
})

test('collects only sorted checkpoint inputs from approved source classes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lifeops-checkpoint-inputs-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  await writeFixtureTree(root, {
    '.dockerignore': 'included',
    '.git/config': 'excluded',
    '.github/workflows/release.yml': 'included',
    '.idea/workspace.xml': 'excluded',
    '.vscode/settings.json': 'excluded',
    'Dockerfile': 'included',
    'index.html': 'included',
    'README.md': 'included',
    'DESIGN.md': 'included',
    'PRODUCT.md': 'included',
    'DEPLOYMENT.md': 'included',
    'deploy/chart.yaml': 'included',
    'dist/app.js': 'excluded',
    'docker-entrypoint.sh': 'included',
    'docs/traceability/notes.md': 'excluded',
    'docs/traceability/requirements.md': 'included',
    'docs/traceability/acceptance-matrix.json': 'included',
    'docs/traceability/evidence-manifest.json': 'excluded dynamic evidence metadata',
    'docs/traceability/source-clauses.json': 'included',
    'docs/runbooks/user-deployment-checklist.md': 'included',
    'docs/handoff/NEW_TASK_CONTINUATION_PROMPT.md': 'excluded to avoid checkpoint self-reference',
    'nginx.conf': 'included',
    'node_modules/pkg/index.js': 'excluded',
    'outputs/evidence/old.json': 'excluded',
    'outputs/final/release.json': 'excluded',
    'package-lock.json': 'included',
    'package.json': 'included',
    'playwright-report/index.html': 'excluded',
    'playwright.config.ts': 'included',
    'playwright.remote.config.ts': 'included',
    'playwright.remote.image.config.ts': 'included',
    'public/asset.svg': 'included',
    'scripts/tool.mjs': 'included',
    'server/Dockerfile': 'included',
    'server/dist/index.js': 'excluded',
    'server/migrations/001.sql': 'included',
    'server/node_modules/pkg/index.js': 'excluded',
    'server/package-lock.json': 'included',
    'server/package.json': 'included',
    'server/src/index.ts': 'included',
    'server/tsconfig.json': 'included',
    'server/vitest.config.ts': 'included',
    'src/app.ts': 'included',
    'src/.env.production': 'excluded',
    'src/credential.json': 'excluded',
    'src/kubeconfig.yaml': 'excluded',
    'src/private_key.pem': 'excluded',
    'src/session-cookie.txt': 'excluded',
    'src/service-token.txt': 'excluded',
    'test-results/results.json': 'excluded',
    'tests-remote/remote.spec.ts': 'included',
    'tests/test-database-generated-key.pem': 'excluded',
    'tests/unit.test.ts': 'included',
    'tsconfig.json': 'included',
    'tsconfig.node.json': 'included',
    'vite.config.ts': 'included',
    'vitest.config.ts': 'included',
    'work/runtime.log': 'excluded',
  })

  assert.deepEqual(await collectCheckpointInputs(root), [
    '.dockerignore',
    '.github/workflows/release.yml',
    'DEPLOYMENT.md',
    'DESIGN.md',
    'Dockerfile',
    'PRODUCT.md',
    'README.md',
    'deploy/chart.yaml',
    'docker-entrypoint.sh',
    'docs/runbooks/user-deployment-checklist.md',
    'docs/traceability/acceptance-matrix.json',
    'docs/traceability/requirements.md',
    'docs/traceability/source-clauses.json',
    'index.html',
    'nginx.conf',
    'package-lock.json',
    'package.json',
    'playwright.config.ts',
    'playwright.remote.config.ts',
    'playwright.remote.image.config.ts',
    'public/asset.svg',
    'scripts/tool.mjs',
    'server/Dockerfile',
    'server/migrations/001.sql',
    'server/package-lock.json',
    'server/package.json',
    'server/src/index.ts',
    'server/tsconfig.json',
    'server/vitest.config.ts',
    'src/app.ts',
    'tests-remote/remote.spec.ts',
    'tests/unit.test.ts',
    'tsconfig.json',
    'tsconfig.node.json',
    'vite.config.ts',
    'vitest.config.ts',
  ])
})

test('builds the same ordered checkpoint twice without generated or sensitive paths', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lifeops-checkpoint-stable-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFixtureTree(root, {
    'node_modules/pkg/index.js': 'excluded',
    'outputs/evidence/old.json': 'excluded',
    'package.json': '{"name":"fixture"}\n',
    'scripts/check.mjs': 'export const checked = true\n',
    'src/private_key.pem': 'excluded',
  })

  const first = await buildLocalCheckpoint(root)
  const second = await buildLocalCheckpoint(root)

  assert.deepEqual(first, second)
  assert.equal(first.kind, 'uncommitted-local-checkpoint')
  assert.match(first.rootSha256, /^[A-F0-9]{64}$/)
  assert.deepEqual(first.files.map((row) => row.path), ['package.json', 'scripts/check.mjs'])
  assert(first.files.every((row) => /^[A-F0-9]{64}$/.test(row.sha256)))
  assert(first.includeRules.length > 0)
  assert(first.excludeRules.length > 0)
})

test('changes the checkpoint root when an included file changes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lifeops-checkpoint-included-mutation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFixtureTree(root, { 'src/app.ts': 'export const version = 1\n' })
  const before = await buildLocalCheckpoint(root)

  await writeFixtureTree(root, { 'src/app.ts': 'export const version = 2\n' })
  const after = await buildLocalCheckpoint(root)

  assert.deepEqual(before.files.map((row) => row.path), ['src/app.ts'])
  assert.deepEqual(after.files.map((row) => row.path), ['src/app.ts'])
  assert.notEqual(after.files[0].sha256, before.files[0].sha256)
  assert.notEqual(after.rootSha256, before.rootSha256)
})

test('keeps the checkpoint unchanged when only an excluded file changes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lifeops-checkpoint-excluded-mutation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFixtureTree(root, {
    'outputs/evidence/runtime.json': '{"run":1}\n',
    'src/app.ts': 'export const stable = true\n',
  })
  const before = await buildLocalCheckpoint(root)

  await writeFixtureTree(root, { 'outputs/evidence/runtime.json': '{"run":2}\n' })
  const after = await buildLocalCheckpoint(root)

  assert.deepEqual(before.files.map((row) => row.path), ['src/app.ts'])
  assert.deepEqual(after, before)
})

test('builds source-clause candidates from the exact fixed eleven-file set', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lifeops-source-candidates-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFixtureTree(root, Object.fromEntries(
    Object.entries(SOURCE_PATH_BY_KEY).map(([sourceKey, sourcePath]) => [
      sourcePath,
      `# ${sourceKey}\n\nCandidate text for ${sourceKey}.\n`,
    ]),
  ))

  const candidates = await buildSourceClauseCandidates(root)

  assert.deepEqual([...new Set(candidates.map((candidate) => candidate.sourceKey))], Object.keys(SOURCE_PATH_BY_KEY))
  assert(candidates.every((candidate) => candidate.sourcePath === SOURCE_PATH_BY_KEY[candidate.sourceKey]))
  assert(candidates.every((candidate) => /^[A-F0-9]{64}$/.test(candidate.textSha256)))
})

test('rejects a registry whose source set omits the later P6 work package', () => {
  const { candidates, registry } = makeValidSourceRegistry()
  registry.sources = registry.sources.filter((source) => source.sourceKey !== 'P6')

  const issues = validateSourceClauses(registry, candidates)

  assert(issues.some((issue) => issue.code === 'SOURCE_FILE_SET_MISMATCH'))
})

test('rejects invalid source-clause classifications and required evidence fields', () => {
  const { candidates, registry } = makeValidSourceRegistry()
  registry.clauses[0] = { ...registry.clauses[0], classification: 'mapped', atomIds: [] }
  registry.clauses[1] = { ...registry.clauses[1], classification: 'context-only', reason: '  ' }
  registry.clauses[2] = { ...registry.clauses[2], classification: 'superseded', supersededBy: '' }
  registry.clauses[3] = { ...registry.clauses[3], classification: null }

  const codes = validateSourceClauses(registry, candidates).map((issue) => issue.code)

  assert(codes.includes('MAPPED_CLAUSE_WITHOUT_ATOM'))
  assert(codes.includes('CONTEXT_REASON_REQUIRED'))
  assert(codes.includes('SUPERSEDED_EVIDENCE_REQUIRED'))
  assert(codes.includes('UNCLASSIFIED_SOURCE_CLAUSE'))
})

test('rejects malformed source-clause registry and required clause fields', () => {
  const { candidates, registry } = makeValidSourceRegistry()
  registry.schemaVersion = 2
  registry.clauses[0] = {
    ...registry.clauses[0],
    id: '',
    headingPath: 'not-an-array',
    kind: 'unknown',
    ordinal: 0,
    textSummary: '',
  }

  const codes = validateSourceClauses(registry, candidates).map((issue) => issue.code)

  assert(codes.includes('INVALID_SOURCE_REGISTRY_SCHEMA'))
  assert(codes.includes('INVALID_SOURCE_CLAUSE_ID'))
  assert(codes.includes('INVALID_SOURCE_CLAUSE_LOCATOR'))
  assert(codes.includes('INVALID_SOURCE_CLAUSE_SUMMARY'))
})

test('rejects duplicate, missing, orphaned and text-drifted source clauses', () => {
  const { candidates, registry } = makeValidSourceRegistry()
  const duplicateId = structuredClone(registry.clauses[1])
  duplicateId.id = registry.clauses[0].id
  registry.clauses.push(duplicateId)

  const duplicateLocator = structuredClone(registry.clauses[2])
  duplicateLocator.id = 'SC-DUPLICATE-LOCATOR'
  registry.clauses.push(duplicateLocator)

  registry.clauses = registry.clauses.filter((clause) => clause.sourceKey !== 'P6')
  registry.clauses.push({
    ...structuredClone(registry.clauses[3]),
    id: 'SC-ORPHAN-0001',
    ordinal: 999,
  })
  registry.clauses[0].textSha256 = 'A'.repeat(64)

  const codes = validateSourceClauses(registry, candidates).map((issue) => issue.code)

  assert(codes.includes('DUPLICATE_SOURCE_CLAUSE_ID'))
  assert(codes.includes('DUPLICATE_SOURCE_CLAUSE_LOCATOR'))
  assert(codes.includes('CURRENT_SOURCE_CLAUSE_MISSING'))
  assert(codes.includes('ORPHAN_SOURCE_CLAUSE'))
  assert(codes.includes('SOURCE_CLAUSE_TEXT_CHANGED'))
})

test('accepts a fully synchronized and classified source-clause registry', () => {
  const { candidates, registry } = makeValidSourceRegistry()
  assert.deepEqual(validateSourceClauses(registry, candidates), [])
})

test('retains a stable clause ID but forces review when locator-matched text changes', () => {
  const { candidates, registry } = makeValidSourceRegistry()
  registry.clauses[0] = {
    ...registry.clauses[0],
    classification: 'mapped',
    atomIds: ['PUB-01-A001'],
    reason: null,
  }
  const changedText = 'Changed normative clause text.'
  candidates[0] = {
    ...candidates[0],
    text: changedText,
    textSha256: sha256Text(changedText),
  }

  const merged = mergeSourceClauseRegistry(candidates, registry)
  const changed = merged.clauses.find((clause) => clause.id === registry.clauses[0].id)

  assert(changed)
  assert.equal(changed.textSha256, candidates[0].textSha256)
  assert.equal(changed.classification, null)
  assert.deepEqual(changed.atomIds, [])
  assert.equal(changed.reason, null)
  assert.equal(changed.supersededBy, null)
})

test('source-clause CLI previews by default and protects classified registries on apply', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lifeops-source-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFixtureTree(root, Object.fromEntries(
    Object.entries(SOURCE_PATH_BY_KEY).map(([sourceKey, sourcePath]) => [
      sourcePath,
      `# ${sourceKey}\n\nCandidate text for ${sourceKey}.\n`,
    ]),
  ))
  const buildScript = path.resolve('scripts/build-source-clauses.mjs')
  const registryPath = path.join(root, 'docs', 'traceability', 'source-clauses.json')

  const preview = await execFileAsync(process.execPath, [buildScript], { cwd: root })
  const previewRegistry = JSON.parse(preview.stdout)
  assert.equal(previewRegistry.sources.length, 11)
  assert.equal(await fileExists(registryPath), false)

  await execFileAsync(process.execPath, [buildScript, '--apply'], { cwd: root })
  const applied = JSON.parse(await readFile(registryPath, 'utf8'))
  applied.clauses[0].classification = 'context-only'
  applied.clauses[0].reason = 'Reviewed non-normative fixture heading.'
  await writeFile(registryPath, `${JSON.stringify(applied, null, 2)}\n`, 'utf8')

  await assert.rejects(
    execFileAsync(process.execPath, [buildScript, '--apply'], { cwd: root }),
    /--replace-classifications/,
  )
  await execFileAsync(
    process.execPath,
    [buildScript, '--apply', '--replace-classifications'],
    { cwd: root },
  )
  const replaced = JSON.parse(await readFile(registryPath, 'utf8'))
  assert.equal(replaced.clauses[0].classification, 'context-only')
})

test('applies complete non-overlapping reviewed rules and stable clause-scoped atom IDs', () => {
  const candidates = [
    makeSourceCandidate('FINAL_REDESIGN', 1, 'Structural heading'),
    makeSourceCandidate('FINAL_REDESIGN', 2, 'Normative behavior'),
    makeSourceCandidate('FINAL_REDESIGN', 3, '**Files:**'),
  ]
  candidates[0].kind = 'heading'
  const registry = mergeSourceClauseRegistry(candidates)
  const rules = {
    schemaVersion: 1,
    reviewStatus: 'primary-executor-reviewed',
    reviewedOn: '2026-08-11',
    defaultDecision: {
      id: 'normative-default',
      classification: 'mapped',
      atomIdTemplate: 'ATOM-{id}',
    },
    rules: [
      {
        id: 'headings',
        match: { kind: 'heading' },
        classification: 'context-only',
        reason: 'Structural heading; child clauses contain the enforceable behavior.',
      },
      {
        id: 'file-label',
        match: { textEquals: ['**Files:**'] },
        classification: 'context-only',
        reason: 'Structural plan label; following rows carry the file requirements.',
      },
    ],
  }

  const reviewed = applySourceClauseReviewRules(registry, rules)

  assert.deepEqual(reviewed.clauses.map((clause) => clause.classification), [
    'context-only',
    'mapped',
    'context-only',
  ])
  assert.deepEqual(reviewed.clauses[1].atomIds, [`ATOM-${reviewed.clauses[1].id}`])
  assert.deepEqual(reviewed.review.ruleCounts, { headings: 1, 'normative-default': 1, 'file-label': 1 })
})

test('rejects unreviewed, stale or overlapping source-clause review rules', () => {
  const candidate = makeSourceCandidate('FINAL_REDESIGN')
  candidate.kind = 'heading'
  const registry = mergeSourceClauseRegistry([candidate])
  const baseRules = {
    schemaVersion: 1,
    reviewStatus: 'primary-executor-reviewed',
    reviewedOn: '2026-08-11',
    defaultDecision: {
      id: 'default',
      classification: 'mapped',
      atomIdTemplate: 'ATOM-{id}',
    },
    rules: [
      {
        id: 'heading',
        match: { kind: 'heading' },
        classification: 'context-only',
        reason: 'Structural heading only.',
      },
    ],
  }

  assert.throws(
    () => applySourceClauseReviewRules(registry, { ...baseRules, reviewStatus: 'proposal' }),
    /primary-executor-reviewed/,
  )
  assert.throws(
    () => applySourceClauseReviewRules(registry, {
      ...baseRules,
      rules: [{ ...baseRules.rules[0], match: { ids: ['SC-NOT-PRESENT'] } }],
    }),
    /did not match/,
  )
  assert.throws(
    () => applySourceClauseReviewRules(registry, {
      ...baseRules,
      rules: [
        baseRules.rules[0],
        { ...baseRules.rules[0], id: 'heading-again' },
      ],
    }),
    /multiple review rules/,
  )
})

test('source-clause CLI previews and applies an explicitly reviewed rule file', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lifeops-source-review-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFixtureTree(root, Object.fromEntries(
    Object.entries(SOURCE_PATH_BY_KEY).map(([sourceKey, sourcePath]) => [
      sourcePath,
      `# ${sourceKey}\n\nNormative text for ${sourceKey}.\n`,
    ]),
  ))
  const rulesPath = 'docs/traceability/review-rules.json'
  await writeFixtureTree(root, {
    [rulesPath]: `${JSON.stringify({
      schemaVersion: 1,
      reviewStatus: 'primary-executor-reviewed',
      reviewedOn: '2026-08-11',
      defaultDecision: {
        id: 'normative-default',
        classification: 'mapped',
        atomIdTemplate: 'ATOM-{id}',
      },
      rules: [{
        id: 'heading',
        match: { kind: 'heading' },
        classification: 'context-only',
        reason: 'Structural heading only; child rows contain enforceable behavior.',
      }],
    }, null, 2)}\n`,
  })
  const buildScript = path.resolve('scripts/build-source-clauses.mjs')
  const registryPath = path.join(root, 'docs', 'traceability', 'source-clauses.json')

  const preview = await execFileAsync(
    process.execPath,
    [buildScript, '--review-rules', rulesPath],
    { cwd: root },
  )
  const previewRegistry = JSON.parse(preview.stdout)
  assert.equal(previewRegistry.clauses.some((clause) => clause.classification === null), false)
  assert.deepEqual(previewRegistry.review.ruleCounts, { heading: 11, 'normative-default': 11 })
  assert.equal(await fileExists(registryPath), false)

  await execFileAsync(
    process.execPath,
    [buildScript, '--apply', '--replace-classifications', '--review-rules', rulesPath],
    { cwd: root },
  )
  const applied = JSON.parse(await readFile(registryPath, 'utf8'))
  assert.equal(applied.review.status, 'primary-executor-reviewed')
  assert.equal(applied.clauses.filter((clause) => clause.classification === 'mapped').length, 11)
})

test('rejects duplicate atoms, unknown parents and atoms without source clauses', () => {
  const { matrix, sourceRegistry } = makeValidAcceptanceFixture()
  matrix.atoms.push(structuredClone(matrix.atoms[0]))
  matrix.atoms.push({
    ...structuredClone(matrix.atoms[0]),
    id: 'UNKNOWN-01.RECIPES.DATA.01',
    parentRequirementId: 'UNKNOWN-01',
  })
  matrix.atoms.push({
    ...structuredClone(matrix.atoms[0]),
    id: 'LIFE-07.RECIPES.DATA.01',
    sourceClauseIds: [],
  })

  const codes = validateAcceptanceMatrix(matrix, sourceRegistry).map((issue) => issue.code)

  assert(codes.includes('DUPLICATE_ATOM_ID'))
  assert(codes.includes('UNKNOWN_PARENT_REQUIREMENT'))
  assert(codes.includes('ATOM_WITHOUT_SOURCE_CLAUSE'))
})

test('requires every visible page to declare all eight minimum coverage dimensions', () => {
  const { matrix, sourceRegistry } = makeValidAcceptanceFixture()
  const recipes = matrix.surfaces.find((surface) => surface.id === 'LIFE_RECIPES_ROUTE')
  recipes.requiredDimensions = recipes.requiredDimensions.filter(
    (dimension) => dimension !== 'MOTION',
  )

  const issues = validateAcceptanceMatrix(matrix, sourceRegistry)

  assert(issues.some((issue) => (
    issue.code === 'SURFACE_DIMENSION_MISSING'
    && issue.surface === '/app/life/recipes'
    && issue.dimension === 'MOTION'
  )))
})

test('rejects invalid matrix schema, parent rollups, references, tasks, evidence and boundaries', () => {
  const { matrix, sourceRegistry } = makeValidAcceptanceFixture()
  matrix.schemaVersion = 2
  matrix.parentRequirementIds = matrix.parentRequirementIds.slice(0, -1)
  matrix.atoms[0] = {
    ...matrix.atoms[0],
    sourceClauseIds: ['SC-UNKNOWN-0001'],
    surfaces: ['UNKNOWN_SURFACE'],
    plannedTasks: ['P7-T1'],
    requiredEvidence: ['imaginary-evidence'],
    finalBoundary: ['registry', 'local'],
  }

  const codes = validateAcceptanceMatrix(matrix, sourceRegistry).map((issue) => issue.code)

  assert(codes.includes('INVALID_ACCEPTANCE_SCHEMA'))
  assert(codes.includes('PARENT_REQUIREMENT_SET_MISMATCH'))
  assert(codes.includes('UNKNOWN_SOURCE_CLAUSE'))
  assert(codes.includes('UNKNOWN_ATOM_SURFACE'))
  assert(codes.includes('UNKNOWN_PLANNED_TASK'))
  assert(codes.includes('UNKNOWN_EVIDENCE_TYPE'))
  assert(codes.includes('INVALID_FINAL_BOUNDARY'))
})

test('rejects duplicate surfaces and malformed surface or atom fields', () => {
  const { matrix, sourceRegistry } = makeValidAcceptanceFixture()
  matrix.surfaces.push(structuredClone(matrix.surfaces[0]))
  matrix.atoms[0] = {
    ...matrix.atoms[0],
    title: '',
    contract: '',
  }

  const codes = validateAcceptanceMatrix(matrix, sourceRegistry).map((issue) => issue.code)

  assert(codes.includes('DUPLICATE_SURFACE_ID'))
  assert(codes.includes('INVALID_ATOM_TITLE'))
  assert(codes.includes('INVALID_ATOM_CONTRACT'))
})

test('does not allow notApplicable to suppress universal visible-page contracts', () => {
  const { matrix, sourceRegistry } = makeValidAcceptanceFixture()
  matrix.atoms[0] = {
    ...matrix.atoms[0],
    id: 'LIFE-07.RECIPES.MOTION.01',
    notApplicable: {
      reason: 'Motion is unnecessary.',
      approvedSourceClauseId: matrix.atoms[0].sourceClauseIds[0],
    },
  }

  const codes = validateAcceptanceMatrix(matrix, sourceRegistry).map((issue) => issue.code)

  assert(codes.includes('UNIVERSAL_VISIBLE_DIMENSION_NOT_APPLICABLE'))
})

test('accepts a structurally valid acceptance matrix', () => {
  const { matrix, sourceRegistry } = makeValidAcceptanceFixture()
  assert.deepEqual(validateAcceptanceMatrix(matrix, sourceRegistry), [])
})

test('accepts the declared A11Y dimension in an atom ID', () => {
  const { matrix, sourceRegistry } = makeValidAcceptanceFixture()
  matrix.atoms[0].id = 'LIFE-07.RECIPES.A11Y.01'

  const codes = validateAcceptanceMatrix(matrix, sourceRegistry).map((issue) => issue.code)

  assert(!codes.includes('INVALID_ATOM_ID'))
})

test('locks the complete fifty-two-surface catalog from execution-completeness section 6', () => {
  assert.deepEqual(REQUIRED_SURFACES.map((surface) => surface.id), EXPECTED_REQUIRED_SURFACE_IDS)
  assert.equal(new Set(REQUIRED_SURFACES.map((surface) => surface.id)).size, 52)
})

test('rejects an acceptance matrix missing any required surface', () => {
  const { matrix, sourceRegistry } = makeValidAcceptanceFixture()
  matrix.surfaces = matrix.surfaces.filter((surface) => surface.id !== 'LIFE_RECIPES_ROUTE')

  const issues = validateAcceptanceMatrix(matrix, sourceRegistry)

  assert(issues.some((issue) => (
    issue.code === 'REQUIRED_SURFACE_MISSING'
    && issue.surfaceId === 'LIFE_RECIPES_ROUTE'
  )))
})

test('rejects drift in a required surface definition', () => {
  const { matrix, sourceRegistry } = makeValidAcceptanceFixture()
  const recipes = matrix.surfaces.find((surface) => surface.id === 'LIFE_RECIPES_ROUTE')
  recipes.path = '/app/life/recipe-wall'

  const issues = validateAcceptanceMatrix(matrix, sourceRegistry)

  assert(issues.some((issue) => (
    issue.code === 'REQUIRED_SURFACE_DEFINITION_MISMATCH'
    && issue.surfaceId === 'LIFE_RECIPES_ROUTE'
    && issue.field === 'path'
  )))
})

test('real acceptance matrix keeps exact catalogs and the complete original plus life atom sets', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  assert.deepEqual(matrix.parentRequirementIds, PARENT_REQUIREMENT_IDS)
  assert.deepEqual(matrix.surfaces, REQUIRED_SURFACES)
  assert.equal(matrix.atoms.filter((atom) => ORIGINAL_PARENT_REQUIREMENT_IDS.includes(atom.parentRequirementId)).length, 800)
  assert.equal(matrix.atoms.filter((atom) => atom.parentRequirementId.startsWith('LIFE-')).length, 644)
  assert.equal(sourceRegistry.clauses.some((clause) => (
    clause.classification === 'mapped' && clause.atomIds.includes(`ATOM-${clause.id}`)
  )), false)
})

test('rebuilding original atoms preserves all seven ADR-029 atoms and the ADR-030 motion-owner contract', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const built = buildOriginalAcceptance(matrix, sourceRegistry)
  const expectedAtomIds = [
    'AUTH-01.LOGIN_OVERLAY.FUNC.02',
    'MOTION-01.PUBLIC_HOME.MOTION.04',
    'PUB-01.PUBLIC_HOME.FUNC.02',
    'PUB-01.PUBLIC_HOME.FUNC.03',
    'PUB-01.PUBLIC_HOME.LAYOUT.01',
    'SPACE-01.PUBLIC_HOME.RESP.05',
    'STATE-01.PUBLIC_HOME.STATE.06',
  ]
  const builtAtoms = new Map(built.matrix.atoms.map((atom) => [atom.id, atom]))

  assert.deepEqual(expectedAtomIds.filter((atomId) => !builtAtoms.has(atomId)), [])
  assert.equal(
    builtAtoms.get('MOTION-01.PUBLIC_HOME.MOTION.04')?.contract,
    'Native Web Animations exclusively owns the four continuous ring rotations and five upright counter transforms; GSAP exclusively owns title, group and object arrival, login, public-detail continuity, scene and aperture motion; no node or transform property has competing engine or CSS owners.',
  )
  assert.deepEqual(
    builtAtoms.get('MOTION-01.PUBLIC_HOME.MOTION.04')?.plannedTasks,
    ['P6-T5', 'P6-T6'],
  )
})

test('ADR-030 authority and execution clauses map reciprocally to the dedicated motion-owner atom', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const built = buildOriginalAcceptance(matrix, sourceRegistry)
  const atomId = 'MOTION-01.PUBLIC_HOME.MOTION.04'
  const prefixes = [
    '原生 Web Animations API 只拥有四个持续圆环',
    '除四个持续圆环 rotation 与五个 upright counter transform',
    '四条 masked-gradient 圆环各自持续旋转',
    '**Architecture:** Work is split into six ordered vertical plans.',
    'Native Web Animations owns only the four continuous ring rotations',
    'ADR-030 changes only the scheduler owner for nine continuous transforms',
    'Ordinary CI remediation under this still-open step must preserve the ADR-030 engine boundary',
  ]
  const clauses = prefixes.map((prefix) => {
    const clause = built.sourceRegistry.clauses.find((row) => row.textSummary.startsWith(prefix))
    assert.ok(clause, `missing ADR-030 clause ${prefix}`)
    return clause
  })
  const atom = built.matrix.atoms.find((row) => row.id === atomId)

  assert.ok(atom)
  for (const clause of clauses) {
    assert.ok(clause.atomIds.includes(atomId), `${clause.id} must map to ${atomId}`)
    assert.ok(atom.sourceClauseIds.includes(clause.id), `${atomId} must reciprocally include ${clause.id}`)
  }
})

test('record cover identity and source adapter remain independently atomic', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const built = buildOriginalAcceptance(matrix, sourceRegistry)
  const expected = {
    'RECORD-01.RECORDS_ROUTE.DATA.02': 'Creates every record with a persisted nullable cover identity whose default is null.',
    'RECORD-01.RECORDS_ROUTE.DATA.03': 'Preserves the current cover identity when a PATCH omits coverMediaId.',
    'RECORD-01.RECORDS_ROUTE.DATA.04': 'Clears the current cover identity when a PATCH sends coverMediaId as null.',
    'RECORD-01.RECORDS_ROUTE.DATA.05': 'Selects and persists a non-null coverMediaId only when it belongs to the record media set.',
    'RECORD-01.RECORDS_ROUTE.TXN.05': 'Rejects removing the active cover unless the same atomic request clears it or replaces it with another attached image.',
    'RECORD-01.RECORDS_ROUTE.SEC.01': 'Requires the selected cover media to belong to the record owner and never lets cover identity weaken private media authorization.',
    'RECORD-01.RECORDS_ROUTE.NAV.04': 'Decodes one source query value once, accepts exactly goal|project|task|habit followed by a non-empty ID, and splits only at the first colon.',
    'RECORD-01.RECORDS_ROUTE.FUNC.02': 'Maps a valid source value only to the existing linkType plus linkId transport filters without table inference or fallback.',
    'RECORD-01.RECORDS_ROUTE.STATE.01': 'Contains malformed or duplicate source values as a scoped filter validation error and sends no malformed records request.',
  }
  const actual = Object.fromEntries(built.matrix.atoms
    .filter((atom) => Object.hasOwn(expected, atom.id))
    .map((atom) => [atom.id, atom.contract]))

  assert.deepEqual(actual, expected)
  for (const atomId of Object.keys(expected)) {
    const atom = built.matrix.atoms.find((row) => row.id === atomId)
    assert.deepEqual(atom?.plannedTasks, ['P1-T6', 'P3-T5'])
    assert(atom?.sourceClauseIds.length)
  }
})

test('original twenty requirements have complete parent, source-clause and surface-dimension atom coverage', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const gaps = collectOriginalAcceptanceCoverageGaps(matrix, sourceRegistry)
  const report = {
    missingParents: gaps.missingParents,
    missingMappedClauseCount: gaps.missingMappedClauseIds.length,
    missingMappedClauseSample: gaps.missingMappedClauseIds.slice(0, 25),
    missingSurfaceDimensions: gaps.missingSurfaceDimensions,
  }

  assert.deepEqual(report, {
    missingParents: [],
    missingMappedClauseCount: 0,
    missingMappedClauseSample: [],
    missingSurfaceDimensions: [],
  })
})

test('original-domain classification defers life rows and life transactions but retains publish and image handoff', async () => {
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const clausesById = new Map(sourceRegistry.clauses.map((clause) => [clause.id, clause]))
  const medicineOccurrenceMasterClause = sourceRegistry.clauses.find((clause) => (
    clause.sourceKey === 'MASTER_PLAN'
    && clause.textSummary.startsWith('`009_life_planning.sql` owns a bounded')
  ))

  assert.equal(isOriginalDomainClause(clausesById.get('SC-FINAL_REDESIGN-0287')), false)
  assert.equal(isOriginalDomainClause(clausesById.get('SC-FINAL_REDESIGN-0045')), false)
  assert.equal(isOriginalDomainClause(clausesById.get('SC-FINAL_REDESIGN-0185')), false)
  assert.equal(isOriginalDomainClause(clausesById.get('SC-FINAL_REDESIGN-0228')), false)
  assert.equal(isOriginalDomainClause(clausesById.get('SC-EXECUTION_COMPLETENESS-0032')), false)
  assert.equal(isOriginalDomainClause(clausesById.get('SC-EXECUTION_COMPLETENESS-0126')), false)
  assert.equal(isOriginalDomainClause(clausesById.get('SC-EXECUTION_COMPLETENESS-0129')), false)
  assert.ok(medicineOccurrenceMasterClause)
  assert.equal(isOriginalDomainClause(medicineOccurrenceMasterClause), false)
  assert.equal(isOriginalDomainClause(clausesById.get('SC-FINAL_REDESIGN-0101')), true)
  assert.equal(isOriginalDomainClause(clausesById.get('SC-FINAL_REDESIGN-0175')), true)
  assert.equal(isOriginalDomainClause(clausesById.get('SC-FINAL_REDESIGN-0222')), true)
  assert.equal(isOriginalDomainClause(clausesById.get('SC-EXECUTION_COMPLETENESS-0135')), true)
  assert.equal(isOriginalDomainClause(clausesById.get('SC-EXECUTION_COMPLETENESS-0335')), true)
})

test('each original parent canonical traceability row reciprocally supports all of its generated atoms', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const built = buildOriginalAcceptance(matrix, sourceRegistry)
  const missing = []

  for (const parentId of ORIGINAL_PARENT_REQUIREMENT_IDS) {
    const canonical = sourceRegistry.clauses.find((clause) => (
      clause.sourceKey === 'FINAL_REDESIGN'
      && clause.textSummary.startsWith(`| ${parentId} |`)
    ))
    const parentAtoms = built.matrix.atoms.filter((atom) => atom.parentRequirementId === parentId)
    if (!canonical || parentAtoms.some((atom) => !atom.sourceClauseIds.includes(canonical.id))) {
      missing.push(parentId)
    }
  }

  assert.deepEqual(missing, [])
})

test('a broad breakpoint clause maps only to its declared cross-cutting dimensions', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const built = buildOriginalAcceptance(matrix, sourceRegistry)
  const clause = built.sourceRegistry.clauses.find((row) => row.id === 'SC-P3-0187')
  const dimensions = new Set(clause.atomIds.map((atomId) => atomId.split('.')[2]))

  assert(clause.atomIds.length < 40)
  assert.deepEqual([...dimensions].sort(), ['LAYOUT', 'MOTION', 'RESP', 'STATE'])
})

test('rebuilding original atoms removes stale original links from clauses deferred to Task 6', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const built = buildOriginalAcceptance(matrix, sourceRegistry)
  const originalAtomIds = new Set(built.matrix.atoms
    .filter((atom) => ORIGINAL_PARENT_REQUIREMENT_IDS.includes(atom.parentRequirementId))
    .map((atom) => atom.id))
  const deferredIds = [
    'SC-FINAL_REDESIGN-0045',
    'SC-FINAL_REDESIGN-0185',
    'SC-FINAL_REDESIGN-0228',
  ]
  const invalid = built.sourceRegistry.clauses
    .filter((clause) => deferredIds.includes(clause.id))
    .filter((clause) => (
      clause.atomIds.length === 0
      || clause.atomIds.some((atomId) => originalAtomIds.has(atomId))
    ))
    .map((clause) => clause.id)

  assert.deepEqual(invalid, [])
})

test('original visible surfaces split breakpoint, state, navigation, accessibility and motion contracts', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const originalSurfaceIds = new Set(REQUIRED_SURFACES
    .filter((surface) => (
      ['route', 'overlay', 'shell', 'platform-subtab'].includes(surface.kind)
      && !surface.id.startsWith('LIFE_')
    ))
    .map((surface) => surface.id))
  const originalAtoms = matrix.atoms.filter((atom) => (
    ORIGINAL_PARENT_REQUIREMENT_IDS.includes(atom.parentRequirementId)
  ))
  const gaps = []

  for (const surfaceId of originalSurfaceIds) {
    const atoms = originalAtoms.filter((atom) => atom.surfaces.includes(surfaceId))
    const countDimension = (dimension) => atoms.filter((atom) => atom.id.split('.')[2] === dimension).length
    if (countDimension('RESP') < 4) gaps.push(`${surfaceId}:RESP_SPLIT`)
    if (countDimension('STATE') < 4) gaps.push(`${surfaceId}:STATE_SPLIT`)
    if (countDimension('NAV') < 3) gaps.push(`${surfaceId}:NAV_SPLIT`)
    if (countDimension('A11Y') < 3) gaps.push(`${surfaceId}:A11Y_SPLIT`)
    if (countDimension('MOTION') < 3) gaps.push(`${surfaceId}:MOTION_SPLIT`)
  }

  assert.deepEqual(gaps, [])
})

test('DELIVERY-01 keeps immutable-release and unfamiliar-cluster handoff atoms separate', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const deliveryTitles = new Set(matrix.atoms
    .filter((atom) => atom.parentRequirementId === 'DELIVERY-01')
    .map((atom) => atom.title))
  const requiredTitles = [
    'GitHub release workflow',
    'production Web image',
    'production API image',
    'exact-digest image smoke',
    'digest-bound SBOM',
    'digest-bound provenance',
    'UHub digest inspection',
    'production digest values',
    'validated user deployment package',
    'deployment architecture and terminology',
    'capability-first cluster preflight',
    'user-owned cluster operation boundary',
    'secret and ExternalSecret handoff',
    'database deployment branches',
    'media storage branches',
    'entry controller branches',
    'immutable release inputs',
    'offline delivery preflight',
    'user-operated deployment paths and workload order',
    'user application smoke contract',
    'operations and restore handoff',
    'safe upgrade and rollback',
    'metric-driven scaling guidance',
    'safe command contract',
    'repository asset mapping',
    'ordered deployment manual structure',
  ]

  assert.deepEqual(requiredTitles.filter((title) => !deliveryTitles.has(title)), [])
})

test('approved unfamiliar-cluster clauses map reciprocally to their dedicated handoff atoms', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const built = buildOriginalAcceptance(matrix, sourceRegistry)
  const expected = new Map([
    ['Architecture and terminology:', 'DELIVERY-01.HANDOFF_ARCHITECTURE.FUNC.01'],
    ['Capability-first preflight:', 'DELIVERY-01.CAPABILITY_PREFLIGHT.OPS.01'],
    ['Cluster-operation boundary:', 'DELIVERY-01.CLUSTER_BOUNDARY.SEC.01'],
    ['Secret handoff:', 'DELIVERY-01.SECRET_HANDOFF.SEC.01'],
    ['Database branches:', 'DELIVERY-01.DATABASE_BRANCHES.DATA.01'],
    ['Media-storage branches:', 'DELIVERY-01.MEDIA_BRANCHES.DATA.01'],
    ['Entry-controller branches:', 'DELIVERY-01.ENTRY_BRANCHES.OPS.01'],
    ['Immutable release inputs:', 'DELIVERY-01.IMMUTABLE_INPUTS.DATA.01'],
    ['Offline delivery preflight:', 'DELIVERY-01.DELIVERY_PREFLIGHT.FUNC.01'],
    ['Deployment paths and order:', 'DELIVERY-01.DEPLOYMENT_PATHS.OPS.01'],
    ['User application smoke:', 'DELIVERY-01.USER_SMOKE.TXN.01'],
    ['Operations handoff:', 'DELIVERY-01.OPERATIONS_HANDOFF.OPS.01'],
    ['Upgrade and rollback:', 'DELIVERY-01.ROLLBACK_HANDOFF.TXN.01'],
    ['Scaling guidance:', 'DELIVERY-01.SCALING_GUIDANCE.CALC.01'],
    ['Command safety:', 'DELIVERY-01.COMMAND_SAFETY.SEC.01'],
    ['Repository asset mapping:', 'DELIVERY-01.ASSET_MAPPING.FUNC.01'],
    ['Ordered manual structure:', 'DELIVERY-01.MANUAL_STRUCTURE.FUNC.01'],
  ])

  for (const [prefix, atomId] of expected) {
    const clause = built.sourceRegistry.clauses.find((row) => row.textSummary.startsWith(prefix))
    const atom = built.matrix.atoms.find((row) => row.id === atomId)
    assert.ok(clause, `missing source clause beginning ${prefix}`)
    assert.ok(atom, `missing atom ${atomId}`)
    assert.ok(clause.atomIds.includes(atomId), `${clause.id} must map to ${atomId}`)
    assert.ok(atom.sourceClauseIds.includes(clause.id), `${atomId} must reciprocally include ${clause.id}`)
  }
})

test('original write surfaces separate confirmed success from errors and explicit reversal from rollback', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const originalAtoms = matrix.atoms.filter((atom) => (
    ORIGINAL_PARENT_REQUIREMENT_IDS.includes(atom.parentRequirementId)
  ))
  const gaps = []

  for (const surface of REQUIRED_SURFACES.filter((row) => (
    !row.id.startsWith('LIFE_')
    && ['route', 'overlay', 'shell'].includes(row.kind)
    && row.id !== 'LOGIN_OVERLAY'
  ))) {
    const stateTitles = originalAtoms
      .filter((atom) => atom.surfaces.includes(surface.id) && atom.id.split('.')[2] === 'STATE')
      .map((atom) => atom.title)
    if (!stateTitles.some((title) => title.endsWith('state success'))) {
      gaps.push(`${surface.id}:SUCCESS_STATE`)
    }
  }

  for (const surface of REQUIRED_SURFACES.filter((row) => (
    !row.id.startsWith('LIFE_')
    && row.requiredDimensions.includes('TXN')
    && (!row.id.startsWith('TX_') || ['TX_PUBLISH_VERSION_REVOKE', 'TX_IMAGE_REGISTRY_HANDOFF'].includes(row.id))
  ))) {
    const transactionTitles = originalAtoms
      .filter((atom) => atom.surfaces.includes(surface.id) && atom.id.split('.')[2] === 'TXN')
      .map((atom) => atom.title)
    if (!transactionTitles.some((title) => title.endsWith('txn reversal'))) {
      gaps.push(`${surface.id}:EXPLICIT_REVERSAL`)
    }
  }

  assert.deepEqual(gaps, [])
})

test('LIFE-01 through LIFE-24 have complete clause, page-dimension and business-transaction atom coverage', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const gaps = collectLifeAcceptanceCoverageGaps(matrix, sourceRegistry)
  const report = {
    missingParents: gaps.missingParents,
    missingMappedClauseCount: gaps.missingMappedClauseIds.length,
    missingMappedClauseSample: gaps.missingMappedClauseIds.slice(0, 25),
    missingSurfaceDimensions: gaps.missingSurfaceDimensions,
    missingTransactions: gaps.missingTransactions,
  }

  assert.deepEqual(report, {
    missingParents: [],
    missingMappedClauseCount: 0,
    missingMappedClauseSample: [],
    missingSurfaceDimensions: [],
    missingTransactions: [],
  })
})

test('every visible life surface declares state, network/version, responsive/a11y/motion and privacy parents', () => {
  const missing = []
  for (const surface of REQUIRED_SURFACES.filter((row) => row.id.startsWith('LIFE_'))) {
    for (const parentId of ['STATE-01', 'LIFE-22', 'LIFE-23', 'LIFE-24']) {
      if (!surface.parentRequirementIds.includes(parentId)) missing.push(`${surface.id}:${parentId}`)
    }
  }
  for (const surface of REQUIRED_SURFACES.filter((row) => LIFE_TRANSACTION_SURFACE_IDS.includes(row.id))) {
    for (const parentId of ['LIFE-22', 'LIFE-24']) {
      if (!surface.parentRequirementIds.includes(parentId)) missing.push(`${surface.id}:${parentId}`)
    }
  }

  assert.deepEqual(missing, [])
})

test('life-domain atoms keep every critical closed-loop behavior as a separate auditable contract', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const lifeAtoms = matrix.atoms.filter((atom) => LIFE_PARENT_REQUIREMENT_SET.has(atom.parentRequirementId))
  const titles = new Set(lifeAtoms.map((atom) => atom.title))
  const requiredTitles = [
    'future plans recalculate from current master data',
    'completed history remains an actual snapshot',
    'completed history explicit audited recalculation',
    'meal completion atomic snapshot and inventory write',
    'meal reversal compensating ledger event',
    'prepared food yield and stock lifecycle',
    'purchase partial receipt and refund lifecycle',
    'cash expenditure stays separate from consumption cost',
    'template apply creates an independent date plan',
    'template sync updates only uncompleted future items',
    'date copy creates an independent editable plan',
    'soft delete and restore preserves references',
    'permanent delete blocks live references',
    'import preview and restore point',
    'import all-or-nothing apply and rollback',
    'Obsidian projection connected state',
    'Obsidian projection conflict state',
    'Obsidian projection degraded state',
    'Obsidian projection unsupported state',
    'offline draft is not a confirmed server write',
    'medicine stores user facts without medical advice',
    'medicine recurrence occurrence has stable bounded persisted identity',
    'medicine occurrence-only dates merge into calendar and timeline',
    'medicine rule reconciliation preserves past and terminal history',
    'medicine occurrence completion has a discriminated immutable source',
    'medicine occurrence undo is a compensating state-aware reversal',
    'medicine occurrence writes enforce owner version idempotency and snapshot consistency',
  ]

  assert.deepEqual(requiredTitles.filter((title) => !titles.has(title)), [])
})

test('ADR-023 clauses map to the exact medicine occurrence contracts instead of unrelated life atoms', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const built = buildLifeAcceptance(matrix, sourceRegistry)
  const expectations = [
    ['用户保存药品周期规则时，在同一事务内生成或调和 owner-scoped、versioned occurrence', [
      'LIFE-04.MEDICINE_OCCURRENCE.DATA.01',
      'LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01',
      'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01',
    ]],
    ['occurrence 的稳定身份由用户、规则、原始排程日期和原始排程时间组成', [
      'LIFE-04.MEDICINE_OCCURRENCE.DATA.01',
    ]],
    ['active occurrence 只投影到日历和日期时间线', [
      'LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01',
    ]],
    ['`/completions` 保持 day-plan item 分支向后兼容', [
      'LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01',
    ]],
    ['完成 occurrence 在一个 owner-scoped、幂等、乐观版本和一致快照事务内', [
      'LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01',
      'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01',
    ]],
    ['撤销不删除完成快照，而是生成一次反向库存流水', [
      'LIFE-11.MEDICINE_OCCURRENCE_REVERSE.TXN.01',
    ]],
    ['规则更新只调和未来未完成 occurrence', [
      'LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01',
    ]],
    ['过去未完成、已跳过、已取消、已完成 occurrence', [
      'LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01',
    ]],
    ['规则与 occurrence 调和在同一事务中完成', [
      'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01',
    ]],
    ['eager day-plan JSON 与纯虚拟 occurrence 均为已否决方案', [
      'LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01',
      'LIFE-04.MEDICINE_OCCURRENCE.DATA.01',
      'LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01',
      'LIFE-11.MEDICINE_OCCURRENCE_REVERSE.TXN.01',
    ]],
    ['药品周期规则保存/更新/删除 → 有界 occurrence 生成/调和', [
      'LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01',
      'LIFE-04.MEDICINE_OCCURRENCE.DATA.01',
      'LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01',
      'LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01',
      'LIFE-11.MEDICINE_OCCURRENCE_REVERSE.TXN.01',
      'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01',
    ]],
    ['`009_life_planning.sql` owns a bounded, owner-scoped and versioned', [
      'LIFE-04.MEDICINE_OCCURRENCE.DATA.01',
      'LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01',
      'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01',
    ]],
    ['Calendar and date timeline reads merge day-plan items', [
      'LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01',
    ]],
    ['Unified completion accepts exactly one discriminated source', [
      'LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01',
      'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01',
    ]],
    ['Rule update/delete reconciles only future incomplete occurrences', [
      'LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01',
      'LIFE-11.MEDICINE_OCCURRENCE_REVERSE.TXN.01',
    ]],
    ['P1-T11 cannot close without focused API/store behavior', [
      'LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01',
      'LIFE-04.MEDICINE_OCCURRENCE.DATA.01',
      'LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01',
      'LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01',
      'LIFE-11.MEDICINE_OCCURRENCE_REVERSE.TXN.01',
      'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01',
    ]],
    ["Produces `LifePlanItemKind = 'meal' | 'supplement' | 'medicine'", [
      'LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01',
      'LIFE-04.MEDICINE_OCCURRENCE.DATA.01',
    ]],
    ['Produces `/api/v1/life/calendar`, `/day-plans`, `/templates`, `/fitness` and `/completions` routes', [
      'LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01',
      'LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01',
    ]],
    ['[ ] **Step 3: Add migration 009 and planning contracts.**', [
      'LIFE-04.MEDICINE_OCCURRENCE.DATA.01',
      'LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01',
    ]],
    ['[ ] **Step 4: Implement conflict preview/apply/copy/sync and merged calendar/date timeline summaries.**', [
      'LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01',
    ]],
    ['[ ] **Step 5: Implement supplement/medicine/fitness scheduling and transactional completion/undo.**', [
      'LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01',
      'LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01',
      'LIFE-11.MEDICINE_OCCURRENCE_REVERSE.TXN.01',
      'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01',
    ]],
    ['[ ] **Step 7: Add frontend contracts/API and run focused, MySQL and type gates.**', [
      'LIFE-02.MEDICINE_OCCURRENCE_READ.DATA.01',
      'LIFE-04.MEDICINE_OCCURRENCE.DATA.01',
      'LIFE-10.MEDICINE_OCCURRENCE_COMPLETE.TXN.01',
      'LIFE-10.MEDICINE_OCCURRENCE_RECONCILE.TXN.01',
      'LIFE-11.MEDICINE_OCCURRENCE_REVERSE.TXN.01',
      'LIFE-22.MEDICINE_OCCURRENCE_CONCURRENCY.STATE.01',
    ]],
  ]

  for (const [prefix, expectedAtomIds] of expectations) {
    const clause = built.sourceRegistry.clauses.find((row) => row.textSummary.startsWith(prefix))
    assert.ok(clause, `missing ADR-023 clause ${prefix}`)
    assert.deepEqual(clause.atomIds, expectedAtomIds)
  }
})

test('ADR-024 clauses map to explicit inventory-policy and shopping-recalculation contracts', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const built = buildLifeAcceptance(matrix, sourceRegistry)
  const expectations = [
    ['每个 owner-scoped catalog item 可保存一份 versioned inventory policy', [
      'LIFE-11.INVENTORY_POLICY.DATA.01',
    ]],
    ['策略单位必须属于同一用户', [
      'LIFE-05.UNITS.CALC.01',
      'LIFE-11.INVENTORY_POLICY.DATA.01',
    ]],
    ['采购重算请求必须包含显式含首尾 `through` 日期', [
      'LIFE-14.SHOPPING_RECALC.CALC.01',
    ]],
    ['每个物品先计算 `rawShortage', [
      'LIFE-14.SHOPPING_RECALC.CALC.01',
    ]],
    ['服务端采购重算在一个 owner-scoped 一致快照事务内', [
      'LIFE-14.SHOPPING_RECALC.TXN.01',
      'LIFE-22.SHOPPING_RECALC_CONCURRENCY.STATE.01',
    ]],
    ['重算不得修改人工建议、正式清单', [
      'LIFE-14.SHOPPING_RECALC.TXN.01',
    ]],
    ['操作使用版本和幂等键', [
      'LIFE-22.SHOPPING_RECALC_CONCURRENCY.STATE.01',
    ]],
    ['库存策略/日期计划/库存流水/正式采购 → 指定 through 的服务端采购重算', [
      'LIFE-11.INVENTORY_POLICY.DATA.01',
      'LIFE-14.SHOPPING_RECALC.CALC.01',
      'LIFE-14.SHOPPING_RECALC.TXN.01',
    ]],
    ['Add one owner-scoped, versioned inventory policy', [
      'LIFE-11.INVENTORY_POLICY.DATA.01',
    ]],
    ['Read all inputs from one owner-consistent snapshot', [
      'LIFE-14.SHOPPING_RECALC.TXN.01',
      'LIFE-22.SHOPPING_RECALC_CONCURRENCY.STATE.01',
    ]],
    ['[ ] **Step 4: Implement inventory policy plus shopping', [
      'LIFE-11.INVENTORY_POLICY.DATA.01',
      'LIFE-14.SHOPPING_RECALC.CALC.01',
      'LIFE-14.SHOPPING_RECALC.TXN.01',
      'LIFE-22.SHOPPING_RECALC_CONCURRENCY.STATE.01',
    ]],
  ]

  for (const [prefix, expectedAtomIds] of expectations) {
    const clause = built.sourceRegistry.clauses.find((row) => row.textSummary.startsWith(prefix))
    assert.ok(clause, `missing ADR-024 clause ${prefix}`)
    assert.deepEqual(clause.atomIds, expectedAtomIds)
  }
})

test('life-domain clause classification is bounded to the approved life and shared task sections', async () => {
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const counts = {}
  for (const clause of sourceRegistry.clauses.filter(isLifeDomainClause)) {
    counts[clause.sourceKey] = (counts[clause.sourceKey] ?? 0) + 1
  }

  assert.deepEqual(counts, {
    FINAL_REDESIGN: 36,
    LIFE_DOMAIN: 182,
    EXECUTION_COMPLETENESS: 35,
    MASTER_PLAN: 35,
    P1: 133,
    P3: 134,
    P4: 23,
  })
})

test('ADR-027 supplement and household profile clauses map to both approved life parents', async () => {
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const clauses = sourceRegistry.clauses.filter((clause) => (
    clause.textSummary.includes('catalog supplement/household facts use one optional `profile`')
    || clause.textSummary.includes('补剂与家庭物品在 item 上至多携带一个')
  ))

  assert.equal(clauses.length, 2)
  for (const clause of clauses) {
    assert.ok(clause.atomIds.some((atomId) => atomId.startsWith('LIFE-03.')), `${clause.id} must cover LIFE-03`)
    assert.ok(clause.atomIds.some((atomId) => atomId.startsWith('LIFE-13.')), `${clause.id} must cover LIFE-13`)
    assert.equal(clause.atomIds.some((atomId) => atomId.startsWith('LIFE-01.')), false)
  }
})

test('each life parent canonical traceability row reciprocally supports all generated atoms', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const built = buildLifeAcceptance(matrix, sourceRegistry)
  const missing = []

  for (const parentId of LIFE_PARENT_REQUIREMENT_IDS) {
    const canonical = built.sourceRegistry.clauses.find((clause) => (
      clause.sourceKey === 'FINAL_REDESIGN'
      && clause.textSummary.startsWith(`| ${parentId} |`)
    ))
    const atoms = built.matrix.atoms.filter((atom) => atom.parentRequirementId === parentId)
    if (!canonical || atoms.some((atom) => !atom.sourceClauseIds.includes(canonical.id))) {
      missing.push(parentId)
    }
  }

  assert.deepEqual(missing, [])
})

test('life visible and transaction surfaces split responsive, state, navigation, accessibility, motion and reversal contracts', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const lifeAtoms = matrix.atoms.filter((atom) => LIFE_PARENT_REQUIREMENT_SET.has(atom.parentRequirementId))
  const gaps = []

  for (const surfaceId of LIFE_SURFACE_IDS.filter((id) => !id.startsWith('TX_'))) {
    const atoms = lifeAtoms.filter((atom) => atom.surfaces.includes(surfaceId))
    const count = (dimension) => atoms.filter((atom) => atom.id.split('.')[2] === dimension).length
    if (count('RESP') < 4) gaps.push(`${surfaceId}:RESP_SPLIT`)
    if (count('STATE') < 4) gaps.push(`${surfaceId}:STATE_SPLIT`)
    if (count('NAV') < 3) gaps.push(`${surfaceId}:NAV_SPLIT`)
    if (count('A11Y') < 3) gaps.push(`${surfaceId}:A11Y_SPLIT`)
    if (count('MOTION') < 3) gaps.push(`${surfaceId}:MOTION_SPLIT`)
  }
  for (const surfaceId of LIFE_TRANSACTION_SURFACE_IDS) {
    const transactionTitles = lifeAtoms
      .filter((atom) => atom.surfaces.includes(surfaceId) && atom.id.split('.')[2] === 'TXN')
      .map((atom) => atom.title)
    if (!transactionTitles.some((title) => title.endsWith('txn reversal'))) {
      gaps.push(`${surfaceId}:EXPLICIT_REVERSAL`)
    }
  }

  assert.deepEqual(gaps, [])
})

test('rebuilding original atoms preserves reciprocal life links on shared clauses', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const rebuiltOriginal = buildOriginalAcceptance(matrix, sourceRegistry)
  const gaps = collectLifeAcceptanceCoverageGaps(rebuiltOriginal.matrix, rebuiltOriginal.sourceRegistry)

  assert.deepEqual(gaps.missingMappedClauseIds, [])
})

test('rebuilding life atoms preserves reciprocal original links on shared clauses', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const sourceRegistry = await readJson(path.resolve('docs/traceability/source-clauses.json'))
  const rebuiltLife = buildLifeAcceptance(matrix, sourceRegistry)
  const gaps = collectOriginalAcceptanceCoverageGaps(rebuiltLife.matrix, rebuiltLife.sourceRegistry)

  assert.deepEqual(gaps.missingMappedClauseIds, [])
})

function makeEvidenceCheckpoint(workspaceRoot = process.cwd()) {
  return {
    kind: 'uncommitted-local-checkpoint',
    rootSha256: 'A'.repeat(64),
    workspaceRoot,
    files: [
      { path: 'src/example.ts', sha256: 'B'.repeat(64) },
      { path: 'tests/example.test.ts', sha256: 'C'.repeat(64) },
    ],
  }
}

function makeEvidenceAtom(overrides = {}) {
  return {
    id: 'APP-01.PRIVATE_SHELL.FUNC.01',
    parentRequirementId: 'APP-01',
    requiredEvidence: ['unit'],
    finalBoundary: ['local'],
    ...overrides,
  }
}

function makeEvidenceRow(overrides = {}) {
  return {
    id: 'EV-APP-01-UNIT-001',
    atomIds: ['APP-01.PRIVATE_SHELL.FUNC.01'],
    type: 'unit',
    command: 'node --test tests/example.test.ts',
    exitCode: 0,
    startedAt: '2026-08-11T01:00:00.000Z',
    completedAt: '2026-08-11T01:00:01.000Z',
    checkpoint: 'A'.repeat(64),
    sourcePaths: [
      { path: 'src/example.ts', sha256: 'B'.repeat(64) },
      { path: 'tests/example.test.ts', sha256: 'C'.repeat(64) },
    ],
    summary: '1 test passed; 0 failed; 0 skipped.',
    artifactPath: null,
    artifactSha256: null,
    skipped: false,
    manualReview: null,
    ...overrides,
  }
}

function makeEvidenceManifest(evidence) {
  return {
    schemaVersion: 1,
    checkpoint: 'A'.repeat(64),
    evidence,
  }
}

test('invalidates evidence when a dependent source path hash changes', async () => {
  const checkpoint = makeEvidenceCheckpoint()
  const atom = makeEvidenceAtom()
  const staleEvidence = makeEvidenceRow({
    sourcePaths: [{ path: 'src/example.ts', sha256: 'D'.repeat(64) }],
  })
  const issues = await validateEvidenceManifest(
    makeEvidenceManifest([staleEvidence]),
    { atoms: [atom] },
    checkpoint,
  )

  assert(issues.some((issue) => (
    issue.code === 'EVIDENCE_SOURCE_HASH_MISMATCH'
    && issue.evidenceId === staleEvidence.id
    && issue.path === 'src/example.ts'
  )))
  assert.equal(deriveAtomStatus(atom, [staleEvidence], checkpoint), 'invalidated')
})

test('rejects skipped MySQL and unopened visual artifacts', async () => {
  const checkpoint = makeEvidenceCheckpoint()
  const mysqlAtom = makeEvidenceAtom({
    id: 'DATA-01.DATA_MODEL.DATA.01',
    parentRequirementId: 'DATA-01',
    requiredEvidence: ['mysql'],
  })
  const visualAtom = makeEvidenceAtom({
    id: 'SPACE-01.PUBLIC_HOME.RESP.01',
    parentRequirementId: 'SPACE-01',
    requiredEvidence: ['visual', 'manual-review'],
  })
  const evidence = [
    makeEvidenceRow({
      id: 'EV-DATA-01-MYSQL-001',
      atomIds: [mysqlAtom.id],
      type: 'mysql',
      skipped: true,
      summary: 'MySQL suite skipped because no server was available.',
    }),
    makeEvidenceRow({
      id: 'EV-SPACE-01-VISUAL-001',
      atomIds: [visualAtom.id],
      type: 'visual',
      manualReview: {
        reviewer: 'primary-agent',
        opened: false,
        breakpoint: '1440x900',
        conclusion: 'pass',
        checklist: {
          overflow: 'pass',
          forbiddenPatterns: 'pass',
          hierarchy: 'pass',
          continuity: 'pass',
          reducedMotion: 'pass',
        },
      },
    }),
  ]
  const issues = await validateEvidenceManifest(
    makeEvidenceManifest(evidence),
    { atoms: [mysqlAtom, visualAtom] },
    checkpoint,
  )
  const codes = issues.map((issue) => issue.code)

  assert(codes.includes('REQUIRED_SUITE_SKIPPED'))
  assert(codes.includes('VISUAL_NOT_OPENED'))
})

test('rejects stale checkpoints, failed commands, unsafe artifacts and incomplete manual conclusions', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lifeops-evidence-invalid-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const checkpoint = makeEvidenceCheckpoint(root)
  const atom = makeEvidenceAtom({ requiredEvidence: ['visual', 'manual-review'] })
  const row = makeEvidenceRow({
    type: 'manual-review',
    exitCode: 1,
    checkpoint: 'D'.repeat(64),
    artifactPath: '../private/screenshot.png',
    artifactSha256: 'E'.repeat(64),
    manualReview: {
      reviewer: '',
      opened: true,
      breakpoint: 'wide',
      conclusion: '',
      checklist: { overflow: 'pass' },
    },
  })
  const issues = await validateEvidenceManifest(
    makeEvidenceManifest([row]),
    { atoms: [atom] },
    checkpoint,
  )
  const codes = issues.map((issue) => issue.code)

  assert(codes.includes('EVIDENCE_COMMAND_FAILED'))
  assert(codes.includes('EVIDENCE_CHECKPOINT_STALE'))
  assert(codes.includes('UNSAFE_ARTIFACT_PATH'))
  assert(codes.includes('MANUAL_REVIEW_INCOMPLETE'))
})

test('verifies an artifact hash and derives local, image and registry boundary statuses', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lifeops-evidence-status-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const artifactPath = 'outputs/evidence/unit/result.json'
  const artifactContents = '{"pass":true}\n'
  await writeFixtureTree(root, { [artifactPath]: artifactContents })
  const checkpoint = makeEvidenceCheckpoint(root)
  const localAtom = makeEvidenceAtom()
  const imageAtom = makeEvidenceAtom({
    id: 'APP-01.PRIVATE_SHELL.DATA.01',
    requiredEvidence: ['unit', 'image'],
    finalBoundary: ['local', 'image'],
  })
  const registryAtom = makeEvidenceAtom({
    id: 'DELIVERY-01.EXACT_DIGEST.TXN.01',
    parentRequirementId: 'DELIVERY-01',
    requiredEvidence: ['unit', 'image', 'registry'],
    finalBoundary: ['local', 'image', 'registry'],
  })
  const localEvidence = makeEvidenceRow({
    artifactPath,
    artifactSha256: rawSha256(artifactContents),
  })
  const imageEvidence = [
    makeEvidenceRow({ id: 'EV-APP-01-UNIT-002', atomIds: [imageAtom.id] }),
    makeEvidenceRow({ id: 'EV-APP-01-IMAGE-001', atomIds: [imageAtom.id], type: 'image' }),
  ]
  const registryEvidence = [
    makeEvidenceRow({ id: 'EV-DELIVERY-01-UNIT-001', atomIds: [registryAtom.id] }),
    makeEvidenceRow({ id: 'EV-DELIVERY-01-IMAGE-001', atomIds: [registryAtom.id], type: 'image' }),
    makeEvidenceRow({ id: 'EV-DELIVERY-01-REGISTRY-001', atomIds: [registryAtom.id], type: 'registry' }),
  ]
  const issues = await validateEvidenceManifest(
    makeEvidenceManifest([localEvidence, ...imageEvidence, ...registryEvidence]),
    { atoms: [localAtom, imageAtom, registryAtom] },
    checkpoint,
  )

  assert.deepEqual(issues, [])
  assert.equal(deriveAtomStatus(localAtom, [localEvidence], checkpoint), 'verified-local')
  assert.equal(deriveAtomStatus(imageAtom, imageEvidence, checkpoint), 'verified-image')
  assert.equal(deriveAtomStatus(registryAtom, registryEvidence, checkpoint), 'verified-registry')
  assert.equal(deriveAtomStatus(imageAtom, imageEvidence.slice(0, 1), checkpoint), 'partial')
})

test('parent rollup uses the least-complete applicable child and preserves invalidation', () => {
  assert.equal(deriveParentStatus('APP-01', ['verified-local', 'partial']), 'partial')
  assert.equal(deriveParentStatus('APP-01', ['verified-image', 'verified-local']), 'verified-local')
  assert.equal(deriveParentStatus('APP-01', ['verified-local', 'invalidated']), 'invalidated')
  assert.equal(deriveParentStatus('APP-01', []), 'pending')
})

test('an approved not-applicable atom does not cap a higher final boundary', () => {
  const registryAtom = makeEvidenceAtom({
    finalBoundary: ['local', 'image', 'registry'],
    notApplicable: {
      reason: 'Approved alternate delivery path.',
      approvedSourceClauseId: 'SC-TEST-0001',
    },
  })

  assert.equal(deriveAtomStatus(registryAtom, []), 'verified-registry')
})

test('real evidence manifest is current and preserves its atom-derived rollups', async () => {
  const matrix = await readJson(path.resolve('docs/traceability/acceptance-matrix.json'))
  const manifest = await readJson(path.resolve('docs/traceability/evidence-manifest.json'))
  const checkpoint = await buildLocalCheckpoint(process.cwd())
  const issues = await validateEvidenceManifest(manifest, matrix, checkpoint)
  const atomStatuses = new Map(matrix.atoms.map((atom) => [
    atom.id,
    deriveAtomStatus(atom, manifest.evidence, checkpoint),
  ]))
  const parentStatuses = new Map(PARENT_REQUIREMENT_IDS.map((parentId) => [
    parentId,
    deriveParentStatus(parentId, matrix.atoms
      .filter((atom) => atom.parentRequirementId === parentId)
      .map((atom) => atomStatuses.get(atom.id))),
  ]))

  assert.deepEqual(issues, [])
  assert.equal(manifest.evidence.length, 487)
  assert.equal([...atomStatuses.values()].filter((status) => status === 'verified-local').length, 957)
  assert.equal([...atomStatuses.values()].filter((status) => status === 'verified-image').length, 466)
  assert.equal([...atomStatuses.values()].filter((status) => status === 'verified-registry').length, 21)
  assert.equal([...parentStatuses.values()].filter((status) => status === 'verified-local').length, 34)
  assert.equal([...parentStatuses.values()].filter((status) => status === 'verified-image').length, 10)
  for (const parentId of [
    'GLOBAL-01', 'GOAL-01', 'SCHEDULE-01', 'HABIT-01', 'REVIEW-01',
    'KNOW-01', 'PLATFORM-01', 'OBS-01', 'LIFE-02', 'LIFE-03', 'LIFE-04',
    'LIFE-05', 'LIFE-06', 'LIFE-07', 'LIFE-08', 'LIFE-09', 'LIFE-10',
    'LIFE-11', 'LIFE-12', 'LIFE-13', 'LIFE-14', 'LIFE-15', 'LIFE-16',
    'LIFE-17', 'LIFE-18', 'LIFE-21', 'LIFE-22', 'MOTION-01', 'SPACE-01', 'STATE-01',
    'PUB-01', 'AUTH-01', 'DATA-01', 'DELIVERY-01',
  ]) {
    assert.equal(parentStatuses.get(parentId), 'verified-local')
  }
  for (const parentId of ['PUB-02', 'SEC-01', 'APP-01', 'RECORD-01', 'PUBLISH-01', 'LIFE-01', 'LIFE-19', 'LIFE-20', 'LIFE-23', 'LIFE-24']) {
    assert.equal(parentStatuses.get(parentId), 'verified-image')
  }
})

test('rejects duplicate evidence, unknown references and missing or mismatched artifacts', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lifeops-evidence-shape-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFixtureTree(root, { 'outputs/evidence/unit/present.json': '{}\n' })
  const checkpoint = makeEvidenceCheckpoint(root)
  const atom = makeEvidenceAtom()
  const rows = [
    makeEvidenceRow({
      artifactPath: 'outputs/evidence/unit/present.json',
      artifactSha256: 'D'.repeat(64),
    }),
    makeEvidenceRow({
      atomIds: ['APP-01.UNKNOWN.FUNC.01'],
      type: 'api',
      artifactPath: 'outputs/evidence/unit/missing.json',
      artifactSha256: 'E'.repeat(64),
    }),
  ]
  const issues = await validateEvidenceManifest(
    makeEvidenceManifest(rows),
    { atoms: [atom] },
    checkpoint,
  )
  const codes = issues.map((issue) => issue.code)

  assert(codes.includes('DUPLICATE_EVIDENCE_ID'))
  assert(codes.includes('UNKNOWN_EVIDENCE_ATOM'))
  assert(codes.includes('EVIDENCE_TYPE_NOT_REQUIRED'))
  assert(codes.includes('ARTIFACT_HASH_MISMATCH'))
  assert(codes.includes('ARTIFACT_MISSING'))
})

function makeStartupContext(overrides = {}) {
  return {
    workspaceRoot: 'C:/workspace/lifeops-web',
    expectedWorkspaceRoot: 'C:/workspace/lifeops-web',
    authorityIssues: [],
    sourceIssues: [],
    acceptanceIssues: [],
    evidenceIssues: [],
    requirementIds: [...PARENT_REQUIREMENT_IDS],
    requirementsBoundary: {
      nextAction: 'Task 8 Step 1',
    },
    matrix: {
      parentRequirementIds: [...PARENT_REQUIREMENT_IDS],
      atoms: PARENT_REQUIREMENT_IDS.map((parentRequirementId, index) => ({
        id: `${parentRequirementId}.STARTUP.FUNC.${String((index % 99) + 1).padStart(2, '0')}`,
        parentRequirementId,
      })),
    },
    execution: {
      authorityRevision: 'ADR-020',
      status: 'execution-guard-implementation-active',
      activePlan: 'P1',
      activeTask: 'P1-T1',
      activeStep: 1,
      requirementsVerified: '0/44',
      activeTaskIds: ['P1-T1'],
      nextActions: ['Task 8 Step 1'],
      firstCommand: 'node --test scripts/verify-execution-contract.test.mjs',
    },
    current: {
      authorityRevision: 'ADR-020',
      status: 'execution-guard-implementation-active',
      activePlan: 'P1',
      activeTask: 'P1-T1',
      activeStep: 1,
      requirementsVerified: '0/44',
      nextAction: 'Task 8 Step 1',
    },
    session: {
      authorityRevision: 'ADR-020',
      status: 'execution-guard-implementation-active',
      activePlan: 'P1',
      activeTask: 'P1-T1',
      activeStep: 1,
      requirementsVerified: '0/44',
      nextAction: 'Task 8 Step 1',
    },
    ...overrides,
  }
}

test('startup rejects the wrong workspace, authority drift and a missing current source', () => {
  const context = makeStartupContext({
    workspaceRoot: 'C:/workspace/wrong-project',
    authorityIssues: [{ code: 'AUTHORITY_HASH_MISMATCH', path: 'docs/spec.md' }],
    sourceIssues: [{ code: 'CURRENT_SOURCE_MISSING', path: 'docs/plan.md' }],
  })
  const codes = validateStartup(context).map((issue) => issue.code)

  assert(codes.includes('WRONG_WORKSPACE_ROOT'))
  assert(codes.includes('AUTHORITY_HASH_MISMATCH'))
  assert(codes.includes('CURRENT_SOURCE_MISSING'))
})

test('startup rejects duplicate requirement rows and every parent without an atom', () => {
  const requirementIds = [...PARENT_REQUIREMENT_IDS, 'LIFE-24']
  const matrix = makeStartupContext().matrix
  matrix.atoms = matrix.atoms.filter((atom) => atom.parentRequirementId !== 'LIFE-24')
  const issues = validateStartup(makeStartupContext({ requirementIds, matrix }))

  assert(issues.some((issue) => issue.code === 'DUPLICATE_REQUIREMENT_ID' && issue.requirementId === 'LIFE-24'))
  assert(issues.some((issue) => issue.code === 'PARENT_WITHOUT_ATOM' && issue.parentRequirementId === 'LIFE-24'))
})

test('startup rejects a stale requirements task boundary even when requirement rows are current', () => {
  const context = makeStartupContext({
    requirementsBoundary: { nextAction: 'P1-T2 Step 1' },
  })

  assert.deepEqual(
    validateStartup(context).filter((issue) => issue.code === 'REQUIREMENTS_TASK_BOUNDARY_MISMATCH'),
    [{
      code: 'REQUIREMENTS_TASK_BOUNDARY_MISMATCH',
      expected: 'Task 8 Step 1',
      actual: 'P1-T2 Step 1',
    }],
  )
})

test('requirements boundary parsing selects the current action after a completed step on the same line', () => {
  const text = '**Latest task-boundary truth:** P3-T5 Step 1 installed exact dependencies, and P3-T5 Step 2 is the next ordered action.'

  assert.deepEqual(parseRequirementsBoundary(text), { nextAction: 'P3-T5 Step 2' })
})

test('startup rejects multiple active tasks, handoff disagreement and a missing unique next action', () => {
  const base = makeStartupContext()
  const context = makeStartupContext({
    execution: {
      ...base.execution,
      activeTaskIds: ['P1-T1', 'P1-T2'],
      nextActions: [],
    },
    current: {
      ...base.current,
      activeTask: 'P1-T2',
    },
    session: {
      ...base.session,
      activeStep: 2,
    },
  })
  const codes = validateStartup(context).map((issue) => issue.code)

  assert(codes.includes('MULTIPLE_ACTIVE_TASKS'))
  assert(codes.includes('CURRENT_STATE_MISMATCH'))
  assert(codes.includes('SESSION_STATE_MISMATCH'))
  assert(codes.includes('NEXT_ACTION_NOT_UNIQUE'))
})

test('project memory root resolution prefers CLI, then environment, then the AGENTS canonical path', () => {
  const agentsText = 'Use `D:\\canonical\\LifeOps\\CURRENT.md` as the project ledger.'

  assert.equal(
    resolveProjectMemoryRoot(
      ['--project-memory-root', 'C:\\cli\\LifeOps'],
      { LIFEOPS_PROJECT_MEMORY_ROOT: 'C:\\env\\LifeOps' },
      agentsText,
    ),
    path.resolve('C:\\cli\\LifeOps'),
  )
  assert.equal(
    resolveProjectMemoryRoot([], { LIFEOPS_PROJECT_MEMORY_ROOT: 'C:\\env\\LifeOps' }, agentsText),
    path.resolve('C:\\env\\LifeOps'),
  )
  assert.equal(
    resolveProjectMemoryRoot([], {}, agentsText),
    path.resolve('D:\\canonical\\LifeOps'),
  )
})

test('project state loading selects the highest occupied session without reusing its number', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lifeops-project-state-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const memoryRoot = path.join(root, 'memory')
  await writeFixtureTree(root, {
    'docs/superpowers/plans/2026-08-09-execution-control.md': '---\nactive_task: P1-T1\nactive_step: 1\n---\n\n## Next atomic action\nTask 8 Step 1.\n',
    'memory/CURRENT.md': 'Task 8 Step 1; P1-T1; Step 1; 0/44.\n',
    'memory/DECISIONS.md': '# Decisions\n',
    'memory/sessions/2026-08-10_S015_old.md': 'old session\n',
    'memory/sessions/2026-08-11_S016_current.md': 'Task 8 Step 1; P1-T1; Step 1; 0/44.\n',
  })

  const state = await loadProjectState(root, memoryRoot)

  assert.equal(state.latestSession.number, 16)
  assert.equal(state.latestSession.nextNumber, 17)
  assert.equal(state.latestSession.path.endsWith('2026-08-11_S016_current.md'), true)
  assert.match(state.executionControl.text, /active_task: P1-T1/)
  assert.match(state.current.text, /Task 8 Step 1/)
})

test('project state loading rejects a missing canonical ledger or session directory', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lifeops-project-state-missing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFixtureTree(root, {
    'docs/superpowers/plans/2026-08-09-execution-control.md': '# Control\n',
    'memory/DECISIONS.md': '# Decisions\n',
  })

  await assert.rejects(
    () => loadProjectState(root, path.join(root, 'memory')),
    /CURRENT\.md|sessions/,
  )
})

test('execution-state parsing extracts the exact active state, unique next action and first command', () => {
  const text = `---
authority_revision: ADR-020
status: execution-guard-implementation-active
active_plan: P1
active_task: P1-T1
active_step: 1
requirements_verified: 0/44
---

## Next atomic action

Start Task 8, Step 1 and keep product work frozen. The first verification command is \`node --test scripts/verify-execution-contract.test.mjs\`.
`
  const state = parseExecutionState(text)

  assert.deepEqual(state, {
    authorityRevision: 'ADR-020',
    status: 'execution-guard-implementation-active',
    activePlan: 'P1',
    activeTask: 'P1-T1',
    activeStep: 1,
    requirementsVerified: '0/44',
    activeTaskIds: ['P1-T1'],
    nextActions: ['Task 8 Step 1'],
    firstCommand: 'node --test scripts/verify-execution-contract.test.mjs',
  })
})

test('execution-state parsing accepts the active product task step after guard completion', () => {
  const text = `---
authority_revision: ADR-020
status: implementation-active
active_plan: P1
active_task: P1-T1
active_step: 1
requirements_verified: 0/44
---

## Next atomic action

P1-T1 Step 1 is the only next action. The first verification command is \`npm.cmd run test:server -- server/src/db/migrate.test.ts\`.
`

  assert.deepEqual(parseExecutionState(text), {
    authorityRevision: 'ADR-020',
    status: 'implementation-active',
    activePlan: 'P1',
    activeTask: 'P1-T1',
    activeStep: 1,
    requirementsVerified: '0/44',
    activeTaskIds: ['P1-T1'],
    nextActions: ['P1-T1 Step 1'],
    firstCommand: 'npm.cmd run test:server -- server/src/db/migrate.test.ts',
  })
})

test('mirror-state parsing uses the latest handoff action and requires the active product tuple', () => {
  const execution = makeStartupContext().execution
  const text = `Historical next action: Task 7 Step 1.
Current status is execution-guard-implementation-active under ADR-020.
The product tuple remains P1 / P1-T1 / Step 1 / 0/44.
Current next action: Task 8 Step 1.
`

  assert.deepEqual(parseMirrorState(text, execution), {
    authorityRevision: 'ADR-020',
    status: 'execution-guard-implementation-active',
    activePlan: 'P1',
    activeTask: 'P1-T1',
    activeStep: 1,
    requirementsVerified: '0/44',
    nextAction: 'Task 8 Step 1',
  })
})

test('mirror-state parsing keeps the latest product task action after guard completion', () => {
  const execution = {
    ...makeStartupContext().execution,
    status: 'implementation-active',
    nextActions: ['P1-T1 Step 1'],
  }
  const text = `Historical next action: Task 10 Step 9.
Current status is implementation-active under ADR-020.
The product tuple remains P1 / P1-T1 / Step 1 / 0/44.
Current next action: P1-T1 Step 1.
`

  assert.deepEqual(parseMirrorState(text, execution), {
    authorityRevision: 'ADR-020',
    status: 'implementation-active',
    activePlan: 'P1',
    activeTask: 'P1-T1',
    activeStep: 1,
    requirementsVerified: '0/44',
    nextAction: 'P1-T1 Step 1',
  })
})

test('startup success report contains stable authority, state, rollup, checkpoint and continuation fields', () => {
  const context = makeStartupContext()
  const report = buildStartupReport({
    mode: 'startup',
    context,
    issues: [],
    checkpoint: { kind: 'uncommitted-local-checkpoint', rootSha256: 'A'.repeat(64) },
    parentStatuses: new Map(PARENT_REQUIREMENT_IDS.map((parentId) => [parentId, 'pending'])),
    projectMemoryRootSource: 'AGENTS.md',
  })

  assert.deepEqual(report, {
    ok: true,
    mode: 'startup',
    authorityRevision: 'ADR-020',
    status: 'execution-guard-implementation-active',
    activePlan: 'P1',
    activeTask: 'P1-T1',
    activeStep: 1,
    requirementsVerified: '0/44',
    rollups: { pending: 44 },
    checkpoint: {
      kind: 'uncommitted-local-checkpoint',
      rootSha256: 'A'.repeat(64),
    },
    blockers: [],
    nextAction: 'Task 8 Step 1',
    firstCommand: 'node --test scripts/verify-execution-contract.test.mjs',
    projectMemoryRootSource: 'AGENTS.md',
    issues: [],
  })
})

const TASK_STATE_SEQUENCE = [
  'pending',
  'in_progress',
  'red_verified',
  'implementation_complete',
  'focused_green',
  'regression_green',
  'visually_verified',
  'checkpointed',
  'completed',
]

const REQUIRED_VISUAL_BREAKPOINTS = ['1440x900', '1024x768', '768x1024', '390x844']

function makeTaskCloseContext(taskOverrides = {}, contextOverrides = {}) {
  const checkpoint = 'A'.repeat(64)
  const task = {
    id: 'P1-T1',
    phaseId: 'P1',
    stateHistory: [...TASK_STATE_SEQUENCE],
    declaredPaths: ['server/src/db/migrate.ts', 'server/src/db/migrate.test.ts'],
    changedPaths: ['server/src/db/migrate.ts', 'server/src/db/migrate.test.ts'],
    extraPathReasons: {},
    requiredAtomIds: ['DATA-01.MIGRATION.TXN.01'],
    requiresMysql: true,
    uiChanged: true,
    handoffRecorded: true,
    redEvidence: [{
      classification: 'behavioral',
      command: 'npm.cmd run test:server -- server/src/db/migrate.test.ts',
      exitCode: 1,
      failure: 'Expected migration checksum mismatch to be rejected.',
    }],
    evidence: [
      {
        type: 'mysql',
        exitCode: 0,
        skipped: false,
        checkpoint,
      },
      ...REQUIRED_VISUAL_BREAKPOINTS.map((breakpoint) => ({
        type: 'visual',
        exitCode: 0,
        skipped: false,
        checkpoint,
        manualReview: {
          reviewer: 'primary-agent',
          opened: true,
          breakpoint,
          conclusion: 'pass',
          checklist: {
            keyboard: 'pass',
            reducedMotion: 'pass',
          },
        },
      })),
      { type: 'a11y', subtype: 'keyboard', exitCode: 0, skipped: false, checkpoint },
      { type: 'e2e-local', subtype: 'reduced-motion', exitCode: 0, skipped: false, checkpoint },
    ],
    checkpoint: {
      kind: 'uncommitted-local-checkpoint',
      rootSha256: checkpoint,
    },
    ...taskOverrides,
  }
  return {
    tasks: [task],
    atomStatuses: new Map([['DATA-01.MIGRATION.TXN.01', 'verified-local']]),
    ...contextOverrides,
  }
}

test('task-close rejects missing or non-behavioral red evidence', () => {
  const missing = validateTaskClose(makeTaskCloseContext({ redEvidence: [] }), 'P1-T1')
  const syntaxOnly = validateTaskClose(makeTaskCloseContext({
    redEvidence: [{
      classification: 'syntax',
      command: 'node --check server/src/db/migrate.ts',
      exitCode: 1,
      failure: 'SyntaxError: unexpected token',
    }],
  }), 'P1-T1')

  assert(missing.some((issue) => issue.code === 'BEHAVIORAL_RED_EVIDENCE_MISSING'))
  assert(syntaxOnly.some((issue) => issue.code === 'RED_EVIDENCE_NOT_BEHAVIORAL'))
})

test('task-close rejects undeclared changes, skipped MySQL and an absent checkpoint', () => {
  const context = makeTaskCloseContext({
    changedPaths: [
      'server/src/db/migrate.ts',
      'server/src/db/migrate.test.ts',
      'src/unplanned.ts',
    ],
    evidence: makeTaskCloseContext().tasks[0].evidence.map((row) => (
      row.type === 'mysql' ? { ...row, skipped: true } : row
    )),
    checkpoint: null,
  })
  const issues = validateTaskClose(context, 'P1-T1')

  assert(issues.some((issue) => (
    issue.code === 'UNDECLARED_CHANGED_PATH' && issue.path === 'src/unplanned.ts'
  )))
  assert(issues.some((issue) => issue.code === 'REQUIRED_MYSQL_SKIPPED'))
  assert(issues.some((issue) => issue.code === 'TASK_CHECKPOINT_MISSING'))
})

test('task-close rejects incomplete opened visual, keyboard and reduced-motion evidence', () => {
  const baseEvidence = makeTaskCloseContext().tasks[0].evidence
  const context = makeTaskCloseContext({
    evidence: baseEvidence
      .filter((row) => row.subtype !== 'keyboard' && row.subtype !== 'reduced-motion')
      .filter((row) => row.manualReview?.breakpoint !== '390x844')
      .map((row) => row.type === 'visual'
        ? { ...row, manualReview: { ...row.manualReview, opened: false } }
        : row),
  })
  const issues = validateTaskClose(context, 'P1-T1')

  assert(issues.some((issue) => (
    issue.code === 'VISUAL_BREAKPOINT_MISSING' && issue.breakpoint === '390x844'
  )))
  assert(issues.some((issue) => issue.code === 'MANUAL_VISUAL_REVIEW_MISSING'))
  assert(issues.some((issue) => issue.code === 'KEYBOARD_EVIDENCE_MISSING'))
  assert(issues.some((issue) => issue.code === 'REDUCED_MOTION_EVIDENCE_MISSING'))
})

test('task-close accepts task-scoped partial atom boundaries when later tasks own the remaining evidence', () => {
  const checkpoint = 'A'.repeat(64)
  const context = makeTaskCloseContext({
    uiChanged: false,
    requiredAtomIds: ['KNOW-01.KNOWLEDGE_ROUTE.FUNC.01'],
    requiredAtomBoundaries: new Map([['KNOW-01.KNOWLEDGE_ROUTE.FUNC.01', 'partial']]),
    evidence: [{ type: 'mysql', exitCode: 0, skipped: false, checkpoint }],
  }, {
    atomStatuses: new Map([['KNOW-01.KNOWLEDGE_ROUTE.FUNC.01', 'partial']]),
  })

  assert.deepEqual(validateTaskClose(context, 'P1-T1'), [])
})

function makePhaseCloseContext(overrides = {}) {
  const checkpoint = 'A'.repeat(64)
  return {
    phaseOrder: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
    phases: [{
      id: 'P1',
      taskIds: ['P1-T1', 'P1-T2'],
      requiredAtomIds: ['DATA-01.MIGRATION.TXN.01', 'MOTION-01.SHELL.MOTION.01'],
      finalBoundary: 'verified-local',
    }],
    tasks: [
      {
        id: 'P1-T1',
        phaseId: 'P1',
        currentState: 'completed',
        checkpoint: { rootSha256: checkpoint },
      },
      {
        id: 'P1-T2',
        phaseId: 'P1',
        currentState: 'completed',
        checkpoint: { rootSha256: checkpoint },
      },
    ],
    atomStatuses: new Map([
      ['DATA-01.MIGRATION.TXN.01', 'verified-local'],
      ['MOTION-01.SHELL.MOTION.01', 'verified-local'],
    ]),
    implementedTaskIds: ['P1-T1', 'P1-T2'],
    ...overrides,
  }
}

test('phase-close rejects incomplete tasks, mixed checkpoints, incomplete atoms and later work', () => {
  const base = makePhaseCloseContext()
  const context = makePhaseCloseContext({
    tasks: [
      { ...base.tasks[0], currentState: 'regression_green' },
      { ...base.tasks[1], checkpoint: { rootSha256: 'B'.repeat(64) } },
      {
        id: 'P2-T1',
        phaseId: 'P2',
        currentState: 'implementation_complete',
        checkpoint: { rootSha256: 'B'.repeat(64) },
      },
    ],
    atomStatuses: new Map([
      ['DATA-01.MIGRATION.TXN.01', 'verified-local'],
      ['MOTION-01.SHELL.MOTION.01', 'partial'],
    ]),
    implementedTaskIds: ['P1-T1', 'P1-T2', 'P2-T1'],
  })
  const issues = validatePhaseClose(context, 'P1')

  assert(issues.some((issue) => (
    issue.code === 'PHASE_TASK_INCOMPLETE' && issue.taskId === 'P1-T1'
  )))
  assert(issues.some((issue) => issue.code === 'PHASE_CHECKPOINT_MISMATCH'))
  assert(issues.some((issue) => (
    issue.code === 'PHASE_ATOM_INCOMPLETE' && issue.atomId === 'MOTION-01.SHELL.MOTION.01'
  )))
  assert(issues.some((issue) => (
    issue.code === 'LATER_PHASE_IMPLEMENTED_EARLY' && issue.taskId === 'P2-T1'
  )))
})

test('phase-close applies each atom final boundary instead of one phase-wide minimum', () => {
  const base = makePhaseCloseContext()
  const context = makePhaseCloseContext({
    phases: [{
      ...base.phases[0],
      requiredAtomBoundaries: new Map([
        ['DATA-01.MIGRATION.TXN.01', 'verified-local'],
        ['MOTION-01.SHELL.MOTION.01', 'verified-registry'],
      ]),
    }],
    atomStatuses: new Map([
      ['DATA-01.MIGRATION.TXN.01', 'verified-local'],
      ['MOTION-01.SHELL.MOTION.01', 'verified-image'],
    ]),
  })

  assert(validatePhaseClose(context, 'P1').some((issue) => (
    issue.code === 'PHASE_ATOM_INCOMPLETE'
    && issue.atomId === 'MOTION-01.SHELL.MOTION.01'
    && issue.requiredStatus === 'verified-registry'
  )))
})

test('phase-close context derives completed tasks and only the closing task declared parent slice', () => {
  const checkpoint = { rootSha256: 'A'.repeat(64) }
  const context = buildPhaseCloseContext({
    phaseId: 'P3',
    checkpoint,
    planTexts: {
      P3: [
        '### P3-T1: Build private shell',
        '- [x] implement',
        '### P3-T2: Closure and handoff',
        '**Interfaces:**',
        '- Closes APP-01 and LIFE-01 through LIFE-02 at their declared phase boundaries.',
        '- [x] audit',
      ].join('\n'),
      P4: '### P4-T1: Later work\n- [ ] not started\n',
    },
    matrix: {
      atoms: [
        { id: 'APP-01.PRIVATE.FUNC.01', parentRequirementId: 'APP-01', plannedTasks: ['P3-T1'], finalBoundary: ['local', 'image'] },
        { id: 'LIFE-01.TODAY.FUNC.01', parentRequirementId: 'LIFE-01', plannedTasks: ['P3-T2', 'P5-T1'], finalBoundary: ['local'] },
        { id: 'LIFE-02.CALENDAR.FUNC.01', parentRequirementId: 'LIFE-02', plannedTasks: ['P3-T2'], finalBoundary: ['local'] },
        { id: 'SPACE-01.PUBLIC.LAYOUT.01', parentRequirementId: 'SPACE-01', plannedTasks: ['P2-T1', 'P3-T1', 'P6-T1'], finalBoundary: ['local'] },
      ],
    },
    atomStatuses: new Map(),
  })

  assert.deepEqual(context.phases[0].taskIds, ['P3-T1', 'P3-T2'])
  assert(context.tasks.every((task) => task.currentState === 'completed'))
  assert(context.tasks.every((task) => task.checkpoint.rootSha256 === checkpoint.rootSha256))
  assert.deepEqual(context.phases[0].requiredAtomIds, [
    'APP-01.PRIVATE.FUNC.01',
    'LIFE-01.TODAY.FUNC.01',
    'LIFE-02.CALENDAR.FUNC.01',
  ])
  assert.equal(context.phases[0].requiredAtomBoundaries.get('APP-01.PRIVATE.FUNC.01'), 'partial')
  assert.equal(context.phases[0].requiredAtomBoundaries.get('LIFE-01.TODAY.FUNC.01'), 'partial')
  assert.equal(context.phases[0].requiredAtomBoundaries.get('LIFE-02.CALENDAR.FUNC.01'), 'verified-local')
  assert.deepEqual(context.implementedTaskIds, ['P3-T1', 'P3-T2'])
})

test('phase-close context detects checkbox work in a later phase', () => {
  const context = buildPhaseCloseContext({
    phaseId: 'P3',
    checkpoint: { rootSha256: 'A'.repeat(64) },
    planTexts: {
      P3: '### P3-T1: Closure\n- Closes APP-01.\n- [x] done\n',
      P4: '### P4-T1: Later work\n- [x] started early\n- [ ] unfinished\n',
    },
    matrix: { atoms: [] },
    atomStatuses: new Map(),
  })

  assert(context.implementedTaskIds.includes('P4-T1'))
})

function makeHandoffContext(overrides = {}) {
  const parentStatuses = new Map(PARENT_REQUIREMENT_IDS.map((parentId) => [parentId, 'pending']))
  return {
    execution: {
      authorityRevision: 'ADR-020',
      status: 'execution-guard-implementation-active',
      activePlan: 'P1',
      activeTask: 'P1-T1',
      activeStep: 1,
      requirementsVerified: '0/44',
      completedTaskIds: ['Task 1', 'Task 2', 'Task 3', 'Task 4', 'Task 5', 'Task 6', 'Task 7', 'Task 8'],
      nextActions: ['Task 9 Step 1'],
    },
    planState: {
      activePlan: 'P1',
      activeTask: 'P1-T1',
      activeStep: 1,
      completedTaskIds: ['Task 1', 'Task 2', 'Task 3', 'Task 4', 'Task 5', 'Task 6', 'Task 7', 'Task 8'],
      nextAction: 'Task 9 Step 1',
    },
    requirementStatuses: new Map(parentStatuses),
    parentStatuses,
    current: {
      authorityRevision: 'ADR-020',
      status: 'execution-guard-implementation-active',
      activePlan: 'P1',
      activeTask: 'P1-T1',
      activeStep: 1,
      requirementsVerified: '0/44',
      nextAction: 'Task 9 Step 1',
    },
    session: {
      authorityRevision: 'ADR-020',
      status: 'execution-guard-implementation-active',
      activePlan: 'P1',
      activeTask: 'P1-T1',
      activeStep: 1,
      requirementsVerified: '0/44',
      nextAction: 'Task 9 Step 1',
    },
    sessionPaths: ['sessions/2026-08-11_S016_current.md'],
    nextSessionPath: 'sessions/2026-08-11_S017_next.md',
    ...overrides,
  }
}

test('handoff rejects control, checkbox, rollup, mirror, next-action and session-number disagreement', () => {
  const base = makeHandoffContext()
  const context = makeHandoffContext({
    execution: {
      ...base.execution,
      nextActions: ['Task 9 Step 1', 'Task 9 Step 2'],
    },
    planState: {
      ...base.planState,
      activeTask: 'P1-T2',
      completedTaskIds: base.planState.completedTaskIds.slice(0, -1),
    },
    requirementStatuses: new Map([
      ...base.requirementStatuses,
      ['APP-01', 'verified-local'],
    ]),
    current: { ...base.current, activeStep: 2 },
    session: { ...base.session, activeTask: 'P2-T1' },
    nextSessionPath: 'sessions/2026-08-11_S016_current.md',
  })
  const codes = validateHandoff(context).map((issue) => issue.code)

  assert(codes.includes('HANDOFF_PLAN_STATE_MISMATCH'))
  assert(codes.includes('HANDOFF_PLAN_CHECKBOX_MISMATCH'))
  assert(codes.includes('HANDOFF_REQUIREMENT_STATUS_MISMATCH'))
  assert(codes.includes('HANDOFF_CURRENT_STATE_MISMATCH'))
  assert(codes.includes('HANDOFF_SESSION_STATE_MISMATCH'))
  assert(codes.includes('HANDOFF_NEXT_ACTION_NOT_UNIQUE'))
  assert(codes.includes('HANDOFF_SESSION_PATH_REUSED'))
})

test('handoff normalizes ledger in-progress and blocked states to atomic rollup vocabulary', () => {
  const base = makeHandoffContext()
  const requirementStatuses = new Map(base.requirementStatuses)
  requirementStatuses.set('APP-01', 'in_progress')
  requirementStatuses.set('GOAL-01', 'blocked')
  const parentStatuses = new Map(base.parentStatuses)
  parentStatuses.set('APP-01', 'partial')
  parentStatuses.set('GOAL-01', 'invalidated')

  assert.deepEqual(validateHandoff(makeHandoffContext({ requirementStatuses, parentStatuses })), [])
})

function immutableImage(component, digestCharacter) {
  const digest = `sha256:${digestCharacter.repeat(64)}`
  return {
    component,
    digest,
    reference: `uhub.service.ucloud.cn/lifeops/${component}@${digest}`,
  }
}

function makeProjectCloseContext(overrides = {}) {
  const revision = '1'.repeat(40)
  const webImage = immutableImage('lifeops-web', 'a')
  const apiImage = immutableImage('lifeops-api', 'b')
  const parentStatuses = new Map(PARENT_REQUIREMENT_IDS.map((parentId) => [
    parentId,
    parentId === 'DELIVERY-01' ? 'verified-registry' : 'verified-image',
  ]))
  return {
    parentStatuses,
    finalRevision: { kind: 'git', revision },
    finalGates: [
      'web',
      'api',
      'mysql',
      'e2e',
      'visual',
      'accessibility',
      'security',
      'build',
      'helm',
    ].map((type) => ({ type, checkpoint: revision, exitCode: 0, skipped: false })),
    images: { web: webImage, api: apiImage },
    productionValues: {
      revision,
      webDigest: webImage.digest,
      apiDigest: apiImage.digest,
      placeholders: [],
    },
    exactDigestSmoke: [
      { component: 'web', digest: webImage.digest, checkpoint: revision, exitCode: 0, skipped: false },
      { component: 'api', digest: apiImage.digest, checkpoint: revision, exitCode: 0, skipped: false },
    ],
    supplyChain: {
      web: {
        sbom: { digest: webImage.digest, verified: true },
        provenance: { digest: webImage.digest, verified: true },
      },
      api: {
        sbom: { digest: apiImage.digest, verified: true },
        provenance: { digest: apiImage.digest, verified: true },
      },
    },
    registryInspect: [
      { component: 'web', digest: webImage.digest, exitCode: 0 },
      { component: 'api', digest: apiImage.digest, exitCode: 0 },
    ],
    deliveryPackage: {
      helm: true,
      gitops: true,
      argoExample: true,
      postDeploySmokeDocument: true,
      backupRestoreDocument: true,
      mediaStorageDocument: true,
      platformIntegrationDocument: true,
      rollbackDocument: true,
    },
    runtimeTruth: {
      knownSinglePointsRecorded: true,
      disconnectedPlatformsRecorded: true,
    },
    userOwnedClusterEvidence: {
      argoSynced: null,
      argoHealthy: null,
      kubernetesContext: null,
      hostname: null,
      podRebuild: null,
      clusterSmoke: null,
    },
    ...overrides,
  }
}

test('project-close rejects mutable or incomplete immutable release evidence and delivery docs', () => {
  const base = makeProjectCloseContext()
  const context = makeProjectCloseContext({
    parentStatuses: new Map([...base.parentStatuses, ['APP-01', 'partial']]),
    finalRevision: null,
    finalGates: base.finalGates.map((gate, index) => (
      index === 0 ? { ...gate, checkpoint: '2'.repeat(40) } : gate
    )),
    images: {
      web: { component: 'lifeops-web', digest: null, reference: 'uhub.service.ucloud.cn/lifeops/lifeops-web:latest' },
      api: { component: 'lifeops-api', digest: null, reference: null },
    },
    productionValues: {
      revision: '${GIT_REVISION}',
      webDigest: 'sha256:deadbeef',
      apiDigest: 'REPLACE_ME',
      placeholders: ['${GIT_REVISION}', 'REPLACE_ME'],
    },
    exactDigestSmoke: [],
    supplyChain: {
      web: { sbom: null, provenance: null },
      api: { sbom: null, provenance: null },
    },
    registryInspect: [{ component: 'web', digest: null, exitCode: 1 }],
    deliveryPackage: {
      helm: true,
      gitops: true,
      argoExample: true,
      postDeploySmokeDocument: false,
      backupRestoreDocument: false,
      mediaStorageDocument: true,
      platformIntegrationDocument: true,
      rollbackDocument: false,
    },
  })
  const codes = validateProjectClose(context).map((issue) => issue.code)

  assert(codes.includes('PROJECT_REQUIREMENT_INCOMPLETE'))
  assert(codes.includes('FORMAL_GIT_REVISION_MISSING'))
  assert(codes.includes('FINAL_GATE_CHECKPOINT_MISMATCH'))
  assert(codes.includes('MUTABLE_IMAGE_REFERENCE'))
  assert(codes.includes('WEB_IMAGE_DIGEST_MISSING'))
  assert(codes.includes('API_IMAGE_DIGEST_MISSING'))
  assert(codes.includes('PRODUCTION_VALUES_DIGEST_MISMATCH'))
  assert(codes.includes('PRODUCTION_VALUES_PLACEHOLDER'))
  assert(codes.includes('EXACT_DIGEST_SMOKE_MISSING'))
  assert(codes.includes('SBOM_MISSING'))
  assert(codes.includes('PROVENANCE_MISSING'))
  assert(codes.includes('REGISTRY_INSPECT_FAILED'))
  assert(codes.includes('DELIVERY_DOCUMENT_MISSING'))
})

test('project-close does not require user-owned cluster deployment evidence', () => {
  assert.deepEqual(validateProjectClose(makeProjectCloseContext()), [])
})

test('project-close applies each atom local, image or registry final boundary exactly', () => {
  const base = makeProjectCloseContext()
  const parentStatuses = new Map(base.parentStatuses)
  parentStatuses.set('APP-01', 'verified-local')
  const projectAtoms = [
    { id: 'APP-01.LOCAL.01', status: 'verified-local', finalBoundary: ['local'] },
    { id: 'PUB-01.IMAGE.01', status: 'verified-image', finalBoundary: ['local', 'image'] },
    { id: 'DELIVERY-01.REGISTRY.01', status: 'verified-registry', finalBoundary: ['local', 'image', 'registry'] },
  ]

  assert.deepEqual(validateProjectClose(makeProjectCloseContext({ parentStatuses, projectAtoms })), [])
})

test('project-close CLI consumes repository-backed final release metadata', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'lifeops-project-close-'))
  const manifestPath = path.join(temporaryRoot, 'project-close-manifest.json')
  const {
    parentStatuses: _parentStatuses,
    projectAtoms: _projectAtoms,
    userOwnedClusterEvidence: _userOwnedClusterEvidence,
    ...releaseMetadata
  } = makeProjectCloseContext()
  const runProjectClose = async () => {
    let stdout = ''
    try {
      ({ stdout } = await execFileAsync(process.execPath, [
        path.resolve('scripts/verify-execution-contract.mjs'),
        '--mode',
        'project-close',
        '--project-close-manifest',
        manifestPath,
      ], {
        cwd: process.cwd(),
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
      }))
    } catch (error) {
      assert.equal(error.code, 1)
      stdout = error.stdout
    }
    return JSON.parse(stdout)
  }
  await writeFile(manifestPath, `${JSON.stringify({ schemaVersion: 1, ...releaseMetadata }, null, 2)}\n`, 'utf8')

  try {
    const report = await runProjectClose()
    const codes = new Set(report.issues.map((issue) => issue.code))
    for (const code of [
      'FORMAL_GIT_REVISION_MISSING',
      'FINAL_GATE_MISSING_OR_FAILED',
      'WEB_IMAGE_DIGEST_MISSING',
      'API_IMAGE_DIGEST_MISSING',
      'PRODUCTION_VALUES_REVISION_MISMATCH',
      'EXACT_DIGEST_SMOKE_MISSING',
      'SBOM_MISSING',
      'PROVENANCE_MISSING',
      'REGISTRY_INSPECT_FAILED',
      'DELIVERY_DOCUMENT_MISSING',
      'KNOWN_SINGLE_POINTS_NOT_RECORDED',
      'DISCONNECTED_PLATFORM_STATE_NOT_RECORDED',
    ]) {
      assert.equal(codes.has(code), false, `${code} shows the CLI ignored valid project-close metadata`)
    }

    await writeFile(manifestPath, `${JSON.stringify({
      schemaVersion: 1,
      ...releaseMetadata,
      productionValues: {
        ...releaseMetadata.productionValues,
        webDigest: `sha256:${'f'.repeat(64)}`,
      },
    }, null, 2)}\n`, 'utf8')
    const mismatchReport = await runProjectClose()
    assert(mismatchReport.issues.some((issue) => issue.code === 'PRODUCTION_VALUES_DIGEST_MISMATCH'))
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('project-close CLI rejects an unsupported manifest schema', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'lifeops-project-close-schema-'))
  const manifestPath = path.join(temporaryRoot, 'project-close-manifest.json')
  await writeFile(manifestPath, '{"schemaVersion":2}\n', 'utf8')

  try {
    await assert.rejects(execFileAsync(process.execPath, [
      path.resolve('scripts/verify-execution-contract.mjs'),
      '--mode',
      'project-close',
      '--project-close-manifest',
      manifestPath,
    ], {
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    }), (error) => {
      const report = JSON.parse(error.stdout)
      assert.equal(report.issues[0]?.code, 'PROJECT_CLOSE_MANIFEST_INVALID')
      assert.match(report.issues[0]?.message ?? '', /schema version 1/i)
      return true
    })
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('all four close-mode validators accept a complete internally consistent context', () => {
  assert.deepEqual(validateTaskClose(makeTaskCloseContext(), 'P1-T1'), [])
  assert.deepEqual(validatePhaseClose(makePhaseCloseContext(), 'P1'), [])
  assert.deepEqual(validateHandoff(makeHandoffContext()), [])
  assert.deepEqual(validateProjectClose(makeProjectCloseContext()), [])
})

test('public atoms follow the approved login-first golden-slice task order', async () => {
  const matrix = JSON.parse(await readFile(path.resolve('docs/traceability/acceptance-matrix.json'), 'utf8'))
  const publicDetailAtoms = matrix.atoms.filter((atom) => atom.parentRequirementId === 'PUB-02')
  const loginAtoms = matrix.atoms.filter((atom) => atom.parentRequirementId === 'AUTH-01')

  assert(publicDetailAtoms.length > 0)
  assert(loginAtoms.length > 0)
  assert(publicDetailAtoms.every((atom) => atom.plannedTasks.includes('P2-T4')))
  assert(publicDetailAtoms.every((atom) => !atom.plannedTasks.includes('P2-T3')))
  assert(loginAtoms.every((atom) => atom.plannedTasks.includes('P2-T3')))
  assert(loginAtoms.every((atom) => !atom.plannedTasks.includes('P2-T4')))
})

test('work-package closure claims only atom statuses reachable at the declared boundary', async () => {
  const matrix = JSON.parse(await readFile(path.resolve('docs/traceability/acceptance-matrix.json'), 'utf8'))
  const registry = JSON.parse(await readFile(path.resolve('docs/traceability/source-clauses.json'), 'utf8'))
  const closureClauses = registry.clauses.filter((clause) => (
    clause.sourceKey === 'P2'
    && clause.headingPath.includes('P2-T6: Public/auth plan closure and handoff')
    && /\b(?:Closes|Records)\b/.test(clause.textSummary)
    && /\b(?:PUB-01|PUB-02|AUTH-01)\b/.test(clause.textSummary)
  ))

  assert.equal(closureClauses.length, 1)
  const status = closureClauses[0].textSummary.match(/`(partial|verified-(?:local|image|registry))`/)?.[1]
  assert(status, 'P2-T6 closure clause must state its atom-derived status')

  for (const parentId of ['PUB-01', 'PUB-02', 'AUTH-01']) {
    const atoms = matrix.atoms.filter((atom) => atom.parentRequirementId === parentId)
    assert(atoms.length > 0)
    const reachableStatuses = new Set(['partial'])
    for (const atom of atoms) {
      reachableStatuses.add(`verified-${atom.finalBoundary.at(-1)}`)
    }
    assert(
      reachableStatuses.has(status),
      `${parentId} cannot derive ${status}; reachable statuses are ${[...reachableStatuses].join(', ')}`,
    )
  }
})

test('real workspace startup and handoff both match the current execution-control state', async () => {
  const cliPath = path.resolve('scripts/verify-execution-contract.mjs')
  const executionControlText = await readFile(
    path.resolve('docs/superpowers/plans/2026-08-09-execution-control.md'),
    'utf8',
  )
  const expectedExecution = parseExecutionState(executionControlText)
  for (const mode of ['startup', 'handoff']) {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, '--mode', mode], {
      cwd: process.cwd(),
      windowsHide: true,
    })
    assert.equal(stderr, '')
    const report = JSON.parse(stdout)
    assert.equal(report.ok, true)
    assert.equal(report.authorityRevision, expectedExecution.authorityRevision)
    assert.equal(report.status, expectedExecution.status)
    assert.equal(report.activePlan, expectedExecution.activePlan)
    assert.equal(report.activeTask, expectedExecution.activeTask)
    assert.equal(report.activeStep, expectedExecution.activeStep)
    assert.equal(report.requirementsVerified, expectedExecution.requirementsVerified)
    assert.deepEqual(report.rollups, { 'verified-local': 34, 'verified-image': 10 })
    assert.deepEqual(report.blockers, [])
    assert.equal(report.nextAction, expectedExecution.nextActions[0])
    assert.equal(report.firstCommand, expectedExecution.firstCommand)
  }
})
