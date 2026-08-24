import { describe, expect, it } from 'vitest'
import {
  createRecordEntity,
  updateRecordEntity,
  type CreateRecordInput,
  type UpdateRecordInput,
} from './records.js'
import type { LifeRecord } from './types.js'

type CoveredRecord = LifeRecord & { coverMediaId: string | null }
type CoveredCreate = CreateRecordInput & { coverMediaId?: string | null }
type CoveredUpdate = UpdateRecordInput & { coverMediaId?: string | null }

const now = '2026-08-21T08:00:00.000Z'

function create(input: Partial<CoveredCreate> = {}) {
  return createRecordEntity('record-1', now, {
    title: '记录封面合同',
    body: '可审计的正文。',
    mediaIds: ['media-a', 'media-b'],
    ...input,
  } as CoveredCreate) as CoveredRecord
}

function update(current: CoveredRecord, input: CoveredUpdate) {
  return updateRecordEntity(current, '2026-08-21T09:00:00.000Z', input) as CoveredRecord
}

describe('record cover identity', () => {
  it('creates a persisted null cover by default and accepts only an attached image ID', () => {
    expect(create().coverMediaId).toBeNull()
    expect(create({ coverMediaId: 'media-b' }).coverMediaId).toBe('media-b')
    expect(() => create({ mediaIds: ['media-a'], coverMediaId: 'media-b' }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT', status: 400 }))
  })

  it('distinguishes omitted, explicit-null and non-null PATCH cover semantics', () => {
    const current = create({ coverMediaId: 'media-a' })
    expect(update(current, { title: '只改标题', version: 1 }).coverMediaId).toBe('media-a')
    expect(update(current, { coverMediaId: null, version: 1 }).coverMediaId).toBeNull()
    expect(update(current, { coverMediaId: 'media-b', version: 1 }).coverMediaId).toBe('media-b')
  })

  it('rejects removing the active cover unless the same request clears or replaces it', () => {
    const current = create({ coverMediaId: 'media-a' })
    expect(() => update(current, { mediaIds: ['media-b'], version: 1 }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT', status: 400 }))
    expect(update(current, { mediaIds: ['media-b'], coverMediaId: null, version: 1 }))
      .toMatchObject({ mediaIds: ['media-b'], coverMediaId: null, version: 2 })
    expect(update(current, { mediaIds: ['media-b'], coverMediaId: 'media-b', version: 1 }))
      .toMatchObject({ mediaIds: ['media-b'], coverMediaId: 'media-b', version: 2 })
  })
})
