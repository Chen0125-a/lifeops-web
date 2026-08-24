import { describe, expect, it } from 'vitest'
import {
  KnowledgeDomainError,
  type KnowledgeNote,
  rankResurfacedKnowledge,
  validateKnowledgeSourceLinks,
  walkRelatedKnowledge,
} from './knowledge.js'

const note = (id: string, patch: Partial<KnowledgeNote> = {}): KnowledgeNote => ({
  id,
  title: `Note ${id}`,
  body: `Body ${id}`,
  tags: [],
  collectionIds: [],
  sourceLinks: [],
  relatedIds: [],
  pinned: false,
  favorite: false,
  reviewOn: null,
  version: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  archivedAt: null,
  deletedAt: null,
  ...patch,
})

describe('knowledge domain', () => {
  it('ranks due knowledge before recent undated notes and uses a deterministic ID tie-break', () => {
    const ranked = rankResurfacedKnowledge([
      note('recent', { updatedAt: '2026-08-21T00:00:00.000Z' }),
      note('due-b', { reviewOn: '2026-08-20', updatedAt: '2026-08-10T00:00:00.000Z' }),
      note('due-a', { reviewOn: '2026-08-20', updatedAt: '2026-08-10T00:00:00.000Z' }),
      note('future-pinned', { reviewOn: '2026-08-30', pinned: true, updatedAt: '2026-08-01T00:00:00.000Z' }),
    ], '2026-08-22T08:00:00.000Z')

    expect(ranked.map((item) => item.id)).toEqual(['due-a', 'due-b', 'future-pinned', 'recent'])
  })

  it('excludes archived and deleted notes from resurfacing', () => {
    expect(rankResurfacedKnowledge([
      note('active', { reviewOn: '2026-08-01' }),
      note('archived', { reviewOn: '2026-07-01', archivedAt: '2026-08-10T00:00:00.000Z' }),
      note('deleted', { reviewOn: '2026-07-01', deletedAt: '2026-08-10T00:00:00.000Z' }),
    ], '2026-08-22T08:00:00.000Z').map((item) => item.id)).toEqual(['active'])
  })

  it('walks related-note cycles once without recursion failure', () => {
    const walked = walkRelatedKnowledge([
      note('a', { relatedIds: ['b'] }),
      note('b', { relatedIds: ['c'] }),
      note('c', { relatedIds: ['a'] }),
    ], 'a')
    expect(walked.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('accepts factual source types and rejects invalid, empty, or duplicate links', () => {
    expect(validateKnowledgeSourceLinks([
      { type: 'record', id: 'record-1' },
      { type: 'review', id: 'review-1' },
      { type: 'goal', id: 'goal-1' },
      { type: 'project', id: 'project-1' },
    ])).toHaveLength(4)

    for (const links of [
      [{ type: 'task', id: 'task-1' }],
      [{ type: 'record', id: ' ' }],
      [{ type: 'record', id: 'record-1' }, { type: 'record', id: 'record-1' }],
    ]) {
      expect(() => validateKnowledgeSourceLinks(links as never)).toThrowError(KnowledgeDomainError)
    }
  })
})
