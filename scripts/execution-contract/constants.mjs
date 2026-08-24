export const AUTHORITY_FILES = Object.freeze([
  'docs/superpowers/specs/2026-08-09-lifeops-web-final-redesign-design.md',
  'docs/superpowers/specs/2026-08-10-lifeops-life-domain-design.md',
  'docs/superpowers/specs/2026-08-10-lifeops-execution-completeness-design.md',
  'docs/superpowers/specs/2026-08-10-lifeops-web-image-delivery-boundary-design.md',
  'docs/superpowers/plans/2026-08-09-00-lifeops-final-master-plan.md',
])

export const WORK_PACKAGE_FILES = Object.freeze([
  'docs/superpowers/plans/2026-08-09-01-lifeops-foundation-data-plan.md',
  'docs/superpowers/plans/2026-08-09-02-lifeops-public-auth-plan.md',
  'docs/superpowers/plans/2026-08-09-03-lifeops-private-core-plan.md',
  'docs/superpowers/plans/2026-08-09-04-lifeops-knowledge-publishing-obsidian-plan.md',
  'docs/superpowers/plans/2026-08-09-05-lifeops-platform-global-plan.md',
  'docs/superpowers/plans/2026-08-09-06-lifeops-production-delivery-plan.md',
])

const ORIGINAL_PARENT_REQUIREMENT_IDS = [
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

export const PARENT_REQUIREMENT_IDS = Object.freeze([
  ...ORIGINAL_PARENT_REQUIREMENT_IDS,
  ...Array.from(
    { length: 24 },
    (_, index) => `LIFE-${String(index + 1).padStart(2, '0')}`,
  ),
])

export const SOURCE_FILE_ENTRIES = Object.freeze([
  ['FINAL_REDESIGN', AUTHORITY_FILES[0]],
  ['LIFE_DOMAIN', AUTHORITY_FILES[1]],
  ['EXECUTION_COMPLETENESS', AUTHORITY_FILES[2]],
  ['IMAGE_DELIVERY_BOUNDARY', AUTHORITY_FILES[3]],
  ['MASTER_PLAN', AUTHORITY_FILES[4]],
  ['P1', WORK_PACKAGE_FILES[0]],
  ['P2', WORK_PACKAGE_FILES[1]],
  ['P3', WORK_PACKAGE_FILES[2]],
  ['P4', WORK_PACKAGE_FILES[3]],
  ['P5', WORK_PACKAGE_FILES[4]],
  ['P6', WORK_PACKAGE_FILES[5]],
].map((entry) => Object.freeze(entry)))

const sourceKeys = SOURCE_FILE_ENTRIES.map(([key]) => key)
const sourcePaths = SOURCE_FILE_ENTRIES.map(([, filePath]) => filePath)
const fixedPaths = [...AUTHORITY_FILES, ...WORK_PACKAGE_FILES]

if (new Set(sourceKeys).size !== SOURCE_FILE_ENTRIES.length) {
  throw new Error('Duplicate execution-contract source key')
}

if (
  new Set(sourcePaths).size !== SOURCE_FILE_ENTRIES.length
  || sourcePaths.some((filePath) => !fixedPaths.includes(filePath))
) {
  throw new Error('Execution-contract source path is duplicated or outside the fixed source set')
}

export const SOURCE_PATH_BY_KEY = Object.freeze(Object.fromEntries(SOURCE_FILE_ENTRIES))
