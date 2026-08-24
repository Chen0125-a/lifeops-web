import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { settingsApi } from '../../api/settingsApi'
import { knowledgeApi } from '../../api/knowledgeApi'
import { queryKeys } from '../../api/queryKeys'
import { reviewsApi } from '../../api/reviewsApi'
import type { KnowledgeNote, KnowledgeSourceLink } from '../../domain/knowledge'
import type { Review } from '../../domain/reviews'
import type { SettingsDocument, UpdateSettingsInput } from '../../domain/settings'
import {
  applyVaultBatch,
  connectFileSystemVault,
  type DirectoryHandleLike,
  type VaultHandleStore,
} from '../../integrations/obsidian/fileSystemVault'
import { parseVaultDocument, serializeVaultDocument } from '../../integrations/obsidian/frontmatter'
import { buildSyncPlan } from '../../integrations/obsidian/syncPlan'
import type { SyncPlan, SyncPlanAction, VaultAdapter, VaultDocument, VaultDocumentType } from '../../integrations/obsidian/types'
import { exportVaultZip, previewVaultZip } from '../../integrations/obsidian/zipFallback'
import { useAuth } from '../../state/AuthContext'
import { ObsidianSettings, type ObsidianConflictChoice, type ObsidianConnection } from './ObsidianSettings'
import { AccountSettings } from './AccountSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { DataSecuritySettings } from './DataSecuritySettings'
import { PlatformConnections } from './PlatformConnections'

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<DirectoryHandleLike>
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

function pathFor(type: VaultDocumentType, id: string) {
  return `LifeOps/${type === 'knowledge' ? 'Knowledge' : 'Reviews'}/${encodeURIComponent(id)}.md`
}

function sourceValue(links: KnowledgeSourceLink[]) {
  const first = links[0]
  return first ? `${first.type}:${first.id}` : null
}

function sourceLinks(value: string | null): KnowledgeSourceLink[] {
  if (!value) return []
  const separator = value.indexOf(':')
  if (separator <= 0) return []
  const type = value.slice(0, separator)
  const id = value.slice(separator + 1)
  return ['record', 'review', 'goal', 'project'].includes(type) && id
    ? [{ type: type as KnowledgeSourceLink['type'], id }]
    : []
}

function projectKnowledge(note: KnowledgeNote, path = pathFor('knowledge', note.id)): VaultDocument {
  return {
    lifeopsId: note.id,
    type: 'knowledge',
    title: note.title,
    tags: [...note.tags],
    source: sourceValue(note.sourceLinks),
    updatedAt: note.updatedAt,
    syncRevision: note.version,
    body: note.body,
    path,
  }
}

const reviewSection = [
  ['做到的事', 'achievements'],
  ['遇到的问题', 'problems'],
  ['原因', 'causes'],
  ['新的理解', 'insights'],
  ['下一步变化', 'nextChanges'],
] as const

function reviewBody(review: Review) {
  return reviewSection.map(([label, field]) => `## ${label}\n\n${review[field].length ? review[field].map((item) => `- ${item}`).join('\n') : '- （空）'}`).join('\n\n')
}

function projectReview(review: Review, path = pathFor('review', review.id)): VaultDocument {
  return {
    lifeopsId: review.id,
    type: 'review',
    title: `${review.period.from} 至 ${review.period.to} 回顾`,
    tags: ['回顾', review.type],
    source: null,
    updatedAt: review.updatedAt,
    syncRevision: review.version,
    body: reviewBody(review),
    path,
  }
}

function parseReviewBody(body: string) {
  const fields: Record<(typeof reviewSection)[number][1], string[]> = {
    achievements: [], problems: [], causes: [], insights: [], nextChanges: [],
  }
  const matches = [...body.matchAll(/^##\s+(.+?)\s*$([\s\S]*?)(?=^##\s+|$)/gmu)]
  for (const match of matches) {
    const section = reviewSection.find(([label]) => label === match[1]?.trim())
    if (!section) continue
    fields[section[1]] = (match[2] ?? '').split('\n').map((line) => line.match(/^\s*-\s+(.+)$/u)?.[1]?.trim()).filter((value): value is string => Boolean(value && value !== '（空）'))
  }
  return fields
}

function expectedType(path: string): VaultDocumentType {
  if (path.startsWith('LifeOps/Knowledge/')) return 'knowledge'
  if (path.startsWith('LifeOps/Reviews/')) return 'review'
  throw new Error(`不支持的 Obsidian 路径：${path}`)
}

function idbRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })
}

