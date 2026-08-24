import { beforeEach, expect, it, vi } from 'vitest'
import type { RuntimeConfig } from './config.js'

const dependencies = vi.hoisted(() => ({
  createPool: vi.fn(() => ({ end: vi.fn() })),
  runMigrations: vi.fn(),
}))

vi.mock('mysql2/promise', () => ({
  default: { createPool: dependencies.createPool },
}))

vi.mock('./db/migrate.js', () => ({
  runMigrations: dependencies.runMigrations,
}))

import { createRuntime } from './runtime.js'

const disabledIntegration = {
  enabled: false,
  baseUrl: null,
  timeoutMs: 3_000,
  maxResponseBytes: 256 * 1024,
  deepLinkUrl: null,
  auth: {},
}

const mysqlConfig: RuntimeConfig = {
  host: '127.0.0.1',
  port: 8080,
  store: 'mysql',
  mediaStorage: { backend: 'filesystem', root: 'data/media' },
  mysql: {
    host: 'mysql.internal',
    port: 3306,
    database: 'lifeops',
    user: 'lifeops',
    password: 'runtime-secret',
    connectionLimit: 10,
  },
  app: {
    cookieName: 'lifeops_session',
    sessionTtlSeconds: 3600,
    secureCookies: true,
    allowedOrigins: [],
    logger: false,
    trustProxy: false,
    publicOrigin: 'https://lifeops.example.test',
  },
  bootstrap: {
    account: 'owner@example.test',
    password: 'bootstrap-secret',
    displayName: 'Owner',
  },
  integrations: {
    kubernetes: disabledIntegration,
    prometheus: disabledIntegration,
    alertmanager: disabledIntegration,
    elasticsearch: disabledIntegration,
    github: disabledIntegration,
    argoCd: disabledIntegration,
  },
}

beforeEach(() => {
  dependencies.createPool.mockClear()
  dependencies.runMigrations.mockClear()
})

it('opens the MySQL runtime without mutating schema during API startup', async () => {
  const runtime = await createRuntime(mysqlConfig)

  expect(dependencies.createPool).toHaveBeenCalledOnce()
  expect(dependencies.runMigrations).not.toHaveBeenCalled()
  expect(runtime.store).toBeDefined()
})
