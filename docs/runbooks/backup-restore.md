# LifeOps 备份与恢复手册

本文用于用户拥有的数据库与媒体平台。LifeOps 仓库维护者不会读取 kubeconfig、数据库配置或备份内容，也不会替用户执行恢复。所有示例只含占位符；凭据放在权限受限的客户端配置、Kubernetes Secret 或外部密钥系统中，不放在命令行、Git 或聊天记录里。

## 1. 先定义恢复合同

上线前由用户记录：

- 数据库与媒体的 RPO、RTO、负责人和审批人；
- 当前应用 source revision、Web/API digest、GitOps revision、schema migration 列表；
- 数据库分支、媒体后端、备份位置、加密与保留周期；
- 停写窗口、恢复验证环境和允许丢失的数据时间范围。

备份文件存在不等于可恢复。至少完成一次隔离恢复、checksum 校验、schema/owner 隔离抽查和应用只读验证，才能把该备份链路标为可用。

## 2. 四种数据库分支

| 分支 | 备份方式 | 主要故障边界 | 恢复要求 |
| --- | --- | --- | --- |
| 内置 MySQL 8.4.10 单副本 | 一致性逻辑备份 + 平台 PVC 快照（辅助） | Pod/PVC/节点/单实例故障 | 备份必须离开 PVC；先恢复到隔离 MySQL |
| 托管 RDS | 服务端快照、PITR、逻辑导出 | 云服务区域、参数组、账号与网络 | 验证可恢复时间点、参数组、TLS 和连接上限 |
| 独立 VM MySQL | 逻辑备份 + binlog/物理备份 | VM、磁盘、备份主机 | 数据库运行在独立主机，不安装到 K8s worker |
| HA/Operator MySQL | Operator/平台原生 Backup/Restore | Operator、对象存储、仲裁/副本 | 使用该实现支持的恢复流程并验证集群拓扑 |

内置 MySQL 不是高可用集群。需要生产 HA 时，先验证外部目标，再按第 7 节迁出。

## 3. 一致性逻辑备份

**Run from:** 能通过受控网络访问 MySQL 的用户数据库管理机；不在共享终端执行。`<PRIVATE_MYSQL_CLIENT_CONFIG>` 是权限受限且不入库的 option file。

**Expected:** `mysqldump` exit 0；生成非空 SQL 文件；SHA-256 已记录；输出中没有密码。

**Failure means:** TLS、权限、容量、连接或一致性条件不满足，禁止继续升级。

**Safe fallback:** 保持当前应用版本；修复备份链路并重新完成隔离恢复，不用未验证 PVC 快照代替。

```powershell
mysqldump --defaults-extra-file=<PRIVATE_MYSQL_CLIENT_CONFIG> --single-transaction --routines --triggers --events --set-gtid-purged=OFF --databases <LIFEOPS_DATABASE> --result-file=<ENCRYPTED_BACKUP_PATH>
Get-Item -LiteralPath <ENCRYPTED_BACKUP_PATH> | Select-Object Length,LastWriteTime
Get-FileHash -Algorithm SHA256 -LiteralPath <ENCRYPTED_BACKUP_PATH>
```

LifeOps migration 会创建 schema-local DDL、搜索同步与不可变账本触发器，因此备份必须包含 routines/triggers/events。外部数据库用户执行迁移时需要目标 schema 的 DDL 与 `TRIGGER` 权限；启用 binary log 时由数据库管理员设置适合该平台的 `log_bin_trust_function_creators` 策略，不给应用用户全局 `SUPER`。

## 4. 托管 RDS、VM 与 Operator 补充检查

### 托管 RDS

**Run from:** 云平台控制面或受控管理机。

**Expected:** 快照/PITR 状态为可用，恢复到隔离实例后能使用 TLS 连接；参数组和时区与生产合同一致。

**Failure means:** 恢复点、KMS、账号、网络或参数组不完整。

**Safe fallback:** 不修改生产实例；保留当前版本，修复快照和恢复权限。

```text
<PROVIDER_BACKUP_COMMAND> --instance <RDS_INSTANCE> --target <BACKUP_ID>
<PROVIDER_RESTORE_COMMAND> --backup <BACKUP_ID> --new-instance <ISOLATED_RESTORE_INSTANCE>
```

### 独立 VM MySQL

在数据库 VM 或专用备份主机检查磁盘余量、备份加密、binlog 保留和文件权限。不要在 Kubernetes worker 节点安装 MySQL 二进制来充当 LifeOps 生产数据库。

### HA/Operator MySQL

只使用当前 Operator 版本支持的 Backup/Restore CR 或平台流程。备份状态必须明确 Complete，恢复后验证 primary/replica/仲裁和对象存储 checksum；不要把单个 PVC 快照描述为 HA 恢复。

