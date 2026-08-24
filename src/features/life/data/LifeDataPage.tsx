import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { lifeCommerceApi } from '../../../api/lifeCommerceApi'
import { HttpError } from '../../../api/httpClient'
import { queryKeys } from '../../../api/queryKeys'
import { reviewsApi } from '../../../api/reviewsApi'
import type { ExportJob, ImportPreview as ImportPreviewValue, ImportResolution } from '../../../domain/lifeCommerce'
import { applyVaultBatch, connectFileSystemVault, type DirectoryHandleLike } from '../../../integrations/obsidian/fileSystemVault'
import { buildLifeImportMutations, type LifeImportPlan, type LifeImportResolution } from '../../../integrations/obsidian/lifeImportPlan'
import {
  exportLifeProjectionZip,
  parseLifeProjectionMarkdown,
  previewLifeProjectionZip,
  projectLifeKnowledge,
  serializeLifeProjection,
  type LifeProjectionDocument,
} from '../../../integrations/obsidian/lifeProjection'
import { useAuth } from '../../../state/AuthContext'
import { ImportPreview } from './ImportPreview'
import { LifeObsidianPanel, type LifeObsidianConnection } from './LifeObsidianPanel'
import { TrashWorkspace } from './TrashWorkspace'

type DataSection = 'export' | 'import' | 'trash' | 'obsidian'

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<DirectoryHandleLike>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function downloadLifeZip(documents: LifeProjectionDocument[]) {
  const bytes = exportLifeProjectionZip(documents)
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'lifeops-life-obsidian.zip'
  link.click()
  queueMicrotask(() => URL.revokeObjectURL(url))
}

function mutationKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

const countLabels: Record<string, string> = {
  catalogItems: '目录物品', shoppingItems: '正式采购', shoppingSuggestions: '采购建议', purchases: '采购', refunds: '退款', budgets: '预算', media: '附件', mediaAssets: '附件',
}

function recordCountLine(recordCounts: Record<string, number>) {
  return Object.entries(recordCounts).map(([key, value]) => `${countLabels[key] ?? key} ${value}`).join(' · ')
}

function dataErrorMessage(error: unknown, action: 'export' | 'preview' | 'apply') {
  if (error instanceof HttpError) {
    if (error.status === 0 || error.code === 'NETWORK_ERROR') return `当前设备离线，${action === 'export' ? '导出没有生成' : action === 'preview' ? '预览没有完成' : '导入没有写入'}。`
    if (error.status === 403) return '当前账户没有权限执行这项数据操作。'
    if (error.status === 409) return '生活数据已在另一处更新。请重新预览并逐项确认冲突。'
  }
  if (error instanceof Error) return error.message
  return action === 'export' ? '导出没有生成，请重新载入后重试。' : action === 'preview' ? '导入预览失败；没有写入任何生活数据。' : '导入事务失败'
}

function ExportDialog({ pending, onClose, onCreate }: { pending: boolean; onClose(): void; onCreate(format: 'json' | 'zip', includeAttachments: boolean): Promise<void> }) {
  const [format, setFormat] = useState<'json' | 'zip'>('json')
  const [includeAttachments, setIncludeAttachments] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  return <div className="life-commerce-layer" onKeyDown={(event) => { if (event.key === 'Escape' && !pending) onClose() }}>
    <button type="button" aria-label="取消创建导出" onClick={onClose} disabled={pending} />
    <section role="dialog" aria-modal="true" aria-label="创建生活数据导出">
      <header><div><span>Portable archive</span><h2>创建生活数据导出</h2></div><button ref={closeRef} type="button" onClick={onClose} disabled={pending}>关闭</button></header>
      <div className="purchase-confirm__body">
        <label>格式<select value={format} onChange={(event) => setFormat(event.target.value as 'json' | 'zip')}><option value="json">JSON</option><option value="zip">ZIP</option></select></label>
        <label className="life-commerce-check"><input type="checkbox" checked={includeAttachments} onChange={(event) => setIncludeAttachments(event.target.checked)} />包含私有附件</label>
        {includeAttachments ? <p>附件仍保持私有；导出包不会变成公开发布内容。</p> : <p>默认只包含结构化生活数据，不包含私有附件二进制。</p>}
      </div>
      <footer><button type="button" onClick={onClose} disabled={pending}>取消</button><button type="button" disabled={pending} onClick={() => void onCreate(format, includeAttachments)}>{pending ? '正在生成…' : '生成导出包'}</button></footer>
    </section>
  </div>
}

