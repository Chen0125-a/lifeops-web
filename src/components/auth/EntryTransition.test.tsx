import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EntryTransition } from './EntryTransition'

beforeEach(() => {
  vi.mocked(window.matchMedia).mockImplementation(
    (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as MediaQueryList,
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, 'startViewTransition')
})

describe('EntryTransition', () => {
  it('prepaints the private daylight canvas and waits for private-shell readiness', () => {
    vi.useFakeTimers()
    const complete = vi.fn()
    const { rerender } = render(
      <EntryTransition active privateReady={false} theme="night" onComplete={complete} />,
    )

    expect(screen.getByTestId('private-daylight-prepaint')).toHaveAttribute(
      'data-workspace-theme',
      'daylight',
    )
    expect(screen.getByRole('status')).toHaveAttribute('data-entry-ready', 'false')
    act(() => vi.advanceTimersByTime(1_000))
    expect(complete).not.toHaveBeenCalled()

    rerender(<EntryTransition active privateReady theme="night" onComplete={complete} />)
    expect(screen.getByRole('status')).toHaveAttribute('data-entry-ready', 'true')
    act(() => vi.advanceTimersByTime(679))
    expect(complete).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(complete).toHaveBeenCalledOnce()
  })

  it('uses an at-most-80ms opacity continuity in reduced-motion mode', () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as MediaQueryList,
    )
    const complete = vi.fn()
    render(<EntryTransition active privateReady theme="day" onComplete={complete} />)

    expect(screen.getByRole('status')).toHaveAttribute('data-entry-motion', 'reduced')
    act(() => vi.advanceTimersByTime(31))
    expect(complete).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(complete).toHaveBeenCalledOnce()
  })

  it('uses the 680ms approved continuity without a white intermediate frame', () => {
    vi.useFakeTimers()
    const complete = vi.fn()
    const viewTransition = vi.fn()
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: viewTransition,
    })

    render(<EntryTransition active privateReady theme="night" onComplete={complete} />)
    const transition = screen.getByRole('status')
    expect(transition).toHaveAttribute('data-entry-surface', 'daylight-prepaint')
    expect(transition).toHaveAttribute('data-entry-motion', 'full')
    act(() => vi.advanceTimersByTime(679))
    expect(complete).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(complete).toHaveBeenCalledOnce()
    expect(viewTransition).not.toHaveBeenCalled()
  })

  it('completes once even when the ready state rerenders', () => {
    vi.useFakeTimers()
    const complete = vi.fn()
    const { rerender } = render(
      <EntryTransition active privateReady theme="day" onComplete={complete} />,
    )
    act(() => vi.advanceTimersByTime(680))
    rerender(<EntryTransition active privateReady theme="day" onComplete={complete} />)
    act(() => vi.advanceTimersByTime(680))
    expect(complete).toHaveBeenCalledOnce()
  })
})
