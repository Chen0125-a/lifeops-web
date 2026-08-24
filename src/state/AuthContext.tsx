import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { isLocalDemoMode, lifeApi, type AuthUser } from '../api/lifeApi'

export const LOCAL_SESSION_KEY = 'lifeops:session:v1'

type AuthStatus = 'loading' | 'anonymous' | 'authenticated'
interface AuthContextValue {
  status: AuthStatus
  user?: AuthUser
  csrfToken?: string
  error?: string
  login: (account: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

function readDemoUser(): AuthUser | undefined {
  try {
    const raw = sessionStorage.getItem(LOCAL_SESSION_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as { mode?: string; account?: string }
    return parsed.mode === 'local-preview' && parsed.account ? { id: 'local-preview', account: parsed.account, displayName: 'Local Preview' } : undefined
  } catch { return undefined }
}

async function defaultLogin(account: string, password: string) {
  if (isLocalDemoMode) {
    if (!account.trim() || !password) throw new Error('请输入账号和密码。')
    sessionStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ mode: 'local-preview', account: account.trim(), createdAt: new Date().toISOString() }))
    return
  }
  await lifeApi.login(account, password)
}

const defaultValue: AuthContextValue = {
  status: isLocalDemoMode && readDemoUser() ? 'authenticated' : 'anonymous',
  user: isLocalDemoMode ? readDemoUser() : undefined,
  login: defaultLogin,
  logout: async () => { if (isLocalDemoMode) sessionStorage.removeItem(LOCAL_SESSION_KEY); else await lifeApi.logout() },
  refresh: async () => undefined,
}

const AuthContext = createContext<AuthContextValue>(defaultValue)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser>()
  const [csrfToken, setCsrfToken] = useState<string>()
  const [error, setError] = useState<string>()

  const refresh = async () => {
    try {
      const session = isLocalDemoMode ? undefined : await lifeApi.session()
      const next = isLocalDemoMode ? readDemoUser() : session?.user
      setUser(next)
      setCsrfToken(session?.csrfToken)
      setStatus(next ? 'authenticated' : 'anonymous')
      setError(undefined)
    } catch {
      setUser(undefined)
      setCsrfToken(undefined)
      setStatus('anonymous')
    }
  }

  useEffect(() => { void refresh() }, [])

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    csrfToken,
    error,
    refresh,
    login: async (account, password) => {
      setError(undefined)
      await defaultLogin(account, password)
      const session = isLocalDemoMode ? undefined : await lifeApi.session()
      const next = isLocalDemoMode ? readDemoUser() : session?.user
      setUser(next)
      setCsrfToken(session?.csrfToken)
      setStatus('authenticated')
    },
    logout: async () => {
      if (isLocalDemoMode) sessionStorage.removeItem(LOCAL_SESSION_KEY)
      else await lifeApi.logout()
      setUser(undefined)
      setCsrfToken(undefined)
      setStatus('anonymous')
    },
  }), [csrfToken, error, status, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
export const hasLocalPreviewSession = () => Boolean(readDemoUser())
