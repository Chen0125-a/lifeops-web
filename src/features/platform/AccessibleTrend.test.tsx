import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AccessibleTrend } from './AccessibleTrend'

describe('AccessibleTrend', () => {
  it('pairs an SVG title and description with units and a tabular fallback', () => {
    render(<AccessibleTrend
      title="API P95 延迟"
      description="最近五分钟的只读聚合趋势"
      unit="seconds"
      series={[
        { name: 'API', points: [{ timestamp: 1_777_000_000, value: 0.24 }, { timestamp: 1_777_000_060, value: 0.31 }] },
        { name: 'Web', points: [{ timestamp: 1_777_000_000, value: 0.12 }, { timestamp: 1_777_000_060, value: 0.15 }] },
      ]}
    />)

    const graphic = screen.getByRole('img', { name: 'API P95 延迟 最近五分钟的只读聚合趋势' })
    expect(within(graphic).getByText('API P95 延迟')).toBeInTheDocument()
    expect(within(graphic).getByText('最近五分钟的只读聚合趋势')).toBeInTheDocument()
    expect(screen.getByText('单位：seconds')).toBeVisible()
    expect(screen.getByText('API', { selector: '.platform-trend__series-label' })).toBeVisible()
    expect(screen.getByText('Web', { selector: '.platform-trend__series-label' })).toBeVisible()
    const table = screen.getByRole('table', { name: 'API P95 延迟数据' })
    expect(within(table).getByRole('columnheader', { name: '时间' })).toBeVisible()
    expect(within(table).getByRole('columnheader', { name: 'API（seconds）' })).toBeVisible()
    expect(within(table).getByRole('columnheader', { name: 'Web（seconds）' })).toBeVisible()
  })

  it('does not rely on color alone to identify a series', () => {
    render(<AccessibleTrend title="就绪率" description="服务就绪状态" unit="ratio" series={[
      { name: 'API', points: [{ timestamp: 1, value: 1 }] },
      { name: 'Web', points: [{ timestamp: 1, value: 0.99 }] },
    ]} />)
    expect(screen.getByText('API', { selector: '.platform-trend__series-label' }).closest('li')).toHaveAttribute('data-series-pattern', 'solid')
    expect(screen.getByText('Web', { selector: '.platform-trend__series-label' }).closest('li')).toHaveAttribute('data-series-pattern', 'dashed')
  })
})
