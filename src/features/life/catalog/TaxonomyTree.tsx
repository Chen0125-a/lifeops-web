import { useMemo, useState } from 'react'
import type {
  CreateTaxonomyInput,
  CreateUnitInput,
  LifeUnit,
  TaxonomyEntity,
  TaxonomyKind,
  UnitDimension,
  UpdateTaxonomyInput,
  UpdateUnitInput,
} from '../../../domain/lifeCatalog'

interface TaxonomyTreeProps {
  categories: TaxonomyEntity[]
  tags: TaxonomyEntity[]
  locations: TaxonomyEntity[]
  units: LifeUnit[]
  onCreate(kind: TaxonomyKind, input: CreateTaxonomyInput): Promise<unknown>
  onUpdate(kind: TaxonomyKind, id: string, input: UpdateTaxonomyInput): Promise<unknown>
  onRemove(kind: TaxonomyKind, id: string, version: number): Promise<unknown>
  onCreateUnit(input: CreateUnitInput): Promise<unknown>
  onUpdateUnit(id: string, input: UpdateUnitInput): Promise<unknown>
  onRemoveUnit(id: string, version: number): Promise<unknown>
}

interface EditState { kind: TaxonomyKind; id?: string; name: string; parentId: string }
interface UnitDraft {
  id?: string
  code: string
  name: string
  symbol: string
  dimension: UnitDimension
  baseCode: string
  toBaseFactor: string
  version?: number
}

const emptyUnit: UnitDraft = { code: '', name: '', symbol: '', dimension: 'package', baseCode: '', toBaseFactor: '' }
const kindLabel: Record<TaxonomyKind, string> = { category: '分类', tag: '标签', location: '位置' }

function hasDescendant(items: TaxonomyEntity[], ancestorId: string, candidateId: string) {
  let cursor: string | null = candidateId
  const visited = new Set<string>()
  while (cursor) {
    if (cursor === ancestorId) return true
    if (visited.has(cursor)) return true
    visited.add(cursor)
    cursor = items.find((item) => item.id === cursor)?.parentId ?? null
  }
  return false
}

function ordered(items: TaxonomyEntity[]) {
  return [...items].sort((left, right) => left.position - right.position || left.name.localeCompare(right.name, 'zh-CN'))
}

