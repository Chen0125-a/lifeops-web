# LifeOps 用户自助部署检查清单

本清单面向陌生的本地 VM、裸金属或云上 Kubernetes 集群。它先识别平台能力，再选择 LifeOps 参数。所有 `kubectl`、Helm、Argo CD 和集群 smoke 命令均由拥有该集群权限的用户在自己的终端执行；LifeOps Web 项目交付者不读取 kubeconfig，也不替用户变更集群。

命令元数据图例：`Run from:` 表示执行位置，`Expected:` 表示预期结果，`Failure means:` 表示失败含义，`Safe fallback:` 表示安全回退。下文每组命令都必须给出这四项信息。

## 1. 术语、镜像与架构

LifeOps 只构建两个自有镜像：

- `lifeops-web`：React 静态产物，镜像内的 Nginx 只提供静态页面、SPA 回退和本地健康检查。
- `lifeops-api`：Fastify API；Argo `PreSync` migration Job 复用同一镜像并执行 `node dist/migrate-main.js`，避免第三个迁移镜像产生版本漂移。
- `mysql:8.4.10`：官方 MySQL 镜像，不是 LifeOps 自建镜像。

```text
Internet/LAN -> external LB or MetalLB -> Gateway controller -> HTTPRoute/Ingress
                                                    |-- /api -> API Service -> API pods -> MySQL
                                                    `-- /    -> Web Service -> Web pods
