import { Fragment, type FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { hasLocalPreviewSession, LOCAL_SESSION_KEY, useAuth } from '../../state/AuthContext'
import type { LoginScenePhase } from '../../motion/loginScene'

export { LOCAL_SESSION_KEY, hasLocalPreviewSession }

interface LoginWindowProps {
  open: boolean
  onClose: () => void
  onAuthenticated: () => void
  onSceneStateChange?: (phase: Extract<LoginScenePhase, 'open' | 'authenticating' | 'entering'>) => void
}

export function LoginWindow({ open, onClose, onAuthenticated, onSceneStateChange }: LoginWindowProps) {
  const auth = useAuth()
  const [status, setStatus] = useState('使用你的 LifeOps 账号进入私人空间。')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [statusKind, setStatusKind] = useState<'idle' | 'progress' | 'success' | 'error'>('idle')
  const accountRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const attemptRef = useRef(0)
  const submittingRef = useRef(false)
  const openRef = useRef(open)

  openRef.current = open

  useLayoutEffect(() => {
    if (!open) return
    accountRef.current?.focus()
    onSceneStateChange?.('open')
  }, [onSceneStateChange, open])

  const requestClose = () => {
    attemptRef.current += 1
    submittingRef.current = false
    setSubmitting(false)
    onClose()
  }

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('keydown', close)
    }
  }, [open])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const account = String(form.get('account') ?? '').trim()
    const password = String(form.get('password') ?? '')
    if (submittingRef.current) return
    if (!account || !password) {
      setStatus('请输入账号和密码。')
      setStatusKind('error')
      return
    }
    const attempt = ++attemptRef.current
    submittingRef.current = true
    setSubmitting(true)
    setStatus('正在穿过身份边界…')
    setStatusKind('progress')
    onSceneStateChange?.('authenticating')
    try {
      await auth.login(account, password)
      if (attemptRef.current !== attempt || !openRef.current) {
        await auth.logout?.()
        return
      }
      setStatus('身份已确认，正在进入你的今日工作台。')
      setStatusKind('success')
      onSceneStateChange?.('entering')
      onAuthenticated()
    } catch (error) {
      if (attemptRef.current !== attempt || !openRef.current) return
      const message = error instanceof Error ? error.message : ''
      const transportFailure = error instanceof TypeError
        || /failed to fetch|networkerror|load failed/i.test(message)
      setStatus(
        transportFailure
          ? '网络暂时不可用，请检查连接后重试。'
          : message || '登录失败，请稍后重试。',
      )
      setStatusKind('error')
      onSceneStateChange?.('open')
    } finally {
      if (attemptRef.current === attempt) {
        submittingRef.current = false
        setSubmitting(false)
      }
    }
  }

  return (
    <Fragment>
      <div
        aria-hidden="true"
        className="login-backdrop"
        data-login-backdrop
        data-open={open ? 'true' : 'false'}
        onClick={requestClose}
      />
      <aside
        aria-hidden={!open}
        aria-label="LifeOps 登录窗口"
        aria-modal={open || undefined}
        className="login-window"
        data-desktop-width="460"
        data-login-task-layer
        data-mobile-presentation="fullscreen"
        data-one-viewport="true"
        data-theme-surface="adaptive"
        data-viewport-safe-inset="16"
        data-wide-ring-diameter="520"
        data-status={statusKind}
        id="login-window"
        ref={dialogRef}
        role="dialog"
      >
        <div className="login-window__heading">
          <span aria-hidden="true" className="login-window__continuity-mark" />
          <button className="icon-button" type="button" onClick={requestClose} aria-label="关闭登录窗口">×</button>
        </div>
        <h2>欢迎回来</h2>
        <p>从此刻的生活星盘，进入你的私人日光画布。</p>
        <form noValidate onSubmit={submit}>
          <label htmlFor="login-account">账号</label>
          <input ref={accountRef} id="login-account" name="account" autoComplete="username" placeholder="name@example.com" required disabled={submitting} />
          <label htmlFor="login-password">密码</label>
          <div className="login-window__password">
            <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="输入密码" required disabled={submitting} />
            <button
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              disabled={submitting}
              onClick={() => setShowPassword((current) => !current)}
              type="button"
            >
              {showPassword ? '隐藏' : '显示'}
            </button>
          </div>
          <div className="login-window__meta">
            <span>会话由服务端安全保管</span>
            <button type="button" onClick={() => {
              setStatus('账号找回入口将在邮件服务接入后开放。')
              setStatusKind('idle')
            }}>忘记密码</button>
          </div>
          <button className="login-submit" type="submit" disabled={submitting}><span>{submitting ? '正在确认身份' : '进入 LifeOps'}</span><span aria-hidden="true">→</span></button>
          <p className="login-status" role={statusKind === 'error' ? 'alert' : 'status'}>{status}</p>
        </form>
      </aside>
    </Fragment>
  )
}
