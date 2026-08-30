# LifeOps 可观测性与事件处理手册

本文默认先只读。它不授权自动重启、扩容、回滚或其他集群变更；LifeOps 仓库维护者不会执行 `kubectl`、Argo sync/rollback 或 cluster smoke。用户平台团队在自己的授权终端完成实际操作。

## 已交付资产

- API 内部 `/metrics`，导出 `lifeops_http_requests_total`、`lifeops_http_request_duration_seconds`、`lifeops_http_active_requests`、`lifeops_build_info` 和默认 Node.js 指标；
- cluster-internal metrics Service 与 30 秒 ServiceMonitor；
- PrometheusRule：`LifeOpsUnavailable`、`LifeOpsHigh5xxRate`、`LifeOpsHighP95Latency`、`LifeOpsPodRestarting`、`LifeOpsReadinessFailing`；
- Grafana dashboard：可用性、请求率、5xx 比例、p50/p95、active requests、Pod CPU/内存/重启与 build revision；
- 结构化日志与 `requestId` 关联；请求体、Authorization、Cookie、Secret 和凭据不得进入日志。

这些资源只在 `monitoring.enabled: true` 且集群已有相应 CRD/controller 时产生作用。Chart 不安装 Prometheus Operator、Grafana 或告警通知基础设施，也不把 `/metrics` 暴露到公开 Gateway。

## 离线预检

**Run from:** 用户管理机的 LifeOps 仓库根目录；不需要 kubeconfig。

**Expected:** Helm render exit 0；observability validator 输出通过；渲染中含五条 alert、30 秒 ServiceMonitor 和 dashboard ConfigMap。

**Failure means:** CRD 开关、指标名、label、端口、alert 表达式或 dashboard 引用不一致，禁止上线监控资产。

**Safe fallback:** 保持 `monitoring.enabled: false` 或当前已验证版本；修复 chart 后重新离线验证，不把 metrics route 暴露公网补救。

```powershell
helm template <RELEASE_NAME> deploy/helm/lifeops-web --namespace <NAMESPACE> --values <USER_VALUES_FILE> | powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-observability.ps1 -FromStdin
```

## 平台前置条件

用户只读确认目标集群是否有 `ServiceMonitor`、`PrometheusRule` 和 Grafana sidecar 能力，并把真实 namespace/labels 写入私有 values。没有 CRD 时禁用对应资源或先由平台团队安装能力；不要让 Helm 渲染一个集群无法识别的 Kind。

`networkPolicy.enabled: true` 时，Prometheus namespace 与 pod labels 必须匹配 `networkPolicy.prometheus.*`，否则 scrape 会被拒绝。Gateway 不需要也不应访问 metrics Service。

## Inspect：发现

1. 记录 alert 名、namespace、release、开始时间、观察窗口和当前 immutable Web/API digest。
2. 在 LifeOps dashboard 查看 availability、request rate、5xx ratio、p50/p95、active requests、CPU/memory/restarts 和 build revision。
3. 用脱敏 `requestId` 关联结构化日志；不复制请求正文、Cookie、Authorization 或个人数据。
4. 核对流量是否非零，再解释错误率；零请求时不要把比例误判为恢复。

**Run from:** 用户监控控制面或只读管理机。

**Expected:** alert 标签能唯一定位 release/namespace，dashboard 指标名与 API 导出一致，日志只含脱敏字段。

**Failure means:** 采集、label、时间范围或日志关联不可信，暂不能判断应用故障。

**Safe fallback:** 保留原始时间戳和 alert 状态，转向 readiness、Pod restart 和应用 smoke 等第二信号；不猜测在线状态。

## Confirm：交叉确认

- `LifeOpsUnavailable` / `LifeOpsReadinessFailing`：对比 probe、`up`、ready replicas、migration 状态和数据库连通性；
- `LifeOpsHigh5xxRate`：确认请求量非零，再按 route/status class 与脱敏 request ID 定位；
- `LifeOpsHighP95Latency`：对比 API CPU/内存、active requests、数据库连接/慢查询和媒体延迟；
- `LifeOpsPodRestarting`：检查退出原因、OOM、探针和节点事件，不先假设应用崩溃；
- 所有告警：确认 dashboard 观察到的 build revision/digest 与用户批准 release 一致。

至少两个独立信号一致后再升级事件。单个 dashboard 空白既可能是应用问题，也可能是 ServiceMonitor、NetworkPolicy 或 Prometheus 采集问题。

## Mitigate：缓解

只采取用户批准、可逆且与根因匹配的动作：暂停新应用发布、降低可选外部集成负载、进入维护状态、按连接预算调整 API 或数据库容量。增加 API Pod 不能修复数据库连接耗尽；扩大 HPA 之前先验证：

`API 最大数据库连接需求 = API 最大副本数 × 每副本连接上限 + migration/admin 余量`

禁止从本仓库自动重启 workload、同步 Argo、回滚 release、修改 NetworkPolicy 或公开 `/metrics`。需要应用回滚时先按 [升级回滚手册](deploy-rollback.md) 判断 schema 兼容性；需要数据恢复时按 [备份恢复手册](backup-restore.md)。

## Recover：恢复确认

恢复后至少持续一个 alert `for` 窗口确认：

- readiness/availability 稳定；
- 5xx ratio 与 p95 回到用户定义的正常基线；
- Pod restart 不再增长，build revision/digest 正确；
- 登录、写入、重载、媒体和 exact-digest 应用 smoke 通过；
- 告警自动解除，监控本身仍在采集。

记录 immutable digest、观察时间、聚合指标、脱敏 request ID、根因和已批准动作。只有在告警解除、用户体验恢复且没有保留含 Secret/隐私的证据后关闭事件。

## 平台集成真值

LifeOps UI 的 Prometheus、Grafana、Alertmanager、Kubernetes、Elasticsearch、GitHub 和 Argo CD 状态来自服务端 allowlist 配置。默认 production values 将这些集成设为 disabled；未配置、连接失败或部分失败时必须显示 disabled/degraded。不得用 dashboard 示例、测试 fixture 或旧截图声称真实平台已连接。
