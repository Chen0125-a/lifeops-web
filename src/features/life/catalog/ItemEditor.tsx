import { useEffect, useMemo, useRef, useState } from 'react'
import type { CatalogItem, CreateCatalogItemInput, HouseholdMaintenanceRecord, LifeItemKind, LifeUnit, TaxonomyEntity, UpdateCatalogItemInput } from '../../../domain/lifeCatalog'
import { UnitConversionEditor } from './UnitConversionEditor'

interface ItemEditorProps {
  item?: CatalogItem
  initialKind: LifeItemKind
  categories: TaxonomyEntity[]
  tags: TaxonomyEntity[]
  locations: TaxonomyEntity[]
  units: LifeUnit[]
  onClose(): void
  onSave(input: CreateCatalogItemInput | UpdateCatalogItemInput): Promise<void>
}

const kindLabels: Record<LifeItemKind, string> = {
  ingredient: '食材', supplement: '补充剂', medicine: '药品', household_consumable: '家庭消耗品', household_durable: '家庭耐用品',
}

function numberOrUndefined(value: string) {
  if (!value.trim()) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function csv(value: string) {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean)
}

export function ItemEditor({ item, initialKind, categories, tags, locations, units, onClose, onSave }: ItemEditorProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [kind, setKind] = useState<LifeItemKind>(item?.kind ?? initialKind)
  const [name, setName] = useState(item?.name ?? '')
  const [aliases, setAliases] = useState(item?.aliases.join(', ') ?? '')
  const [baseUnit, setBaseUnit] = useState(item?.baseUnit ?? units[0]?.code ?? 'each')
  const [availableUnits, setAvailableUnits] = useState(item?.availableUnits ?? [])
  const [conversions, setConversions] = useState(item?.itemConversions ?? [])
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? '')
  const [tagIds, setTagIds] = useState(item?.tagIds ?? [])
  const [locationId, setLocationId] = useState(item?.locationId ?? '')
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [status, setStatus] = useState(item?.status ?? 'active')
  const [isCookingOil, setIsCookingOil] = useState(item?.isCookingOil ?? false)
  const [customOrder, setCustomOrder] = useState(String(item?.customOrder ?? 0))
  const [attachments, setAttachments] = useState(item?.attachments ?? [])
  const [attachmentMediaId, setAttachmentMediaId] = useState('')
  const [attachmentCaption, setAttachmentCaption] = useState('')
  const [nutritionBasis, setNutritionBasis] = useState(String(item?.nutrition?.basisQuantity ?? 100))
  const [energy, setEnergy] = useState(String(item?.nutrition?.values.energyKcal ?? ''))
  const [protein, setProtein] = useState(String(item?.nutrition?.values.proteinGrams ?? ''))
  const [fat, setFat] = useState(String(item?.nutrition?.values.fatGrams ?? ''))
  const [carbs, setCarbs] = useState(String(item?.nutrition?.values.carbohydrateGrams ?? ''))
  const [customNutrition, setCustomNutrition] = useState<Array<[string, string]>>(() => Object.entries(item?.nutrition?.values.custom ?? {}).map(([key, value]) => [key, String(value)]))
  const [priceAmount, setPriceAmount] = useState('')
  const [priceQuantity, setPriceQuantity] = useState('1')
  const [priceUnit, setPriceUnit] = useState(item?.baseUnit ?? '')
  const [priceDate, setPriceDate] = useState('')
  const [servingQuantity, setServingQuantity] = useState(String(item?.profile?.kind === 'supplement' ? item.profile.servingQuantity ?? '' : ''))
  const [servingUnit, setServingUnit] = useState(item?.profile?.kind === 'supplement' ? item.profile.servingUnit ?? '' : '')
  const [supplementIngredients, setSupplementIngredients] = useState(item?.profile?.kind === 'supplement' ? item.profile.ingredients?.join(', ') ?? '' : '')
  const [defaultFrequency, setDefaultFrequency] = useState(item?.profile?.kind === 'supplement' ? item.profile.defaultFrequency ?? '' : '')
  const [userInstructions, setUserInstructions] = useState(item?.profile?.kind === 'supplement' ? item.profile.userInstructions ?? '' : '')
  const [reminderEnabled, setReminderEnabled] = useState(item?.profile?.kind === 'supplement' ? item.profile.reminder?.enabled ?? false : false)
  const [reminderTimes, setReminderTimes] = useState(item?.profile?.kind === 'supplement' ? item.profile.reminder?.localTimes.join(', ') ?? '' : '')
  const [reminderNote, setReminderNote] = useState(item?.profile?.kind === 'supplement' ? item.profile.reminder?.note ?? '' : '')
  const [purchaseQuantity, setPurchaseQuantity] = useState(String(item?.profile?.kind === 'household_consumable' ? item.profile.defaultPurchaseQuantity ?? '' : ''))
  const [purchaseUnit, setPurchaseUnit] = useState(item?.profile?.kind === 'household_consumable' ? item.profile.defaultPurchaseUnit ?? '' : '')
  const [cycleDays, setCycleDays] = useState(String(item?.profile?.kind === 'household_consumable' ? item.profile.consumptionCycleDays ?? '' : ''))
  const [depletionDate, setDepletionDate] = useState(item?.profile?.kind === 'household_consumable' ? item.profile.estimatedDepletionDate ?? '' : '')
  const [valueYuan, setValueYuan] = useState(String(item?.profile?.kind === 'household_durable' && item.profile.valueMinor !== undefined ? item.profile.valueMinor / 100 : ''))
  const [valueAsOfDate, setValueAsOfDate] = useState(item?.profile?.kind === 'household_durable' ? item.profile.valueAsOfDate ?? '' : '')
  const [lifecycleStatus, setLifecycleStatus] = useState(item?.profile?.kind === 'household_durable' ? item.profile.lifecycleStatus ?? 'active' : 'active')
  const [acquiredOn, setAcquiredOn] = useState(item?.profile?.kind === 'household_durable' ? item.profile.acquiredOn ?? '' : '')
  const [warrantyExpiresOn, setWarrantyExpiresOn] = useState(item?.profile?.kind === 'household_durable' ? item.profile.warrantyExpiresOn ?? '' : '')
  const [retiredOn, setRetiredOn] = useState(item?.profile?.kind === 'household_durable' ? item.profile.retiredOn ?? '' : '')
  const [retirementReason, setRetirementReason] = useState(item?.profile?.kind === 'household_durable' ? item.profile.retirementReason ?? '' : '')
  const [maintenanceRecords, setMaintenanceRecords] = useState<HouseholdMaintenanceRecord[]>(item?.profile?.kind === 'household_durable' ? item.profile.maintenanceRecords ?? [] : [])
  const [maintenanceDate, setMaintenanceDate] = useState('')
  const [maintenanceSummary, setMaintenanceSummary] = useState('')
  const [maintenanceCost, setMaintenanceCost] = useState('')
  const [setItemIds, setSetItemIds] = useState(item?.profile?.kind === 'household_durable' ? item.profile.setItemIds?.join(', ') ?? '' : '')
  const [medicine, setMedicine] = useState(() => item?.medicine ?? {})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pricePoints = useMemo(() => {
    if (!priceAmount || !priceUnit || !priceDate) return item?.pricePoints ?? []
    return [...(item?.pricePoints ?? []), {
      amountMinor: Math.round(Number(priceAmount) * 100), currency: 'CNY', purchaseQuantity: Number(priceQuantity), purchaseUnit: priceUnit, effectiveFrom: priceDate,
    }]
  }, [item?.pricePoints, priceAmount, priceDate, priceQuantity, priceUnit])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    const first = dialog?.querySelector<HTMLElement>('input, select, textarea, button')
    first?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab' || !dialog) return
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'))
      if (!controls.length) return
      const firstControl = controls[0]
      const lastControl = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === firstControl) { event.preventDefault(); lastControl.focus() }
      if (!event.shiftKey && document.activeElement === lastControl) { event.preventDefault(); firstControl.focus() }
    }
    dialog?.addEventListener('keydown', onKey)
    return () => { dialog?.removeEventListener('keydown', onKey); previous?.focus() }
  }, [onClose])

  const submit = async () => {
    if (!name.trim() || !baseUnit) {
      setError('名称和基础单位不能为空。')
      return
    }
    const custom = Object.fromEntries(customNutrition.filter(([key, value]) => key.trim() && numberOrUndefined(value) !== undefined).map(([key, value]) => [key.trim(), Number(value)]))
    const hasNutrition = [energy, protein, fat, carbs].some((value) => value.trim()) || Object.keys(custom).length > 0
    const common: CreateCatalogItemInput = {
      kind, name: name.trim(), aliases: csv(aliases), status, categoryId: categoryId || null, tagIds, locationId: locationId || null,
      baseUnit, availableUnits: Array.from(new Set([baseUnit, ...availableUnits])), itemConversions: conversions, pricePoints,
      isCookingOil: kind === 'ingredient' && isCookingOil,
      attachments,
      customOrder: Number(customOrder) || 0,
      notes: notes.trim(),
      ...(kind === 'ingredient' && hasNutrition ? { nutrition: {
        basisQuantity: Number(nutritionBasis) || 100,
        basisUnit: baseUnit,
        values: { energyKcal: Number(energy) || 0, proteinGrams: Number(protein) || 0, fatGrams: Number(fat) || 0, carbohydrateGrams: Number(carbs) || 0, ...(Object.keys(custom).length ? { custom } : {}) },
      } } : {}),
      ...(kind === 'supplement' ? { profile: {
        kind: 'supplement',
        ...(numberOrUndefined(servingQuantity) !== undefined && servingUnit ? { servingQuantity: Number(servingQuantity), servingUnit } : {}),
        ...(csv(supplementIngredients).length ? { ingredients: csv(supplementIngredients) } : {}),
        ...(defaultFrequency.trim() ? { defaultFrequency: defaultFrequency.trim() } : {}),
        ...(userInstructions.trim() ? { userInstructions: userInstructions.trim() } : {}),
        reminder: { enabled: reminderEnabled, localTimes: csv(reminderTimes), ...(reminderNote.trim() ? { note: reminderNote.trim() } : {}) },
      } } : {}),
      ...(kind === 'household_consumable' ? { profile: {
        kind: 'household_consumable',
        ...(numberOrUndefined(purchaseQuantity) !== undefined && purchaseUnit ? { defaultPurchaseQuantity: Number(purchaseQuantity), defaultPurchaseUnit: purchaseUnit } : {}),
        ...(numberOrUndefined(cycleDays) !== undefined ? { consumptionCycleDays: Number(cycleDays) } : {}),
        estimatedDepletionDate: depletionDate || null,
      } } : {}),
      ...(kind === 'household_durable' ? { profile: {
        kind: 'household_durable',
        ...(numberOrUndefined(valueYuan) !== undefined ? { valueMinor: Math.round(Number(valueYuan) * 100), currency: 'CNY' } : {}),
        valueAsOfDate: valueAsOfDate || null,
        lifecycleStatus,
        acquiredOn: acquiredOn || null,
        warrantyExpiresOn: warrantyExpiresOn || null,
        maintenanceRecords,
        retiredOn: retiredOn || null,
        retirementReason: retirementReason.trim() || null,
        setItemIds: csv(setItemIds),
      } } : {}),
      ...(kind === 'medicine' ? { medicine } : {}),
    }
    setBusy(true)
    setError('')
    try {
      await onSave(item ? { ...common, version: item.version } : common)
      onClose()
    } catch {
      setError(navigator.onLine === false ? '当前设备离线，修改尚未保存。' : '保存失败。内容可能已在另一处更新，请重新加载并核对版本。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="catalog-editor-layer" role="presentation">
      <button className="catalog-editor-layer__backdrop" type="button" aria-label="关闭物品编辑" onClick={onClose} />
      <div ref={dialogRef} className="catalog-editor" role="dialog" aria-modal="true" aria-label={item ? `编辑 ${item.name}` : '新建物品'}>
        <header><div><h2>{item ? `编辑 ${item.name}` : '新建物品'}</h2><p>只保存可验证的生活事实；未填字段保持未知。</p></div><button type="button" onClick={onClose}>关闭</button></header>
        <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <fieldset className="catalog-editor__section">
            <legend>基础事实</legend>
            <div className="catalog-editor__row">
              <label>类型<select value={kind} onChange={(event) => setKind(event.target.value as LifeItemKind)} disabled={Boolean(item)}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>名称 *<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
              <label>别名<input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="使用逗号分隔" /></label>
              <label>状态<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="active">启用</option><option value="disabled">停用</option></select></label>
              <label>分类<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">未分类</option>{categories.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
              <label>位置<select value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">未指定</option>{locations.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
              <label>基础单位 *<select value={baseUnit} onChange={(event) => { setBaseUnit(event.target.value); setAvailableUnits((current) => Array.from(new Set([...current, event.target.value]))) }}>{units.map((unit) => <option key={unit.code} value={unit.code}>{unit.name}（{unit.symbol}）</option>)}</select></label>
              <label>自定义顺序<input type="number" step="1" value={customOrder} onChange={(event) => setCustomOrder(event.target.value)} /></label>
            </div>
            <fieldset className="catalog-editor__tags"><legend>标签</legend>{tags.length ? tags.map((tag) => <label key={tag.id}><input type="checkbox" checked={tagIds.includes(tag.id)} onChange={(event) => setTagIds((current) => event.target.checked ? [...current, tag.id] : current.filter((id) => id !== tag.id))} />{tag.name}</label>) : <p>还没有标签，可在左侧分类工具中新建。</p>}</fieldset>
            {kind === 'ingredient' ? <label className="catalog-editor__check"><input type="checkbox" checked={isCookingOil} onChange={(event) => setIsCookingOil(event.target.checked)} />标记为烹调用油</label> : null}
          </fieldset>

          {kind === 'ingredient' ? <fieldset className="catalog-editor__section">
            <legend>营养事实</legend><p>按明确基准记录；自定义字段不会被替换成标准营养结论。</p>
            <div className="catalog-editor__row"><label>基准数量<input type="number" value={nutritionBasis} onChange={(event) => setNutritionBasis(event.target.value)} /></label><label>能量 kcal<input type="number" value={energy} onChange={(event) => setEnergy(event.target.value)} /></label><label>蛋白质 g<input type="number" value={protein} onChange={(event) => setProtein(event.target.value)} /></label><label>脂肪 g<input type="number" value={fat} onChange={(event) => setFat(event.target.value)} /></label><label>碳水 g<input type="number" value={carbs} onChange={(event) => setCarbs(event.target.value)} /></label></div>
            {customNutrition.map(([key, value], index) => <div className="catalog-editor__row" key={`${key}-${index}`}><label>自定义字段<input value={key} onChange={(event) => setCustomNutrition((current) => current.map((entry, position) => position === index ? [event.target.value, entry[1]] : entry))} /></label><label>数值<input type="number" value={value} onChange={(event) => setCustomNutrition((current) => current.map((entry, position) => position === index ? [entry[0], event.target.value] : entry))} /></label><button type="button" onClick={() => setCustomNutrition((current) => current.filter((_, position) => position !== index))}>移除字段</button></div>)}
            <button type="button" onClick={() => setCustomNutrition((current) => [...current, ['', '']])}>添加自定义营养字段</button>
          </fieldset> : null}

          {kind === 'supplement' ? <fieldset className="catalog-editor__section"><legend>补充剂事实</legend><p>以下内容全部由用户录入，不构成剂量或医疗建议。</p><div className="catalog-editor__row"><label>每次用量<input type="number" value={servingQuantity} onChange={(event) => setServingQuantity(event.target.value)} /></label><label>用量单位<select value={servingUnit} onChange={(event) => setServingUnit(event.target.value)}><option value="">未记录</option>{units.map((unit) => <option key={unit.code} value={unit.code}>{unit.name}</option>)}</select></label><label>成分<input value={supplementIngredients} onChange={(event) => setSupplementIngredients(event.target.value)} /></label><label>用户记录频率<input value={defaultFrequency} onChange={(event) => setDefaultFrequency(event.target.value)} /></label><label>用户说明<textarea value={userInstructions} onChange={(event) => setUserInstructions(event.target.value)} /></label><label><input type="checkbox" checked={reminderEnabled} onChange={(event) => setReminderEnabled(event.target.checked)} />启用用户提醒</label><label>提醒时间<input value={reminderTimes} onChange={(event) => setReminderTimes(event.target.value)} placeholder="08:00, 20:00" /></label><label>用户提醒说明<input value={reminderNote} onChange={(event) => setReminderNote(event.target.value)} /></label></div></fieldset> : null}

          {kind === 'medicine' ? <fieldset className="catalog-editor__section"><legend>药品包装与用户事实</legend><p>不提供推荐剂量、停药建议、诊断或相互作用判断。</p><div className="catalog-editor__row">{[
            ['tradeName', '商品名'], ['genericName', '通用名'], ['specification', '规格'], ['dosageForm', '剂型'], ['packageDescription', '包装'], ['userInstructions', '用户说明'], ['userScheduleText', '用户时间计划'],
          ].map(([key, label]) => <label key={key}>{label}<input value={medicine[key as keyof typeof medicine] === true ? '' : String(medicine[key as keyof typeof medicine] ?? '')} onChange={(event) => setMedicine((current) => ({ ...current, [key]: event.target.value }))} /></label>)}<label><input type="checkbox" checked={medicine.asNeeded ?? false} onChange={(event) => setMedicine((current) => ({ ...current, asNeeded: event.target.checked }))} />按需状态（用户记录）</label></div></fieldset> : null}

          {kind === 'household_consumable' ? <fieldset className="catalog-editor__section"><legend>消耗品事实</legend><div className="catalog-editor__row"><label>默认采购数量<input type="number" value={purchaseQuantity} onChange={(event) => setPurchaseQuantity(event.target.value)} /></label><label>默认采购单位<input value={purchaseUnit} onChange={(event) => setPurchaseUnit(event.target.value)} /></label><label>消耗周期（天）<input type="number" min="1" step="1" value={cycleDays} onChange={(event) => setCycleDays(event.target.value)} /></label><label>预计用尽日<input type="date" value={depletionDate} onChange={(event) => setDepletionDate(event.target.value)} /></label></div></fieldset> : null}

          {kind === 'household_durable' ? <fieldset className="catalog-editor__section"><legend>耐用品事实</legend><p>价值、维修和退役均为用户记录；系统不生成折耗或处置建议。</p><div className="catalog-editor__row"><label>用户记录价值（元）<input type="number" min="0" step="0.01" value={valueYuan} onChange={(event) => setValueYuan(event.target.value)} /></label><label>价值记录日期<input type="date" value={valueAsOfDate} onChange={(event) => setValueAsOfDate(event.target.value)} /></label><label>生命周期<select value={lifecycleStatus} onChange={(event) => setLifecycleStatus(event.target.value as typeof lifecycleStatus)}><option value="active">使用中</option><option value="maintenance">维护中</option><option value="retired">已退役</option></select></label><label>购入日期<input type="date" value={acquiredOn} onChange={(event) => setAcquiredOn(event.target.value)} /></label><label>保修到期<input type="date" value={warrantyExpiresOn} onChange={(event) => setWarrantyExpiresOn(event.target.value)} /></label><label>组成物品 ID<input value={setItemIds} onChange={(event) => setSetItemIds(event.target.value)} /></label>{lifecycleStatus === 'retired' ? <><label>退役日期<input type="date" value={retiredOn} onChange={(event) => setRetiredOn(event.target.value)} /></label><label>退役原因<input value={retirementReason} onChange={(event) => setRetirementReason(event.target.value)} /></label></> : null}</div><section className="catalog-editor__maintenance" aria-label="维护记录"><h3>维护记录</h3>{maintenanceRecords.length ? <ol>{maintenanceRecords.map((record) => <li key={record.id}><div><strong>{record.performedOn} · {record.summary}</strong><span>{record.costMinor !== undefined ? `¥${(record.costMinor / 100).toFixed(2)}` : '未记录成本'}</span></div><button type="button" onClick={() => setMaintenanceRecords((current) => current.filter((candidate) => candidate.id !== record.id))}>移除维护记录 {record.summary}</button></li>)}</ol> : <p>还没有维护记录。</p>}<div className="catalog-editor__row"><label>维护日期<input type="date" value={maintenanceDate} onChange={(event) => setMaintenanceDate(event.target.value)} /></label><label>维护摘要<input value={maintenanceSummary} onChange={(event) => setMaintenanceSummary(event.target.value)} /></label><label>维护成本（元）<input type="number" min="0" step="0.01" value={maintenanceCost} onChange={(event) => setMaintenanceCost(event.target.value)} /></label><button type="button" disabled={!maintenanceDate || !maintenanceSummary.trim()} onClick={() => { if (!maintenanceDate || !maintenanceSummary.trim()) return; setMaintenanceRecords((current) => [...current, { id: crypto.randomUUID(), performedOn: maintenanceDate, summary: maintenanceSummary.trim(), ...(maintenanceCost.trim() ? { costMinor: Math.round(Number(maintenanceCost) * 100), currency: 'CNY' } : {}) }]); setMaintenanceDate(''); setMaintenanceSummary(''); setMaintenanceCost('') }}>添加维护记录</button></div></section></fieldset> : null}

          <UnitConversionEditor itemId={item?.id ?? 'pending'} baseUnit={baseUnit} availableUnits={availableUnits} conversions={conversions} units={units} onChange={(nextConversions, nextUnits) => { setConversions(nextConversions); setAvailableUnits(nextUnits) }} />

          <fieldset className="catalog-editor__section"><legend>价格历史</legend><p>新增价格会带生效日写入历史，不覆盖旧价格。</p><div className="catalog-editor__row"><label>价格（元）<input type="number" min="0" step="0.01" value={priceAmount} onChange={(event) => setPriceAmount(event.target.value)} /></label><label>采购数量<input type="number" min="0" step="any" value={priceQuantity} onChange={(event) => setPriceQuantity(event.target.value)} /></label><label>采购单位<select value={priceUnit} onChange={(event) => setPriceUnit(event.target.value)}>{Array.from(new Set([baseUnit, ...availableUnits])).map((code) => <option key={code} value={code}>{code}</option>)}</select></label><label>生效日<input type="date" value={priceDate} onChange={(event) => setPriceDate(event.target.value)} /></label></div></fieldset>
          <fieldset className="catalog-editor__section"><legend>附件事实</legend><p>这里只保存已授权媒体的稳定 ID 与说明，不上传或公开文件。</p>{attachments.length ? <ul className="catalog-editor__facts">{attachments.map((attachment) => <li key={attachment.mediaId}><strong>{attachment.caption || '无说明附件'}</strong><span>{attachment.mediaId}</span><button type="button" onClick={() => setAttachments((current) => current.filter((candidate) => candidate.mediaId !== attachment.mediaId))}>移除附件 {attachment.caption || attachment.mediaId}</button></li>)}</ul> : <p>还没有附件。</p>}<div className="catalog-editor__row"><label>附件媒体 ID<input value={attachmentMediaId} onChange={(event) => setAttachmentMediaId(event.target.value)} /></label><label>附件说明<input value={attachmentCaption} onChange={(event) => setAttachmentCaption(event.target.value)} /></label><button type="button" disabled={!attachmentMediaId.trim()} onClick={() => { const mediaId = attachmentMediaId.trim(); if (!mediaId) return; setAttachments((current) => [...current.filter((entry) => entry.mediaId !== mediaId), { mediaId, caption: attachmentCaption.trim() }]); setAttachmentMediaId(''); setAttachmentCaption('') }}>添加附件</button></div></fieldset>
          <label className="catalog-editor__notes">事实备注<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          {error ? <p role="alert">{error}</p> : null}
          <footer><button type="button" onClick={onClose}>取消</button><button type="submit" disabled={busy}>{busy ? '正在保存…' : '保存物品'}</button></footer>
        </form>
      </div>
    </div>
  )
}
