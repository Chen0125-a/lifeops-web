import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter, type RouteObject, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appRoutes } from '../../App'
import { HttpError } from '../../api/httpClient'
import type { Review, ReviewActionTarget } from '../../domain/reviews'

const { legacyCreateReview, reviewsApiMock } = vi.hoisted(() => ({
  legacyCreateReview: vi.fn(),
  reviewsApiMock: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    restore: vi.fn(),
    refreshEvidence: vi.fn(),
    convertAction: vi.fn(),
  },
}))

vi.mock('../../api/reviewsApi', () => ({ reviewsApi: reviewsApiMock }))
vi.mock('../../state/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ csrfToken: 'csrf-reviews', status: 'authenticated', user: { displayName: 'Review Tester' } }),
}))
vi.mock('../../state/LifeDataContext', () => ({
  LifeDataProvider: ({ children }: { children: ReactNode }) => children,
  useLifeRepository: () => ({ createReview: legacyCreateReview }),
  useLifeState: () => ({ plans: [], records: [], reviews: [] }),
}))

const actions: Review['actions'] = [
  ['action-task', '补齐回顾浏览器门禁'],
  ['action-goal', '把季度目标进度更新为真实值'],
  ['action-knowledge', '整理回顾工作流知识'],
  ['action-public', '准备一份可公开的复盘草稿'],
].map(([id, text]) => ({
  id: String(id), text: String(text), status: 'pending', convertedTarget: null, convertedId: null,
  version: 1, createdAt: '2026-08-15T10:00:00.000Z', updatedAt: '2026-08-15T10:00:00.000Z',
}))

function review(id: string, type: Review['type'], patch: Partial<Review> = {}): Review {
  return {
    id,
    type,
    period: type === 'weekly'
      ? { from: '2026-08-04', to: '2026-08-10' }
      : type === 'monthly'
        ? { from: '2026-08-01', to: '2026-08-31' }
        : { from: '2026-07-15', to: '2026-08-15' },
    status: 'draft',
    achievements: ['完成记录页真实闭环'],
    problems: ['移动端证据层切换仍需关注'],
    causes: ['小屏信息密度需要显式分层'],
    insights: ['证据与叙事分栏能减少事实漂移'],
    nextChanges: ['先补齐浏览器门禁再推进知识页'],
    evidence: {
      period: { from: '2026-08-04', to: '2026-08-10' },
      goals: { active: 2, completed: 1 },
      projects: { active: 3, completed: 1 },
      tasks: { total: 8, completed: 6, skipped: 1, cancelled: 1 },
      habits: { entries: 14, done: 10, partial: 2, intentionalSkips: 2 },
      records: { total: 3, ids: ['record-a', 'record-b', 'record-c'] },
      priorCommitments: [{ reviewId: 'review-prior', text: '修复响应式裁切', status: 'pending' }],
      hasFacts: true,
    },
    actions,
    version: 4,
    createdAt: '2026-08-10T10:00:00.000Z',
    updatedAt: '2026-08-15T10:00:00.000Z',
    deletedAt: null,
    ...patch,
  }
}

const weekly = review('review-weekly', 'weekly')
const monthly = review('review-monthly', 'monthly')
const custom = review('review-custom', 'custom')

function privateReviewRoute() {
  const root = appRoutes[0]
  const privateRoute = root.children?.find((route) => route.path === '/app')
  const route = privateRoute?.children?.find((candidate) => candidate.path === 'reviews')
  if (!route?.element) throw new Error('Missing /app/reviews route element')
  return route as RouteObject & { element: ReactNode }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="review-location">{`${location.pathname}${location.search}`}</output>
}