Argo CD or Helm -> migration Job (API image) -> Deployments/StatefulSet
API media -> RWX filesystem or S3-compatible object storage
```

Gateway API 是 Kubernetes 路由规范；Envoy Gateway、NGINX Gateway Fabric 是集群里独立安装的 controller；Web 镜像里的 Nginx 不是 Gateway controller。当前应用没有 Redis：会话、幂等和核心状态由 MySQL 持久化。只有出现有证据的缓存、跨副本短期状态、队列或分布式限流需求，并完成 ADR、一致性、故障和回退设计后才引入 Redis。

内置 MySQL 是单副本 StatefulSet，不是高可用数据库。它适用于本地、小规模或明确接受单点风险的环境；生产优先选择外部托管 RDS、独立 VM MySQL 或成熟的 HA/Operator MySQL。

## 2. 集群能力矩阵与选择决策树

先填写矩阵，未知项不得猜测：

| 能力 | 只读检查 | 满足时 | 不满足时 |
| --- | --- | --- | --- |
| Kubernetes/CPU | `kubectl version`、`kubectl get nodes` | 继续核对镜像架构 | 先升级平台或构建受支持架构 |
| Gateway API | `kubectl api-resources` | Envoy Gateway/NGINX Gateway Fabric 分支 | 使用真实 Ingress 分支 |
| 外部入口 | Service `LoadBalancer`/MetalLB/外部 LB | 分配入口地址 | 先由平台团队提供入口 |
| 动态存储 | `kubectl get storageclass` | PVC 可动态供给 | 指定已创建 PVC 或补平台能力 |
| RWX | StorageClass/CSI 文档 | 多副本 filesystem | 改用 S3；仅小规模才降为单副本 API+RWO |
| Secret 管理 | Secret/ExternalSecret CRD | 选择一种 | 先建立安全的 Secret 交付流程 |
| 监控 | ServiceMonitor/PrometheusRule CRD | 启用 monitoring | 保持 disabled，不伪造指标 |
| 私有仓库 | 节点可访问 UHub | 创建 imagePullSecret | 先修复 DNS/防火墙/仓库授权 |

决策顺序：数据库 → 媒体 → 入口 controller → DNS/TLS → 监控 → 部署工具。不要先执行 Helm，再补关键平台能力。

### 用户只读预检命令

执行位置：有目标集群 kubeconfig 的用户管理机；任意不含项目凭据的目录。
预期结果：版本、节点架构、CRD、StorageClass、入口和监控能力都可被读取。
失败含义：当前身份不足或平台能力尚未安装，LifeOps 参数无法安全选择。
安全回退：停止应用部署，保存脱敏后的能力矩阵，交由平台管理员补齐；不要赋予 LifeOps 管理员权限。

```powershell
kubectl version
kubectl get nodes -o wide
kubectl api-resources | Select-String 'gateway|httproute|ingress|externalsecret|servicemonitor|prometheusrule'
kubectl get storageclass
kubectl get gatewayclass,gateway -A
kubectl get service -A --field-selector spec.type=LoadBalancer
```

## 3. 平台前置条件

- 用户已确认集群版本、节点 CPU 架构、时钟和 DNS 正常。
- UHub 域名能从所有候选节点解析并访问；镜像拉取授权由用户管理。
- 入口 controller、LoadBalancer/MetalLB/外部 LB、DNS 和 TLS 的责任人明确。
- 数据库、媒体存储和备份目标在部署前确定。
- 命名空间、hostname、StorageClass、Secret 名、Gateway parentRef/namespace 都由用户确认。
- 监控组件不存在时，`monitoring.enabled=false`；平台集成保持 `disabled` 或 `unverified`，不能写成 connected。

## 4. imagePullSecret、应用/数据库 Secret 与 ExternalSecret

推荐 External Secrets Operator：`templates/external-secret.yaml` 把外部密钥管理器引用转换为现有 Secret 名。没有 ESO 时，用户可从自己机器上的私有、权限受限、未纳入 Git 的 env 文件创建应用 Secret，并从仓库外的 Docker config JSON 导入 `imagePullSecret`。不要把明文写进 values、命令参数、命令历史、聊天或证据。

执行位置：用户管理机；仓库根目录；`<PRIVATE_ENV_FILE>` 和 `<PRIVATE_DOCKER_CONFIG_JSON>` 均位于仓库外并限制文件权限。
预期结果：命名空间中只出现 Secret 名和键名；终端不打印 Secret 数据。
失败含义：文件格式、RBAC 或 Secret 名不匹配。
安全回退：删除本次未被工作负载引用的错误 Secret，修正私有文件；绝不提交该文件。

```powershell
kubectl create namespace <NAMESPACE> --dry-run=client -o yaml | kubectl apply -f -
kubectl -n <NAMESPACE> create secret generic <IMAGE_PULL_SECRET> --from-file=.dockerconfigjson=<PRIVATE_DOCKER_CONFIG_JSON> --type=kubernetes.io/dockerconfigjson
kubectl -n <NAMESPACE> create secret generic <APP_SECRET_NAME> --from-env-file=<PRIVATE_ENV_FILE>
kubectl -n <NAMESPACE> get secret <IMAGE_PULL_SECRET>,<APP_SECRET_NAME> -o name
```

`values.yaml` 对应项：`imagePullSecrets`、`api.existingSecret`、`mysql.auth.existingSecret`、`externalDatabase.existingSecret`、`media.s3.existingSecret`、`externalSecret.*`。生产 schema 拒绝非空 `secrets.data.*`。

## 5. MySQL、媒体存储、入口控制器选择分支

### MySQL 选择分支

| 分支 | 适用范围 | Secret/TLS 与网络 | 备份、升级、故障边界 | 迁出路线 |
| --- | --- | --- | --- | --- |
| 内置 MySQL 8.4.10 | 本地/小规模/风险接受 | `mysql.enabled=true`，RWO PVC，仅 API/migration 可访问 3306 | 单副本；先验证逻辑备份与恢复；升级需维护窗口 | 备份、在外部实例恢复、切换 `mysql.enabled=false` 与 `externalDatabase.*`、重跑只读/写入 smoke |
| 托管 RDS | 有云数据库能力的生产 | `mysql.enabled=false`，Secret 引用，强制 TLS/安全组/私网 | 使用平台备份/PITR/维护窗口；故障域由服务 SLA 定义 | 先建库和最小权限账号，恢复数据，校验连接数与 schema checksum 后切换 |
| 独立 VM MySQL | 本地虚拟化/传统基础设施 | MySQL 装在独立数据库 VM，不装在 K8s worker；TLS、防火墙只放行 API/migration | 用户负责备份、复制、补丁和磁盘监控；VM 是独立故障边界 | 与 RDS 相同，先恢复再切连接；保留旧库只读观察窗口 |
| HA/Operator MySQL | 有成熟 DB 运维能力 | 由 Operator/HA 平台提供 Service、证书和 Secret | 按 Operator 文档验证仲裁、备份恢复、滚动升级 | 使用平台复制/恢复能力；在切换前验证主从/连接池和 failover |

每个分支先算连接预算：`API maximum database connections = API maximum replicas × per-replica connection limit + migration/admin headroom`。默认 HPA 最大 6、副本连接上限 10 时，应用部分最多 60，再加 migration/admin 余量；数据库上限必须高于该值并保留运维空间。

### 媒体存储选择分支

- 多副本 API + filesystem：`media.backend=filesystem`，PVC 必须是 ReadWriteMany；常见后端为 NFS/CephFS。
- 没有 RWX：优先 `media.backend=s3`，配置兼容 S3 endpoint/region/bucket 与 Secret 引用。
- 单副本 API + RWO：只用于本地/小规模且明确接受单点、维护和扩容限制的环境；`api.replicaCount=1` 且关闭/约束 HPA。
- 不得绕过 chart 对“多副本 API + 非 RWX filesystem”的拒绝。

对应资产：`templates/media-pvc.yaml`、`templates/api-deployment.yaml`、`values.schema.json`、`scripts/validate-media-topology.ps1`。

### 入口控制器选择分支

- 推荐：Gateway API + Envoy Gateway。设置 `httpRoute.enabled=true`、`parentRefs[].name/namespace` 和 hostname。
- NGINX Gateway Fabric：保留同一 Web/API 镜像，修改 GatewayClass/controller、parentRef、namespace、策略、NetworkPolicy gateway namespace 和 values。
- Gateway API 不可用：`httpRoute.enabled=false`、`ingress.enabled=true`，设置真实 `ingress.className`、hosts、TLS Secret 和与 controller 一致的 annotations。

`LoadBalancer` 暴露 controller Service；MetalLB 为裸金属分配地址；外部 LB 把流量送到 controller；DNS 把 hostname 指向入口地址；TLS controller/证书系统终止 HTTPS。它们不是同一组件。

对应资产：`templates/httproute.yaml`、`templates/ingress.yaml`、`templates/networkpolicy.yaml`、`values.schema.json`。

## 6. 填入 Web/API 不可变 digest

正式 `1.0.0` 释放值：

- Web：`sha256:31d13ed140d0f3343bbef40355e736ce8d63298ffa3c3efb97f27659fb9fa4af`
- API：`sha256:c70d0b33612e36c171c4085639e8cf7d558abdbd37b780fb0bd651a4e7c9c5e3`
- 源 revision：`64cb76932def9eed94cb43aea104c97eb19f1382`

以 `outputs/final/release-manifest.json` 为机器可读权威，并确认 `deploy/gitops/environments/production/values.yaml` 完全一致。tag、本地 image ID 或手写伪 digest 不能替代。

## 7. Helm 离线预检

执行位置：用户管理机；已检出的 LifeOps 仓库根目录。
预期结果：测试输出 `deployment-package-contract: ok`，正式验证输出 `deployment-package-validation: ok`。
失败含义：release manifest、digest、schema、chart、安全、媒体拓扑或手册合同不一致。
安全回退：不连接集群；修正本地 values 或选择分支后重跑，禁止跳过失败检查。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-deployment-package.test.ps1 -HelmExecutable <HELM_EXECUTABLE>
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-deployment-package.ps1 -ReleaseManifest outputs/final/release-manifest.json -ValuesFile deploy/gitops/environments/production/values.yaml -HelmExecutable <HELM_EXECUTABLE>
```

