import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { buildLifeImportPlan, type LifeImportPlan, type LifeImportResolution } from '../../../integrations/obsidian/lifeImportPlan'
import { lifeProjectionTypes, type LifeProjectionDocument, type LifeProjectionType } from '../../../integrations/obsidian/lifeProjection'

export interface LifeObsidianApplyResult {
  backupPath: string | null
  completedPaths: string[]
  failedPaths: string[]
  importPreviewId?: string
}

export interface LifeObsidianConnection {
  permission: PermissionState
  vaultName: string
  scan(): Promise<LifeProjectionDocument[]>
  apply(plan: LifeImportPlan, resolutions: Record<string, LifeImportResolution>): Promise<LifeObsidianApplyResult>
}

export interface LifeObsidianPanelProps {
  documents: LifeProjectionDocument[]
  supported?: boolean
  connect?: () => Promise<LifeObsidianConnection>
  onExportZip?: (documents: LifeProjectionDocument[]) => void
  onImportZip?: (file: File) => Promise<LifeProjectionDocument[]>
  refreshDocuments?: () => Promise<LifeProjectionDocument[]>
}

const labels: Record<LifeProjectionType, string> = {
  recipe: '配方',
  'cooking-note': '烹饪备注',
  'fitness-summary': '运动摘要',
  'life-review': '生活回顾',
  'shopping-summary': '采购摘要',
  'budget-summary': '预算摘要',
}

const actionLabels: Record<LifeProjectionType, string> = { ...labels, 'life-review': '回顾' }

function permissionFailure(cause: unknown) {
  return cause instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(cause.name)
}

