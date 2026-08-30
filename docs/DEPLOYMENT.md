# LifeOps V1 生产部署手册

> 本文件保留为早期快速参考。正式发布身份、责任边界和入口见仓库根部 [`DEPLOYMENT.md`](../DEPLOYMENT.md)；陌生集群必须按 [`docs/runbooks/user-deployment-checklist.md`](runbooks/user-deployment-checklist.md) 的十四节 capability-first 手册执行。若两处命令存在差异，以根入口、十四节手册和当前 chart/values 为准。

已发布的 `1.0.0` source revision 是 `64cb76932def9eed94cb43aea104c97eb19f1382`；生产 Web/API digest 分别为 `sha256:31d13ed140d0f3343bbef40355e736ce8d63298ffa3c3efb97f27659fb9fa4af` 与 `sha256:c70d0b33612e36c171c4085639e8cf7d558abdbd37b780fb0bd651a4e7c9c5e3`。不要用 tag、`latest` 或本地 image ID 替代。

## 1. 拓扑与边界

浏览器通过 Envoy Gateway 访问同一 FQDN：`/api` 路由到 LifeOps API，其余路径路由到 LifeOps Web。Web/API 默认双副本；API 使用 MySQL 保存业务数据、会话和跨副本登录失败计数。Chart 默认部署单副本 MySQL StatefulSet 与 PVC，也支持外部或云 MySQL。

应用层具备 HPA、PDB、拓扑分散和滚动升级。Chart 内置 MySQL 不是数据库高可用方案；上云后应切换托管 MySQL 或独立 HA MySQL。

## 2. 前置条件

- Kubernetes 集群、Helm 3.19+；
- Envoy Gateway 与 Gateway API v1 CRD；
- 可用 StorageClass；
- 集群节点能够拉取 UHub 与 `mysql:8.4.10`；
- 指向 Gateway 地址的应用 FQDN；
- UHub 项目 `chenucloud` 下的 `lifeops-web`、`lifeops-api` 仓库。

所有镜像版本固定，升级最终使用 digest，不使用 `latest`。

## 3. 准备 Secret

Chart 支持三种互斥方式。任何真实密码都不得提交到 Git。

### 方式 A：已有 Kubernetes Secret（默认，当前集群最直接）

```bash
kubectl create namespace lifeops
kubectl -n lifeops create secret generic lifeops-secrets \
  --from-literal=admin-password='REPLACE_WITH_16+_CHARACTERS' \
  --from-literal=mysql-password='REPLACE_WITH_A_DIFFERENT_PASSWORD' \
  --from-literal=mysql-root-password='REPLACE_WITH_ANOTHER_PASSWORD'
```

执行前应在安全终端中替换占位符，避免让密码进入仓库、聊天记录或共享命令历史。

### 方式 B：ExternalSecret（推荐的 GitOps 方式）

集群安装 External Secrets Operator 并准备 SecretStore 后，在私有环境 values 中设置：

```yaml
externalSecret:
  enabled: true
  secretStoreRef:
    name: lifeops-secret-store
    kind: ClusterSecretStore
  remoteRefs:
    adminPassword: lifeops/admin-password
    mysqlPassword: lifeops/mysql-password
    mysqlRootPassword: lifeops/mysql-root-password
```

Argo CD 将管理 ExternalSecret，真实值仍留在外部密钥系统。

### 方式 C：由 Chart 创建 Secret（仅受控首装）

将 `secrets.create=true` 及三项密码放入一个不入库的临时 values 文件。Helm release 自身会保存这些值，因此不建议长期生产使用。

私有 UHub 仓库还需要镜像拉取 Secret。先在仓库外生成权限受限的 Docker config JSON；不要把密码放进命令参数或 shell history：

```powershell
kubectl -n <NAMESPACE> create secret generic <IMAGE_PULL_SECRET> --from-file=.dockerconfigjson=<PRIVATE_DOCKER_CONFIG_JSON> --type=kubernetes.io/dockerconfigjson
kubectl -n <NAMESPACE> get secret <IMAGE_PULL_SECRET> -o name
```

## 4. 生产 values

