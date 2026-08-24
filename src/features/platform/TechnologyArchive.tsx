import type { TechnologyEntry } from '../../domain/platform'

const statusLabel: Record<string, string> = {
  implemented: '已实现',
  'delivery-pending': '交付待完成',
  'user-operated': '用户运维',
  'configured-mainline': '已配置主线',
  'integration-optional': '可选连接',
  'later-learning-track': '后续学习轨',
  'current-image-mainline': '当前镜像主线',
  optional: '可选',
}

export function TechnologyArchive({ technologies }: { technologies: TechnologyEntry[] }) {
  return (
    <section className="platform-technology" role="region" aria-label="技术档案">
      <header><p>Technology archive</p><h2>实现、交付与学习轨彼此分开</h2></header>
      <table><thead><tr><th scope="col">技术</th><th scope="col">在 LifeOps 中的角色</th><th scope="col">当前事实</th></tr></thead>
        <tbody>{technologies.map((item) => <tr key={item.name}><th scope="row">{item.name}</th><td>{item.role}</td><td>{statusLabel[item.status] ?? item.status}</td></tr>)}</tbody>
      </table>
    </section>
  )
}
