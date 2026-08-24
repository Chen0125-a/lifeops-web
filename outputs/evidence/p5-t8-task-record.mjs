import { readFile, writeFile } from 'node:fs/promises'

const taskPath = new URL('../../docs/traceability/task-execution.json', import.meta.url)
const taskExecution = JSON.parse(await readFile(taskPath, 'utf8'))

const requiredAtomIds = [
  'SEC-01.LOGIN_OVERLAY.SEC.01',
  'SEC-01.LOGIN_OVERLAY.SEC.02',
  'SEC-01.RECORDS_ROUTE.SEC.01',
  'SEC-01.RECORDS_ROUTE.SEC.02',
  'SEC-01.SETTINGS_ROUTE.SEC.01',
  'SEC-01.SETTINGS_ROUTE.SEC.02',
  'SEC-01.TX_IMAGE_REGISTRY_HANDOFF.SEC.01',
  'SEC-01.TX_IMAGE_REGISTRY_HANDOFF.SEC.02',
]

const record = {
  id: 'P5-T8',
  phaseId: 'P5',
  stateHistory: [
    'pending', 'in_progress', 'red_verified', 'implementation_complete', 'focused_green',
    'regression_green', 'not_applicable', 'checkpointed', 'completed',
  ],
  declaredPaths: [
    'docs/traceability/requirements.md',
    'outputs/final/platform-global-verification.md',
  ],
  changedPaths: [
    'docs/superpowers/plans/2026-08-09-05-lifeops-platform-global-plan.md',
    'docs/traceability/requirements.md',
    'docs/traceability/task-execution.json',
    'outputs/final/platform-global-verification.md',
  ],
  extraPathReasons: {
    'docs/superpowers/plans/2026-08-09-05-lifeops-platform-global-plan.md': 'P5-T8 records its completed report, reverse audit, handoff and non-Git checkpoint steps without changing approved scope.',
    'docs/traceability/task-execution.json': 'The atomic ledger records the P5-T8 closure state, phase-close behavioral RED, cross-surface security audit and evidence ID.',
  },
  requiredAtomIds,
  requiredAtomBoundaries: Object.fromEntries(requiredAtomIds.map((id) => [id, 'partial'])),
  requiresMysql: false,
  uiChanged: false,
  handoffRecorded: true,
  redEvidence: [
    {
      classification: 'behavioral',
      command: 'npm.cmd run verify:execution -- --mode phase-close --phase P5',
      exitCode: 1,
      failure: 'The phase validator correctly rejected closure while P5-T8 was pending and exposed eight cross-surface SEC-01 atoms below the P5-required partial boundary; the reverse audit reopened those rows instead of hand-closing the phase.',
    },
  ],
  evidenceIds: ['EV-P5-T8-SECURITY-CROSS-SURFACE'],
}

taskExecution.tasks = taskExecution.tasks.filter((task) => task.id !== record.id)
taskExecution.tasks.push(record)
await writeFile(taskPath, `${JSON.stringify(taskExecution, null, 2)}\n`)
console.log(JSON.stringify({ taskId: record.id, requiredAtoms: requiredAtomIds.length, evidenceIds: record.evidenceIds.length }))
