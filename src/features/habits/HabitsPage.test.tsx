import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHabitsRoute, windowFixture } from './habits.fixtures'

const { habitsApiMock } = vi.hoisted(() => ({
  habitsApiMock: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    createEntry: vi.fn(),
    correctEntry: vi.fn(),
  },
}))

vi.mock('../../api/habitsApi', () => ({ habitsApi: habitsApiMock }))

describe('HabitsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    habitsApiMock.list.mockResolvedValue(windowFixture)
  })

  it('renders today, the full 28-day rhythm and every truthful cell state', async () => {
    renderHabitsRoute()

    expect(await screen.findByRole('heading', { level: 1, name: '习惯' })).toBeVisible()
    const today = await screen.findByRole('region', { name: '今天的习惯' })
    expect(within(today).getByText('阅读')).toBeVisible()
    expect(within(today).getByText('冥想')).toBeVisible()

    const matrix = screen.getByRole('grid', { name: '28 日习惯节奏' })
    expect(matrix).toHaveAttribute('data-days', '28')
    expect(within(matrix).getByRole('button', { name: '阅读，8月9日，已完成 30/30 分钟' })).toBeVisible()
    expect(within(matrix).getByRole('button', { name: '阅读，8月10日，部分完成 20/30 分钟' })).toBeVisible()
    expect(within(matrix).getByRole('button', { name: '阅读，8月11日，有意跳过：生病休息' })).toBeVisible()
    expect(within(matrix).getByRole('button', { name: '阅读，8月12日，未完成' })).toBeVisible()
    expect(within(matrix).getByRole('button', { name: '阅读，8月16日，未来' })).toBeVisible()
    expect(within(matrix).getByRole('button', { name: '力量训练，8月15日，非计划日' })).toBeVisible()
  })

  it('shows deterministic selected-habit statistics and real links without gamification copy', async () => {
    renderHabitsRoute()

    const inspector = await screen.findByRole('region', { name: '习惯检查器' })
    expect(inspector).toHaveTextContent('阅读')
    expect(inspector).toHaveTextContent('完成应做天数')
    expect(inspector).toHaveTextContent(/部分完成总量\s*20 分钟/)
    expect(inspector).toHaveTextContent(/有意跳过\s*1 天/)
    expect(inspector).toHaveTextContent('最近 7 日趋势')
    expect(inspector).toHaveTextContent('目标 goal-reading')
    expect(inspector).toHaveTextContent('项目 project-lifeops')
    expect(document.body).not.toHaveTextContent(/徽章|火焰|金币|badge|flame|coin/i)
    expect(document.body).not.toHaveTextContent('连续失败')
  })
})
