import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { PublicDraft, PublicDraftStatus, PublicRevision, PublicRevisionDiff, PublicRevisionView, PublicSourceType, UpdatePublicDraftInput } from '../../domain/publishing'
import { PrivacyReview } from './PrivacyReview'
import { PublicDraftEditor } from './PublicDraftEditor'
import { PublicPreview } from './PublicPreview'
import { RevisionHistory } from './RevisionHistory'
import { SourceLibrary } from './SourceLibrary'
import { usePublishing } from './usePublishing'

export interface PublishingSourceItem { type: PublicSourceType; id: string; title: string; updatedAt: string }
export type PublishingWorkspaceStatus = 'loading' | 'ready' | 'empty' | 'network-error' | 'forbidden' | 'conflict' | 'disconnected'
export interface PublishingController {
  status: PublishingWorkspaceStatus
  drafts: PublicDraft[]
  sources: PublishingSourceItem[]
  selected?: PublicDraft
  preview?: PublicRevisionView
  revisions: PublicRevision[]
  diff?: PublicRevisionDiff
  isSaving: boolean
  createStandalone: () => Promise<PublicDraft>
  createFromSource: (source: Pick<PublishingSourceItem, 'type' | 'id'>) => Promise<PublicDraft>
  select: (id?: string) => void
  update: (id: string, input: UpdatePublicDraftInput) => Promise<PublicDraft>
  previewDraft: (id: string) => Promise<PublicRevisionView>
  publish: (id: string, version: number) => Promise<void>
  schedule: (id: string, version: number, scheduledAt: string) => Promise<void>
  revoke: (id: string, version: number) => Promise<void>
  loadDiff: (id: string, from: number, to: number) => Promise<void>
  retry: () => void
}
export interface PublishingPageProps { controller?: PublishingController }

const statuses = new Set<PublicDraftStatus>(['draft', 'scheduled', 'published', 'revoked'])
const errorMessage: Partial<Record<PublishingWorkspaceStatus, string>> = {
  'network-error': '发布工作台暂时无法读取，请检查连接后重试。',
  forbidden: '你没有访问发布工作台的权限。',
  conflict: '公开草稿已在另一处更新；本地内容没有覆盖服务器版本。',
  disconnected: '当前设备离线；未保存内容只保留在本次浏览器会话。',
}

function observeMutation(promise: Promise<unknown>) {
  void promise.catch(() => {
    // The controller exposes the actionable error state inside the workbench.
  })
}

function PublishingWorkspace({ controller }: { controller: PublishingController }) {
  const [params, setParams] = useSearchParams()
  const requestedStatus = params.get('status') as PublicDraftStatus | null
  const status = requestedStatus && statuses.has(requestedStatus) ? requestedStatus : 'draft'
  const [mobileLevel, setMobileLevel] = useState<'source' | 'edit' | 'preview'>('source')
  const [theme, setTheme] = useState<'day' | 'night'>('day')
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [confirmedVersion, setConfirmedVersion] = useState<number>()
  const [dirty, setDirty] = useState(false)
  const [liveDraft, setLiveDraft] = useState<PublicDraft>()
  const selected = controller.selected
  const confirmed = Boolean(selected && confirmedVersion === selected.version && !dirty)

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  useEffect(() => { setConfirmedVersion(undefined); setDirty(false); setLiveDraft(undefined) }, [selected?.id, selected?.version])

  const leaveEditor = (next: 'source' | 'edit' | 'preview') => {
    if (dirty && !window.confirm('公开草稿还有未保存修改，确定离开吗？')) return
    setMobileLevel(next)
    queueMicrotask(() => document.querySelector<HTMLButtonElement>(next === 'source' ? '.publishing-mobile-next' : '.publishing-mobile-back')?.focus())
  }

  const changeStatus = (nextStatus: PublicDraftStatus) => {
    const next = new URLSearchParams(params)
    next.set('status', nextStatus)
    next.delete('draft')
    setParams(next, { replace: false })
  }

  const failure = errorMessage[controller.status]
  return (
    <article className="publishing-page" data-mobile-level={mobileLevel} data-testid="publishing-page">
      <header className="publishing-page__heading"><div><p>Publishing desk</p><h1>发布</h1><span>公开的是不可变副本；私人来源仍留在工作台内。</span></div><a href="/api/v1/public/feed.xml">RSS</a></header>
      {failure ? <div className="publishing-page__error" role="alert"><p>{failure}</p><button type="button" onClick={controller.retry}>重新加载发布工作台</button></div> : null}
      {controller.status === 'loading' ? <p className="publishing-page__loading" role="status">正在整理发布来源与草稿…</p> : null}
      <div className="publishing-workspace" data-layout="3/5/4">
        <SourceLibrary controller={controller} status={status} onStatus={changeStatus} onMobileEdit={() => { setMobileLevel('edit'); queueMicrotask(() => document.querySelector<HTMLButtonElement>('.publishing-editor .publishing-mobile-back')?.focus()) }} />
        {selected ? <PublicDraftEditor
          draft={selected}
          isSaving={controller.isSaving}
          onBack={() => leaveEditor('source')}
          onDirty={() => { setDirty(true); setConfirmedVersion(undefined) }}
          onLiveChange={setLiveDraft}
          onPreview={() => { observeMutation(controller.previewDraft(selected.id)); setMobileLevel('preview') }}
          onSave={async (input) => { await controller.update(selected.id, input); setDirty(false); setConfirmedVersion(undefined) }}
        /> : <section aria-label="公开草稿编辑器" className="publishing-editor is-empty" data-grid-span="5" role="region"><h2>选择来源或新建草稿</h2><p>来源只提供一份可编辑副本，不会和公开页面保持隐藏联动。</p></section>}
        {selected ? <PublicPreview content={controller.preview ?? liveDraft ?? selected} device={device} onBack={() => leaveEditor('edit')} onDevice={setDevice} onTheme={setTheme} theme={theme} /> : <section aria-label="公开内容预览" className="publishing-preview is-empty" data-grid-span="4" data-preview-device={device} data-preview-theme={theme} role="region"><h2>预览会出现在这里</h2></section>}
      </div>
      {selected ? <div className="publishing-review-grid">
        <PrivacyReview confirmed={confirmed} draft={selected} isSaving={controller.isSaving} onConfirm={(value) => setConfirmedVersion(value ? selected.version : undefined)} onPublish={() => controller.publish(selected.id, selected.version)} onRevoke={() => controller.revoke(selected.id, selected.version)} onSchedule={(scheduledAt) => controller.schedule(selected.id, selected.version, scheduledAt)} />
        <RevisionHistory diff={controller.diff} draft={selected} revisions={controller.revisions} onCompare={(from, to) => controller.loadDiff(selected.id, from, to)} />
      </div> : null}
    </article>
  )
}

function ConnectedPublishingPage() {
  return <PublishingWorkspace controller={usePublishing()} />
}

export function PublishingPage({ controller }: PublishingPageProps = {}) {
  return controller ? <PublishingWorkspace controller={controller} /> : <ConnectedPublishingPage />
}
