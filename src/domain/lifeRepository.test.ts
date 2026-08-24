import { describe, expect, it } from 'vitest'
import { createMemoryStorage, LifeRepository } from './lifeRepository'

const makeRepository = (legacy?: unknown) => {
  let sequence = 0
  const storage = createMemoryStorage(
    legacy === undefined ? {} : { 'lifeops:data': JSON.stringify(legacy) },
  )
  const repository = new LifeRepository({
    storage,
    key: 'lifeops:data',
    createId: () => `id-${++sequence}`,
    now: () => '2026-08-08T12:00:00.000Z',
  })
  return { repository, storage }
}

describe('LifeRepository', () => {
  it('migrates a legacy plan and fills every V1 collection', () => {
    const { repository } = makeRepository({
      plans: [{ id: 'old-plan', title: '旧计划', done: true }],
      records: [],
    })

    const state = repository.getSnapshot()

    expect(state.schemaVersion).toBe(1)
    expect(state.plans[0]).toMatchObject({ id: 'old-plan', status: 'done' })
    expect(state.reviews).toEqual([])
    expect(state.knowledge).toEqual([])
    expect(state.snapshots).toEqual([])
  })

  it('completes the full plan to public snapshot loop with source traceability', () => {
    const { repository } = makeRepository()

    const plan = repository.createPlan({ title: '完成 LifeOps 首页' })
    repository.completePlan(plan.id)
    const record = repository.createRecord({
      planId: plan.id,
      title: '今天的实现记录',
      body: '先修复公转，再完成私人宇宙。',
      tags: ['LifeOps'],
    })
    const review = repository.createReview({
      periodStart: '2026-08-04',
      periodEnd: '2026-08-10',
      summary: '本周从原型走向可验证实现。',
      insights: ['先写回归测试能够减少反复。'],
      sourcePlanIds: [plan.id],
      sourceRecordIds: [record.id],
    })
    const note = repository.createKnowledgeNote({
      sourceType: 'review',
      sourceId: review.id,
      title: '动效实现原则',
      body: '只在热路径写 transform 与 opacity。',
      tags: ['前端性能'],
    })
    const snapshot = repository.createSnapshot({
      sourceType: 'knowledge',
      sourceId: note.id,
      title: note.title,
      excerpt: note.body,
    })
    const published = repository.publishSnapshot(snapshot.id)

    expect(repository.getSnapshot().plans[0].status).toBe('done')
    expect(record.planId).toBe(plan.id)
    expect(review.evidence.map((item) => item.sourceId)).toEqual([plan.id, record.id])
    expect(note.source).toEqual({ type: 'review', id: review.id })
    expect(published.visibility).toBe('public')
    expect(published.publishedAt).toBe('2026-08-08T12:00:00.000Z')
  })

  it('publishes an immutable allowlisted copy and can revoke it', () => {
    const { repository } = makeRepository()
    const record = repository.createRecord({
      title: '完整私密记录',
      body: '公开时只允许显式摘录，不能把原文或标签一起带出去。',
      tags: ['私密标签'],
    })
    const snapshot = repository.createSnapshot({
      sourceType: 'record',
      sourceId: record.id,
      title: '允许公开的标题',
      excerpt: '这是一段经过确认的摘录。',
    })

    repository.publishSnapshot(snapshot.id)
    const publicCopy = repository.getSnapshot().snapshots[0]

    expect(publicCopy).not.toHaveProperty('body')
    expect(publicCopy).not.toHaveProperty('tags')
    expect(publicCopy.excerpt).toBe('这是一段经过确认的摘录。')

    const revoked = repository.revokeSnapshot(snapshot.id)
    expect(revoked.visibility).toBe('private')
    expect(revoked.revokedAt).toBe('2026-08-08T12:00:00.000Z')
  })

  it('rejects a public snapshot whose private source no longer exists', () => {
    const { repository } = makeRepository()

    expect(() => repository.createSnapshot({
      sourceType: 'record',
      sourceId: 'missing-record',
      title: '无来源快照',
      excerpt: '不能脱离真实来源公开。',
    })).toThrow('找不到公开快照来源')
  })

  it('persists after every mutation and notifies subscribers', () => {
    const { repository, storage } = makeRepository()
    let notifications = 0
    const unsubscribe = repository.subscribe(() => notifications++)

    repository.createPlan({ title: '保存计划' })
    unsubscribe()

    expect(notifications).toBe(1)
    expect(storage.getItem('lifeops:data')).toContain('保存计划')
  })

  it('refreshes from storage when another browser tab changes the ledger', () => {
    const storage = createMemoryStorage()
    const first = new LifeRepository({ storage, key: 'shared' })
    const second = new LifeRepository({ storage, key: 'shared' })
    let notifications = 0
    second.subscribe(() => notifications++)

    first.createPlan({ title: '来自另一标签页的计划' })
    expect(second.getSnapshot().plans).toHaveLength(0)

    second.refreshFromStorage()

    expect(second.getSnapshot().plans[0].title).toBe('来自另一标签页的计划')
    expect(second.storageKey).toBe('shared')
    expect(notifications).toBe(1)
  })
})
