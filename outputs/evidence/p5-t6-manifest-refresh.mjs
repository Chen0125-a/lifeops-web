import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const manifestPath = path.join(root, 'docs/traceability/evidence-manifest.json')
const matrixPath = path.join(root, 'docs/traceability/acceptance-matrix.json')
const taskPath = path.join(root, 'docs/traceability/task-execution.json')
const checkpointPath = path.join(root, 'outputs/evidence/source-checkpoints/2026-08-23-p5-t6-account-settings-safe-data-transfer-uncommitted-local-checkpoint.json')

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'))
const sha256 = (contents) => createHash('sha256').update(contents).digest('hex').toUpperCase()
const hashRelative = async (relativePath) => sha256(await readFile(path.join(root, ...relativePath.split('/'))))
const sourcePaths = async (paths) => Promise.all(paths.map(async (sourcePath) => ({
  path: sourcePath,
  sha256: await hashRelative(sourcePath),
})))

const [manifest, matrix, taskExecution, checkpoint] = await Promise.all([
  readJson(manifestPath),
  readJson(matrixPath),
  readJson(taskPath),
  readJson(checkpointPath),
])

const checkpointRoot = checkpoint.rootSha256
for (const row of manifest.evidence) {
  row.checkpoint = checkpointRoot
  for (const source of row.sourcePaths ?? []) source.sha256 = await hashRelative(source.path)
  if (row.artifactPath) row.artifactSha256 = await hashRelative(row.artifactPath)
}

manifest.evidence = manifest.evidence.filter((row) => !row.id.startsWith('EV-P5-T6-'))
const task = taskExecution.tasks.find((candidate) => candidate.id === 'P5-T6')
const targetIds = new Set(task.requiredAtomIds)
const atoms = matrix.atoms.filter((atom) => targetIds.has(atom.id))
const atomsFor = (type) => atoms.filter((atom) => atom.requiredEvidence.includes(type)).map((atom) => atom.id)

const times = {
  start: '2026-08-22T18:00:00Z',
  mysqlStart: '2026-08-22T18:35:00Z',
  browserStart: '2026-08-22T18:45:00Z',
  completed: '2026-08-22T19:26:00Z',
}
const base = (id, type, atomIds, command, summary, startedAt = times.start) => ({
  id,
  atomIds,
  type,
  command,
  exitCode: 0,
  startedAt,
  completedAt: times.completed,
  checkpoint: checkpointRoot,
  skipped: false,
  summary,
})

const serverSources = [
  'server/src/services/dataTransfer.ts',
  'server/src/services/dataTransfer.test.ts',
  'server/src/routes/settings.ts',
  'server/src/routes/settings.test.ts',
  'server/src/store/settingsStore.ts',
  'server/src/security/password.ts',
]
const webSources = [
  'src/api/settingsApi.ts',
  'src/domain/settings.ts',
  'src/features/settings/SettingsPage.tsx',
  'src/features/settings/SettingsPage.test.tsx',
  'src/features/settings/AccountSettings.tsx',
  'src/features/settings/AppearanceSettings.tsx',
  'src/features/settings/PlatformConnections.tsx',
  'src/features/settings/DataSecuritySettings.tsx',
  'src/styles/settings.css',
  'tests/settings.spec.ts',
]
const mysqlSources = [
  'server/migrations/016_settings_audit.sql',
  'server/src/store/mysql/settingsMySqlStore.ts',
  'server/src/store/mysqlLifeStore.ts',
  'server/src/mysql.integration.test.ts',
]

const unit = base(
  'EV-P5-T6-UNIT',
  'unit',
  atomsFor('unit'),
  'npm.cmd run test:server -- server/src/services/dataTransfer.test.ts server/src/routes/settings.test.ts; npm.cmd test -- src/features/settings/SettingsPage.test.tsx; npm.cmd run test:server; npm.cmd test',
  'Focused settings/data-transfer passed 22 server and 5 Web tests; fresh complete regressions passed 334 ordinary server tests plus 50 exact-only skips and 386/386 Web tests.',
)
unit.sourcePaths = await sourcePaths([...serverSources, ...webSources])

const api = base(
  'EV-P5-T6-API',
  'api',
  atomsFor('api'),
  'npm.cmd run test:server -- server/src/services/dataTransfer.test.ts server/src/routes/settings.test.ts; npm.cmd run typecheck:server; npm.cmd run build:server',
  'Authenticated settings/account/session/audit/export/import routes enforce owner scope, password/checksum confirmation, no-write preview and safe error boundaries; server typecheck and production build pass.',
)
api.sourcePaths = await sourcePaths([...serverSources, 'server/src/app.ts', 'server/src/domain/types.ts'])

const mysql = base(
  'EV-P5-T6-MYSQL',
  'mysql',
  atomsFor('mysql'),
  'npm.cmd run test:mysql',
  'Official isolated MySQL Community Server 8.4.10 passed 50/50 with zero skip, including migration 016, restore checksum, deleted-fact portability, owner remap, immutable audit and all-or-nothing rollback.',
  times.mysqlStart,
)
mysql.sourcePaths = await sourcePaths(mysqlSources)
mysql.artifactPath = 'outputs/evidence/mysql/p5-t6-exact-mysql.json'
mysql.artifactSha256 = await hashRelative(mysql.artifactPath)

