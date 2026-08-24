import { useQuery } from '@tanstack/react-query'
import { lifeCommerceApi } from '../../api/lifeCommerceApi'
import { isLocalDemoMode } from '../../api/lifeApi'
import { lifePlanningApi } from '../../api/lifePlanningApi'
import { queryKeys } from '../../api/queryKeys'
import type { BudgetSummary, ShoppingItem, ShoppingSuggestion } from '../../domain/lifeCommerce'
import type { DayPlan, DayPlanProjection, PlanningTimeline } from '../../domain/lifePlanning'

export interface LifeDayViewModel {
  status: 'loading' | 'ready' | 'error'
  date: string
  dayPlan: DayPlan | null
  timeline: PlanningTimeline | null
  projection: DayPlanProjection | null
  budgets: BudgetSummary[]
  shopping: {
    suggestions: ShoppingSuggestion[]
    formalItems: ShoppingItem[]
  }
  error: string | null
  retry?: () => void
}

export function useLifeDay(_date: string): LifeDayViewModel {
  const enabled = !isLocalDemoMode
  const dayPlanQuery = useQuery({
    queryKey: queryKeys.lifePlanning.detail(`day-plan:${_date}`),
    queryFn: ({ signal }) => lifePlanningApi.getDayPlan(_date, signal),
    enabled,
  })
  const timelineQuery = useQuery({
    queryKey: queryKeys.lifePlanning.detail(`timeline:${_date}`),
    queryFn: ({ signal }) => lifePlanningApi.getTimeline(_date, signal),
    enabled,
  })
  const projectionQuery = useQuery({
    queryKey: queryKeys.lifePlanning.detail(`projection:${_date}`),
    queryFn: ({ signal }) => lifePlanningApi.getDayProjection(_date, signal),
    enabled,
  })
  const budgetsQuery = useQuery({
    queryKey: queryKeys.lifeCommerce.list({ kind: 'budgets', asOf: _date }),
    queryFn: ({ signal }) => lifeCommerceApi.listBudgets(_date, signal),
    enabled,
  })
  const shoppingQuery = useQuery({
    queryKey: queryKeys.lifeCommerce.list({ kind: 'shopping' }),
    queryFn: ({ signal }) => lifeCommerceApi.listShopping(signal),
    enabled,
  })

  if (!enabled) {
    return {
      status: 'ready',
      date: _date,
      dayPlan: null,
      timeline: { date: _date, timelineItems: [] },
      projection: null,
      budgets: [],
      shopping: { suggestions: [], formalItems: [] },
      error: null,
      retry: () => undefined,
    }
  }

  const queries = [dayPlanQuery, timelineQuery, projectionQuery, budgetsQuery, shoppingQuery]
  const firstError = queries.find((query) => query.error)?.error
  return {
    status: queries.some((query) => query.isPending) ? 'loading' : firstError ? 'error' : 'ready',
    date: _date,
    dayPlan: dayPlanQuery.data ?? null,
    timeline: timelineQuery.data ?? null,
    projection: projectionQuery.data ?? null,
    budgets: budgetsQuery.data ?? [],
    shopping: shoppingQuery.data ?? { suggestions: [], formalItems: [] },
    error: firstError instanceof Error ? firstError.message : firstError ? '生活数据暂时无法加载。' : null,
    retry: () => { void Promise.all(queries.map((query) => query.refetch())) },
  }
}
