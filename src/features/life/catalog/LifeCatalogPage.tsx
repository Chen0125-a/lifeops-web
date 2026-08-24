import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { lifeCatalogApi } from '../../../api/lifeCatalogApi'
import { lifeInventoryApi } from '../../../api/lifeInventoryApi'
import { HttpError } from '../../../api/httpClient'
import { queryKeys } from '../../../api/queryKeys'
import type { CatalogDeleteImpact, CatalogItem, CreateCatalogItemInput, CreateTaxonomyInput, CreateUnitInput, LifeItemKind, LifeUnit, TaxonomyEntity, TaxonomyKind, UpdateCatalogItemInput, UpdateTaxonomyInput, UpdateUnitInput } from '../../../domain/lifeCatalog'
import type { InventoryBalance, InventoryForecast, InventoryTransaction } from '../../../domain/lifeInventory'
import { useAuth } from '../../../state/AuthContext'
import { InventoryLedger } from './InventoryLedger'
import { ItemEditor } from './ItemEditor'
import { TaxonomyTree } from './TaxonomyTree'
import { ConversionFacts } from './UnitConversionEditor'

export type CatalogWorkspaceVariant = 'inventory' | 'medicine' | 'household'

interface LifeCatalogPageProps { variant?: CatalogWorkspaceVariant }

const tabSets: Record<CatalogWorkspaceVariant, Array<{ kind: LifeItemKind; label: string }>> = {
  inventory: [{ kind: 'ingredient', label: '食材' }, { kind: 'supplement', label: '补充剂' }],
  medicine: [{ kind: 'medicine', label: '药品' }],
  household: [{ kind: 'household_consumable', label: '消耗品' }, { kind: 'household_durable', label: '耐用品' }],
}

const pageCopy = {
  inventory: { title: '物品与库存', description: '把营养、单位、价格、位置、批次与不可变库存流水放在同一条事实链上。' },
  medicine: { title: '药品事实库', description: '只保存你录入的包装、库存、有效期、时间计划与使用记录。这里不生成诊断、剂量、停药或相互作用建议。' },
  household: { title: '家庭物品', description: '分别维护消耗品补货周期与耐用品价值、生命周期和维护事实。' },
} as const

function unitLabel(code: string, units: LifeUnit[]) {
  const unit = units.find((candidate) => candidate.code === code)
  return unit?.symbol || unit?.name || code
}

function money(amountMinor: number, currency = 'CNY') {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(amountMinor / 100)
}

function queryErrorStatus(error: unknown) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return '当前设备离线。已保留当前页面，请联网后重新加载。'
  if (error instanceof HttpError && error.status === 409) return '这些事实已经在另一处更新。当前页面没有覆盖新版本，请重新加载并核对。'
  if (error instanceof HttpError && [401, 403].includes(error.status)) return '你没有查看或修改这个生活事实库的权限。'
  return '生活事实库暂时无法加载，请稍后重试。'
}

