import type { SettingsDocument } from '../../domain/settings'

const stateLabel = { connected: '已连接', degraded: '待确认', disabled: '未启用', 'local-only': '本地授权' } as const

export function PlatformConnections({ connections }: { connections: SettingsDocument['connections'] }) {
  return <section className="settings-section" aria-labelledby="settings-connections-title">
    <header><p>Connections</p><h2 id="settings-connections-title">平台连接</h2><span>这里只显示安全状态摘要；连接地址、认证值、浏览器会话信息和证书内容永不回显。</span></header>
    <ul className="settings-connection-list">{connections.map((connection) => <li key={connection.id}><div><strong>{connection.label}</strong><span>{connection.detail}</span></div><span data-state={connection.state}>{stateLabel[connection.state]}</span></li>)}</ul>
  </section>
}
