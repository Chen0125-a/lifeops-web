import mysql from 'mysql2/promise'
import { loadConfig, type RuntimeConfig } from './config.js'
import { MemoryLifeStore } from './store/memoryLifeStore.js'
import { MySqlLifeStore } from './store/mysqlLifeStore.js'
import type { LifeStore } from './store/lifeStore.js'
import { createMediaStorage } from './media/storageFactory.js'
import type { MediaStoragePort } from './media/storagePort.js'
import { PublicationScheduler } from './services/publicationScheduler.js'

export interface LifeOpsRuntime {
  config: RuntimeConfig
  store: LifeStore
  mediaStorage: MediaStoragePort
  publicationScheduler: PublicationScheduler
}

const runtimeResult = (config: RuntimeConfig, store: LifeStore, mediaStorage: MediaStoragePort): LifeOpsRuntime => ({
  config,
  store,
  mediaStorage,
  publicationScheduler: new PublicationScheduler(store),
})

export async function createRuntime(config: RuntimeConfig = loadConfig()): Promise<LifeOpsRuntime> {
  const mediaStorage = createMediaStorage(config.mediaStorage)
  if (config.store === 'memory') return runtimeResult(config, new MemoryLifeStore({ mediaStorage }), mediaStorage)
  const pool = mysql.createPool({
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
  return runtimeResult(config, new MySqlLifeStore(pool, { mediaStorage }), mediaStorage)
}
