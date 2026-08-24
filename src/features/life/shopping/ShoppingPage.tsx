import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { lifeCommerceApi } from '../../../api/lifeCommerceApi'
import { HttpError } from '../../../api/httpClient'
import { queryKeys } from '../../../api/queryKeys'
import type { PurchaseResult, RefundResult, ShoppingItem } from '../../../domain/lifeCommerce'
import { useAuth } from '../../../state/AuthContext'
import { PurchaseConfirm } from './PurchaseConfirm'

function mutationKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function money(minor: number) {
  return `¥${(minor / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function priorityLabel(priority: ShoppingItem['priority']) {
  if (priority === 'high') return '高优先级'
  if (priority === 'low') return '低优先级'
  return '常规'
}

function shoppingErrorMessage(error: unknown, action: 'load' | 'purchase' | 'refund') {
  if (error instanceof HttpError) {
    if (error.status === 0 || error.code === 'NETWORK_ERROR') return '当前设备离线。正式清单、库存与现金事实保持不变。'
    if (error.status === 403) return action === 'load' ? '当前账户没有权限读取采购事实。' : '当前账户没有权限执行这项采购操作。'
    if (error.status === 409) return '采购事实已在另一处更新。请重新载入后再提交。'
  }
  if (action === 'load') return '请重新载入服务端事实。'
  return action === 'purchase' ? '采购没有写入，请重新载入事实后重试。' : '退款没有写入；原采购和库存事实保持不变。'
}

function RefundConfirm({ result, pending, onClose, onConfirm }: {
  result: PurchaseResult
  pending: boolean
  onClose(): void
  onConfirm(quantity: number, amountMinor: number, note: string): Promise<void>
}) {
  const firstItem = result.items[0]
  const [quantity, setQuantity] = useState(String(firstItem?.quantity ?? ''))
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [])

  return <div className="life-commerce-layer" onKeyDown={(event) => { if (event.key === 'Escape' && !pending) onClose() }}>
    <button type="button" aria-label="取消退款" onClick={onClose} disabled={pending} />
    <section role="dialog" aria-modal="true" aria-label={`办理${firstItem?.itemId ?? ''}退款`}>
      <header><div><span>Compensating transaction</span><h2>办理{firstItem?.itemId}退款</h2></div><button ref={closeRef} type="button" onClick={onClose} disabled={pending}>关闭</button></header>
      <div className="purchase-confirm__body">
        <p>退款会写入抵消库存事件与负向现金支出；原采购事实不会被覆盖。</p>
        <label>退回数量<input type="number" min="0.0001" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
        <label>退款金额（元）<input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label>退款说明<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
      </div>
      <footer><button type="button" onClick={onClose} disabled={pending}>取消</button><button type="button" disabled={pending || !(Number(quantity) > 0) || !(Number(amount) >= 0)} onClick={() => void onConfirm(Number(quantity), Math.round(Number(amount) * 100), note)}>{pending ? '正在退款…' : '确认退款'}</button></footer>
    </section>
  </div>
}

export function ShoppingPage() {
  const auth = useAuth()
  const [searchParams] = useSearchParams()
  const itemFilter = searchParams.get('item')
  const sourceFilter = searchParams.get('source')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const shoppingQuery = useQuery({
    queryKey: queryKeys.lifeCommerce.list({ view: 'shopping' }),
    queryFn: ({ signal }) => lifeCommerceApi.listShopping(signal),
  })
  const [purchaseItem, setPurchaseItem] = useState<ShoppingItem | null>(null)
  const [purchaseResult, setPurchaseResult] = useState<PurchaseResult | null>(null)
  const [refundResult, setRefundResult] = useState<RefundResult | null>(null)
  const [refundOpen, setRefundOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [writeError, setWriteError] = useState('')
  const [formalOverride, setFormalOverride] = useState<ShoppingItem[] | null>(null)

  useEffect(() => {
    if (shoppingQuery.data) requestAnimationFrame(() => headingRef.current?.focus())
  }, [shoppingQuery.data])

  const formalItems = formalOverride ?? shoppingQuery.data?.formalItems ?? []
  const suggestions = shoppingQuery.data?.suggestions ?? []
  const groups = useMemo(() => {
    const result = new Map<string, ShoppingItem[]>()
    for (const item of formalItems) {
      const key = `${item.storeGroup} · ${priorityLabel(item.priority)}`
      result.set(key, [...(result.get(key) ?? []), item])
    }
    return [...result.entries()]
  }, [formalItems])
  const urgent = formalItems.filter((item) => item.priority === 'high' || Boolean(item.neededOn))

  const confirmPurchase = async (input: Parameters<typeof lifeCommerceApi.createPurchase>[0]['items'][number] & { storeName: string }) => {
    setBusy(true)
    setWriteError('')
    try {
      const { storeName, ...item } = input
      const result = await lifeCommerceApi.createPurchase({ purchasedAt: new Date().toISOString(), currency: 'CNY', storeName, items: [item] }, mutationKey('purchase'), auth.csrfToken)
      setPurchaseResult(result)
      setRefundResult(null)
      setFormalOverride((current) => {
        const base = current ?? shoppingQuery.data?.formalItems ?? []
        return base.map((entry) => result.shoppingItems.find((updated) => updated.id === entry.id) ?? entry)
      })
      setPurchaseItem(null)
    } catch (error) {
      setWriteError(shoppingErrorMessage(error, 'purchase'))
    } finally {
      setBusy(false)
    }
  }

  const confirmRefund = async (quantity: number, amountMinor: number, note: string) => {
    if (!purchaseResult?.items[0]) return
    setBusy(true)
    setWriteError('')
    try {
      const result = await lifeCommerceApi.createRefund(purchaseResult.purchase.id, {
        refundedAt: new Date().toISOString(),
        items: [{ purchaseItemId: purchaseResult.items[0].id, quantity, amountMinor }],
        note,
      }, mutationKey('refund'), auth.csrfToken)
      setRefundResult(result)
      setRefundOpen(false)
    } catch (error) {
      setWriteError(shoppingErrorMessage(error, 'refund'))
    } finally {
      setBusy(false)
    }
  }

  if (shoppingQuery.isPending) return <main className="life-commerce-workspace is-loading" aria-busy="true"><span className="life-commerce-loader" /><p>正在核对采购事实…</p></main>
  if (shoppingQuery.error) return <main className="life-commerce-workspace"><div className="life-commerce-load-error" role="alert"><strong>采购事实暂时无法加载</strong><p>{shoppingErrorMessage(shoppingQuery.error, 'load')}</p><button type="button" onClick={() => void shoppingQuery.refetch()}>重新载入采购</button></div></main>

  return <main className="life-commerce-workspace life-shopping-workspace">
    {writeError ? <div className="life-commerce-write-error" role="alert"><strong>操作未保存</strong><span>{writeError}</span><button type="button" onClick={() => setWriteError('')}>关闭</button></div> : null}
    <header className="life-commerce-heading">
      <div><span>Shopping command desk</span><h1 ref={headingRef} tabIndex={-1}>采购工作台</h1><p>系统建议、正式清单、库存入账与现金事实各自有边界；确认采购时再把它们原子连接。</p></div>
      <div className="life-commerce-heading__stamp"><span>开放行动</span><strong>{formalItems.reduce((sum, item) => sum + (item.remainingQuantity > 0 ? 1 : 0), 0)}</strong></div>
    </header>
    {itemFilter ? <p className="life-commerce-filter">筛选：{itemFilter}</p> : sourceFilter ? <p className="life-commerce-filter">来源：{sourceFilter}</p> : null}

    <section className="life-commerce-urgent" role="region" aria-label="立即处理">
      <header><div><span>Now</span><h2>立即处理</h2></div><p>临近需要日期与高优先级行动</p></header>
      {urgent.length ? <ol>{urgent.map((item) => <li key={item.id}><strong>{item.itemId}</strong><span>{item.neededOn ? `${item.neededOn} 前需要` : priorityLabel(item.priority)}</span><small>{item.remainingQuantity} {item.unit} 尚未采购</small></li>)}</ol> : <p>当前没有临期或高优先级采购。</p>}
    </section>

    <section className="life-commerce-ledger" role="region" aria-label="正式采购清单">
      <header><div><span>Committed list</span><h2>正式采购清单</h2></div><p>只有这里的条目能够进入采购确认。</p></header>
      {groups.length ? <div className="life-commerce-groups">{groups.map(([label, items]) => <section key={label} aria-label={label}><h3>{label}</h3><ol>{items.map((item) => <li key={item.id} className={item.remainingQuantity === 0 ? 'is-complete' : undefined}><div><strong>{item.itemId} · {item.remainingQuantity} {item.unit} 待采购</strong><span>{item.neededOn ?? '无指定日期'} · v{item.version}</span></div><button type="button" disabled={item.remainingQuantity <= 0} onClick={() => setPurchaseItem(item)}>采购正式清单中的{item.itemId}</button></li>)}</ol></section>)}</div> : <div className="life-commerce-empty"><strong>正式清单为空</strong><p>系统建议不会自动变成采购承诺。</p></div>}
    </section>

    <section className="life-commerce-suggestions" role="region" aria-label="系统建议">
      <header><div><span>Derived evidence</span><h2>系统建议</h2></div><p>同一物品的计划缺口与最低库存理由合并呈现。</p></header>
      {suggestions.length ? <ol>{suggestions.map((suggestion) => <li key={suggestion.id}><div><strong>{suggestion.itemId}</strong><span>建议采购 {suggestion.suggestedQuantity} {suggestion.unit}</span></div><ul>{suggestion.reasons.map((reason) => <li key={reason.id}>{reason.kind === 'planned_shortage' ? '计划缺口' : reason.kind === 'minimum_stock' ? '最低库存' : reason.kind === 'expiring' ? '临期补充' : '手动理由'} {reason.requiredQuantity} {suggestion.unit}</li>)}</ul></li>)}</ol> : <div className="life-commerce-empty"><strong>暂无系统建议</strong><p>无建议不代表库存为零。</p></div>}
    </section>

    <section className="life-commerce-history" role="region" aria-label="采购与退款历史">
      <header><div><span>Immutable trail</span><h2>采购与退款历史</h2></div><p>退款以抵消事件追加，不修改原采购。</p></header>
      {!purchaseResult ? <p>暂无已确认交易</p> : <article><div><strong>{purchaseResult.items[0]?.itemId}</strong><span>{purchaseResult.purchase.id} · {money(purchaseResult.purchase.totalAmountMinor)}</span><small>库存 +{purchaseResult.items[0]?.quantity} {purchaseResult.items[0]?.unit}</small></div>{refundResult ? <p>本次采购已有退款抵消事实</p> : <button type="button" onClick={() => setRefundOpen(true)}>为本次采购办理退款</button>}</article>}
    </section>

    {purchaseResult ? <p className="life-commerce-notice" role="status" aria-label="采购结果">采购已确认 · 库存 +{purchaseResult.items[0]?.quantity} {purchaseResult.items[0]?.unit} · 现金支出 {money(purchaseResult.purchase.totalAmountMinor)} · 清单剩余 {purchaseResult.shoppingItems[0]?.remainingQuantity} {purchaseResult.shoppingItems[0]?.unit}</p> : null}
    {refundResult ? <p className="life-commerce-notice" role="status" aria-label="退款结果">退款已确认 · 库存 -{refundResult.items[0]?.quantity} {purchaseResult?.items[0]?.unit} · 现金净额 -{money(refundResult.refund.totalAmountMinor)}</p> : null}
    {purchaseItem ? <PurchaseConfirm item={purchaseItem} pending={busy} onClose={() => setPurchaseItem(null)} onConfirm={confirmPurchase} /> : null}
    {refundOpen && purchaseResult ? <RefundConfirm result={purchaseResult} pending={busy} onClose={() => setRefundOpen(false)} onConfirm={confirmRefund} /> : null}
  </main>
}
