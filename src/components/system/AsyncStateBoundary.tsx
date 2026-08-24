import type { PropsWithChildren, ReactNode } from 'react'

export type AsyncState =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'saving'
  | 'saved'
  | 'forbidden'
  | 'network-error'
  | 'conflict'
  | 'deleted'
  | 'disconnected'

interface AsyncStateBoundaryProps extends PropsWithChildren {
  state: AsyncState
  onRetry?: () => void
}

const statusLabels = {
  loading: '正在加载',
  empty: '暂无内容',
  disconnected: '服务未连接',
} as const

const alertLabels = {
  forbidden: '无权访问此内容',
  deleted: '内容已删除',
  'network-error': '网络连接失败',
  conflict: '内容已在其他位置更新',
} as const

function Status({ label }: { label: string }) {
  return <p role="status" aria-label={label}>{label}</p>
}

function Failure({ state, onRetry }: {
  state: keyof typeof alertLabels
  onRetry?: () => void
}) {
  const action = state === 'network-error'
    ? '重试'
    : state === 'conflict'
      ? '重新加载'
      : undefined

  return (
    <div role="alert">
      <p>{alertLabels[state]}</p>
      {action && onRetry ? <button type="button" onClick={onRetry}>{action}</button> : null}
    </div>
  )
}

function stateContent(
  state: AsyncState,
  children: ReactNode,
  onRetry?: () => void,
) {
  if (state === 'ready') return children
  if (state === 'saving') return <>{children}<Status label="正在保存" /></>
  if (state === 'saved') return <>{children}<Status label="已保存" /></>
  if (state in statusLabels) {
    return <Status label={statusLabels[state as keyof typeof statusLabels]} />
  }
  return <Failure state={state as keyof typeof alertLabels} onRetry={onRetry} />
}

export function AsyncStateBoundary({ state, onRetry, children }: AsyncStateBoundaryProps) {
  return (
    <div
      className="async-state-boundary"
      data-testid="async-state-boundary"
      data-state={state}
      aria-busy={state === 'loading' || state === 'saving' ? true : undefined}
    >
      {stateContent(state, children, onRetry)}
    </div>
  )
}
