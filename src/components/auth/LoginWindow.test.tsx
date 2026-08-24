import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginWindow } from './LoginWindow'

const auth = vi.hoisted(() => ({
  login: vi.fn<(...args: [string, string]) => Promise<void>>(),
}))

vi.mock('../../state/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../../state/AuthContext')>(
    '../../state/AuthContext',
  )
  return {
    ...actual,
    useAuth: () => ({ login: auth.login }),
  }
})

beforeEach(() => {
  auth.login.mockReset()
  auth.login.mockResolvedValue(undefined)
})

function renderLogin(overrides: Partial<ComponentProps<typeof LoginWindow>> = {}) {
  const props = {
    open: true,
    onAuthenticated: vi.fn(),
    onClose: vi.fn(),
    onSceneStateChange: vi.fn(),
    ...overrides,
  } as ComponentProps<typeof LoginWindow> & { onSceneStateChange: ReturnType<typeof vi.fn> }
  return { ...render(<LoginWindow {...props} />), props }
}

describe('LoginWindow', () => {
  it('exposes one-viewport desktop and mobile task-layer semantics with password-manager fields', () => {
    const { container } = renderLogin()
    const dialog = screen.getByRole('dialog', { name: 'LifeOps 登录窗口' })

    expect(dialog).toHaveAttribute('data-login-task-layer')
    expect(dialog).toHaveAttribute('data-desktop-width', '460')
    expect(dialog).toHaveAttribute('data-mobile-presentation', 'fullscreen')
    expect(dialog).toHaveAttribute('data-one-viewport', 'true')
    expect(dialog).toHaveAttribute('data-theme-surface', 'adaptive')
    expect(dialog).toHaveAttribute('data-wide-ring-diameter', '520')
    expect(dialog).toHaveAttribute('data-viewport-safe-inset', '16')
    expect(screen.getByRole('button', { name: '关闭登录窗口' })).toBeVisible()
    expect(screen.getByLabelText('账号')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText('密码')).toHaveAttribute('autocomplete', 'current-password')
    expect(container.querySelector('[data-login-backdrop]')).toBeInTheDocument()
  })

  it('shows and hides the password without replacing the password field', async () => {
    const user = userEvent.setup()
    renderLogin()
    const password = screen.getByLabelText('密码')

    expect(password).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: '显示密码' }))
    expect(password).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: '隐藏密码' }))
    expect(password).toHaveAttribute('type', 'password')
  })

  it('focuses the account, traps Tab, closes with Escape, and lets the caller restore focus', async () => {
    const user = userEvent.setup()
    const close = vi.fn()
    renderLogin({ onClose: close })
    const account = screen.getByLabelText('账号')
    const closeButton = screen.getByRole('button', { name: '关闭登录窗口' })
    const submit = screen.getByRole('button', { name: '进入 LifeOps' })

    await waitFor(() => expect(account).toHaveFocus())
    submit.focus()
    await user.tab()
    expect(closeButton).toHaveFocus()
    await user.tab({ shift: true })
    expect(submit).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes from the explicit backdrop but not from the task layer itself', () => {
    const close = vi.fn()
    const { container } = renderLogin({ onClose: close })

    fireEvent.click(container.querySelector('[data-login-backdrop]') as HTMLElement)
    expect(close).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('dialog'))
    expect(close).toHaveBeenCalledOnce()
  })

  it('reports authentication progress, rejects duplicate submit, and enters only after success', async () => {
    const user = userEvent.setup()
    let resolveLogin: (() => void) | undefined
    auth.login.mockReturnValue(new Promise<void>((resolve) => { resolveLogin = resolve }))
    const authenticated = vi.fn()
    const sceneChange = vi.fn()
    renderLogin({ onAuthenticated: authenticated, onSceneStateChange: sceneChange } as never)

    await user.type(screen.getByLabelText('账号'), 'owner@example.com')
    await user.type(screen.getByLabelText('密码'), 'secret-value')
    await user.click(screen.getByRole('button', { name: '进入 LifeOps' }))

    expect(auth.login).toHaveBeenCalledOnce()
    expect(sceneChange).toHaveBeenCalledWith('authenticating')
    expect(screen.getByRole('button', { name: '正在确认身份' })).toBeDisabled()
    expect(authenticated).not.toHaveBeenCalled()

    resolveLogin?.()
    await waitFor(() => expect(authenticated).toHaveBeenCalledOnce())
    expect(sceneChange).toHaveBeenLastCalledWith('entering')
  })

  it('rejects two submit events dispatched in the same event loop', () => {
    auth.login.mockReturnValue(new Promise<void>(() => undefined))
    renderLogin()
    const account = screen.getByLabelText('账号')
    const password = screen.getByLabelText('密码')
    const form = screen.getByRole('button', { name: '进入 LifeOps' }).closest('form')

    fireEvent.change(account, { target: { value: 'owner@example.com' } })
    fireEvent.change(password, { target: { value: 'secret-value' } })
    fireEvent.submit(form as HTMLFormElement)
    fireEvent.submit(form as HTMLFormElement)

    expect(auth.login).toHaveBeenCalledOnce()
  })

  it('returns to the open task layer with an explicit error after rejected authentication', async () => {
    const user = userEvent.setup()
    const sceneChange = vi.fn()
    const authenticated = vi.fn()
    auth.login.mockRejectedValue(new Error('账号或密码不正确'))
    renderLogin({ onAuthenticated: authenticated, onSceneStateChange: sceneChange } as never)

    await user.type(screen.getByLabelText('账号'), 'owner@example.com')
    await user.type(screen.getByLabelText('密码'), 'wrong-value')
    await user.click(screen.getByRole('button', { name: '进入 LifeOps' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码不正确')
    expect(sceneChange).toHaveBeenLastCalledWith('open')
    expect(authenticated).not.toHaveBeenCalled()
  })

  it('turns a transport failure into a safe recoverable network message', async () => {
    const user = userEvent.setup()
    auth.login.mockRejectedValue(new TypeError('Failed to fetch'))
    renderLogin()

    await user.type(screen.getByLabelText('账号'), 'owner@example.com')
    await user.type(screen.getByLabelText('密码'), 'secret-value')
    await user.click(screen.getByRole('button', { name: '进入 LifeOps' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '网络暂时不可用，请检查连接后重试。',
    )
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument()
  })
})