修改 `deploy/gitops/environments/production/values.yaml` 中的域名、Gateway 引用和镜像 digest。私有 UHub 增加：

```yaml
imagePullSecrets:
  - name: uhub-registry

api:
  config:
    adminAccount: owner@example.com
    adminDisplayName: LifeOps Owner
    allowedOrigins: "https://lifeops.example.com"
    secureCookies: true
    # 默认不信任 X-Forwarded-For。只有确认 Envoy Pod/节点网段后再填写。
    trustedProxyCidrs: "10.244.0.0/16"

httpRoute:
  enabled: true
  parentRefs:
    - name: YOUR_GATEWAY_NAME
      namespace: YOUR_GATEWAY_NAMESPACE
  hostnames:
    - lifeops.example.com
```

若使用集群内 MySQL：

```yaml
mysql:
  enabled: true
  persistence:
    storageClass: "YOUR_STORAGE_CLASS"
    size: 10Gi
```

若使用云 MySQL：

外部 MySQL 的 LifeOps 数据库用户必须拥有该 schema 内迁移所需的 DDL 与 `TRIGGER` 权限；启用二进制日志时还必须由数据库管理员将 `log_bin_trust_function_creators=ON`。这允许版本控制的迁移创建不可变账本与搜索同步触发器，无需把全局 `SUPER` 权限授予应用用户。Chart 内置 MySQL 已显式设置这一参数。

```yaml
mysql:
  enabled: false
externalDatabase:
  host: mysql.example.internal
  port: 3306
  database: lifeops
  user: lifeops
  existingSecret: lifeops-secrets
  passwordKey: mysql-password
```

## 5. Helm 首装

```bash
helm lint deploy/helm/lifeops-web
helm template lifeops deploy/helm/lifeops-web \
  --namespace lifeops \
  -f deploy/gitops/environments/production/values.yaml

helm upgrade --install lifeops deploy/helm/lifeops-web \
  --namespace lifeops --create-namespace \
  -f deploy/gitops/environments/production/values.yaml \
  --atomic --timeout 10m
```

检查：

```bash
kubectl -n lifeops get pods,svc,pvc,httproute
kubectl -n lifeops rollout status deployment/lifeops-web --timeout=5m
kubectl -n lifeops rollout status deployment/lifeops-api --timeout=5m
kubectl -n lifeops logs deployment/lifeops-api --tail=100
```

登录账号来自 `api.config.adminAccount`，密码来自 `admin-password`。首次启动会并发安全地创建引导用户；后续升级不会覆盖已有密码。

## 6. GitHub Actions、UHub 与 Argo CD

在 GitHub Actions Secrets 中创建：

- `UHUB_USERNAME`
- `UHUB_PASSWORD`

CI 使用 MySQL 8.4.10 service container 执行真实迁移、并发引导、用户隔离、快照发布/撤回和共享限速测试；随后运行浏览器验收、Helm 渲染和双镜像构建。

推送 `v1.0.1` 形式的 tag 或手动触发 Release 后，工作流会构建 Web/API 镜像、推送 UHub、解析不可变 digest、更新生产 values 并提交到默认分支。若分支保护不允许机器人直推，应改为发布分支或由工作流创建 PR。

复制 `deploy/argocd/application.example.yaml`，替换两个 `repoURL` 后应用：

```bash
kubectl apply -f deploy/argocd/application.yaml
argocd app wait lifeops --health --sync --timeout 600
```

Argo CD 尚未安装时，继续使用 Helm；安装后再接管相同 release 与 namespace。

## 7. 回滚与备份

优先回退 GitOps values 中的 Web/API digest。紧急回滚：

```bash
helm history lifeops -n lifeops
helm rollback lifeops PREVIOUS_REVISION -n lifeops --wait --timeout 10m
```

镜像回滚不会回滚数据。数据库迁移前必须备份 MySQL；当前迁移只创建 V1 表，不包含破坏性 DDL。

## 8. 当前身份边界

V1 提供一个引导管理员账号、服务端会话、CSRF、同源限制和共享登录限速。尚未包含注册、改密、找回密码、MFA 与审计后台；这些属于下一身份阶段，不影响当前单用户 LifeOps 闭环。
