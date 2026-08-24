import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { RouteStage } from './RouteStage'

function Editor() {
  const [value, setValue] = useState('')
  return <><h1 tabIndex={-1}>日程</h1><label htmlFor="route-draft">计划标题</label><input id="route-draft" value={value} onChange={(event) => setValue(event.target.value)} /></>
}

describe('RouteStage', () => {
  it('exposes forward and back direction on one stable route-stage boundary', () => {
    const { container, rerender } = render(
      <RouteStage direction="forward" routeKey="/app/overview"><h1 tabIndex={-1}>总览</h1></RouteStage>,
    )
    const stage = container.querySelector('[data-route-stage]')
    expect(stage).toHaveAttribute('data-route-direction', 'forward')

    rerender(<RouteStage direction="back" routeKey="/app/goals"><h1 tabIndex={-1}>目标与项目</h1></RouteStage>)
    expect(container.querySelector('[data-route-stage]')).toBe(stage)
    expect(stage).toHaveAttribute('data-route-direction', 'back')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('focuses the current route heading after each route-key change', async () => {
    const { rerender } = render(
      <RouteStage direction="forward" routeKey="/app/overview"><h1 tabIndex={-1}>总览</h1></RouteStage>,
    )
    await waitFor(() => expect(screen.getByRole('heading', { name: '总览', level: 1 })).toHaveFocus())

    rerender(<RouteStage direction="forward" routeKey="/app/goals"><h1 tabIndex={-1}>目标与项目</h1></RouteStage>)
    await waitFor(() => expect(screen.getByRole('heading', { name: '目标与项目', level: 1 })).toHaveFocus())
  })

  it('restores the semantic source control only when browser history returns', async () => {
    const overview = <><h1 tabIndex={-1}>总览</h1><a href="/app/schedule?create=task">快速创建</a></>
    const { rerender } = render(
      <RouteStage direction="forward" routeKey="/app/overview">{overview}</RouteStage>,
    )
    const source = screen.getByRole('link', { name: '快速创建' })
    source.focus()

    rerender(<RouteStage direction="forward" routeKey="/app/schedule"><h1 tabIndex={-1}>日程</h1></RouteStage>)
    await waitFor(() => expect(screen.getByRole('heading', { name: '日程', level: 1 })).toHaveFocus())
    rerender(<RouteStage direction="back" routeKey="/app/overview">{overview}</RouteStage>)
    await waitFor(() => expect(screen.getByRole('link', { name: '快速创建' })).toHaveFocus())
  })

  it('preserves the current editor while interrupted prior panels finish exiting', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <RouteStage direction="forward" routeKey="/app"><h1 tabIndex={-1}>私人空间</h1></RouteStage>,
    )
    rerender(<RouteStage direction="forward" routeKey="/app/overview"><h1 tabIndex={-1}>总览</h1></RouteStage>)
    rerender(<RouteStage direction="forward" routeKey="/app/schedule"><Editor /></RouteStage>)

    await user.type(screen.getByLabelText('计划标题'), '完成 LifeOps 闭环验收')
    await new Promise((resolve) => setTimeout(resolve, 360))
    expect(screen.getByLabelText('计划标题')).toHaveValue('完成 LifeOps 闭环验收')
  })

  it('does not steal focus when the user reaches a control before deferred heading focus', () => {
    let pendingFrame: FrameRequestCallback | undefined
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      pendingFrame = callback
      return 1
    })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)

    try {
      render(<RouteStage direction="forward" routeKey="/app/schedule"><Editor /></RouteStage>)
      const input = screen.getByLabelText('计划标题')
      input.focus()
      pendingFrame?.(0)
      expect(input).toHaveFocus()
    } finally {
      requestFrame.mockRestore()
      cancelFrame.mockRestore()
    }
  })
})