function profileFacts(item: CatalogItem) {
  if (item.profile?.kind === 'supplement') return <section className="catalog-inspector__facts"><h3>用户记录的补充剂事实</h3><p>这是用户自行记录的用量、频率与提醒事实。</p><dl>
    {item.profile.servingQuantity !== undefined ? <div><dt>每次用量</dt><dd>{item.profile.servingQuantity} {item.profile.servingUnit}</dd></div> : null}
    {item.profile.ingredients?.map((ingredient) => <div key={ingredient}><dt>成分</dt><dd>{ingredient}</dd></div>)}
    {item.profile.defaultFrequency ? <div><dt>用户频率</dt><dd>{item.profile.defaultFrequency}</dd></div> : null}
    {item.profile.userInstructions ? <div><dt>用户说明</dt><dd>{item.profile.userInstructions}</dd></div> : null}
    {item.profile.reminder?.localTimes.map((time) => <div key={time}><dt>提醒时间</dt><dd>{time}</dd></div>)}
    {item.profile.reminder?.note ? <div><dt>提醒说明</dt><dd>{item.profile.reminder.note}</dd></div> : null}
  </dl></section>
  if (item.profile?.kind === 'household_consumable') return <section className="catalog-inspector__facts"><h3>消耗品事实</h3><dl>
    {item.profile.defaultPurchaseQuantity !== undefined ? <div><dt>采购基线</dt><dd>默认采购 {item.profile.defaultPurchaseQuantity} {item.profile.defaultPurchaseUnit}</dd></div> : null}
    {item.profile.consumptionCycleDays !== undefined ? <div><dt>消耗周期</dt><dd>预计 {item.profile.consumptionCycleDays} 天消耗周期</dd></div> : null}
    {item.profile.estimatedDepletionDate ? <div><dt>预计用尽</dt><dd>预计用尽日 {item.profile.estimatedDepletionDate}</dd></div> : null}
  </dl></section>
  if (item.profile?.kind === 'household_durable') {
    const lifecycle = { active: '使用中', maintenance: '维护中', retired: '已退役' }[item.profile.lifecycleStatus ?? 'active']
    return <section className="catalog-inspector__facts"><h3>耐用品事实</h3><dl>
      {item.profile.valueMinor !== undefined ? <div><dt>用户记录价值</dt><dd>用户记录价值 {money(item.profile.valueMinor, item.profile.currency)}{item.profile.valueAsOfDate ? ` · 截至 ${item.profile.valueAsOfDate}` : ''}</dd></div> : null}
      <div><dt>生命周期</dt><dd>{lifecycle}</dd></div>
      {item.profile.acquiredOn ? <div><dt>购入日期</dt><dd>{item.profile.acquiredOn}</dd></div> : null}
      {item.profile.warrantyExpiresOn ? <div><dt>保修到期</dt><dd>{item.profile.warrantyExpiresOn}</dd></div> : null}
      {item.profile.retiredOn ? <div><dt>退役日期</dt><dd>{item.profile.retiredOn}</dd></div> : null}
      {item.profile.retirementReason ? <div><dt>用户记录退役原因</dt><dd>{item.profile.retirementReason}</dd></div> : null}
      {item.profile.maintenanceRecords?.map((record) => <div key={record.id}><dt>维护</dt><dd>{record.performedOn} · {record.summary}{record.costMinor !== undefined ? ` · ${money(record.costMinor, record.currency)}` : ''}</dd></div>)}
      {item.profile.setItemIds?.map((id) => <div key={id}><dt>组成关系</dt><dd>组成物品 {id}</dd></div>)}
    </dl></section>
  }
  return null
}

function medicineFacts(item: CatalogItem) {
  if (!item.medicine) return null
  return <section className="catalog-inspector__facts"><h3>用户录入的药品事实</h3><dl>
    {item.medicine.tradeName ? <div><dt>商品名</dt><dd>{item.medicine.tradeName}</dd></div> : null}
    {item.medicine.genericName ? <div><dt>通用名</dt><dd>{item.medicine.genericName}</dd></div> : null}
    {item.medicine.specification ? <div><dt>规格</dt><dd>{item.medicine.specification}</dd></div> : null}
    {item.medicine.dosageForm ? <div><dt>剂型</dt><dd>{item.medicine.dosageForm}</dd></div> : null}
    {item.medicine.packageDescription ? <div><dt>包装</dt><dd>{item.medicine.packageDescription}</dd></div> : null}
    {item.medicine.userInstructions ? <div><dt>用户说明</dt><dd>用户说明：{item.medicine.userInstructions}</dd></div> : null}
    {item.medicine.userScheduleText ? <div><dt>用户计划</dt><dd>用户计划：{item.medicine.userScheduleText}</dd></div> : null}
    <div><dt>按需状态</dt><dd>{item.medicine.asNeeded ? '用户记录为按需' : '未记录为按需'}</dd></div>
  </dl><p className="catalog-safety-note">本页不验证或推断药品用法。需要医疗判断时请联系有资质的专业人员。</p></section>
}

