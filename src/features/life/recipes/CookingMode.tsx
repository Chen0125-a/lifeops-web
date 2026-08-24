import { useMemo, useState } from 'react'
import type { CatalogItem, LifeUnit } from '../../../domain/lifeCatalog'
import type { CookingCompletionResult, CookingProgress, CookingSession, Recipe, RecipeVersion, StoredRecipeCalculation } from '../../../domain/lifeRecipes'

interface CookingModeProps {
  recipe: Recipe
  version: RecipeVersion
  session: CookingSession
  calculation: StoredRecipeCalculation
  items: CatalogItem[]
  units: LifeUnit[]
  busy?: boolean
  onExit(): void
  onSave(progress: CookingProgress & { entityVersion: number }): Promise<CookingSession>
  onPromote(): Promise<RecipeVersion>
  onComplete(input: { madeServings: number; eatenServings: number; completedAt: string }): Promise<CookingCompletionResult>
}

export function CookingMode({ recipe, version, session, calculation, items, units, busy, onExit, onSave, onPromote, onComplete }: CookingModeProps) {
  const [draft, setDraft] = useState(session)
  const [completionOpen, setCompletionOpen] = useState(false)
  const [madeServings, setMadeServings] = useState(session.plannedServings)
  const [eatenServings, setEatenServings] = useState(Math.min(1, session.plannedServings))
  const [promotedVersion, setPromotedVersion] = useState<number | null>(null)
  const step = version.steps[Math.min(draft.progress.currentStepIndex, Math.max(0, version.steps.length - 1))]
  const itemName = (id: string) => items.find((item) => item.id === id)?.name ?? id
  const unitLabel = (code: string) => units.find((unit) => unit.code === code)?.symbol || units.find((unit) => unit.code === code)?.name || code

  const updateActual = (itemId: string, quantity: number) => setDraft((current) => ({ ...current, progress: { ...current.progress, actualIngredients: current.progress.actualIngredients.map((ingredient) => ingredient.itemId === itemId ? { ...ingredient, quantity } : ingredient) } }))
  const toggleTimer = (stepId: string) => setDraft((current) => ({ ...current, progress: { ...current.progress, timers: current.progress.timers.some((timer) => timer.stepId === stepId)
    ? current.progress.timers.map((timer) => timer.stepId === stepId ? { ...timer, running: !timer.running, startedAt: timer.running ? null : new Date().toISOString() } : timer)
    : [...current.progress.timers, { stepId, elapsedSeconds: 0, running: true, startedAt: new Date().toISOString() }] } }))

  const consumption = useMemo(() => draft.progress.actualIngredients.map((ingredient) => `${itemName(ingredient.itemId)} ${ingredient.quantity} ${unitLabel(ingredient.unit)}`).join('；'), [draft.progress.actualIngredients])
  const leftover = Math.max(0, madeServings - eatenServings)

  return <aside className="cooking-mode" role="dialog" aria-modal="true" aria-label={`做菜模式：${recipe.name}`} onKeyDown={(event) => { if (event.key === 'Escape' && !completionOpen) onExit() }}>
    <header className="cooking-mode__header"><div><span>Live cooking · 固定版本 {version.number}</span><h2>{recipe.name}</h2><p>每次进度与实际用量都写回当前做菜会话，不会静默改变食谱版本。</p></div><button type="button" onClick={onExit}>退出做菜模式</button></header>

    <div className="cooking-mode__progress"><span>第 {draft.progress.currentStepIndex + 1} / {version.steps.length} 步</span><progress max={version.steps.length} value={draft.progress.currentStepIndex + 1} /><span>{draft.progress.completedStepIds.length} 步已确认</span></div>

    <div className="cooking-mode__canvas">
      <section className="cooking-mode__step"><span>{String(draft.progress.currentStepIndex + 1).padStart(2, '0')}</span><h3>{step?.instruction ?? '步骤已完成'}</h3>{step?.caution ? <p>{step.caution}</p> : null}{step ? <div><button type="button" aria-label={`启动计时 ${step.instruction}`} onClick={() => toggleTimer(step.id)}>{draft.progress.timers.find((timer) => timer.stepId === step.id)?.running ? '暂停计时' : '启动计时'}</button><button type="button" onClick={() => setDraft((current) => ({ ...current, progress: { ...current.progress, completedStepIds: [...new Set([...current.progress.completedStepIds, step.id])], currentStepIndex: Math.min(version.steps.length - 1, current.progress.currentStepIndex + 1) } }))}>完成当前步骤</button></div> : null}</section>

      <section className="cooking-mode__actual"><div className="recipe-section-title"><span>Actual quantities</span><h3>实际用量确认</h3></div><div>{draft.progress.actualIngredients.map((ingredient) => <label key={`${ingredient.itemId}-${ingredient.replacesItemId ?? ''}`}>实际用量 {itemName(ingredient.itemId)}<span><input type="number" min="0" step="0.1" value={ingredient.quantity} onChange={(event) => updateActual(ingredient.itemId, Number(event.target.value))} /> {unitLabel(ingredient.unit)}</span></label>)}</div><button type="button" disabled={busy} onClick={() => void onSave({ ...draft.progress, entityVersion: draft.entityVersion }).then(setDraft).catch(() => undefined)}>保存做菜进度</button></section>

      <section className="cooking-mode__note"><div className="recipe-section-title"><span>Session note</span><h3>本次心得</h3></div>{draft.note ? <><p>本次心得：{draft.note}</p><small>仅本次做菜可见，尚未改变食谱版本。</small><button type="button" disabled={busy || promotedVersion !== null} onClick={() => void onPromote().then((promoted) => setPromotedVersion(promoted.number)).catch(() => undefined)}>提升为新版本</button>{promotedVersion ? <strong>已提升为食谱版本 {promotedVersion}</strong> : null}</> : <p>本次没有临时心得。</p>}</section>
    </div>

    <footer className="cooking-mode__footer"><div><span>完成前会再次确认库存消耗、已吃份数、成品剩余、营养与成本。</span></div><button type="button" onClick={() => setCompletionOpen(true)}>准备完成</button></footer>

    {completionOpen ? <aside className="cooking-completion" role="dialog" aria-modal="true" aria-label="完成做菜预览">
      <header><div><span>Confirm facts</span><h3>完成做菜预览</h3></div><button type="button" onClick={() => setCompletionOpen(false)}>关闭完成预览</button></header>
      <div className="cooking-completion__numbers"><label>实际做成份数<input type="number" min="0.1" step="0.1" value={madeServings} onChange={(event) => setMadeServings(Number(event.target.value))} /></label><label>已吃份数<input type="number" min="0" max={madeServings} step="0.1" value={eatenServings} onChange={(event) => setEatenServings(Number(event.target.value))} /></label></div>
      <dl><div><dt>库存消耗</dt><dd>将消耗：{consumption}</dd></div><div><dt>成品库存</dt><dd>剩余成品 {leftover} 份</dd></div><div><dt>营养与成本</dt><dd>总营养 {calculation.totalNutrition?.energyKcal ?? 0} kcal · 总成本 ¥{((calculation.totalCostMinor ?? 0) / 100).toFixed(2)}</dd></div></dl>
      <footer><button type="button" onClick={() => setCompletionOpen(false)}>返回核对</button><button type="button" disabled={busy || madeServings <= 0 || eatenServings < 0 || eatenServings > madeServings} onClick={() => void onComplete({ madeServings, eatenServings, completedAt: new Date().toISOString() }).catch(() => undefined)}>确认完成</button></footer>
    </aside> : null}
  </aside>
}