function renderReviews(entry = '/app/reviews?review=review-weekly&period=weekly') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>{privateReviewRoute().element}<LocationProbe /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ReviewsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reviewsApiMock.list.mockResolvedValue([weekly, monthly, custom])
    reviewsApiMock.get.mockImplementation(async (id: string) => [weekly, monthly, custom].find((item) => item.id === id))
    reviewsApiMock.create.mockImplementation(async (input: Partial<Review>) => review('review-created', input.type ?? 'weekly', input))
    reviewsApiMock.update.mockImplementation(async (id: string, input: Partial<Review> & { version: number }) => ({
      ...[weekly, monthly, custom].find((item) => item.id === id)!, ...input,
      version: input.version + 1, updatedAt: '2026-08-15T10:08:00.000Z',
    }))
    reviewsApiMock.remove.mockResolvedValue(undefined)
    reviewsApiMock.restore.mockImplementation(async (id: string, version: number) => ({
      ...weekly, id, deletedAt: null, version: version + 1,
    }))
    reviewsApiMock.refreshEvidence.mockImplementation(async (id: string, version: number) => ({
      ...weekly, id, version: version + 1,
    }))
    reviewsApiMock.convertAction.mockImplementation(async (
      reviewId: string,
      actionId: string,
      input: { target: ReviewActionTarget },
    ) => {
      const current = actions.find((action) => action.id === actionId)!
      const convertedId = `${input.target}-result`
      const converted = { ...current, status: 'converted' as const, convertedTarget: input.target, convertedId, version: 2 }
      return {
        review: { ...weekly, id: reviewId, actions: actions.map((action) => action.id === actionId ? converted : action), version: 5 },
        action: converted,
        target: { type: input.target, id: convertedId, title: current.text },
      }
    })
  })

  it('keeps a failed review query distinct from a truthful empty result', async () => {
    reviewsApiMock.list.mockRejectedValue(new HttpError('FORBIDDEN', '你没有权限读取这些回顾', 403))
    renderReviews('/app/reviews')

    expect(await screen.findByRole('alert')).toHaveTextContent('你没有权限读取这些回顾')
    expect(screen.queryByText('还没有回顾草稿')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '创建第一份回顾' })).not.toBeInTheDocument()
  })

  it('renders the approved 3/6/3 evidence, narrative and action hierarchy from deterministic facts', async () => {
    renderReviews()

    expect(await screen.findByRole('heading', { level: 1, name: '回顾' })).toBeVisible()
    const evidence = await screen.findByRole('region', { name: '证据目录' })
    const editor = screen.getByRole('region', { name: '叙事回顾' })
    const actionRail = screen.getByRole('region', { name: '洞察与行动' })
    expect(evidence).toHaveAttribute('data-grid-span', '3')
    expect(editor).toHaveAttribute('data-grid-span', '6')
    expect(actionRail).toHaveAttribute('data-grid-span', '3')

    expect(within(evidence).getByRole('group', { name: '目标证据' })).toHaveTextContent('2 个进行中')
    expect(within(evidence).getByRole('group', { name: '目标证据' })).toHaveTextContent('1 个完成')
    expect(within(evidence).getByRole('group', { name: '项目证据' })).toHaveTextContent('3 个进行中')
    expect(within(evidence).getByRole('group', { name: '任务证据' })).toHaveTextContent('6 / 8 完成')
    expect(within(evidence).getByRole('group', { name: '习惯证据' })).toHaveTextContent('10 完成 · 2 部分 · 2 主动跳过')
    expect(within(evidence).getByRole('group', { name: '记录证据' })).toHaveTextContent('3 条记录')
    expect(within(evidence).getByRole('group', { name: '上次承诺' })).toHaveTextContent('修复响应式裁切')

    for (const label of ['成果', '问题', '原因', '洞察', '下一步变化']) {
      expect(within(editor).getByLabelText(label)).toBeVisible()
    }
    expect(within(editor).getByLabelText('成果')).toHaveValue('完成记录页真实闭环')
    expect(within(editor).getByLabelText('问题')).toHaveValue('移动端证据层切换仍需关注')
    expect(within(editor).getByText('尚未修改')).toBeVisible()
  })

  it('switches weekly, monthly and custom modes through URL state and exposes exact custom dates', async () => {
    const user = userEvent.setup()
    renderReviews()

    await waitFor(() => expect(screen.getByRole('button', { name: '周回顾' })).toHaveAttribute('aria-pressed', 'true'))
    await user.click(screen.getByRole('button', { name: '月回顾' }))
    expect(screen.getByRole('button', { name: '月回顾' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('review-location')).toHaveTextContent('/app/reviews?review=review-monthly&period=monthly')
    expect(screen.getByLabelText('周期开始')).toHaveValue('2026-08-01')
    expect(screen.getByLabelText('周期结束')).toHaveValue('2026-08-31')

    await user.click(screen.getByRole('button', { name: '自定义周期' }))
    expect(screen.getByRole('button', { name: '自定义周期' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('周期开始')).toHaveValue('2026-07-15')
    expect(screen.getByLabelText('周期结束')).toHaveValue('2026-08-15')
    expect(screen.getByTestId('review-location')).toHaveTextContent('/app/reviews?review=review-custom&period=custom')
  })

  it('autosaves user-authored narrative with a visible state while keeping evidence factual', async () => {
    const user = userEvent.setup()
    renderReviews()
    const evidence = await screen.findByRole('region', { name: '证据目录' })
    const field = screen.getByLabelText('成果')

    await user.clear(field)
    await user.type(field, '完成 P3-T5 全量门禁')
    expect(screen.getByText('等待保存')).toBeVisible()
    await waitFor(() => expect(reviewsApiMock.update).toHaveBeenCalledWith('review-weekly', expect.objectContaining({
      achievements: ['完成 P3-T5 全量门禁'],
      version: 4,
    }), 'csrf-reviews'), { timeout: 2_000 })
    expect(evidence).toHaveTextContent('6 / 8 完成')
    expect(evidence).not.toHaveTextContent('完成 P3-T5 全量门禁')
  })

  it('keeps evidence visible and offers explicit recovery after a 409 autosave conflict', async () => {
    const user = userEvent.setup()
    reviewsApiMock.update.mockRejectedValueOnce(new HttpError('VERSION_CONFLICT', '回顾已被更新', 409))
    renderReviews()

    await user.type(await screen.findByLabelText('洞察'), '；需要合并远端变化')
    expect(await screen.findByRole('alert', { name: '回顾保存冲突' }, { timeout: 2_000 })).toHaveTextContent('回顾已被更新')
    expect(screen.getByRole('region', { name: '证据目录' })).toHaveTextContent('6 / 8 完成')
    expect(screen.getByRole('button', { name: '采用服务器版本' })).toBeVisible()
    expect(screen.getByRole('button', { name: '保留本地草稿' })).toBeVisible()
  })

  it('refreshes facts and exposes archive, delete and same-identity restore lifecycle actions', async () => {
    const user = userEvent.setup()
    renderReviews()
    await screen.findByRole('region', { name: '证据目录' })

    await user.click(screen.getByRole('button', { name: '刷新证据' }))
    expect(reviewsApiMock.refreshEvidence).toHaveBeenLastCalledWith('review-weekly', 4, 'csrf-reviews')
    await user.click(screen.getByRole('button', { name: '归档回顾' }))
    expect(reviewsApiMock.update).toHaveBeenLastCalledWith('review-weekly', { status: 'archived', version: 5 }, 'csrf-reviews')
    await user.click(screen.getByRole('button', { name: '删除回顾' }))
    expect(reviewsApiMock.remove).toHaveBeenLastCalledWith('review-weekly', 6, 'csrf-reviews')
    await user.click(await screen.findByRole('button', { name: '恢复刚删除的回顾' }))
    expect(reviewsApiMock.restore).toHaveBeenLastCalledWith('review-weekly', 7, 'csrf-reviews')
  })

  it('provides the ordered mobile evidence, writing and action layers', async () => {
    const user = userEvent.setup()
    renderReviews()
    const workspace = await screen.findByRole('region', { name: '回顾工作区' })

    expect(screen.getByRole('button', { name: '证据 1/3' })).toHaveAttribute('aria-current', 'step')
    await user.click(screen.getByRole('button', { name: '书写 2/3' }))
    expect(workspace).toHaveAttribute('data-mobile-step', 'writing')
    expect(screen.getByRole('button', { name: '返回证据' })).toBeVisible()
    expect(screen.getByRole('button', { name: '继续到行动' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '继续到行动' }))
    expect(workspace).toHaveAttribute('data-mobile-step', 'actions')
  })

  it.each([
    ['task', '任务'],
    ['goal-update', '目标更新'],
    ['knowledge', '知识草稿'],
    ['public-draft', '公开草稿'],
  ] as const)('converts one action to %s through the explicit destination control', async (target, label) => {
    const user = userEvent.setup()
    renderReviews()
    const card = await screen.findByRole('article', { name: '行动 · 补齐回顾浏览器门禁' })

    await user.selectOptions(within(card).getByLabelText('转换去向'), target)
    await user.click(within(card).getByRole('button', { name: '转换行动' }))
    expect(reviewsApiMock.convertAction).toHaveBeenLastCalledWith(
      'review-weekly', 'action-task', { target }, expect.stringMatching(/^review-action:/), 'csrf-reviews',
    )
    expect(await within(card).findByText(`已转为${label}`)).toBeVisible()
    expect(within(card).getByRole('link', { name: '打开转换结果' })).toHaveAttribute('href')
  })

  it('shows a converted destination and never offers a second target', async () => {
    const converted = {
      ...actions[0]!, status: 'converted' as const, convertedTarget: 'task' as const, convertedId: 'task-existing', version: 2,
    }
    reviewsApiMock.list.mockResolvedValue([{ ...weekly, actions: [converted] }])
    renderReviews()
    const card = await screen.findByRole('article', { name: '行动 · 补齐回顾浏览器门禁' })

    expect(within(card).getByText('已转为任务')).toBeVisible()
    expect(within(card).getByRole('link', { name: '打开转换结果' })).toHaveAttribute('href', '/app/schedule?task=task-existing')
    expect(within(card).queryByLabelText('转换去向')).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: '转换行动' })).not.toBeInTheDocument()
  })
})
