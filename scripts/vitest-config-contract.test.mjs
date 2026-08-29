import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const config = await readFile(new URL('../vitest.config.ts', import.meta.url), 'utf8')

test('bounds jsdom concurrency without weakening assertion budgets', () => {
  assert.match(config, /maxWorkers:\s*2\b/)
  assert.match(config, /testTimeout:\s*20_000\b/)
  assert.doesNotMatch(config, /hookTimeout\s*:/)
})
