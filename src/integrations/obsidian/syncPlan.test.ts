import { describe, expect, it } from 'vitest'
import { buildSyncPlan } from './syncPlan'
import type { VaultDocument } from './types'

function doc(id: string, revision: number, body = id, patch: Partial<VaultDocument> = {}): VaultDocument {
  return {
    lifeopsId: id,
    type: 'knowledge',
    title: id,
    tags: ['sync'],
    source: null,
    updatedAt: `2026-08-${String(revision + 1).padStart(2, '0')}T10:00:00.000Z`,
    syncRevision: revision,
    body,
    path: `LifeOps/Knowledge/${id}.md`,
    ...patch,
  }
}

describe('buildSyncPlan', () => {
  it('classifies unchanged, Web-newer, vault-newer and same-revision divergence deterministically', () => {
    const web = [doc('same', 3), doc('web-newer', 4), doc('vault-newer', 2), doc('conflict', 5, 'Web body')]
    const vault = [doc('same', 3), doc('web-newer', 3), doc('vault-newer', 4), doc('conflict', 5, 'Vault body')]

    const plan = buildSyncPlan(web, vault)
    expect(plan.actions.map(({ lifeopsId, kind }) => [lifeopsId, kind])).toEqual([
      ['conflict', 'conflict'],
      ['same', 'unchanged'],
      ['vault-newer', 'update-web'],
      ['web-newer', 'update-vault'],
    ])
    expect(plan.hasConflicts).toBe(true)
  })

  it('creates on the missing side and never infers a delete action from absence', () => {
    const plan = buildSyncPlan([doc('web-only', 1)], [doc('vault-only', 1)])
    expect(plan.actions.map(({ lifeopsId, kind }) => [lifeopsId, kind])).toEqual([
      ['vault-only', 'create-web'],
      ['web-only', 'create-vault'],
    ])
    expect(plan.actions.some(({ kind }) => String(kind).includes('delete'))).toBe(false)
  })

  it('rejects duplicate stable IDs on either side instead of choosing one silently', () => {
    expect(() => buildSyncPlan([doc('duplicate', 1), doc('duplicate', 2)], [])).toThrow(/duplicate/i)
    expect(() => buildSyncPlan([], [doc('duplicate', 1), doc('duplicate', 2)])).toThrow(/duplicate/i)
  })
})
