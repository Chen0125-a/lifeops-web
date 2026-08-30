# LifeOps 安全部署、备份恢复与回滚

本文只描述用户在已授权环境中的操作。LifeOps Web 项目交付者不读取 kubeconfig、不连接数据库、不执行 Helm install/upgrade、Argo sync/rollback 或 cluster smoke。迁移是前向的；禁止自动 destructive down migration。

命令元数据图例：`Run from:` 表示执行位置，`Expected:` 表示预期结果，`Failure means:` 表示失败含义，`Safe fallback:` 表示安全回退。

## 升级前门禁

1. 记录当前 Git revision、Web/API digest、values revision 和 schema migration 列表。
2. 对 MySQL 与媒体做同一维护窗口内的备份，并在隔离目标完成恢复验证。
3. 运行离线 package validator；确认新 API 对现有 schema 的迁移是前向兼容的。
4. 计算数据库连接预算和节点调度余量。
5. 明确恢复负责人、RTO/RPO、流量暂停条件与回滚决策人。

## 数据库分支的备份与恢复

- 内置单实例 MySQL：用户通过临时、受限客户端或平台作业执行一致性逻辑备份；备份保存到集群外。PVC 快照只能作为辅助，不能替代恢复验证。
- 托管 RDS：使用服务端快照/PITR，并记录可恢复时间点和参数组。
- 独立 VM MySQL：在独立数据库 VM 上执行备份，验证文件权限、checksum、binlog 和磁盘容量；不要登录 worker 节点安装 MySQL。
- HA/Operator：使用 Operator 支持的 Backup/Restore 资源或平台流程，验证副本/仲裁恢复。

每个恢复都先进入隔离数据库，核对 schema migrations、关键表数量、owner 隔离和应用只读查询，再安排生产切换。

执行位置：用户数据库管理机；不在 Git 仓库内；`<BACKUP_TARGET>` 是访问受控的加密位置。
预期结果：备份工具成功，checksum 和恢复演练报告可复核，未输出凭据。
失败含义：权限、容量、一致性或恢复路径不满足，禁止升级。
安全回退：保持当前版本运行，修复备份/恢复链路；不要以未验证快照继续发布。

```powershell
<MYSQL_BACKUP_TOOL> --defaults-extra-file=<PRIVATE_CLIENT_CONFIG> --single-transaction <DATABASE_NAME> --result-file=<BACKUP_TARGET>
<MYSQL_RESTORE_TOOL> --defaults-extra-file=<PRIVATE_RESTORE_CONFIG> <ISOLATED_DATABASE_NAME> < <BACKUP_TARGET>
```

## 媒体备份与恢复

- RWX filesystem：做文件级快照/备份并保存 checksum 清单；数据库媒体元数据与对象数据必须来自一致维护窗口。
- S3-compatible：启用 versioning/对象锁（若平台支持），记录 bucket、prefix、版本和 lifecycle；恢复时先校验对象 checksum。
- 单副本 RWO：只适合风险接受环境；备份必须离开该 PVC/节点。

执行位置：用户存储管理机；仓库外的受控目录。
预期结果：对象数量、总大小和 checksum 与恢复目标一致。
失败含义：媒体与数据库元数据可能不一致，禁止切换或清理旧存储。
安全回退：保留旧后端只读，重新同步差异并复核后再切流量。

```powershell
<STORAGE_COPY_TOOL> <SOURCE_MEDIA_LOCATION> <BACKUP_MEDIA_LOCATION> --checksum --no-delete
<STORAGE_VERIFY_TOOL> <BACKUP_MEDIA_LOCATION> <ISOLATED_RESTORE_LOCATION>
```

## 正常升级

只修改 immutable digest 和经审查的 values。Argo CD 推荐采用 Git 中的 digest-only 变更；Helm 路径也必须保存渲染 diff。

执行位置：用户 GitOps 仓库或 LifeOps 仓库根目录。
预期结果：migration Job Complete，Web/API rollout ready，旧 pod 在新 pod ready 后退出，应用 smoke 通过。
失败含义：迁移、镜像、Secret、探针、容量或路由不满足。
安全回退：停止自动推进；不要删除 PVC/namespace；按下面决策树判断应用 digest 回滚是否安全。

```powershell
git diff -- <USER_VALUES_FILE>
helm template <RELEASE_NAME> deploy/helm/lifeops-web --namespace <NAMESPACE> --values <USER_VALUES_FILE> > <RENDERED_REVIEW_FILE>
kubectl apply -f <USER_REVIEWED_ARGO_APPLICATION_FILE>
```

## 回滚决策树

