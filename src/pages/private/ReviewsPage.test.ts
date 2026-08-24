import { describe, expect, it } from 'vitest'
import { formatLocalDate } from './ReviewsPage'

describe('formatLocalDate', () => {
  it('keeps a date on the user local calendar day instead of converting through UTC', () => {
    expect(formatLocalDate(new Date(2026, 7, 9, 0, 30))).toBe('2026-08-09')
  })
})

