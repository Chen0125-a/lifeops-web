import type { ImportPreview as ImportPreviewValue, ImportResolution } from '../../../domain/lifeCommerce'

const resolutionLabels: Record<ImportResolution['resolution'], string> = {
  'keep-current': '保留当前版本',
  'use-imported': '使用导入版本',
  duplicate: '另存为副本',
}

export function ImportPreview({ preview, resolutions, onResolve, onApply }: {
  preview: ImportPreviewValue
  resolutions: ImportResolution[]
  onResolve(resolution: ImportResolution): void
  onApply(): void
}) {
  const resolved = preview.conflicts.every((conflict) => resolutions.some((entry) => entry.entityType === conflict.entityType && entry.entityId === conflict.entityId))
  return <section className="life-import-preview" role="region" aria-label="导入预览">
    <header><div><span>Read-only checkpoint</span><h2>导入预览</h2></div><strong>写入尚未发生</strong></header>
    <dl>
      <div><dt>导入编号</dt><dd>{preview.id}</dd></div>
      <div><dt>模式</dt><dd>{preview.mode === 'replace' ? '替换' : '合并'}</dd></div>
      <div><dt>状态</dt><dd>{preview.status === 'invalid' ? '不可应用' : preview.status === 'conflicts' ? '需要决策' : '可以应用'}</dd></div>
    </dl>
    {preview.errors.length ? <section className="life-import-errors" aria-label="无效行"><h3>必须修正的行</h3><ol>{preview.errors.map((error) => <li key={`${error.entityType}-${error.entityId}-${error.code}`}>{error.entityType} / {error.entityId} / {error.code} / {error.message}</li>)}</ol></section> : null}
    {preview.conflicts.length ? <section className="life-import-conflicts" aria-label="冲突决策"><h3>逐项决定冲突</h3>{preview.conflicts.map((conflict) => {
      const selected = resolutions.find((entry) => entry.entityType === conflict.entityType && entry.entityId === conflict.entityId)?.resolution
      return <fieldset key={`${conflict.entityType}-${conflict.entityId}`}><legend>{conflict.entityType} · {conflict.entityId} · 当前 v{conflict.currentVersion} / 导入 v{conflict.incomingVersion}</legend>{conflict.resolutions.map((resolution) => <label key={resolution}><input type="radio" name={`${conflict.entityType}-${conflict.entityId}`} checked={selected === resolution} onChange={() => onResolve({ entityType: conflict.entityType, entityId: conflict.entityId, resolution })} />{resolutionLabels[resolution]}</label>)}</fieldset>
    })}</section> : null}
    {preview.status !== 'invalid' ? <footer><button type="button" disabled={!resolved} onClick={onApply}>应用导入</button></footer> : null}
  </section>
}

