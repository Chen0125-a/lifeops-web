import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const runner = readFileSync(resolve(process.cwd(), 'scripts/run-lighthouse.mjs'), 'utf8')

describe('Lighthouse runner contract', () => {
  it('keeps Chrome rendering semantics while avoiding the Docker shared-memory target crash', () => {
    expect(runner).toContain('--chrome-flags=--headless --no-sandbox --disable-gpu --disable-dev-shm-usage')
    expect(runner).toContain('CHROME_PATH: chromium.executablePath()')
    expect(runner).not.toContain('--chrome-path=')
    expect(runner).not.toMatch(/--disable-javascript|--disable-images|--disable-web-security/)
  })
})