映射资源：`templates/deployment.yaml`、`templates/api-deployment.yaml`、`templates/service.yaml`、`templates/api-service.yaml`、`templates/mysql-statefulset.yaml`、`templates/migration-job.yaml`、`templates/media-pvc.yaml`、`templates/networkpolicy.yaml`、`templates/pdb.yaml`、`templates/hpa.yaml`、`templates/external-secret.yaml`、`values.schema.json`。

## 8. 用户通过 Argo CD 或 Helm 部署

Argo CD 是推荐路径。先复制 `deploy/argocd/application.example.yaml` 到用户自己的受控 GitOps 配置，填入 `<NAMESPACE>`、目标 revision 和 values 路径，再由用户应用。示例中的 automated sync 是策略选择；若平台要求人工批准，应关闭自动 sync。

执行位置：用户管理机；用户自己的 GitOps 仓库或 LifeOps 仓库根目录。
预期结果：Argo Application 被接受，或 Helm 仅渲染/升级指定 release；资源均位于 `<NAMESPACE>`。
失败含义：CRD、Secret、StorageClass、Gateway parentRef、schema 或权限不满足。
安全回退：首次安装失败时保持 release 未就绪，修复平台前置条件；已有版本升级失败时按回滚手册评估 migration 兼容性后回到旧 digest。

