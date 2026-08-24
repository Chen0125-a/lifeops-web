import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../api/queryClient'
import { LifeDataProvider } from '../../state/LifeDataContext'
import { PrivateAppLayout } from './PrivateAppLayout'

/** Loads private data infrastructure only after the authenticated route is entered. */
export function PrivateAppBoundary() {
  return (
    <QueryClientProvider client={queryClient}>
      <LifeDataProvider>
        <PrivateAppLayout />
      </LifeDataProvider>
    </QueryClientProvider>
  )
}
