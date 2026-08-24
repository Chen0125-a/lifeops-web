import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool, RowDataPacket } from 'mysql2/promise'

export interface AppliedMigration {
  version: string
  name: string
  checksum: string
}

interface MigrationFile extends AppliedMigration {
  sql: string
}

interface MigrationOptions {
  directory?: string
}

const MIGRATION_FILE = /^(\d{3})_(.+)\.sql$/
const MIGRATION_LOCK = 'lifeops:schema-migrations'
const MIGRATION_LOCK_TIMEOUT_SECONDS = 30

interface MigrationLockRow extends RowDataPacket {
  acquired: number | null
}

function checksum(contents: string) {
  return createHash('sha256').update(contents, 'utf8').digest('hex').toUpperCase()
}

function databaseErrorCode(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(code) ? code : 'UNKNOWN'
}

function statements(sql: string) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
}

async function discoverMigrations(directory: string): Promise<MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const migrations: MigrationFile[] = []
  const versions = new Set<string>()

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const match = entry.name.match(MIGRATION_FILE)
    if (!match) continue

    const version = match[1]
    if (versions.has(version)) {
      throw new Error(`MIGRATION_DUPLICATE_VERSION:${version}`)
    }
    versions.add(version)

    const sql = await readFile(join(directory, entry.name), 'utf8')
    migrations.push({ version, name: entry.name, checksum: checksum(sql), sql })
  }

  return migrations.sort((left, right) => left.version.localeCompare(right.version))
}

export async function runMigrations(
  pool: Pool,
  options: MigrationOptions = {},
): Promise<AppliedMigration[]> {
  const directory = options.directory
    ?? fileURLToPath(new URL('../../migrations/', import.meta.url))
  const migrations = await discoverMigrations(directory)
  const connection = await pool.getConnection()
  let lockAcquired = false

  try {
    const [lockRows] = await connection.query<MigrationLockRow[]>(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [MIGRATION_LOCK, MIGRATION_LOCK_TIMEOUT_SECONDS],
    )
    if (Number(lockRows[0]?.acquired) !== 1) {
      throw new Error('MIGRATION_LOCK_TIMEOUT')
    }
    lockAcquired = true

    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(16) PRIMARY KEY,
      name VARCHAR(190) NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME(3) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`)

    const [rawRows] = await connection.query(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
    )
    const appliedRows = rawRows as Array<AppliedMigration>
    const appliedByVersion = new Map(appliedRows.map((migration) => [migration.version, migration]))

    for (const migration of migrations) {
      const applied = appliedByVersion.get(migration.version)
      if (applied && applied.checksum.toUpperCase() !== migration.checksum) {
        throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${migration.version}`)
      }
    }

    for (const migration of migrations) {
      if (appliedByVersion.has(migration.version)) continue

      try {
        for (const statement of statements(migration.sql)) {
          await connection.query(statement)
        }
        await connection.query(
          `INSERT INTO schema_migrations (version, name, checksum, applied_at)
           VALUES (?, ?, ?, UTC_TIMESTAMP(3))`,
          [migration.version, migration.name, migration.checksum],
        )
      } catch (error) {
        throw new Error(
          `MIGRATION_APPLY_FAILED:${migration.version}:${databaseErrorCode(error)}`,
          { cause: error },
        )
      }
      appliedByVersion.set(migration.version, migration)
    }

    return migrations.map(({ version, name, checksum: migrationChecksum }) => ({
      version,
      name,
      checksum: migrationChecksum,
    }))
  } finally {
    if (lockAcquired) {
      await connection.query('SELECT RELEASE_LOCK(?) AS released', [MIGRATION_LOCK])
    }
    connection.release()
  }
}
