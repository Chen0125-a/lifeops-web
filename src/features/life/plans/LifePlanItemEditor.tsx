import { useEffect, useMemo, useRef, useState } from 'react'
import type { LifePlanItem, MealSlot } from '../../../domain/lifePlanning'

export interface SupplementLink {
  mealSlotId: string
  relativeToItemIndex: number
  offsetMinutes: number
  scheduledTime: string
}

interface Props {
  item: LifePlanItem
  mealSlots: MealSlot[]
  placementOnly?: boolean
  initialLink?: SupplementLink | null
  onCancel: () => void
  onSave: (item: LifePlanItem, link?: SupplementLink | null) => void
}

function relativeTime(time: string | null, offset: number) {
  if (!time) return null
  const [hours, minutes] = time.split(':').map(Number)
  const value = ((hours * 60 + minutes + offset) % 1_440 + 1_440) % 1_440
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

export function LifePlanItemEditor({ item, mealSlots, placementOnly = false, initialLink, onCancel, onSave }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [mealSlotId, setMealSlotId] = useState(item.mealSlotId ?? '')
  const [scheduledTime, setScheduledTime] = useState(item.scheduledTime ?? '')
  const [servings, setServings] = useState(item.servings == null ? '' : String(item.servings))
  const [durationMinutes, setDurationMinutes] = useState(item.durationMinutes == null ? '' : String(item.durationMinutes))
  const [offsetMinutes, setOffsetMinutes] = useState(initialLink?.offsetMinutes == null ? '15' : String(initialLink.offsetMinutes))

  useEffect(() => { closeRef.current?.focus() }, [])

  const linkedTime = useMemo(() => {
    if (item.kind !== 'supplement' || !mealSlotId) return null
    const anchor = item.mealSlotId === mealSlotId && item.scheduledTime
      ? relativeTime(item.scheduledTime, -(initialLink?.offsetMinutes ?? 15))
      : mealSlotId === 'breakfast' ? '07:30' : mealSlotId === 'dinner' ? '19:00' : scheduledTime
    return relativeTime(anchor, Number(offsetMinutes) || 0)
  }, [initialLink?.offsetMinutes, item.kind, item.mealSlotId, item.scheduledTime, mealSlotId, offsetMinutes, scheduledTime])

  const save = () => {
    const nextTime = item.kind === 'supplement' && linkedTime ? linkedTime : scheduledTime || null
    const next: LifePlanItem = {
      ...item,
      mealSlotId: mealSlotId || null,
      scheduledTime: nextTime,
      servings: item.kind === 'meal' ? (servings === '' ? null : Number(servings)) : item.servings,
      durationMinutes: durationMinutes === '' ? null : Number(durationMinutes),
    }
    const link = item.kind === 'supplement' && mealSlotId && linkedTime
      ? { mealSlotId, relativeToItemIndex: 0, offsetMinutes: Number(offsetMinutes) || 0, scheduledTime: linkedTime }
      : null
    onSave(next, link)
  }

  const title = placementOnly ? `安排${item.title}` : `编辑${item.title}`
  return (
    <div className="life-plan-task-layer" onKeyDown={(event) => { if (event.key === 'Escape') onCancel() }}>
      <button type="button" aria-label={`取消${title}`} onClick={onCancel} />
      <section role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div><span>{placementOnly ? 'Placement' : 'Plan item'}</span><h2>{title}</h2></div>
          <button ref={closeRef} type="button" onClick={onCancel}>关闭</button>
        </header>
        <div className="life-plan-item-editor__body">
          <label>餐次
            <select value={mealSlotId} onChange={(event) => setMealSlotId(event.target.value)}>
              <option value="">未安排餐次</option>
              {mealSlots.filter((slot) => !slot.hidden).sort((a, b) => a.position - b.position).map((slot) => <option key={slot.id} value={slot.id}>{slot.name}</option>)}
            </select>
          </label>
          <label>时间
            <input type="time" value={scheduledTime} onChange={(event) => setScheduledTime(event.target.value)} disabled={item.kind === 'supplement' && Boolean(mealSlotId)} />
          </label>
          {item.kind === 'meal' && !placementOnly ? <label>份数
            <input type="number" min="0.1" step="0.1" value={servings} onChange={(event) => setServings(event.target.value)} />
          </label> : null}
          {item.durationMinutes != null || item.kind === 'fitness' || item.kind === 'custom' ? <label>时长（分钟）
            <input type="number" min="0" step="1" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} />
          </label> : null}
          {item.kind === 'supplement' && !placementOnly ? <>
            <label>关联餐次
              <select value={mealSlotId} onChange={(event) => setMealSlotId(event.target.value)}>
                <option value="">不关联餐次</option>
                {mealSlots.filter((slot) => !slot.hidden).sort((a, b) => a.position - b.position).map((slot) => <option key={slot.id} value={slot.id}>{slot.name}</option>)}
              </select>
            </label>
            <label>相对分钟
              <input type="number" step="1" value={offsetMinutes} onChange={(event) => setOffsetMinutes(event.target.value)} />
            </label>
            {mealSlotId && linkedTime ? <p className="life-plan-item-editor__relative">{mealSlots.find((slot) => slot.id === mealSlotId)?.name}后 {offsetMinutes} 分钟 · {linkedTime}</p> : null}
          </> : null}
        </div>
        <footer>
          <button type="button" onClick={onCancel}>取消</button>
          <button type="button" onClick={save}>{placementOnly ? '确认安排' : '保存本地编辑'}</button>
        </footer>
      </section>
    </div>
  )
}