export function TaxonomyTree({
  categories,
  tags,
  locations,
  units,
  onCreate,
  onUpdate,
  onRemove,
  onCreateUnit,
  onUpdateUnit,
  onRemoveUnit,
}: TaxonomyTreeProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TaxonomyEntity | null>(null)
  const [error, setError] = useState('')
  const [dragged, setDragged] = useState<{ kind: TaxonomyKind; id: string } | null>(null)
  const [unitsOpen, setUnitsOpen] = useState(false)
  const [unitDraft, setUnitDraft] = useState<UnitDraft | null>(null)
  const groups = useMemo(() => ([
    { kind: 'category' as const, label: '分类', items: ordered(categories) },
    { kind: 'tag' as const, label: '标签', items: ordered(tags) },
    { kind: 'location' as const, label: '位置', items: ordered(locations) },
  ]), [categories, locations, tags])

  const itemsFor = (kind: TaxonomyKind) => kind === 'category' ? categories : kind === 'tag' ? tags : locations

  const run = async (operation: () => Promise<unknown>) => {
    setError('')
    try {
      await operation()
      return true
    } catch {
      setError(navigator.onLine === false ? '当前设备离线，修改尚未保存。' : '修改失败。请重新加载并核对是否存在版本冲突。')
      return false
    }
  }

  const move = async (kind: TaxonomyKind, id: string, direction: -1 | 1) => {
    const items = ordered(itemsFor(kind))
    const index = items.findIndex((item) => item.id === id)
    const target = items[index + direction]
    const current = items[index]
    if (!current || !target) return
    await run(() => onUpdate(kind, current.id, { position: target.position, version: current.version }))
  }

  const save = async () => {
    if (!edit || !edit.name.trim()) return
    const items = itemsFor(edit.kind)
    if (edit.id && edit.parentId && hasDescendant(items, edit.id, edit.parentId)) {
      setError('父级关系会形成循环，请选择当前节点之外的安全父级。')
      return
    }
    const current = edit.id ? items.find((item) => item.id === edit.id) : undefined
    const input = { name: edit.name.trim(), ...(edit.kind !== 'tag' ? { parentId: edit.parentId || null } : {}) }
    const saved = current
      ? await run(() => onUpdate(edit.kind, current.id, { ...input, version: current.version }))
      : await run(() => onCreate(edit.kind, input))
    if (saved) setEdit(null)
  }

  const remove = async () => {
    if (!pendingDelete) return
    const removed = await run(() => onRemove(pendingDelete.kind, pendingDelete.id, pendingDelete.version))
    if (removed) setPendingDelete(null)
  }

  const drop = async (kind: TaxonomyKind, parentId: string) => {
    if (!dragged || dragged.kind !== kind || dragged.id === parentId || kind === 'tag') return
    const items = itemsFor(kind)
    if (hasDescendant(items, dragged.id, parentId)) {
      setError('父级关系会形成循环，拖放未保存。')
      setDragged(null)
      return
    }
    const current = items.find((item) => item.id === dragged.id)
    if (current) await run(() => onUpdate(kind, current.id, { parentId, version: current.version }))
    setDragged(null)
  }

  const saveUnit = async () => {
    if (!unitDraft || !unitDraft.code.trim() || !unitDraft.name.trim() || !unitDraft.symbol.trim() || !unitDraft.baseCode.trim()) {
      setError('单位代码、名称、符号和基础单位代码不能为空。')
      return
    }
    const input: CreateUnitInput = {
      code: unitDraft.code.trim(),
      name: unitDraft.name.trim(),
      symbol: unitDraft.symbol.trim(),
      dimension: unitDraft.dimension,
      baseCode: unitDraft.baseCode.trim(),
      toBaseFactor: unitDraft.toBaseFactor.trim() ? Number(unitDraft.toBaseFactor) : null,
    }
    const unitId = unitDraft.id
    const unitVersion = unitDraft.version
    const saved = unitId && unitVersion !== undefined
      ? await run(() => onUpdateUnit(unitId, { ...input, version: unitVersion }))
      : await run(() => onCreateUnit(input))
    if (saved) setUnitDraft(null)
  }

  return (
    <aside className="catalog-taxonomy" aria-label="分类、标签与位置工具">
      <header>
        <div><h2>分类工具</h2><p>稳定 ID 连接全部物品；拖放和键盘按钮等价。</p></div>
        <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}>{collapsed ? '展开' : '收起'}</button>
      </header>
      {!collapsed ? <div className="catalog-taxonomy__groups">
        {groups.map((group) => <section key={group.kind}>
          <header><h3>{group.label}</h3><button type="button" aria-label={`新建${group.label}`} onClick={() => { setError(''); setEdit({ kind: group.kind, name: '', parentId: '' }) }}>新增</button></header>
          {group.items.length ? <ul>{group.items.map((entry) => <li
            key={entry.id}
            aria-label={entry.name}
            data-depth={entry.parentId ? 2 : 1}
            draggable
            onDragStart={() => setDragged({ kind: group.kind, id: entry.id })}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => void drop(group.kind, entry.id)}
          >
            <span>{entry.name}</span>
            <small>{entry.parentId ? `父级 ${group.items.find((candidate) => candidate.id === entry.parentId)?.name ?? entry.parentId}` : group.kind === 'tag' ? '交叉筛选标签' : '根节点'}</small>
            <div>
              <button type="button" aria-label={`上移 ${entry.name}`} onClick={() => void move(group.kind, entry.id, -1)}>↑</button>
              <button type="button" aria-label={`下移 ${entry.name}`} onClick={() => void move(group.kind, entry.id, 1)}>↓</button>
              <button type="button" aria-label={`编辑 ${entry.name}`} onClick={() => { setError(''); setEdit({ kind: group.kind, id: entry.id, name: entry.name, parentId: entry.parentId ?? '' }) }}>编辑</button>
              <button type="button" aria-label={`删除 ${entry.name}`} onClick={() => setPendingDelete(entry)}>删除</button>
            </div>
          </li>)}</ul> : <p>还没有{group.label}。</p>}
        </section>)}
        <button className="catalog-taxonomy__units" type="button" onClick={() => setUnitsOpen(true)}>管理单位</button>
      </div> : null}
      {edit ? <form className="catalog-taxonomy__editor" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <h3>{edit.id ? '编辑' : '新建'}{kindLabel[edit.kind]}</h3>
        <label>{kindLabel[edit.kind]}名称<input aria-label={`${kindLabel[edit.kind]}名称`} value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} /></label>
        {edit.kind !== 'tag' ? <label>{edit.kind === 'category' ? '父级分类' : '父级位置'}
          <select aria-label={edit.kind === 'category' ? '父级分类' : '父级位置'} value={edit.parentId} onChange={(event) => setEdit({ ...edit, parentId: event.target.value })}>
            <option value="">根节点</option>
            {itemsFor(edit.kind).filter((entry) => entry.id !== edit.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label> : null}
        {error ? <p role="alert">{error}</p> : null}
        <div><button type="button" onClick={() => setEdit(null)}>取消</button><button type="submit">{edit.id ? '保存' : '创建'}{kindLabel[edit.kind]}</button></div>
      </form> : error ? <p className="catalog-taxonomy__error" role="alert">{error}</p> : null}

      {pendingDelete ? <div className="catalog-tool-dialog-layer"><button type="button" aria-label="取消停用分类工具对象" onClick={() => setPendingDelete(null)} /><section role="dialog" aria-modal="true" aria-label={`停用${kindLabel[pendingDelete.kind]} ${pendingDelete.name}`}><h2>停用{kindLabel[pendingDelete.kind]}</h2><p>稳定 ID 与历史关系会保留；当前对象停止用于新归类，之后可通过关系安全的恢复操作重新启用。</p><div><button type="button" onClick={() => setPendingDelete(null)}>取消</button><button type="button" onClick={() => void remove()}>确认停用{kindLabel[pendingDelete.kind]} {pendingDelete.name}</button></div></section></div> : null}

      {unitsOpen ? <div className="catalog-tool-dialog-layer"><button type="button" aria-label="关闭单位管理" onClick={() => { setUnitsOpen(false); setUnitDraft(null) }} /><section role="dialog" aria-modal="true" aria-label="单位管理"><header><div><h2>单位管理</h2><p>内置单位只读；自定义单位可编辑或软删除。</p></div><button type="button" onClick={() => { setUnitsOpen(false); setUnitDraft(null) }}>关闭</button></header><ol>{units.map((unit) => <li key={unit.id}><div><strong>{unit.name}</strong><span>{unit.code} · {unit.symbol} · {unit.dimension}{unit.toBaseFactor ? ` · × ${unit.toBaseFactor} ${unit.baseCode}` : ''}</span></div>{unit.builtIn ? <small>内置</small> : <div><button type="button" aria-label={`编辑 ${unit.name}`} onClick={() => setUnitDraft({ id: unit.id, code: unit.code, name: unit.name, symbol: unit.symbol, dimension: unit.dimension, baseCode: unit.baseCode, toBaseFactor: unit.toBaseFactor === null ? '' : String(unit.toBaseFactor), version: unit.version })}>编辑</button><button type="button" aria-label={`删除 ${unit.name}`} onClick={() => void run(() => onRemoveUnit(unit.id, unit.version))}>删除</button></div>}</li>)}</ol><button type="button" onClick={() => setUnitDraft(emptyUnit)}>新建自定义单位</button>{unitDraft ? <form onSubmit={(event) => { event.preventDefault(); void saveUnit() }}><h3>{unitDraft.id ? '编辑自定义单位' : '新建自定义单位'}</h3><div className="catalog-editor__row"><label>单位代码<input value={unitDraft.code} onChange={(event) => setUnitDraft({ ...unitDraft, code: event.target.value })} /></label><label>单位名称<input value={unitDraft.name} onChange={(event) => setUnitDraft({ ...unitDraft, name: event.target.value })} /></label><label>单位符号<input value={unitDraft.symbol} onChange={(event) => setUnitDraft({ ...unitDraft, symbol: event.target.value })} /></label><label>单位量纲<select value={unitDraft.dimension} onChange={(event) => setUnitDraft({ ...unitDraft, dimension: event.target.value as UnitDimension })}><option value="mass">重量</option><option value="volume">容量</option><option value="count">数量</option><option value="package">包装</option><option value="time">时间</option></select></label><label>基础单位代码<input value={unitDraft.baseCode} onChange={(event) => setUnitDraft({ ...unitDraft, baseCode: event.target.value })} /></label><label>固定换算系数<input type="number" min="0" step="any" value={unitDraft.toBaseFactor} onChange={(event) => setUnitDraft({ ...unitDraft, toBaseFactor: event.target.value })} /></label></div>{error ? <p role="alert">{error}</p> : null}<div><button type="button" onClick={() => setUnitDraft(null)}>取消</button><button type="submit">{unitDraft.id ? '保存单位' : '创建单位'}</button></div></form> : null}</section></div> : null}
    </aside>
  )
}
