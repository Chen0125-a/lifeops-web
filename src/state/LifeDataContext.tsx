import { createContext, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { LifeRepository } from '../domain/lifeRepository'
import { isLocalDemoMode } from '../api/lifeApi'
import { RemoteLifeRepository, type RepositoryPort } from '../domain/remoteLifeRepository'
import { useAuth } from './AuthContext'

const RepositoryContext = createContext<RepositoryPort | null>(null)
const DataStatusContext = createContext<{ status: 'idle' | 'loading' | 'ready' | 'error'; error?: string }>({ status: 'idle' })

export function LifeDataProvider({
  children,
  repository,
}: {
  children: ReactNode
  repository?: LifeRepository
}) {
  const auth = useAuth()
  const [status, setStatus] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; error?: string }>({ status: repository || isLocalDemoMode ? 'ready' : 'idle' })
  const [value] = useState<LifeRepository | RemoteLifeRepository>(
    () => repository ?? (isLocalDemoMode ? new LifeRepository({ storage: window.localStorage }) : new RemoteLifeRepository()),
  )

  useEffect(() => {
    if (!(value instanceof LifeRepository) || repository) return
    const synchronize = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage && event.key === value.storageKey) {
        value.refreshFromStorage()
      }
    }
    window.addEventListener('storage', synchronize)
    return () => window.removeEventListener('storage', synchronize)
  }, [repository, value])

  useEffect(() => {
    if (!(value instanceof RemoteLifeRepository)) return
    if (auth.status !== 'authenticated') {
      value.reset()
      setStatus({ status: auth.status === 'loading' ? 'loading' : 'idle' })
      return
    }
    let active = true
    setStatus({ status: 'loading' })
    value.refresh().then(
      () => { if (active) setStatus({ status: 'ready' }) },
      (error: unknown) => { if (active) setStatus({ status: 'error', error: error instanceof Error ? error.message : '数据加载失败' }) },
    )
    return () => { active = false }
  }, [auth.status, value])

  return <RepositoryContext.Provider value={value}><DataStatusContext.Provider value={status}>{children}</DataStatusContext.Provider></RepositoryContext.Provider>
}

export function useLifeRepository() {
  const repository = useContext(RepositoryContext)
  if (!repository) throw new Error('useLifeRepository 必须在 LifeDataProvider 内使用')
  return repository
}

export function useLifeState() {
  const repository = useLifeRepository()
  return useSyncExternalStore(repository.subscribe, repository.getSnapshot, repository.getSnapshot)
}

export const useLifeDataStatus = () => useContext(DataStatusContext)
