import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from './httpClient'
import { queryClient } from './queryClient'
import { queryKeys } from './queryKeys'
import { knowledgeApi } from './knowledgeApi'

vi.mock('./httpClient', () => ({ http: { request: vi.fn() } }))
vi.mock('./queryClient', () => ({ queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) } }))

const request = vi.mocked(http.request)
const invalidateQueries = vi.mocked(queryClient.invalidateQueries)

describe('knowledgeApi', () => {
  beforeEach(() => {
    request.mockReset()
    request.mockResolvedValue(undefined)
    invalidateQueries.mockClear()
  })

  it('serializes every search filter and forwards abort signals', async () => {
    const signal = new AbortController().signal
    await knowledgeApi.list({
      q: '高可用 notes',
      tag: 'k8s/tag',
      source: 'review',
      collectionId: 'collection/1',
      includeArchived: true,
      includeDeleted: true,
    }, signal)
    await knowledgeApi.get('note/with space', signal)
    await knowledgeApi.resurface(signal)
    expect(request).toHaveBeenNthCalledWith(1,
      '/knowledge?q=%E9%AB%98%E5%8F%AF%E7%94%A8+notes&tag=k8s%2Ftag&source=review&collectionId=collection%2F1&includeArchived=true&includeDeleted=true',
      { signal },
    )
    expect(request).toHaveBeenNthCalledWith(2, '/knowledge/note%2Fwith%20space', { signal })
    expect(request).toHaveBeenNthCalledWith(3, '/knowledge/resurface', { signal })
  })

  it('preserves CSRF and optimistic versions through the note lifecycle', async () => {
    const create = { title: 'Operational fact', body: 'Keep the evidence linked.' }
    await knowledgeApi.create(create, 'csrf-1')
    await knowledgeApi.update('note/1', { title: 'Verified fact', version: 2 }, 'csrf-1')
    await knowledgeApi.archive('note/1', 3, 'csrf-1')
    await knowledgeApi.remove('note/1', 4, 'csrf-1')
    await knowledgeApi.restore('note/1', 5, 'csrf-1')
    expect(request).toHaveBeenNthCalledWith(1, '/knowledge', { method: 'POST', body: create, csrf: 'csrf-1' })
    expect(request).toHaveBeenNthCalledWith(2, '/knowledge/note%2F1', { method: 'PATCH', body: { title: 'Verified fact', version: 2 }, csrf: 'csrf-1' })
    expect(request).toHaveBeenNthCalledWith(3, '/knowledge/note%2F1/archive', { method: 'POST', body: { version: 3 }, csrf: 'csrf-1' })
    expect(request).toHaveBeenNthCalledWith(4, '/knowledge/note%2F1', { method: 'DELETE', body: { version: 4 }, csrf: 'csrf-1' })
    expect(request).toHaveBeenNthCalledWith(5, '/knowledge/note%2F1/restore', { method: 'POST', body: { version: 5 }, csrf: 'csrf-1' })
    expect(invalidateQueries).toHaveBeenCalledTimes(5)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.knowledge.all })
  })

  it('supports relation and collection contracts with encoded identifiers', async () => {
    await knowledgeApi.addRelation('note/1', 'note/2', 1, 'csrf-2')
    await knowledgeApi.removeRelation('note/1', 'note/2', 2, 'csrf-2')
    await knowledgeApi.listCollections(new AbortController().signal)
    await knowledgeApi.createCollection({ name: 'Ops', color: '#123456', position: 1 }, 'csrf-2')
    await knowledgeApi.updateCollection('collection/1', { name: 'Platform', version: 1 }, 'csrf-2')
    await knowledgeApi.removeCollection('collection/1', 2, 'csrf-2')
    expect(request).toHaveBeenNthCalledWith(1, '/knowledge/note%2F1/relations', { method: 'POST', body: { relatedId: 'note/2', version: 1 }, csrf: 'csrf-2' })
    expect(request).toHaveBeenNthCalledWith(2, '/knowledge/note%2F1/relations', { method: 'DELETE', body: { relatedId: 'note/2', version: 2 }, csrf: 'csrf-2' })
    expect(request).toHaveBeenNthCalledWith(4, '/knowledge/collections', { method: 'POST', body: { name: 'Ops', color: '#123456', position: 1 }, csrf: 'csrf-2' })
    expect(request).toHaveBeenNthCalledWith(5, '/knowledge/collections/collection%2F1', { method: 'PATCH', body: { name: 'Platform', version: 1 }, csrf: 'csrf-2' })
    expect(request).toHaveBeenNthCalledWith(6, '/knowledge/collections/collection%2F1', { method: 'DELETE', body: { version: 2 }, csrf: 'csrf-2' })
    expect(invalidateQueries).toHaveBeenCalledTimes(5)
  })
})
