import { useState } from 'react'
import type { AccountSession } from '../../domain/settings'

export function AccountSettings({ account, sessions, onChangePassword, onRevoke }: {
  account: string
  sessions: AccountSession[]
  onChangePassword: (input: { currentPassword: string; newPassword: string }) => Promise<void>
  onRevoke: (id: string) => Promise<void>
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [notice, setNotice] = useState<string>()
  return <section className="settings-section" aria-labelledby="settings-account-title">
    <header><p>Account</p><h2 id="settings-account-title">账户与会话</h2><span>{account} · 密码和会话操作都会写入不含秘密值的审计记录。</span></header>
    <form className="settings-form" onSubmit={(event) => { event.preventDefault(); setNotice('正在更新…'); void onChangePassword({ currentPassword, newPassword }).then(() => { setCurrentPassword(''); setNewPassword(''); setNotice('密码已更新，其他会话已撤销。') }, (error) => setNotice(error instanceof Error ? error.message : '密码更新失败')) }}>
      <label>当前密码<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
      <label>新密码<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} aria-describedby="password-policy" /></label>
      <p id="password-policy">至少 12 位，并包含大小写字母、数字和符号。</p>
      <button type="submit">更新密码</button>{notice ? <p role="status">{notice}</p> : null}
    </form>
    <div className="settings-session-list"><h3>活跃会话</h3><ul>{sessions.map((session) => <li key={session.id}><div><strong>{session.current ? '当前会话' : '其他会话'}</strong><span>创建 {new Date(session.createdAt).toLocaleString('zh-CN')} · 到期 {new Date(session.expiresAt).toLocaleString('zh-CN')}</span></div>{session.current ? <small>通过退出登录结束</small> : <button type="button" onClick={() => void onRevoke(session.id)}>撤销</button>}</li>)}</ul></div>
  </section>
}
