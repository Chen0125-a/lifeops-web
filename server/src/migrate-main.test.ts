import type { Pool } from 'mysql2/promise'
import { describe, expect, it, vi } from 'vitest'
import { runMigrationCommand, type MigrationCommandDependencies } from './migrate-main.js'

function dependencies(runMigrations: MigrationCommandDependencies['runMigrations']) {
  const end = vi.fn().mockResolvedValue(undefined)
  const pool = { end } as unknown as Pool
  const writeError = vi.fn()
  return {
    command: {
      createPool: vi.fn(() => pool),
      runMigrations,
      writeError,
    } satisfies MigrationCommandDependencies,
    end,
    pool,
    writeError,
  }
}

describe('runMigrationCommand', () => {
  it('runs ordered migrations exactly once and closes the pool on success', async () => {
    const fixture = dependencies(vi.fn().mockResolvedValue([{ version: '001' }]))

    await expect(runMigrationCommand(fixture.command)).resolves.toBe(0)

    expect(fixture.command.runMigrations).toHaveBeenCalledOnce()
    expect(fixture.command.runMigrations).toHaveBeenCalledWith(fixture.pool)
    expect(fixture.end).toHaveBeenCalledOnce()
    expect(fixture.writeError).not.toHaveBeenCalled()
  })

  it('closes the pool, reports a credential-free error and returns non-zero on checksum drift', async () => {
    const fixture = dependencies(vi.fn().mockRejectedValue(
      new Error('MIGRATION_CHECKSUM_MISMATCH:004 password=database-secret'),
    ))

    await expect(runMigrationCommand(fixture.command)).resolves.toBe(1)

    expect(fixture.end).toHaveBeenCalledOnce()
    expect(fixture.writeError).toHaveBeenCalledOnce()
    expect(fixture.writeError.mock.calls[0]?.[0]).toContain('MIGRATION_CHECKSUM_MISMATCH:004')
    expect(fixture.writeError.mock.calls[0]?.[0]).not.toContain('database-secret')
  })

  it('closes the pool and returns non-zero when the database rejects migration work', async () => {
    const fixture = dependencies(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    await expect(runMigrationCommand(fixture.command)).resolves.toBe(1)

    expect(fixture.end).toHaveBeenCalledOnce()
    expect(fixture.writeError).toHaveBeenCalledOnce()
  })

  it('reports only the migration version and safe database error code on apply failure', async () => {
    const fixture = dependencies(vi.fn().mockRejectedValue(
      new Error('MIGRATION_APPLY_FAILED:009:ER_BAD_FIELD_ERROR password=database-secret'),
    ))

    await expect(runMigrationCommand(fixture.command)).resolves.toBe(1)

    expect(fixture.writeError).toHaveBeenCalledWith('MIGRATION_APPLY_FAILED:009:ER_BAD_FIELD_ERROR')
  })
})
