# LifeOps 生产版设计规格

## 目标

在保留现有公开双屏与技术星球体验的基础上，完成连续的登录穿越、持续运行的私人宇宙、五步生活闭环、真实身份认证、MySQL 持久化、跨设备公开快照和可复现的 Kubernetes 发布链路。

## 体验状态机

1. `public`: 公开首页与技术底座可浏览。
2. `auth-opening`: 轨道让位，登录入口出现。
3. `auth-submitting`: 表单锁定，显示明确进度或错误。
4. `portal-crossing`: 登录成功后公共轨道收束，进入私有主题。
5. `private-overview`: 私人时间星仪持续公转。
6. `private-focus`: 选中星球仍留在壳层内，功能内容作为近景展开。
7. `logout-crossing`: 会话撤销后反向回到公开边界。

路由切换不得靠固定延时控制业务状态；浏览器支持 View Transition 时使用原生共享元素，不支持时使用 CSS 入场类。所有动画只改变 `transform`、`opacity`、`filter`、`clip-path` 等合成友好属性。

## 功能闭环

- 今日：创建计划、标记完成。
- 记录：可从完成计划建立记录，也可直接记录，保留来源。
- 回顾：选择时间范围，汇集计划与记录证据并生成回顾。
- 知识：从记录或回顾提炼知识，保留来源和标签。
- 快照：用户单独编辑公开标题/摘录，预览后发布；公开接口只返回副本字段；撤回后立即 404。

## 后端与安全

- Fastify API，JSON Schema 校验，统一错误格式和 request id。
- MySQL 8.4；迁移脚本建立 users、sessions、plans、records、reviews、review_evidence、knowledge_notes、public_snapshots。
- 密码用 Node `scrypt` + 每用户随机盐；只保存摘要。
- 登录成功写 HttpOnly、SameSite=Lax、Secure(生产) 的不透明会话 Cookie；会话只在服务端保存摘要。
- 所有写请求要求同源校验和 CSRF token；所有私有查询按 user_id 限定。
- 初始管理员通过 Kubernetes Secret 环境变量引导创建，启动后不回显密码。

## 前端数据合同

UI 通过异步 Repository 端口读取和变更数据；Provider 负责会话状态、加载状态和远端数据刷新。开发时可显式启用本地演示适配器，但生产构建默认 API，不再把 localStorage 作为事实源。

## 部署与发布

- `lifeops-web`：Nginx 非 root，静态资源长缓存，`/api` 同域反向代理或由网关分流。
- `lifeops-api`：非 root Node 运行时，readiness/liveness，优雅退出。
- Helm：web/api 双 Deployment、双 Service、Secret 引用、可选 MySQL StatefulSet/PVC、HTTPRoute/Ingress、PDB/HPA。V1 API 启动时执行幂等建表迁移，并处理多副本同时引导管理员的唯一键竞争；后续破坏性迁移应拆成独立 Job。
- GitHub Actions：测试 → 构建 → 推送 UHub → 读取双 digest → 更新环境 values → 提交 GitOps 变更。固定基础镜像和 npm lock；不用 `latest` 作为升级依据。

## 验收

- 登录进入私有区有连贯过渡，私有背景与公开背景视觉上可立即区分。
- 私有星球在总览和所有子页持续运行；返回后不停止、不跳位。
- 五个功能间切换无整页闪白，键盘焦点在动画完成后落到新标题。
- 390px、768px、1440px 可用；减少动态模式无持续公转。
- 单元、API、真实 MySQL、真实服务端登录 E2E、TypeScript、生产构建与 Helm lint/render 必须通过；双镜像由 GitHub Actions 在有容器守护进程和 UHub 凭据的环境中实际构建、推送并按精确 digest smoke。用户首次安装后应运行交付的集群 smoke，但该结果不属于 Web 镜像交付完成门禁。