export function LifeObsidianPanel({ documents, supported, connect, onExportZip, onImportZip, refreshDocuments }: LifeObsidianPanelProps) {
  const canUseDirectory = supported ?? (typeof window !== 'undefined' && 'showDirectoryPicker' in window)
  const connectionRef = useRef<LifeObsidianConnection | undefined>(undefined)
  const [selected, setSelected] = useState<LifeProjectionType[]>([...lifeProjectionTypes])
  const [connectionName, setConnectionName] = useState<string>()
  const [plan, setPlan] = useState<LifeImportPlan>()
  const [resolutions, setResolutions] = useState<Record<string, LifeImportResolution>>({})
  const [mergedBodies, setMergedBodies] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [degraded, setDegraded] = useState(false)
  const [message, setMessage] = useState<string>()
  const selectedDocuments = useMemo(() => documents.filter(({ type }) => selected.includes(type)), [documents, selected])

  const toggle = (type: LifeProjectionType) => setSelected((current) => current.includes(type)
    ? current.filter((entry) => entry !== type)
    : [...current, type])

  const showPreview = (vaultDocuments: LifeProjectionDocument[], currentDocuments = documents) => {
    setPlan(buildLifeImportPlan(currentDocuments.filter(({ type }) => selected.includes(type)), vaultDocuments))
    setResolutions({})
    setMergedBodies({})
    setMessage(undefined)
  }

  const handleConnect = async () => {
    if (!connect) {
      setError('尚未配置文件夹连接器。')
      return
    }
    setBusy(true)
    setError(undefined)
    setDegraded(false)
    try {
      const currentDocuments = refreshDocuments ? await refreshDocuments() : documents
      const connection = await connect()
      if (connection.permission !== 'granted') {
        connectionRef.current = undefined
        setConnectionName(undefined)
        setDegraded(true)
        setError('文件夹权限未授予；尚未连接，也没有写入任何文件。')
        return
      }
      const vaultDocuments = await connection.scan()
      connectionRef.current = connection
      setConnectionName(connection.vaultName)
      showPreview(vaultDocuments, currentDocuments)
    } catch (cause) {
      connectionRef.current = undefined
      setConnectionName(undefined)
      setDegraded(true)
      setError(permissionFailure(cause) ? '文件夹权限已失效；尚未连接。' : cause instanceof Error ? cause.message : '连接失败。')
    } finally {
      setBusy(false)
    }
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !onImportZip) return
    setBusy(true)
    setError(undefined)
    try {
      showPreview(await onImportZip(file))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ZIP 预览失败。')
    } finally {
      setBusy(false)
    }
  }

  const setResolution = (key: string, resolution: LifeImportResolution) => setResolutions((current) => ({ ...current, [key]: resolution }))
  const unresolved = plan?.actions.filter(({ key, kind }) => ['conflict', 'recipe-version-draft'].includes(kind) && !resolutions[key]).length ?? 0

  const handleApply = async () => {
    if (!plan) return
    const connection = connectionRef.current
    if (!connection) {
      setError('ZIP 预览不会直接写入；请导出确认后的 ZIP，或在支持文件夹连接的浏览器中重新扫描。')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const resolvedPlan: LifeImportPlan = {
        ...plan,
        actions: plan.actions.map((action) => resolutions[action.key] === 'manual-merge' && action.vault
          ? { ...action, vault: { ...action.vault, body: mergedBodies[action.key] ?? action.vault.body } }
          : action),
      }
      const result = await connection.apply(resolvedPlan, resolutions)
      if (result.failedPaths.length) throw new Error(`同步在 ${result.failedPaths[0]} 停止；已完成路径：${result.completedPaths.length}。`)
      const backup = result.backupPath ? `写入前备份保留在 ${result.backupPath}` : '本次没有修改文件夹'
      const draft = result.importPreviewId ? `；MySQL 尚未写入，导入草稿 ${result.importPreviewId} 已生成` : ''
      setMessage(`已确认应用；${backup}${draft}。`)
    } catch (cause) {
      if (permissionFailure(cause)) {
        connectionRef.current = undefined
        setConnectionName(undefined)
        setDegraded(true)
        setError('文件夹权限已失效；同步已停止，连接状态已降级。')
      } else {
        setDegraded(true)
        setError(cause instanceof Error ? cause.message : '同步失败；LifeOps 数据未改变。')
      }
    } finally {
      setBusy(false)
    }
  }

  return <section className="life-obsidian-panel" aria-label="Life Obsidian 知识副本">
    <header>
      <div><span>Controlled knowledge copy</span><h2>Life Obsidian 知识副本</h2></div>
      <p>只投影可读事实；库存流水、会话、凭据和平台数据不会进入 Markdown。</p>
    </header>
    <fieldset className="life-obsidian-types">
      <legend>选择要往返的知识类型</legend>
      {lifeProjectionTypes.map((type) => <label key={type}><input type="checkbox" checked={selected.includes(type)} onChange={() => toggle(type)} />{labels[type]}</label>)}
    </fieldset>
    <div className="life-obsidian-actions">
      <button type="button" disabled={busy || selectedDocuments.length === 0 || !onExportZip} onClick={() => onExportZip?.(selectedDocuments)}>导出所选 ZIP</button>
      {canUseDirectory
        ? <button type="button" disabled={busy || selected.length === 0} onClick={() => void handleConnect()}>{busy ? '正在扫描…' : '连接并扫描'}</button>
        : <div className="life-obsidian-fallback">
          <p>当前浏览器不支持文件夹连接；可使用 ZIP 手动往返。</p>
          <label>导入 Life Obsidian ZIP<input type="file" accept=".zip,application/zip" onChange={(event) => void handleImport(event)} /></label>
        </div>}
    </div>
    {connectionName ? <p className="life-obsidian-status">已连接 · {connectionName}</p> : null}
    {degraded ? <p className="life-obsidian-status">{connectionName ? '降级状态 · 文件夹连接需复核' : '降级状态 · 尚未连接'}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {plan ? <section className="life-obsidian-preview" role="region" aria-label="Life Obsidian 同步预览">
      <header><strong>{plan.actions.length} 项预览</strong><span>{plan.actions.filter(({ kind }) => kind === 'conflict').length} 个普通冲突</span></header>
      <p>首次连接只完成扫描与预览，尚未写入任何文件。</p>
      <ol>
        {plan.actions.map((action) => <li key={action.key}>
          <header><strong>{labels[action.type]} · {action.lifeopsId}</strong><span>{action.kind}</span></header>
          {action.kind === 'recipe-version-draft' || action.kind === 'conflict' ? <div className="life-obsidian-comparison">
            <section><h3>Web</h3><pre>{action.web?.body}</pre></section>
            <section><h3>Obsidian</h3><pre>{action.vault?.body}</pre></section>
          </div> : null}
          {action.kind === 'recipe-version-draft' ? <fieldset><legend>配方变化必须新建版本</legend>
            <label><input type="radio" name={action.key} checked={resolutions[action.key] === 'create-recipe-version'} onChange={() => setResolution(action.key, 'create-recipe-version')} />创建新的配方版本</label>
            <label><input type="radio" name={action.key} checked={resolutions[action.key] === 'keep-web'} onChange={() => setResolution(action.key, 'keep-web')} />保留 Web 配方</label>
          </fieldset> : null}
          {action.kind === 'conflict' ? <fieldset><legend>明确选择冲突版本</legend>
            <label><input type="radio" name={action.key} checked={resolutions[action.key] === 'keep-web'} onChange={() => setResolution(action.key, 'keep-web')} />保留 Web {actionLabels[action.type]}</label>
            <label><input type="radio" name={action.key} checked={resolutions[action.key] === 'use-obsidian'} onChange={() => setResolution(action.key, 'use-obsidian')} />采用 Obsidian {actionLabels[action.type]}</label>
            <label><input type="radio" name={action.key} checked={resolutions[action.key] === 'manual-merge'} onChange={() => {
              setResolution(action.key, 'manual-merge')
              setMergedBodies((current) => ({ ...current, [action.key]: current[action.key] ?? `${action.web?.body ?? ''}\n\n${action.vault?.body ?? ''}` }))
            }} />人工合并</label>
            <label><input type="radio" name={action.key} checked={resolutions[action.key] === 'keep-both'} onChange={() => setResolution(action.key, 'keep-both')} />保留两份副本</label>
            {resolutions[action.key] === 'manual-merge' ? <label>合并后的 Markdown<textarea value={mergedBodies[action.key] ?? ''} onChange={(event) => setMergedBodies((current) => ({ ...current, [action.key]: event.target.value }))} /></label> : null}
          </fieldset> : null}
        </li>)}
      </ol>
      {unresolved ? <p>还有 {unresolved} 项需要明确选择。</p> : null}
      <button type="button" disabled={busy || unresolved > 0 || !connectionName} onClick={() => void handleApply()}>确认应用</button>
    </section> : null}
  </section>
}

export type { LifeProjectionType }
