import type { PropsWithChildren } from 'react'
import { Link, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import { LifeSubnav } from './LifeSubnav'

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function LifeLayout({ children }: PropsWithChildren) {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const selectedDate = searchParams.get('date') ?? localDateKey()

  return (
    <section className="life-shell" data-testid="life-shell">
      <header className="life-command-strip">
        <div>
          <p>Life system</p>
          <LifeSubnav />
        </div>
        <Link className="life-calendar-trigger" to={`/app/life/calendar?date=${encodeURIComponent(selectedDate)}`} state={{ lifeCalendarReturn: `${location.pathname}${location.search}` }} aria-label="打开生活日历">
          <span aria-hidden="true">{selectedDate.slice(8)}</span>
          <span>日历</span>
        </Link>
      </header>
      <div className="life-route-stage">{children ?? <Outlet />}</div>
    </section>
  )
}
