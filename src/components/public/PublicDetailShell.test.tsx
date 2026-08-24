import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { publicDestinations, type PublicDestinationSlug } from '../../content/publicDestinations'
import { PublicDetailShell, type PublicReturnState } from './PublicDetailShell'

const layoutByDestination: Record<PublicDestinationSlug, string> = {
  now: 'status-rhythm',
  doing: 'project-ledger',
  learning: 'learning-notebook',
  moments: 'moment-stream',
  archive: 'archive-index',
}

const items = [
  { id: 'one', slug: 'one', title: '公开内容一', excerpt: '摘要一', publishedAt: '2026-08-15T09:30:00.000Z', featured: true },
  { id: 'two', slug: 'two', title: '公开内容二', excerpt: '摘要二', publishedAt: '2026-08-14T09:30:00.000Z', featured: false },
  { id: 'three', slug: 'three', title: '公开内容三', excerpt: '摘要三', publishedAt: '2026-08-13T09:30:00.000Z', featured: false },
]

const returnState: PublicReturnState = {
  sourceObjectId: 'doing',
  objectPlayheads: { now: 0.1, doing: 0.2, learning: 0.3, moments: 0.4, archive: 0.5 },
  homeScrollY: 420,
  theme: 'night',
  sourceFocusId: 'public-object-doing',
}

describe('PublicDetailShell', () => {
  it.each(publicDestinations)('renders $slug as its own page-native layout', (destination) => {
    const { container, unmount } = render(<PublicDetailShell destination={destination} items={items} />)
    expect(container.querySelector('[data-public-detail-layout]')).toHaveAttribute(
      'data-public-detail-layout',
      layoutByDestination[destination.slug],
    )
    expect(screen.getByRole('heading', { name: destination.label, level: 1 })).toBeVisible()
    unmount()
  })

  it('keeps a 64px top return, a mobile bottom return and two related contexts', () => {
    const destination = publicDestinations.find((item) => item.slug === 'doing')!
    const { container } = render(<PublicDetailShell destination={destination} items={items} />)

    expect(screen.getByRole('button', { name: '返回公开星盘' })).toBeVisible()
    expect(container.querySelector('[data-fixed-return]')).toHaveStyle({ height: '64px' })
    expect(screen.getByRole('button', { name: '返回公开星盘（底部）' })).toBeVisible()
    expect(screen.getByTestId('public-detail-related').children.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps the empty state truthful while offering real adjacent destinations', () => {
    const destination = publicDestinations.find((item) => item.slug === 'now')!
    render(<PublicDetailShell destination={destination} items={[]} />)
    expect(screen.getByText('这个栏目暂时没有已发布内容。')).toBeVisible()
    expect(screen.getByTestId('public-detail-related').children.length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/完成率|增长|条公开内容/)).not.toBeInTheDocument()
  })

  it('uses Escape and explicit exits without discarding the exact return state', async () => {
    const user = userEvent.setup()
    const onReturn = vi.fn()
    const destination = publicDestinations.find((item) => item.slug === 'doing')!
    render(<PublicDetailShell destination={destination} items={items} onReturn={onReturn} returnState={returnState} />)

    await user.keyboard('{Escape}')
    expect(onReturn).toHaveBeenLastCalledWith(returnState)
    await user.click(screen.getByRole('button', { name: '返回公开星盘' }))
    expect(onReturn).toHaveBeenLastCalledWith(returnState)
  })

  it('never fabricates continuity for direct entry and removes the bounded clone after interruption', () => {
    const destination = publicDestinations.find((item) => item.slug === 'doing')!
    const { container, rerender } = render(<PublicDetailShell destination={destination} items={items} />)
    expect(container.querySelector('[data-flip-id]')).not.toBeInTheDocument()

    rerender(<PublicDetailShell destination={destination} items={items} returnState={returnState} transitioning />)
    const clone = container.querySelector('[data-flip-id="public-object-doing"]')
    expect(container.querySelectorAll('[data-flip-id="public-object-doing"]')).toHaveLength(1)
    expect(clone?.closest('[data-public-motion-subtree="detail-continuity"]')).toBeInTheDocument()
    expect(clone?.querySelector('svg')).toBeInTheDocument()

    rerender(<PublicDetailShell destination={destination} items={items} returnState={returnState} transitioning={false} />)
    expect(container.querySelector('[data-flip-id]')).not.toBeInTheDocument()
  })
})
