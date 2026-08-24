import { Link, useSearchParams } from 'react-router-dom'
import type { DayPlanProjection, LifePlanItemStatus, PlanningTimelineItem } from '../../domain/lifePlanning'
import type { LifeDayViewModel } from './useLifeDay'
import { useLifeDay } from './useLifeDay'

export interface LifeTodayPageProps {
  model: LifeDayViewModel
  date?: string
  onRetry?: () => void
}

const stateLabel: Record<LifePlanItemStatus | 'cancelled', string> = {
  planned: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  skipped: '已跳过',
  delayed: '已延后',
  cancelled: '已取消',
}

const kindLabel = { meal: '饮食', supplement: '补充剂', medicine: '用药事实', fitness: '健身', custom: '自定义' } as const

const nutritionMetrics = [
  ['energyKcal', '能量', 'kcal'],
  ['proteinG', '蛋白质', 'g'],
  ['fatG', '脂肪', 'g'],
  ['carbohydrateG', '碳水', 'g'],
  ['cookingOilG', '烹调油', 'g'],
] as const

function money(value: number) {
  return `¥${(value / 100).toFixed(2)}`
}

function nutritionValue(facts: Record<string, number> | null, key: string, unit: string) {
  const value = facts?.[key]
  return value === undefined ? '数据不完整' : `${value} ${unit}`
}

function hasActualFacts(projection: DayPlanProjection) {
  return Object.keys(projection.actualNutrition).length > 0
    || projection.actualCostMinor > 0
    || projection.items.some((item) => item.mode === 'actual' && item.status === 'complete')
}

function scheduledLabel(item: PlanningTimelineItem) {
  if (item.sourceType === 'medicine-occurrence') return item.scheduledTime
  return item.scheduledTime ?? '待安排'
}

