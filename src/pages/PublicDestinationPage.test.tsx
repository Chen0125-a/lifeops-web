import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publicContentApi } from '../api/publicContentApi'
import { appRoutes } from '../App'
import { publicDestinations, type PublicDestinationSlug } from '../content/publicDestinations'
import { PublicDestinationPage } from './PublicDestinationPage'

const layoutByDestination: Record<PublicDestinationSlug, string> = {
  now: 'status-rhythm', doing: 'project-ledger', learning: 'learning-notebook', moments: 'moment-stream', archive: 'archive-index',
}

const renderRoute = (path: string) => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/:slug" element={<PublicDestinationPage />} /></Routes></MemoryRouter>)

describe('PublicDestinationPage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('registers exactly the five approved direct destination routes', () => {
    const destinationRoutes = (appRoutes[0].children ?? [])
      .map((route) => route.path)
      .filter((path) => ['/now', '/doing', '/learning', '/moments', '/archive'].includes(path ?? ''))

    expect(destinationRoutes).toEqual(['/now', '/doing', '/learning', '/moments', '/archive'])
  })

  it('registers the four approved compatibility redirects without changing snapshot compatibility', () => {
    const routes = (appRoutes[0].children ?? []).map((route) => route.path)
    expect(routes).toEqual(expect.arrayContaining([
      '/explore/now',
      '/explore/projects',
      '/explore/notes',
      '/explore/timeline',
      '/snapshots/:id',
    ]))
  })

  it.each(publicDestinations)('uses a distinct page-native layout for $slug', (destination) => {
    const { container, unmount } = render(
      <MemoryRouter initialEntries={[`/${destination.slug}`]}>
        <PublicDestinationPage slug={destination.slug as PublicDestinationSlug} />
      </MemoryRouter>,
    )
    expect(container.querySelector('[data-public-detail-layout]')).toHaveAttribute('data-public-detail-layout', layoutByDestination[destination.slug])
    unmount()
  })

  it('renders a persistent exit and destination-specific content', () => {
    const { container } = renderRoute('/learning')
    expect(screen.getByRole('heading', { name: '最近在学' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回公开星盘' })).toBeInTheDocument()
    expect(container.querySelector('[data-sticky-exit]')).toBeInTheDocument()
    expect(screen.getByText('近期学习')).toBeInTheDocument()
  })

  it('keeps the approved doing destination free of technology-logo navigation', () => {
    const { container } = renderRoute('/doing')
    expect(screen.getByRole('heading', { name: '正在做' })).toBeInTheDocument()
    expect(screen.getByText('当前行动')).toBeInTheDocument()
    expect(container.querySelector('.public-tech-foundation')).not.toBeInTheDocument()
  })

  it('renders an honest missing state', () => {
    renderRoute('/missing')
    expect(screen.getByRole('heading', { name: '没有找到这项公开内容' })).toBeInTheDocument()
  })

  it('never presents a failed public read as a truthful empty category', async () => {
    vi.spyOn(publicContentApi, 'list').mockRejectedValueOnce(new Error('offline'))
    renderRoute('/moments')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('暂时无法读取公开内容'))
    expect(screen.queryByText('这个栏目暂时没有已发布内容。')).not.toBeInTheDocument()
  })

  it('orders featured revisions first and exposes stable public detail and RSS links without source identifiers', async () => {
    vi.spyOn(publicContentApi, 'list').mockResolvedValueOnce([
      { id: 'draft-plain', slug: 'plain-entry', category: 'learning', title: '普通条目', excerpt: '普通摘要', coverUrl: null, publishedAt: '2026-08-22T08:00:00.000Z', featured: false, revision: 1 },
      { id: 'draft-featured', slug: 'featured-entry', category: 'learning', title: '精选条目', excerpt: '精选摘要', coverUrl: null, publishedAt: '2026-08-22T09:00:00.000Z', featured: true, revision: 2 },
    ])
    renderRoute('/learning')

    const index = await screen.findByRole('navigation', { name: '公开内容索引' })
    const links = within(index).getAllByRole('link', { name: /条目/ })
    expect(links.map((link) => link.textContent)).toEqual(['精选条目', '普通条目'])
    expect(links[0]).toHaveAttribute('href', '/p/featured-entry')
    expect(links[1]).toHaveAttribute('href', '/p/plain-entry')
    expect(within(index).getByRole('link', { name: '订阅 RSS' })).toHaveAttribute('href', '/api/v1/public/feed.xml')
    expect(document.body.innerHTML).not.toMatch(/draft-featured|draft-plain|source/i)
  })

  it('treats a direct URL as direct entry and gives Escape the same return behavior', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/learning']}>
        <Routes>
          <Route path="/" element={<button type="button">公开首页焦点</button>} />
          <Route path="/:slug" element={<PublicDestinationPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('public-detail-shell')).toHaveAttribute('data-direct-entry', 'true')
    expect(document.querySelector('[data-flip-id]')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: '公开首页焦点' })).toBeVisible()
  })
})