```powershell
kubectl apply -f <USER_REVIEWED_ARGO_APPLICATION_FILE>
helm upgrade --install <RELEASE_NAME> deploy/helm/lifeops-web --namespace <NAMESPACE> --create-namespace --values <USER_VALUES_FILE> --wait --timeout <TIMEOUT>
```

## 9. migration Job、Web/API/MySQL 工作负载顺序

1. Secret/ExternalSecret、ConfigMap、PVC/外部数据库网络已就绪。
2. 可选内置 MySQL StatefulSet ready；外部数据库通过用户侧连接预检。
3. `templates/migration-job.yaml` 使用 API digest，Argo `PreSync` wave `-10`，前向迁移成功后才继续。
4. `templates/deployment.yaml` 与 `templates/api-deployment.yaml` rollout；Service、PDB、HPA、NetworkPolicy 同步。
5. HTTPRoute/Ingress、DNS、TLS 最后对外验收。

执行位置：用户管理机；任意安全目录。
预期结果：migration Job `Complete`；Web/API ready；可选 MySQL ready；事件无持续拉取/挂载/探针错误。
失败含义：数据库权限/schema drift、镜像拉取、Secret 键、PVC 或探针失败。
安全回退：停止继续 rollout；不要执行 down migration；保留 Job 日志的脱敏摘要并按故障类型修复。

```powershell
kubectl -n <NAMESPACE> get job,pod,deploy,statefulset,service,pvc
kubectl -n <NAMESPACE> wait --for=condition=complete job/<MIGRATION_JOB> --timeout=<TIMEOUT>
kubectl -n <NAMESPACE> rollout status deployment/<WEB_DEPLOYMENT> --timeout=<TIMEOUT>
kubectl -n <NAMESPACE> rollout status deployment/<API_DEPLOYMENT> --timeout=<TIMEOUT>
```

## 10. HTTPRoute/Ingress、DNS、TLS

执行位置：用户管理机；任意安全目录。
预期结果：HTTPRoute/Ingress Accepted，入口地址存在，DNS 解析到该地址，TLS 证书覆盖 `<HOSTNAME>`。
失败含义：parentRef/controller/className、LB 地址、DNS 或证书签发不一致。
安全回退：保留内部 Service 可用性，暂停公开 DNS 切换；修复入口后再开放流量。

```powershell
kubectl -n <NAMESPACE> get httproute,ingress,service
kubectl -n <NAMESPACE> describe httproute/<HTTP_ROUTE_NAME>
Resolve-DnsName <HOSTNAME>
curl.exe --fail --show-error --head https://<HOSTNAME>/healthz
```

