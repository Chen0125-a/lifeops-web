import { useId, useMemo } from 'react'

interface TrendPoint { timestamp: number; value: number }
interface TrendSeries { name: string; points: TrendPoint[] }
interface AccessibleTrendProps { title: string; description: string; unit: string; series: TrendSeries[] }

const patterns = ['solid', 'dashed', 'dotted'] as const
const colors = ['#245fc7', '#b44b2a', '#38715b'] as const

export function AccessibleTrend({ title, description, unit, series }: AccessibleTrendProps) {
  const identity = useId().replaceAll(':', '')
  const titleId = `${identity}-title`
  const descriptionId = `${identity}-description`
  const timestamps = useMemo(() => [...new Set(series.flatMap((row) => row.points.map((point) => point.timestamp)))].sort((a, b) => a - b), [series])
  const values = series.flatMap((row) => row.points.map((point) => point.value))
  const minimum = values.length ? Math.min(...values) : 0
  const maximum = values.length ? Math.max(...values) : 1
  const range = maximum - minimum || 1
  const firstTimestamp = timestamps[0] ?? 0
  const timeRange = (timestamps.at(-1) ?? firstTimestamp + 1) - firstTimestamp || 1
  const points = (row: TrendSeries) => row.points.map((point) => {
    const x = 8 + ((point.timestamp - firstTimestamp) / timeRange) * 284
    const y = 92 - ((point.value - minimum) / range) * 76
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
  const valueAt = (row: TrendSeries, timestamp: number) => row.points.find((point) => point.timestamp === timestamp)?.value

  return (
    <figure className="platform-trend">
      <header><div><h3>{title}</h3><p>{description}</p></div><span>单位：{unit}</span></header>
      <svg viewBox="0 0 300 100" role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
        <title id={titleId}>{title}</title>
        <desc id={descriptionId}>{description}</desc>
        <path d="M8 92H292M8 54H292M8 16H292" className="platform-trend__grid" />
        {series.map((row, index) => <polyline
          key={row.name}
          points={points(row)}
          className={`platform-trend__line is-${patterns[index % patterns.length]}`}
          style={{ '--series-color': colors[index % colors.length] } as React.CSSProperties}
        />)}
      </svg>
      <ul className="platform-trend__legend" aria-label="趋势系列">
        {series.map((row, index) => <li key={row.name} data-series-pattern={patterns[index % patterns.length]}><span aria-hidden="true" /><span className="platform-trend__series-label">{row.name}</span></li>)}
      </ul>
      <div className="platform-trend__table-wrap">
        <table aria-label={`${title}数据`}>
          <thead><tr><th scope="col">时间</th>{series.map((row) => <th scope="col" key={row.name}>{row.name}（{unit}）</th>)}</tr></thead>
          <tbody>{timestamps.map((timestamp) => <tr key={timestamp}><th scope="row">{new Date(timestamp * 1_000).toLocaleTimeString('zh-CN')}</th>{series.map((row) => <td key={row.name}>{valueAt(row, timestamp) ?? '—'}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </figure>
  )
}
