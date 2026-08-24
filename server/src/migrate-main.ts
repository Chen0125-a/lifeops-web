import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import mysql, { type Pool } from 'mysql2/promise'
import { loadConfig } from './config.js'
import { runMigrations } from './db/migrate.js'

export interface MigrationCommandDependencies {
  createPool(): Pool
  runMigrations(pool: Pool): Promise<unknown>
  writeError(message: string): void
}

export async function runMigrationCommand(
  dependencies: MigrationCommandDependencies,
): Promise<number> {
  let pool: Pool | undefined
  let exitCode = 0
  try {
    pool = dependencies.createPool()
    await dependencies.runMigrations(pool)
  } catch (error) {
    dependencies.writeError(safeMigrationError(error))
    exitCode = 1
  } finally {
    if (pool) {
      try {
        await pool.end()
      } catch {
        dependencies.writeError('MIGRATION_POOL_CLOSE_FAILED')
        exitCode = 1
      }
    }
  }
  return exitCode
}

function safeMigrationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.match(/MIGRATION_CHECKSUM_MISMATCH:\d{3}/)?.[0]
    ?? message.match(/MIGRATION_(?:LOCK_TIMEOUT|DUPLICATE_VERSION:\d{3})/)?.[0]
    ?? message.match(/MIGRATION_APPLY_FAILED:\d{3}:[A-Z][A-Z0-9_]{1,80}/)?.[0]
    ?? 'MIGRATION_FAILED'
}

function createMigrationPool() {
  const config = loadConfig()
  if (config.store !== 'mysql') throw new Error('MIGRATION_REQUIRES_MYSQL')
  return mysql.createPool({
    host: config.mysql.host,
    port: config.mysql.port,
    database: config.mysql.database,
    user: config.mysql.user,
    password: config.mysql.password,
    connectionLimit: config.mysql.connectionLimit,
    charset: 'utf8mb4',
    dateStrings: true,
    timezone: 'Z',
    enableKeepAlive: true,
  })
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1]!)).href === import.meta.url
if (isMain) {
  let terminationRequested = false
  const requestTermination = () => { terminationRequested = true }
  process.once('SIGTERM', requestTermination)
  process.once('SIGINT', requestTermination)
  try {
    const result = await runMigrationCommand({
      createPool: createMigrationPool,
      runMigrations,
      writeError: (message) => process.stderr.write(`${message}\n`),
    })
    process.exitCode = terminationRequested ? 143 : result
  } finally {
    process.removeListener('SIGTERM', requestTermination)
    process.removeListener('SIGINT', requestTermination)
  }
}
