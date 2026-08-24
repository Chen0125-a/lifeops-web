import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { publicContentApi, type PublicContentSummary } from '../api/publicContentApi'
import { PublicDetailShell, type PublicReturnState } from '../components/public/PublicDetailShell'
import { getPublicDestination, type PublicDestinationSlug } from '../content/publicDestinations'

interface PublicDestinationPageProps { slug?: PublicDestinationSlug }
interface PublicDestinationLocationState { publicReturn?: PublicReturnState }

export function PublicDestinationPage({ slug: fixedSlug }: PublicDestinationPageProps = {}) {
  const { slug: routeSlug = '' } = useParams()
  const slug = fixedSlug ?? routeSlug
  const destination = getPublicDestination(slug)
  const navigate = useNavigate()
  const location = useLocation()
  const returnState = (location.state as PublicDestinationLocationState | null)?.publicReturn
  const [items, setItems] = useState<PublicContentSummary[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [transitioning, setTransitioning] = useState(Boolean(returnState))

  useEffect(() => {
    if (!destination) return
    const controller = new AbortController()
    setStatus('loading')
    publicContentApi.list(destination.slug, controller.signal)
      .then((nextItems) => {
        setItems([...nextItems].sort((left, right) => Number(right.featured) - Number(left.featured) || right.publishedAt.localeCompare(left.publishedAt) || left.slug.localeCompare(right.slug)))
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setStatus('error')
      })
    return () => controller.abort()
  }, [destination])

  useEffect(() => {
    if (!transitioning) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const timer = window.setTimeout(() => setTransitioning(false), media.matches ? 0 : 320)
    return () => window.clearTimeout(timer)
  }, [transitioning])

  if (!destination) return <main className="public-detail public-detail--missing"><div className="public-detail__missing"><h1>没有找到这项公开内容</h1><Link to="/">返回 LifeOps 首页</Link></div></main>

  const handleReturn = (state?: PublicReturnState) => navigate('/', { state: state ? { publicReturn: state } : undefined })

  return (
    <>
      <PublicDetailShell contentStatus={status} destination={destination} items={items} onReturn={handleReturn} returnState={returnState} transitioning={transitioning} />
      {status === 'ready' && items.length ? <nav aria-label="公开内容索引" className="public-detail__published-index"><span>Published index</span>{items.map((item) => <Link key={item.slug} to={`/p/${encodeURIComponent(item.slug)}`}>{item.title}</Link>)}<a href="/api/v1/public/feed.xml">订阅 RSS</a></nav> : null}
      {status === 'loading' ? <p aria-live="polite" className="public-detail__status">正在读取已发布内容…</p> : null}
      {status === 'error' ? <div className="public-detail__status public-detail__status--error" role="alert"><span>暂时无法读取公开内容。</span><button onClick={() => window.location.reload()} type="button">重试</button></div> : null}
    </>
  )
}
