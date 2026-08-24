import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { searchApi, type SearchResult } from '../../api/searchApi'
import { CommandCenter } from './CommandCenter'

vi.mock('../../api/searchApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../api/searchApi')>(),
  searchApi: { search: vi.fn() },
}))

const search = vi.mocked(searchApi.search)
const workResult: SearchResult = {
  type: 'task', id: 'task-1', title: '平台验收', excerpt: '关闭 P5', context: '项目 · LifeOps',
  updatedAt: '2026-08-23T00:00:00.000Z', route: '/app/schedule?task=task-1',
}
const lifeResult: SearchResult = {
  type: 'recipe', id: 'recipe-1', title: '恢复餐', excerpt: '鸡胸肉 西兰花', context: '2 人份',
  updatedAt: '2026-08-22T00:00:00.000Z', route: '/app/life/recipes?recipe=recipe-1',
}

function Harness({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  return <>
    <button type="button" onClick={() => setOpen(true)}>打开搜索</button>
    <CommandCenter open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} />
    <Routes>
      <Route path="/" element={<output role="status" aria-label="当前位置">首页</output>} />
      <Route path="/app/schedule" element={<output role="status" aria-label="当前位置">日程任务</output>} />
      <Route path="/app/life/recipes" element={<output role="status" aria-label="当前位置">食谱详情</output>} />
    </Routes>
  </>
}

const renderHarness = (initiallyOpen = false) => render(<MemoryRouter><Harness initiallyOpen={initiallyOpen} /></MemoryRouter>)

describe('CommandCenter', () => {
  beforeEach(() => {
    search.mockReset()
    search.mockResolvedValue({ items: [] })
    window.sessionStorage.clear()
  })

  it('opens from Ctrl/Cmd+K and focuses the searchbox', async () => {
    renderHarness()

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    expect(await screen.findByRole('dialog', { name: '全局搜索' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('searchbox', { name: '搜索 LifeOps' })).toHaveFocus())
  })

  it('shows recent destinations before searching and groups remote results by domain', async () => {
    window.sessionStorage.setItem('lifeops.search.recent', JSON.stringify([lifeResult]))
    search.mockResolvedValue({ items: [workResult, lifeResult] })
    renderHarness(true)

    expect(screen.getByRole('heading', { name: '最近访问' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /食谱 恢复餐/ })).toBeInTheDocument()

    await userEvent.setup().type(screen.getByRole('searchbox', { name: '搜索 LifeOps' }), '平台')

    await waitFor(() => expect(search).toHaveBeenCalledWith({ query: '平台', limit: 50 }, expect.any(AbortSignal)))
    const workGroup = await screen.findByRole('group', { name: '工作推进' })
    const lifeGroup = screen.getByRole('group', { name: '生活管理' })
    expect(within(workGroup).getByRole('option', { name: /任务 平台验收/ })).toBeInTheDocument()
    expect(within(lifeGroup).getByRole('option', { name: /食谱 恢复餐/ })).toBeInTheDocument()
  })

  it('supports arrow-key selection, Enter route navigation and recent persistence', async () => {
    search.mockResolvedValue({ items: [workResult, lifeResult] })
    renderHarness(true)
    const input = screen.getByRole('searchbox', { name: '搜索 LifeOps' })
    await userEvent.setup().type(input, '验收')
    await screen.findByRole('option', { name: /任务 平台验收/ })

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByRole('status', { name: '当前位置' })).toHaveTextContent('食谱详情')
    expect(JSON.parse(window.sessionStorage.getItem('lifeops.search.recent') ?? '[]')).toEqual([lifeResult])
  })

  it('closes on Escape and restores focus to the opener', async () => {
    const user = userEvent.setup()
    renderHarness()
    const opener = screen.getByRole('button', { name: '打开搜索' })
    await user.click(opener)
    await waitFor(() => expect(screen.getByRole('searchbox', { name: '搜索 LifeOps' })).toHaveFocus())

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: '全局搜索' })).not.toBeInTheDocument()
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('aborts superseded requests and ignores a stale response that settles last', async () => {
    let resolveFirst!: (value: { items: SearchResult[] }) => void
    let resolveSecond!: (value: { items: SearchResult[] }) => void
    const first = new Promise<{ items: SearchResult[] }>((resolve) => { resolveFirst = resolve })
    const second = new Promise<{ items: SearchResult[] }>((resolve) => { resolveSecond = resolve })
    search.mockImplementation(({ query }) => query === '平台' ? first : second)
    renderHarness(true)
    const input = screen.getByRole('searchbox', { name: '搜索 LifeOps' })

    fireEvent.change(input, { target: { value: '平台' } })
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    const firstSignal = search.mock.calls[0]![1]
    fireEvent.change(input, { target: { value: '生活' } })
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    expect(firstSignal?.aborted).toBe(true)

    resolveSecond({ items: [lifeResult] })
    expect(await screen.findByRole('option', { name: /食谱 恢复餐/ })).toBeInTheDocument()
    resolveFirst({ items: [workResult] })
    await Promise.resolve()
    expect(screen.queryByRole('option', { name: /任务 平台验收/ })).not.toBeInTheDocument()
  })
})
