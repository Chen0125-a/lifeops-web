import type { PublicDraftStatus, PublicSourceType } from '../../domain/publishing'
import type { PublishingController } from './PublishingPage'

const sourceLabel: Record<PublicSourceType, string> = {
  plan: '计划', record: '记录', review: '回顾', knowledge: '知识',
}

const tabs: Array<{ value: PublicDraftStatus; label: string }> = [
  { value: 'draft', label: '草稿' },
  { value: 'scheduled', label: '计划中' },
  { value: 'published', label: '已发布' },
  { value: 'revoked', label: '已撤回' },
]

export function SourceLibrary({ controller, onMobileEdit, onStatus, status }: {
  controller: PublishingController
  onMobileEdit: () => void
  onStatus: (status: PublicDraftStatus) => void
  status: PublicDraftStatus
}) {
  const drafts = controller.drafts.filter((draft) => draft.status === status)
  return (
    <section aria-label="发布来源库" className="publishing-sources" data-grid-span="3" role="region">
      <header><p>Source library</p><h2>从私人事实取一份副本</h2><button type="button" onClick={() => void controller.createStandalone().then(onMobileEdit).catch(() => {})}>新建独立草稿</button></header>
      <div aria-label="发布状态" className="publishing-status-tabs" role="tablist">
        {tabs.map((tab) => <button aria-selected={status === tab.value} key={tab.value} onClick={() => onStatus(tab.value)} role="tab" type="button">{tab.label} {controller.drafts.filter((draft) => draft.status === tab.value).length}</button>)}
      </div>
      <ul className="publishing-source-list" aria-label="可复制来源">
        {controller.sources.map((source) => <li key={`${source.type}:${source.id}`}><button type="button" aria-label={`${sourceLabel[source.type]} · ${source.title}`} onClick={() => void controller.createFromSource({ type: source.type, id: source.id }).then(onMobileEdit).catch(() => {})}>
          <span>{sourceLabel[source.type]}</span><strong>{source.title}</strong><time dateTime={source.updatedAt}>{source.updatedAt.slice(0, 10)}</time>
        </button></li>)}
      </ul>
      <ul className="publishing-draft-list" aria-label={`${tabs.find((tab) => tab.value === status)?.label ?? status}列表`}>
        {drafts.map((draft) => <li key={draft.id}><button aria-current={controller.selected?.id === draft.id ? 'true' : undefined} onClick={() => { controller.select(draft.id); onMobileEdit() }} type="button"><span>{draft.category}</span><strong>{draft.title}</strong><small>v{draft.version} · {draft.updatedAt.slice(0, 10)}</small></button></li>)}
        {!drafts.length ? <li className="publishing-draft-list__empty">当前状态还没有草稿。</li> : null}
      </ul>
      <button className="publishing-mobile-next" type="button" onClick={onMobileEdit} disabled={!controller.selected}>下一步：编辑公开草稿</button>
    </section>
  )
}
