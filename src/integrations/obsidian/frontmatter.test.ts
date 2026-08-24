import { describe, expect, it } from 'vitest'
import { parseVaultDocument, serializeVaultDocument } from './frontmatter'
import type { VaultDocument } from './types'

function document(patch: Partial<VaultDocument> = {}): VaultDocument {
  return {
    lifeopsId: 'note-1',
    type: 'knowledge',
    title: '发布：门禁 "证据"',
    tags: ['k8s', '中文: 标签'],
    source: 'review:review-1',
    updatedAt: '2026-08-09T10:00:00.000Z',
    syncRevision: 3,
    body: '# 正文\n\n--- 不是 frontmatter 边界\n\n保留 Unicode。',
    path: 'LifeOps/Knowledge/note-1.md',
    ...patch,
  }
}

describe('Obsidian frontmatter', () => {
  it('serializes a stable YAML-safe key order and preserves Unicode and body bytes', () => {
    const markdown = serializeVaultDocument(document())
    expect(markdown.split('\n').slice(0, 8)).toEqual([
      '---', 'lifeops_id: "note-1"', 'type: "knowledge"', 'tags:', '  - "k8s"',
      '  - "中文: 标签"', 'source: "review:review-1"', 'updated_at: "2026-08-09T10:00:00.000Z"',
    ])
    expect(markdown).toContain('sync_revision: 3\ntitle: "发布：门禁 \\"证据\\""\n---\n')
    expect(parseVaultDocument(markdown, document().path)).toEqual(document())
  })

  it('round-trips an approved review document and null source without guessing fields', () => {
    const review = document({ lifeopsId: 'review-周报', type: 'review', source: null, tags: [], path: 'LifeOps/Reviews/review.md' })
    expect(parseVaultDocument(serializeVaultDocument(review), review.path)).toEqual(review)
  })

  it.each([
    ['missing ID', document({ lifeopsId: '' })],
    ['unsafe ID', document({ lifeopsId: '../secret' })],
    ['invalid revision', document({ syncRevision: -1 })],
    ['invalid timestamp', document({ updatedAt: 'yesterday' })],
  ])('rejects %s before serialization', (_label, value) => {
    expect(() => serializeVaultDocument(value)).toThrow()
  })

  it('rejects an invalid type and an approved review in a knowledge-only folder', () => {
    const invalid = serializeVaultDocument(document()).replace('type: "knowledge"', 'type: "platform"')
    expect(() => parseVaultDocument(invalid, 'LifeOps/Knowledge/note-1.md')).toThrow(/type/i)
    expect(() => parseVaultDocument(serializeVaultDocument(document({ type: 'review' })), 'LifeOps/Knowledge/review.md', { expectedType: 'knowledge' })).toThrow(/type/i)
  })

  it('rejects missing required frontmatter without consuming the Markdown body', () => {
    const missing = serializeVaultDocument(document()).replace('lifeops_id: "note-1"\n', '')
    expect(() => parseVaultDocument(missing, document().path)).toThrow(/lifeops_id/i)
  })
})
