import type { BudgetSummary as BudgetSummaryValue } from '../../../domain/lifeCommerce'

function money(minor: number) {
  return `¥${(minor / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function BudgetSummary({ budgets }: { budgets: BudgetSummaryValue[] }) {
  return <section className="life-budget-summary" aria-label="预算进度">
    <header><div><span>Guardrails</span><h2>预算</h2></div><p>阈值只提示，不篡改真实支出。</p></header>
    {budgets.length ? <ol>{budgets.map((budget) => {
      const percent = budget.limitMinor > 0 ? Math.round((budget.spentMinor / budget.limitMinor) * 100) : 0
      return <li key={budget.id} data-status={budget.thresholdStatus}>
        <div><strong>{budget.name} · 已使用 {percent}%</strong><span>{money(budget.spentMinor)} / {money(budget.limitMinor)}</span></div>
        <div className="life-budget-meter" aria-label={`${budget.name}使用进度 ${percent}%`}><span style={{ inlineSize: `${Math.min(100, Math.max(0, percent))}%` }} /></div>
        <p>{budget.forecast.status === 'complete'
          ? `预计 ${money(budget.forecast.projectedMinor)} · ${budget.forecast.projectedMinor > budget.limitMinor ? '将超出预算' : '仍在预算内'}`
          : '历史事实不足，暂不生成预测'}</p>
      </li>
    })}</ol> : <div className="life-commerce-empty"><strong>还没有预算</strong><p>支出仍会如实记录；预算只提供可选阈值。</p></div>}
  </section>
}

