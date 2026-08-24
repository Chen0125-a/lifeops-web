import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Pool } from 'mysql2/promise'
import { expect, it, vi } from 'vitest'
import { runMigrations } from './migrate.js'

it('applies pending files in numeric order and rejects checksum drift', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lifeops-migrations-'))
  const applied = new Map<string, { version: string; name: string; checksum: string }>()
  const sqlCalls: string[] = []
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    const normalized = sql.trim()
    sqlCalls.push(normalized)

    if (/^SELECT\s+GET_LOCK/i.test(normalized)) return [[{ acquired: 1 }], []]
    if (/^SELECT\s+RELEASE_LOCK/i.test(normalized)) return [[{ released: 1 }], []]
    if (/^SELECT\s+version,\s*name,\s*checksum\s+FROM\s+schema_migrations/i.test(normalized)) {
      return [[...applied.values()], []]
    }

    if (/^INSERT\s+INTO\s+schema_migrations/i.test(normalized)) {
      const [version, name, checksum] = values as [string, string, string]
      applied.set(version, { version, name, checksum })
    }

    return [[], []]
  })
  const pool = {
    query,
    getConnection: vi.fn(async () => ({ query, release: vi.fn() })),
  } as unknown as Pool

  try {
    await writeFile(join(directory, '002_second.sql'), 'SELECT 2 AS second;\n', 'utf8')
    await writeFile(join(directory, '001_first.sql'), 'SELECT 1 AS first;\n', 'utf8')

    const first = await runMigrations(pool, { directory })

    expect(first.map((migration) => migration.version)).toEqual(['001', '002'])
    expect(sqlCalls.filter((sql) => /^SELECT\s+[12]\s+AS\s+(?:first|second)$/i.test(sql))).toEqual([
      'SELECT 1 AS first',
      'SELECT 2 AS second',
    ])

    await writeFile(join(directory, '002_second.sql'), 'SELECT 22 AS changed;\n', 'utf8')

    await expect(runMigrations(pool, { directory })).rejects.toThrow('MIGRATION_CHECKSUM_MISMATCH')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('serializes concurrent migration runners on one database lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lifeops-migrations-concurrent-'))
  const applied = new Map<string, { version: string; name: string; checksum: string }>()
  let legacySelectCount = 0
  let releaseLegacySelects: (() => void) | undefined
  const bothLegacySelects = new Promise<void>((resolve) => {
    releaseLegacySelects = resolve
  })
  let lockHeld = false
  const lockWaiters: Array<() => void> = []

  const migrationQuery = async (sql: string, values?: unknown[]) => {
    const normalized = sql.trim()
    if (/^SELECT\s+GET_LOCK/i.test(normalized)) {
      if (lockHeld) {
        await new Promise<void>((resolve) => lockWaiters.push(resolve))
      } else {
        lockHeld = true
      }
      return [[{ acquired: 1 }], []]
    }
    if (/^SELECT\s+RELEASE_LOCK/i.test(normalized)) {
      const next = lockWaiters.shift()
      if (next) next()
      else lockHeld = false
      return [[{ released: 1 }], []]
    }
    if (/^SELECT\s+version,\s*name,\s*checksum\s+FROM\s+schema_migrations/i.test(normalized)) {
      return [[...applied.values()], []]
    }
    if (/^INSERT\s+INTO\s+schema_migrations/i.test(normalized)) {
      const [version, name, checksum] = values as [string, string, string]
      if (applied.has(version)) throw new Error(`DUPLICATE_MIGRATION:${version}`)
      applied.set(version, { version, name, checksum })
    }
    return [[], []]
  }
  const pool = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      const normalized = sql.trim()
      if (/^SELECT\s+version,\s*name,\s*checksum\s+FROM\s+schema_migrations/i.test(normalized)) {
        legacySelectCount += 1
        if (legacySelectCount === 2) releaseLegacySelects?.()
        await bothLegacySelects
        return [[...applied.values()], []]
      }
      return migrationQuery(sql, values)
    }),
    getConnection: vi.fn(async () => ({
      query: vi.fn(migrationQuery),
      release: vi.fn(),
    })),
  } as unknown as Pool

  try {
    await writeFile(join(directory, '001_first.sql'), 'SELECT 1 AS first;\n', 'utf8')

    await expect(Promise.all([
      runMigrations(pool, { directory }),
      runMigrations(pool, { directory }),
    ])).resolves.toEqual([
      [expect.objectContaining({ version: '001' })],
      [expect.objectContaining({ version: '001' })],
    ])
    expect(pool.getConnection).toHaveBeenCalledTimes(2)
    expect(applied.size).toBe(1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('identifies the failed migration and database error code without exposing SQL details', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lifeops-migrations-failure-'))
  const databaseError = Object.assign(new Error('secret SQL details'), { code: 'ER_PARSE_ERROR' })
  const query = vi.fn(async (sql: string) => {
    const normalized = sql.trim()
    if (/^SELECT\s+GET_LOCK/i.test(normalized)) return [[{ acquired: 1 }], []]
    if (/^SELECT\s+RELEASE_LOCK/i.test(normalized)) return [[{ released: 1 }], []]
    if (/^SELECT\s+version,\s*name,\s*checksum\s+FROM\s+schema_migrations/i.test(normalized)) return [[], []]
    if (normalized === 'SELECT broken') throw databaseError
    return [[], []]
  })
  const pool = {
    getConnection: vi.fn(async () => ({ query, release: vi.fn() })),
  } as unknown as Pool

  try {
    await writeFile(join(directory, '001_broken.sql'), 'SELECT broken;\n', 'utf8')

    await expect(runMigrations(pool, { directory })).rejects.toThrow(
      'MIGRATION_APPLY_FAILED:001:ER_PARSE_ERROR',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