function ApplyConfirmation({ mode, pending, onClose, onConfirm }: { mode: 'merge' | 'replace'; pending: boolean; onClose(): void; onConfirm(): Promise<void> }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  const replace = mode === 'replace'
  return <div className="life-commerce-layer" onKeyDown={(event) => { if (event.key === 'Escape' && !pending) onClose() }}>
    <button type="button" aria-label="取消应用导入" onClick={onClose} disabled={pending} />
    <section role="dialog" aria-modal="true" aria-label={replace ? '确认替换生活数据' : '确认合并生活数据'}>
      <header><div><span>Atomic write boundary</span><h2>{replace ? '确认替换生活数据' : '确认合并生活数据'}</h2></div><button ref={closeRef} type="button" onClick={onClose} disabled={pending}>关闭</button></header>
      <div className="purchase-confirm__body"><p>{replace ? '服务端会先创建恢复点；任何失败都必须回滚，当前数据保持不变。' : '服务端会在一个事务中应用已预览的行；任何失败都不会留下部分写入。'}</p></div>
      <footer><button type="button" onClick={onClose} disabled={pending}>取消</button><button type="button" disabled={pending} onClick={() => void onConfirm()}>{pending ? '正在应用…' : replace ? '创建恢复点并替换' : '确认合并'}</button></footer>
    </section>
  </div>
}

