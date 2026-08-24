import { Link } from 'react-router-dom'
import type { CatalogItem, LifeUnit } from '../../../domain/lifeCatalog'
import type { Recipe, RecipeVersion, StoredRecipeCalculation } from '../../../domain/lifeRecipes'

interface RecipeInspectorProps {
  recipe: Recipe
  version: RecipeVersion
  versions: RecipeVersion[]
  calculation?: StoredRecipeCalculation
  calculationPending: boolean
  pinned: boolean
  scaleServings: number
  items: CatalogItem[]
  units: LifeUnit[]
  canContinueCooking: boolean
  onScaleServings(value: number): void
  onPin(version: RecipeVersion): void
  onClose(): void
  onEdit(): void
  onStartCooking(): void
  onContinueCooking(): void
  onRelations(): void
}

const missingLabels = { conversion: '单位换算', nutrition: '营养事实', price: '价格事实' } as const

export function RecipeInspector({ recipe, version, versions, calculation, calculationPending, pinned, scaleServings, items, units, canContinueCooking, onScaleServings, onPin, onClose, onEdit, onStartCooking, onContinueCooking, onRelations }: RecipeInspectorProps) {
  const factor = scaleServings > 0 ? scaleServings / version.servings : 1
  const itemName = (id: string) => items.find((item) => item.id === id)?.name ?? id
  const unitLabel = (code: string) => units.find((unit) => unit.code === code)?.symbol || units.find((unit) => unit.code === code)?.name || code
  return <aside className="recipe-inspector" role="region" aria-label={`${recipe.name}详情`}>
    <header className="recipe-inspector__header">
      <div><button type="button" onClick={onClose}>返回食谱列表</button><span>{pinned ? `固定版本 ${version.number}` : `版本 ${version.number}`}</span><h2>{recipe.name}</h2><p>{recipe.description || '没有额外说明'}</p></div>
      <div><button type="button" onClick={onRelations}>查看食谱与食材关系</button><button type="button" onClick={onEdit}>编辑食谱</button></div>
    </header>

    <div className="recipe-inspector__ribbon">
      <label>查看份数<input type="number" min="0.1" step="0.1" value={scaleServings} onChange={(event) => onScaleServings(Number(event.target.value))} /></label>
      <span>{recipe.prepMinutes + recipe.cookMinutes} 分钟</span><span>{recipe.difficulty === 'easy' ? '容易' : recipe.difficulty === 'medium' ? '适中' : '进阶'}</span>
    </div>

    <section className="recipe-inspector__composition"><div className="recipe-section-title"><span>Composition</span><h3>配料与比例</h3></div>
      <ol>{version.components.map((component) => <li key={component.id}><Link to={`/app/life/ingredients?item=${encodeURIComponent(component.itemId)}`}>{itemName(component.itemId)}</Link><strong>{Number((component.quantity * factor).toFixed(2))} {unitLabel(component.unit)}</strong></li>)}</ol>
    </section>

    <section className="recipe-inspector__steps"><div className="recipe-section-title"><span>Sequence</span><h3>步骤</h3></div><ol>{version.steps.map((step, index) => <li key={step.id}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{step.instruction}</strong>{step.durationSeconds ? <small>{step.durationSeconds} 秒</small> : null}{step.caution ? <p>{step.caution}</p> : null}</div></li>)}</ol></section>

    <section className="recipe-inspector__calculation" aria-live="polite"><div className="recipe-section-title"><span>Current facts</span><h3>营养、成本与库存</h3></div>
      {calculationPending ? <p>正在按当前事实计算…</p> : calculation?.status === 'complete' ? <div className="recipe-calculation-grid">
        <div><span>每份能量</span><strong>{calculation.perServingNutrition?.energyKcal ?? 0} kcal</strong></div>
        <div><span>每份成本</span><strong>¥{((calculation.perServingCostMinor ?? 0) / 100).toFixed(2)}</strong></div>
        <div><span>烹调油</span><strong>{calculation.perServingCookingOilGrams ?? 0} g / 份</strong></div>
        <div><span>库存判断</span><strong>{calculation.ingredients.every((ingredient) => (ingredient.shortage ?? 0) <= 0) ? '当前可做' : '存在短缺'}</strong></div>
      </div> : <div className="recipe-calculation-missing"><strong>计算尚不完整</strong><ul>{calculation?.missing.map((entry) => <li key={entry.itemId}>{itemName(entry.itemId)}：缺少{entry.facts.map((fact) => missingLabels[fact]).join('、')} <Link to={`/app/life/ingredients?item=${encodeURIComponent(entry.itemId)}`}>补全{itemName(entry.itemId)}资料</Link></li>)}</ul></div>}
    </section>

    <section className="recipe-inspector__history"><div className="recipe-section-title"><span>Growth</span><h3>版本历史</h3></div><div>{versions.map((candidate) => <button key={candidate.id} type="button" aria-pressed={candidate.id === version.id} onClick={() => onPin(candidate)}>查看版本 {candidate.number}</button>)}</div>{version.promotedNote ? <p>提升心得：{version.promotedNote}</p> : null}</section>

    <footer className="recipe-inspector__actions"><div><span>{calculation?.status === 'complete' ? '完成前仍会再次显示实际消耗与剩余成品。' : '补全缺失事实后才能开始做菜。'}</span></div>{canContinueCooking ? <button type="button" onClick={onContinueCooking}>继续做菜</button> : null}<button type="button" disabled={calculation?.status !== 'complete'} onClick={onStartCooking}>开始做菜</button></footer>
  </aside>
}
