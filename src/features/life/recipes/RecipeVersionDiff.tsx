import type { CatalogItem } from '../../../domain/lifeCatalog'
import type { RecipeImpactPreview } from '../../../domain/lifeRecipes'

interface RecipeVersionDiffProps {
  preview: RecipeImpactPreview
  items: CatalogItem[]
  busy?: boolean
  onCancel(): void
  onConfirm(): Promise<void>
}

export function RecipeVersionDiff({ preview, items, busy, onCancel, onConfirm }: RecipeVersionDiffProps) {
  const name = (id: string) => items.find((item) => item.id === id)?.name ?? id
  return <aside className="recipe-preview" role="dialog" aria-modal="true" aria-label="版本影响预览">
    <header><div><span>Before write</span><h2>版本影响预览</h2></div><button type="button" onClick={onCancel}>关闭预览</button></header>
    <div className="recipe-preview__summary"><strong>{preview.createsVersion ? `将创建版本 ${preview.nextVersionNumber}` : '仅更新食谱元数据'}</strong><span>影响 {preview.futurePlansAffected} 个未来计划</span><span>尚未写入</span></div>
    <section><h3>版本差异</h3>{preview.diff.servings ? <p>份数：{preview.diff.servings.before} → {preview.diff.servings.after}</p> : <p>份数不变</p>}
      <ul>{preview.diff.components.map((change) => <li key={`${change.itemId}-${change.change}`}>{name(change.itemId)}：{change.beforeQuantity ?? '无'} → {change.afterQuantity ?? '无'} {change.unit}</li>)}</ul>
    </section>
    <section><h3>新计算</h3><p>{preview.calculation.status === 'complete' ? `总成本 ¥${((preview.calculation.totalCostMinor ?? 0) / 100).toFixed(2)}` : '计算仍不完整；保存后不会伪造营养或成本。'}</p></section>
    <footer><button type="button" onClick={onCancel}>返回编辑</button><button type="button" disabled={busy} onClick={() => void onConfirm().catch(() => undefined)}>保存新版本</button></footer>
  </aside>
}
