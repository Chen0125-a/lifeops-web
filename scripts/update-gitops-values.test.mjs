import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const script = path.resolve('scripts/update-gitops-values.mjs')
const webDigest = `sha256:${'a'.repeat(64)}`
const apiDigest = `sha256:${'b'.repeat(64)}`
const base = `production: true
web:
  image:
    repository: registry.example/lifeops-web
    tag: "1.0.0"
    digest: ""
api:
  image:
    repository: registry.example/lifeops-api
    tag: "1.0.0"
    digest: ''
networkPolicy:
  enabled: true
`

async function withFixture(source, callback) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lifeops-gitops-updater-'))
  const file = path.join(directory, 'values.yaml')
  try {
    await writeFile(file, source, 'utf8')
    await callback(file)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function run(file, web = webDigest, api = apiDigest) {
  return execFileSync(process.execPath, [script, file, web, api], { encoding: 'utf8', stdio: 'pipe' })
}

test('updates only the two digest scalars and preserves every other byte', async () => {
  await withFixture(base, async (file) => {
    run(file)
    const actual = await readFile(file, 'utf8')
    const expected = base
      .replace('    digest: ""', `    digest: "${webDigest}"`)
      .replace("    digest: ''", `    digest: "${apiDigest}"`)
    assert.equal(actual, expected)
  })
})

test('preserves CRLF and comments while changing only exact digest fields', async () => {
  const source = base.replace('production: true', '# retained\nproduction: true').replaceAll('\n', '\r\n')
  await withFixture(source, async (file) => {
    run(file)
    const actual = await readFile(file, 'utf8')
    const normalize = (value) => value.replace(/(^\s+digest:\s*)(?:"[^"]*"|'[^']*'|\S*)/gmu, '$1<DIGEST>')
    assert.equal(normalize(actual), normalize(source))
  })
})

for (const [name, source] of [
  ['duplicate top-level section', `${base}\nweb:\n  image:\n    digest: ""\n`],
  ['duplicate digest key', base.replace('    digest: ""', '    digest: ""\n    digest: ""')],
  ['anchor', base.replace('production: true', 'production: &production true')],
  ['alias', `${base}\ncopy: *production\n`],
  ['missing image section', base.replace(/web:\n  image:\n(?:    .*\n){3}/u, 'web:\n  enabled: true\n')],
]) {
  test(`rejects ${name}`, async () => {
    await withFixture(source, async (file) => {
      assert.throws(() => run(file))
      assert.equal(await readFile(file, 'utf8'), source)
    })
  })
}

test('rejects malformed or non-sha256 digests without writing', async () => {
  await withFixture(base, async (file) => {
    assert.throws(() => run(file, 'latest', apiDigest))
    assert.throws(() => run(file, webDigest, `sha256:${'C'.repeat(64)}`))
    assert.equal(await readFile(file, 'utf8'), base)
  })
})
