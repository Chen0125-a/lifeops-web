import type { FullConfig } from '@playwright/test'
import { createServer } from 'vite'

export default async function globalSetup(_config: FullConfig) {
  const p3T13Focused = process.argv.some((argument) => /life-(today-calendar|catalog-recipes|planning-completion|shopping-budget|data-recovery)\.spec\.ts$/i.test(argument))
  if (p3T13Focused) process.env.VITE_LIFEOPS_API_MODE = 'remote'
  else delete process.env.VITE_LIFEOPS_API_MODE
  const vite = await createServer({
    configFile: 'vite.config.ts',
    server: { host: '127.0.0.1', port: 4193, strictPort: true },
  })
  await vite.listen()
  return async () => vite.close()
}
