import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { publicContentApi } from '../api/publicContentApi'
import { isLocalDemoMode, lifeApi } from '../api/lifeApi'
import { PublicRevisionArticle } from '../features/publishing/PublicPreview'
import type { PublicRevisionView } from '../domain/publishing'
import { useLifeState } from '../state/LifeDataContext'
import { useLifeOpsTheme } from '../theme/theme'
import '../styles/publishing.css'

function Unavailable() {
  return (
    <main className="public-snapshot public-snapshot--unavailable">
      <Link className="wordmark" to="/">LifeOps</Link>
      <h1>这份快照当前不可公开访问</h1>
      <p>它可能尚未发布、已经撤回，或这个地址并不存在。</p>
      <Link className="text-action" to="/"><span>返回 LifeOps</span><span>←</span></Link>
    </main>
  )
}

export function PublicSnapshotPage() {
  const { id, slug } = useParams<{ id?: string; slug?: string }>()
  const state = useLifeState()
  const { theme, toggleTheme } = useLifeOpsTheme()
  const [revision, setRevision] = useState<PublicRevisionView>()
  const [legacySlug, setLegacySlug] = useState<string>()
  const [loading, setLoading] = useState(Boolean(slug) || (!isLocalDemoMode && Boolean(id)))
  const localSnapshot = id ? state.snapshots.find((item) => (item.slug === id || item.id === id) && item.visibility === 'public') : undefined

  useEffect(() => {
    if (!slug) return
    const controller = new AbortController()
    setLoading(true)
    publicContentApi.get(slug, controller.signal).then(
      (value) => setRevision(value),
      (error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setRevision(undefined)
      },
    ).finally(() => setLoading(false))
    return () => controller.abort()
  }, [slug])

  useEffect(() => {
    if (!id || isLocalDemoMode) return
    let active = true
    setLoading(true)
    lifeApi.publicSnapshot(id).then(
      (value) => { if (active) setLegacySlug(value.slug) },
      () => { if (active) setLegacySlug(undefined) },
    ).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])

  if (loading) return <main className="public-snapshot public-snapshot--loading" role="status"><span />正在读取公开 revision…</main>
  if (id && (localSnapshot?.slug || legacySlug)) return <Navigate replace to={`/p/${encodeURIComponent(localSnapshot?.slug ?? legacySlug ?? '')}`} />
  if (!slug || !revision) return <Unavailable />

  return (
    <main className="public-snapshot public-snapshot--revision" data-public-revision-route>
      <header><Link className="wordmark" to="/">LifeOps</Link><span>公开 revision</span><button className="icon-button" type="button" onClick={toggleTheme} aria-label={`切换为${theme === 'day' ? '夜间' : '日间'}主题`}>{theme === 'day' ? '夜' : '日'}</button></header>
      <PublicRevisionArticle content={revision} />
      <p className="public-snapshot__boundary">这里只渲染已发布 revision 的公开白名单字段；私人来源和编辑事实不会进入页面。</p>
    </main>
  )
}
