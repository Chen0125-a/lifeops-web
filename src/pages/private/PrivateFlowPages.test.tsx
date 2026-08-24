import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { createMemoryStorage, LifeRepository } from '../../domain/lifeRepository'
import { LifeDataProvider } from '../../state/LifeDataContext'
import { KnowledgePage } from './KnowledgePage'
import { PlansPage } from './PlansPage'
import { RecordsPage } from './RecordsPage'
import { ReviewsPage } from './ReviewsPage'
import { SnapshotsPage } from './SnapshotsPage'

describe('private LifeOps closed loop', () => {
  it('carries source evidence from a plan through record, review, knowledge and publication', async () => {
    const user = userEvent.setup()
    let sequence = 0
    const repository = new LifeRepository({
      storage: createMemoryStorage(),
      createId: () => `flow-${++sequence}`,
      now: () => '2026-08-09T00:00:00.000Z',
    })
    render(
      <LifeDataProvider repository={repository}>
        <MemoryRouter initialEntries={['/app/plans']}>
          <Routes>
            <Route path="/app/plans" element={<PlansPage />} />
            <Route path="/app/records" element={<RecordsPage />} />
            <Route path="/app/reviews" element={<ReviewsPage />} />
            <Route path="/app/knowledge" element={<KnowledgePage />} />
            <Route path="/app/publish" element={<SnapshotsPage />} />
          </Routes>
        </MemoryRouter>
      </LifeDataProvider>,
    )

    await user.type(screen.getByLabelText('计划标题'), '完成 LifeOps 私人闭环')
    await user.click(screen.getByRole('button', { name: '保存计划' }))
    await user.click(screen.getByRole('button', { name: '完成 完成 LifeOps 私人闭环' }))
    await user.click(screen.getByRole('link', { name: '留下记录' }))

    await user.clear(screen.getByLabelText('记录标题'))
    await user.type(screen.getByLabelText('记录标题'), '私人闭环实现记录')
    await user.type(screen.getByLabelText('记录内容'), '计划完成后立刻留下真实实现过程。')
    await user.click(screen.getByRole('button', { name: '保存生活记录' }))
    await user.click(screen.getByRole('link', { name: '进入周期回顾' }))

    await user.type(screen.getByLabelText('回顾总结'), '这次把五个环节真正串了起来。')
    await user.type(screen.getByLabelText('新的理解'), '来源关系比单独的功能数量更重要。')
    await user.click(screen.getByRole('button', { name: '保存周期回顾' }))
    await user.click(screen.getByRole('link', { name: '把本次回顾提炼为知识' }))

    await user.clear(screen.getByLabelText('知识标题'))
    await user.type(screen.getByLabelText('知识标题'), '闭环设计原则')
    await user.type(screen.getByLabelText('知识内容'), '每个结果都应该能回到它的来源。')
    await user.click(screen.getByRole('button', { name: '保存知识笔记' }))
    await user.click(screen.getByRole('link', { name: '为这条知识创建公开快照' }))

    await user.clear(screen.getByLabelText('公开快照标题'))
    await user.type(screen.getByLabelText('公开快照标题'), '可以公开的闭环原则')
    await user.type(screen.getByLabelText('公开摘录'), '每个结果都应该能回到它的来源。')
    await user.click(screen.getByRole('button', { name: '生成快照预览' }))
    expect(repository.getSnapshot().snapshots[0].visibility).toBe('private')
    await user.click(screen.getByRole('button', { name: '公开这份快照' }))
    expect(repository.getSnapshot().snapshots[0].visibility).toBe('public')
    await user.click(screen.getByRole('button', { name: '撤回公开' }))
    expect(repository.getSnapshot().snapshots[0].visibility).toBe('private')

    const state = repository.getSnapshot()
    expect(state.records[0].planId).toBe(state.plans[0].id)
    expect(state.reviews[0].evidence.map((item) => item.sourceId)).toEqual([state.plans[0].id, state.records[0].id])
    expect(state.knowledge[0].source).toEqual({ type: 'review', id: state.reviews[0].id })
    expect(state.snapshots[0].source).toEqual({ type: 'knowledge', id: state.knowledge[0].id })
  })
})
