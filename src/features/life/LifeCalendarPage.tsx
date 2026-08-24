import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { lifePlanningApi } from '../../api/lifePlanningApi'
import { isLocalDemoMode } from '../../api/lifeApi'
import { queryKeys } from '../../api/queryKeys'
import { useAuth } from '../../state/AuthContext'
import type { LifeCalendarOverlayProps } from './LifeCalendarOverlay'
import { LifeCalendarOverlay } from './LifeCalendarOverlay'
import { useLifeDay } from './useLifeDay'

export interface LifeCalendarPageProps extends Omit<LifeCalendarOverlayProps, 'open' | 'onClose' | 'returnFocusRef'> {
  onClose?: () => void
}

export function LifeCalendarPage(_props: LifeCalendarPageProps) {
  return <LifeCalendarOverlay {..._props} open onClose={_props.onClose ?? (() => undefined)} />
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function monthRange(date: string) {
  const [year, month] = date.split('-').map(Number)
  const last = new Date(year!, month!, 0).getDate()
  return { from: `${date.slice(0, 7)}-01`, to: `${date.slice(0, 7)}-${String(last).padStart(2, '0')}` }
}

export function LifeCalendarRoute() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const today = localDateKey()
  const selectedDate = searchParams.get('date') ?? today
  const range = useMemo(() => monthRange(selectedDate), [selectedDate])
  const selection = useLifeDay(selectedDate)
  const calendarQuery = useQuery({
    queryKey: queryKeys.lifePlanning.list({ kind: 'calendar', ...range, today }),
    queryFn: ({ signal }) => lifePlanningApi.listCalendar({ ...range, today }, signal),
    enabled: !isLocalDemoMode,
  })
  const [announcement, setAnnouncement] = useState('')
  const returnTo = (location.state as { lifeCalendarReturn?: string } | null)?.lifeCalendarReturn
  const monthDate = new Date(`${selectedDate.slice(0, 7)}-01T12:00:00`)
  const monthLabel = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(monthDate)

  return <>
    <LifeCalendarPage
      key={location.key}
      status={calendarQuery.isPending || selection.status === 'loading' ? 'loading' : calendarQuery.isError || selection.status === 'error' ? 'error' : 'ready'}
      error={calendarQuery.error instanceof Error ? calendarQuery.error.message : selection.error}
      onRetry={() => { void calendarQuery.refetch(); selection.retry?.() }}
      monthLabel={monthLabel}
      days={calendarQuery.data ?? []}
      today={today}
      selectedDate={selectedDate}
      selection={{ date: selectedDate, timeline: selection.timeline, projection: selection.projection }}
      onSelectDate={(date) => navigate(`/app/life/calendar?date=${encodeURIComponent(date)}`, { replace: true, state: location.state })}
      onClose={() => returnTo ? navigate(-1) : navigate(`/app/life?date=${encodeURIComponent(selectedDate)}`)}
      onOpenDay={(date) => navigate(`/app/life?date=${encodeURIComponent(date)}`)}
      onCopyPlan={(sourceDate, targetDate) => {
        return lifePlanningApi.copyDayPlan(sourceDate, targetDate, `copy-day-plan:${crypto.randomUUID()}`, auth.csrfToken)
          .then(() => { setAnnouncement(`已把 ${sourceDate} 的计划复制到 ${targetDate}`) })
          .catch((error) => {
            setAnnouncement('计划复制没有完成，请检查冲突后重试。')
            throw error
          })
      }}
      onApplyTemplate={(date) => navigate(`/app/life/plans?date=${encodeURIComponent(date)}&applyTemplate=1`)}
    />
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </>
}
