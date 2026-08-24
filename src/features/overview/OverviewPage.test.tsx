import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { OverviewModel } from './overviewModel'
import { OverviewPage } from './OverviewPage'

const model: OverviewModel = {
  isEmpty: false,
  statusStrip: { dateLabel: '8月12日 星期三', greeting: '下午好', week: { completed: 4, total: 7 }, platformHealth: 'unknown' },
  todayTimeline: [{ id: 'task-1', title: '完成私人总览', at: '10:30', status: 'doing' }],
  topGoals: [{ id: 'goal-1', title: '交付 LifeOps', priority: 1, progress: 62 }],
  activeProjects: [{ id: 'project-1', title: '私人工作台', goalId: 'goal-1', progress: 48 }],
  habitWeek: {
    days: ['10', '11', '12', '13', '14', '15', '16'].map((day) => ({ date: `2026-08-${day}`, label: day })),
    rows: [{ id: 'habit-1', title: '晚间回顾', cells: ['10', '11', '12', '13', '14', '15', '16'].map((day, index) => ({ date: `2026-08-${day}`, status: index < 2 ? 'done' : 'pending' })) }],
    totals: { done: 2, partial: 0, intentionalSkip: 0, missed: 0, pending: 5 },
  },
  trends: { completedTasks: 4, habitCompletions: 2, recordCount: 3 },
  recentRecords: [{ id: 'record-1', title: '一次清楚的推进', body: '先完成真实行为 RED。', occurredAt: '2026-08-12T09:00:00.000Z', tags: [], pinned: false, archivedAt: null, links: [], mediaIds: [], coverMediaId: null, version: 1, createdAt: '2026-08-12T09:00:00.000Z', updatedAt: '2026-08-12T09:00:00.000Z', deletedAt: null }],
  priorInsight: { reviewId: 'review-1', text: '给重要工作保留连续时间。' },
  resurfacedKnowledge: [{ id: 'knowledge-1', source: { type: 'review', id: 'review-1' }, title: '连续工作的条件', body: '减少切换。', tags: [], createdAt: '2026-08-01T00:00:00.000Z', reviewOn: '2026-08-12' }],
}

function renderPage(props: Partial<React.ComponentProps<typeof OverviewPage>> = {}) {
  return render(<MemoryRouter><OverviewPage model={model} {...props} /></MemoryRouter>)
}

describe('OverviewPage', () => {
  it('renders one continuous 12-column overview with a 7/5 primary composition', () => {
    const { container } = renderPage()
    expect(screen.getByRole('heading', { name: '总览', level: 1 })).toBeInTheDocument()
    expect(screen.getByTestId('overview-status-strip')).toHaveAttribute('data-grid-span', '12')
    expect(screen.getByTestId('overview-primary')).toHaveAttribute('data-layout', '7/5')
    expect(screen.getByRole('region', { name: '今天时间线' })).toHaveAttribute('data-grid-span', '7')
    expect(screen.getByRole('region', { name: '当前重点' })).toHaveAttribute('data-grid-span', '5')
    for (const name of ['习惯七日节奏', '本周趋势', '最近记录', '上次回顾', '重新浮现的知识']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
    expect(container.querySelectorAll('[data-overview-card]')).toHaveLength(0)
    expect(screen.getByText('状态未验证')).toBeInTheDocument()
  })

  it('localizes one component failure without replacing healthy overview regions', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    renderPage({ componentErrors: { goals: '当前重点暂时无法加载。' }, onRetry: retry })

    expect(within(screen.getByRole('region', { name: '当前重点' })).getByRole('alert')).toHaveTextContent('当前重点暂时无法加载。')
    expect(screen.getByRole('region', { name: '今天时间线' })).toHaveTextContent('完成私人总览')
    await user.click(screen.getByRole('button', { name: '重试当前重点' }))
    expect(retry).toHaveBeenCalledWith('goals')
  })

  it('offers direct next actions in every empty overview band', () => {
    const emptyModel: OverviewModel = {
      ...model,
      isEmpty: true,
      statusStrip: { ...model.statusStrip, week: { completed: 0, total: 0 } },
      todayTimeline: [], topGoals: [], activeProjects: [],
      habitWeek: { ...model.habitWeek, rows: [], totals: { done: 0, partial: 0, intentionalSkip: 0, missed: 0, pending: 0 } },
      trends: { completedTasks: 0, habitCompletions: 0, recordCount: 0 },
      recentRecords: [], priorInsight: null, resurfacedKnowledge: [],
    }
    render(<MemoryRouter><OverviewPage model={emptyModel} /></MemoryRouter>)

    const actions = [
      ['创建今天的任务', '/app/schedule?create=task'],
      ['添加优先目标', '/app/goals?create=goal'],
      ['记录一次习惯', '/app/habits'],
      ['写下今天', '/app/records?create=record'],
      ['开始本周回顾', '/app/reviews?create=weekly'],
      ['添加知识', '/app/knowledge?create=note'],
    ] as const
    actions.forEach(([name, href]) => expect(screen.getByRole('link', { name })).toHaveAttribute('href', href))
  })
})
