import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PublicHomePage } from './PublicHomePage'

function renderPublicHome() {
  return render(
    <MemoryRouter>
      <PublicHomePage />
    </MemoryRouter>,
  )
}

const publicReturnState = {
  sourceObjectId: 'learning' as const,
  objectPlayheads: { now: 0.1, doing: 0.2, learning: 0.3, moments: 0.4, archive: 0.5 },
  homeScrollY: 412,
  theme: 'night' as const,
  sourceFocusId: 'public-object-learning',
}

beforeEach(() => {
  vi.mocked(window.matchMedia).mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as MediaQueryList)
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('PublicHomePage', () => {
  it('defaults to the night scene and honors an explicit day override', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 8, 12, 0))
    const { container } = renderPublicHome()

    expect(container.querySelector('.public-home')).toHaveAttribute('data-public-theme', 'night')
    fireEvent.click(screen.getByRole('button', { name: '切换为日间主题' }))
    expect(container.querySelector('.public-home')).toHaveAttribute('data-public-theme', 'day')
    expect(JSON.parse(localStorage.getItem('lifeops:theme-override') ?? '{}')).toMatchObject({ theme: 'day' })
    vi.useRealTimers()
  })

  it('commits the semantic theme and all four paint surfaces atomically', () => {
    const { container } = renderPublicHome()
    const surfaces = [
      container.querySelector('.public-sky'),
      container.querySelector('.public-header'),
      container.querySelector('.public-hero__copy'),
      container.querySelector('.public-hero__stage'),
    ]

    for (const surface of surfaces) {
      expect(surface).toHaveAttribute('data-public-surface-theme', 'night')
    }

    fireEvent.click(screen.getByRole('button', { name: '切换为日间主题' }))
    expect(container.querySelector('.public-home')).toHaveAttribute('data-public-theme', 'day')
    for (const surface of surfaces) {
      expect(surface).toHaveAttribute('data-public-surface-theme', 'day')
    }
  })

  it('exposes the complete title from first paint while the visual characters start typing', () => {
    renderPublicHome()

    const title = screen.getByRole('heading', { name: '把日子，慢慢看清。' })
    expect(title).toHaveAttribute('data-title-state', 'typing')
    expect(title).toHaveAttribute('data-title-play-count', '1')
    expect(screen.getAllByTestId('public-title-character')).toHaveLength(9)
    for (const character of screen.getAllByTestId('public-title-character')) {
      expect(character).toHaveAttribute('aria-hidden', 'true')
    }
    expect(screen.getByTestId('public-title-cursor')).toHaveAttribute('aria-hidden', 'true')
  })

  it('finishes the one-shot title within its wall-clock budget when animation frames stall', async () => {
    vi.useFakeTimers()
    renderPublicHome()

    const title = screen.getByRole('heading', { name: '把日子，慢慢看清。' })
    expect(title).toHaveAttribute('data-title-state', 'typing')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_800)
    })

    expect(title).toHaveAttribute('data-title-state', 'complete')
  })

  it('renders the title complete immediately without a cursor under reduced motion', () => {
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

    renderPublicHome()

    expect(screen.getByRole('heading', { name: '把日子，慢慢看清。' })).toHaveAttribute(
      'data-title-state',
      'complete',
    )
    expect(screen.queryByTestId('public-title-cursor')).not.toBeInTheDocument()
  })

  it('restores scroll, theme, source focus and all five playheads from a detail return', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo')
    const { container } = render(
      <MemoryRouter initialEntries={[{ pathname: '/', state: { publicReturn: publicReturnState } }]}>
        <PublicHomePage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('link', { name: '探索最近在学' })).toHaveFocus()
      expect(scrollTo).toHaveBeenCalledWith({ top: 412, left: 0, behavior: 'auto' })
    })
    expect(container.querySelector('.public-home')).toHaveAttribute('data-public-theme', 'night')
    for (const [slug, progress] of Object.entries(publicReturnState.objectPlayheads)) {
      expect(container.querySelector(`[data-public-object="${slug}"]`)).toHaveAttribute('data-restored-playhead', String(progress))
    }
    expect(sessionStorage.getItem('lifeops:public-return:v1')).toBeNull()
  })

  it('keeps the wordmark, header-owned motion control, theme control and login action together', () => {
    const { container } = renderPublicHome()
    const header = container.querySelector('.public-header')

    expect(header).toBeInTheDocument()
    expect(within(header as HTMLElement).getByRole('link', { name: 'LifeOps 首页' })).toBeInTheDocument()
    expect(within(header as HTMLElement).getByRole('button', { name: '暂停星盘动画' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(header as HTMLElement).getByRole('button', { name: /切换为.+主题/ })).toBeInTheDocument()
    expect(within(header as HTMLElement).getByRole('button', { name: '登录 LifeOps' })).toBeInTheDocument()
    expect(header?.querySelectorAll('a, button')).toHaveLength(4)
    expect(screen.queryByRole('navigation', { name: '公开内容导航' })).not.toBeInTheDocument()
  })

  it('renders one 36/64 public scene with the five visible life destinations', () => {
    const { container } = renderPublicHome()
    const home = container.querySelector('[data-public-scene]')

    expect(home).toHaveAttribute('data-public-scene', 'rest')
    expect(container.querySelectorAll('.public-hero')).toHaveLength(1)
    expect(screen.getByTestId('public-copy')).toHaveAttribute('data-layout-share', '36')
    expect(screen.getByTestId('public-scene')).toHaveAttribute('data-layout-share', '64')
    expect(screen.getAllByTestId('orbit-object')).toHaveLength(5)
    expect(screen.getAllByTestId('orbit-object').map((object) => object.textContent)).toEqual([
      expect.stringContaining('此刻'),
      expect.stringContaining('正在做'),
      expect.stringContaining('最近在学'),
      expect.stringContaining('生活切片'),
      expect.stringContaining('时间档案'),
    ])
  })

  it('renders one cached raster star field derived from three authored decorative layers', () => {
    const { container } = renderPublicHome()
    const field = container.querySelector<HTMLImageElement>('img[data-star-field]')

    expect(field).toHaveAttribute('src', '/public-stars-raster.png')
    expect(field).toHaveAttribute('data-star-layers', 'far middle near')
    expect(field).toHaveAttribute('aria-hidden', 'true')
    expect(field?.alt).toBe('')
  })

  it('keeps theme switching unavailable until the cached star field is decoded', async () => {
    let finishDecode: (() => void) | undefined
    const decode = vi.fn(() => new Promise<void>((resolve) => {
      finishDecode = resolve
    }))
    const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode')
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: decode,
    })

    try {
      renderPublicHome()

      const themeSwitch = screen.getByRole('button', { name: /切换为.+主题/ })
      expect(document.querySelector('img[data-star-field]')).toHaveAttribute('src', '/public-stars-raster.png')
      expect(themeSwitch).toBeDisabled()
      expect(decode).toHaveBeenCalledTimes(1)

      finishDecode?.()
      await waitFor(() => expect(themeSwitch).toBeEnabled())
    } finally {
      if (originalDecode) {
        Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode)
      } else {
        Reflect.deleteProperty(HTMLImageElement.prototype, 'decode')
      }
    }
  })

  it('exposes pause and resume without registering wheel navigation', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener')

    try {
      renderPublicHome()

      const header = document.querySelector('.public-header') as HTMLElement
      const pause = within(header).getByRole('button', { name: '暂停星盘动画' })
      expect(pause).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(pause)
      expect(within(header).getByRole('button', { name: '继续星盘动画' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getAllByRole('button', { name: '继续星盘动画' })).toHaveLength(1)
      expect(addEventListener.mock.calls.filter(([type]) => type === 'wheel')).toHaveLength(0)
    } finally {
      addEventListener.mockRestore()
    }
  })

  it('removes the long landing-page sections and technology blueprint', () => {
    const { container } = renderPublicHome()

    expect(screen.queryByRole('heading', { name: '一条从计划到理解的生活闭环' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '正在建设的 LifeOps' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '最近留下的三条线索' })).not.toBeInTheDocument()
    expect(container.querySelector('.public-loop-section')).not.toBeInTheDocument()
    expect(container.querySelector('.public-project-section')).not.toBeInTheDocument()
    expect(container.querySelector('.public-notes-section')).not.toBeInTheDocument()
    expect(container.querySelector('.project-blueprint')).not.toBeInTheDocument()
    expect(container).not.toHaveTextContent(/PRODUCT|K8S|GITOPS|PRIVATE SYSTEM/i)
  })

  it('drives login through semantic phases and restores trigger focus after a live-playhead reverse', async () => {
    const user = userEvent.setup()
    const { container } = renderPublicHome()
    const home = container.querySelector('[data-public-scene]')
    const trigger = screen.getByRole('button', { name: '登录 LifeOps' })

    expect(home).toHaveAttribute('data-login-phase', 'closed')
    await waitFor(() => expect(container.querySelector('[data-public-orbit]')).toHaveAttribute('data-motion-enhanced', 'true'))
    await user.click(trigger)
    await waitFor(() => expect(home).toHaveAttribute('data-login-phase', 'open'))
    expect(container.querySelector('.public-hero__copy')).toHaveAttribute('aria-hidden', 'true')
    expect(home).toHaveAttribute('data-public-scene', 'login')
    expect(container.querySelector('[data-public-orbit]')).toHaveAttribute(
      'data-motion-rate',
      String(1 / 3),
    )

    await user.click(screen.getByRole('button', { name: '关闭登录窗口' }))
    expect(home).toHaveAttribute('data-login-phase', 'closing')
    expect(home).toHaveAttribute('data-public-scene', 'rest')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('does not replay the title when login opens, closes and reopens', async () => {
    const user = userEvent.setup()
    const { container } = renderPublicHome()
    const title = screen.getByRole('heading', { name: '把日子，慢慢看清。' })

    await waitFor(() => expect(title).toHaveAttribute('data-title-state', 'complete'), { timeout: 4_000 })
    const before = [...container.querySelectorAll('[data-public-object]')]
      .map((object) => object.getAttribute('data-restored-playhead'))
    await user.click(screen.getByRole('button', { name: '登录 LifeOps' }))
    await waitFor(() => expect(container.querySelector('[data-public-scene]')).toHaveAttribute('data-login-phase', 'open'))
    await user.click(screen.getByRole('button', { name: '关闭登录窗口' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '登录 LifeOps' })).toHaveFocus())
    await user.click(screen.getByRole('button', { name: '登录 LifeOps' }))

    expect(title).toHaveAttribute('data-title-state', 'complete')
    expect(title).toHaveAttribute('data-title-play-count', '1')
    expect([...container.querySelectorAll('[data-public-object]')]
      .map((object) => object.getAttribute('data-restored-playhead'))).toEqual(before)
  })

  it('prepaints the private daylight canvas only after real authentication succeeds', async () => {
    const user = userEvent.setup()
    const { container } = renderPublicHome()

    await user.click(screen.getByRole('button', { name: '登录 LifeOps' }))
    await user.type(screen.getByLabelText('账号'), 'owner@example.com')
    await user.type(screen.getByLabelText('密码'), 'local-preview')
    await user.click(screen.getByRole('button', { name: '进入 LifeOps' }))

    await waitFor(() => {
      expect(container.querySelector('[data-public-scene]')).toHaveAttribute(
        'data-login-phase',
        'entering',
      )
    })
    await waitFor(() => expect(screen.getByTestId('private-daylight-prepaint')).toHaveAttribute(
      'data-workspace-theme',
      'daylight',
    ))
    await waitFor(() => {
      expect(screen.getByRole('status', { name: '正在进入 LifeOps' })).toHaveAttribute(
        'data-entry-ready',
        'true',
      )
    })
  })
})
