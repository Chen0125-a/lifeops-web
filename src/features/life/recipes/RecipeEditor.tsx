import { useMemo, useState } from 'react'
import type { CatalogItem, LifeUnit } from '../../../domain/lifeCatalog'
import type { Recipe, RecipeInput } from '../../../domain/lifeRecipes'

interface DraftComponent { itemId: string; quantity: number; unit: string; role: 'ingredient' | 'seasoning' }
interface DraftStep { instruction: string; durationSeconds: number | null; caution: string }

interface RecipeEditorProps {
  recipe?: Recipe
  items: CatalogItem[]
  units: LifeUnit[]
  busy?: boolean
  onClose(): void
  onCreate(input: RecipeInput): Promise<void>
  onPreview(input: RecipeInput & { entityVersion: number }): Promise<void>
}

function initialComponents(recipe?: Recipe): DraftComponent[] {
  if (recipe?.currentVersion.components.length) return recipe.currentVersion.components.map(({ itemId, quantity, unit, role }) => ({ itemId, quantity, unit, role }))
  return [{ itemId: '', quantity: 1, unit: '', role: 'ingredient' }]
}

function initialSteps(recipe?: Recipe): DraftStep[] {
  if (recipe?.currentVersion.steps.length) return recipe.currentVersion.steps.map(({ instruction, durationSeconds, caution }) => ({ instruction, durationSeconds, caution }))
  return [{ instruction: '', durationSeconds: null, caution: '' }]
}

