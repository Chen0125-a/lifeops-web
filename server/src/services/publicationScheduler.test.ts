import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryLifeStore } from '../store/memoryLifeStore.js'
import type { PublishingStore } from '../store/publishingStore.js'
import { PublicationScheduler, publishDueDrafts } from './publicationScheduler.js'

describe('publication scheduler', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('creates exactly one immutable revision when two API replicas publish the same due draft concurrently', async () => {
    let sequence = 0
    const store = new MemoryLifeStore({
      createId: () => `scheduler-${++sequence}`,
      now: () => '2026-08-22T10:00:00.000Z',
    }) as unknown as PublishingStore
    const draft = await store.createPublicDraft('owner-1', {
      category: 'learning',
      title: '双副本发布',
      excerpt: '只能生成一个 revision。',
      body: '# 双副本发布',
      slug: 'two-replica-publish',
    })
    await store.schedulePublicDraft('owner-1', draft.id, draft.version, '2026-08-22T10:01:00.000Z')

    const [first, second] = await Promise.all([
      publishDueDrafts(store, '2026-08-22T10:02:00.000Z'),
      publishDueDrafts(store, '2026-08-22T10:02:00.000Z'),
    ])

    expect([...first, ...second]).toHaveLength(1)
    expect((await store.listPublicRevisions('owner-1', draft.id))).toHaveLength(1)
    expect(await store.getPublishedRevision('two-replica-publish')).toMatchObject({ revision: 1, sourceVersion: 2 })
  })

  it('runs immediately, never overlaps in one process and waits for an in-flight run during clean shutdown', async () => {
    vi.useFakeTimers()
    let release: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const store = {
      listDuePublicDraftIds: vi.fn().mockResolvedValue(['draft-1']),
      publishDuePublicDraft: vi.fn().mockImplementation(() => blocked.then(() => undefined)),
    } as unknown as PublishingStore
    const scheduler = new PublicationScheduler(store, { now: () => '2026-08-22T10:02:00.000Z', intervalMs: 60_000 })

    scheduler.start()
    await vi.advanceTimersByTimeAsync(180_000)
    expect(store.listDuePublicDraftIds).toHaveBeenCalledTimes(1)
    expect(store.publishDuePublicDraft).toHaveBeenCalledTimes(1)

    let stopped = false
    const stopping = scheduler.stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)
    release!()
    await stopping
    await vi.advanceTimersByTimeAsync(120_000)
    expect(store.listDuePublicDraftIds).toHaveBeenCalledTimes(1)
  })

  it('logs a fixed secret-free failure message when the default scheduler callback catches a run failure', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const store = {
      listDuePublicDraftIds: vi.fn().mockRejectedValue(new Error('PRIVATE_DB_PASSWORD_SENTINEL')),
    } as unknown as PublishingStore
    const scheduler = new PublicationScheduler(store, { intervalMs: 60_000 })
    scheduler.start()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await scheduler.stop()
    expect(logged).toHaveBeenCalledWith('[lifeops] scheduled publishing failed')
    expect(JSON.stringify(logged.mock.calls)).not.toContain('PRIVATE_DB_PASSWORD_SENTINEL')
  })
})
