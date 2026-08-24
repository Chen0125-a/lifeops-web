import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { searchApi } from '../../api/searchApi'
import { createMemoryStorage, LifeRepository } from '../../domain/lifeRepository'
import { LifeDataProvider } from '../../state/LifeDataContext'
import { PrivateAppLayout } from './PrivateAppLayout'

vi.mock('../../api/searchApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../api/searchApi')>(),
  searchApi: { search: vi.fn() },
}))

beforeEach(() => {
  vi.mocked(searchApi.search).mockReset()
  vi.mocked(searchApi.search).mockResolvedValue({ items: [{
    type: 'task', id: 'plan-1', title: '深度工作', excerpt: '等待完成', context: '日程',
    updatedAt: '2026-08-23T00:00:00.000Z', route: '/app/plans',
  }] })
})

const expectedNavigation = [
  ['总览', '/app/overview'],
  ['目标与项目', '/app/goals'],
  ['日程', '/app/schedule'],
  ['习惯', '/app/habits'],
  ['记录', '/app/records'],
  ['回顾', '/app/reviews'],
  ['知识', '/app/knowledge'],
  ['生活', '/app/life'],
  ['发布', '/app/publish'],
  ['平台', '/app/platform'],
] as const

function ScheduleFixture() {
  const [title, setTitle] = useState('')
  return <><h1 tabIndex={-1}>日程</h1><label htmlFor="plan-title">计划标题</label><input id="plan-title" value={title} onChange={(event) => setTitle(event.target.value)} /></>
}

function Fixture({ path = '/app/overview' }: { path?: string }) {
  const repository = new LifeRepository({ storage: createMemoryStorage() })
  return (
    <LifeDataProvider repository={repository}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app" element={<PrivateAppLayout />}>
            <Route path="overview" element={<h1 tabIndex={-1}>总览</h1>} />
            <Route path="goals" element={<h1 tabIndex={-1}>目标与项目</h1>} />
            <Route path="schedule" element={<ScheduleFixture />} />
            <Route path="platform" element={<h1 tabIndex={-1}>平台</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </LifeDataProvider>
  )
}

describe('PrivateAppLayout', () => {
  it('renders the exact approved private navigation and utility controls', async () => {
    const user = userEvent.setup()
    const { container } = render(<Fixture />)
    const navigation = screen.getByRole('navigation', { name: '私人空间导航' })
    const links = within(navigation).getAllByRole('link')

    expect(navigation).toHaveTextContent('总览目标与项目日程习惯记录回顾知识生活发布平台')
    expect(links).toHaveLength(expectedNavigation.length)
    expectedNavigation.forEach(([label, href], index) => {
      expect(links[index]).toHaveAccessibleName(label)
      expect(links[index]).toHaveAttribute('href', href)
    })
    expect(screen.getByRole('button', { name: '打开全局搜索' })).toBeInTheDocument()
    const quickCreate = screen.getByRole('button', { name: '快速记录' })
    expect(quickCreate).toBeInTheDocument()
    await user.click(quickCreate)
    expect(screen.getByRole('dialog', { name: '快速记录' })).toBeVisible()
    expect(screen.getByRole('button', { name: '打开账户与设置' })).toBeInTheDocument()
    expect(container.querySelector('[data-private-shell]')).toHaveAttribute('data-workspace-theme', 'daylight')
  })

  it('keeps the current primary route visible inside the narrow horizontal navigation', () => {
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })

    render(<Fixture path="/app/platform" />)

    expect(screen.getByRole('link', { name: '平台' })).toHaveAttribute('aria-current', 'page')
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'auto', left: expect.any(Number) })
    window.dispatchEvent(new Event('resize'))
    expect(scrollTo).toHaveBeenCalledTimes(2)
  })

  it('keeps one stable shell, avoids universe markup and moves focus after route navigation', async () => {
    const user = userEvent.setup()
    const startViewTransition = vi.fn()
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })

    try {
      const { container } = render(<Fixture />)
      const header = screen.getByRole('banner')
      expect(container.querySelector('.private-orrery, [data-private-sidebar], [class*="universe"]')).not.toBeInTheDocument()
      expect(container).not.toHaveTextContent(/星球|银河|轨道/)

      await user.click(screen.getByRole('link', { name: '目标与项目' }))

      expect(screen.getByRole('banner')).toBe(header)
      await waitFor(() => expect(screen.getByRole('heading', { name: '目标与项目', level: 1 })).toHaveFocus())
      expect(screen.getByRole('status', { name: '页面位置' })).toHaveTextContent('已进入 目标与项目')
      expect(startViewTransition).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(document, 'startViewTransition')
    }
  })

  it('freezes each keyed outlet so an exiting panel cannot duplicate the current form', async () => {
    const user = userEvent.setup()
    const { container } = render(<Fixture />)

    await user.click(screen.getByRole('link', { name: '日程' }))
    const input = screen.getByLabelText('计划标题')
    expect(container.querySelectorAll('#plan-title')).toHaveLength(1)
    await user.type(input, '完成 LifeOps 闭环验收')
    expect(input).toHaveValue('完成 LifeOps 闭环验收')
  })

  it('keeps global-search navigation inside the Motion route stage', async () => {
    const user = userEvent.setup()
    const startViewTransition = vi.fn((callback: () => void | Promise<void>) => {
      const updateCallbackDone = Promise.resolve().then(callback)
      return {
      finished: updateCallbackDone,
      ready: Promise.resolve(),
      skipTransition: vi.fn(),
      types: new Set<string>(),
      updateCallbackDone,
    }})
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })

    try {
      const repository = new LifeRepository({ storage: createMemoryStorage() })
      repository.createPlan({ title: '深度工作' })
      const router = createMemoryRouter([{
        path: '/app',
        element: <PrivateAppLayout />,
        children: [
          { path: 'overview', element: <h1 tabIndex={-1}>总览</h1> },
          { path: 'plans', element: <h1 tabIndex={-1}>日程</h1> },
        ],
      }], { initialEntries: ['/app/overview'] })
      render(<LifeDataProvider repository={repository}><RouterProvider router={router} /></LifeDataProvider>)
      await user.click(screen.getByRole('button', { name: '打开全局搜索' }))
      await user.type(screen.getByRole('searchbox', { name: '搜索 LifeOps' }), '深度')
      await user.click(await screen.findByRole('option', { name: '任务 深度工作' }))
      expect(startViewTransition).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(document, 'startViewTransition')
    }
  })
})
