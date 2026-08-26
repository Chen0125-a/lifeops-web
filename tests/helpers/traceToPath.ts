import { randomUUID } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import type { BrowserContext } from '@playwright/test'
import { writeBufferToPath } from './screenshotToPath'

export async function traceToPath(context: BrowserContext, path: string) {
  const temporaryPath = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)

  try {
    await context.tracing.stop({ path: temporaryPath })
    await writeBufferToPath(path, await readFile(temporaryPath))
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
  }
}
