import { LifeDataProvider } from '../state/LifeDataContext'
import { PublicSnapshotPage } from './PublicSnapshotPage'

/** Snapshot data is isolated from the lightweight public-home route. */
export function PublicSnapshotRoute() {
  return (
    <LifeDataProvider>
      <PublicSnapshotPage />
    </LifeDataProvider>
  )
}
