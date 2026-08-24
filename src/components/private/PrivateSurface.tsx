import { type ReactNode, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

export function PrivateSurface({
  title,
  lead,
  children,
}: {
  title: string
  lead: string
  children: ReactNode
}) {
  const location = useLocation()
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [location.pathname])

  return (
    <article className="private-surface" data-private-panel data-private-panel-route={location.pathname}>
      <header className="private-surface__intro">
        <div><h1 ref={headingRef} tabIndex={-1}>{title}</h1></div>
        <p>{lead}</p>
      </header>
      {children}
    </article>
  )
}
