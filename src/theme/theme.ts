import { useCallback, useEffect, useState } from 'react'

export type LifeOpsTheme = 'day' | 'night'

const OVERRIDE_KEY = 'lifeops:theme-override'

export function getAutomaticTheme(date = new Date()): LifeOpsTheme {
  void date
  return 'night'
}

export function getNextThemeBoundary(date = new Date()): Date {
  const next = new Date(date)
  if (date.getHours() < 7) {
    next.setHours(7, 0, 0, 0)
  } else if (date.getHours() < 19) {
    next.setHours(19, 0, 0, 0)
  } else {
    next.setDate(next.getDate() + 1)
    next.setHours(7, 0, 0, 0)
  }
  return next
}

interface StoredOverride {
  theme: LifeOpsTheme
  expiresAt: number
}

function readOverride(now: Date): StoredOverride | null {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredOverride
    if ((parsed.theme === 'day' || parsed.theme === 'night') && parsed.expiresAt > now.getTime()) {
      return parsed
    }
    localStorage.removeItem(OVERRIDE_KEY)
  } catch {
    localStorage.removeItem(OVERRIDE_KEY)
  }
  return null
}

export function useLifeOpsTheme() {
  const [theme, setTheme] = useState<LifeOpsTheme>(() => {
    const now = new Date()
    return readOverride(now)?.theme ?? getAutomaticTheme(now)
  })

  useEffect(() => {
    const now = new Date()
    const override = readOverride(now)
    const boundary = override ? new Date(override.expiresAt) : getNextThemeBoundary(now)
    const timer = window.setTimeout(() => {
      localStorage.removeItem(OVERRIDE_KEY)
      setTheme(getAutomaticTheme(new Date()))
    }, Math.max(250, boundary.getTime() - now.getTime()))
    return () => window.clearTimeout(timer)
  }, [theme])

  const selectTheme = useCallback((next: LifeOpsTheme) => {
    const now = new Date()
    const value: StoredOverride = {
      theme: next,
      expiresAt: getNextThemeBoundary(now).getTime(),
    }
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(value))
    setTheme(next)
  }, [])

  const toggleTheme = useCallback(() => {
    selectTheme(theme === 'day' ? 'night' : 'day')
  }, [selectTheme, theme])

  return { theme, toggleTheme, setTheme: selectTheme }
}
