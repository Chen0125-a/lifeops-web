import type { KubernetesSummary } from '../../domain/platform'

export function ServiceTopology({ summary }: { summary: KubernetesSummary | null }) {
  if (!summary) return <p className="platform-empty">Kubernetes 未连接或暂时不可用；这里不生成工作负载数据。</p>
  return (
    <div className="platform-topology__canvas">
      <div className="platform-topology__core"><span>LifeOps</span><strong>Web · API · MySQL</strong></div>
      <div className="platform-topology__rail" aria-label="节点状态">
        {summary.nodes.map((node) => <span key={node.name} data-state={node.ready ? 'connected' : 'degraded'}><i aria-hidden="true" />{node.name}<small>{node.ready ? 'Ready' : node.reason || 'NotReady'}</small></span>)}
      </div>
      <div className="platform-topology__workloads" aria-label="工作负载状态">
        {summary.workloads.map((workload) => <span key={`${workload.namespace}/${workload.name}`}><strong>{workload.name}</strong><small>{workload.ready}/{workload.desired} ready</small></span>)}
      </div>
      <p>{summary.pods.ready}/{summary.pods.total} Pods Ready · {summary.pods.restarts} restarts</p>
    </div>
  )
}
