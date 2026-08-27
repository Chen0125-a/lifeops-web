import { useEffect, useMemo, useState } from 'react'
import { mediaApi } from '../../api/mediaApi'
import type { CreateRecordInput, LifeRecord, MediaAsset, RecordLink, UpdateRecordInput } from '../../domain/records'
import { MarkdownView } from '../../components/system/MarkdownView'
import { MediaUploader } from './MediaUploader'
import { useAutosave } from './useAutosave'

const linkLabels: Record<RecordLink['type'], string> = {
  goal: '目标',
  habit: '习惯',
  project: '项目',
  task: '任务',
}

function tags(value: string) {
  return [...new Set(value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))]
}

interface SharedEditorProps {
  csrfToken?: string
  isSaving: boolean
  onBack: () => void
  onDirtyChange: (dirty: boolean) => void
}

interface ExistingEditorProps extends SharedEditorProps {
  record: LifeRecord
  onDelete: (record: LifeRecord) => Promise<void>
  onUpdate: (id: string, input: UpdateRecordInput) => Promise<LifeRecord>
}

function ExistingRecordEditor({ csrfToken, isSaving, onBack, onDelete, onDirtyChange, onUpdate, record }: ExistingEditorProps) {
  const [title, setTitle] = useState(record.title)
  const [body, setBody] = useState(record.body)
  const [tagText, setTagText] = useState(record.tags.join('，'))
  const [previewOpen, setPreviewOpen] = useState(false)
  const draft = useMemo(() => JSON.stringify({ body, tags: tags(tagText), title }), [body, tagText, title])
  const autosave = useAutosave({
    delay: 800,
    draftKey: record.id,
    value: draft,
    version: record.version,
    save: async (value, version) => {
      const parsed = JSON.parse(value) as { body: string; tags: string[]; title: string }
      const updated = await onUpdate(record.id, { ...parsed, version })
      return { updatedAt: updated.updatedAt, version: updated.version }
    },
  })
  const dirty = ['dirty', 'saving', 'conflict', 'offline'].includes(autosave.status)

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const recover = () => {
    const recovered = autosave.recoverDraft()
    if (!recovered) return
    try {
      const parsed = JSON.parse(recovered) as { body?: unknown; tags?: unknown; title?: unknown }
      if (typeof parsed.title === 'string') setTitle(parsed.title)
      if (typeof parsed.body === 'string') setBody(parsed.body)
      if (Array.isArray(parsed.tags)) setTagText(parsed.tags.map(String).join('，'))
    } catch {
      setBody(recovered)
    }
  }

  const attach = async (asset: MediaAsset) => {
    await onUpdate(record.id, {
      mediaIds: [...record.mediaIds, asset.id],
      version: autosave.version,
    })
  }

  const selectCover = async (coverMediaId: string | null) => {
    await onUpdate(record.id, { coverMediaId, version: autosave.version })
  }

  const removeMedia = async (asset: MediaAsset) => {
    const mediaIds = record.mediaIds.filter((id) => id !== asset.id)
    await onUpdate(record.id, {
      mediaIds,
      ...(record.coverMediaId === asset.id ? { coverMediaId: null } : {}),
      version: autosave.version,
    })
  }

  return (
    <section className="record-editor" role="region" aria-label="记录编辑器" data-grid-span="4">
      <header className="record-editor__bar">
        <button className="record-editor__back" type="button" onClick={onBack}>返回记录流</button>
        <span className={`record-save-state is-${autosave.status}`} role="status" aria-live="polite">{autosave.statusLabel}</span>
      </header>
      {record.coverMediaId ? <img className="record-editor__cover" src={mediaApi.privateUrl(record.coverMediaId)} alt={`${record.title}封面`} /> : null}
      <div className="record-editor__fields">
        <label><span>标题</span><input aria-label="标题" value={title} maxLength={240} onChange={(event) => setTitle(event.target.value)} /></label>
        <label><span>Markdown 正文</span><textarea aria-label="Markdown 正文" value={body} rows={12} onChange={(event) => setBody(event.target.value)} /></label>
        <label><span>标签</span><input aria-label="标签" value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="生活，项目，复盘" /></label>
      </div>

      {record.links.length ? <section className="record-editor__links" aria-label="关联对象">
        <h3>关联对象</h3>
        <ul>{record.links.map((link) => <li key={`${link.type}:${link.id}`}>{linkLabels[link.type]} · {link.id}</li>)}</ul>
      </section> : null}

      <section className="record-editor__media" aria-label="已附着图片">
        <h3>图片与封面</h3>
        {record.mediaIds.length ? <ul>{record.mediaIds.map((id) => <li key={id}>
          <img src={mediaApi.privateUrl(id)} alt="" />
          <button type="button" aria-pressed={record.coverMediaId === id} onClick={() => void selectCover(id)}>
            {record.coverMediaId === id ? `当前封面 ${id}` : `设为封面 ${id}`}
          </button>
          <button type="button" onClick={() => void removeMedia({ id } as MediaAsset)}>移除图片 {id}</button>
        </li>)}</ul> : <p>尚未附着图片；封面不会从第一张图片隐式推断。</p>}
        <MediaUploader
          coverMediaId={record.coverMediaId}
          csrfToken={csrfToken}
          disabled={isSaving}
          onCoverChange={(id) => selectCover(id)}
          onRemove={(asset) => removeMedia(asset)}
          onUploaded={(asset) => attach(asset)}
        />
      </section>

      <details className="record-editor__preview" onToggle={(event) => setPreviewOpen(event.currentTarget.open)}>
        <summary>安全预览</summary>
        {previewOpen ? <MarkdownView className="record-editor__preview-content" source={body} /> : null}
      </details>
      <p className="record-editor__privacy"><strong>仅自己可见</strong>。公开必须进入独立发布流程，私人媒体地址不会自动写入 Markdown。</p>
      {autosave.status === 'offline' || autosave.status === 'conflict' ? <div className="record-editor__recovery" role="alert">
        <p>{autosave.status === 'conflict' ? '服务器版本已变化，本地草稿没有覆盖新内容。' : autosave.privacyNote}</p>
        <button type="button" onClick={recover}>恢复本地草稿</button>
      </div> : null}
      <footer className="record-editor__actions">
        <button type="button" disabled={isSaving} onClick={() => void onUpdate(record.id, { pinned: !record.pinned, version: autosave.version })}>
          {record.pinned ? '取消置顶' : '置顶记录'}
        </button>
        <button type="button" disabled={isSaving} onClick={() => void onUpdate(record.id, { archived: record.archivedAt == null, version: autosave.version })}>
          {record.archivedAt == null ? '归档记录' : '取消归档'}
        </button>
        <button className="is-danger" type="button" disabled={isSaving} onClick={() => void onDelete({ ...record, version: autosave.version })}>删除记录</button>
      </footer>
    </section>
  )
}

