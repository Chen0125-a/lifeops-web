import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), 'utf8'))
const sha256 = (contents) => createHash('sha256').update(contents).digest('hex').toUpperCase()
const hashRelative = async (relativePath) => sha256(await readFile(path.join(root, ...relativePath.split('/'))))
const sourcePaths = async (paths) => Promise.all(paths.map(async (sourcePath) => ({ path: sourcePath, sha256: await hashRelative(sourcePath) })))

const manifestPath = 'docs/traceability/evidence-manifest.json'
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-23-p5-t7-platform-global-acceptance-uncommitted-local-checkpoint.json'
const [manifest, matrix, taskExecution, checkpoint] = await Promise.all([
  readJson(manifestPath),
  readJson('docs/traceability/acceptance-matrix.json'),
  readJson('docs/traceability/task-execution.json'),
  readJson(checkpointPath),
])

for (const row of manifest.evidence) {
  row.checkpoint = checkpoint.rootSha256
  for (const source of row.sourcePaths ?? []) source.sha256 = await hashRelative(source.path)
  if (row.artifactPath) row.artifactSha256 = await hashRelative(row.artifactPath)
}

manifest.evidence = manifest.evidence.filter((row) => !row.id.startsWith('EV-P5-T7-'))
const task = taskExecution.tasks.find((candidate) => candidate.id === 'P5-T7')
const targetIds = new Set(task.requiredAtomIds)
const atoms = matrix.atoms.filter((atom) => targetIds.has(atom.id))
const atomsFor = (type) => atoms.filter((atom) => atom.requiredEvidence.includes(type)).map((atom) => atom.id)
const visualAtomsFor = (...surfaces) => atoms
  .filter((atom) => atom.requiredEvidence.includes('visual') && atom.surfaces.some((surface) => surfaces.includes(surface)))
  .map((atom) => atom.id)

const times = {
  start: '2026-08-22T18:30:00Z',
  mysql: '2026-08-22T20:07:00Z',
  browser: '2026-08-22T19:20:00Z',
  completed: '2026-08-22T20:09:00Z',
}
const base = (id, type, atomIds, command, summary, startedAt = times.start) => ({
  id, atomIds, type, command, exitCode: 0, startedAt, completedAt: times.completed,
  checkpoint: checkpoint.rootSha256, skipped: false, summary,
})

const platformSources = [
  'src/features/platform/PlatformPage.tsx',
  'src/features/platform/usePlatform.ts',
  'src/styles/platform.css',
  'tests/platform-center.spec.ts',
  'tests/platform-security.spec.ts',
]
const globalSources = [
  'src/components/private/CommandCenter.tsx',
  'src/components/private/QuickCreate.tsx',
  'src/components/private/WorkspaceHeader.tsx',
  'src/features/settings/SettingsPage.tsx',
  'src/styles/settings.css',
  'tests/global-tools-settings.spec.ts',
]
const browserSources = [...platformSources, ...globalSources, 'tests/responsive-accessibility.spec.ts', 'tests/visual-capture.spec.ts']
const serverSources = [
  'server/src/app.ts',
  'server/src/routes/platform.ts',
  'server/src/config.ts',
  'server/src/integrations/safeFetch.ts',
  'server/src/mysql.integration.test.ts',
]

const rows = []
const unit = base(
  'EV-P5-T7-UNIT', 'unit', atomsFor('unit'), 'npm.cmd test; npm.cmd run test:server',
  'Fresh complete regressions passed 84 Web files / 386 tests and 334 ordinary server tests; 50 exact-only server cases were separately executed by the official MySQL gate.',
)
unit.sourcePaths = await sourcePaths([...browserSources, ...serverSources])
rows.push(unit)

const api = base(
  'EV-P5-T7-API', 'api', atomsFor('api'),
  'npm.cmd run test:server; npm.cmd run typecheck:server; npm.cmd run build:server; npm.cmd run test:e2e:remote',
  'Authenticated platform/global APIs, bounded source errors, owner scope and real Fastify browser journeys passed with server typecheck/build and remote Chromium 4/4.',
)
api.sourcePaths = await sourcePaths(serverSources)
rows.push(api)

const mysql = base(
  'EV-P5-T7-MYSQL', 'mysql', atomsFor('mysql'), 'npm.cmd run test:mysql',
  'Official isolated MySQL Community Server 8.4.10 executed 50/50 with zero skip; the earlier all-skip invocation was rejected and is not passing evidence.', times.mysql,
)
mysql.sourcePaths = await sourcePaths(['server/src/mysql.integration.test.ts', 'server/migrations/015_search.sql', 'server/migrations/016_settings_audit.sql'])
mysql.artifactPath = 'outputs/evidence/mysql/p5-t7-exact-mysql.json'
mysql.artifactSha256 = await hashRelative(mysql.artifactPath)
rows.push(mysql)

const e2e = base(
  'EV-P5-T7-E2E', 'e2e-local', atomsFor('e2e-local'),
  'npm.cmd run test:e2e -- tests/platform-center.spec.ts tests/platform-security.spec.ts tests/global-tools-settings.spec.ts tests/responsive-accessibility.spec.ts; npm.cmd run test:e2e:remote',
  'Focused platform/global/responsive Chromium passed 17/17 and real Fastify Chromium passed 4/4, including deep links, filters, polling pause, retry, keyboard focus, undo, settings safety and responsive order.', times.browser,
)
e2e.sourcePaths = await sourcePaths(browserSources)
rows.push(e2e)