function ItemInspector({ item, units, balance, forecast, transactions, onClose, onEdit, onDelete, onCreateTransaction, onReverseTransaction }: {
  item: CatalogItem
  units: LifeUnit[]
  balance?: InventoryBalance
  forecast?: InventoryForecast
  transactions: InventoryTransaction[]
  onClose(): void
  onEdit(): void
  onDelete(): void
  onCreateTransaction: Parameters<typeof InventoryLedger>[0]['onCreate']
  onReverseTransaction: Parameters<typeof InventoryLedger>[0]['onReverse']
}) {
  return <aside className="catalog-inspector" role="region" aria-label={`${item.name}详情`}>
    <header><div><button className="catalog-inspector__back" type="button" onClick={onClose}>返回列表</button><span>{item.kind === 'medicine' ? '用户药品事实' : '物品事实'}</span><h2>{item.name}</h2><p>{item.aliases.length ? item.aliases.join(' · ') : '没有别名'}</p></div><div><button type="button" onClick={onEdit}>编辑</button><button type="button" onClick={onDelete}>移入回收站 {item.name}</button></div></header>
    <section className="catalog-inspector__facts"><h3>归类</h3><dl><div><dt>基础单位</dt><dd>{unitLabel(item.baseUnit, units)}</dd></div><div><dt>状态</dt><dd>{item.status === 'active' ? '启用' : '停用'}</dd></div></dl></section>
    {item.nutrition ? <section className="catalog-inspector__facts"><h3>营养事实（每 {item.nutrition.basisQuantity} {unitLabel(item.nutrition.basisUnit, units)}）</h3><dl>
      <div><dt>能量</dt><dd>{item.nutrition.values.energyKcal} kcal</dd></div><div><dt>蛋白质</dt><dd>{item.nutrition.values.proteinGrams} g</dd></div><div><dt>脂肪</dt><dd>{item.nutrition.values.fatGrams} g</dd></div><div><dt>碳水</dt><dd>{item.nutrition.values.carbohydrateGrams} g</dd></div>
      {Object.entries(item.nutrition.values.custom ?? {}).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
    </dl></section> : null}
    {profileFacts(item)}
    {medicineFacts(item)}
    <ConversionFacts itemId={item.id} baseUnit={item.baseUnit} availableUnits={item.availableUnits} conversions={item.itemConversions} units={units} />
    <section className="catalog-inspector__facts"><h3>价格历史</h3>{item.pricePoints.length ? <ol>{[...item.pricePoints].sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom)).map((point) => <li key={point.id}>{point.effectiveFrom} · {money(point.amountMinor, point.currency)} / {point.purchaseQuantity} {unitLabel(point.purchaseUnit, units)}</li>)}</ol> : <p>没有已确认的价格历史。</p>}</section>
    <InventoryLedger item={item} units={units} balance={balance} forecast={forecast} transactions={transactions} onCreate={onCreateTransaction} onReverse={onReverseTransaction} />
  </aside>
}