interface CreateEditorProps extends SharedEditorProps {
  sourceLink?: RecordLink
  onCreate: (input: CreateRecordInput) => Promise<LifeRecord>
}

function CreateRecordEditor({ csrfToken, isSaving, onBack, onCreate, onDirtyChange, sourceLink }: CreateEditorProps) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tagText, setTagText] = useState('')
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [coverMediaId, setCoverMediaId] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const dirty = Boolean(title || body || tagText || assets.length)

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const submit = async () => {
    if (!title.trim() || !body.trim()) return
    await onCreate({
      title: title.trim(),
      body: body.trim(),
      tags: tags(tagText),
      links: sourceLink ? [sourceLink] : [],
      mediaIds: assets.map((asset) => asset.id),
      coverMediaId,
    })
  }

  return (
    <section className="record-editor is-create" role="region" aria-label="记录编辑器" data-grid-span="4">
      <header className="record-editor__bar">
        <button className="record-editor__back" type="button" onClick={onBack}>返回记录流</button>
        <span className="record-save-state">{dirty ? '未创建' : '新记录'}</span>
      </header>
      <div className="record-editor__fields">
        <label><span>标题</span><input aria-label="标题" value={title} maxLength={240} onChange={(event) => setTitle(event.target.value)} autoFocus /></label>
        <label><span>Markdown 正文</span><textarea aria-label="Markdown 正文" value={body} rows={12} onChange={(event) => setBody(event.target.value)} /></label>
        <label><span>标签</span><input aria-label="标签" value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="生活，项目，复盘" /></label>
      </div>
      {sourceLink ? <p className="record-editor__source">来源：{linkLabels[sourceLink.type]} · {sourceLink.id}</p> : null}
      <MediaUploader
        coverMediaId={coverMediaId}
        csrfToken={csrfToken}
        disabled={isSaving}
        onCoverChange={(id) => setCoverMediaId(id)}
        onRemove={(asset) => {
          setAssets((current) => current.filter((item) => item.id !== asset.id))
          if (coverMediaId === asset.id) setCoverMediaId(null)
        }}
        onUploaded={(asset) => setAssets((current) => [...current, asset])}
      />
      {body ? <details className="record-editor__preview" onToggle={(event) => setPreviewOpen(event.currentTarget.open)}>
        <summary>安全预览</summary>
        {previewOpen ? <MarkdownView className="record-editor__preview-content" source={body} /> : null}
      </details> : null}
      <p className="record-editor__privacy">默认仅自己可见；公开必须进入独立发布流程。</p>
      <footer className="record-editor__actions">
        <button className="is-primary" type="button" disabled={isSaving || !title.trim() || !body.trim()} onClick={() => void submit()}>
          {isSaving ? '正在创建' : '创建记录'}
        </button>
      </footer>
    </section>
  )
}

export function RecordEditor(props: ExistingEditorProps | CreateEditorProps) {
  return 'record' in props ? <ExistingRecordEditor {...props} /> : <CreateRecordEditor {...props} />
}