async function openHandleDatabase() {
  const request = indexedDB.open('lifeops-obsidian', 1)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains('handles')) request.result.createObjectStore('handles')
  }
  return idbRequest(request)
}

const handleStore: VaultHandleStore = {
  async save(handle) {
    // Browser fixtures use plain-object handles, while native handles are structured-cloneable.
    if (import.meta.env.DEV && Object.getPrototypeOf(handle) === Object.prototype) return
    const database = await openHandleDatabase()
    try {
      const transaction = database.transaction('handles', 'readwrite')
      transaction.objectStore('handles').put(handle, 'selected-vault')
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error ?? new Error('无法保存 Obsidian 文件夹权限'))
        transaction.onabort = () => reject(transaction.error ?? new Error('保存 Obsidian 文件夹权限已中止'))
      })
    } finally {
      database.close()
    }
  },
}

function downloadZip(documents: VaultDocument[]) {
  const bytes = exportVaultZip(documents)
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'lifeops-obsidian.zip'
  link.click()
  queueMicrotask(() => URL.revokeObjectURL(url))
}

function dedupeWrites(writes: Array<{ path: string; bytes: Uint8Array }>) {
  const values = new Map(writes.map((write) => [write.path, write]))
  return [...values.values()].sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

function ObsidianSettingsPanel() {
  const { csrfToken } = useAuth()
  const adapterRef = useRef<VaultAdapter | undefined>(undefined)
  const [applyMessage, setApplyMessage] = useState<string>()
  const knowledgeQuery = useQuery({
    queryKey: queryKeys.knowledge.list({ includeArchived: true }),
    queryFn: ({ signal }) => knowledgeApi.list({ includeArchived: true }, signal),
  })
  const reviewsQuery = useQuery({
    queryKey: queryKeys.reviews.list({ includeArchived: true }),
    queryFn: ({ signal }) => reviewsApi.list({ includeArchived: true }, signal),
  })
  const notes = knowledgeQuery.data?.items ?? []
  const reviews = reviewsQuery.data ?? []
  const documents = useMemo(() => [
    ...notes.filter((note) => note.deletedAt == null).map((note) => projectKnowledge(note)),
    ...reviews.filter((review) => review.deletedAt == null).map((review) => projectReview(review)),
  ], [notes, reviews])
  const documentIndex = useMemo(() => new Map(documents.map((document) => [document.lifeopsId, document])), [documents])
  const supported = typeof window !== 'undefined' && typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function'

  const connect = async (): Promise<ObsidianConnection> => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker
    if (!picker) throw new Error('浏览器不支持文件夹连接。')
    const handle = await picker({ mode: 'readwrite' })
    const permission = await handle.queryPermission({ mode: 'readwrite' })
    if (permission !== 'granted') return { permission, vaultName: handle.name, scan: async () => ({ actions: [], hasConflicts: false }) }
    const connection = await connectFileSystemVault(async () => handle, handleStore)
    adapterRef.current = connection.adapter
    return {
      permission,
      vaultName: handle.name,
      scan: async () => {
        const paths = await connection.adapter.scan()
        const vaultDocuments = await Promise.all(paths.map(async (path) => parseVaultDocument(
          decoder.decode(await connection.adapter.read(path)),
          path,
          { expectedType: expectedType(path) },
        )))
        return buildSyncPlan(documents, vaultDocuments)
      },
    }
  }

  const writeWebDocument = async (document: VaultDocument, copy = false): Promise<VaultDocument> => {
    if (document.type === 'knowledge') {
      const existing = copy ? undefined : notes.find((note) => note.id === document.lifeopsId)
      const value = existing
        ? await knowledgeApi.update(existing.id, {
            body: document.body,
            sourceLinks: sourceLinks(document.source),
            tags: document.tags,
            title: document.title,
            version: existing.version,
          }, csrfToken)
        : await knowledgeApi.create({
            body: document.body,
            sourceLinks: sourceLinks(document.source),
            tags: document.tags,
            title: copy ? `${document.title}（Obsidian 副本）` : document.title,
          }, csrfToken)
      return projectKnowledge(value, copy ? pathFor('knowledge', value.id) : document.path)
    }

    const existing = copy ? undefined : reviews.find((review) => review.id === document.lifeopsId)
    const narrative = parseReviewBody(document.body)
    const today = new Date().toISOString().slice(0, 10)
    const value = existing
      ? await reviewsApi.update(existing.id, { ...narrative, version: existing.version }, csrfToken)
      : await reviewsApi.create({ type: 'custom', period: { from: today, to: today }, ...narrative }, `obsidian:${document.lifeopsId}:${document.syncRevision}`, csrfToken)
    return projectReview(value, copy ? pathFor('review', value.id) : document.path)
  }

  const apply = async (plan: SyncPlan, conflicts: Record<string, ObsidianConflictChoice>) => {
    const writes: Array<{ path: string; bytes: Uint8Array }> = []
    const addWrite = (document: VaultDocument) => writes.push({ path: document.path, bytes: encoder.encode(serializeVaultDocument(document)) })
    const writeVault = (action: SyncPlanAction) => { if (action.web) addWrite(action.web) }
    const writeWeb = async (action: SyncPlanAction, copy = false) => {
      if (!action.vault) return
      const next = await writeWebDocument(action.vault, copy)
      if (next.lifeopsId !== action.vault.lifeopsId || copy) addWrite(next)
    }

    for (const action of plan.actions) {
      if (action.kind === 'unchanged') continue
      if (action.kind === 'create-vault' || action.kind === 'update-vault') writeVault(action)
      else if (action.kind === 'create-web' || action.kind === 'update-web') await writeWeb(action)
      else {
        const choice = conflicts[action.lifeopsId]
        if (!choice) throw new Error(`冲突 ${action.lifeopsId} 尚未选择处理方式。`)
        if (choice === 'keep-web') writeVault(action)
        else if (choice === 'keep-obsidian') await writeWeb(action)
        else await writeWeb(action, true)
      }
    }

    const pendingWrites = dedupeWrites(writes)
    if (pendingWrites.length) {
      const adapter = adapterRef.current
      if (!adapter) throw new Error('当前没有可写的 Obsidian 文件夹；请重新连接后应用。')
      const result = await applyVaultBatch(adapter, pendingWrites, new Date())
      if (result.failedPaths.length) throw new Error(`同步已停止；失败路径：${result.failedPaths.join('、')}。备份保留在 ${result.backupPath}。`)
      setApplyMessage(`已应用 ${plan.actions.length} 项；写入前备份保留在 ${result.backupPath}。`)
    } else {
      setApplyMessage(`已应用 ${plan.actions.length} 项；本次没有修改 Obsidian 文件。`)
    }
    await Promise.all([knowledgeQuery.refetch(), reviewsQuery.refetch()])
  }

  const importZip = async (file: File) => {
    const preview = previewVaultZip(new Uint8Array(await file.arrayBuffer()))
    adapterRef.current = undefined
    return buildSyncPlan(documents, preview.documents)
  }

  return <section className="settings-obsidian settings-section" aria-label="Obsidian 设置">
    <header><p>Controlled knowledge copy</p><h2>Obsidian</h2><span>首次连接只扫描；冲突逐项选择；删除从不自动传播。{supported ? ' 文件夹能力可用。' : ' 当前使用 ZIP 降级模式。'}</span></header>
    {(knowledgeQuery.isPending || reviewsQuery.isPending) ? <p role="status">正在准备知识与回顾清单…</p> : null}
    {(knowledgeQuery.error || reviewsQuery.error) ? <p role="alert">知识清单暂时无法读取；没有执行同步。</p> : null}
    <ObsidianSettings
      documents={documents}
      supported={supported}
      connect={connect}
      onApply={apply}
      onExportZip={downloadZip}
      onImportZip={importZip}
      vaultName="Life vault"
      filePath={documents[0]?.path ?? 'LifeOps/Knowledge'}
    />
    {applyMessage ? <p className="settings-obsidian__result" role="status">{applyMessage}</p> : null}
    <p className="settings-obsidian__boundary">不会同步账户、任务、平台连接、运行日志、实时库存、幂等状态或凭据。</p>
  </section>
}