1. **migration 未开始**：可把 GitOps values 恢复到旧 Web/API digest，再由用户同步。
2. **migration 失败且未提交新 schema**：保留失败 Job 证据，修复配置后重试同一向前迁移；不要 down migration。
3. **migration 已成功，旧 API 与新 schema 兼容**：允许在维护决策后回到旧 API/Web digest，随后运行完整 smoke。
4. **migration 已成功，旧 API 不兼容**：应用 digest 回滚被阻断。选择修复前向版本，或在正式停机窗口恢复已验证数据库/媒体备份并明确数据丢失窗口。
5. **仅 Web 故障**：若 API/schema 未变化，可只回滚 Web digest；仍需验证登录和核心路由。
6. **媒体后端切换故障**：保持旧后端只读，切回旧配置前核对数据库对象引用；禁止盲删新旧对象。

## GitOps digest 回滚

执行位置：用户 GitOps 仓库；已审查的回滚分支。
预期结果：diff 只包含 Web/API digest 或明确批准的兼容配置；Argo/Helm 不删除持久化数据。
失败含义：diff 包含 schema、Secret、PVC、namespace 或未知资源删除，不能继续。
安全回退：撤销用户 GitOps 分支中的回滚候选，保留当前运行版本并升级前向修复。

```powershell
git diff <CURRENT_GITOPS_REVISION>..<ROLLBACK_GITOPS_REVISION> -- <USER_VALUES_FILE>
git revert <DIGEST_ONLY_GITOPS_COMMIT>
git diff --check
```

## Helm 应用回滚

`helm rollback` 只回滚 Kubernetes release 状态，不会回滚数据库 schema。用户必须先完成兼容性决策。

执行位置：用户管理机；LifeOps 仓库根目录。
预期结果：目标 revision 的 Web/API digest 与批准值一致，rollout ready，smoke 通过。
失败含义：旧 API 不兼容新 schema、Secret/PVC 缺失或资源无法调度。
安全回退：停止再次回滚；恢复到最后一个 schema 兼容的应用 digest 或发布前向修复。

```powershell
helm history <RELEASE_NAME> --namespace <NAMESPACE>
helm get values <RELEASE_NAME> --namespace <NAMESPACE> --all
helm rollback <RELEASE_NAME> <SCHEMA_COMPATIBLE_REVISION> --namespace <NAMESPACE> --wait --timeout <TIMEOUT>
```

## 回滚后验证

执行位置：用户管理机；LifeOps 仓库根目录。
预期结果：实际 revision/digest 与批准值一致，健康、登录、写入、重载、Life exactly-once、媒体和清理全部通过。
失败含义：回滚未恢复应用级正确性，不得恢复全部流量。
安全回退：维持维护模式/受控流量，收集脱敏 request ID 和状态，选择前向修复或已验证备份恢复。

```powershell
$credential = Get-Credential
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/post-deploy-smoke.ps1 -BaseUrl https://<HOSTNAME> -ExpectedWebDigest <ROLLBACK_WEB_DIGEST> -ExpectedApiDigest <ROLLBACK_API_DIGEST> -ExpectedRevision <ROLLBACK_REVISION> -ObservedWebDigest <OBSERVED_WEB_DIGEST> -ObservedApiDigest <OBSERVED_API_DIGEST> -ObservedRevision <OBSERVED_REVISION> -Credential $credential -ReportPath <SANITIZED_REPORT_PATH>
```

## 故障排查索引

| 症状 | 首查 | 不应做 |
| --- | --- | --- |
| ImagePullBackOff | imagePullSecret 名、UHub 访问、节点 DNS | 不把密码写进 values |
| migration Failed | 脱敏 Job 日志、DB TLS/权限、checksum drift | 不删除 `schema_migrations`，不 down migration |
| PVC Pending | StorageClass、access mode、容量 | 不把多副本 filesystem 改成 RWO 绕过 |
| HTTPRoute NotAccepted | GatewayClass、parentRef、namespace/policy | 不重做应用镜像 |
| 502/探针失败 | Service targetPort、API readiness、DB 连接 | 不扩大 HPA 掩盖数据库故障 |
| 登录循环 | HTTPS、allowedOrigins、secure cookie、代理 CIDR | 不关闭 CSRF/secureCookies |
| 媒体缺失 | DB media identity、后端对象 checksum、RWX/S3 配置 | 不删除未知对象 |
| 指标缺失 | ServiceMonitor CRD、label、内部 metrics Service | 不把 `/metrics` 暴露到公网 |

最终记录只保存 revision、digest、脱敏错误码/request ID、备份/恢复验证结论和用户批准的决策；不保存凭据、Cookie、私钥、kubeconfig 或原始私人数据。
