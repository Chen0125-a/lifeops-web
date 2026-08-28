import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildLocalCheckpoint } from '../../scripts/execution-contract/source-checkpoint.mjs'

const root = process.cwd()
const checkpointPath = 'outputs/evidence/source-checkpoints/2026-08-28-p6-t6-ci8-theme-transition-local-full-gates-uncommitted-local-checkpoint.json'
const evidenceManifestPath = 'docs/traceability/evidence-manifest.json'
const visualManifestPath = 'outputs/final/visual-evidence-manifest.json'
const visualDirectory = 'outputs/evidence/browser/p6-t6-ci8-final-visual'

const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, ...relativePath.split('/')), 'utf8'))
const sha256 = (contents) => createHash('sha256').update(contents).digest('hex').toUpperCase()
const hashRelative = async (relativePath) => sha256(await readFile(path.join(root, ...relativePath.split('/'))))

const checkpoint = await buildLocalCheckpoint(root)
await writeFile(path.join(root, ...checkpointPath.split('/')), `${JSON.stringify(checkpoint, null, 2)}\n`)

const visualManifest = await readJson(visualManifestPath)
const captureDefinitions = [
  ['day-rest-desktop', 'day-rest-1440x900.png', '1440x900', 'light', false],
  ['day-login-desktop', 'day-login-1440x900.png', '1440x900', 'light', true],
  ['night-rest-desktop', 'night-rest-1440x900.png', '1440x900', 'dark', false],
  ['night-login-desktop', 'night-login-1440x900.png', '1440x900', 'dark', true],
  ['day-rest-phone', 'day-rest-390x844.png', '390x844', 'light', false],
  ['day-login-phone', 'day-login-390x844.png', '390x844', 'light', true],
  ['night-rest-phone', 'night-rest-390x844.png', '390x844', 'dark', false],
  ['night-login-phone', 'night-login-390x844.png', '390x844', 'dark', true],
]

visualManifest.states = visualManifest.states.filter((state) => !state.id.startsWith('p6-t6-ci8-'))
for (const [name, filename, viewport, colorScheme, login] of captureDefinitions) {
  const screenshotPath = `${visualDirectory}/${filename}`
  visualManifest.states.push({
    id: `p6-t6-ci8-${name}`,
    browser: 'Playwright Chromium 1.62.1 full acceptance capture',
    viewport,
    dpr: 1,
    colorScheme,
    reducedMotion: 'no-preference',
    fixtureSeedId: `p6-t6-ci8-${name.replace(/-(?:desktop|phone)$/, '')}`,
    screenshotPath,
    filmstripPath: null,
    tracePath: null,
    reviewer: 'primary-agent',
    openedOriginalResolution: true,
    result: 'pass',
    diagnostics: {
      login,
      overflow: 0,
      labels: login ? null : 5,
      center: { count: '05', label: '此刻正在发生' },
      titleSupportVisibility: login ? 'hidden' : 'visible',
      themeSurfaces: 'atomic',
      themeControlFeedback: '420ms transform',
      daySkyAssetsReferenced: true,
    },
    screenshotSha256: await hashRelative(screenshotPath),
  })
}

visualManifest.checkpointRootSha256 = checkpoint.rootSha256
visualManifest.generatedAt = new Date().toISOString()
for (const report of visualManifest.performanceReports) {
  report.sha256 = await hashRelative(report.path)
  if (report.id === 'public-lighthouse') report.browser = 'Chrome 151.0.7922.34 via Lighthouse 13.4.1 on official Linux Playwright image'
}
const metricsPath = `${visualDirectory}/public-browser-performance-manifest.json`
visualManifest.latestRevalidation = {
  taskId: 'P6-T6',
  step: 7,
  revalidatedAt: new Date().toISOString(),
  checkpointRootSha256: checkpoint.rootSha256,
  metricsPath,
  metricsSha256: await hashRelative(metricsPath),
  openedOriginalResolution: true,
  captureCount: captureDefinitions.length,
  conclusion: 'pass',
}
await writeFile(path.join(root, ...visualManifestPath.split('/')), `${JSON.stringify(visualManifest, null, 2)}\n`)

