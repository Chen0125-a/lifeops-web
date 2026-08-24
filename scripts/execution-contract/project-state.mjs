import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const EXECUTION_CONTROL_PATH = 'docs/superpowers/plans/2026-08-09-execution-control.md'

function cliValue(args, name) {
  const rows = Array.isArray(args) ? args : []
  const directIndex = rows.indexOf(name)
  if (directIndex >= 0 && typeof rows[directIndex + 1] === 'string' && rows[directIndex + 1].trim()) {
    return rows[directIndex + 1].trim()
  }
  const prefix = `${name}=`
  const inline = rows.find((entry) => typeof entry === 'string' && entry.startsWith(prefix))
  return inline?.slice(prefix.length).trim() || null
}

function agentsMemoryRoot(agentsText) {
  if (typeof agentsText !== 'string') return null
  const windowsMatch = agentsText.match(/([A-Za-z]:\\[^`\r\n]+?)\\(?:CURRENT|DECISIONS)\.md/)
  if (windowsMatch) return windowsMatch[1]
  const posixMatch = agentsText.match(/(\/[^`\r\n]+?)\/(?:CURRENT|DECISIONS)\.md/)
  return posixMatch?.[1] ?? null
}

export function resolveProjectMemoryRoot(args, env, agentsText) {
  const cliRoot = cliValue(args, '--project-memory-root')
  const environmentRoot = typeof env?.LIFEOPS_PROJECT_MEMORY_ROOT === 'string'
    ? env.LIFEOPS_PROJECT_MEMORY_ROOT.trim()
    : ''
  const declaredRoot = agentsMemoryRoot(agentsText)
  const selected = cliRoot || environmentRoot || declaredRoot
  if (!selected) {
    throw new Error('Project memory root is not configured by CLI, LIFEOPS_PROJECT_MEMORY_ROOT or AGENTS.md')
  }
  return path.resolve(selected)
}

export function parseFrontmatter(markdown) {
  if (typeof markdown !== 'string' || !markdown.startsWith('---')) return {}
  const end = markdown.indexOf('\n---', 3)
  if (end < 0) return {}
  const rows = markdown.slice(3, end).split(/\r?\n/)
  return Object.fromEntries(rows.flatMap((row) => {
    const match = row.match(/^([a-z_]+):\s*(.*?)\s*$/i)
    return match ? [[match[1], match[2]]] : []
  }))
}

async function readRequired(filePath, label) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    throw new Error(`Required ${label} is unavailable at ${filePath}: ${error?.code ?? 'READ_FAILED'}`)
  }
}

export async function loadProjectState(workspaceRoot, memoryRoot) {
  const absoluteWorkspaceRoot = path.resolve(workspaceRoot)
  const absoluteMemoryRoot = path.resolve(memoryRoot)
  const executionControlPath = path.join(absoluteWorkspaceRoot, ...EXECUTION_CONTROL_PATH.split('/'))
  const currentPath = path.join(absoluteMemoryRoot, 'CURRENT.md')
  const decisionsPath = path.join(absoluteMemoryRoot, 'DECISIONS.md')
  const sessionsPath = path.join(absoluteMemoryRoot, 'sessions')
  const [executionControlText, currentText, decisionsText] = await Promise.all([
    readRequired(executionControlPath, 'execution-control'),
    readRequired(currentPath, 'CURRENT.md'),
    readRequired(decisionsPath, 'DECISIONS.md'),
  ])

  let entries
  try {
    entries = await readdir(sessionsPath, { withFileTypes: true })
  } catch (error) {
    throw new Error(`Required sessions directory is unavailable at ${sessionsPath}: ${error?.code ?? 'READ_FAILED'}`)
  }
  const sessionFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = entry.name.match(/_S(\d+)_.*\.md$/i)
      return match ? { name: entry.name, number: Number(match[1]) } : null
    })
    .filter(Boolean)
    .sort((left, right) => right.number - left.number || right.name.localeCompare(left.name))
  if (sessionFiles.length === 0) {
    throw new Error(`Required sessions directory contains no numbered session at ${sessionsPath}`)
  }
  const latest = sessionFiles[0]
  const latestPath = path.join(sessionsPath, latest.name)
  const latestText = await readRequired(latestPath, 'latest session')

  return {
    workspaceRoot: absoluteWorkspaceRoot,
    memoryRoot: absoluteMemoryRoot,
    executionControl: {
      path: executionControlPath,
      text: executionControlText,
      frontmatter: parseFrontmatter(executionControlText),
    },
    current: { path: currentPath, text: currentText },
    decisions: { path: decisionsPath, text: decisionsText },
    latestSession: {
      path: latestPath,
      text: latestText,
      number: latest.number,
      nextNumber: latest.number + 1,
    },
  }
}
