import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Production routes are intentionally code-split. Under the fully parallel
// suite, module transformation can exceed Testing Library's 1s default even
// though the browser route remains responsive.
configure({ asyncUtilTimeout: 5_000 })

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})