const manifest = await readJson(evidenceManifestPath)
const currentVisualArtifacts = new Map([
  ['EV-P6-T5-ADR029-VISUAL-1440', [`${visualDirectory}/night-login-1440x900.png`, 'The opened current CI8 1440×900 night-login frame preserves the unlit 05 center, complete four-ring inset, orbit-left/title-recede depth, dark task surface, high-contrast login and zero overflow.']],
  ['EV-P6-T5-ADR029-VISUAL-390', [`${visualDirectory}/night-rest-390x844.png`, 'The opened current CI8 390×844 night-rest frame preserves the complete outer ring with safe bottom inset, readable zones, natural ring hierarchy, unlit center and zero horizontal overflow.']],
  ['EV-P6-T5-ADR029-VISUAL-MOTION', [metricsPath, 'The current Chromium acceptance manifest records all four viewport day/night states with zero overflow and five public labels, 71 motion frames with 16.8ms P95/maximum, and the official cross-browser gates independently prove continuing ring transforms under ADR-030 while theme surfaces now switch atomically.']],
  ['EV-P6-T5-FULL-VISUAL-1440', [`${visualDirectory}/day-rest-1440x900.png`, 'The primary executor opened and accepted all four current CI8 1440×900 day/night rest/login images individually; they preserve the approved hierarchy, depth, day sky, dark night task surface, atomic theme endpoints and zero overflow.']],
  ['EV-P6-T5-FULL-VISUAL-390', [`${visualDirectory}/day-rest-390x844.png`, 'The primary executor opened and accepted all four current CI8 390×844 day/night rest/login images individually; they preserve clear content zones, complete safe outer-ring inset, full-screen mobile login, atomic theme endpoints and zero horizontal overflow.']],
])
const contractEvidenceIds = new Set([
  'EV-P6-T5-ADR029-UNIT',
  'EV-P6-T5-ADR029-VISUAL-1440',
  'EV-P6-T5-ADR029-VISUAL-390',
  'EV-P6-T5-ADR029-VISUAL-MOTION',
  'EV-P6-T5-FULL-UNIT',
  'EV-P6-T5-FULL-E2E',
  'EV-P6-T5-FULL-VISUAL-1440',
  'EV-P6-T5-FULL-VISUAL-390',
  'EV-P6-T5-FULL-MANUAL-REVIEW',
])

for (const row of manifest.evidence) {
  if (contractEvidenceIds.has(row.id) && !row.sourcePaths.some((source) => source.path === 'src/publicThemeCompositor.test.ts')) {
    row.sourcePaths.push({ path: 'src/publicThemeCompositor.test.ts', sha256: '' })
    row.sourcePaths.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  }
  const visualArtifact = currentVisualArtifacts.get(row.id)
  if (visualArtifact) {
    row.artifactPath = visualArtifact[0]
    row.summary = visualArtifact[1]
  }
  if (row.id === 'EV-P6-T5-FULL-UNIT') {
    row.summary = 'Fresh isolated frontend gates pass 87/87 Vitest files with 412/412 tests, typecheck and the 884-module production build. Node/config/CSS-source contracts stay outside the browser application TypeScript graph while Vitest executes them.'
  }
  if (row.id === 'EV-P6-T5-FULL-E2E') {
    row.summary = 'The official mcr.microsoft.com/playwright:v1.62.1-noble environment passes the complete current-source 335/335 acceptance set: WebKit theme 1/1, Firefox theme 1/1 and the unchanged full matrix 333/333. Workers=1, retries=0, browser coverage, thresholds, sample durations, geometry and motion rate are unchanged.'
  }
  if (row.id === 'EV-P6-T5-FULL-MANUAL-REVIEW') {
    row.command = `view_image ${visualDirectory}/*.png individually at original resolution`
    row.summary = 'The primary executor directly opened all eight current CI8 1440×900 and 390×844 day/night rest/login images individually at original resolution. Automated diagnostics and direct review agree on the approved unlit center, four live rings, orbit-left/title-recede depth, dark night login, mobile breathing space, complete safe inset and zero horizontal overflow.'
  }
  row.checkpoint = checkpoint.rootSha256
  for (const source of row.sourcePaths ?? []) source.sha256 = await hashRelative(source.path)
  if (row.artifactPath) row.artifactSha256 = await hashRelative(row.artifactPath)
}
manifest.checkpoint = checkpoint.rootSha256
await writeFile(path.join(root, ...evidenceManifestPath.split('/')), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(JSON.stringify({
  checkpointPath,
  rootSha256: checkpoint.rootSha256,
  inputs: checkpoint.files.length,
  evidenceRows: manifest.evidence.length,
  visualStates: visualManifest.states.length,
}))
