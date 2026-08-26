import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { goalsApi } from '../../api/goalsApi'
import { habitsApi } from '../../api/habitsApi'
import { knowledgeApi } from '../../api/knowledgeApi'
import { lifeCatalogApi } from '../../api/lifeCatalogApi'
import { lifeCommerceApi } from '../../api/lifeCommerceApi'
import { lifePlanningApi } from '../../api/lifePlanningApi'
import { lifeRecipesApi } from '../../api/lifeRecipesApi'
import { recordsApi } from '../../api/recordsApi'
import { reviewsApi } from '../../api/reviewsApi'
import { tasksApi } from '../../api/tasksApi'
import {
  QuickCreate,
  quickCreateActions,
  type QuickCreateActions,
  type QuickCreateResult,
  type QuickCreateSubmission,
} from './QuickCreate'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const created: QuickCreateResult = {
  id: 'record-1',
  type: 'record',
  title: '完成搜索验收',
  route: '/app/records?record=record-1',
  undoExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
}

function actions(overrides: Partial<QuickCreateActions> = {}): QuickCreateActions {
  return {
    create: vi.fn(async () => created),
    undo: vi.fn(async () => undefined),
    ...overrides,
  }
}

function Harness({ api = actions(), keys = ['key-1', 'key-2'] }: { api?: QuickCreateActions; keys?: string[] }) {
  const [open, setOpen] = useState(false)
  const nextKey = vi.fn(() => keys.shift() ?? 'key-fallback')
  return <>
    <button type="button" onClick={() => setOpen(true)}>快速记录</button>
    <QuickCreate
      open={open}
      context={{ projectId: 'project-1', date: '2026-08-23' }}
      actions={api}
      createIdempotencyKey={nextKey}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      onOpenResult={vi.fn()}
    />
  </>
}

function ReplacingTriggerHarness() {
  const [open, setOpen] = useState(false)
  const [generation, setGeneration] = useState(0)
  return <>
    <button
      key={generation}
      type="button"
      aria-label="快速记录"
      onClick={() => setOpen(true)}
    >快速记录</button>
    <button type="button" onClick={() => setGeneration((value) => value + 1)}>替换触发器</button>
    <QuickCreate
      open={open}
      context={{}}
      actions={actions()}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      onOpenResult={vi.fn()}
    />
  </>
}

