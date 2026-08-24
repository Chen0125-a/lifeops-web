import { lazy, Suspense, type ReactNode } from 'react'
import { Link, Navigate, Outlet, type RouteObject } from 'react-router-dom'
import { PublicHomePage } from './pages/PublicHomePage'
import { AuthProvider, useAuth } from './state/AuthContext'

const TechnologyWorldPage = lazy(() => import('./pages/TechnologyWorldPage').then((module) => ({ default: module.TechnologyWorldPage })))
const PrivateAppBoundary = lazy(() => import('./components/private/PrivateAppBoundary').then((module) => ({ default: module.PrivateAppBoundary })))
const LifeLayout = lazy(() => import('./features/life/LifeLayout').then((module) => ({ default: module.LifeLayout })))
const PublicSnapshotRoute = lazy(() => import('./pages/PublicSnapshotRoute').then((module) => ({ default: module.PublicSnapshotRoute })))
const PublicDestinationPage = lazy(() => import('./pages/PublicDestinationPage').then((module) => ({ default: module.PublicDestinationPage })))
const OverviewRoute = lazy(() => import('./features/overview/OverviewPage').then((module) => ({ default: module.OverviewRoute })))
const GoalsPage = lazy(() => import('./features/goals/GoalsPage').then((module) => ({ default: module.GoalsPage })))
const SchedulePage = lazy(() => import('./features/schedule/SchedulePage').then((module) => ({ default: module.SchedulePage })))
const HabitsPage = lazy(() => import('./features/habits/HabitsPage').then((module) => ({ default: module.HabitsPage })))
const RecordsPage = lazy(() => import('./features/records/RecordsPage').then((module) => ({ default: module.RecordsPage })))
const ReviewsPage = lazy(() => import('./features/reviews/ReviewsPage').then((module) => ({ default: module.ReviewsPage })))
const KnowledgePage = lazy(() => import('./features/knowledge/KnowledgePage').then((module) => ({ default: module.KnowledgePage })))
const PublishingPage = lazy(() => import('./features/publishing/PublishingPage').then((module) => ({ default: module.PublishingPage })))
const SettingsPage = lazy(() => import('./features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const LifeTodayRoute = lazy(() => import('./features/life/LifeTodayPage').then((module) => ({ default: module.LifeTodayRoute })))
const LifeCalendarRoute = lazy(() => import('./features/life/LifeCalendarPage').then((module) => ({ default: module.LifeCalendarRoute })))
const LifeCatalogRoute = lazy(() => import('./features/life/catalog/LifeCatalogPage').then((module) => ({ default: module.LifeCatalogRoute })))
const MedicinesPage = lazy(() => import('./features/life/medicines/MedicinesPage').then((module) => ({ default: module.MedicinesPage })))
const HouseholdPage = lazy(() => import('./features/life/household/HouseholdPage').then((module) => ({ default: module.HouseholdPage })))
const LifeDataPage = lazy(() => import('./features/life/data/LifeDataPage').then((module) => ({ default: module.LifeDataPage })))
const RecipesRoute = lazy(() => import('./features/life/recipes/RecipesPage').then((module) => ({ default: module.RecipesRoute })))
const LifePlansRoute = lazy(() => import('./features/life/plans/LifePlansPage').then((module) => ({ default: module.LifePlansRoute })))
const FitnessRoute = lazy(() => import('./features/life/fitness/FitnessPage').then((module) => ({ default: module.FitnessRoute })))
const ShoppingPage = lazy(() => import('./features/life/shopping/ShoppingPage').then((module) => ({ default: module.ShoppingPage })))
const LifeAnalyticsPage = lazy(() => import('./features/life/analytics/LifeAnalyticsPage').then((module) => ({ default: module.LifeAnalyticsPage })))
const PlatformPage = lazy(() => import('./features/platform/PlatformPage').then((module) => ({ default: module.PlatformPage })))

function deferredRoute(children: ReactNode) {
  return <Suspense fallback={<div aria-live="polite" className="route-gate">正在打开工作区…</div>}>{children}</Suspense>
}

function RoutePlaceholder({ title }: { title: string }) {
  return (
    <main className="route-placeholder">
      <h1>{title}</h1>
      <Link to="/" viewTransition>返回首页</Link>
    </main>
  )
}

function PrivateRoutePlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <article className="private-route-placeholder">
      <p className="private-route-kicker">LifeOps 私人工作台</p>
      <h1 tabIndex={-1}>{title}</h1>
      <p>{description}</p>
      <Link to="/app/overview">返回总览</Link>
    </article>
  )
}

