import { describe, expect, it } from 'vitest'
import { searchDocuments, type SearchDocument } from './search.js'

const timestamp = '2026-08-23T00:00:00.000Z'

function document(id: string, patch: Partial<SearchDocument> = {}): SearchDocument {
  return {
    userId: 'owner-a',
    type: 'record',
    sourceId: id,
    title: id,
    bodyText: '',
    tagsText: '',
    sourceText: '',
    updatedAt: timestamp,
    deletedAt: null,
    ...patch,
  }
}

describe('personal search ranking', () => {
  it('ranks exact title above title substring, tags and body matches', () => {
    const documents = [
      document('body', { title: '普通记录', bodyText: '完成平台验收' }),
      document('tags', { title: '标签记录', tagsText: '平台验收' }),
      document('contains', { title: '本周平台验收清单' }),
      document('exact', { title: '平台验收' }),
    ]

    expect(searchDocuments(documents, { userId: 'owner-a', query: '平台验收' }).map((row) => row.id))
      .toEqual(['exact', 'contains', 'tags', 'body'])
  })

  it('supports Chinese substring and deterministic recency then stable-id tie breaks', () => {
    const documents = [
      document('older', { title: '复核高可用交付', updatedAt: '2026-08-20T00:00:00.000Z' }),
      document('z-newer', { title: '复核高可用发布', updatedAt: '2026-08-22T00:00:00.000Z' }),
      document('a-newer', { title: '复核高可用平台', updatedAt: '2026-08-22T00:00:00.000Z' }),
    ]

    expect(searchDocuments(documents, { userId: 'owner-a', query: '高可用' }).map((row) => row.id))
      .toEqual(['a-newer', 'z-newer', 'older'])
  })

  it('filters original and life result types without admitting platform sources', () => {
    const documents = [
      document('goal-1', { type: 'goal', title: '发布 LifeOps' }),
      document('recipe-1', { type: 'recipe', title: 'LifeOps 恢复餐' }),
      document('platform-1', { type: 'platform' as never, title: 'LifeOps 平台日志' }),
    ]

    expect(searchDocuments(documents, { userId: 'owner-a', query: 'LifeOps', types: ['goal'] }).map((row) => row.type))
      .toEqual(['goal'])
    expect(searchDocuments(documents, { userId: 'owner-a', query: 'LifeOps', types: ['recipe'] }).map((row) => row.type))
      .toEqual(['recipe'])
  })

  it('returns recipe ingredient and day-plan date context as plain text excerpts', () => {
    const results = searchDocuments([
      document('recipe-1', { type: 'recipe', title: '恢复计划', sourceText: '鸡胸肉 西兰花 糙米' }),
      document('day-1', { type: 'day-plan', title: '周一计划', sourceText: '2026-08-24 早餐 午餐 训练' }),
    ], { userId: 'owner-a', query: '计划', limit: 10 })

    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'recipe-1', context: expect.stringContaining('鸡胸肉') }),
      expect.objectContaining({ id: 'day-1', context: expect.stringContaining('2026-08-24') }),
    ]))
    expect(results.every((row) => !/[<>]/u.test(row.excerpt))).toBe(true)
  })

  it('excludes deleted documents and every other owner before ranking', () => {
    const results = searchDocuments([
      document('mine', { title: '私人检索证据' }),
      document('deleted', { title: '私人检索证据', deletedAt: '2026-08-23T01:00:00.000Z' }),
      document('other', { userId: 'owner-b', title: '私人检索证据' }),
    ], { userId: 'owner-a', query: '私人检索' })

    expect(results.map((row) => row.id)).toEqual(['mine'])
  })

  it('normalizes bounds and rejects empty or unsupported type filters', () => {
    const documents = Array.from({ length: 60 }, (_, index) => document(`record-${String(index).padStart(2, '0')}`, { title: '边界记录' }))
    expect(searchDocuments(documents, { userId: 'owner-a', query: '边界', limit: 100 })).toHaveLength(50)
    expect(searchDocuments(documents, { userId: 'owner-a', query: '  ' })).toEqual([])
    expect(() => searchDocuments(documents, { userId: 'owner-a', query: '边界', types: ['platform' as never] })).toThrow('UNSUPPORTED_SEARCH_TYPE')
  })
})
