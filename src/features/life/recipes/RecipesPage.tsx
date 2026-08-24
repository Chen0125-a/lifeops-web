import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { lifeCatalogApi } from '../../../api/lifeCatalogApi'
import { HttpError } from '../../../api/httpClient'
import { lifeInventoryApi } from '../../../api/lifeInventoryApi'
import { queryKeys } from '../../../api/queryKeys'
import { lifeRecipesApi } from '../../../api/lifeRecipesApi'
import type { CookingCompletionResult, CookingSession, Recipe, RecipeImpactPreview, RecipeInput, RecipeVersion } from '../../../domain/lifeRecipes'
import { useAuth } from '../../../state/AuthContext'
import { CookingMode } from './CookingMode'
import { RecipeEditor } from './RecipeEditor'
import { RecipeInspector } from './RecipeInspector'
import { RecipeRelations } from './RecipeRelations'
import { RecipeVersionDiff } from './RecipeVersionDiff'

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function queryError(error: unknown) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return '当前设备离线。食谱草稿不会被提交，请联网后重试。'
  if (error instanceof HttpError && error.status === 409) return '食谱已在另一处更新。当前页面没有覆盖新版本，请重新加载并核对。'
  if (error instanceof HttpError && [401, 403].includes(error.status)) return '你没有查看或修改这个食谱库的权限。'
  return '食谱事实暂时无法加载，请稍后重试。'
}

