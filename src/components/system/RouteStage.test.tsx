import { act, render, screen, waitFor } from '@testing-library/react'
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

  it('does not steal focus from a shell control before deferred heading focus', () => {
    let pendingFrame: FrameRequestCallback | undefined
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      pendingFrame = callback
      return 1
    })
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)

    try {
      render(<>
        <button type="button">快速记录</button>
        <RouteStage direction="forward" routeKey="/app/records"><Editor /></RouteStage>
      </>)
      const shellControl = screen.getByRole('button', { name: '快速记录' })
      shellControl.focus()
      pendingFrame?.(0)
      expect(shellControl).toHaveFocus()
    } finally {
      requestFrame.mockRestore()
      cancelFrame.mockRestore()
    }
  })

  it('moves focus from a shell navigation trigger to the destination heading after a route change', async () => {
    const { rerender } = render(<>
      <button type="button">目标与项目</button>
      <RouteStage direction="forward" routeKey="/app/overview"><h1 tabIndex={-1}>总览</h1></RouteStage>
    </>)
    await waitFor(() => expect(screen.getByRole('heading', { name: '总览', level: 1 })).toHaveFocus())

    screen.getByRole('button', { name: '目标与项目' }).focus()
    rerender(<>
      <button type="button">目标与项目</button>
      <RouteStage direction="forward" routeKey="/app/goals"><h1 tabIndex={-1}>目标与项目</h1></RouteStage>
    </>)

    await waitFor(() => expect(screen.getByRole('heading', { name: '目标与项目', level: 1 })).toHaveFocus())
  })

  it('does not force a computed-style layout read when a settled panel starts leaving', () => {
    const computedStyle = vi.spyOn(window, 'getComputedStyle')

    try {
      const { rerender } = render(
        <RouteStage direction="forward" routeKey="/app/overview"><h1 tabIndex={-1}>总览</h1></RouteStage>,
      )
      computedStyle.mockClear()

      rerender(<RouteStage direction="forward" routeKey="/app/records"><h1 tabIndex={-1}>记录</h1></RouteStage>)

      const settledOverviewReads = computedStyle.mock.calls.filter(([element]) => (
        element instanceof HTMLElement && element.dataset.routeKey === '/app/overview'
      ))
      expect(settledOverviewReads).toEqual([])
    } finally {
      computedStyle.mockRestore()
    }
  })

  it('retains outgoing pixels without triggering a native inert subtree walk', () => {
    const { container, rerender } = render(
      <RouteStage direction="forward" routeKey="/app/overview"><h1 tabIndex={-1}>总览</h1><a href="/app/records">全部记录</a></RouteStage>,
    )

    rerender(<RouteStage direction="forward" routeKey="/app/records"><h1 tabIndex={-1}>记录</h1></RouteStage>)

    const outgoing = container.querySelector<HTMLElement>('[data-route-panel-phase="outgoing"]')
    expect(outgoing).toHaveAttribute('aria-hidden', 'true')
    expect(outgoing).toHaveStyle({ pointerEvents: 'none', position: 'absolute' })
    expect(outgoing).not.toHaveAttribute('inert')
  })

  it('keeps one native 240ms entering-panel owner while retaining outgoing content before mounting heavy content', async () => {
    const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
    const activeOwners = new WeakSet<HTMLElement>()
    const calls: Array<{ element: HTMLElement; finish: () => void; frames: Keyframe[]; options: KeyframeAnimationOptions }> = []

    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value(this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
        if (activeOwners.has(this)) throw new Error('competing native route animation owner')
        activeOwners.add(this)
        let finish: (animation: Animation) => void = () => undefined
        const animation = {
          cancel: () => activeOwners.delete(this),
          finished: new Promise<Animation>((resolve) => { finish = resolve }),
        } as unknown as Animation
        calls.push({ element: this, finish: () => finish(animation), frames, options })
        return animation
      },
    })

    try {
      const { rerender, unmount } = render(
        <RouteStage direction="forward" routeKey="/app/overview"><h1 tabIndex={-1}>总览</h1></RouteStage>,
      )
      expect(document.querySelector<HTMLElement>('[data-route-panel-current]')?.style.transform).toBe('none')
      rerender(<RouteStage direction="forward" routeKey="/app/records"><h1 tabIndex={-1}>记录</h1></RouteStage>)

      expect(screen.queryByRole('heading', { name: '记录', level: 1 })).not.toBeInTheDocument()
      const transitions = calls.map(({ element, frames }) => ({
        routeKey: element.dataset.routeKey,
        targetOpacity: frames[1]?.opacity,
        targetTransform: frames[1]?.transform,
      }))
      expect(transitions.filter(({ routeKey }) => routeKey === '/app/overview')).toHaveLength(0)
      expect(transitions.filter(({ routeKey, targetOpacity }) => routeKey === '/app/records' && targetOpacity === 1)).toHaveLength(1)
      expect(transitions.filter(({ routeKey, targetOpacity }) => routeKey === '/app/overview' && targetOpacity === 1)).toHaveLength(0)
      calls.forEach(({ frames, options }) => {
        expect(options).toMatchObject({
          duration: 240,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'both',
        })
        expect(frames).toHaveLength(2)
        frames.forEach((frame) => expect(Object.keys(frame).sort()).toEqual(['opacity', 'transform']))
      })
      expect(new Set(calls.filter(({ element }) => element.isConnected).map(({ element }) => element)).size).toBe(1)
      await act(async () => {
        calls.find(({ element, frames }) => element.dataset.routeKey === '/app/records' && frames[1]?.opacity === 1)?.finish()
        await Promise.resolve()
      })
      expect(screen.queryByRole('heading', { name: '记录', level: 1 })).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole('heading', { name: '记录', level: 1 })).toBeVisible())
      expect(document.querySelector<HTMLElement>('[data-route-panel-current]')?.style.transform).toBe('none')
      unmount()
    } finally {
      if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
      else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
    }
  })
})
