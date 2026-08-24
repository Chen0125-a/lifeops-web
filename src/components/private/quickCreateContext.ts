export type QuickCreateSourceType = 'record' | 'knowledge' | 'recipe' | 'life-item' | 'shopping-item' | 'day-plan-item'

export interface QuickCreateContextValue {
  goalId?: string
  projectId?: string
  date?: string
  habitId?: string
  sourceType?: QuickCreateSourceType
  sourceId?: string
}

export interface QuickCreateSelection {
  goalIds?: readonly string[]
  projectIds?: readonly string[]
  habitIds?: readonly string[]
  recordIds?: readonly string[]
  knowledgeIds?: readonly string[]
  recipeIds?: readonly string[]
  itemIds?: readonly string[]
  shoppingItemIds?: readonly string[]
  dayPlanItemIds?: readonly string[]
}

interface QuickCreateLocation {
  pathname: string
  search: string
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/
const includes = (values: readonly string[] | undefined, value: string | null) => Boolean(value && values?.includes(value))

export function deriveQuickCreateContext(
  location: QuickCreateLocation,
  selection: QuickCreateSelection,
): QuickCreateContextValue {
  const params = new URLSearchParams(location.search)
  const context: QuickCreateContextValue = {}
  const date = params.get('date') ?? params.get('day') ?? (location.pathname.endsWith('/analytics') ? params.get('to') : null)
  if (date && datePattern.test(date)) context.date = date

  const goalId = params.get('goal')
  const projectId = params.get('project')
  const habitId = params.get('habit')
  if (includes(selection.goalIds, goalId)) context.goalId = goalId!
  if (includes(selection.projectIds, projectId)) context.projectId = projectId!
  if (includes(selection.habitIds, habitId)) context.habitId = habitId!

  const candidates: Array<[string | null, readonly string[] | undefined, QuickCreateSourceType]> = location.pathname.startsWith('/app/records')
    ? [[params.get('record'), selection.recordIds, 'record']]
    : location.pathname.startsWith('/app/knowledge')
      ? [[params.get('note'), selection.knowledgeIds, 'knowledge']]
      : location.pathname.startsWith('/app/life/recipes')
        ? [[params.get('recipe'), selection.recipeIds, 'recipe']]
        : location.pathname.startsWith('/app/life/shopping')
          ? [
              [params.get('shopping'), selection.shoppingItemIds, 'shopping-item'],
              [params.get('item'), selection.itemIds, 'life-item'],
            ]
          : location.pathname.startsWith('/app/life/ingredients')
            || location.pathname.startsWith('/app/life/medicines')
            || location.pathname.startsWith('/app/life/household')
            || location.pathname.startsWith('/app/life/analytics')
            ? [[params.get('item'), selection.itemIds, 'life-item']]
            : location.pathname.startsWith('/app/life/plans')
              ? [[params.get('item'), selection.dayPlanItemIds, 'day-plan-item']]
              : []

  const source = candidates.find(([id, ids]) => includes(ids, id))
  if (source) {
    context.sourceType = source[2]
    context.sourceId = source[0]!
  }
  return context
}
