import { useEffect, useRef } from 'react'
import { publicDestinations, type PublicDestination, type PublicDestinationSlug } from '../../content/publicDestinations'
import { gsap, useGSAP } from '../../motion/publicGsap'
import { OrbitGlyph } from './OrbitGlyph'
import type { PublicReturnState } from './publicReturnState'

export type { PublicReturnState } from './publicReturnState'

export interface PublicDetailItem {
  id: string
  slug: string
  title: string
  excerpt: string
  publishedAt: string
  featured: boolean
}

export interface PublicDetailShellProps {
  destination: PublicDestination
  items: readonly PublicDetailItem[]
  contentStatus?: 'loading' | 'ready' | 'error'
  onReturn?: (state?: PublicReturnState) => void
  returnState?: PublicReturnState
  transitioning?: boolean
}

const layoutByDestination: Record<PublicDestinationSlug, string> = {
  now: 'status-rhythm',
  doing: 'project-ledger',
  learning: 'learning-notebook',
  moments: 'moment-stream',
  archive: 'archive-index',
}

const sectionTitle: Record<PublicDestinationSlug, string> = {
  now: '最近的变化', doing: '当前行动', learning: '近期学习', moments: '近期切片', archive: '时间索引',
}

function PublishedItems({ destination, items }: Pick<PublicDetailShellProps, 'destination' | 'items'>) {
  if (items.length === 0) return <section className="public-detail-layout__empty" data-public-detail-empty><p>这个栏目暂时没有已发布内容。</p><span>{destination.description}</span></section>
  if (destination.slug === 'now') return <section className="public-detail-layout__now"><article className="public-detail-layout__now-lead"><time dateTime={items[0].publishedAt}>当前公开切片</time><h2>{items[0].title}</h2><p>{items[0].excerpt}</p></article><ol aria-label="本周公开节奏">{items.slice(1).map((item) => <li key={item.id}><time dateTime={item.publishedAt}>{item.publishedAt.slice(5, 10)}</time><span>{item.title}</span></li>)}</ol></section>
  if (destination.slug === 'doing') return <section className="public-detail-layout__doing"><header><span>ACTIVE THREADS</span><h2>{sectionTitle.doing}</h2></header><div>{items.map((item, index) => <article key={item.id}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{item.title}</h3><p>{item.excerpt}</p></div><time dateTime={item.publishedAt}>{item.publishedAt.slice(0, 10)}</time></article>)}</div></section>
  if (destination.slug === 'learning') return <section className="public-detail-layout__learning"><aside aria-label="学习主题"><span>INDEX</span>{items.map((item) => <a href={`#public-${item.slug}`} key={item.slug}>{item.title}</a>)}</aside><div>{items.map((item) => <article id={`public-${item.slug}`} key={item.slug}><p>NOTE · {item.publishedAt.slice(0, 10)}</p><h2>{item.title}</h2><blockquote>{item.excerpt}</blockquote></article>)}</div></section>
  if (destination.slug === 'moments') return <section className="public-detail-layout__moments">{items.map((item, index) => <figure data-moment-position={index % 2 ? 'right' : 'left'} key={item.id}><div aria-hidden="true"><span>{item.publishedAt.slice(5, 10)}</span></div><figcaption><h2>{item.title}</h2><p>{item.excerpt}</p></figcaption></figure>)}</section>
  return <section className="public-detail-layout__archive"><header><span>ARCHIVE</span><h2>{sectionTitle.archive}</h2></header><ol>{items.map((item) => <li key={item.id}><time dateTime={item.publishedAt}>{item.publishedAt.slice(0, 7)}</time><div><h3>{item.title}</h3><p>{item.excerpt}</p></div></li>)}</ol></section>
}

export function PublicDetailShell({ destination, items, contentStatus = 'ready', onReturn, returnState, transitioning = false }: PublicDetailShellProps) {
  const shellRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const returnRequestRef = useRef({ onReturn, returnState })
  returnRequestRef.current = { onReturn, returnState }
  const requestReturn = () => onReturn?.(returnState)
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [destination.slug])
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      const latest = returnRequestRef.current
      if (event.key === 'Escape') latest.onReturn?.(latest.returnState)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [])
  useGSAP(() => {
    const clone = shellRef.current?.querySelector<HTMLElement>('[data-flip-id]')
    if (!clone) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    gsap.fromTo(clone, { opacity: 0, scale: .68, x: 56, y: -24 }, { opacity: 1, scale: 1, x: 0, y: 0, duration: reduce ? 0 : .32, ease: 'power3.out' })
  }, { dependencies: [returnState?.sourceObjectId, transitioning], revertOnUpdate: true, scope: shellRef })
  const related = items.slice(0, 3)
  const adjacentDestinations = publicDestinations.filter((item) => item.slug !== destination.slug).slice(0, 2)
  return (
    <main className={`public-detail public-detail--${destination.slug}`} data-direct-entry={returnState ? 'false' : 'true'} data-public-detail-layout={layoutByDestination[destination.slug]} data-public-motion-subtree="detail-continuity" data-testid="public-detail-shell" ref={shellRef}>
      {returnState && transitioning ? <span aria-hidden="true" data-flip-id={`public-object-${returnState.sourceObjectId}`}><OrbitGlyph glyph={destination.glyph} /></span> : null}
      <header className="public-detail__bar" data-fixed-return data-sticky-exit style={{ height: '64px' }}><button aria-label="返回公开星盘" onClick={requestReturn} type="button"><span aria-hidden="true">←</span><span>返回公开星盘</span></button><span>{destination.label}</span><span>ESC</span></header>
      <section className="public-detail__hero"><div className="public-detail__glyph"><OrbitGlyph glyph={destination.glyph} /></div><div><p>LifeOps / {destination.shortLabel}</p><h1 ref={headingRef} tabIndex={-1}>{destination.label}</h1><span>{destination.description}</span></div></section>
      <section aria-busy={contentStatus === 'loading'} aria-labelledby="public-detail-section-title" className="public-detail__body"><header><p>{destination.description}</p><h2 id="public-detail-section-title">{sectionTitle[destination.slug]}</h2></header>{contentStatus === 'ready' ? <PublishedItems destination={destination} items={items} /> : null}</section>
      <aside aria-label="相关公开上下文" className="public-detail__related" data-testid="public-detail-related">
        {related.length > 0
          ? related.map((item) => <a href={`/p/${encodeURIComponent(item.slug)}`} key={item.slug}><span>{item.publishedAt.slice(0, 10)}</span><strong>{item.title}</strong></a>)
          : adjacentDestinations.map((item) => <a href={`/${item.slug}`} key={item.slug}><span>{item.shortLabel}</span><strong>{item.description}</strong></a>)}
      </aside>
      <nav aria-label="移动端返回" className="public-detail__mobile-return"><button aria-label="返回公开星盘（底部）" onClick={requestReturn} type="button">返回公开星盘 <span aria-hidden="true">↑</span></button></nav>
    </main>
  )
}