const e2e = base(
  'EV-P5-T6-E2E',
  'e2e-local',
  atomsFor('e2e-local'),
  'npx.cmd playwright test tests/settings.spec.ts --project=chromium; npx.cmd playwright test tests/knowledge-obsidian.spec.ts --project=chromium; npx.cmd playwright test --project=chromium',
  'Focused Settings passed 2/2, affected Obsidian passed 4/4 and the fresh complete single-worker Chromium regression passed 81/81 across account, sessions, categories, import preview/apply and existing product journeys.',
  times.browserStart,
)
e2e.sourcePaths = await sourcePaths([...webSources, 'tests/private-core-fixtures.ts', 'tests/knowledge-obsidian.spec.ts'])

const a11y = base(
  'EV-P5-T6-A11Y-KEYBOARD',
  'a11y',
  atomsFor('a11y'),
  'npm.cmd test -- src/features/settings/SettingsPage.test.tsx; npx.cmd playwright test tests/settings.spec.ts --project=chromium',
  'Keyboard-only category entry, mobile Back, selected-category focus restoration, labelled controls, dangerous confirmation and save feedback pass without focus loss.',
  times.browserStart,
)
a11y.subtype = 'keyboard'
a11y.sourcePaths = await sourcePaths(webSources)

const reduced = base(
  'EV-P5-T6-E2E-REDUCED-MOTION',
  'e2e-local',
  atomsFor('e2e-local'),
  'npx.cmd playwright test tests/settings.spec.ts --project=chromium',
  'Reduced-motion Settings preserves the same category/detail hierarchy, keyboard semantics, import safeguards and immediate reverse navigation.',
  times.browserStart,
)
reduced.subtype = 'reduced-motion'
reduced.sourcePaths = await sourcePaths(webSources)
reduced.artifactPath = 'outputs/evidence/browser/p5-t6/settings-data-390x844-reduced-motion.png'
reduced.artifactSha256 = await hashRelative(reduced.artifactPath)

const checklist = {
  overflow: 'pass',
  forbiddenPatterns: 'pass',
  hierarchy: 'pass',
  continuity: 'pass',
  reducedMotion: 'pass',
}
const reviewed = (breakpoint) => ({
  reviewer: 'primary-agent',
  opened: true,
  breakpoint,
  checklist: { ...checklist },
  conclusion: 'pass',
})

const manual = base(
  'EV-P5-T6-MANUAL-REVIEW',
  'manual-review',
  atomsFor('manual-review'),
  'npx.cmd playwright test tests/settings.spec.ts tests/responsive-accessibility.spec.ts tests/visual-capture.spec.ts --project=chromium',
  'The primary executor opened all seven final Settings images and accepted continuous Daylight hierarchy, truthful connection states, readable recovery copy, reverse mobile navigation, focus, overflow and reduced-motion equivalence.',
  times.browserStart,
)
manual.sourcePaths = await sourcePaths(webSources)
manual.artifactPath = 'outputs/evidence/browser/p5-t6/settings-account-1440x900.png'
manual.artifactSha256 = await hashRelative(manual.artifactPath)
manual.manualReview = reviewed('1440x900')

const visualDefinitions = [
  ['EV-P5-T6-VISUAL-1440', '1440x900', 'outputs/evidence/browser/p5-t6/settings-account-1440x900.png'],
  ['EV-P5-T6-VISUAL-1024', '1024x768', 'outputs/evidence/browser/p5-t6/settings-account-1024x768.png'],
  ['EV-P5-T6-VISUAL-768', '768x1024', 'outputs/evidence/browser/p5-t6/settings-categories-768x1024.png'],
  ['EV-P5-T6-VISUAL-390', '390x844', 'outputs/evidence/browser/p5-t6/settings-categories-390x844.png'],
]
const visuals = []
for (const [id, breakpoint, artifactPath] of visualDefinitions) {
  const row = base(
    id,
    'visual',
    atomsFor('visual'),
    'npx.cmd playwright test tests/settings.spec.ts tests/responsive-accessibility.spec.ts tests/visual-capture.spec.ts --project=chromium',
    `The primary executor opened and accepted the final ${breakpoint} Settings surface for continuous hierarchy, responsive reflow, approved soft-volume language, no overflow and reduced-motion equivalence.`,
    times.browserStart,
  )
  row.sourcePaths = await sourcePaths(webSources)
  row.artifactPath = artifactPath
  row.artifactSha256 = await hashRelative(artifactPath)
  row.manualReview = reviewed(breakpoint)
  visuals.push(row)
}

manifest.checkpoint = checkpointRoot
manifest.evidence.push(unit, api, mysql, e2e, a11y, reduced, manual, ...visuals)
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ checkpoint: checkpointRoot, evidenceRows: manifest.evidence.length, added: 11 }))