## 5. 隔离恢复演练

**Run from:** 用户数据库管理机，目标是新建的 `<ISOLATED_DATABASE>`；绝不直接覆盖生产 schema。

**Expected:** 导入 exit 0；`schema_migrations` 连续；关键表可读；不同 owner 的数据不可串读；应用只读启动通过。

**Failure means:** 备份损坏、版本不兼容、触发器/权限缺失或恢复目标配置不一致。

**Safe fallback:** 删除或隔离失败的恢复目标，保留生产不变；修复后从原备份重新演练。

```powershell
mysql --defaults-extra-file=<PRIVATE_RESTORE_CLIENT_CONFIG> --database=<ISOLATED_DATABASE> --execute="source <ENCRYPTED_BACKUP_PATH>"
mysql --defaults-extra-file=<PRIVATE_RESTORE_CLIENT_CONFIG> --database=<ISOLATED_DATABASE> --execute="SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version;"
mysql --defaults-extra-file=<PRIVATE_RESTORE_CLIENT_CONFIG> --database=<ISOLATED_DATABASE> --execute="SELECT COUNT(*) AS users FROM users; SELECT COUNT(*) AS sessions FROM sessions;"
```

表计数只用于发现明显缺失，不证明业务完整。恢复演练还要运行用户隔离、登录、幂等写入、公开快照撤回、Life 库存流水和媒体引用抽查；报告只保留聚合结果和脱敏 ID。

## 6. 数据库与媒体的一致窗口

媒体元数据在 MySQL，文件或对象在独立后端。备份顺序为：

1. 进入经批准的停写/维护窗口，记录开始时间和最后成功写入点；
2. 先完成 MySQL 一致性备份，再对 RWX/S3 做无删除复制或版本快照；
3. 保存媒体对象数量、总大小和 checksum 清单；
4. 在隔离环境同时恢复数据库与媒体；
5. 验证媒体 ID、owner、对象 key、内容类型和可读性后再退出维护窗口。

**Run from:** 用户存储管理机；`<STORAGE_COPY_TOOL>` 必须支持 checksum 和 no-delete。

**Expected:** 源/目标对象数量、大小与 checksum 一致，旧后端保持可回退。

**Failure means:** 数据库元数据与媒体内容可能不一致，禁止切换或清理旧后端。

**Safe fallback:** 保持旧媒体后端只读，重新同步差异；不运行带 delete 的镜像命令。

```powershell
<STORAGE_COPY_TOOL> <SOURCE_MEDIA_LOCATION> <BACKUP_MEDIA_LOCATION> --checksum --no-delete
<STORAGE_VERIFY_TOOL> <BACKUP_MEDIA_LOCATION> <ISOLATED_RESTORE_LOCATION>
```

后端选择、values 映射和迁移步骤见 [媒体存储手册](media-storage.md)。

## 7. 从内置 MySQL 迁出

1. 准备外部 RDS/VM/HA MySQL，启用 TLS、备份、监控和受限 LifeOps 账号。
2. 在隔离数据库恢复最近备份，校验 MySQL 8.4 兼容性、时区、字符集、触发器与迁移 checksum。
3. 计算连接预算：`API 最大副本数 × 每副本连接上限 + migration/admin 余量`。
4. 在维护窗口停止新写入，完成增量/最终备份并恢复外部目标。
5. 将用户私有 values 改为 `mysql.enabled: false` 和 `externalDatabase.*`，Secret 仍由 Secret/ExternalSecret 提供。
6. 先离线 render/validator，再由用户执行 Argo/Helm；确认 migration Job、API、Web 和应用 smoke。
7. 保留旧 StatefulSet/PVC 为只读回退，直到新数据库超过约定观察窗；不要立即删除。

切换失败时回到最后一个已验证且 schema 兼容的应用/数据库组合。数据库恢复会丢弃恢复点之后的写入，必须由用户明确接受数据窗口；应用 digest 回滚本身不会回滚 schema。

## 8. 恢复后的应用验证

恢复或切换后由用户在管理机执行 [部署清单第 11 节](user-deployment-checklist.md#11-健康登录写入重启exact-digest-应用验收-smoke) 的应用 smoke，并核对：

- 观察到的 Web/API digest 与批准 digest 完全一致；
- migration Job 完成且无 checksum drift；
- 健康、登录、CSRF、写入、重载和跨副本会话正常；
- Life 幂等库存/撤销与媒体读取正确；
- 指标、日志和告警恢复，日志无 Cookie、Authorization 或凭据；
- 恢复报告只含 revision、digest、时间、聚合计数、checksum 与脱敏 request ID。

任何一项失败都保持维护模式或受控流量，按 [升级回滚手册](deploy-rollback.md) 选择前向修复、schema-compatible 应用回滚或经批准的备份恢复。