## 11. 健康、登录、写入、重启、exact-digest 应用验收 smoke

先由用户通过只读工作负载查询取得实际 Web/API imageID 和 revision；将观察值与 release manifest 比较，再运行应用级 smoke。脚本只创建唯一 `lifeops-smoke-*` 应用记录，并通过应用 API 删除/补偿；它不会删除 Pod、PVC、Namespace 或用户数据。

执行位置：用户管理机；LifeOps 仓库根目录；使用只在当前进程存在的 `PSCredential`。
预期结果：输出 `post-deploy-smoke: ok`，报告包含 health/auth/persistence/exactly-once/bounded-cleanup 且不含凭据。重启一个 API pod 后由用户再次运行，结果仍应相同。
失败含义：实际 digest/revision、健康、认证、写入回读、幂等或清理边界不满足。
安全回退：停止流量扩大；保留 smoke 前缀，按应用 API 清理；不要用集群级删除代替清理。

```powershell
$credential = Get-Credential
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/post-deploy-smoke.ps1 -BaseUrl https://<HOSTNAME> -ExpectedWebDigest <EXPECTED_WEB_DIGEST> -ExpectedApiDigest <EXPECTED_API_DIGEST> -ExpectedRevision <EXPECTED_REVISION> -ObservedWebDigest <OBSERVED_WEB_DIGEST> -ObservedApiDigest <OBSERVED_API_DIGEST> -ObservedRevision <OBSERVED_REVISION> -Credential $credential -ReportPath <SANITIZED_REPORT_PATH>
```

## 12. 监控、日志、告警与备份恢复

- `templates/servicemonitor.yaml` 抓取内部 metrics Service；`/metrics` 不应出现在 HTTPRoute/Ingress。
- `templates/prometheusrule.yaml` 提供可用性、5xx、P95、重启和 readiness 告警。
- `templates/grafana-dashboard.yaml` 提供应用与工作负载视图。
- Elasticsearch/Kibana 检查 request ID；平台未配置时保持 `disabled/degraded/unverified`。
- 数据库和媒体必须有同一恢复点语义；恢复演练先在隔离环境验证，再进入生产维护窗口。

对应操作说明见 `docs/runbooks/observability.md` 与 `docs/runbooks/deploy-rollback.md`。

## 13. 升级、回滚与故障排查

升级前完成用户拥有的数据库和媒体备份、恢复验证、digest 差异评审和容量检查。迁移只向前；回滚应用 digest 前先确认旧 API 能读取新 schema。具体步骤、停止条件和安全回退见 `docs/runbooks/deploy-rollback.md`。

## 14. 水平/垂直扩容与组件迁移

- Web：先看 CPU、内存、入口延迟和缓存命中；静态流量增大时水平扩 pod，单 pod CPU/内存饱和时再垂直调整 requests/limits。
- API：默认 HPA min 2/max 6。CPU 不是唯一信号；同时看 P95、5xx、active requests、MySQL 连接、慢查询和媒体吞吐。
- PDB、podAntiAffinity、topologySpread 只能在节点容量足够时发挥作用；扩 pod 前确认调度余量。
- Gateway controller/LB 也要扩容；应用 pod 增加不能解决入口瓶颈。
- 数据库：先优化慢查询/索引和连接池；连接、CPU、IO 或存储成为瓶颈时扩数据库，而不是无限增加 API pod。
- filesystem → S3：当 RWX 吞吐、扩容或跨故障域成为限制时，先迁移对象并校验 checksum，再切 `media.backend`；保留只读回退窗口。
- 内置 MySQL → 外部 HA：当单点风险、备份 RTO/RPO、连接或 IO 超出边界时，按第 5 节迁出路线执行。

扩容后重复登录、记录写入/回读、Life exactly-once、媒体读写、migration no-op 和 exact-digest smoke，确认会话、幂等、媒体和迁移安全未退化。不要编造统一硬件规格或固定 QPS；以测量值和容量余量决定。
