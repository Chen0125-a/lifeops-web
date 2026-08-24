import type { FullConfig } from '@playwright/test'
import { createServer } from 'vite'

export default async function globalSetup(_config: FullConfig) {
  process.env.VITE_LIFEOPS_API_MODE = 'remote'
  const vite = await createServer({
    configFile: 'vite.config.ts',
    server: { host: '127.0.0.1', port: 4194, strictPort: true },
  })
  await vite.listen()
  return async () => vite.close()
}
