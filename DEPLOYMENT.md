# LifeOps V1 部署入口

本文是 LifeOps Web 交付包的正式入口。完整、按步骤执行的陌生集群手册位于 [用户自助部署检查清单](docs/runbooks/user-deployment-checklist.md)；本文固定发布身份、组件边界和阅读顺序，不复制第二套容易漂移的部署命令。

## 已验证发布身份

| 项目 | 已验证值 |
| --- | --- |
| 版本 | `1.0.0` |
| 应用源码 revision | `64cb76932def9eed94cb43aea104c97eb19f1382` |
| ordinary CI | GitHub Actions run `33285063683`，`success` |
| release | GitHub Actions run `33286877080`，`success` |
| GitOps digest-only commit | `03d812339cb42bfb3633ad613b4dd55509fd0084` |
| Web | `uhub.service.ucloud.cn/chenucloud/lifeops-web@sha256:31d13ed140d0f3343bbef40355e736ce8d63298ffa3c3efb97f27659fb9fa4af` |
| API / migration | `uhub.service.ucloud.cn/chenucloud/lifeops-api@sha256:c70d0b33612e36c171c4085639e8cf7d558abdbd37b780fb0bd651a4e7c9c5e3` |

Web 与 API 是项目仅有的两个自建镜像。Web 镜像用 Nginx 提供 React 静态产物；API 镜像运行 Fastify，同一 API 镜像以 `node dist/migrate-main.js` 复用于 PreSync migration Job。MySQL 使用官方 `mysql:8.4.10` 或外部 MySQL，不制作第三个项目镜像。两个 release digest 均有 digest-bound SBOM、provenance、registry inspect 和 exact-digest smoke 证据，见 [release manifest](outputs/final/release-manifest.json)。

## 部署责任边界

本仓库交付 Web/API 镜像、应用 schema、Helm/GitOps 资产、离线验证器和用户手册。Kubernetes 集群、Gateway controller、LoadBalancer、DNS、TLS、Secret 后端、StorageClass、数据库服务以及实际 Helm/Argo 操作由用户或平台团队负责。

LifeOps 项目完成不代表 `lifeops.chenspace.com` 已经可访问。本仓库没有读取 kubeconfig，也没有观察或声称 Argo `Synced/Healthy`、DNS/TLS 生效、Pod 运行或 cluster smoke 通过。

## 先选择平台分支

在自己的管理终端执行手册第 2 节只读预检，再按结果选择：

- 数据库：内置单实例 MySQL、托管 RDS、独立数据库 VM，或用户自管 HA/Operator MySQL；
- 媒体：多副本 API 使用 RWX filesystem 或 S3-compatible；没有 RWX 时优先 S3；
- 入口：推荐 Gateway API + Envoy Gateway，也支持 NGINX Gateway Fabric；Gateway API 不可用时使用 chart 的 Ingress 资产；
- Secret：已有 Kubernetes Secret 或 ExternalSecret；真实值不进入 Git、聊天或截图。

Gateway API 是 Kubernetes 路由规范，Envoy Gateway/NGINX Gateway Fabric 是集群中的 controller，Web 镜像内的 Nginx 只是静态文件服务器。更换 controller 只改 `parentRefs`、namespace、策略和 values，不重做应用镜像。

## 按此顺序执行

1. 阅读 [十四节部署清单](docs/runbooks/user-deployment-checklist.md) 的术语、能力矩阵和决策树。
2. 在用户管理机创建私有 `imagePullSecret` 和应用/数据库 Secret，或配置 ExternalSecret；不要把值提交到 Git。
3. 选择数据库、媒体和入口分支，并把真实 StorageClass、Gateway/Ingress、hostname 和 Secret 名写入用户私有 values。
4. 保持 production values 中 Web/API 为上表的不可变 digest；不要改成 tag、`latest` 或本地 image ID。
5. 从仓库根目录运行 `helm lint --strict`、render/schema 和 `scripts/validate-deployment-package.ps1` 离线预检。
6. 用户选择 Argo CD（推荐）或 Helm 执行应用部署；migration Job 必须先完成，之后 API/Web 才进入 ready。
7. 用户完成 HTTPRoute/Ingress、LoadBalancer、DNS 与 TLS，并执行健康、登录、写入、重启和 exact-digest 应用 smoke。
8. 上线前完成 [备份恢复](docs/runbooks/backup-restore.md)、[媒体存储](docs/runbooks/media-storage.md)、[可观测性](docs/runbooks/observability.md) 与 [升级回滚](docs/runbooks/deploy-rollback.md) 演练。

每条实际部署命令都应从手册中复制带占位符的版本，并在用户自己的授权终端替换。预期输出、失败含义和安全回退必须一起阅读；不要把凭据粘贴到聊天，也不要把明文 Secret 写入仓库。

## 运行时真值与限制

- API HPA 默认 `minReplicas: 2`、`maxReplicas: 6`；数据库连接预算至少为“API 最大副本数 × 每副本连接上限 + migration/admin 余量”。
- Chart 内置 MySQL 是单副本 StatefulSet + 10Gi RWO PVC，不是高可用数据库；生产优先选择已有的外部 HA 数据库能力。
- 多副本 API + filesystem 必须使用 RWX；chart 会拒绝多副本 API + 非 RWX filesystem，不能绕过。
- 当前没有 Redis。会话、幂等、登录失败计数和核心状态由 MySQL 持久化；只有出现经证据支持的缓存、队列、跨副本短期状态或分布式限流需求并完成 ADR 后才引入 Redis。
- Prometheus、Grafana、Alertmanager、Kubernetes、Elasticsearch、GitHub 和 Argo CD 集成默认 disabled；没有真实配置和连接证据时 UI 必须显示 disabled/degraded，不能伪造在线指标。
- Obsidian 文件系统访问只在用户明确授权后工作；首次扫描只读、写入先预览并备份。浏览器不支持 File System Access API 时仅提供 ZIP 预览，不声称已连接或已写回。
- V1 没有自助注册、找回密码、MFA 或数据库级 HA；药品模块只保存用户事实、计划与历史，不提供诊断或用药建议。

## 用户的下一动作

在拥有目标集群只读权限的管理机上打开 [用户自助部署检查清单](docs/runbooks/user-deployment-checklist.md)，从第 2 节 capability-first 预检开始。预检结果决定数据库、媒体和入口分支；在这些事实明确前不要执行 Helm install 或 Argo sync。