export function LifeTodayPage({ model, onRetry }: LifeTodayPageProps) {
  if (model.status === 'loading') return <article className="life-today-state" aria-live="polite"><h1 tabIndex={-1}>今日生活</h1><p>正在汇总今天的生活事实…</p></article>
  if (model.status === 'error') return <article className="life-today-state"><h1 tabIndex={-1}>今日生活</h1><p role="alert">{model.error ?? '生活数据暂时无法加载。'}</p><button type="button" onClick={onRetry}>重新加载生活数据</button></article>

  const items = model.timeline?.timelineItems ?? []
  const nextAction = items.find((item) => !['completed', 'skipped', 'cancelled'].includes(item.status))
  const projection = model.projection
  const incomplete = projection?.status === 'incomplete' || projection?.inventory.some((item) => item.status === 'incomplete')
  const actionableInventory = projection?.inventory.filter((item) => item.status === 'incomplete' || item.shortage > 0) ?? []
  const actualFactsAvailable = projection ? hasActualFacts(projection) : false

  return (
    <article className="life-today" data-testid="life-today-canvas" data-layout="timeline/insights">
      <header className="life-today__heading">
        <div><p>Today · {model.date}</p><h1 tabIndex={-1}>今日生活</h1></div>
        <p role="status" aria-label="生活数据完整性" className={incomplete ? 'is-incomplete' : ''}>{incomplete ? '部分计划或实际数据不完整' : projection ? '计划与实际事实已汇总' : '今天还没有可汇总的生活数据'}</p>
      </header>

      <div className="life-today__grid">
        <section className="life-next-action" aria-label="下一行动">
          <span>下一行动</span>
          {nextAction ? <><strong>{nextAction.title}</strong><small>{scheduledLabel(nextAction)} · {stateLabel[nextAction.status]}</small></> : <><strong>为今天放入第一条生活计划</strong><Link to={`/app/life/plans?date=${encodeURIComponent(model.date)}`}>开始计划</Link></>}
        </section>

        <section className="life-timeline" aria-label="今日时间线" data-primary="true">
          <header><div><span>Primary</span><h2>今日时间线</h2></div><Link to={`/app/life/plans?date=${encodeURIComponent(model.date)}`}>编辑计划</Link></header>
          {items.length ? <ol>{items.map((item) => (
            <li key={item.id} data-status={item.status}>
              <time>{scheduledLabel(item)}</time>
              <span className="life-timeline__rail" aria-hidden="true" />
              <div><small>{kindLabel[item.kind]}</small><strong>{item.title}</strong></div>
              <span data-testid="life-item-status">{stateLabel[item.status]}</span>
            </li>
          ))}</ol> : <div className="life-empty"><p>今天还没有计划。先安排一餐、一次训练或一条由你自己记录的提醒。</p><Link to={`/app/life/plans?date=${encodeURIComponent(model.date)}`}>创建今天的计划</Link></div>}
        </section>

        <section className="life-nutrition" aria-label="营养与预算" data-secondary="true">
          <header><span>Secondary facts</span><h2>营养与预算</h2></header>
          <section aria-label="营养事实">
            <div className="life-fact-columns" aria-hidden="true"><span>指标</span><span>计划</span><span>实际</span></div>
            <dl>
              {nutritionMetrics.map(([key, label, unit]) => <div key={key}><dt>{label}</dt><dd>{projection ? nutritionValue(projection.plannedNutrition, key, unit) : '未计划'}</dd><dd>{projection && actualFactsAvailable ? nutritionValue(projection.actualNutrition, key, unit) : '数据不完整'}</dd></div>)}
              <div><dt>训练消耗</dt><dd>{projection ? `${projection.plannedEnergyKcal} kcal` : '未计划'}</dd><dd>{projection && actualFactsAvailable ? `${projection.actualEnergyKcal} kcal` : '数据不完整'}</dd></div>
              <div><dt>净能量</dt><dd>{projection ? nutritionValue(projection.plannedNutrition, 'netEnergyKcal', 'kcal') : '未计划'}</dd><dd>{projection && actualFactsAvailable ? nutritionValue(projection.actualNutrition, 'netEnergyKcal', 'kcal') : '数据不完整'}</dd></div>
            </dl>
          </section>
        </section>

        <section className={`life-inventory-notices ${actionableInventory.length ? 'has-actions' : ''}`} aria-label="库存与采购提醒">
          <header><div><span>Actionable only</span><h2>库存与采购提醒</h2></div><Link to="/app/life/ingredients">查看库存</Link></header>
          {actionableInventory.length ? <ul>{actionableInventory.map((item) => {
            const suggestion = model.shopping.suggestions.find((candidate) => candidate.itemId === item.itemId)
            return <li key={item.itemId}>{item.status === 'incomplete' ? <p><strong>{item.itemId}</strong>：数据不完整，缺少单位换算</p> : <p><strong>{item.itemId}</strong>预计短缺 {item.shortage} {item.baseUnit}</p>}{suggestion ? <span>建议采购 {suggestion.suggestedQuantity} {suggestion.unit}</span> : null}<Link to={`/app/life/shopping?item=${encodeURIComponent(item.itemId)}`}>处理{item.itemId}采购</Link></li>
          })}</ul> : <div className="life-empty is-compact"><p>{projection ? '当前计划没有可确认的库存短缺。' : '完成计划与库存资料后，这里会只显示需要处理的事实。'}</p><Link to="/app/life/ingredients">补全库存资料</Link></div>}
        </section>

        <section aria-label="成本与预算" className="life-budget">
          <header><span>Consumption ≠ cash</span><h2>成本与预算</h2></header>
          <div><span>{`计划消耗成本 ${projection?.plannedCostMinor === null || projection?.plannedCostMinor === undefined ? '数据不完整' : money(projection.plannedCostMinor)}`}</span></div>
          <div><span>{`实际消耗成本 ${projection && actualFactsAvailable ? money(projection.actualCostMinor) : '数据不完整'}`}</span></div>
          {model.budgets.length ? model.budgets.map((budget) => <div key={budget.id}><span>{`${budget.name} · 现金支出 ${money(budget.spentMinor)}`}</span><small>剩余 {money(budget.remainingMinor)} · {budget.forecast.status === 'complete' ? `预计 ${money(budget.forecast.projectedMinor)}` : '预测数据不足'}</small></div>) : <div><span>预算 尚未设置</span><Link to="/app/life/shopping?budget=create">设置预算</Link></div>}
        </section>
      </div>
    </article>
  )
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function LifeTodayRoute() {
  const [searchParams] = useSearchParams()
  const date = searchParams.get('date') ?? localDateKey()
  const model = useLifeDay(date)
  return <LifeTodayPage model={model} onRetry={model.retry} />
}
