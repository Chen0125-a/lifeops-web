# LifeOps 产品真相

LifeOps 是一个私人生活操作系统：把计划、真实经历、周期回顾和可复用知识串成可追溯闭环，并允许用户从私人原文中主动制作、发布和撤回一份受控公开快照。

## 核心体验

- 公开首页是一份可原生滚动的个人介绍：首屏只有五个语义明确的生活对象，技术底座只出现在“项目”详情中。
- 公开入口在白天使用暖白与淡蓝环境光，夜间使用安静星空；登录以一次性边界动效过渡到始终明亮的私人工作台。
- 私有区不是“左侧功能列表 + 右侧内容卡片”的后台模板，也不延续星球主题。首页是一张以今天为中心的纵向时间工作台，顶部稳定导航连接计划、记录、回顾、知识和发布。
- 功能闭环固定为：今日计划 → 生活执行/记录 → 周期回顾 → 知识沉淀 → 可控公开快照。生活执行域用同一份事实串联食材、食谱、补剂、药品、健身、家庭物品、库存、采购、营养与预算。
- 登录后主导航增加独立“生活”工作区；全局总览只显示今日生活摘要，完整日历、计划、资料库、采购和分析进入 `/app/life`。
- 公开对象只能通过点击进入详情，详情始终提供可见返回路径并支持 Esc；首页滚轮只负责正常文档滚动。
- 动效用于说明空间关系、状态变化和操作因果；不为装饰牺牲流畅度、键盘可用性或减少动态偏好。

## V1 生产边界

- React + TypeScript 前端与 Node.js + TypeScript API 分为两个镜像。
- MySQL 保存用户、会话、业务数据和公开快照；浏览器存储不再作为生产事实源。
- 生活未来计划使用当前有效主数据自动重算，已完成事项保存实际快照；库存通过幂等流水变更，现金支出与消耗成本分开。
- 登录使用服务端会话、HttpOnly Cookie、同源 API、CSRF 防护和服务端权限校验。
- 公开快照使用不可猜测的 slug，可跨浏览器访问；撤回后服务端立即拒绝公开读取。
- Helm 可首装到现有 Kubernetes；内置 MySQL 是学习/单集群起步方案，生产可切换外部托管 MySQL，不宣称数据库高可用。
- GitHub Actions 构建并推送 UHub 双镜像，以 digest 更新 GitOps values；未来 Jenkins/Argo CD 复用同一发布合同。

## 已验证交付与运行限制

- `1.0.0` 的应用 source revision 为 `64cb76932def9eed94cb43aea104c97eb19f1382`；Web/API 两个 UHub immutable digest、SBOM、provenance、registry inspect 和 exact-digest smoke 已验证，详见 `outputs/final/release-manifest.json`。
- API 默认 HPA 为 2–6 副本；会话、幂等、库存流水与登录失败计数由 MySQL 共享持久化。当前没有 Redis，也不在没有一致性/故障/回退设计时引入。
- 多副本 filesystem 媒体要求 RWX；没有 RWX 的集群优先使用 S3-compatible。单 API 副本 + RWO 只是风险接受的有界方案。
- Prometheus、Grafana、Alertmanager、Kubernetes、Elasticsearch、GitHub 和 Argo CD 集成默认 disabled；没有真实连接时只显示 disabled/degraded，不生成虚假平台数据。
- Obsidian 写回依赖用户授权的 File System Access；不支持时仅提供 ZIP 预览，冲突必须显式选择，写入前先备份。
- 项目交付没有验证用户集群、Argo、DNS/TLS 或生产 hostname 可访问；这些是用户部署后的证据，不是 Web 镜像交付事实。

## 非目标

- 不重新实现日志、指标、链路追踪等已有成熟开源平台。
- 不在 V1 引入微服务拆分、WebGL 重场景、社交网络或多人协作。
- 不把浏览器本地预览、内置 MySQL 或单副本开发配置描述为生产高可用。
- 不把 Gateway API、Envoy Gateway/NGINX Gateway Fabric controller 与 Web 镜像内的静态 Nginx 混为一谈。
