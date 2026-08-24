import type { Page, Route } from '@playwright/test'

const timestamp = '2026-08-21T02:00:00.000Z'

const itemBase = {
  mealSlotId: null,
  source: null,
  quantity: null,
  unit: null,
  servings: null,
  completionId: null,
  actual: null,
  originTemplateItemId: null,
  entityVersion: 1,
}

const timelineItems = [
  { ...itemBase, id: 'meal-breakfast', sourceType: 'day-plan-item', kind: 'meal', title: '燕麦与鸡蛋早餐', mealSlotId: 'breakfast', scheduledTime: '07:30', quantity: 1, unit: '份', servings: 1, durationMinutes: null, status: 'completed', completionId: 'completion-breakfast' },
  { ...itemBase, id: 'supplement-d3', sourceType: 'day-plan-item', kind: 'supplement', title: '用户记录的维生素 D3', scheduledTime: '08:00', quantity: 1, unit: '粒', durationMinutes: null, status: 'in_progress' },
  { ...itemBase, id: 'fitness-strength', sourceType: 'day-plan-item', kind: 'fitness', title: '下肢力量训练', scheduledTime: '18:30', durationMinutes: 45, status: 'planned' },
  { ...itemBase, id: 'custom-stretch', sourceType: 'day-plan-item', kind: 'custom', title: '晚间拉伸', scheduledTime: '21:30', durationMinutes: 15, status: 'skipped' },
]

function dayPlan(date: string) {
  return {
    id: `day-${date}`,
    date,
    mealSlots: [{ id: 'breakfast', name: '早餐', position: 10, hidden: false }],
    items: date === '2026-08-21' ? timelineItems.map(({ sourceType: _sourceType, ...item }) => item) : [],
    entityVersion: 3,
  }
}

function timeline(date: string) {
  return { date, timelineItems: date === '2026-08-21' ? timelineItems : date === '2026-08-22' ? [{ ...itemBase, id: 'meal-conflict', sourceType: 'day-plan-item', kind: 'meal', title: '待解决单位换算的午餐', scheduledTime: '12:00', durationMinutes: null, status: 'planned' }] : [] }
}

function projection(date: string) {
  if (date === '2026-08-22') return {
    date, status: 'incomplete', plannedNutrition: null, actualNutrition: {}, plannedCostMinor: null, actualCostMinor: 0,
    plannedEnergyKcal: 0, actualEnergyKcal: 0, sourceIds: [],
    inventory: [{ status: 'incomplete', itemId: '牛奶', baseUnit: null, onHand: null, plannedDemand: null, projectedBalance: null, shortage: null, reason: 'missing_conversion' }],
    items: [],
  }
  return {
    date, status: 'incomplete',
    plannedNutrition: { energyKcal: 2180, proteinG: 128, fatG: 62, carbohydrateG: 250, cookingOilG: 18, netEnergyKcal: 1880 },
    actualNutrition: { energyKcal: 640, proteinG: 31, fatG: 16, carbohydrateG: 82, cookingOilG: 6, netEnergyKcal: 640 },
    plannedCostMinor: 4250, actualCostMinor: 1280, plannedEnergyKcal: 300, actualEnergyKcal: 0,
    sourceIds: ['recipe-breakfast-v2'],
    inventory: [
      { status: 'complete', itemId: '燕麦', baseUnit: 'g', onHand: 40, plannedDemand: 80, projectedBalance: -40, shortage: 40 },
      { status: 'incomplete', itemId: '牛奶', baseUnit: null, onHand: null, plannedDemand: null, projectedBalance: null, shortage: null, reason: 'missing_conversion' },
    ],
    items: [{ dayPlanItemId: 'meal-breakfast', kind: 'meal', mode: 'actual', status: 'complete', source: null, nutrition: { energyKcal: 640 }, costMinor: 1280, estimatedEnergyKcal: null, inventory: [], preparedFood: null, missing: [] }],
  }
}

