import { useEffect, useRef, useState } from 'react'
import type { PlanTemplate, TemplateSyncPreview } from '../../../domain/lifePlanning'

interface Props {
  templates: PlanTemplate[]
  selectedDate: string
  onClose: () => void
  onPreviewTemplate: (template: PlanTemplate) => void
  onPreviewSync: (template: PlanTemplate, input: { fromDate: string; target: 'future-incomplete' | 'selected'; dates?: string[] }) => Promise<TemplateSyncPreview>
  onConfirmSync: (template: PlanTemplate, preview: TemplateSyncPreview, input: { fromDate: string; target: 'future-incomplete' | 'selected'; dates?: string[] }) => Promise<void>
}

function addDays(date: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function TemplateLibrary({ templates, selectedDate, onClose, onPreviewTemplate, onPreviewSync, onConfirmSync }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [syncTemplate, setSyncTemplate] = useState<PlanTemplate | null>(null)
  const [fromDate, setFromDate] = useState(addDays(selectedDate, 1))
  const [target, setTarget] = useState<'future-incomplete' | 'selected'>('future-incomplete')
  const [dates, setDates] = useState<string[]>([])
  const [preview, setPreview] = useState<TemplateSyncPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const candidateBase = /^\d{4}-\d{2}-\d{2}$/.test(fromDate) ? fromDate : selectedDate
  const candidates = Array.from({ length: 7 }, (_, index) => addDays(candidateBase, index))
  useEffect(() => { closeRef.current?.focus() }, [])

  if (syncTemplate) {
    const input = { fromDate, target, ...(target === 'selected' ? { dates } : {}) }
    return <div className="life-plan-task-layer life-plan-task-layer--deep" onKeyDown={(event) => { if (event.key === 'Escape') setSyncTemplate(null) }}>
      <button type="button" aria-label="取消显式同步范围" onClick={() => setSyncTemplate(null)} />
      <section role="dialog" aria-modal="true" aria-label="显式同步范围">
        <header><div><span>Explicit sync</span><h2>显式同步范围</h2></div><button type="button" onClick={() => setSyncTemplate(null)}>返回</button></header>
        <div className="template-sync__body">
          <p>模板不会静默覆盖日期。只会写入确认预览中列出的未完成日期。</p>
          <div className="template-sync__controls">
            <label>同步目标<select value={target} onChange={(event) => { setTarget(event.target.value as typeof target); setPreview(null) }}><option value="future-incomplete">未来未完成日期</option><option value="selected">仅选中日期</option></select></label>
            <label>起始日期<input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setDates([]); setPreview(null) }} /></label>
          </div>
          {target === 'selected' ? <fieldset><legend>选择日期</legend>{candidates.map((date) => <label key={date}><input type="checkbox" checked={dates.includes(date)} onChange={(event) => setDates((current) => event.target.checked ? [...current, date].sort() : current.filter((entry) => entry !== date))} />{date}</label>)}</fieldset> : null}
          {preview ? <section className="template-sync__preview" aria-live="polite"><strong>将更新 {preview.affectedDates.length} 天</strong><p>{preview.affectedDates.join('、')}</p><p>已完成而排除：{preview.excludedCompletedDates.join('、') || '无'}</p></section> : null}
        </div>
        <footer>
          <button type="button" disabled={busy || (target === 'selected' && !dates.length)} onClick={async () => { setBusy(true); try { setPreview(await onPreviewSync(syncTemplate, input)) } finally { setBusy(false) } }}>预览同步</button>
          <button type="button" disabled={!preview || busy} onClick={async () => { if (!preview) return; setBusy(true); try { await onConfirmSync(syncTemplate, preview, input); onClose() } finally { setBusy(false) } }}>确认显式同步</button>
        </footer>
      </section>
    </div>
  }

  return <div className="life-plan-task-layer" onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
    <button type="button" aria-label="取消模板与同步" onClick={onClose} />
    <section role="dialog" aria-modal="true" aria-label="模板与同步">
      <header><div><span>Templates</span><h2>模板与同步</h2></div><button ref={closeRef} type="button" onClick={onClose}>关闭</button></header>
      <div className="template-library__body">
        <p>模板负责重复结构；应用后的日期是独立事实，后续同步必须再次预览确认。</p>
        {templates.length ? <ol>{templates.map((template) => <li key={template.id}><div><strong>{template.name}</strong><span>版本 {template.entityVersion} · {template.items.length} 项 · {template.mealSlots.length} 餐次</span></div><div><button type="button" onClick={() => onPreviewTemplate(template)}>预览{template.name}</button><button type="button" onClick={() => setSyncTemplate(template)}>同步{template.name}</button></div></li>)}</ol> : <div className="template-library__empty"><strong>还没有模板</strong><p>可以先保存一份自定义餐次和计划结构。</p></div>}
      </div>
    </section>
  </div>
}
