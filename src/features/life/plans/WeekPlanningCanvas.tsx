import { useState } from 'react'
import type { DayPlan, LifePlanItem, MealSlot, PlanningTimelineItem } from '../../../domain/lifePlanning'

const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const kindNames: Record<LifePlanItem['kind'], string> = {
  meal: '饮食', supplement: '补剂', medicine: '用药事实', fitness: '健身', custom: '自定义',
}

function dayLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00`)
  return `${weekdays[parsed.getDay()]} ${parsed.getMonth() + 1}月${parsed.getDate()}日`
}

function PlanChip({ item, moved, onEdit, onMedicineBackfill }: {
  item: LifePlanItem
  moved: boolean
  onEdit: (item: LifePlanItem, placementOnly?: boolean) => void
  onMedicineBackfill: (item: LifePlanItem) => void
}) {
  return <article className={`life-plan-chip life-plan-chip--${item.kind}`}>
    <span>{kindNames[item.kind]}</span>
    <strong>{item.title}</strong>
    <small>{item.scheduledTime ?? '待安排'}{item.servings != null ? ` · ${item.servings} 份` : ''}{item.durationMinutes != null ? ` · ${item.durationMinutes} 分钟` : ''}</small>
    <div>
      <button type="button" onClick={() => onEdit(item, moved)} aria-label={`${moved ? '重新安排' : '编辑'}${item.title}`}>{moved ? '重新安排' : '编辑'}</button>
      {item.kind === 'medicine' && item.status !== 'completed' ? <button type="button" onClick={() => onMedicineBackfill(item)} aria-label={`补记${item.title}`}>补记</button> : null}
    </div>
  </article>
}

interface Props {
  dates: string[]
  plans: Record<string, DayPlan>
  selectedDate: string
  timeline: PlanningTimelineItem[]
  movedIds: Set<string>
  onSelectDate: (date: string) => void
  onMove: (itemId: string, mealSlotId: string) => void
  onEdit: (item: LifePlanItem, placementOnly?: boolean) => void
  onMedicineDelay: (item: Extract<PlanningTimelineItem, { sourceType: 'medicine-occurrence' }>) => void
  onMedicineSkip: (item: Extract<PlanningTimelineItem, { sourceType: 'medicine-occurrence' }>) => void
  onMedicineBackfill: (item: LifePlanItem) => void
}

export function WeekPlanningCanvas({ dates, plans, selectedDate, timeline, movedIds, onSelectDate, onMove, onEdit, onMedicineDelay, onMedicineSkip, onMedicineBackfill }: Props) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const selected = plans[selectedDate]
  const slots: MealSlot[] = selected?.mealSlots ?? []
  const items = selected?.items ?? []
  const occurrenceItems = timeline.filter((item): item is Extract<PlanningTimelineItem, { sourceType: 'medicine-occurrence' }> => item.sourceType === 'medicine-occurrence')

  return <>
    <nav className="life-plan-day-nav" aria-label="本周日期">
      {dates.map((date) => <button key={date} type="button" aria-pressed={date === selectedDate} onClick={() => onSelectDate(date)}>{dayLabel(date)}</button>)}
    </nav>
    <section className="life-week-canvas" role="region" aria-label="周计划画布">
      {dates.map((date) => {
        const dayPlan = plans[date]
        const selectedColumn = date === selectedDate
        return <article key={date} className={selectedColumn ? 'is-selected' : ''} aria-label={`${dayLabel(date)}计划`}>
          <header><span>{dayLabel(date).split(' ')[0]}</span><strong>{date.slice(5).replace('-', '/')}</strong><small>{dayPlan?.items.length ?? 0} 项</small></header>
          {selectedColumn ? <div className="life-week-day-detail">
            {slots.filter((slot) => !slot.hidden).sort((a, b) => a.position - b.position).map((slot) => <section
              key={slot.id}
              data-testid={`meal-slot-${slot.id}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => { if (draggedId) onMove(draggedId, slot.id); setDraggedId(null) }}
            >
              <h2>{slot.name}</h2>
              {items.filter((item) => item.mealSlotId === slot.id).map((item) => <PlanChip key={item.id} item={item} moved={movedIds.has(item.id)} onEdit={onEdit} onMedicineBackfill={onMedicineBackfill} />)}
            </section>)}
            <section className="life-week-unplaced">
              <h2>未安排</h2>
              {items.filter((item) => item.mealSlotId == null).map((item) => <div key={item.id} draggable onDragStart={() => setDraggedId(item.id)}>
                <button type="button" aria-label={`安排${item.title}`} onClick={() => onEdit(item, true)}>
                  <strong>{item.title}</strong><span>{item.scheduledTime ?? '拖到餐次，或使用菜单安排'}</span>
                </button>
                {item.mealSlotId == null && item.scheduledTime != null ? <PlanChip item={item} moved={movedIds.has(item.id)} onEdit={onEdit} onMedicineBackfill={onMedicineBackfill} /> : null}
              </div>)}
              {occurrenceItems.map((item) => <article className="life-plan-chip life-plan-chip--medicine" key={item.id}>
                <span>用药事实</span><strong>{item.title}</strong><small>{item.scheduledTime} · {item.quantity} {item.unit}</small>
                <div><button type="button" aria-label={`推迟${item.title}`} onClick={() => onMedicineDelay(item)}>推迟</button><button type="button" aria-label={`跳过${item.title}`} onClick={() => onMedicineSkip(item)}>跳过</button></div>
              </article>)}
            </section>
          </div> : <div className="life-week-day-summary">
            {(dayPlan?.items ?? []).slice(0, 3).map((item) => <span key={item.id}>{item.scheduledTime ?? '待排'} · {item.title}</span>)}
            {!dayPlan?.items.length ? <span>安静的一天</span> : null}
          </div>}
        </article>
      })}
    </section>
    <aside className="life-week-summary"><span>周概览</span><strong>{Object.values(plans).reduce((sum, entry) => sum + entry.items.length, 0)} 项计划</strong><p>移动端以单日为主，仍保留这份整周摘要。</p></aside>
  </>
}
