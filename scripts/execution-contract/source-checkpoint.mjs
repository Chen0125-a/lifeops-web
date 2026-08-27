import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { normalizeRelativePath } from './load-json.mjs'

const INCLUDE_RULES = Object.freeze([
  'root and server package manifests, Web entrypoint and TypeScript/Vite/Vitest/Playwright configs',
  'src, public, server/src, server/migrations, tests, tests-remote and scripts trees',
  'Docker runtime files, deploy assets and GitHub Actions workflows',
  'docs/traceability/requirements.md and static docs/traceability contract JSON',
])

const EXCLUDE_RULES = Object.freeze([
  'VCS, editor, dependency, build, coverage and runtime-cache directories',
  'generated work, evidence, final output, Playwright report and test-result trees',
  'credentials, environment files, cookies, tokens, kubeconfig and private or generated test-database key material',
  'dynamic docs/traceability/evidence-manifest.json metadata to prevent checkpoint self-reference',
  'all paths outside the explicit include rules',
])

const EXCLUDED_DIRECTORY_SEGMENTS = new Set([
  '.git',
  '.idea',
  '.vscode',
  '.cache',
  '.next',
  '.nuxt',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
  'work',
])

const SENSITIVE_PATH = /(?:^|[-_.\/])(?:credential(?:s)?|cookie(?:s)?|kubeconfig|private[-_]?key|service[-_]?token|session[-_]?cookie|token(?:s)?|id[-_]?(?:rsa|ed25519))(?:[-_.\/]|$)/i
const TEST_DATABASE_SECRET = /(?:^|\/)(?:tests?|test-data)(?:\/|$).*?(?:credential|password|private[-_]?key|generated[-_]?key|certificate|\.pem(?:$|\/))/i
const DOT_ENV_FILE = /(?:^|\/)\.env(?:\.|$)/i
const CONFIG_FILE = /^(?:tsconfig(?:\.[A-Za-z0-9_-]+)?\.json|(?:vite|vitest|playwright)(?:\.[A-Za-z0-9_-]+)?\.config\.(?:c?js|mjs|ts))$/

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isExcludedDirectory(relativePath) {
  const segments = relativePath.toLowerCase().split('/')
  if (segments.some((segment) => EXCLUDED_DIRECTORY_SEGMENTS.has(segment))) {
    return true
  }

  return relativePath === 'outputs/evidence'
    || relativePath.startsWith('outputs/evidence/')
    || relativePath === 'outputs/final'
    || relativePath.startsWith('outputs/final/')
}

function isSensitive(relativePath) {
  return SENSITIVE_PATH.test(relativePath)
    || TEST_DATABASE_SECRET.test(relativePath)
    || DOT_ENV_FILE.test(relativePath)
}

function isIncluded(relativePath) {
  const fileName = path.posix.basename(relativePath)
  const directory = path.posix.dirname(relativePath)

  if (
    (directory === '.' || directory === 'server')
    && (fileName === 'package.json' || fileName === 'package-lock.json' || CONFIG_FILE.test(fileName))
  ) {
    return true
  }

  if (
    relativePath === '.dockerignore'
    || relativePath === 'Dockerfile'
    || relativePath === 'server/Dockerfile'
    || relativePath === 'index.html'
    || relativePath === 'nginx.conf'
    || relativePath === 'docker-entrypoint.sh'
  ) {
    return true
  }

  if (
    relativePath.startsWith('src/')
    || relativePath.startsWith('public/')
    || relativePath.startsWith('server/src/')
    || relativePath.startsWith('server/migrations/')
    || relativePath.startsWith('tests/')
    || relativePath.startsWith('tests-remote/')
    || relativePath.startsWith('scripts/')
    || relativePath.startsWith('deploy/')
    || relativePath.startsWith('.github/workflows/')
  ) {
    return true
  }

  if (relativePath === 'docs/traceability/evidence-manifest.json') return false

  return relativePath === 'docs/traceability/requirements.md'
    || (relativePath.startsWith('docs/traceability/') && relativePath.endsWith('.json'))
}

async function walkFiles(workspaceRoot, relativeDirectory, results) {
  const absoluteDirectory = relativeDirectory
    ? path.join(workspaceRoot, ...relativeDirectory.split('/'))
    : workspaceRoot
  const entries = await readdir(absoluteDirectory, { withFileTypes: true })

  for (const entry of entries) {
    const relativePath = normalizeRelativePath(
      relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name,
    )

    if (entry.isSymbolicLink()) {
      continue
    }
    if (entry.isDirectory()) {
      if (!isExcludedDirectory(relativePath)) {
        await walkFiles(workspaceRoot, relativePath, results)
      }
      continue
    }
    if (entry.isFile() && !isSensitive(relativePath) && isIncluded(relativePath)) {
      results.push(relativePath)
    }
  }
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex').toUpperCase()
}

export async function collectCheckpointInputs(workspaceRoot) {
  const results = []
  await walkFiles(path.resolve(workspaceRoot), '', results)
  return results.sort(comparePaths)
}

export async function buildLocalCheckpoint(workspaceRoot) {
  const paths = await collectCheckpointInputs(workspaceRoot)
  const files = []

  for (const relativePath of paths) {
    const contents = await readFile(path.join(workspaceRoot, ...relativePath.split('/')))
    files.push({ path: relativePath, sha256: sha256(contents) })
  }

  const manifest = `${files.map((row) => `${row.path} ${row.sha256}`).join('\n')}\n`
  return {
    kind: 'uncommitted-local-checkpoint',
    rootSha256: sha256(Buffer.from(manifest, 'utf8')),
    files,
    includeRules: [...INCLUDE_RULES],
    excludeRules: [...EXCLUDE_RULES],
  }
}
