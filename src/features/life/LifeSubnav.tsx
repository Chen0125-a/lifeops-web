import { useLayoutEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

export const lifeRoutes = [
  { label: '今日', to: '/app/life' },
  { label: '计划', to: '/app/life/plans' },
  { label: '食谱', to: '/app/life/recipes' },
  { label: '库存', to: '/app/life/ingredients' },
  { label: '健身', to: '/app/life/fitness' },
  { label: '采购', to: '/app/life/shopping' },
  { label: '分析', to: '/app/life/analytics' },
  { label: '数据', to: '/app/life/data' },
] as const

export function LifeSubnav() {
  const location = useLocation()
  const navigationRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const navigation = navigationRef.current
    const active = navigation?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!navigation || !active) return

    const revealActiveRoute = () => {
      navigation.scrollTo?.({
        behavior: 'auto',
        left: Math.max(0, active.offsetLeft - ((navigation.clientWidth - active.offsetWidth) / 2)),
      })
    }

    revealActiveRoute()
    window.addEventListener('resize', revealActiveRoute)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(revealActiveRoute)
    resizeObserver?.observe(navigation)
    return () => {
      window.removeEventListener('resize', revealActiveRoute)
      resizeObserver?.disconnect()
    }
  }, [location.pathname])
  return (
    <nav ref={navigationRef} className="life-subnav" aria-label="生活工作台导航">
      {lifeRoutes.map((route) => <NavLink key={route.to} to={route.to} end={route.to === '/app/life'}>{route.label}</NavLink>)}
    </nav>
  )
}
