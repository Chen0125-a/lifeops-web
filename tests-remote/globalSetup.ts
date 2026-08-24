import type { FullConfig } from '@playwright/test'
import { createServer } from 'vite'
import { buildApp } from '../server/src/app.js'
import { hashPassword } from '../server/src/security/password.js'
import { MemoryLifeStore } from '../server/src/store/memoryLifeStore.js'

export default async function globalSetup(_config: FullConfig) {
  const store = new MemoryLifeStore()
  await store.createUser({
    account: 'owner@lifeops.local',
    displayName: 'LifeOps Owner',
    passwordHash: await hashPassword('LifeOps-V1-Remote-Test!'),
  })
  const api = buildApp({
    store,
    config: {
      cookieName: 'lifeops_session',
      sessionTtlSeconds: 28_800,
      secureCookies: false,
      allowedOrigins: ['http://127.0.0.1:4174'],
    },
  })
  await api.listen({ host: '127.0.0.1', port: 8080 })

  process.env.VITE_LIFEOPS_API_MODE = 'remote'
  const vite = await createServer({
    configFile: 'vite.config.ts',
    server: { host: '127.0.0.1', port: 4174, strictPort: true },
  })
  await vite.listen()

  return async () => {
    await vite.close()
    await api.close()
  }
}
