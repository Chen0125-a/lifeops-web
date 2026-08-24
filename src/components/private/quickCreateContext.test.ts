import { describe, expect, it } from 'vitest'
import { deriveQuickCreateContext, type QuickCreateSelection } from './quickCreateContext'

const loaded: QuickCreateSelection = {
  goalIds: ['goal-1'],
  projectIds: ['project-1'],
  habitIds: ['habit-1'],
  recordIds: ['record-1'],
  knowledgeIds: ['note-1'],
  recipeIds: ['recipe-1'],
  itemIds: ['item-1'],
  shoppingItemIds: ['shopping-1'],
}

const location = (pathname: string, search = '') => ({ pathname, search })

describe('deriveQuickCreateContext', () => {
  it('inherits validated goal and project identities from the outcome map', () => {
    expect(deriveQuickCreateContext(location('/app/goals', '?goal=goal-1&project=project-1'), loaded)).toEqual({
      goalId: 'goal-1',
      projectId: 'project-1',
    })
  })

  it('inherits schedule date/project and habit/date context', () => {
    expect(deriveQuickCreateContext(location('/app/schedule', '?date=2026-08-23&project=project-1'), loaded)).toEqual({
      projectId: 'project-1',
      date: '2026-08-23',
    })
    expect(deriveQuickCreateContext(location('/app/habits', '?habit=habit-1&date=2026-08-24'), loaded)).toEqual({
      habitId: 'habit-1',
      date: '2026-08-24',
    })
  })

  it.each([
    ['/app/records', '?record=record-1', { sourceType: 'record', sourceId: 'record-1' }],
    ['/app/knowledge', '?note=note-1', { sourceType: 'knowledge', sourceId: 'note-1' }],
    ['/app/life/recipes', '?recipe=recipe-1', { sourceType: 'recipe', sourceId: 'recipe-1' }],
    ['/app/life/ingredients', '?item=item-1', { sourceType: 'life-item', sourceId: 'item-1' }],
    ['/app/life/shopping', '?item=item-1&shopping=shopping-1', { sourceType: 'shopping-item', sourceId: 'shopping-1' }],
  ] as const)('inherits the selected source on %s', (pathname, search, expected) => {
    expect(deriveQuickCreateContext(location(pathname, search), loaded)).toEqual(expected)
  })

  it('inherits valid Life date and analytics drill-down facts', () => {
    expect(deriveQuickCreateContext(location('/app/life/calendar', '?date=2026-08-25'), loaded)).toEqual({ date: '2026-08-25' })
    expect(deriveQuickCreateContext(location('/app/life/analytics', '?from=2026-08-01&to=2026-08-23&item=item-1'), loaded)).toEqual({
      date: '2026-08-23',
      sourceType: 'life-item',
      sourceId: 'item-1',
    })
  })

  it('ignores malformed dates and untrusted identities absent from loaded user data', () => {
    expect(deriveQuickCreateContext(location('/app/goals', '?goal=other-goal&project=project-1'), loaded)).toEqual({
      projectId: 'project-1',
    })
    expect(deriveQuickCreateContext(location('/app/records', '?record=other-record'), loaded)).toEqual({})
    expect(deriveQuickCreateContext(location('/app/life/recipes', '?recipe=other-recipe&date=not-a-date'), loaded)).toEqual({})
    expect(deriveQuickCreateContext(location('/app/life/shopping', '?shopping=other-shopping&item=other-item'), loaded)).toEqual({})
  })
})
