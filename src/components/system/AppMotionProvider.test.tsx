import { render, screen } from '@testing-library/react'
import { useQueryClient } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, expect, it } from 'vitest'
import { App } from '../../App'
import { queryClient } from '../../api/queryClient'
import { PrivateAppBoundary } from '../private/PrivateAppBoundary'
import { LOCAL_SESSION_KEY, useAuth } from '../../state/AuthContext'
import { AppMotionProvider } from './AppMotionProvider'

afterEach(() => {
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
