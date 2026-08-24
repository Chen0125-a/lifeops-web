import { useEffect, useRef, useState } from 'react'
import type { PurchaseItemInput, ShoppingItem } from '../../../domain/lifeCommerce'

interface PurchaseConfirmProps {
  item: ShoppingItem
  pending: boolean
  onClose(): void
  onConfirm(input: PurchaseItemInput & { storeName: string }): Promise<void>
}

export function PurchaseConfirm({ item, pending, onClose, onConfirm }: PurchaseConfirmProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [quantity, setQuantity] = useState(String(item.remainingQuantity))
  const [amount, setAmount] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [locationId, setLocationId] = useState('pantry')
  const [updateCurrentPrice, setUpdateCurrentPrice] = useState(false)

  useEffect(() => { closeRef.current?.focus() }, [])

  const submit = async () => {
    const numericQuantity = Number(quantity)
    const amountMinor = Math.round(Number(amount) * 100)
    if (!(numericQuantity > 0) || !(amountMinor >= 0)) return
    await onConfirm({
      shoppingItemId: item.id,
      itemId: item.itemId,
      quantity: numericQuantity,
      unit: item.unit,
      amountMinor,
      updateCurrentPrice,
      expiresOn: expiresOn || null,
      locationId: locationId || null,
      storeName: item.storeGroup,
    })
  }

  return <div className="life-commerce-layer" onKeyDown={(event) => { if (event.key === 'Escape' && !pending) onClose() }}>
    <button type="button" aria-label="取消采购" onClick={onClose} disabled={pending} />
    <section role="dialog" aria-modal="true" aria-label={`确认采购${item.itemId}`}>
      <header><div><span>Purchase confirmation</span><h2>确认采购{item.itemId}</h2></div><button ref={closeRef} type="button" onClick={onClose} disabled={pending}>关闭</button></header>
      <div className="purchase-confirm__body">
        <p>本次确认会在一个服务端事务里同时写入库存批次、现金支出与正式采购清单；部分采购只关闭已购数量。</p>
        <dl>
          <div><dt>待采购</dt><dd>{item.remainingQuantity} {item.unit}</dd></div>
          <div><dt>分组</dt><dd>{item.storeGroup}</dd></div>
          <div><dt>需要日期</dt><dd>{item.neededOn ?? '未指定'}</dd></div>
        </dl>
        <label>实际数量<input type="number" min="0.0001" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
        <label>实付金额（元）<input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label>批次到期日<input type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} /></label>
        <label>存放位置<select value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="pantry">储物柜</option><option value="fridge">冷藏</option><option value="freezer">冷冻</option></select></label>
        <label className="life-commerce-check"><input type="checkbox" checked={updateCurrentPrice} onChange={(event) => setUpdateCurrentPrice(event.target.checked)} />将本次价格设为当前价格</label>
      </div>
      <footer><button type="button" onClick={onClose} disabled={pending}>取消</button><button type="button" onClick={() => void submit()} disabled={pending || !(Number(quantity) > 0) || !(Number(amount) >= 0)}>{pending ? '正在确认…' : Number(quantity) < item.remainingQuantity ? '确认部分采购' : '确认采购'}</button></footer>
    </section>
  </div>
}
