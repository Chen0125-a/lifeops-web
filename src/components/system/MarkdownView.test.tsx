import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownView } from './MarkdownView'

describe('MarkdownView', () => {
  it('does not put scripts, iframes, raw HTML event handlers, or their attributes in the DOM', () => {
    const { container } = render(
      <MarkdownView
        source={[
          '<script>window.__lifeopsXss = true</script>',
          '<iframe src="https://attacker.example/embed"></iframe>',
          '<img src="x" onerror="window.__lifeopsXss = true" />',
          '<p onclick="window.__lifeopsXss = true">安全正文</p>',
        ].join('\n')}
      />,
    )

    expect(container.querySelector('script')).not.toBeInTheDocument()
    expect(container.querySelector('iframe')).not.toBeInTheDocument()
    expect(container.querySelector('[onerror], [onclick]')).not.toBeInTheDocument()
    expect(container.innerHTML).not.toContain('window.__lifeopsXss')
    expect((window as typeof window & { __lifeopsXss?: boolean }).__lifeopsXss).toBeUndefined()
  })

  it.each([
    ['javascript', 'javascript:alert(document.domain)'],
    ['data', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript', 'vbscript:msgbox(1)'],
  ])('makes a %s URL non-navigable', (_protocol, href) => {
    render(<MarkdownView source={`[危险链接](${href})`} />)

    const renderedHref = screen.getByText('危险链接').closest('a')?.getAttribute('href') ?? ''
    expect(renderedHref).toBe('')
  })

  it('renders safe GFM tables with table and header semantics', () => {
    render(
      <MarkdownView
        source={[
          '| 日期 | 进展 |',
          '| --- | --- |',
          '| 8 月 21 日 | 完成安全测试 |',
        ].join('\n')}
      />,
    )

    expect(screen.getByRole('table')).toBeVisible()
    expect(screen.getByRole('columnheader', { name: '日期' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: '进展' })).toBeVisible()
    expect(screen.getByRole('cell', { name: '完成安全测试' })).toBeVisible()
  })

  it('renders GFM task-list state as non-editable accessible checkboxes', () => {
    render(<MarkdownView source={'- [x] 已核验\n- [ ] 待处理'} />)

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]).toBeChecked()
    expect(checkboxes[1]).not.toBeChecked()
    expect(checkboxes.every((checkbox) => checkbox.hasAttribute('disabled'))).toBe(true)
    expect(screen.getByText('已核验')).toBeVisible()
    expect(screen.getByText('待处理')).toBeVisible()
  })

  it('marks external links with the exact approved relationship', () => {
    render(<MarkdownView source="[外部资料](https://example.com/reference)" />)

    const link = screen.getByRole('link', { name: '外部资料' })
    expect(link).toHaveAttribute('href', 'https://example.com/reference')
    expect(link).toHaveAttribute('rel', 'noreferrer noopener')
  })
})