export function LifeDataPage() {
  const auth = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawSection = searchParams.get('section')
  const section: DataSection = rawSection === 'import' || rawSection === 'trash' || rawSection === 'obsidian' ? rawSection : 'export'
  const headingRef = useRef<HTMLHeadingElement>(null)
  const sourceExportRef = useRef<Extract<ExportJob, { format: 'json' }> | undefined>(undefined)
  const exportsQuery = useQuery({ queryKey: queryKeys.lifeCommerce.list({ view: 'exports' }), queryFn: ({ signal }) => lifeCommerceApi.listExports(signal) })
  const reviewsQuery = useQuery({
    queryKey: queryKeys.reviews.list({ includeArchived: true }),
    queryFn: ({ signal }) => reviewsApi.list({ includeArchived: true }, signal),
    enabled: section === 'obsidian',
  })
  const [exportsOverride, setExportsOverride] = useState<ExportJob[] | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [writeError, setWriteError] = useState('')
  const [notice, setNotice] = useState('')
  const [canonicalJson, setCanonicalJson] = useState('')
  const [checksum, setChecksum] = useState('')
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [preview, setPreview] = useState<ImportPreviewValue | null>(null)
  const [resolutions, setResolutions] = useState<ImportResolution[]>([])
  const [confirmationOpen, setConfirmationOpen] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [section])

  useEffect(() => {
    let timer = 0
    let frame = 0
    const restoreFocusAfterHistory = () => {
      timer = window.setTimeout(() => {
        frame = requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }))
      }, 0)
    }
    window.addEventListener('popstate', restoreFocusAfterHistory)
    return () => {
      window.removeEventListener('popstate', restoreFocusAfterHistory)
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
    }
  }, [])

  const selectSection = (next: DataSection) => {
    setSearchParams({ section: next })
    setNotice('')
    setWriteError('')
  }

  const createExport = async (format: 'json' | 'zip', includeAttachments: boolean) => {
    setBusy(true)
    setWriteError('')
    try {
      const result = await lifeCommerceApi.createExport({ format, includeAttachments }, mutationKey('export'), auth.csrfToken)
      setExportsOverride((current) => [result, ...(current ?? exportsQuery.data ?? [])])
      setExportOpen(false)
      setNotice(`导出 ${result.id} 已生成并通过 SHA-256 标识`)
    } catch (error) {
      setWriteError(dataErrorMessage(error, 'export'))
    } finally {
      setBusy(false)
    }
  }

  const runPreview = async () => {
    setBusy(true)
    setWriteError('')
    setNotice('')
    try {
      let formatVersion = 1
      try {
        const parsed = JSON.parse(canonicalJson) as { formatVersion?: unknown }
        if (typeof parsed.formatVersion === 'number') formatVersion = parsed.formatVersion
      } catch {
        // The server preview returns the canonical row-level parse error.
      }
      const result = await lifeCommerceApi.previewImport({ formatVersion, checksumSha256: checksum, canonicalJson, mode }, mutationKey('import-preview'), auth.csrfToken)
      setPreview(result)
      setResolutions([])
    } catch (error) {
      setPreview(null)
      setWriteError(dataErrorMessage(error, 'preview'))
    } finally {
      setBusy(false)
    }
  }

  const resolve = (resolution: ImportResolution) => setResolutions((current) => [
    ...current.filter((entry) => !(entry.entityType === resolution.entityType && entry.entityId === resolution.entityId)),
    resolution,
  ])

  const applyImport = async () => {
    if (!preview) return
    setBusy(true)
    setWriteError('')
    try {
      const result = await lifeCommerceApi.applyImport(preview.id, resolutions, mutationKey('import-apply'), auth.csrfToken)
      setNotice(`已应用 ${result.appliedRows} 行 · 恢复点 ${result.restorePointExportId}`)
      setConfirmationOpen(false)
      setPreview(null)
    } catch (error) {
      const details = error && typeof error === 'object' && 'details' in error ? (error as { details?: { restorePointExportId?: string; appliedRows?: number } }).details : undefined
      const message = dataErrorMessage(error, 'apply')
      setWriteError(`${message}。已应用 ${details?.appliedRows ?? 0} 行；当前生活数据未改变${details?.restorePointExportId ? `；恢复点 ${details.restorePointExportId} 可用于审计` : ''}`)
      setConfirmationOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const exports = exportsOverride ?? exportsQuery.data ?? []
  const sourceExport = exports.find((job): job is Extract<ExportJob, { format: 'json' }> => job.format === 'json')
  sourceExportRef.current = sourceExport
  const lifeDocuments = useMemo(() => projectLifeKnowledge({
    payload: sourceExport?.payload ?? { catalogItems: [], shoppingItems: [], purchases: [], refunds: [], budgets: [] },
    reviews: reviewsQuery.data ?? [],
  }), [reviewsQuery.data, sourceExport])
  const directorySupported = typeof window !== 'undefined' && typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function'

  const refreshLifeDocuments = async () => {
    const [freshExport, freshReviews] = await Promise.all([
      lifeCommerceApi.createExport({ format: 'json', includeAttachments: false }, mutationKey('obsidian-source'), auth.csrfToken),
      reviewsApi.list({ includeArchived: true }),
    ])
    if (freshExport.format !== 'json') throw new Error('Life Obsidian 需要 JSON 事实快照。')
    sourceExportRef.current = freshExport
    setExportsOverride((current) => [freshExport, ...(current ?? exportsQuery.data ?? []).filter(({ id }) => id !== freshExport.id)])
    return projectLifeKnowledge({ payload: freshExport.payload, reviews: freshReviews })
  }

  const connectLifeObsidian = async (): Promise<LifeObsidianConnection> => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker
    if (!picker) throw new Error('当前浏览器不支持文件夹连接。')
    const handle = await picker({ mode: 'readwrite' })
    const permission = await handle.queryPermission({ mode: 'readwrite' })
    if (permission !== 'granted') {
      return {
        permission,
        vaultName: handle.name,
        scan: async () => [],
        apply: async () => ({ backupPath: null, completedPaths: [], failedPaths: [] }),
      }
    }
    const { adapter } = await connectFileSystemVault(async () => handle, { save: async () => undefined })
    return {
      permission,
      vaultName: handle.name,
      scan: async () => Promise.all((await adapter.scanLife()).map(async (path) => parseLifeProjectionMarkdown(decoder.decode(await adapter.read(path)), path))),
      apply: async (plan: LifeImportPlan, lifeResolutions: Record<string, LifeImportResolution>) => {
        const mutations = buildLifeImportMutations(plan, lifeResolutions)
        let importPreviewId: string | undefined
        if (mutations.length) {
          const currentExport = sourceExportRef.current
          if (!currentExport) throw new Error('当前事实快照已失效；请重新扫描。')
          const draftPayload = {
            ...currentExport.payload,
            obsidianProjectionDrafts: mutations.map(({ kind, action }) => {
              const value = action.vault
              if (!value) throw new Error(`导入候选 ${action.key} 缺少 Obsidian 版本。`)
              return {
                action: kind,
                lifeopsId: value.lifeopsId,
                type: value.type,
                version: value.version,
                updatedAt: value.updatedAt,
                title: value.title,
                tags: value.tags,
                markdown: serializeLifeProjection(value),
              }
            }),
          }
          const canonicalJson = stableJson(draftPayload)
          const preview = await lifeCommerceApi.previewImport({
            formatVersion: 1,
            checksumSha256: await sha256(canonicalJson),
            canonicalJson,
            mode: 'merge',
          }, mutationKey('obsidian-import-preview'), auth.csrfToken)
          importPreviewId = preview.id
        }

        const writes = new Map<string, { path: string; bytes: Uint8Array }>()
        const addWrite = (value: LifeProjectionDocument | null) => {
          if (value) writes.set(value.path, { path: value.path, bytes: encoder.encode(serializeLifeProjection(value)) })
        }
        for (const action of plan.actions) {
          if (action.kind === 'create-vault' || action.kind === 'update-vault') addWrite(action.web)
          else if (action.kind === 'conflict' && lifeResolutions[action.key] === 'keep-web') addWrite(action.web)
          else if (action.kind === 'conflict' && lifeResolutions[action.key] === 'manual-merge') addWrite(action.vault)
          else if (action.kind === 'recipe-version-draft' && lifeResolutions[action.key] === 'keep-web') addWrite(action.web)
        }
        const result = writes.size
          ? await applyVaultBatch(adapter, [...writes.values()], new Date())
          : { backupPath: null, completedPaths: [], failedPaths: [] }
        return { ...result, importPreviewId }
      },
    }
  }

  return <main className="life-commerce-workspace life-data-management">
    <header className="life-commerce-heading">
      <div><span>Portability & recovery</span><h1 ref={headingRef} tabIndex={-1}>生活数据管理</h1><p>导出、预览、冲突决策、原子导入与关系安全回收站在同一处，但每一步都保留独立边界。</p></div>
    </header>
    <nav className="life-data-tabs" aria-label="生活数据分区">
      <div role="tablist" aria-label="导出、导入、回收站与 Obsidian">
        <button type="button" role="tab" aria-selected={section === 'export'} onClick={() => selectSection('export')}>导出</button>
        <button type="button" role="tab" aria-selected={section === 'import'} onClick={() => selectSection('import')}>导入</button>
        <button type="button" role="tab" aria-selected={section === 'trash'} onClick={() => selectSection('trash')}>回收站</button>
        <button type="button" role="tab" aria-selected={section === 'obsidian'} onClick={() => selectSection('obsidian')}>Obsidian</button>
      </div>
    </nav>
    {writeError ? <div className="life-data-error" role="alert"><strong>操作未完成</strong><p>{writeError}</p><button type="button" onClick={() => setWriteError('')}>关闭</button></div> : null}

    {section === 'export' ? <section className="life-export-section">
      <header><div><span>Versioned archive</span><h2>可验证导出</h2></div><button type="button" onClick={() => setExportOpen(true)}>创建导出</button></header>
      {exportsQuery.isPending ? <p role="status">正在读取导出记录…</p> : exportsQuery.error ? <div role="alert"><p>导出记录暂时无法加载。</p><button type="button" onClick={() => void exportsQuery.refetch()}>重新加载</button></div> : <div className="life-export-manifest" role="region" aria-label="导出清单">{exports.length ? <ol>{exports.map((job) => <li key={job.id}><header><div><strong>{job.format.toUpperCase()} · {job.id}</strong><span>{job.reason === 'pre-import-restore-point' ? '导入前恢复点' : '用户导出'}</span></div><time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString('zh-CN')}</time></header><dl><div><dt>版本</dt><dd>格式版本 {job.formatVersion}</dd></div><div><dt>校验</dt><dd>SHA-256 {job.checksumSha256}</dd></div><div><dt>记录</dt><dd>{recordCountLine(job.recordCounts)}</dd></div></dl>{job.format === 'zip' ? <p>{job.archiveEntries.join(' · ')}</p> : null}</li>)}</ol> : <div className="life-commerce-empty"><strong>还没有导出</strong><p>创建后会显示格式版本、记录清单和 SHA-256。</p></div>}</div>}
    </section> : null}

    {section === 'import' ? <section className="life-import-section">
      <header><div><span>Preview before write</span><h2>导入生活数据</h2></div><p>先验证校验和、版本、关系与冲突，再决定是否写入。</p></header>
      <div className="life-import-form">
        <label>导入 JSON<textarea rows={8} value={canonicalJson} onChange={(event) => setCanonicalJson(event.target.value)} placeholder="粘贴完整的 LifeOps JSON 导出" /></label>
        <label>SHA-256<input value={checksum} onChange={(event) => setChecksum(event.target.value.trim())} placeholder="64 位十六进制校验值" /></label>
        <fieldset><legend>导入方式</legend><label><input type="radio" name="import-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />合并到现有生活数据</label><label><input type="radio" name="import-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />替换现有生活数据</label></fieldset>
        <button type="button" disabled={busy || !canonicalJson || checksum.length !== 64} onClick={() => void runPreview()}>{busy ? '正在预览…' : '只预览，不写入'}</button>
      </div>
      {preview ? <ImportPreview preview={preview} resolutions={resolutions} onResolve={resolve} onApply={() => setConfirmationOpen(true)} /> : null}
    </section> : null}

    {section === 'trash' ? <TrashWorkspace embedded /> : null}
    {section === 'obsidian' ? <section className="life-obsidian-section">
      {exportsQuery.isPending || reviewsQuery.isPending ? <p role="status">正在准备最新生活知识投影…</p> : null}
      {exportsQuery.error || reviewsQuery.error ? <p role="alert">生活事实暂时无法读取；没有扫描或写入 Obsidian。</p> : null}
      <LifeObsidianPanel
        documents={lifeDocuments}
        supported={directorySupported}
        connect={connectLifeObsidian}
        refreshDocuments={refreshLifeDocuments}
        onExportZip={downloadLifeZip}
        onImportZip={async (file) => previewLifeProjectionZip(new Uint8Array(await file.arrayBuffer()))}
      />
    </section> : null}
    {notice ? <p className="life-commerce-notice" role="status" aria-label={section === 'import' ? '导入结果' : '导出结果'}>{notice}</p> : null}
    {exportOpen ? <ExportDialog pending={busy} onClose={() => setExportOpen(false)} onCreate={createExport} /> : null}
    {confirmationOpen ? <ApplyConfirmation mode={mode} pending={busy} onClose={() => setConfirmationOpen(false)} onConfirm={applyImport} /> : null}
  </main>
}
