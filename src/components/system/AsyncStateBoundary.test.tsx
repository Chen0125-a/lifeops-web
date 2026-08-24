import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AsyncStateBoundary } from './AsyncStateBoundary'

describe('AsyncStateBoundary', () => {
  it('keeps ready, saving and saved content in one stable local region', () => {
    const { rerender } = render(
      <AsyncStateBoundary state="ready">
        <p>目标内容</p>
      </AsyncStateBoundary>,
    )
    const region = screen.getByTestId('async-state-boundary')
    expect(region).toHaveAttribute('data-state', 'ready')
    expect(screen.getByText('目标内容')).toBeVisible()

    rerender(
      <AsyncStateBoundary state="saving">
        <p>目标内容</p>
      </AsyncStateBoundary>,
    )
    expect(screen.getByTestId('async-state-boundary')).toBe(region)
    expect(region).toHaveAttribute('data-state', 'saving')
    expect(screen.getByRole('status', { name: '正在保存' })).toBeVisible()
    expect(screen.getByText('目标内容')).toBeVisible()

    rerender(
      <AsyncStateBoundary state="saved">
        <p>目标内容</p>
      </AsyncStateBoundary>,
    )
    expect(screen.getByTestId('async-state-boundary')).toBe(region)
    expect(screen.getByRole('status', { name: '已保存' })).toBeVisible()
    expect(screen.getByText('目标内容')).toBeVisible()
  })

  it.each([
    ['loading', '正在加载'],
    ['empty', '暂无内容'],
    ['disconnected', '服务未连接'],
  ] as const)('renders the %s state as an accessible local status', (state, label) => {
    render(
      <AsyncStateBoundary state={state}>
        <p>暂不可见内容</p>
      </AsyncStateBoundary>,
    )

    expect(screen.getByTestId('async-state-boundary')).toHaveAttribute('data-state', state)
    expect(screen.getByRole('status', { name: label })).toBeVisible()
    expect(screen.queryByText('暂不可见内容')).not.toBeInTheDocument()
  })

  it.each([
    ['forbidden', '无权访问此内容'],
    ['deleted', '内容已删除'],
  ] as const)('renders the %s state as an accessible local alert', (state, label) => {
    render(
      <AsyncStateBoundary state={state}>
        <p>暂不可见内容</p>
      </AsyncStateBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(label)
    expect(screen.queryByText('暂不可见内容')).not.toBeInTheDocument()
  })

  it.each([
    ['network-error', '网络连接失败', '重试'],
    ['conflict', '内容已在其他位置更新', '重新加载'],
  ] as const)('makes the %s state recoverable beside the failed region', async (state, label, action) => {
    const retry = vi.fn()
    const user = userEvent.setup()
    render(
      <AsyncStateBoundary state={state} onRetry={retry}>
        <p>暂不可见内容</p>
      </AsyncStateBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(label)
    await user.click(screen.getByRole('button', { name: action }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
