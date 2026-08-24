import { type CSSProperties, useEffect, useRef } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { TechMark } from '../components/TechMark'
import { findTechnologyWorld, technologyWorlds } from '../content/technologyWorlds'
import { useLifeOpsTheme } from '../theme/theme'

export function TechnologyWorldPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const { theme, toggleTheme } = useLifeOpsTheme()
  const world = findTechnologyWorld(slug)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [slug])

  if (!world) {
    return (
      <main className="route-placeholder">
        <h1>没有找到这颗技术星球</h1>
        <Link to="/">返回公开宇宙</Link>
      </main>
    )
  }

  const currentIndex = technologyWorlds.findIndex((item) => item.slug === world.slug)
  const previous = technologyWorlds[(currentIndex - 1 + technologyWorlds.length) % technologyWorlds.length]
  const next = technologyWorlds[(currentIndex + 1) % technologyWorlds.length]

  return (
    <main className="tech-world" style={{ '--world-accent': world.accent } as CSSProperties}>
      <header className="tech-world__header">
        <button type="button" className="planet-back" onClick={() => navigate(-1)} aria-label="返回上一条轨道">←</button>
        <Link className="wordmark" to="/">LifeOps</Link>
        <div className="tech-world__header-actions">
          <span>{world.group.toUpperCase()}</span>
          <button className="icon-button" type="button" onClick={toggleTheme} aria-label={`切换为${theme === 'day' ? '夜间' : '日间'}主题`}>{theme === 'day' ? '夜' : '日'}</button>
        </div>
      </header>

      <div className="tech-world__canvas">
        <div className="tech-world__visual" aria-hidden="true">
          <div className="tech-world__orbit tech-world__orbit--outer" />
          <div className="tech-world__orbit tech-world__orbit--inner" />
          <div className="tech-world__planet" style={{ viewTransitionName: `planet-${world.slug}` } as CSSProperties}>
            <TechMark slug={world.slug} />
          </div>
          <span className="tech-world__index">{String(currentIndex + 1).padStart(2, '0')}</span>
        </div>

        <article className="tech-world__content">
          <h1 ref={headingRef} tabIndex={-1}>{world.name}</h1>
          <p className="tech-world__lead">{world.role}</p>

          <div className="tech-world__facts">
            <section>
              <p>01</p>
              <div><h2>在 LifeOps 中的角色</h2><p>{world.role}</p></div>
            </section>
            <section>
              <p>02</p>
              <div><h2>当前真实状态</h2><p>{world.currentUse}</p></div>
            </section>
            <section>
              <p>03</p>
              <div><h2>架构关系</h2><p>{world.architecture}</p></div>
            </section>
            <section>
              <p>04</p>
              <div><h2>学习与实践</h2><ul>{world.learningNotes.map((note) => <li key={note}>{note}</li>)}</ul></div>
            </section>
          </div>

          <a className="official-link" href={world.officialUrl} target="_blank" rel="noreferrer" aria-label={`打开 ${world.name} 官方文档`}>
            <span>查看官方文档</span><span aria-hidden="true">↗</span>
          </a>
        </article>
      </div>

      <nav className="tech-world__adjacent" aria-label="相邻技术星球">
        <Link to={`/worlds/${previous.slug}`} viewTransition>← {previous.name}</Link>
        <span>沿轨道继续</span>
        <Link to={`/worlds/${next.slug}`} viewTransition>{next.name} →</Link>
      </nav>
    </main>
  )
}
