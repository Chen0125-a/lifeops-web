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

正式部署入口见 [DEPLOYMENT.md](DEPLOYMENT.md)，十四节陌生集群手册见 [用户自助部署检查清单](docs/runbooks/user-deployment-checklist.md)。架构与视觉约束见 [DESIGN.md](DESIGN.md)，产品边界见 [PRODUCT.md](PRODUCT.md)。

已验证的 `1.0.0` 发布来自 source revision `64cb76932def9eed94cb43aea104c97eb19f1382`：ordinary CI `33285063683` 和 release `33286877080` 均成功。生产交付固定为 Web `sha256:31d13ed140d0f3343bbef40355e736ce8d63298ffa3c3efb97f27659fb9fa4af` 与 API `sha256:c70d0b33612e36c171c4085639e8cf7d558abdbd37b780fb0bd651a4e7c9c5e3`；migration 复用 API 镜像，不存在第三个项目镜像。

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

最终 clean-install 本地门禁覆盖 427 个前端单元/合同测试、362 个普通服务端测试、50 个官方 MySQL exact-integration 测试、336 个 Linux Playwright 主矩阵用例、2 个独立主题性能用例和 12 个真实 Fastify production-preview 跨浏览器用例。Chromium、Firefox、WebKit、1440/1024/768/390、200% zoom、键盘、reduced-motion、serious/critical WCAG 扫描、Lighthouse 与人工最终图像复核均有新鲜证据。

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
- Chart 内置的单副本 MySQL 只适合本地、演示、小规模或明确接受单点风险的环境；真正生产应使用已有的托管 RDS、独立数据库 VM 或成熟 HA/Operator MySQL，并按手册完成备份恢复与迁出验证。
