import { readFile, writeFile } from 'node:fs/promises'

const taskPath = new URL('../../docs/traceability/task-execution.json', import.meta.url)
const matrixPath = new URL('../../docs/traceability/acceptance-matrix.json', import.meta.url)
const [taskExecution, matrix] = await Promise.all([
  readFile(taskPath, 'utf8').then(JSON.parse),
  readFile(matrixPath, 'utf8').then(JSON.parse),
])

const requiredAtomIds = matrix.atoms
  .filter((atom) => atom.plannedTasks?.includes('P5-T7'))
  .map((atom) => atom.id)

const record = {
  id: 'P5-T7',
  phaseId: 'P5',
  stateHistory: [
    'pending', 'in_progress', 'red_verified', 'implementation_complete', 'focused_green',
    'regression_green', 'visually_verified', 'checkpointed', 'completed',
  ],
  declaredPaths: [
    'tests/platform-center.spec.ts',
    'tests/global-tools-settings.spec.ts',
    'tests/platform-security.spec.ts',
    'tests/responsive-accessibility.spec.ts',
    'tests/visual-capture.spec.ts',
    'src/styles/platform.css',
    'src/styles/settings.css',
    'src/styles/private-shell.css',
  ],
  changedPaths: [
    'src/features/platform/PlatformPage.tsx',
    'src/features/platform/usePlatform.ts',
    'src/styles/platform.css',
    'tests/global-tools-settings.spec.ts',
    'tests/platform-center.spec.ts',
    'tests/platform-security.spec.ts',
    'tests/responsive-accessibility.spec.ts',
    'tests/visual-capture.spec.ts',
  ],
  extraPathReasons: {
    'src/features/platform/usePlatform.ts': 'The planned deep-link E2E RED proved URL tab, metric and sanitized log-filter state were not restored or synchronized; the hook is the smallest behavior owner.',
    'src/features/platform/PlatformPage.tsx': 'Opened 390px evidence proved deep-linked late tabs were outside the visible rail; the page now scrolls only its tab rail and preserves route-stage position.',
  },
  requiredAtomIds,
  requiredAtomBoundaries: Object.fromEntries(requiredAtomIds.map((id) => [id, 'verified-local'])),
  requiresMysql: true,
  uiChanged: true,
  handoffRecorded: true,
  redEvidence: [
    {
      classification: 'behavioral',
      command: 'npm.cmd run test:e2e -- tests/platform-center.spec.ts',
      exitCode: 1,
      failure: 'A valid platform deep link loaded /app/platform?tab=logs but left Overview selected instead of restoring the requested tab and filters.',
    },
    {
      classification: 'behavioral',
      command: 'npm.cmd run test:e2e -- tests/responsive-accessibility.spec.ts --grep "platform and global settings"',
      exitCode: 1,
      failure: 'At 390px the delivery region followed technical topology instead of the approved overall status, alerts, delivery, technical-module order.',
    },
    {
      classification: 'behavioral',
      command: 'npm.cmd run test:e2e -- tests/platform-center.spec.ts --grep "mobile deep links"',
      exitCode: 1,
      failure: 'The selected Technology tab ended at x=511.203125 outside the 390px tab rail.',
    },
    {
      classification: 'behavioral',
      command: 'npm.cmd run test:e2e -- tests/platform-center.spec.ts --grep "mobile deep links"',
      exitCode: 1,
      failure: 'The first visibility fix moved the route-stage scrollLeft to 16, clipping page content; the final implementation scrolls only the tab rail.',
    },
  ],
  evidenceIds: [
    'EV-P5-T7-UNIT',
    'EV-P5-T7-API',
    'EV-P5-T7-MYSQL',
    'EV-P5-T7-E2E',
    'EV-P5-T7-A11Y',
    'EV-P5-T7-SECURITY',
    'EV-P5-T7-MANUAL-REVIEW',
    'EV-P5-T7-VISUAL-1440',
    'EV-P5-T7-VISUAL-1024',
    'EV-P5-T7-VISUAL-768',
    'EV-P5-T7-VISUAL-390',
    'EV-P5-T7-VISUAL-320',
    'EV-P5-T7-VISUAL-ZOOM-200',
    'EV-P5-T7-VISUAL-REDUCED-MOTION',
  ],
}

taskExecution.tasks = taskExecution.tasks.filter((task) => task.id !== record.id)
taskExecution.tasks.push(record)
await writeFile(taskPath, `${JSON.stringify(taskExecution, null, 2)}\n`)
console.log(JSON.stringify({ taskId: record.id, requiredAtoms: requiredAtomIds.length, evidenceIds: record.evidenceIds.length }))
