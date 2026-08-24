import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

export interface AxeScanContext {
  route: string
  state: 'loading' | 'data' | 'empty' | 'error' | 'interactive'
}

export async function expectNoSeriousOrCriticalViolations(
  page: Page,
  context: AxeScanContext,
) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const blocking = result.violations.filter((violation) => (
    violation.impact === 'serious' || violation.impact === 'critical'
  ))
  const evidence = blocking.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }))

  expect(evidence, `${context.route} [${context.state}] serious/critical Axe violations`).toEqual([])
}