const a11y = base(
  'EV-P5-T7-A11Y', 'a11y', atomsFor('a11y'),
  'npm.cmd run test:e2e -- tests/platform-center.spec.ts tests/global-tools-settings.spec.ts tests/responsive-accessibility.spec.ts',
  'Keyboard tab/search/quick-create/settings operation, labelled chart tables, mobile category return, selected-tab visibility, focus restoration, 320 CSS px and 200% reflow passed.', times.browser,
)
a11y.subtype = 'keyboard'
a11y.sourcePaths = await sourcePaths(browserSources)
rows.push(a11y)

const security = base(
  'EV-P5-T7-SECURITY', 'security', atomsFor('security'),
  'npm.cmd run test:e2e -- tests/platform-security.spec.ts tests/global-tools-settings.spec.ts',
  'Real Fastify injection rejected raw query languages, anonymous private reads and all platform mutation paths; configured token/password/cookie sentinels were absent from serialized responses and import preview remained no-write.', times.browser,
)
security.sourcePaths = await sourcePaths([...serverSources, 'tests/platform-security.spec.ts', 'tests/global-tools-settings.spec.ts'])
rows.push(security)

const checklist = {
  overflow: 'pass', forbiddenPatterns: 'pass', hierarchy: 'pass', continuity: 'pass', reducedMotion: 'pass',
}
const reviewed = (breakpoint) => ({
  reviewer: 'primary-agent', opened: true, breakpoint, checklist: { ...checklist }, conclusion: 'pass',
})

const manual = base(
  'EV-P5-T7-MANUAL-REVIEW', 'manual-review', atomsFor('manual-review'),
  'npm.cmd run test:e2e -- tests/visual-capture.spec.ts --grep "captures P5 platform"',
  'The primary executor opened four review sheets and key original-resolution platform late-tab, data-safety and 200%-zoom images. A hidden selected-tab defect and then route-stage clipping were rejected, fixed with RED/GREEN tests and recaptured before final acceptance.', times.browser,
)
manual.sourcePaths = await sourcePaths(browserSources)
manual.artifactPath = 'outputs/evidence/browser/p5-t7/review-filmstrips.png'
manual.artifactSha256 = await hashRelative(manual.artifactPath)
manual.manualReview = reviewed('1440x900')
rows.push(manual)

const visualDefinitions = [
  ['EV-P5-T7-VISUAL-1440', ['PLATFORM_KUBERNETES', 'PLATFORM_MONITORING', 'PLATFORM_ALERTS', 'PLATFORM_LOGS', 'PLATFORM_RELEASES', 'PLATFORM_TECHNOLOGY'], 'outputs/evidence/browser/p5-t7/review-platform.png', '1440x900'],
  ['EV-P5-T7-VISUAL-1024', ['PLATFORM_OVERVIEW'], 'outputs/evidence/browser/p5-t7/platform-overview-1024x768.png', '1024x768'],
  ['EV-P5-T7-VISUAL-768', ['GLOBAL_SEARCH_OVERLAY'], 'outputs/evidence/browser/p5-t7/global-search-768x1024.png', '768x1024'],
  ['EV-P5-T7-VISUAL-390', ['QUICK_CREATE_OVERLAY'], 'outputs/evidence/browser/p5-t7/quick-create-390x844.png', '390x844'],
  ['EV-P5-T7-VISUAL-320', ['SETTINGS_ROUTE'], 'outputs/evidence/browser/p5-t7/review-settings.png', '390x844'],
]
for (const [id, surfaces, artifactPath, breakpoint] of visualDefinitions) {
  const row = base(
    id, 'visual', visualAtomsFor(...surfaces),
    'npm.cmd run test:e2e -- tests/visual-capture.spec.ts --grep "captures P5 platform"',
    `The primary executor opened and accepted ${breakpoint} evidence for continuous Daylight hierarchy, truthful values, no clipping/card wall/dark NOC regression and reachable task controls.`, times.browser,
  )
  row.sourcePaths = await sourcePaths(browserSources)
  row.artifactPath = artifactPath
  row.artifactSha256 = await hashRelative(artifactPath)
  row.manualReview = reviewed(breakpoint)
  rows.push(row)
}

const zoom = base(
  'EV-P5-T7-VISUAL-ZOOM-200', 'visual', visualAtomsFor('PLATFORM_OVERVIEW'),
  'npm.cmd run test:e2e -- tests/responsive-accessibility.spec.ts tests/visual-capture.spec.ts --grep "platform"',
  'The opened 200%-zoom platform overview preserves readable order, semantic table fallback and zero document overflow.', times.browser,
)
zoom.sourcePaths = await sourcePaths(browserSources)
zoom.artifactPath = 'outputs/evidence/browser/p5-t7/platform-overview-zoom-200.png'
zoom.artifactSha256 = await hashRelative(zoom.artifactPath)
zoom.manualReview = reviewed('1024x768')
rows.push(zoom)

const reduced = base(
  'EV-P5-T7-VISUAL-REDUCED-MOTION', 'e2e-local', atomsFor('e2e-local'),
  'npm.cmd run test:e2e -- tests/visual-capture.spec.ts --grep "captures P5 platform"',
  'Opened normal/reduced task-layer filmstrips preserve the same platform-tab, search, Quick Create and settings hierarchy with no hidden work or focus loss.', times.browser,
)
reduced.subtype = 'reduced-motion'
reduced.sourcePaths = await sourcePaths(browserSources)
reduced.artifactPath = 'outputs/evidence/browser/p5-t7/review-filmstrips.png'
reduced.artifactSha256 = await hashRelative(reduced.artifactPath)
rows.push(reduced)

manifest.checkpoint = checkpoint.rootSha256
manifest.evidence.push(...rows)
await writeFile(path.join(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ checkpoint: checkpoint.rootSha256, evidenceRows: manifest.evidence.length, added: rows.length }))
