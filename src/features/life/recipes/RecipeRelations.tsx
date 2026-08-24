import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { CatalogItem } from '../../../domain/lifeCatalog'
import type { InventoryBalance, InventoryTransaction } from '../../../domain/lifeInventory'
import type { Recipe, RecipeRelation } from '../../../domain/lifeRecipes'

type FeasibilityFilter = 'all' | 'now' | 'missing-one' | 'expiring'

interface RecipeRelationsProps {
  recipe?: Recipe
  relations: RecipeRelation[]
  items: CatalogItem[]
  balances: InventoryBalance[]
  transactions: InventoryTransaction[]
  onClose(): void
  onOpenRecipe(id: string): void
}

export function RecipeRelations({ recipe, relations, items, balances, transactions, onClose, onOpenRecipe }: RecipeRelationsProps) {
  const [itemId, setItemId] = useState<string | null>(null)
  const [display, setDisplay] = useState<'list' | 'graph'>('list')
  const [filter, setFilter] = useState<FeasibilityFilter>('all')
  const itemName = (id: string) => items.find((item) => item.id === id)?.name ?? id
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; relations: RecipeRelation[] }>()
    for (const relation of relations) {
      const group = map.get(relation.recipeId) ?? { name: relation.recipeName, relations: [] }
      group.relations.push(relation)
      map.set(relation.recipeId, group)
    }
    return [...map].map(([id, value]) => {
      const missing = value.relations.filter((relation) => {
        const balance = balances.find((entry) => entry.itemId === relation.itemId)
        return balance == null || balance.onHand < relation.quantity
      }).length
      const expiring = value.relations.some((relation) => transactions.some((transaction) => transaction.itemId === relation.itemId && transaction.allocations.some((allocation) => Boolean(allocation.expiresOn))))
      return { id, ...value, missing, expiring }
    })
  }, [balances, relations, transactions])
  const shown = grouped.filter((entry) => {
    if (itemId && !entry.relations.some((relation) => relation.itemId === itemId)) return false
    if (filter === 'now') return entry.missing === 0
    if (filter === 'missing-one') return entry.missing === 1
    if (filter === 'expiring') return entry.expiring
    return true
  })
  const recipeRelations = recipe ? relations.filter((relation) => relation.recipeId === recipe.id) : []
  const nodeIds = [...new Set((itemId ? relations.filter((relation) => relation.itemId === itemId) : recipeRelations.length ? recipeRelations : relations).map((relation) => relation.itemId))]

  return <section className="recipe-relations" role="region" aria-label="食谱与食材关系">
    <header><div><button type="button" onClick={onClose}>返回食谱</button><span>Bidirectional composition</span><h2>{itemId ? `${itemName(itemId)} 用于哪些食谱` : recipe ? `${recipe.name} 的组成关系` : '食谱与食材关系'}</h2></div><div><button type="button" aria-pressed={display === 'graph'} onClick={() => setDisplay('graph')}>关系图</button><button type="button" aria-pressed={display === 'list'} onClick={() => setDisplay('list')}>关系列表</button></div></header>

    {recipe && !itemId ? <div className="recipe-relations__ingredients">{recipeRelations.map((relation) => <article key={`${relation.recipeId}-${relation.itemId}`}><div><Link to={`/app/life/ingredients?item=${encodeURIComponent(relation.itemId)}`} aria-label={`打开食材 ${itemName(relation.itemId)}`}>{itemName(relation.itemId)}</Link><span>{relation.quantity} {relation.unit}</span></div><button type="button" onClick={() => setItemId(relation.itemId)}>查看使用 {itemName(relation.itemId)} 的食谱</button></article>)}</div> : null}

    <nav className="recipe-relations__filters" aria-label="可做性筛选"><button type="button" aria-pressed={filter === 'now'} onClick={() => setFilter('now')}>现在能做</button><button type="button" aria-pressed={filter === 'missing-one'} onClick={() => setFilter('missing-one')}>只差一项</button><button type="button" aria-pressed={filter === 'expiring'} onClick={() => setFilter('expiring')}>优先消耗临期</button><button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部关系</button></nav>

    {display === 'graph' ? <div className="recipe-relations__graph" aria-label="可交互关系图"><p>关系较密，关系列表始终保留为完整入口。</p><div>{nodeIds.map((id, index) => <button type="button" aria-label={`关系节点 ${itemName(id)}`} key={id} style={{ '--node-index': index } as React.CSSProperties} onClick={() => setItemId(id)}>{itemName(id)}</button>)}</div></div> : null}

    <div className={display === 'graph' ? 'recipe-relations__table is-fallback' : 'recipe-relations__table'}>
      <table aria-label="食谱与食材关系列表"><thead><tr><th>食谱</th><th>组成</th><th>当前判断</th><th>入口</th></tr></thead><tbody>{shown.map((entry) => <tr key={entry.id}><td>{entry.name}</td><td>{entry.relations.map((relation) => `${itemName(relation.itemId)} ${relation.quantity}${relation.unit}`).join(' · ')}</td><td>{entry.missing === 0 ? entry.expiring ? '可做 · 含临期库存' : '现在可做' : `缺 ${entry.missing} 项`}</td><td><button type="button" onClick={() => onOpenRecipe(entry.id)}>打开食谱 {entry.name}</button></td></tr>)}</tbody></table>
      {!shown.length ? <p className="life-empty">当前筛选没有匹配食谱；这里不会猜测缺失库存。</p> : null}
    </div>
  </section>
}
