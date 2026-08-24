import { describe, expect, it } from 'vitest'
import { buildLifeImportMutations, buildLifeImportPlan } from './lifeImportPlan'
import type { LifeProjectionDocument, LifeProjectionType } from './lifeProjection'

const updatedAt = '2026-08-22T08:00:00.000Z'

function document(type: LifeProjectionType, id: string, version: number, body: string): LifeProjectionDocument {
  return {
    lifeopsId: id, type, version, updatedAt, title: id, tags: [], body,
    path: `LifeOps/Life/${type}/${encodeURIComponent(id)}.md`,
  }
}

describe('Life Obsidian import planning', () => {
  it('returns a preview-only deterministic plan and never models deletion', () => {
    const plan = buildLifeImportPlan(
      [document('fitness-summary', 'fitness-1', 2, 'web'), document('budget-summary', 'web-only', 1, 'web only')],
      [document('fitness-summary', 'fitness-1', 3, 'vault'), document('life-review', 'vault-only', 1, 'vault only')],
    )
    expect(plan.writesApplied).toBe(false)
    expect(plan.actions.map(({ kind }) => kind)).toEqual(['update-web', 'create-vault', 'import-candidate'])
    expect(plan.actions.some(({ kind }) => String(kind).includes('delete'))).toBe(false)
  })

  it('turns changed recipe content into an explicit version draft instead of a direct update', () => {
    const plan = buildLifeImportPlan(
      [document('recipe', 'recipe-1', 4, '# Original')],
      [document('recipe', 'recipe-1', 4, '# Edited in Obsidian')],
    )
    expect(plan.actions[0]).toMatchObject({ kind: 'recipe-version-draft', key: 'recipe:recipe-1' })
    expect(() => buildLifeImportMutations(plan, {})).toThrow(/recipe.*version|配方.*版本/i)
    expect(buildLifeImportMutations(plan, { 'recipe:recipe-1': 'create-recipe-version' })).toEqual([
      expect.objectContaining({ kind: 'create-recipe-version', action: expect.objectContaining({ lifeopsId: 'recipe-1' }) }),
    ])
  })

  it('requires an explicit choice for conflicts and exposes both versions', () => {
    const web = document('life-review', 'review-1', 2, 'Web version')
    const vault = { ...document('life-review', 'review-1', 2, 'Obsidian version'), title: 'Edited title' }
    const plan = buildLifeImportPlan([web], [vault])
    expect(plan.hasConflicts).toBe(true)
    expect(plan.actions[0]).toMatchObject({ kind: 'conflict', web, vault })
    expect(() => buildLifeImportMutations(plan, {})).toThrow(/conflict|冲突/i)
    expect(buildLifeImportMutations(plan, { 'life-review:review-1': 'use-obsidian' })).toEqual([
      expect.objectContaining({ kind: 'import' }),
    ])
  })
})
