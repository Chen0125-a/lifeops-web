type PrivateAppBoundaryModule = Awaited<ReturnType<typeof importPrivateAppBoundary>>
type OverviewRouteModule = Awaited<ReturnType<typeof importOverviewRoute>>

let privateAppBoundaryModule: ReturnType<typeof importPrivateAppBoundary> | undefined
let privateAppBoundaryResolved: PrivateAppBoundaryModule | undefined
let overviewRouteModule: ReturnType<typeof importOverviewRoute> | undefined
let overviewRouteResolved: OverviewRouteModule | undefined

function importPrivateAppBoundary() {
  return import('./components/private/PrivateAppBoundary')
}

function importOverviewRoute() {
  return import('./features/overview/OverviewPage')
}

export function loadPrivateAppBoundary() {
  privateAppBoundaryModule ??= importPrivateAppBoundary().then((module) => {
    privateAppBoundaryResolved = module
    return module
  })
  return privateAppBoundaryModule
}

export function loadOverviewRoute() {
  overviewRouteModule ??= importOverviewRoute().then((module) => {
    overviewRouteResolved = module
    return module
  })
  return overviewRouteModule
}

export function readPrivateAppBoundary() {
  return privateAppBoundaryResolved
}

export function readOverviewRoute() {
  return overviewRouteResolved
}

export async function preloadPrivateEntryModules() {
  await Promise.all([
    loadPrivateAppBoundary(),
    loadOverviewRoute(),
  ])
}