type SettingsCategory = 'account' | 'appearance' | 'locale' | 'defaults' | 'life' | 'obsidian' | 'connections' | 'public' | 'data'

const categories: Array<{ id: SettingsCategory; label: string }> = [
  { id: 'account', label: '账户与会话' },
  { id: 'appearance', label: '外观与动效' },
  { id: 'locale', label: '时间与区域' },
  { id: 'defaults', label: '默认行为' },
  { id: 'life', label: '生活阈值与提醒' },
  { id: 'obsidian', label: 'Obsidian' },
  { id: 'connections', label: '平台连接' },
  { id: 'public', label: '公开站点' },
  { id: 'data', label: '数据与安全' },
]

function mergeDraft(current: SettingsDocument, input: Omit<UpdateSettingsInput, 'version'>): SettingsDocument {
  return {
    ...current,
    appearance: { ...current.appearance, ...input.appearance },
    locale: { ...current.locale, ...input.locale },
    defaults: { ...current.defaults, ...input.defaults },
    life: { ...current.life, ...input.life },
    publicSite: { ...current.publicSite, ...input.publicSite },
  }
}

export function SettingsPage() {
  const { csrfToken, user } = useAuth()
  const reduceMotion = useReducedMotion()
  const [selected, setSelected] = useState<SettingsCategory>('account')
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 820)
  const [mobileDetail, setMobileDetail] = useState(false)
  const [draft, setDraft] = useState<SettingsDocument>()
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const mobileBackRef = useRef<HTMLButtonElement>(null)
  const categoryRefs = useRef<Partial<Record<SettingsCategory, HTMLButtonElement | null>>>({})
  const restoreCategoryFocus = useRef(false)
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: ({ signal }) => settingsApi.get(signal) })
  const sessionsQuery = useQuery({ queryKey: ['settings', 'sessions'], queryFn: ({ signal }) => settingsApi.listSessions(signal) })
  const auditQuery = useQuery({ queryKey: ['settings', 'audit'], queryFn: ({ signal }) => settingsApi.listAudit(signal) })

  useEffect(() => { if (settingsQuery.data) setDraft(settingsQuery.data) }, [settingsQuery.data])
  useEffect(() => {
    const update = () => { const next = window.innerWidth <= 820; setMobile(next); if (!next) setMobileDetail(false) }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  useEffect(() => {
    if (!mobile) return
    if (mobileDetail) {
      mobileBackRef.current?.focus()
      return
    }
    if (restoreCategoryFocus.current) {
      restoreCategoryFocus.current = false
      categoryRefs.current[selected]?.focus()
    }
  }, [mobile, mobileDetail, selected])

  const choose = (id: SettingsCategory) => { setSelected(id); if (mobile) setMobileDetail(true) }
  const returnToCategories = () => {
    restoreCategoryFocus.current = true
    setMobileDetail(false)
  }
  const save = async (input: Omit<UpdateSettingsInput, 'version'>) => {
    if (!draft) return
    const optimistic = mergeDraft(draft, input)
    setDraft(optimistic); setSaveState('saving')
    try {
      const saved = await settingsApi.update({ ...input, version: draft.version }, csrfToken)
      setDraft(saved); setSaveState('saved')
    } catch {
      setDraft(draft); setSaveState('error')
    }
  }

  if (settingsQuery.error) return <article className="settings-page" data-settings-page><div role="alert"><p>账户设置暂时无法读取；本页没有使用本地假数据。</p><button type="button" onClick={() => void settingsQuery.refetch()}>重新加载</button></div></article>
  if (settingsQuery.isPending || !draft) return <article className="settings-page" data-settings-page><p role="status">正在加载账户设置…</p></article>

  const content = selected === 'account'
    ? <AccountSettings account={user?.account ?? '当前账户'} sessions={sessionsQuery.data?.sessions ?? []} onChangePassword={(input) => settingsApi.changePassword(input, csrfToken)} onRevoke={async (id) => { await settingsApi.revokeSession(id, csrfToken); await sessionsQuery.refetch() }} />
    : selected === 'appearance'
      ? <AppearanceSettings value={draft.appearance} saveState={saveState} onChange={(appearance) => void save({ appearance })} />
      : selected === 'locale'
        ? <section className="settings-section"><header><p>Time & locale</p><h2>时间与区域</h2><span>所有日期边界使用账户时区；历史实际快照不因设置变化而重写。</span></header><div className="settings-field-row"><label htmlFor="settings-timezone"><strong>时区</strong><span>IANA 时区名称</span></label><input id="settings-timezone" value={draft.locale.timezone} onChange={(event) => setDraft({ ...draft, locale: { ...draft.locale, timezone: event.target.value } })} onBlur={() => void save({ locale: draft.locale })} /></div><div className="settings-field-row"><label htmlFor="settings-locale"><strong>区域</strong><span>日期和数字显示格式</span></label><select id="settings-locale" value={draft.locale.locale} onChange={(event) => void save({ locale: { ...draft.locale, locale: event.target.value } })}><option value="zh-CN">简体中文</option><option value="en-US">English (US)</option></select></div></section>
        : selected === 'defaults'
          ? <section className="settings-section"><header><p>Defaults</p><h2>默认行为</h2><span>这里只改变新操作的起点，不重写已有事实。</span></header><div className="settings-field-row"><label htmlFor="settings-start"><strong>登录后起点</strong><span>使用稳定的站内路由</span></label><select id="settings-start" value={draft.defaults.startRoute} onChange={(event) => void save({ defaults: { ...draft.defaults, startRoute: event.target.value } })}><option value="/app">总览</option><option value="/app/today">今日</option><option value="/app/life">生活</option></select></div><div className="settings-field-row"><label htmlFor="settings-quick"><strong>快速记录默认类型</strong><span>仍可在任务层显式切换</span></label><select id="settings-quick" value={draft.defaults.quickCreateType} onChange={(event) => void save({ defaults: { ...draft.defaults, quickCreateType: event.target.value } })}><option value="record">记录</option><option value="task">任务</option></select></div></section>
          : selected === 'life'
            ? <section className="settings-section"><header><p>Life thresholds</p><h2>生活阈值与提醒</h2><span>阈值只影响未来提醒与显示，不改写已完成历史。</span></header><div className="settings-field-row"><label htmlFor="settings-low-stock"><strong>低库存观察天数</strong><span>0–365 天</span></label><input id="settings-low-stock" type="number" min="0" max="365" value={draft.life.lowStockDays} onChange={(event) => void save({ life: { ...draft.life, lowStockDays: Number(event.target.value) } })} /></div><div className="settings-field-row"><label htmlFor="settings-expiry"><strong>到期预警天数</strong><span>不生成药物建议</span></label><input id="settings-expiry" type="number" min="0" max="3650" value={draft.life.expiryWarningDays} onChange={(event) => void save({ life: { ...draft.life, expiryWarningDays: Number(event.target.value) } })} /></div></section>
            : selected === 'obsidian'
              ? <ObsidianSettingsPanel />
              : selected === 'connections'
                ? <PlatformConnections connections={draft.connections} />
                : selected === 'public'
                  ? <section className="settings-section"><header><p>Public site</p><h2>公开站点</h2><span>默认保持私有；发布仍需逐条显式确认和不可变版本。</span></header><div className="settings-field-row"><label htmlFor="settings-visibility"><strong>新草稿默认可见性</strong><span>不会改变已发布版本</span></label><select id="settings-visibility" value={draft.publicSite.defaultVisibility} onChange={(event) => void save({ publicSite: { ...draft.publicSite, defaultVisibility: event.target.value as 'private' | 'public' } })}><option value="private">私有</option><option value="public">公开</option></select></div></section>
                  : <DataSecuritySettings audit={auditQuery.data?.events ?? []} onExport={() => settingsApi.exportData(csrfToken)} onPreview={(input) => settingsApi.previewImport(input, csrfToken)} onApply={(input) => settingsApi.applyImport(input, csrfToken)} />

  return <article className="settings-page" data-settings-page>
    <header className="settings-page__heading"><div><p>Private settings</p><h1 tabIndex={-1}>账户与设置</h1><span>账户、界面、连接和数据操作共享一张连续设置表面；秘密值永不回显。</span></div><span>{saveState === 'saving' ? '同步设置中' : '服务器设置已载入'}</span></header>
    <div className={`settings-workspace${mobile && mobileDetail ? ' is-detail' : ''}`}>
      <nav aria-label="设置分类">{categories.map((category) => <button key={category.id} ref={(element) => { categoryRefs.current[category.id] = element }} type="button" aria-current={selected === category.id ? 'page' : undefined} onClick={() => choose(category.id)}>{category.label}</button>)}</nav>
      <div className="settings-content">
        {mobile && mobileDetail ? <button ref={mobileBackRef} className="settings-mobile-back" type="button" onClick={returnToCategories}>返回设置分类</button> : null}
        <motion.div key={selected} initial={reduceMotion ? false : { x: mobile ? 24 : 12, opacity: .86 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: reduceMotion ? 0 : .18, ease: [0.22, 1, 0.36, 1] }}>{content}</motion.div>
      </div>
    </div>
  </article>
}
