import { useEffect, useRef, useState } from 'react'
import type { DayPlan, PlanTemplate, TemplateApplicationPreview, TemplateConflictResolution } from '../../../domain/lifePlanning'

interface Props {
  template: PlanTemplate
  dayPlan: DayPlan
  preview: TemplateApplicationPreview
  onCancel: () => void
  onConfirm: (resolution: TemplateConflictResolution) => void
}

export function PlanConflictPreview({ template, dayPlan, preview, onCancel, onConfirm }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [choice, setChoice] = useState<'keep' | TemplateConflictResolution>('keep')
  useEffect(() => { closeRef.current?.focus() }, [])
  const conflict = preview.conflicts[0]
  const current = dayPlan.items.find((item) => conflict?.existingItemIds.includes(item.id))
  const incoming = template.items.find((item) => item.id === conflict?.incomingTemplateItemId)

  return <div className="life-plan-task-layer life-plan-task-layer--deep" onKeyDown={(event) => { if (event.key === 'Escape') onCancel() }}>
    <button type="button" aria-label="取消模板冲突预览" onClick={onCancel} />
    <section role="dialog" aria-modal="true" aria-label="模板冲突预览">
      <header><div><span>Conflict preview · no writes</span><h2>模板冲突预览</h2></div><button ref={closeRef} type="button" onClick={onCancel}>关闭</button></header>
      <div className="plan-conflict-preview__body">
        <p>日期计划应用后与模板保持独立。这里的选择只影响本次确认。</p>
        <div className="plan-conflict-preview__comparison">
          <article><span>当前</span><strong>{current?.title ?? '当前日期无冲突项'}</strong><p>当前：{current?.title ?? '无'}</p></article>
          <article><span>模板</span><strong>{incoming?.title ?? '模板新增项'}</strong><p>模板：{incoming?.title ?? '无'}</p></article>
        </div>
        <fieldset>
          <legend>冲突处理</legend>
          <label><input type="radio" name="resolution" checked={choice === 'keep'} onChange={() => setChoice('keep')} />保留当前</label>
          <label><input type="radio" name="resolution" checked={choice === 'merge'} onChange={() => setChoice('merge')} />合并两边</label>
          <label><input type="radio" name="resolution" checked={choice === 'replace'} onChange={() => setChoice('replace')} />替换当前</label>
          <label><input type="radio" name="resolution" checked={choice === 'skip'} onChange={() => setChoice('skip')} />跳过本日</label>
        </fieldset>
        <dl><div><dt>模板版本</dt><dd>{preview.templateVersion}</dd></div><div><dt>日期版本</dt><dd>{preview.dayPlanVersion}</dd></div><div><dt>写入</dt><dd>尚未发生</dd></div></dl>
      </div>
      <footer><button type="button" onClick={onCancel}>返回模板</button><button type="button" onClick={() => onConfirm(choice === 'keep' ? 'skip' : choice)}>确认应用模板</button></footer>
    </section>
  </div>
}
