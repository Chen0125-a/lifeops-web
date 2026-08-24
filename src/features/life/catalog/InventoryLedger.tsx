import { useState } from 'react'
import type { CatalogItem, LifeUnit } from '../../../domain/lifeCatalog'
import type { CreateInventoryTransactionInput, InventoryBalance, InventoryForecast, InventoryTransaction } from '../../../domain/lifeInventory'

interface InventoryLedgerProps {
  item: CatalogItem
  units: LifeUnit[]
  balance?: InventoryBalance
  forecast?: InventoryForecast
  transactions: InventoryTransaction[]
  onCreate(input: CreateInventoryTransactionInput, idempotencyKey: string): Promise<unknown>
  onReverse(id: string, idempotencyKey: string): Promise<unknown>
}

const kindLabels = {
  purchase: '采购',
  consume: '消耗',
  return: '退回',
  waste: '损耗',
  adjustment: '盘点调整',
  reversal: '冲销',
} as const

function localDateTime() {
  const date = new Date()
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function unitLabel(code: string, units: LifeUnit[]) {
  const unit = units.find((candidate) => candidate.code === code)
  return unit?.symbol || unit?.name || code
}

export function InventoryLedger({ item, units, balance, forecast, transactions, onCreate, onReverse }: InventoryLedgerProps) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Exclude<InventoryTransaction['kind'], 'reversal'>>('purchase')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState(item.baseUnit)
  const [occurredAt, setOccurredAt] = useState(localDateTime)
  const [trackBatch, setTrackBatch] = useState(false)
  const [expiresOn, setExpiresOn] = useState('')
  const [purchasedOn, setPurchasedOn] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const itemTransactions = transactions.filter((transaction) => transaction.itemId === item.id)

  const submit = async () => {
    const numericQuantity = Number(quantity)
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      setMessage('数量必须大于 0。')
      return
    }
    const input: CreateInventoryTransactionInput = {
      itemId: item.id,
      kind,
      quantity: numericQuantity,
      unit,
      occurredAt: new Date(occurredAt).toISOString(),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(kind === 'purchase' && trackBatch ? { batch: {
        purchasedOn: purchasedOn || null,
        expiresOn: expiresOn || null,
        locationId: item.locationId,
        actualUnitCostMinor: null,
      } } : {}),
    }
    setBusy(true)
    setMessage('')
    try {
      await onCreate(input, `inventory:${crypto.randomUUID()}`)
      setMessage('库存变化已写入不可变流水。')
      setOpen(false)
      setQuantity('')
    } catch {
      setMessage(navigator.onLine === false ? '当前设备离线，流水尚未写入。请联网后重试。' : '流水写入失败。若数据已在别处更新，请重新加载后再试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="inventory-ledger" role="region" aria-label={`${item.name}库存流水`}>
      <header>
        <div><h3>库存与批次流水</h3><p>余额由不可变事件计算，消耗批次由服务端按较早到期优先选择。</p></div>
        <button type="button" onClick={() => setOpen((value) => !value)}>记录库存变化</button>
      </header>
      <div className="inventory-ledger__summary">
        <strong>当前结余 {balance ? `${balance.onHand} ${unitLabel(balance.baseUnit, units)}` : '尚无流水'}</strong>
        {forecast?.status === 'complete' ? <span>计划需求 {forecast.plannedDemand} {unitLabel(forecast.baseUnit, units)} · 预计结余 {forecast.projectedBalance} {unitLabel(forecast.baseUnit, units)}</span> : null}
        {forecast?.status === 'incomplete' ? <span className="catalog-warning">预测不完整：缺少单位换算</span> : null}
        {balance?.warnings.includes('negative_inventory') ? <span className="catalog-warning">余额为负，需要盘点调整；系统不会静默改写历史。</span> : null}
      </div>
      {open ? <form className="inventory-ledger__form" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <label>流水类型
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            {Object.entries(kindLabels).filter(([value]) => value !== 'reversal').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>数量<input type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
        <label>单位
          <select value={unit} onChange={(event) => setUnit(event.target.value)}>{Array.from(new Set([item.baseUnit, ...item.availableUnits])).map((code) => <option key={code} value={code}>{unitLabel(code, units)}</option>)}</select>
        </label>
        <label>发生时间<input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
        {kind === 'purchase' ? <>
          <label className="inventory-ledger__check"><input type="checkbox" checked={trackBatch} onChange={(event) => setTrackBatch(event.target.checked)} />记录采购批次</label>
          {trackBatch ? <div className="inventory-ledger__batch-fields">
            <label>采购日期<input type="date" value={purchasedOn} onChange={(event) => setPurchasedOn(event.target.value)} /></label>
            <label>批次到期日<input type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} /></label>
          </div> : null}
        </> : null}
        <label className="inventory-ledger__note">备注<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <div><button type="button" onClick={() => setOpen(false)}>取消</button><button type="submit" disabled={busy}>{busy ? '正在写入…' : '写入不可变流水'}</button></div>
      </form> : null}
      {message ? <p role="status">{message}</p> : null}
      {itemTransactions.length ? <ol className="inventory-ledger__events">{itemTransactions.map((transaction) => <li key={transaction.id}>
        <div><strong>{kindLabels[transaction.kind]}</strong><time>{new Date(transaction.occurredAt).toLocaleString('zh-CN')}</time></div>
        <span>{transaction.deltaBaseQuantity > 0 ? '+' : ''}{transaction.deltaBaseQuantity} {unitLabel(item.baseUnit, units)}</span>
        {transaction.batchId ? <small>批次 {transaction.batchId}</small> : null}
        {transaction.allocations.map((allocation) => <small key={`${transaction.id}-${allocation.batchId}`}>优先消耗 {allocation.batchId} · {allocation.quantity} {unitLabel(item.baseUnit, units)} · {allocation.expiresOn ?? '无到期日'}{allocation.expiresOn ? ' 到期' : ''}</small>)}
        {!transaction.reversedByTransactionId && transaction.kind !== 'reversal' ? <button type="button" onClick={() => void onReverse(transaction.id, `inventory-reverse:${crypto.randomUUID()}`)}>冲销这条流水</button> : <span>已冲销</span>}
      </li>)}</ol> : <p className="catalog-empty-line">还没有库存流水。第一笔采购或盘点调整会保留在这里。</p>}
    </section>
  )
}
