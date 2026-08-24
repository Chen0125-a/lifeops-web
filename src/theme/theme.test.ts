import { act, fireEvent, render, screen } from '@testing-library/react'
import { createElement, Fragment } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAutomaticTheme, getNextThemeBoundary, useLifeOpsTheme } from './theme'

function ThemeProbe() {
  const { theme, toggleTheme } = useLifeOpsTheme()

  return createElement(
    Fragment,
    null,
    createElement('main', { 'data-public-theme': theme, 'data-testid': 'public-theme-probe' }),
    createElement('section', {
      'data-testid': 'private-theme-probe',
      'data-workspace-theme': 'daylight',
    }),
    createElement('button', { onClick: toggleTheme, type: 'button' }, '切换主题'),
  )
}

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.removeProperty('color-scheme')
})

describe('public theme preference', () => {
  it('uses night as the automatic public theme at every time of day', () => {
    expect(getAutomaticTheme(new Date(2026, 7, 8, 6, 59))).toBe('night')
    expect(getAutomaticTheme(new Date(2026, 7, 8, 7, 0))).toBe('night')
    expect(getAutomaticTheme(new Date(2026, 7, 8, 12, 0))).toBe('night')
    expect(getAutomaticTheme(new Date(2026, 7, 8, 18, 59))).toBe('night')
    expect(getAutomaticTheme(new Date(2026, 7, 8, 19, 0))).toBe('night')
  })

  it('honors an explicit day override until the next preference boundary', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 8, 12, 0))
    render(createElement(ThemeProbe))

    expect(screen.getByTestId('public-theme-probe')).toHaveAttribute('data-public-theme', 'night')
    fireEvent.click(screen.getByRole('button', { name: '切换主题' }))
    expect(screen.getByTestId('public-theme-probe')).toHaveAttribute('data-public-theme', 'day')
    expect(localStorage.getItem('lifeops:theme-override')).not.toBeNull()

    act(() => vi.advanceTimersByTime(7 * 60 * 60 * 1000 - 1))
    expect(screen.getByTestId('public-theme-probe')).toHaveAttribute('data-public-theme', 'day')
    expect(localStorage.getItem('lifeops:theme-override')).not.toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByTestId('public-theme-probe')).toHaveAttribute('data-public-theme', 'night')
    expect(localStorage.getItem('lifeops:theme-override')).toBeNull()
  })

  it('rejects an invalid stored override and falls back to night', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 8, 12, 0))
    localStorage.setItem('lifeops:theme-override', JSON.stringify({ theme: 'dusk', expiresAt: Date.now() + 60_000 }))

    render(createElement(ThemeProbe))

    expect(screen.getByTestId('public-theme-probe')).toHaveAttribute('data-public-theme', 'night')
    expect(localStorage.getItem('lifeops:theme-override')).toBeNull()
  })

  it('keeps the private workspace daylight when the public theme changes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 8, 12, 0))
    render(createElement(ThemeProbe))

    fireEvent.click(screen.getByRole('button', { name: '切换主题' }))

    expect(screen.getByTestId('public-theme-probe')).toHaveAttribute('data-public-theme', 'day')
    expect(screen.getByTestId('private-theme-probe')).toHaveAttribute(
      'data-workspace-theme',
      'daylight',
    )
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    expect(document.documentElement.style.colorScheme).not.toBe('dark')
  })

  it('selects 07:00 or 19:00 as the next boundary', () => {
    expect(getNextThemeBoundary(new Date(2026, 7, 8, 12, 0)).getHours()).toBe(19)
    const nightBoundary = getNextThemeBoundary(new Date(2026, 7, 8, 23, 0))
    expect(nightBoundary.getDate()).toBe(9)
    expect(nightBoundary.getHours()).toBe(7)
  })
})
