# LifeOps 媒体存储手册

LifeOps 的媒体元数据、owner 与引用关系保存在 MySQL，二进制内容由 filesystem 或 S3-compatible 后端保存。选择后端时先看 API 副本数和集群存储能力，不能用本地目录或错误的访问模式制造“看似可用”的多副本。

## 1. 决策表

| 条件 | 选择 | 说明 |
| --- | --- | --- |
| API 多副本且有 RWX | filesystem + RWX | 适合 NFS、CephFS 等所有 API Pod 可读写的共享卷 |
| API 多副本但没有 RWX | S3-compatible | 推荐分支；避免把媒体绑在单节点 RWO |
| 已有对象存储、跨集群或容量增长明显 | S3-compatible | 更适合独立扩展、版本与生命周期管理 |
| 本地/小规模且明确接受单副本风险 | 单 API 副本 + RWO | 有界例外；没有 API 高可用，PVC/节点是单点 |

Chart 会拒绝“多副本 API + filesystem + 非 RWX/无持久化”。不要关闭安全检查、伪造 `ReadWriteMany` 或把 `emptyDir` 当生产媒体盘。

## 2. RWX filesystem

真实 values 映射到 `media.backend`、`media.filesystem.root` 与 `media.filesystem.persistence.*`：

```yaml
api:
  replicaCount: 2
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 6

media:
  backend: filesystem
  filesystem:
    root: /var/lib/lifeops/media
    persistence:
      enabled: true
      existingClaim: ""
      storageClass: "<RWX_STORAGE_CLASS>"
      accessModes:
        - ReadWriteMany
      size: <MEDIA_CAPACITY>
```

**Run from:** 用户管理机的 LifeOps 仓库根目录，仅做离线检查。

**Expected:** Helm lint/render exit 0；PVC access mode 为 RWX；每个 API Pod 挂载同一 claim 与 root。

**Failure means:** StorageClass 不支持 RWX、claim 未绑定或 chart 安全拒绝，不能部署多副本 filesystem。

**Safe fallback:** 保持旧后端；改用 S3，或在明确风险接受后使用第 4 节单副本 RWO；不要改模板绕过。

```powershell
helm lint deploy/helm/lifeops-web --strict --values <USER_VALUES_FILE>
helm template <RELEASE_NAME> deploy/helm/lifeops-web --namespace <NAMESPACE> --values <USER_VALUES_FILE> > <RENDERED_REVIEW_FILE>
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-media-topology.ps1 -ManifestPath <RENDERED_REVIEW_FILE>
```

若使用 `existingClaim`，该 PVC 必须已存在于目标 namespace、可由 API security context 写入，且访问模式/容量由用户平台验证。LifeOps chart 不创建或管理底层 NFS/CephFS 服务。

## 3. S3-compatible

S3 适合没有 RWX、多集群或需要独立扩容的环境。凭据只来自既有 Secret 或 ExternalSecret；values 中不放 access key。

```yaml
media:
  backend: s3
  s3:
    endpoint: "https://<S3_ENDPOINT>"
    region: "<S3_REGION>"
    bucket: "<PRIVATE_BUCKET>"
    forcePathStyle: <TRUE_FOR_COMPATIBLE_STORAGE_OR_FALSE_FOR_PROVIDER>
    existingSecret: lifeops-secrets
    accessKeyIdKey: s3-access-key-id
    secretAccessKeyKey: s3-secret-access-key
```

ExternalSecret 可使用 chart 的 `externalSecret.remoteRefs.s3AccessKeyId` 和 `s3SecretAccessKey`。bucket 应私有，启用 TLS、服务端加密、最小权限、versioning/对象锁（平台支持时）、生命周期和访问日志。API 身份只需要目标 bucket/prefix 的必要读写权限，不需要管理账号。

若 `networkPolicy.enabled: true` 且对象存储在集群外，用户必须在 `networkPolicy.integrationEgress` 中加入经确认的 endpoint CIDR/port；不要为了省事设置任意互联网 egress。endpoint 使用域名时还要确认 DNS 解析与地址变化由平台策略正确处理。

