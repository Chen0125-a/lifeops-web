import { useState, type ChangeEvent } from 'react'
import { obsidianOpenUri } from '../../integrations/obsidian/zipFallback'
import type { SyncPlan, VaultDocument } from '../../integrations/obsidian/types'

export type ObsidianConflictChoice = 'keep-web' | 'keep-obsidian' | 'keep-both'

export interface ObsidianConnection {
  permission: PermissionState
  vaultName: string
  scan(): Promise<SyncPlan>
}

export interface ObsidianSettingsProps {
  documents: VaultDocument[]
  supported?: boolean
  connect?: () => Promise<ObsidianConnection>
  onApply?: (plan: SyncPlan, conflicts: Record<string, ObsidianConflictChoice>) => Promise<void>
  onExportZip?: (documents: VaultDocument[]) => void
  onImportZip?: (file: File) => Promise<SyncPlan>
  vaultName?: string
  filePath?: string
}

export function ObsidianSettings({
  documents,
  supported,
  connect,
  onApply,
  onExportZip,
  onImportZip,
  vaultName,
  filePath,
}: ObsidianSettingsProps) {
  const canUseDirectory = supported ?? (typeof window !== 'undefined' && 'showDirectoryPicker' in window)
  const [connectionName, setConnectionName] = useState<string | null>(null)
  const [preview, setPreview] = useState<SyncPlan | null>(null)
  const [conflicts, setConflicts] = useState<Record<string, ObsidianConflictChoice>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConnect() {
    if (!connect) {
      setError('未配置文件夹连接器。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const connection = await connect()
      if (connection.permission !== 'granted') {
        setConnectionName(null)
        setError('文件夹读写权限被拒绝，尚未连接。')
        return
      }
      const nextPreview = await connection.scan()
      setConnectionName(connection.vaultName)
      setPreview(nextPreview)
      setConflicts({})
    } catch (cause) {
      setConnectionName(null)
      setError(cause instanceof Error ? cause.message : '连接失败。')
    } finally {
      setBusy(false)
    }
  }

  async function handleApply() {
    if (!preview || !onApply) return
    setBusy(true)
    setError(null)
    try {
      await onApply(preview, conflicts)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '应用失败。')
    } finally {
      setBusy(false)
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !onImportZip) return
    setBusy(true)
    setError(null)
    try {
      setPreview(await onImportZip(file))
      setConflicts({})
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ZIP 预览失败。')
    } finally {
      setBusy(false)
    }
  }

  const unresolvedConflicts = preview?.actions.filter(({ kind, lifeopsId }) => kind === 'conflict' && !conflicts[lifeopsId]).length ?? 0

  return (
    <section aria-label="Obsidian 人工同步">
      <h2>Obsidian 人工同步</h2>
      {canUseDirectory ? (
        <button type="button" disabled={busy} onClick={() => void handleConnect()}>
          {busy ? '正在扫描…' : '连接文件夹'}
        </button>
      ) : (
        <div style={{ display: 'grid', gap: '1rem', minWidth: 0 }}>
          <p>浏览器不支持文件夹连接；请使用经过预览的 ZIP 手动同步。</p>
          <button type="button" style={{ justifySelf: 'start' }} onClick={() => onExportZip?.(documents)}>导出 ZIP</button>
          <label style={{ display: 'grid', gap: '.5rem', minWidth: 0 }}>
            导入 ZIP
            <input
              type="file"
              accept=".zip,application/zip"
              style={{ boxSizing: 'border-box', maxWidth: '100%', minWidth: 0, width: '100%' }}
              onChange={(event) => void handleImport(event)}
            />
          </label>
          {vaultName && filePath ? <a style={{ overflowWrap: 'anywhere' }} href={obsidianOpenUri(vaultName, filePath)}>在 Obsidian 中打开</a> : null}
        </div>
      )}
      {connectionName ? <p>已连接 · {connectionName}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {preview ? (
        <div aria-label="同步预览">
          <p role="status">{preview.actions.length} 项 · {preview.actions.filter(({ kind }) => kind === 'conflict').length} 个冲突</p>
          <ul>
            {preview.actions.map((action) => <li key={`${action.lifeopsId}:${action.kind}`}>
              <strong>{action.lifeopsId}</strong> · {action.kind}
              {action.kind === 'conflict' ? <fieldset aria-label={`${action.lifeopsId} 冲突处理`}>
                <legend>选择这项冲突的处理方式</legend>
                <button aria-pressed={conflicts[action.lifeopsId] === 'keep-web'} type="button" onClick={() => setConflicts((current) => ({ ...current, [action.lifeopsId]: 'keep-web' }))}>保留 Web 版本</button>
                <button aria-pressed={conflicts[action.lifeopsId] === 'keep-obsidian'} type="button" onClick={() => setConflicts((current) => ({ ...current, [action.lifeopsId]: 'keep-obsidian' }))}>采用 Obsidian 版本</button>
                <button aria-pressed={conflicts[action.lifeopsId] === 'keep-both'} type="button" onClick={() => setConflicts((current) => ({ ...current, [action.lifeopsId]: 'keep-both' }))}>保留两份副本</button>
              </fieldset> : null}
            </li>)}
          </ul>
          {unresolvedConflicts ? <p>还有 {unresolvedConflicts} 个冲突需要明确选择，尚未写入任何文件。</p> : null}
          {onApply ? <button type="button" disabled={busy || unresolvedConflicts > 0} onClick={() => void handleApply()}>确认并应用</button> : null}
        </div>
      ) : null}
    </section>
  )
}
