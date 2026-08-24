import { useMemo, useState } from 'react'
import type { ItemUnitConversion, LifeUnit } from '../../../domain/lifeCatalog'

interface UnitConversionEditorProps {
  itemId: string
  baseUnit: string
  availableUnits: string[]
  conversions: ItemUnitConversion[]
  units: LifeUnit[]
  onChange(conversions: ItemUnitConversion[], availableUnits: string[]): void
}

function unitLabel(code: string, units: LifeUnit[]) {
  const unit = units.find((candidate) => candidate.code === code)
  return unit?.symbol || unit?.name || code
}

export function UnitConversionEditor({ itemId, baseUnit, availableUnits, conversions, units, onChange }: UnitConversionEditorProps) {
  const [fromUnit, setFromUnit] = useState(availableUnits.find((code) => code !== baseUnit) ?? '')
  const [factor, setFactor] = useState('')
  const missingUnits = useMemo(() => availableUnits.filter((code) => code !== baseUnit && !conversions.some((entry) => entry.fromUnit === code && entry.toUnit === baseUnit)), [availableUnits, baseUnit, conversions])

  const add = () => {
    const value = Number(factor)
    if (!fromUnit || !Number.isFinite(value) || value <= 0) return
    const next = conversions.filter((entry) => !(entry.fromUnit === fromUnit && entry.toUnit === baseUnit))
    next.push({ itemId, fromUnit, toUnit: baseUnit, factor: value })
    onChange(next, Array.from(new Set([...availableUnits, fromUnit, baseUnit])))
    setFactor('')
  }

  return (
    <fieldset className="catalog-editor__section">
      <legend>包装与物品换算</legend>
      <p>换算只保存已知事实。缺少换算时，库存预测会保持“不完整”。</p>
      {conversions.length ? <ul className="catalog-editor__facts">{conversions.map((entry) => (
        <li key={`${entry.fromUnit}-${entry.toUnit}`}>
          <span>{unitLabel(entry.fromUnit, units)} → {unitLabel(entry.toUnit, units)}</span>
          <strong>× {entry.factor}</strong>
          <button type="button" onClick={() => onChange(conversions.filter((candidate) => candidate !== entry), availableUnits)}>移除</button>
        </li>
      ))}</ul> : <p className="catalog-editor__quiet">尚未记录专属换算。</p>}
      {missingUnits.length ? <p role="status">待补全：{missingUnits.map((code) => `${unitLabel(code, units)} → ${unitLabel(baseUnit, units)}`).join('、')}</p> : null}
      <div className="catalog-editor__row">
        <label>来源单位
          <select value={fromUnit} onChange={(event) => setFromUnit(event.target.value)}>
            <option value="">选择单位</option>
            {units.filter((unit) => unit.code !== baseUnit).map((unit) => <option key={unit.code} value={unit.code}>{unit.name}（{unit.symbol}）</option>)}
          </select>
        </label>
        <label>换算系数
          <input type="number" min="0" step="any" value={factor} onChange={(event) => setFactor(event.target.value)} />
        </label>
        <button type="button" onClick={add}>加入换算</button>
      </div>
    </fieldset>
  )
}

export function ConversionFacts({ itemId, baseUnit, availableUnits, conversions, units }: Omit<UnitConversionEditorProps, 'onChange'>) {
  const missing = availableUnits.filter((code) => code !== baseUnit && !conversions.some((entry) => entry.fromUnit === code && entry.toUnit === baseUnit))
  return (
    <section className="catalog-inspector__facts" aria-label="单位换算">
      <h3>单位换算</h3>
      {conversions.length ? <dl>{conversions.map((entry) => <div key={`${itemId}-${entry.fromUnit}-${entry.toUnit}`}><dt>{unitLabel(entry.fromUnit, units)} → {unitLabel(entry.toUnit, units)}</dt><dd>× {entry.factor}</dd></div>)}</dl> : <p>没有已确认的物品专属换算。</p>}
      {missing.length ? <p className="catalog-warning">缺少 {missing.map((code) => `${unitLabel(code, units)} → ${unitLabel(baseUnit, units)}`).join('、')} 换算</p> : null}
    </section>
  )
}