export function RecipesPage() {
  const auth = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('recipe')
  const relationOpen = searchParams.get('view') === 'relations'
  const [editor, setEditor] = useState<Recipe | 'new' | null>(null)
  const [previewState, setPreviewState] = useState<{ preview: RecipeImpactPreview; input: RecipeInput & { entityVersion: number } } | null>(null)
  const [pinnedVersionId, setPinnedVersionId] = useState<string | null>(null)
  const [scaleServings, setScaleServings] = useState(1)
  const [activeSession, setActiveSession] = useState<CookingSession | null>(null)
  const [cookingOpen, setCookingOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [completionMessage, setCompletionMessage] = useState<string | null>(null)
  const originRecipeId = useRef<string | null>(null)
  const rowButtons = useRef(new Map<string, HTMLButtonElement>())

  const recipesQuery = useQuery({ queryKey: queryKeys.lifeRecipes.lists, queryFn: ({ signal }) => lifeRecipesApi.list(signal) })
  const itemsQuery = useQuery({ queryKey: queryKeys.lifeCatalog.lists, queryFn: ({ signal }) => lifeCatalogApi.list({}, signal) })
  const unitsQuery = useQuery({ queryKey: queryKeys.lifeUnits.lists, queryFn: ({ signal }) => lifeCatalogApi.listUnits(signal) })
  const relationsQuery = useQuery({ queryKey: queryKeys.lifeRecipes.list({ view: 'relations' }), queryFn: ({ signal }) => lifeRecipesApi.listRelations(undefined, signal) })
  const balancesQuery = useQuery({ queryKey: queryKeys.lifeInventory.list({ view: 'recipe-balances' }), queryFn: ({ signal }) => lifeInventoryApi.listBalances({}, signal) })
  const transactionsQuery = useQuery({ queryKey: queryKeys.lifeInventory.list({ view: 'recipe-transactions' }), queryFn: ({ signal }) => lifeInventoryApi.listTransactions({}, signal) })
  const preparedQuery = useQuery({ queryKey: queryKeys.lifeRecipes.list({ view: 'prepared-food' }), queryFn: ({ signal }) => lifeRecipesApi.listPreparedFood(signal) })
  const selectedQuery = useQuery({ queryKey: queryKeys.lifeRecipes.detail(selectedId ?? ''), queryFn: ({ signal }) => lifeRecipesApi.get(selectedId!, signal), enabled: Boolean(selectedId) })
  const recipes = recipesQuery.data ?? []
  const selectedRecipe = selectedQuery.data ?? recipes.find((recipe) => recipe.id === selectedId)
  const versionsQuery = useQuery({ queryKey: [...queryKeys.lifeRecipes.detail(selectedId ?? ''), 'versions'], queryFn: ({ signal }) => lifeRecipesApi.listVersions(selectedId!, signal), enabled: Boolean(selectedId) })
  const versions = versionsQuery.data ?? (selectedRecipe ? [selectedRecipe.currentVersion] : [])
  const selectedVersion = versions.find((version) => version.id === pinnedVersionId) ?? selectedRecipe?.currentVersion
  const calculationQuery = useQuery({
    queryKey: [...queryKeys.lifeRecipes.detail(selectedId ?? ''), 'calculation', pinnedVersionId ?? 'latest', localDateKey()],
    queryFn: ({ signal }) => lifeRecipesApi.calculate(selectedId!, pinnedVersionId ? { mode: 'pinned', versionId: pinnedVersionId, asOf: localDateKey() } : { mode: 'latest', asOf: localDateKey() }, signal),
    enabled: Boolean(selectedId),
  })

  useEffect(() => {
    if (!selectedRecipe) return
    setScaleServings(selectedRecipe.currentVersion.servings)
    setPinnedVersionId(null)
  }, [selectedRecipe?.id])

  const coreQueries = [recipesQuery, itemsQuery, unitsQuery, relationsQuery, balancesQuery, transactionsQuery]
  const firstError = coreQueries.find((query) => query.error)?.error
  const isLoading = coreQueries.some((query) => query.isPending)

  const updateSearch = (patch: Record<string, string | null>) => setSearchParams((current) => {
    const next = new URLSearchParams(current)
    for (const [key, value] of Object.entries(patch)) value == null ? next.delete(key) : next.set(key, value)
    return next
  })
  const openRecipe = (id: string) => {
    originRecipeId.current = id
    updateSearch({ recipe: id, view: null })
  }
  const closeInspector = () => {
    const id = originRecipeId.current ?? selectedId
    updateSearch({ recipe: null, view: null })
    requestAnimationFrame(() => { if (id) rowButtons.current.get(id)?.focus() })
  }

  const perform = async <T,>(action: () => Promise<T>) => {
    setBusy(true); setWriteError(null)
    try { return await action() } catch (error) { setWriteError(queryError(error)); throw error } finally { setBusy(false) }
  }
  const createRecipe = async (input: RecipeInput) => {
    const created = await perform(() => lifeRecipesApi.create(input, `recipe:create:${crypto.randomUUID()}`, auth.csrfToken))
    setEditor(null); await recipesQuery.refetch(); openRecipe(created.id)
  }
  const previewRecipe = async (input: RecipeInput & { entityVersion: number }) => {
    if (!selectedRecipe) return
    const preview = await perform(() => lifeRecipesApi.previewImpact(selectedRecipe.id, input, auth.csrfToken))
    setPreviewState({ preview, input })
  }
  const confirmUpdate = async () => {
    if (!selectedRecipe || !previewState) return
    const updated = await perform(() => lifeRecipesApi.update(selectedRecipe.id, previewState.input, auth.csrfToken))
    setPreviewState(null); setEditor(null); await Promise.all([recipesQuery.refetch(), selectedQuery.refetch(), versionsQuery.refetch()])
    setScaleServings(updated.currentVersion.servings)
  }
  const startCooking = async () => {
    if (!selectedRecipe || !selectedVersion) return
    const session = await perform(() => lifeRecipesApi.createCookingSession({ recipeId: selectedRecipe.id, recipeVersionId: selectedVersion.id, plannedServings: scaleServings, note: '' }, `cooking:start:${crypto.randomUUID()}`, auth.csrfToken))
    setActiveSession(session); setCookingOpen(true)
  }
  const continueCooking = async () => {
    if (!activeSession) return
    const signal = new AbortController().signal
    const session = await perform(() => lifeRecipesApi.getCookingSession(activeSession.id, signal))
    setActiveSession(session); setCookingOpen(true)
  }
  const saveCooking = async (progress: Parameters<typeof lifeRecipesApi.updateCookingSession>[1]) => {
    if (!activeSession) throw new Error('No active cooking session')
    const session = await perform(() => lifeRecipesApi.updateCookingSession(activeSession.id, progress, auth.csrfToken))
    setActiveSession(session); return session
  }
  const promoteNote = async () => {
    if (!activeSession || !selectedRecipe) throw new Error('No active cooking session')
    return perform(() => lifeRecipesApi.promoteCookingNote(activeSession.id, selectedRecipe.entityVersion, `cooking:promote:${crypto.randomUUID()}`, auth.csrfToken))
  }
  const completeCooking = async (input: Parameters<typeof lifeRecipesApi.completeCookingSession>[1]): Promise<CookingCompletionResult> => {
    if (!activeSession) throw new Error('No active cooking session')
    const result = await perform(() => lifeRecipesApi.completeCookingSession(activeSession.id, input, `cooking:complete:${crypto.randomUUID()}`, auth.csrfToken))
    setCompletionMessage(`已记录吃掉 ${result.intake.servings} 份，并保存 ${result.preparedFood?.portionsRemaining ?? 0} 份成品库存。`)
    setCookingOpen(false); setActiveSession(null); await Promise.all([recipesQuery.refetch(), balancesQuery.refetch(), preparedQuery.refetch()])
    return result
  }

  const sortedRecipes = useMemo(() => [...recipes].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name)), [recipes])

  if (isLoading) return <main className="recipes-workspace is-loading" aria-busy="true"><div className="recipe-skeleton" /><p>正在汇总食谱、库存与关系事实…</p></main>
  if (firstError) return <main className="recipes-workspace"><div className="life-route-error" role="alert"><h1>食谱与做菜</h1><p>{queryError(firstError)}</p><button type="button" onClick={() => void Promise.all(coreQueries.map((query) => query.refetch()))}>重新加载食谱事实</button></div></main>

  return <main className="recipes-workspace">
    <header className="recipes-workspace__heading"><div><span>Recipe library · Current facts</span><h1 tabIndex={-1}>食谱与做菜</h1><p>版本、比例、库存可做性、实际用量与成品剩余在同一条事实链上。</p></div><div><button type="button" onClick={() => updateSearch({ view: relationOpen ? null : 'relations' })}>食谱关系</button><button type="button" onClick={() => setEditor('new')}>新建食谱</button></div></header>
    {writeError ? <div className="recipe-write-error" role="alert"><span>{writeError}</span><button type="button" onClick={() => setWriteError(null)}>关闭错误</button></div> : null}
    {completionMessage ? <div className="recipe-completion-message" role="status">{completionMessage}</div> : null}

    <section className="recipes-workspace__overview" aria-label="食谱库摘要"><div><span>当前食谱</span><strong>{recipes.length}</strong></div><div><span>成品库存</span><strong>{preparedQuery.data?.reduce((sum, stock) => sum + stock.portionsRemaining, 0) ?? 0} 份</strong></div><div><span>可追溯关系</span><strong>{relationsQuery.data?.length ?? 0}</strong></div></section>

    <div className={selectedRecipe || relationOpen ? 'recipes-workspace__canvas has-task' : 'recipes-workspace__canvas'}>
      <section className="recipe-index" aria-label="食谱列表"><div className="recipe-section-title"><span>Library index</span><h2>食谱索引</h2></div>{sortedRecipes.length ? <ol>{sortedRecipes.map((recipe) => {
        const calculationHint = recipe.id === selectedRecipe?.id ? calculationQuery.data : null
        return <li key={recipe.id} className={recipe.id === selectedId ? 'is-selected' : ''}><div><span>v{recipe.currentVersion.number}</span><strong>{recipe.name}</strong><p>{recipe.currentVersion.components.length} 种配料 · {recipe.prepMinutes + recipe.cookMinutes} 分钟</p></div><div>{calculationHint?.status === 'complete' ? <span>当前可计算</span> : null}<button ref={(node) => { if (node) rowButtons.current.set(recipe.id, node); else rowButtons.current.delete(recipe.id) }} type="button" onClick={() => openRecipe(recipe.id)}>打开食谱 {recipe.name}</button></div></li>})}</ol> : <div className="life-empty"><h2>还没有食谱</h2><p>从一份可计算的草稿开始；不会用示例内容冒充你的食谱。</p><button type="button" onClick={() => setEditor('new')}>创建第一份食谱</button></div>}</section>

      {relationOpen ? <RecipeRelations recipe={selectedRecipe} relations={relationsQuery.data ?? []} items={itemsQuery.data ?? []} balances={balancesQuery.data ?? []} transactions={transactionsQuery.data ?? []} onClose={() => updateSearch({ view: null })} onOpenRecipe={openRecipe} /> : selectedRecipe && selectedVersion ? <RecipeInspector
        recipe={selectedRecipe} version={selectedVersion} versions={versions} calculation={calculationQuery.data} calculationPending={calculationQuery.isPending}
        pinned={Boolean(pinnedVersionId)} scaleServings={scaleServings} items={itemsQuery.data ?? []} units={unitsQuery.data ?? []} canContinueCooking={Boolean(activeSession)}
        onScaleServings={setScaleServings} onPin={(version: RecipeVersion) => setPinnedVersionId(version.id)} onClose={closeInspector} onEdit={() => setEditor(selectedRecipe)}
        onStartCooking={() => void startCooking().catch(() => undefined)} onContinueCooking={() => void continueCooking().catch(() => undefined)} onRelations={() => updateSearch({ view: 'relations' })}
      /> : null}
    </div>

    {editor ? <RecipeEditor recipe={editor === 'new' ? undefined : editor} items={itemsQuery.data ?? []} units={unitsQuery.data ?? []} busy={busy} onClose={() => setEditor(null)} onCreate={createRecipe} onPreview={previewRecipe} /> : null}
    {previewState ? <RecipeVersionDiff preview={previewState.preview} items={itemsQuery.data ?? []} busy={busy} onCancel={() => setPreviewState(null)} onConfirm={confirmUpdate} /> : null}
    {cookingOpen && activeSession && selectedRecipe && selectedVersion && calculationQuery.data?.status === 'complete' ? <CookingMode recipe={selectedRecipe} version={selectedVersion} session={activeSession} calculation={calculationQuery.data} items={itemsQuery.data ?? []} units={unitsQuery.data ?? []} busy={busy} onExit={() => setCookingOpen(false)} onSave={saveCooking} onPromote={promoteNote} onComplete={completeCooking} /> : null}
  </main>
}

export function RecipesRoute() { return <RecipesPage /> }
