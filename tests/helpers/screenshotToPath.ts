import { writeFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'

type ScreenshotOptions = NonNullable<Parameters<Page['screenshot']>[0]>

const RETRYABLE_WRITE_CODES = new Set(['EACCES', 'EBUSY', 'EPERM', 'UNKNOWN'])

export async function screenshotToPath(
  page: Page,
  options: ScreenshotOptions & { path: string },
) {
  const { path, ...captureOptions } = options
  const image = await page.screenshot(captureOptions)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await writeFile(path, image)
      return
    } catch (error) {
      const code = error instanceof Error && 'code' in error
        ? String((error as NodeJS.ErrnoException).code)
        : ''
      if (!RETRYABLE_WRITE_CODES.has(code) || attempt === 4) throw error
      await new Promise((resolveRetry) => setTimeout(resolveRetry, 100 * (attempt + 1)))
    }
  }
}