export function RecipeEditor({ recipe, items, units, busy, onClose, onCreate, onPreview }: RecipeEditorProps) {
  const [name, setName] = useState(recipe?.name ?? '')
  const [description, setDescription] = useState(recipe?.description ?? '')
  const [servings, setServings] = useState(recipe?.currentVersion.servings ?? 2)
  const [prepMinutes, setPrepMinutes] = useState(recipe?.prepMinutes ?? 0)
  const [cookMinutes, setCookMinutes] = useState(recipe?.cookMinutes ?? 0)
  const [components, setComponents] = useState<DraftComponent[]>(() => initialComponents(recipe))
  const [steps, setSteps] = useState<DraftStep[]>(() => initialSteps(recipe))

  const incompatible = useMemo(() => components.flatMap((component, index) => {
    const item = items.find((candidate) => candidate.id === component.itemId)
    if (!item || !component.unit) return []
    const compatible = new Set([item.baseUnit, ...item.availableUnits])
    return compatible.has(component.unit) ? [] : [{ index, item, unit: component.unit }]
  }), [components, items])

  const valid = Boolean(name.trim())
    && servings > 0
    && components.length > 0
    && components.every((component) => component.itemId && component.quantity > 0 && component.unit)
    && steps.length > 0
    && steps.every((step) => step.instruction.trim())
    && incompatible.length === 0

  const input = (): RecipeInput => ({
    name: name.trim(),
    description: description.trim(),
    coverMediaId: recipe?.coverMediaId ?? null,
    servings,
    yieldQuantity: recipe?.currentVersion.yieldQuantity ?? servings,
    yieldUnit: recipe?.currentVersion.yieldUnit ?? 'portion',
    prepMinutes,
    cookMinutes,
    difficulty: recipe?.difficulty ?? 'easy',
    categoryId: recipe?.categoryId ?? null,
    tagIds: recipe?.tagIds ?? [],
    storageNotes: recipe?.storageNotes ?? '',
    components: components.map((component, position) => ({ ...component, position })),
    steps: steps.map((step, position) => ({
      ...step,
      ingredientItemIds: components.map((component) => component.itemId).filter(Boolean),
      imageMediaId: null,
      position,
    })),
  })

  const updateComponent = (index: number, patch: Partial<DraftComponent>) => setComponents((current) => current.map((entry, candidate) => candidate === index ? { ...entry, ...patch } : entry))
  const updateStep = (index: number, patch: Partial<DraftStep>) => setSteps((current) => current.map((entry, candidate) => candidate === index ? { ...entry, ...patch } : entry))
  const moveStep = (index: number, direction: -1 | 1) => setSteps((current) => {
    const target = index + direction
    if (target < 0 || target >= current.length) return current
    const next = [...current]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    return next
  })

  return (
    <aside className="recipe-task-layer recipe-editor" role="dialog" aria-modal="true" aria-label={recipe ? `编辑${recipe.name}` : '新建食谱'} onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <header className="recipe-task-layer__header">
        <div><span>Recipe draft</span><h2>{recipe ? `编辑${recipe.name}` : '新建食谱'}</h2><p>先确认配料、单位和步骤，再生成版本影响。</p></div>
        <button type="button" onClick={onClose}>关闭编辑器</button>
      </header>

      <div className="recipe-editor__body">
        <section className="recipe-editor__identity" aria-label="食谱基本信息">
          <label>食谱名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <div className="recipe-editor__numbers">
            <label>份数<input type="number" min="0.1" step="0.1" value={servings} onChange={(event) => setServings(Number(event.target.value))} /></label>
            <label>准备分钟<input type="number" min="0" value={prepMinutes} onChange={(event) => setPrepMinutes(Number(event.target.value))} /></label>
            <label>烹饪分钟<input type="number" min="0" value={cookMinutes} onChange={(event) => setCookMinutes(Number(event.target.value))} /></label>
          </div>
        </section>

        <section aria-labelledby="recipe-components-title">
          <div className="recipe-editor__section-heading"><div><span>Composition</span><h3 id="recipe-components-title">配料</h3></div><button type="button" onClick={() => setComponents((current) => [...current, { itemId: '', quantity: 1, unit: '', role: 'ingredient' }])}>再加一种食材</button></div>
          <div className="recipe-editor__rows">
            {components.map((component, index) => <div className="recipe-editor__component" key={index}>
              <label>食材 {index + 1}<select value={component.itemId} onChange={(event) => {
                const item = items.find((candidate) => candidate.id === event.target.value)
                updateComponent(index, { itemId: event.target.value, unit: item?.baseUnit ?? '' })
              }}><option value="">选择食材</option>{items.filter((item) => item.kind === 'ingredient').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label>数量 {index + 1}<input type="number" min="0" step="0.1" value={component.quantity} onChange={(event) => updateComponent(index, { quantity: Number(event.target.value) })} /></label>
              <label>单位 {index + 1}<select value={component.unit} onChange={(event) => updateComponent(index, { unit: event.target.value })}><option value="">选择单位</option>{units.map((unit) => <option key={unit.code} value={unit.code}>{unit.symbol || unit.name}</option>)}</select></label>
              <label>作用 {index + 1}<select value={component.role} onChange={(event) => updateComponent(index, { role: event.target.value as DraftComponent['role'] })}><option value="ingredient">主配料</option><option value="seasoning">调味</option></select></label>
              {components.length > 1 ? <button type="button" onClick={() => setComponents((current) => current.filter((_, candidate) => candidate !== index))}>移除食材 {index + 1}</button> : null}
            </div>)}
          </div>
          {incompatible.length ? <p className="recipe-inline-error" role="alert">{incompatible.map(({ item, unit }) => `${item.name}不支持 ${unit} 换算`).join('；')}</p> : null}
        </section>

        <section aria-labelledby="recipe-steps-title">
          <div className="recipe-editor__section-heading"><div><span>Sequence</span><h3 id="recipe-steps-title">步骤</h3></div><button type="button" onClick={() => setSteps((current) => [...current, { instruction: '', durationSeconds: null, caution: '' }])}>添加步骤</button></div>
          <div className="recipe-editor__rows">
            {steps.map((step, index) => <div className="recipe-editor__step" key={index}>
              <div className="recipe-editor__step-index"><strong>{String(index + 1).padStart(2, '0')}</strong><div><button type="button" disabled={index === 0} aria-label={`上移步骤 ${index + 1}`} onClick={() => moveStep(index, -1)}>↑</button><button type="button" disabled={index === steps.length - 1} aria-label={`下移步骤 ${index + 1}`} onClick={() => moveStep(index, 1)}>↓</button></div></div>
              <label>步骤 {index + 1}<textarea value={step.instruction} onChange={(event) => updateStep(index, { instruction: event.target.value })} /></label>
              <label>计时秒数 {index + 1}<input type="number" min="0" value={step.durationSeconds ?? ''} onChange={(event) => updateStep(index, { durationSeconds: event.target.value ? Number(event.target.value) : null })} /></label>
              <label>注意事项 {index + 1}<input value={step.caution} onChange={(event) => updateStep(index, { caution: event.target.value })} /></label>
              {steps.length > 1 ? <button type="button" onClick={() => setSteps((current) => current.filter((_, candidate) => candidate !== index))}>移除步骤 {index + 1}</button> : null}
            </div>)}
          </div>
        </section>
      </div>

      <footer className="recipe-task-layer__footer">
        <p>{valid ? '配料、单位和步骤已形成可保存草稿。' : '补全名称、份数、配料单位和步骤后继续。'}</p>
        <div><button type="button" onClick={onClose}>取消</button>{recipe
          ? <button type="button" disabled={!valid || busy} onClick={() => void onPreview({ ...input(), entityVersion: recipe.entityVersion }).catch(() => undefined)}>预览版本影响</button>
          : <button type="button" disabled={!valid || busy} onClick={() => void onCreate(input()).catch(() => undefined)}>创建草稿</button>}</div>
      </footer>
    </aside>
  )
}