function LifeRoutePlaceholder({ title }: { title: string }) {
  return <article className="life-section-placeholder"><p>Life system</p><h1 tabIndex={-1}>{title}</h1><span>该工作区将在当前 Life 主线的后续原子任务中接入真实事实。</span></article>
}

function PrivateAccess({ children }: { children: ReactNode }) {
  const auth = useAuth()
  if (auth.status === 'loading') return <main className="route-gate" aria-live="polite"><span />正在确认私人边界…</main>
  return auth.status === 'authenticated' ? children : <Navigate to="/" replace />
}

/** The provider shell stays mounted while the data router performs route transitions. */
export function App() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  )
}

export const appRoutes: RouteObject[] = [
  {
    element: <App />,
    children: [
      { path: '/', element: <PublicHomePage /> },
      { path: '/now', element: deferredRoute(<PublicDestinationPage slug="now" />) },
      { path: '/doing', element: deferredRoute(<PublicDestinationPage slug="doing" />) },
      { path: '/learning', element: deferredRoute(<PublicDestinationPage slug="learning" />) },
      { path: '/moments', element: deferredRoute(<PublicDestinationPage slug="moments" />) },
      { path: '/archive', element: deferredRoute(<PublicDestinationPage slug="archive" />) },
      { path: '/explore/now', element: <Navigate to="/now" replace /> },
      { path: '/explore/projects', element: <Navigate to="/doing" replace /> },
      { path: '/explore/notes', element: <Navigate to="/learning" replace /> },
      { path: '/explore/timeline', element: <Navigate to="/archive" replace /> },
      { path: '/worlds/:slug', element: deferredRoute(<TechnologyWorldPage />) },
      { path: '/snapshots/:id', element: deferredRoute(<PublicSnapshotRoute />) },
      { path: '/p/:slug', element: deferredRoute(<PublicSnapshotRoute />) },
      {
        path: '/app',
        element: <PrivateAccess>{deferredRoute(<PrivateAppBoundary />)}</PrivateAccess>,
        children: [
          { index: true, element: <Navigate to="/app/overview" replace /> },
          { path: 'overview', element: deferredRoute(<OverviewRoute />) },
          { path: 'goals', element: deferredRoute(<GoalsPage />) },
          { path: 'schedule', element: deferredRoute(<SchedulePage />) },
          { path: 'habits', element: deferredRoute(<HabitsPage />) },
          { path: 'records', element: deferredRoute(<RecordsPage />) },
          { path: 'reviews', element: deferredRoute(<ReviewsPage />) },
          { path: 'knowledge', element: deferredRoute(<KnowledgePage />) },
          {
            path: 'life',
            element: deferredRoute(<LifeLayout />),
            children: [
              { index: true, element: deferredRoute(<LifeTodayRoute />) },
              { path: 'calendar', element: deferredRoute(<LifeCalendarRoute />) },
              { path: 'plans', element: deferredRoute(<LifePlansRoute />) },
              { path: 'recipes', element: deferredRoute(<RecipesRoute />) },
              { path: 'ingredients', element: deferredRoute(<LifeCatalogRoute />) },
              { path: 'medicines', element: deferredRoute(<MedicinesPage />) },
              { path: 'household', element: deferredRoute(<HouseholdPage />) },
              { path: 'fitness', element: deferredRoute(<FitnessRoute />) },
              { path: 'shopping', element: deferredRoute(<ShoppingPage />) },
              { path: 'analytics', element: deferredRoute(<LifeAnalyticsPage />) },
              { path: 'data', element: deferredRoute(<LifeDataPage />) },
            ],
          },
          { path: 'publish', element: deferredRoute(<PublishingPage />) },
          { path: 'platform', element: deferredRoute(<PlatformPage />) },
          { path: 'settings', element: deferredRoute(<SettingsPage />) },
          { path: 'today', element: <Navigate to="/app/overview" replace /> },
          { path: 'plans', element: <Navigate to="/app/schedule" replace /> },
          { path: 'snapshots', element: <Navigate to="/app/publish" replace /> },
        ],
      },
      { path: '*', element: <RoutePlaceholder title="没有找到这个页面" /> },
    ],
  },
]