describe('QuickCreate', () => {
  it('opens from the global shortcut, defaults to record and restores the invoking focus on Escape', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '快速记录' })
    trigger.focus()
    await user.keyboard('{Control>}/{/Control}')

    expect(screen.getByRole('dialog', { name: '快速记录' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: '记录类型' })).toHaveValue('record')
    expect(screen.getByLabelText('标题')).toHaveFocus()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('restores focus to the current quick-create trigger when the original trigger was replaced', async () => {
    const user = userEvent.setup()
    render(<ReplacingTriggerHarness />)
    const original = screen.getByRole('button', { name: '快速记录' })
    original.focus()
    await user.keyboard('{Control>}/{/Control}')
    await user.click(screen.getByRole('button', { name: '替换触发器' }))
    expect(original.isConnected).toBe(false)

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.getByRole('button', { name: '快速记录' })).toHaveFocus())
  })

  it('supports explicit type selection, minimal fields, inherited context and expandable advanced fields', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: '快速记录' }))

    expect(screen.getByText('继承项目 project-1')).toBeVisible()
    expect(screen.getByText('日期 2026-08-23')).toBeVisible()
    await user.selectOptions(screen.getByRole('combobox', { name: '记录类型' }), 'task')
    await user.type(screen.getByLabelText('标题'), '完成今天的复盘')
    expect(screen.getByRole('button', { name: '创建任务' })).toBeEnabled()
    expect(screen.queryByLabelText('补充说明')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '展开高级字段' }))
    expect(screen.getByLabelText('补充说明')).toBeVisible()
  })

  it('submits once while pending and reuses one idempotency key for a retry', async () => {
    const user = userEvent.setup()
    const pending = deferred<QuickCreateResult>()
    const create = vi.fn<QuickCreateActions['create']>()
      .mockRejectedValueOnce(new Error('暂时失败'))
      .mockImplementationOnce(() => pending.promise)
    const api = actions({ create })
    render(<Harness api={api} />)
    await user.click(screen.getByRole('button', { name: '快速记录' }))
    await user.type(screen.getByLabelText('标题'), '完成搜索验收')

    await user.click(screen.getByRole('button', { name: '创建记录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时失败')
    await user.click(screen.getByRole('button', { name: '重试创建' }))
    expect(screen.getByRole('button', { name: '正在创建' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '正在创建' }))
    expect(create).toHaveBeenCalledTimes(2)
    expect((create.mock.calls[0][0] as QuickCreateSubmission).idempotencyKey).toBe('key-1')
    expect((create.mock.calls[1][0] as QuickCreateSubmission).idempotencyKey).toBe('key-1')

    pending.resolve(created)
    expect(await screen.findByRole('status', { name: '创建成功' })).toHaveTextContent('完成搜索验收')
  })

  it('offers stay, open, undo and create-another success actions with a fresh next key', async () => {
    const user = userEvent.setup()
    const create = vi.fn(async (submission: QuickCreateSubmission) => ({ ...created, title: submission.title }))
    const undo = vi.fn(async () => undefined)
    const onOpenResult = vi.fn()
    const keys = ['key-1', 'key-2']
    function SuccessHarness() {
      const [open, setOpen] = useState(true)
      return <QuickCreate
        open={open}
        context={{ sourceType: 'record', sourceId: 'source-record' }}
        actions={{ create, undo }}
        createIdempotencyKey={() => keys.shift() ?? 'key-3'}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        onOpenResult={onOpenResult}
      />
    }
    render(<SuccessHarness />)
    await user.type(screen.getByLabelText('标题'), '完成搜索验收')
    await user.click(screen.getByRole('button', { name: '创建记录' }))

    expect(await screen.findByText(/可在.*前撤销/)).toBeVisible()
    expect(screen.getByRole('button', { name: '留在这里' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(undo).toHaveBeenCalledWith(created, 'key-1')
    expect(await screen.findByText('已撤销')).toBeVisible()

    await user.click(screen.getByRole('button', { name: '再建一个' }))
    expect(screen.getByLabelText('标题')).toHaveValue('')
    await user.type(screen.getByLabelText('标题'), '第二条记录')
    await user.click(screen.getByRole('button', { name: '创建记录' }))
    expect(create.mock.calls[1][0].idempotencyKey).toBe('key-2')
    await user.click(await screen.findByRole('button', { name: '打开记录' }))
    expect(onOpenResult).toHaveBeenCalledWith('/app/records?record=record-1')
  })

  it('does not offer undo after the result undo window has expired', async () => {
    const user = userEvent.setup()
    const expired = { ...created, undoExpiresAt: '2000-01-01T00:00:00.000Z' }
    render(<QuickCreate
      open
      context={{}}
      actions={actions({ create: vi.fn(async () => expired) })}
      createIdempotencyKey={() => 'expired-key'}
      onOpen={vi.fn()}
      onClose={vi.fn()}
      onOpenResult={vi.fn()}
    />)
    await user.type(screen.getByLabelText('标题'), '过期撤销窗口')
    await user.click(screen.getByRole('button', { name: '创建记录' }))

    expect(await screen.findByRole('status', { name: '创建成功' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '撤销' })).not.toBeInTheDocument()
    expect(screen.queryByText(/前撤销/)).not.toBeInTheDocument()
  })
})

describe('quickCreateActions', () => {
  it('routes every supported create type through its domain API with the submission idempotency key', async () => {
    const task = vi.spyOn(tasksApi, 'create').mockResolvedValue({ id: 'task-1', version: 1 } as never)
    const record = vi.spyOn(recordsApi, 'create').mockResolvedValue({ id: 'record-1', version: 1 } as never)
    const knowledge = vi.spyOn(knowledgeApi, 'create').mockResolvedValue({ id: 'knowledge-1', version: 1 } as never)
    const goal = vi.spyOn(goalsApi, 'create').mockResolvedValue({ id: 'goal-1', version: 1 } as never)
    const project = vi.spyOn(goalsApi, 'createProject').mockResolvedValue({ id: 'project-1', version: 1 } as never)
    const habit = vi.spyOn(habitsApi, 'create').mockResolvedValue({ id: 'habit-1', version: 1 } as never)
    const review = vi.spyOn(reviewsApi, 'create').mockResolvedValue({ id: 'review-1', version: 1 } as never)
    const catalog = vi.spyOn(lifeCatalogApi, 'create').mockImplementation(async (input) => ({ id: `${input.kind}-1`, version: 1 }) as never)
    const recipe = vi.spyOn(lifeRecipesApi, 'create').mockResolvedValue({ id: 'recipe-1', version: 1 } as never)
    const fitness = vi.spyOn(lifePlanningApi, 'createFitness').mockResolvedValue({ id: 'fitness-1', version: 1 } as never)
    const shopping = vi.spyOn(lifeCommerceApi, 'createShoppingItem').mockResolvedValue({ id: 'shopping-1', version: 1 } as never)
    const dayPlan = vi.spyOn(lifePlanningApi, 'createDayPlan').mockResolvedValue({ id: 'day-plan-1', version: 1 } as never)
    const completion = vi.spyOn(lifePlanningApi, 'createCompletion').mockResolvedValue({ id: 'completion-1', version: 1 } as never)
    const base = { title: '一条快速记录', details: '来自快速记录浮层', idempotencyKey: 'quick-key' }
    const create = (type: QuickCreateSubmission['type'], context: QuickCreateSubmission['context'] = {}) => (
      quickCreateActions.create({ ...base, type, context })
    )

    await create('task', { goalId: 'goal-ctx', projectId: 'project-ctx', date: '2026-08-23' })
    await create('record', { projectId: 'project-ctx', sourceType: 'record', sourceId: 'record-source' })
    await create('knowledge', { sourceType: 'record', sourceId: 'record-source' })
    await create('goal')
    await create('project', { goalId: 'goal-ctx' })
    await create('habit', { goalId: 'goal-ctx', date: '2026-08-23' })
    await create('review', { date: '2026-08-23' })
    await create('life-item')
    await create('medicine')
    await create('household-item')
    await create('recipe')
    await create('fitness', { date: '2026-08-23' })
    await create('shopping-item', { sourceType: 'life-item', sourceId: 'item-ctx', date: '2026-08-24' })
    await create('day-plan', { date: '2026-08-23' })
    await create('actual-meal', { sourceType: 'day-plan-item', sourceId: 'plan-item-ctx', date: '2026-08-23' })

    expect(task).toHaveBeenCalledWith(expect.objectContaining({ goalId: 'goal-ctx', projectId: 'project-ctx' }), 'quick-key')
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ links: [{ type: 'project', id: 'project-ctx' }] }), 'quick-key')
    expect(knowledge).toHaveBeenCalledWith(expect.objectContaining({ sourceLinks: [{ type: 'record', id: 'record-source' }] }), undefined, 'quick-key')
    expect(goal).toHaveBeenCalledWith(expect.any(Object), 'quick-key')
    expect(project).toHaveBeenCalledWith('goal-ctx', expect.any(Object), 'quick-key')
    expect(habit).toHaveBeenCalledWith(expect.any(Object), 'quick-key')
    expect(review).toHaveBeenCalledWith(expect.any(Object), 'quick-key')
    expect(catalog).toHaveBeenCalledTimes(3)
    expect(catalog.mock.calls.map(([input]) => input.kind)).toEqual(['ingredient', 'medicine', 'household_consumable'])
    expect(catalog.mock.calls.every(([, key]) => key === 'quick-key')).toBe(true)
    expect(recipe).toHaveBeenCalledWith(expect.any(Object), 'quick-key')
    expect(fitness).toHaveBeenCalledWith(expect.any(Object), 'quick-key')
    expect(shopping).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'item-ctx', neededOn: '2026-08-24' }), 'quick-key')
    expect(dayPlan).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-08-23' }), 'quick-key')
    expect(completion).toHaveBeenCalledWith(expect.objectContaining({ dayPlanItemId: 'plan-item-ctx' }), 'quick-key')
  })
})
