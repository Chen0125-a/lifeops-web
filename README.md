# LifeOps V1

LifeOps 是一个以“计划 → 记录 → 回顾 → 知识 → 可控公开快照”为核心闭环的私人生活操作空间。公开首页是可原生滚动的昼夜双主题入口，五个语义对象沿手工轨迹运行；登录后通过一次性边界动效进入始终明亮的“今日工作台”。私有区使用顶部稳定导航、纵向时间线与任务专用界面，不采用星球主题，也不采用传统左侧功能栏加内容卡片的后台模板。

V1 已包含：

- React 19 + Vite + TypeScript 前端；
- Fastify 5 API、服务端会话、CSRF 与来源校验；
- MySQL 8.4 持久化和按用户隔离的数据访问；
- 可跨浏览器访问、可立即撤回的公开快照；
- Web/API 两个非 root 多阶段镜像；
- Helm 首装、Envoy Gateway `HTTPRoute`、HPA、PDB 与持久卷；
- GitHub Actions 构建并推送 UHub，回写镜像 digest，供 Argo CD 升级。
- 登录失败计数保存在共享 MySQL 中，多 API 副本不会各自重新计数；代理头默认不受信任，只有配置明确 CIDR 后才启用。

详细生产部署见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。架构与视觉约束见 [DESIGN.md](DESIGN.md)，产品边界见 [PRODUCT.md](PRODUCT.md)。

## 本地预览

要求 Node.js 24.x。

```bash
npm ci
npm run dev
```

开发服务器默认启用浏览器内演示数据，任意非空账号和密码都可以预览界面；这不等同于生产认证。

要验证真实服务端认证，无需本地 MySQL，可直接运行已封装的远程模式浏览器门禁：

```bash
npm ci --prefix server
npm run test:e2e:remote
```

生产构建默认关闭演示模式，只通过同源 `/api/v1` 使用服务端认证和 MySQL 数据。

## 质量门禁

```bash
npm test
npm run test:server
npm run test:mysql # 需要显式提供临时 MySQL 测试环境变量
npm run typecheck
npm run typecheck:server
npm run build
npm run build:server
npm run test:e2e
npm run test:e2e:remote
```

Helm 校验：

```bash
helm lint deploy/helm/lifeops-web
helm template lifeops deploy/helm/lifeops-web --set httpRoute.enabled=true
```

## 镜像

镜像均固定基础镜像版本，运行阶段只携带必要产物：

```bash
docker build -t uhub.service.ucloud.cn/chenucloud/lifeops-web:1.0.0 .
docker build -f server/Dockerfile -t uhub.service.ucloud.cn/chenucloud/lifeops-api:1.0.0 .
```

生产升级使用 `repository@sha256:...`，不依赖 `latest`。UHub 公网每层限速会影响首次拉取时长，但不会改变镜像内容或应用运行性能；多阶段构建和精简运行层用于减少首次拉取成本。

## 安全边界

- 密码只以 scrypt 哈希形式保存；会话令牌仅以 SHA-256 摘要保存，Cookie 为 `HttpOnly`、`SameSite=Lax`，生产默认 `Secure`；连续失败登录受限速保护。
- 所有数据读写都绑定当前用户；写操作要求有效会话与 CSRF 令牌。
- 公开快照只返回用户明确编辑的标题与摘录，不返回私人正文和来源关系；撤回后公共接口立即返回不可访问。
- Helm 默认引用已有 Kubernetes Secret；也支持 ExternalSecret。仅在受控首装场景下可显式启用 `secrets.create`，真实密码不得提交到 Git。
- Chart 内置的单副本 MySQL 适合当前自建集群学习与 V1 使用；要获得数据库级高可用，后续应切换云 MySQL 或独立高可用 MySQL 方案。
