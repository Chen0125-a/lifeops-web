import { useState } from 'react'
import type { PublicDraft } from '../../domain/publishing'

export function PrivacyReview({ confirmed, draft, isSaving, onConfirm, onPublish, onRevoke, onSchedule }: {
  confirmed: boolean
  draft: PublicDraft
  isSaving: boolean
  onConfirm: (confirmed: boolean) => void
  onPublish: () => Promise<void>
  onRevoke: () => Promise<void>
  onSchedule: (scheduledAt: string) => Promise<void>
}) {
  const [scheduledAt, setScheduledAt] = useState('')
  const scheduleIso = scheduledAt ? new Date(scheduledAt).toISOString() : ''
  return (
    <section aria-label="公开前隐私检查" className="publishing-privacy" role="region">
      <header><p>Privacy gate</p><h2>离开私人空间之前，再看一遍</h2></header>
      <div className="publishing-privacy__fields"><span>标题</span><span>摘要</span><span>正文</span><span>媒体</span><span>标签</span><span>SEO</span></div>
      <p>不会公开：来源 ID、来源版本、所有者、私人关系与计划时间</p>
      <label className="publishing-privacy__confirm"><input aria-label="我已确认公开字段" checked={confirmed} type="checkbox" onChange={(event) => onConfirm(event.target.checked)} /><span>我已确认公开字段</span><small>确认仅绑定当前版本 v{draft.version}；任何编辑都会要求重新确认。</small></label>
      <div className="publishing-privacy__schedule"><label><span>计划发布时间</span><input aria-label="计划发布时间" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label><button type="button" disabled={!confirmed || !scheduledAt || isSaving} onClick={() => void onSchedule(scheduleIso).catch(() => {})}>计划发布</button></div>
      <div className="publishing-privacy__actions"><button className="is-primary" type="button" disabled={!confirmed || isSaving} onClick={() => void onPublish().catch(() => {})}>立即发布</button><button className="is-danger" type="button" disabled={isSaving} onClick={() => void onRevoke().catch(() => {})}>撤回公开</button></div>
    </section>
  )
}