export function LifeCatalogPage({ variant = 'inventory' }: LifeCatalogPageProps) {
  const auth = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabs = tabSets[variant]
  const requestedKind = searchParams.get('kind') as LifeItemKind | null
  const activeKind = tabs.some((tab) => tab.kind === requestedKind) ? requestedKind! : tabs[0].kind
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [bulkLocationId, setBulkLocationId] = useState('')
  const [bulkTagId, setBulkTagId] = useState('')
  const [bulkStatus, setBulkStatus] = useState<'' | 'active' | 'disabled'>('')
  const [batchUndo, setBatchUndo] = useState<Array<{ id: string; name: string; input: UpdateCatalogItemInput }>>([])
  const [editorItem, setEditorItem] = useState<CatalogItem | 'new' | null>(null)
  const [deleteState, setDeleteState] = useState<{ item: CatalogItem; impact: CatalogDeleteImpact } | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const catalogQuery = useQuery({ queryKey: queryKeys.lifeCatalog.lists, queryFn: ({ signal }) => lifeCatalogApi.list({}, signal) })
  const categoriesQuery = useQuery({ queryKey: queryKeys.lifeTaxonomy.list({ kind: 'category' }), queryFn: ({ signal }) => lifeCatalogApi.listTaxonomy('category', signal) })
  const tagsQuery = useQuery({ queryKey: queryKeys.lifeTaxonomy.list({ kind: 'tag' }), queryFn: ({ signal }) => lifeCatalogApi.listTaxonomy('tag', signal) })
  const locationsQuery = useQuery({ queryKey: queryKeys.lifeTaxonomy.list({ kind: 'location' }), queryFn: ({ signal }) => lifeCatalogApi.listTaxonomy('location', signal) })
  const unitsQuery = useQuery({ queryKey: queryKeys.lifeUnits.lists, queryFn: ({ signal }) => lifeCatalogApi.listUnits(signal) })
  const balancesQuery = useQuery({ queryKey: queryKeys.lifeInventory.list({ view: 'balances' }), queryFn: ({ signal }) => lifeInventoryApi.listBalances({}, signal) })
  const transactionsQuery = useQuery({ queryKey: queryKeys.lifeInventory.list({ view: 'transactions' }), queryFn: ({ signal }) => lifeInventoryApi.listTransactions({}, signal) })
  const forecastsQuery = useQuery({ queryKey: queryKeys.lifeInventory.list({ view: 'forecasts' }), queryFn: ({ signal }) => lifeInventoryApi.listForecasts({}, signal) })
  const queries = [catalogQuery, categoriesQuery, tagsQuery, locationsQuery, unitsQuery, balancesQuery, transactionsQuery, forecastsQuery]
  const firstError = queries.find((query) => query.error)?.error
  const items = catalogQuery.data ?? []
  const categories = categoriesQuery.data ?? []
  const tags = tagsQuery.data ?? []
  const locations = locationsQuery.data ?? []
  const units = unitsQuery.data ?? []
  const balances = balancesQuery.data ?? []
  const transactions = transactionsQuery.data ?? []
  const forecasts = forecastsQuery.data ?? []
  const searchQuery = searchParams.get('q')?.trim() ?? ''
  const normalizedSearch = searchQuery.toLocaleLowerCase('zh-CN')
  const visibleItems = items.filter((item) => item.kind === activeKind && !item.deletedAt && (!normalizedSearch || [item.name, ...item.aliases].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedSearch))))
  const requestedItem = searchParams.get('item')
  const selectedItem = items.find((item) => item.id === requestedItem) ?? (variant === 'medicine' ? visibleItems[0] : null)
  const labels = useMemo(() => new Map(categories.map((entry) => [entry.id, entry.name])), [categories])

  const changeTab = (kind: LifeItemKind) => {
    const next = new URLSearchParams(searchParams)
    next.set('kind', kind)
    next.delete('item')
    setSearchParams(next)
    setSelectedIds([])
  }

  const selectItem = (item: CatalogItem) => {
    const next = new URLSearchParams(searchParams)
    next.set('item', item.id)
    setSearchParams(next)
  }

  const saveItem = async (input: CreateCatalogItemInput | UpdateCatalogItemInput) => {
    if (editorItem && editorItem !== 'new' && 'version' in input) await lifeCatalogApi.update(editorItem.id, input, auth.csrfToken)
    else await lifeCatalogApi.create(input as CreateCatalogItemInput, `catalog:${crypto.randomUUID()}`, auth.csrfToken)
    await catalogQuery.refetch()
    setAnnouncement(`${input.name}已保存`)
  }

  const previewDelete = async (item: CatalogItem) => {
    const impact = await lifeCatalogApi.deleteImpact(item.id)
    setDeleteState({ item, impact })
  }

  const remove = async () => {
    if (!deleteState) return
    await lifeCatalogApi.remove(deleteState.item.id, deleteState.item.version, auth.csrfToken)
    setAnnouncement(`${deleteState.item.name}已移入回收站`)
    setDeleteState(null)
    const next = new URLSearchParams(searchParams); next.delete('item'); setSearchParams(next, { replace: true })
    await catalogQuery.refetch()
  }

  const updateTaxonomy = useCallback(async (kind: TaxonomyKind, id: string, input: UpdateTaxonomyInput) => {
    await lifeCatalogApi.updateTaxonomy(kind, id, input, auth.csrfToken)
    if (kind === 'category') await categoriesQuery.refetch()
    if (kind === 'tag') await tagsQuery.refetch()
    if (kind === 'location') await locationsQuery.refetch()
  }, [auth.csrfToken, categoriesQuery, locationsQuery, tagsQuery])

  const refetchTaxonomy = async (kind: TaxonomyKind) => {
    if (kind === 'category') await categoriesQuery.refetch()
    if (kind === 'tag') await tagsQuery.refetch()
    if (kind === 'location') await locationsQuery.refetch()
  }

  const createTaxonomy = async (kind: TaxonomyKind, input: CreateTaxonomyInput) => {
    await lifeCatalogApi.createTaxonomy(kind, input, auth.csrfToken)
    await refetchTaxonomy(kind)
    setAnnouncement(`${input.name}已创建`)
  }

  const removeTaxonomy = async (kind: TaxonomyKind, id: string, version: number) => {
    await lifeCatalogApi.removeTaxonomy(kind, id, version, auth.csrfToken)
    await refetchTaxonomy(kind)
    setAnnouncement('分类工具对象已软删除，稳定关系仍被保留')
  }

  const createUnit = async (input: CreateUnitInput) => {
    await lifeCatalogApi.createUnit(input, auth.csrfToken)
    await unitsQuery.refetch()
    setAnnouncement(`${input.name}单位已创建`)
  }

  const updateUnit = async (id: string, input: UpdateUnitInput) => {
    await lifeCatalogApi.updateUnit(id, input, auth.csrfToken)
    await unitsQuery.refetch()
    setAnnouncement(`${input.name ?? id}单位已更新`)
  }

  const removeUnit = async (id: string, version: number) => {
    await lifeCatalogApi.removeUnit(id, version, auth.csrfToken)
    await unitsQuery.refetch()
    setAnnouncement('自定义单位已软删除；引用该单位的事实仍由稳定 ID 保留')
  }

  const applyBulk = async () => {
    if ((!bulkCategoryId && !bulkLocationId && !bulkTagId && !bulkStatus) || !selectedIds.length) return
    const selected = items.filter((item) => selectedIds.includes(item.id))
    const patch = {
      ...(bulkCategoryId ? { categoryId: bulkCategoryId } : {}),
      ...(bulkLocationId ? { locationId: bulkLocationId } : {}),
      ...(bulkTagId ? { addTagIds: [bulkTagId] } : {}),
      ...(bulkStatus ? { status: bulkStatus } : {}),
    }
    const changed = await lifeCatalogApi.batchUpdate({ items: selected.map((item) => ({ id: item.id, version: item.version })), patch }, auth.csrfToken)
    setBatchUndo(selected.map((item) => ({
      id: item.id,
      name: item.name,
      input: {
        version: changed.find((candidate) => candidate.id === item.id)?.version ?? item.version + 1,
        categoryId: item.categoryId,
        locationId: item.locationId,
        tagIds: item.tagIds,
        status: item.status,
      },
    })))
    setAnnouncement(`${selected.length} 项元数据已批量更新`)
    setBulkOpen(false)
    setSelectedIds([])
    setBulkCategoryId('')
    setBulkLocationId('')
    setBulkTagId('')
    setBulkStatus('')
    await catalogQuery.refetch()
  }

  const undoBulk = async () => {
    const undo = batchUndo
    if (!undo.length) return
    await Promise.all(undo.map((entry) => lifeCatalogApi.update(entry.id, entry.input, auth.csrfToken)))
    setBatchUndo([])
    setAnnouncement(`${undo.map((entry) => entry.name).join('、')}的批量元数据修改已撤销`)
    await catalogQuery.refetch()
  }

  const retryAll = () => { queries.forEach((query) => void query.refetch()) }

  return <article className="life-catalog" data-catalog-variant={variant}>
    <header className="life-catalog__heading"><div><h1 tabIndex={-1}>{pageCopy[variant].title}</h1><p>{pageCopy[variant].description}</p></div><div className="life-catalog__heading-actions">{variant === 'inventory' ? <><Link to="/app/life/medicines">药品事实</Link><Link to="/app/life/household">家庭物品</Link></> : <Link to="/app/life/ingredients">返回统一库存</Link>}<button type="button" onClick={() => setEditorItem('new')}>新建{tabs.find((tab) => tab.kind === activeKind)?.label}</button></div></header>
    {firstError ? <section className="life-catalog__error" role="alert"><p>{queryErrorStatus(firstError)}</p><button type="button" onClick={retryAll}>重新加载</button></section> : null}
    {queries.some((query) => query.isPending) ? <div className="life-catalog__loading" role="status"><span />正在读取分类、库存与价格事实…</div> : null}
    <div className="life-catalog__tabs" role="tablist" aria-label={`${pageCopy[variant].title}视图`}>{tabs.map((tab) => <button key={tab.kind} type="button" role="tab" aria-selected={activeKind === tab.kind} onClick={() => changeTab(tab.kind)}>{tab.label}</button>)}</div>

    <div className={`life-catalog__workspace ${selectedItem ? 'has-inspector' : ''}`}>
      <TaxonomyTree categories={categories} tags={tags} locations={locations} units={units} onCreate={createTaxonomy} onUpdate={updateTaxonomy} onRemove={removeTaxonomy} onCreateUnit={createUnit} onUpdateUnit={updateUnit} onRemoveUnit={removeUnit} />
      <section className="catalog-list" aria-label={`${tabs.find((tab) => tab.kind === activeKind)?.label}列表`}>
        <header><div><h2>{tabs.find((tab) => tab.kind === activeKind)?.label}</h2><p>{visibleItems.length} 项已记录</p></div><label>搜索当前列表<input type="search" placeholder="名称或别名" value={searchQuery} onChange={(event) => { const next = new URLSearchParams(searchParams); if (event.target.value) next.set('q', event.target.value); else next.delete('q'); next.delete('item'); setSearchParams(next, { replace: true }) }} /></label></header>
        {visibleItems.length ? <div className="catalog-list__rows" role="list">{visibleItems.map((item) => {
          const balance = balances.find((entry) => entry.itemId === item.id)
          const forecast = forecasts.find((entry) => entry.itemId === item.id)
          const category = categories.find((entry) => entry.id === item.categoryId)
          const location = locations.find((entry) => entry.id === item.locationId)
          const missingUnit = item.availableUnits.find((unit) => unit !== item.baseUnit && !item.itemConversions.some((entry) => entry.fromUnit === unit && entry.toUnit === item.baseUnit))
          return <article key={item.id} role="listitem" className={selectedItem?.id === item.id ? 'is-selected' : ''}>
            <label className="catalog-list__select"><input type="checkbox" aria-label={`选择 ${item.name}`} checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><span /></label>
            <button type="button" className="catalog-list__main" aria-label={`查看 ${item.name}`} onClick={() => selectItem(item)}><strong>{item.name}</strong><span>{category?.name ?? '未分类'} · {location?.name ?? '未指定位置'}</span></button>
            <div className="catalog-list__balance"><strong>{balance ? `${balance.onHand} ${unitLabel(balance.baseUnit, units)}` : '尚无余额'}</strong><span>{forecast?.status === 'complete' ? `预计 ${forecast.projectedBalance} ${unitLabel(forecast.baseUnit, units)}` : '预测不完整'}</span></div>
            {forecast?.status === 'incomplete' && missingUnit ? <p className="catalog-list__warning">缺少 {missingUnit} → {item.baseUnit} 换算，预测不会猜测数量</p> : null}
          </article>
        })}</div> : <section className="catalog-list__empty"><h3>还没有{tabs.find((tab) => tab.kind === activeKind)?.label}</h3><p>建立第一条事实后，分类、价格、库存和批次会在同一条记录下持续累积。</p><button type="button" onClick={() => setEditorItem('new')}>创建第一项</button></section>}
        {selectedIds.length ? <div className="catalog-bulk-bar"><span>已选择 {selectedIds.length} 项</span><button type="button" onClick={() => setBulkOpen(true)}>批量修改 {selectedIds.length} 项</button><button type="button" onClick={() => setSelectedIds([])}>清除选择</button></div> : null}
      </section>
      {selectedItem ? <ItemInspector
        item={selectedItem}
        units={units}
        balance={balances.find((entry) => entry.itemId === selectedItem.id)}
        forecast={forecasts.find((entry) => entry.itemId === selectedItem.id)}
        transactions={transactions}
        onClose={() => { const next = new URLSearchParams(searchParams); next.delete('item'); setSearchParams(next) }}
        onEdit={() => setEditorItem(selectedItem)}
        onDelete={() => void previewDelete(selectedItem)}
        onCreateTransaction={async (input, key) => { await lifeInventoryApi.createTransaction(input, key, auth.csrfToken); await Promise.all([balancesQuery.refetch(), transactionsQuery.refetch(), forecastsQuery.refetch()]) }}
        onReverseTransaction={async (id, key) => { await lifeInventoryApi.reverseTransaction(id, {}, key, auth.csrfToken); await Promise.all([balancesQuery.refetch(), transactionsQuery.refetch(), forecastsQuery.refetch()]) }}
      /> : null}
    </div>

    {bulkOpen ? <section className="catalog-bulk-preview" role="region" aria-label="批量变更预览"><header><h2>批量变更预览</h2><button type="button" onClick={() => setBulkOpen(false)}>关闭</button></header><p>{selectedIds.length} 项：{items.filter((item) => selectedIds.includes(item.id)).map((item) => item.name).join('、')}</p><div className="catalog-bulk-preview__fields"><label>批量分类<select value={bulkCategoryId} onChange={(event) => setBulkCategoryId(event.target.value)}><option value="">保持不变</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><label>批量位置<select value={bulkLocationId} onChange={(event) => setBulkLocationId(event.target.value)}><option value="">保持不变</option>{locations.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><label>添加标签<select value={bulkTagId} onChange={(event) => setBulkTagId(event.target.value)}><option value="">不添加</option>{tags.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><label>批量状态<select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as typeof bulkStatus)}><option value="">保持不变</option><option value="active">启用</option><option value="disabled">停用</option></select></label></div><div className="catalog-bulk-preview__summary">{bulkCategoryId ? <p>分类将改为“{labels.get(bulkCategoryId) ?? bulkCategoryId}”</p> : null}{bulkLocationId ? <p>位置将改为“{locations.find((entry) => entry.id === bulkLocationId)?.name ?? bulkLocationId}”</p> : null}{bulkTagId ? <p>将添加标签“{tags.find((entry) => entry.id === bulkTagId)?.name ?? bulkTagId}”</p> : null}{bulkStatus ? <p>状态将改为“{bulkStatus === 'active' ? '启用' : '停用'}”</p> : null}{!bulkCategoryId && !bulkLocationId && !bulkTagId && !bulkStatus ? <p>选择至少一项明确变更后才能提交。</p> : null}</div><button type="button" disabled={!bulkCategoryId && !bulkLocationId && !bulkTagId && !bulkStatus} onClick={() => void applyBulk()}>确认批量修改</button></section> : null}

    {editorItem ? <ItemEditor item={editorItem === 'new' ? undefined : editorItem} initialKind={activeKind} categories={categories} tags={tags} locations={locations} units={units} onClose={() => setEditorItem(null)} onSave={saveItem} /> : null}
    {deleteState ? <div className="catalog-impact-layer"><button type="button" aria-label="取消移入回收站" onClick={() => setDeleteState(null)} /><section role="dialog" aria-modal="true" aria-label="确认移入回收站"><h2>确认移入回收站</h2><p>“{deleteState.item.name}”仍被以下关系引用。移入回收站不会改写这些历史或永久删除数据。</p><dl><div><dt>食谱</dt><dd>{deleteState.impact.recipeIds.length ? deleteState.impact.recipeIds.map((id) => `食谱 ${id}`).join('、') : '无'}</dd></div><div><dt>模板</dt><dd>{deleteState.impact.templateIds.length ? deleteState.impact.templateIds.map((id) => `模板 ${id}`).join('、') : '无'}</dd></div><div><dt>未来计划</dt><dd>{deleteState.impact.futurePlanIds.length ? deleteState.impact.futurePlanIds.map((id) => `未来计划 ${id}`).join('、') : '无'}</dd></div></dl><div><button type="button" onClick={() => setDeleteState(null)}>取消</button><button type="button" onClick={() => void remove()}>确认移入回收站</button></div></section></div> : null}
    {announcement ? <div className="catalog-announcement" role="status"><span>{announcement}</span>{batchUndo.length ? <button type="button" onClick={() => void undoBulk()}>撤销上次批量修改</button> : null}</div> : null}
  </article>
}

export function LifeCatalogRoute() { return <LifeCatalogPage variant="inventory" /> }
