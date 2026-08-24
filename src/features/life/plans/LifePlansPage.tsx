import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { lifePlanningApi } from '../../../api/lifePlanningApi'
import { HttpError } from '../../../api/httpClient'
import type {
  DayPlan,
  LifePlanItem,
  MedicineRecurrenceOccurrence,
  PlanTemplate,
  PlanningTimelineItem,
  TemplateApplicationPreview,
  TemplateConflictResolution,
  TemplateSyncPreview,
  UpdateDayPlanInput,
} from '../../../domain/lifePlanning'
import { LifePlanItemEditor, type SupplementLink } from './LifePlanItemEditor'
import { PlanConflictPreview } from './PlanConflictPreview'
import { TemplateLibrary } from './TemplateLibrary'
import { WeekPlanningCanvas } from './WeekPlanningCanvas'

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function localDateKey() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function mondayOf(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`)
  const offset = (value.getUTCDay() + 6) % 7
  value.setUTCDate(value.getUTCDate() - offset)
  return value.toISOString().slice(0, 10)
}

function mutationKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function planningErrorMessage(error: unknown, action: 'load' | 'write') {
  if (error instanceof HttpError) {
    if (error.status === 0 || error.code === 'NETWORK_ERROR') return '当前设备离线。计划事实仍保留，请联网后重试。'
    if (error.status === 403) return '当前账户没有权限执行这项计划操作。'
    if (error.status === 409) return '计划已在另一处更新。请重新载入后再提交。'
  }
  return action === 'load' ? '计划事实暂时无法加载。' : '这次计划更改没有保存。'
}

type EditingState = { item: LifePlanItem; placementOnly: boolean } | null

function itemInput(item: LifePlanItem, link?: SupplementLink | null) {
  return {
    kind: item.kind,
    title: item.title,
    mealSlotId: item.mealSlotId,
    scheduledTime: item.scheduledTime,
    source: item.source,
    quantity: item.quantity,
    unit: item.unit,
    servings: item.servings,
    durationMinutes: item.durationMinutes,
    ...(link ? { relativeToItemIndex: link.relativeToItemIndex, offsetMinutes: link.offsetMinutes } : {}),
  }
}

export function LifePlansPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedDate = searchParams.get('day') ?? searchParams.get('date') ?? localDateKey()
  const weekStart = searchParams.get('week') ?? mondayOf(selectedDate)
  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const [plans, setPlans] = useState<Record<string, DayPlan>>({})
  const [timeline, setTimeline] = useState<PlanningTimelineItem[]>([])
  const [templates, setTemplates] = useState<PlanTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [editing, setEditing] = useState<EditingState>(null)
  const [movedIds, setMovedIds] = useState<Set<string>>(new Set())
  const [supplementLinks, setSupplementLinks] = useState<Record<string, SupplementLink>>({})
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templatePreview, setTemplatePreview] = useState<{ template: PlanTemplate; preview: TemplateApplicationPreview } | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyTarget, setCopyTarget] = useState(addDays(selectedDate, 7))
  const [delayOccurrence, setDelayOccurrence] = useState<MedicineRecurrenceOccurrence | null>(null)
  const [delayDate, setDelayDate] = useState(addDays(selectedDate, 1))
  const [delayTime, setDelayTime] = useState('09:30')
  const [busy, setBusy] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError(null)
    Promise.all([
      Promise.all(dates.map((date) => lifePlanningApi.getDayPlan(date, controller.signal))),
      lifePlanningApi.getTimeline(selectedDate, controller.signal),
      lifePlanningApi.getDayProjection(selectedDate, controller.signal),
      lifePlanningApi.listTemplates(controller.signal),
      lifePlanningApi.listFitness(controller.signal),
    ]).then(([loadedPlans, loadedTimeline, _projection, loadedTemplates]) => {
      setPlans(Object.fromEntries(loadedPlans.map((plan) => [plan.date, plan])))
      setTimeline(loadedTimeline.timelineItems)
      setTemplates(loadedTemplates)
      setLoading(false)
      requestAnimationFrame(() => headingRef.current?.focus())
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setLoading(false)
      setLoadError(planningErrorMessage(error, 'load'))
    })
    return () => controller.abort()
  }, [dates, retry, selectedDate])

  const selectedPlan = plans[selectedDate]
  const selectDate = (date: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('week', weekStart)
    next.set('day', date)
    setSearchParams(next, { replace: true })
  }
  const updateItem = (nextItem: LifePlanItem, link?: SupplementLink | null) => {
    setPlans((current) => ({
      ...current,
      [selectedDate]: {
        ...current[selectedDate],
        items: current[selectedDate].items.map((item) => item.id === nextItem.id ? nextItem : item),
      },
    }))
    if (link !== undefined) {
      setSupplementLinks((current) => {
        const next = { ...current }
        if (link) next[nextItem.id] = link
        else delete next[nextItem.id]
        return next
      })
    }
    setEditing(null)
  }
  const moveItem = (itemId: string, mealSlotId: string) => {
    const item = selectedPlan?.items.find((entry) => entry.id === itemId)
    if (!item) return
    updateItem({ ...item, mealSlotId })
    setMovedIds((current) => new Set(current).add(itemId))
  }

  const runWrite = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    setWriteError(null)
    try {
      await operation()
    } catch (error) {
      setWriteError(planningErrorMessage(error, 'write'))
    } finally {
      setBusy(false)
    }
  }

  const saveDay = () => runWrite(async () => {
    if (!selectedPlan) return
    const input: UpdateDayPlanInput = {
      entityVersion: selectedPlan.entityVersion,
      mealSlots: selectedPlan.mealSlots,
      items: selectedPlan.items.map((item) => ({
        id: item.id,
        entityVersion: item.entityVersion,
        ...itemInput(item, supplementLinks[item.id]),
      })),
    }
    const saved = await lifePlanningApi.updateDayPlan(selectedPlan.date, input, undefined)
    setPlans((current) => ({ ...current, [saved.date]: saved }))
  })

  const openTemplatePreview = async (template: PlanTemplate) => {
    if (!selectedPlan) return
    await runWrite(async () => {
      const preview = await lifePlanningApi.previewTemplate(selectedDate, { templateId: template.id, resolution: 'merge' })
      setTemplatePreview({ template, preview })
    })
  }
  const applyTemplate = (resolution: TemplateConflictResolution) => runWrite(async () => {
    if (!templatePreview || !selectedPlan) return
    const saved = await lifePlanningApi.applyTemplate(selectedDate, {
      templateId: templatePreview.template.id,
      resolution,
      entityVersion: selectedPlan.entityVersion,
      templateVersion: templatePreview.preview.templateVersion,
    }, mutationKey('apply-template'), undefined)
    setPlans((current) => ({ ...current, [saved.date]: saved }))
    setTemplatePreview(null)
    setTemplateOpen(false)
  })

  const skipOccurrence = (item: MedicineRecurrenceOccurrence) => runWrite(async () => {
    await lifePlanningApi.transitionMedicineOccurrence(item.id, {
      entityVersion: item.entityVersion,
      action: 'skip',
      at: new Date().toISOString(),
    }, mutationKey('skip-medicine'), undefined)
  })
  const backfillItem = (item: LifePlanItem) => runWrite(async () => {
    await lifePlanningApi.transitionItem(selectedDate, item.id, {
      entityVersion: item.entityVersion,
      action: 'backfill',
      at: new Date().toISOString(),
    }, undefined)
  })

  if (loading) return <main className="life-plans-workspace is-loading" aria-busy="true"><span className="life-plan-skeleton" /><p>正在展开这一周…</p></main>
  if (loadError) return <main className="life-plans-workspace"><div className="life-plans-load-error" role="alert"><strong>计划暂时无法载入</strong><p>{loadError}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>重试周计划</button></div></main>
  if (!selectedPlan) return <main className="life-plans-workspace"><div className="life-plans-empty"><h1 ref={headingRef} tabIndex={-1}>周生活计划</h1><p>所选日期还没有计划事实。</p></div></main>

  return <main className="life-plans-workspace">
    {writeError ? <div className="life-plan-write-error" role="alert"><strong>这次更改没有保存</strong><span>{writeError}</span><button type="button" onClick={() => setWriteError(null)}>关闭</button></div> : null}
    <header className="life-plans-workspace__heading">
      <div><span>Week of {weekStart}</span><h1 ref={headingRef} tabIndex={-1}>周生活计划</h1><p>计划与实际分开。拖动、菜单、模板与完成都写回同一组真实事实。</p></div>
      <div><button type="button" onClick={() => setCopyOpen(true)}>复制当天计划</button><button type="button" onClick={() => setTemplateOpen(true)}>模板与同步</button><button type="button" disabled={busy} onClick={() => void saveDay()}>保存当天计划</button></div>
    </header>
    <section className="life-plans-workspace__facts" aria-label="当天计划事实">
      <div><span>当前日期</span><strong>{selectedDate}</strong></div>
      <div><span>计划项目</span><strong>{selectedPlan.items.length}</strong></div>
      <div><span>完成事实</span><strong>{selectedPlan.items.filter((item) => item.status === 'completed').length}</strong></div>
      <div><span>用药边界</span><strong>仅用户事实</strong></div>
    </section>
    <WeekPlanningCanvas
      dates={dates}
      plans={plans}
      selectedDate={selectedDate}
      timeline={timeline}
      movedIds={movedIds}
      onSelectDate={selectDate}
      onMove={moveItem}
      onEdit={(item, placementOnly = false) => setEditing({ item, placementOnly })}
      onMedicineDelay={(item) => { setDelayOccurrence(item); setDelayDate(addDays(item.scheduledDate, 1)); setDelayTime(item.scheduledTime) }}
      onMedicineSkip={(item) => void skipOccurrence(item)}
      onMedicineBackfill={(item) => void backfillItem(item)}
    />
    <p className="life-plans-workspace__medicine-boundary">仅记录你提供的时间与状态，不提供诊断、剂量或停药建议。</p>

    {editing ? <LifePlanItemEditor item={editing.item} mealSlots={selectedPlan.mealSlots} placementOnly={editing.placementOnly} initialLink={supplementLinks[editing.item.id] ?? null} onCancel={() => setEditing(null)} onSave={updateItem} /> : null}
    {templateOpen ? <TemplateLibrary
      templates={templates}
      selectedDate={selectedDate}
      onClose={() => setTemplateOpen(false)}
      onPreviewTemplate={(template) => void openTemplatePreview(template)}
      onPreviewSync={(template, input) => lifePlanningApi.previewSync(template.id, input)}
      onConfirmSync={async (template, preview, input) => {
        await lifePlanningApi.syncTemplate(template.id, {
          ...input,
          templateVersion: preview.templateVersion,
          dayPlanVersions: preview.dayPlanVersions,
        }, mutationKey('sync-template'), undefined)
      }}
    /> : null}
    {templatePreview ? <PlanConflictPreview template={templatePreview.template} dayPlan={selectedPlan} preview={templatePreview.preview} onCancel={() => setTemplatePreview(null)} onConfirm={(resolution) => void applyTemplate(resolution)} /> : null}
    {copyOpen ? <div className="life-plan-task-layer" onKeyDown={(event) => { if (event.key === 'Escape') setCopyOpen(false) }}>
      <button type="button" aria-label="取消复制当天计划" onClick={() => setCopyOpen(false)} />
      <section role="dialog" aria-modal="true" aria-label="复制当天计划">
        <header><div><span>Plan-only copy</span><h2>复制当天计划</h2></div><button type="button" onClick={() => setCopyOpen(false)}>关闭</button></header>
        <div className="life-plan-copy__body"><p>只复制计划字段；不会复制实际完成、历史或库存流水。</p><label>目标日期<input type="date" value={copyTarget} onChange={(event) => setCopyTarget(event.target.value)} /></label></div>
        <footer><button type="button" onClick={() => setCopyOpen(false)}>取消</button><button type="button" onClick={() => void runWrite(async () => { await lifePlanningApi.copyDayPlan(selectedDate, copyTarget, mutationKey('copy-day'), undefined); setCopyOpen(false) })}>确认复制</button></footer>
      </section>
    </div> : null}
    {delayOccurrence ? <div className="life-plan-task-layer life-plan-task-layer--deep" onKeyDown={(event) => { if (event.key === 'Escape') setDelayOccurrence(null) }}>
      <button type="button" aria-label="取消推迟用药事实" onClick={() => setDelayOccurrence(null)} />
      <section role="dialog" aria-modal="true" aria-label={`推迟${delayOccurrence.title}`}>
        <header><div><span>Factual reschedule</span><h2>推迟{delayOccurrence.title}</h2></div><button type="button" onClick={() => setDelayOccurrence(null)}>关闭</button></header>
        <div className="life-plan-copy__body"><p>原始时间 {delayOccurrence.originalDate} {delayOccurrence.originalTime} 永久保留。</p><label>新日期<input type="date" value={delayDate} onChange={(event) => setDelayDate(event.target.value)} /></label><label>新时间<input type="time" value={delayTime} onChange={(event) => setDelayTime(event.target.value)} /></label></div>
        <footer><button type="button" onClick={() => setDelayOccurrence(null)}>取消</button><button type="button" onClick={() => void runWrite(async () => { await lifePlanningApi.transitionMedicineOccurrence(delayOccurrence.id, { entityVersion: delayOccurrence.entityVersion, action: 'delay', at: new Date().toISOString(), delayedUntil: { date: delayDate, time: delayTime } }, mutationKey('delay-medicine'), undefined); setDelayOccurrence(null) })}>确认推迟</button></footer>
      </section>
    </div> : null}
  </main>
}

export const LifePlansRoute = () => <LifePlansPage />
