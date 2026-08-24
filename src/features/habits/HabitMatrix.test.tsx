import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { habitsApi } from '../../api/habitsApi'

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

import { habit, habits, renderHabitsRoute, windowFixture } from './habits.fixtures'

const api = vi.mocked(habitsApi)

describe('habit interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.list.mockResolvedValue(windowFixture)
    api.createEntry.mockImplementation(async (habitId, entryDate, input) => ({
      id: `entry-${habitId}-${entryDate}`,
      habitId,
      entryDate,
      status: input.status,
      value: input.value ?? null,
      note: input.note ?? '',
      version: 1,
      createdAt: `${entryDate}T12:00:00.000Z`,
      updatedAt: `${entryDate}T12:00:00.000Z`,
      deletedAt: null,
    }))
    api.correctEntry.mockImplementation(async (habitId, entryDate, input) => ({
      id: `entry-${habitId}-${entryDate}`,
      habitId,
      entryDate,
      status: input.status,
      value: input.value ?? null,
      note: input.note ?? '',
      version: input.version + 1,
      createdAt: `${entryDate}T12:00:00.000Z`,
      updatedAt: `${entryDate}T12:00:00.000Z`,
      deletedAt: null,
    }))
    api.update.mockImplementation(async (id, input) => ({
      ...(habits.find((item) => item.id === id) ?? habit(id)),
      ...input,
      version: input.version + 1,
    }))
  })

  it('toggles a boolean habit from its fully labelled today cell', async () => {
    const user = userEvent.setup()
    renderHabitsRoute('/app/habits?habit=habit-meditation')

    await user.click(await screen.findByRole('button', { name: '冥想，8月15日，未完成' }))

    expect(api.createEntry).toHaveBeenCalledWith(
      'habit-meditation',
      '2026-08-15',
      { status: 'done', value: 1, note: '' },
      expect.stringMatching(/^habit-entry:/),
      undefined,
    )
  })

  it.each([
    ['habit-pushups', '俯卧撑', '12', '次', 12],
    ['habit-reading', '阅读', '20', '分钟', 20],
    ['habit-water', '饮水', '500', '毫升', 500],
  ])('records a numeric value and its real unit for %s', async (habitId, title, value, unit, expectedValue) => {
    const user = userEvent.setup()
    renderHabitsRoute(`/app/habits?habit=${habitId}`)

    await user.click(await screen.findByRole('button', { name: `${title}，8月15日，未完成` }))
    const inspector = screen.getByRole('region', { name: '习惯检查器' })
    expect(within(inspector).getByText(unit)).toBeVisible()
    await user.clear(within(inspector).getByLabelText('记录值'))
    await user.type(within(inspector).getByLabelText('记录值'), value)
    await user.click(within(inspector).getByRole('button', { name: '完成并保存' }))

    expect(api.createEntry).toHaveBeenCalledWith(
      habitId,
      '2026-08-15',
      { status: 'done', value: expectedValue, note: '' },
      expect.stringMatching(/^habit-entry:/),
      undefined,
    )
  })

  it('records a partial value and an intentional skip reason as distinct facts', async () => {
    const user = userEvent.setup()
    renderHabitsRoute()

    await user.click(await screen.findByRole('button', { name: '阅读，8月15日，未完成' }))
    const inspector = screen.getByRole('region', { name: '习惯检查器' })
    await user.clear(within(inspector).getByLabelText('记录值'))
    await user.type(within(inspector).getByLabelText('记录值'), '20')
    await user.click(within(inspector).getByRole('button', { name: '部分完成' }))
    expect(api.createEntry).toHaveBeenLastCalledWith(
      'habit-reading', '2026-08-15', { status: 'partial', value: 20, note: '' },
      expect.stringMatching(/^habit-entry:/), undefined,
    )

    await user.click(within(inspector).getByRole('button', { name: '有意跳过' }))
    await user.type(within(inspector).getByLabelText('跳过原因'), '主动恢复')
    await user.click(within(inspector).getByRole('button', { name: '确认有意跳过' }))
    expect(api.correctEntry).toHaveBeenLastCalledWith(
      'habit-reading', '2026-08-15', { status: 'intentional-skip', value: null, note: '主动恢复', version: 1 },
      undefined,
    )
  })

  it('edits, pauses and archives the selected habit with optimistic versions', async () => {
    const user = userEvent.setup()
    renderHabitsRoute()
    const inspector = await screen.findByRole('region', { name: '习惯检查器' })

    await user.click(within(inspector).getByRole('button', { name: '编辑习惯' }))
    const editor = screen.getByRole('dialog', { name: '编辑习惯' })
    await user.clear(within(editor).getByLabelText('标题'))
    await user.type(within(editor).getByLabelText('标题'), '深度阅读')
    await user.click(within(editor).getByRole('button', { name: '保存习惯' }))
    expect(api.update).toHaveBeenCalledWith(
      'habit-reading',
      expect.objectContaining({ title: '深度阅读', version: 2 }),
      undefined,
    )

    await user.click(within(inspector).getByRole('button', { name: '暂停习惯' }))
    expect(api.update).toHaveBeenCalledWith('habit-reading', { status: 'paused', version: 3 }, undefined)
    await user.click(within(inspector).getByRole('button', { name: '归档习惯' }))
    expect(api.update).toHaveBeenCalledWith('habit-reading', { status: 'archived', version: 4 }, undefined)
  })
})
