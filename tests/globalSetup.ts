import type { FullConfig } from '@playwright/test'
import { resolve } from 'node:path'
import { build, preview } from 'vite'

const playwrightOutputDirectory = '.playwright-dist'

function closePreviewServer(server: Awaited<ReturnType<typeof preview>>) {
  return new Promise<void>((resolve, reject) => {
    server.httpServer.close((error) => error ? reject(error) : resolve())
  })
}

export default async function globalSetup(_config: FullConfig) {
  const p3T13Focused = process.argv.some((argument) => /life-(today-calendar|catalog-recipes|planning-completion|shopping-budget|data-recovery)\.spec\.ts$/i.test(argument))
  const priorApiMode = process.env.VITE_LIFEOPS_API_MODE
  if (p3T13Focused) process.env.VITE_LIFEOPS_API_MODE = 'remote'
  else delete process.env.VITE_LIFEOPS_API_MODE

  try {
    await build({
      configFile: 'vite.config.ts',
      define: { 'import.meta.env.DEV': 'true' },
      build: {
        outDir: playwrightOutputDirectory,
        emptyOutDir: true,
        rollupOptions: {
          input: {
            index: resolve('index.html'),
            'obsidian-browser-harness': resolve('tests/helpers/obsidianBrowserHarness.tsx'),
          },
          output: { entryFileNames: 'assets/[name].js' },
        },
      },
    })
    const vite = await preview({
      configFile: 'vite.config.ts',
      build: { outDir: playwrightOutputDirectory },
      preview: { host: '127.0.0.1', port: 4193, strictPort: true },
    })
    return async () => {
      await closePreviewServer(vite)
      if (priorApiMode === undefined) delete process.env.VITE_LIFEOPS_API_MODE
      else process.env.VITE_LIFEOPS_API_MODE = priorApiMode
    }
  } catch (error) {
    if (priorApiMode === undefined) delete process.env.VITE_LIFEOPS_API_MODE
    else process.env.VITE_LIFEOPS_API_MODE = priorApiMode
    throw error
  }
}
