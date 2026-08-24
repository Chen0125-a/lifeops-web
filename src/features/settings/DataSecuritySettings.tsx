import { useState, type ChangeEvent } from 'react'
import type { DataExportResult, DataImportApplyResult, DataImportPreview, SafeAuditEvent } from '../../domain/settings'

const encoder = new TextEncoder()
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function fileText(file: File) {
  if (typeof file.text === 'function') return file.text()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('无法读取导入文件'))
    reader.readAsText(file)
  })
}

export function DataSecuritySettings({ audit, onExport, onPreview, onApply }: {
  audit: SafeAuditEvent[]
  onExport: () => Promise<DataExportResult>
  onPreview: (input: { canonicalJson: string; checksumSha256: string }) => Promise<DataImportPreview>
  onApply: (input: { previewChecksum: string; currentPassword: string }) => Promise<DataImportApplyResult>
}) {
  const [preview, setPreview] = useState<DataImportPreview>()
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [notice, setNotice] = useState<string>()
  const exportData = async () => {
    setNotice('正在生成导出…')
    const result = await onExport()
    const url = URL.createObjectURL(new Blob([result.canonicalJson], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `lifeops-${result.checksumSha256.slice(0, 12)}.json`; anchor.click()
    queueMicrotask(() => URL.revokeObjectURL(url)); setNotice(`导出完成 · ${Object.values(result.counts).reduce((sum, count) => sum + count, 0)} 条记录`)
  }
  const previewFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setNotice('正在校验导入…')
    const canonicalJson = await fileText(file)
    const result = await onPreview({ canonicalJson, checksumSha256: await sha256(canonicalJson) })
    setPreview(result); setNotice(`预览完成 · ${Object.values(result.counts).reduce((sum, count) => sum + count, 0)} 条记录`)
  }
  const apply = async () => {
    if (!preview || !confirmed || !password) return
    setNotice('正在应用；此窗口不要关闭…')
    const result = await onApply({ previewChecksum: preview.previewChecksum, currentPassword: password })
    setNotice(`导入已原子应用；恢复点 ${result.restorePoint.id} 已校验并保留。`); setPreview(undefined); setPassword(''); setConfirmed(false)
  }
  return <section className="settings-section" aria-labelledby="settings-data-title">
    <header><p>Data & security</p><h2 id="settings-data-title">数据与安全</h2><span>导出包含账户拥有的业务数据与设置，不包含密码哈希、会话、CSRF、登录限制、平台凭据或原始日志样本。</span></header>
    <div className="settings-danger-zone">
      <div><h3>完整导出</h3><p>生成带 schema version、记录计数与 SHA-256 的确定性 JSON。</p><button type="button" onClick={() => void exportData()}>导出我的数据</button></div>
      <div><h3>预览后导入</h3><p>导入会变更当前账户数据；预览本身绝不写入。</p><p>应用前会保留校验信息；如发生问题，可用导入前恢复点恢复。</p><label>选择导入 JSON<input type="file" accept="application/json,.json" onChange={(event) => void previewFile(event)} /></label>
        {preview ? <div className="settings-import-preview"><strong>{preview.status === 'ready' ? '可应用' : `有 ${preview.conflicts.length} 个冲突`}</strong><span>{Object.entries(preview.counts).map(([key, count]) => `${key} ${count}`).join(' · ')}</span></div> : null}
        <label>当前密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label className="settings-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我已理解影响与恢复方式</label>
        <button className="settings-danger" type="button" disabled={!preview || !confirmed || !password} onClick={() => void apply()}>应用导入</button>
      </div>
    </div>
    {notice ? <p role="status">{notice}</p> : null}
    <div className="settings-audit"><h3>最近审计</h3>{audit.length ? <ol>{audit.slice(0, 12).map((event) => <li key={event.id}><span>{event.action}</span><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString('zh-CN')}</time></li>)}</ol> : <p>还没有设置或数据操作记录。</p>}</div>
  </section>
}