**Run from:** 用户管理机和对象存储控制面。

**Expected:** 离线 render 不含明文凭据；目标 bucket/prefix 可读写；上传后跨 API Pod 读取一致；对象不公开。

**Failure means:** Secret、TLS、endpoint、区域、path-style、NetworkPolicy 或 bucket 权限不匹配。

**Safe fallback:** 保持旧 filesystem 只读并停止切换；修正 S3 配置后重新做双写/复制验证，不清理旧对象。

## 4. 单副本 API + RWO 有界方案

只用于本地 VM、小规模或明确接受 API/PVC 单点的环境：

```yaml
api:
  replicaCount: 1
  autoscaling:
    enabled: false

media:
  backend: filesystem
  filesystem:
    persistence:
      enabled: true
      storageClass: "<RWO_STORAGE_CLASS>"
      accessModes:
        - ReadWriteOnce
      size: <MEDIA_CAPACITY>
```

该分支没有 API 水平高可用；节点维护、PVC attach 或 Pod 重建期间媒体/API 可能不可用。PDB 不会把单副本变成高可用。备份必须离开该 PVC/节点，并预先规划迁往 RWX 或 S3 的路径。

## 5. filesystem 迁移到 S3

1. 记录数据库媒体行数、对象数、总字节、旧 root 和维护窗口。
2. 创建私有 bucket/prefix、Secret/ExternalSecret、TLS 与 NetworkPolicy 策略。
3. 使用支持 checksum、断点续传和 no-delete 的工具把旧 filesystem 复制到 S3；首次复制期间应用仍指向旧后端。
4. 在隔离环境用同一数据库快照验证对象 key、owner、内容类型、大小和 checksum。
5. 进入停写窗口，执行增量复制并确认差异为零。
6. 把用户 values 的 `media.backend` 切到 `s3`，完成 Helm render/package validator，再由用户执行 Argo/Helm。
7. 验证上传、读取、重载、跨副本、删除/撤销语义和备份；旧 filesystem 保持只读直至观察窗结束。
8. 清理旧后端必须是单独批准的操作，不与切换同一批执行。

**Run from:** 用户存储管理机；命令中的工具与位置由用户平台确定。

**Expected:** 两轮复制均 exit 0，最终对象数/字节/checksum 一致，应用 smoke 通过。

**Failure means:** 对象差异、权限或引用不一致，切换被阻断。

**Safe fallback:** values 保持或恢复旧 backend，S3 对象保留以便诊断；不使用 `--delete`。

```powershell
<STORAGE_COPY_TOOL> <FILESYSTEM_SOURCE> <S3_TARGET> --checksum --no-delete
<STORAGE_COMPARE_TOOL> <FILESYSTEM_SOURCE> <S3_TARGET> --checksum
```

## 6. S3 迁回 filesystem 或更换对象存储

方向相反时仍采用“全量复制 → 隔离验证 → 停写增量 → values 切换 → 观察窗”的顺序。目标 filesystem 在 API 多副本时必须是 RWX；目标对象存储必须先验证 path-style、区域、TLS 和生命周期。数据库中的媒体身份不因存储迁移而重建。

## 7. 容量、性能与告警

- filesystem 关注 PVC 使用率、inode、延迟、吞吐、扩容能力和 RWX 服务健康；
- S3 关注请求失败率、p95 延迟、限流、对象数/字节、费用、生命周期与凭据轮换；
- API 扩容前确认媒体吞吐和数据库连接能随副本数增长；增加 Pod 不会自动提高共享存储或 S3 限额；
- 当 RWX 延迟/容量或跨集群复制成为主要约束时迁移 S3；当 S3 出口/延迟不满足且平台有成熟 RWX 时再评估 filesystem；
- 不编造统一硬件规格或 QPS，使用真实上传大小、并发、p95、失败率和容量增长率做决定。

备份与恢复步骤见 [备份恢复手册](backup-restore.md)，升级/回滚见 [部署回滚手册](deploy-rollback.md)。
