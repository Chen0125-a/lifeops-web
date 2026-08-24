import { readFile, writeFile } from 'node:fs/promises'

const [file, webDigest, apiDigest] = process.argv.slice(2)
if (!file || !/^sha256:[a-f0-9]{64}$/.test(webDigest ?? '') || !/^sha256:[a-f0-9]{64}$/.test(apiDigest ?? '')) {
  throw new Error('usage: node scripts/update-gitops-values.mjs <file> <web sha256 digest> <api sha256 digest>')
}

const source = await readFile(file, 'utf8')

if (/(^|[\s:[{,])[&*][A-Za-z0-9_-]+/mu.test(source) || /^\s*<<:/mu.test(source)) {
  throw new Error('YAML anchors, aliases and merge keys are not supported in production values')
}
if (/^\t+/mu.test(source)) throw new Error('YAML indentation must use spaces')

const entries = []
const seen = new Set()
const stack = []
let offset = 0
for (const lineWithEnding of source.match(/.*(?:\r\n|\n|$)/gu) ?? []) {
  if (!lineWithEnding) continue
  const ending = lineWithEnding.endsWith('\r\n') ? '\r\n' : lineWithEnding.endsWith('\n') ? '\n' : ''
  const line = ending ? lineWithEnding.slice(0, -ending.length) : lineWithEnding
  const match = line.match(/^(\uFEFF?)( *)([A-Za-z0-9_-]+):(.*)$/u)
  if (match) {
    const indent = match[2].length
    while (stack.length && stack.at(-1).indent >= indent) stack.pop()
    const pathParts = [...stack.map((entry) => entry.key), match[3]]
    const keyPath = pathParts.join('.')
    if (seen.has(keyPath)) throw new Error(`duplicate YAML key: ${keyPath}`)
    seen.add(keyPath)
    const rawValue = match[4]
    const value = rawValue.trim()
    const entry = { keyPath, lineStart: offset, lineEnd: offset + line.length, prefix: `${match[1]}${match[2]}${match[3]}:`, rawValue }
    entries.push(entry)
    if (!value || value.startsWith('#')) stack.push({ indent, key: match[3] })
  }
  offset += lineWithEnding.length
}

const replacement = (keyPath, digest) => {
  const matching = entries.filter((entry) => entry.keyPath === keyPath)
  if (matching.length !== 1) throw new Error(`exactly one ${keyPath} field is required`)
  const entry = matching[0]
  const parsed = entry.rawValue.match(/^(\s*)(?:"[^"]*"|'[^']*'|[^\s#]*)(\s*(?:#.*)?)$/u)
  if (!parsed) throw new Error(`${keyPath} must be a scalar digest field`)
  return { ...entry, line: `${entry.prefix}${parsed[1]}"${digest}"${parsed[2]}` }
}

const replacements = [
  replacement('web.image.digest', webDigest),
  replacement('api.image.digest', apiDigest),
].sort((left, right) => right.lineStart - left.lineStart)
let updated = source
for (const row of replacements) updated = `${updated.slice(0, row.lineStart)}${row.line}${updated.slice(row.lineEnd)}`
await writeFile(file, updated, 'utf8')