const calendar = [
  { date: '2026-08-19', state: 'planned', itemCount: 3, completedCount: 0 },
  { date: '2026-08-20', state: 'complete', itemCount: 4, completedCount: 4 },
  { date: '2026-08-21', state: 'past-incomplete', itemCount: 4, completedCount: 1 },
  { date: '2026-08-22', state: 'conflicted', itemCount: 1, completedCount: 0 },
]

const budgets = [{
  id: 'budget-august', name: '八月生活预算', scope: { kind: 'all-life' },
  period: { kind: 'monthly', startsOn: '2026-08-01', endsOn: '2026-08-31' },
  limitMinor: 120000, thresholds: [0.7, 0.9, 1], rolloverMinor: 0, version: 1,
  createdAt: timestamp, updatedAt: timestamp, spentMinor: 68400, remainingMinor: 51600,
  thresholdStatus: 'warning', forecast: { status: 'complete', projectedMinor: 108000 },
}]

const shopping = {
  suggestions: [{
    id: 'suggestion-oats', kind: 'suggestion', origin: 'derived', through: '2026-08-23', itemId: '燕麦',
    requiredQuantity: 40, suggestedQuantity: 500, unit: 'g', packageQuantity: 500,
    reasons: [{ id: 'reason-oats', kind: 'planned_shortage', sourceType: 'day-plan', sourceId: 'day-2026-08-21', requiredQuantity: 40, sourceQuantity: 80, sourceUnit: 'g', conversionFactor: 1, requiredOn: '2026-08-21', createdAt: timestamp }],
    createdAt: timestamp, updatedAt: timestamp,
  }],
  formalItems: [],
}

const emptyState = { schemaVersion: 1, plans: [], records: [], reviews: [], knowledge: [], snapshots: [] }

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

export async function installLifeFixture(page: Page) {
  await page.clock.setFixedTime(new Date('2026-08-21T09:00:00+08:00'))
  await page.route('**/api/v1/**', (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (path === '/api/v1/auth/session') return json(route, { user: { id: 'user-life-p3-t8', account: 'life-p3-t8@lifeops.local', displayName: 'Life Tester' }, csrfToken: 'csrf-life-p3-t8' })
    if (path === '/api/v1/state') return json(route, emptyState)
    if (path === '/api/v1/goals' || path === '/api/v1/tasks' || path === '/api/v1/records' || path === '/api/v1/reviews') return json(route, [])
    if (path === '/api/v1/habits') return json(route, { from: url.searchParams.get('from'), to: url.searchParams.get('to'), habits: [], entries: [] })
    if (/^\/api\/v1\/goals\/[^/]+\/projects$/.test(path)) return json(route, [])
    if (path === '/api/v1/life/calendar') return json(route, calendar)
    if (path === '/api/v1/life/budgets') return json(route, budgets)
    if (path === '/api/v1/life/shopping') return json(route, shopping)
    const projectionMatch = path.match(/^\/api\/v1\/life\/day-plans\/(\d{4}-\d{2}-\d{2})\/projection$/)
    if (projectionMatch) return json(route, projection(projectionMatch[1]!))
    const dayPlanMatch = path.match(/^\/api\/v1\/life\/day-plans\/(\d{4}-\d{2}-\d{2})$/)
    if (dayPlanMatch && request.method() === 'GET') return json(route, dayPlan(dayPlanMatch[1]!))
    if (dayPlanMatch && path.endsWith('/copy') && request.method() === 'POST') return json(route, dayPlan(String(request.postDataJSON()?.targetDate ?? '2026-08-24')))
    const copyMatch = path.match(/^\/api\/v1\/life\/day-plans\/(\d{4}-\d{2}-\d{2})\/copy$/)
    if (copyMatch && request.method() === 'POST') return json(route, dayPlan(String(request.postDataJSON()?.targetDate ?? '2026-08-24')))
    const timelineMatch = path.match(/^\/api\/v1\/life\/timeline\/(\d{4}-\d{2}-\d{2})$/)
    if (timelineMatch) return json(route, timeline(timelineMatch[1]!))
    return json(route, { error: { code: 'UNHANDLED_FIXTURE_ROUTE', message: `${request.method()} ${path}` } }, 404)
  })
}
