import { act, render, screen } from '@testing-library/react'
import { useQueryClient } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { App } from '../../App'
import { queryClient } from '../../api/queryClient'
import { PrivateAppBoundary } from '../private/PrivateAppBoundary'
import { LOCAL_SESSION_KEY, useAuth } from '../../state/AuthContext'
import { AppMotionProvider } from './AppMotionProvider'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  sessionStorage.clear()
  queryClient.clear()
})

it('uses the user reduced-motion preference while preserving child content', () => {
  render(
    <AppMotionProvider>
      <p>连续画布内容</p>
    </AppMotionProvider>,
  )

  expect(screen.getByTestId('motion-config')).toHaveAttribute('data-reduced-motion', 'user')
  expect(screen.getByText('连续画布内容')).toBeVisible()
})

it('keeps query, motion and authentication providers mounted around route content', async () => {
  sessionStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({
    mode: 'local-preview',
    account: 'owner@example.com',
  }))

  function ProviderProbe() {
    const auth = useAuth()
    const client = useQueryClient()
    return (
      <p>
        provider-shell:{auth.status}:{client === queryClient ? 'query-ready' : 'query-mismatch'}
      </p>
    )
  }

  const router = createMemoryRouter([{
    element: <App />,
    children: [{
      path: '/app',
      element: <PrivateAppBoundary />,
      children: [{ path: 'provider-probe', element: <ProviderProbe /> }],
    }],
  }], { initialEntries: ['/app/provider-probe'] })
  render(<RouterProvider router={router} />)

  expect(await screen.findByText('provider-shell:authenticated:query-ready')).toBeVisible()
  expect(screen.getByTestId('motion-config')).toHaveAttribute('data-reduced-motion', 'user')
})

it('carries the reduced entry prepaint across the private route for a bounded 64ms', () => {
  vi.useFakeTimers()
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as MediaQueryList)

  const router = createMemoryRouter([{
    element: <App />,
    children: [{ path: '/app/overview', element: <p>私人总览已挂载</p> }],
  }], {
    initialEntries: [{
      pathname: '/app/overview',
      state: { portalEntry: true, publicTheme: 'night', reducedEntryPrepaint: true },
    }],
  })
  render(<RouterProvider router={router} />)

  expect(screen.getByText('私人总览已挂载')).toBeVisible()
  expect(screen.getByRole('status', { name: '正在进入 LifeOps' })).toHaveAttribute(
    'data-entry-theme',
    'night',
  )
  act(() => vi.advanceTimersByTime(63))
  expect(screen.getByRole('status', { name: '正在进入 LifeOps' })).toBeVisible()
  act(() => vi.advanceTimersByTime(1))
  expect(screen.queryByRole('status', { name: '正在进入 LifeOps' })).not.toBeInTheDocument()
})
