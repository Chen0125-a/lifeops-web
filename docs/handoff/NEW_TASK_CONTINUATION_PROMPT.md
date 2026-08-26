# LifeOps Web 新对话完整接班提示词

继续并最终完成 LifeOps Web 项目。这是用户明确授权的新窗口接班任务。

固定工作区：

`C:\Users\Administrator\Documents\Codex\2026-08-08\bug\lifeops-web`

Obsidian 项目权威账本：

`D:\笔记\项目\LifeOps-高可用K8s平台`

## 0. 接班执行原则

- 不创建子 Agent、并行 Agent、新工作树或新的 Codex 任务；在当前任务内持续执行。
- 除真实需要用户视觉决定、外部授权、凭据或外部系统状态外，不要在单个 task、阶段说明、checkpoint、局部绿灯或上下文压缩后停止。
- 磁盘中的最新权威文件高于本提示词。发现差异时先解释并按变更控制处理，不得用本提示词覆盖磁盘事实。
- 保护全部现有用户/WIP 变化。禁止 reset、checkout 丢弃、clean、覆盖或擅自还原文件。
- 工作区已经是 Git 仓库，绝不再次 `git init`。
- 不得泄露、回显、记录或提交密码、令牌、Cookie、私钥、认证文件及凭据值。
- 用户已批准最终陌生 K8s 集群部署手册的设计合同；不要再次要求批准该设计。这个批准不等于批准第二次 release dispatch。

## 1. Mandatory startup：任何写操作前完整执行

1. 完整读取工作区 `AGENTS.md`。
2. 完整读取本文件；它是正式的新窗口接班入口，不得只读聊天摘要。
3. 完整读取：
   - `D:\笔记\项目\LifeOps-高可用K8s平台\CURRENT.md`
   - `D:\笔记\项目\LifeOps-高可用K8s平台\DECISIONS.md` 中 ADR-016 至最新 ADR-029
   - `D:\笔记\项目\LifeOps-高可用K8s平台\sessions\2026-08-23_S022_P6-T5参考圆环正式整合.md` 最新尾部
4. 完整读取四份权威设计：
   - `docs/superpowers/specs/2026-08-09-lifeops-web-final-redesign-design.md`
   - `docs/superpowers/specs/2026-08-10-lifeops-life-domain-design.md`
   - `docs/superpowers/specs/2026-08-10-lifeops-execution-completeness-design.md`
   - `docs/superpowers/specs/2026-08-10-lifeops-web-image-delivery-boundary-design.md`
5. 完整读取：
   - `docs/superpowers/plans/2026-08-09-00-lifeops-final-master-plan.md`
   - `docs/superpowers/plans/2026-08-09-execution-control.md`
   - `docs/superpowers/plans/2026-08-09-06-lifeops-production-delivery-plan.md`
   - 当前 P6-T6 的 Files、Interfaces、全部步骤、checkbox 与退出门禁
   - 后续 P6-T7、P6-T8、P6 phase-close 和 project-close 的完整合同
6. 只读复核：
   - `git status`、HEAD、origin/main 和全部 WIP
   - 五份 authority SHA-256
   - source registry、acceptance matrix、task-execution、requirements、evidence manifest
   - 保存 checkpoint、fresh rebuild 和 manifest checkpoint identity
   - 残留 preview/test/browser 进程；只可识别明确属于本轮的 owned 进程，绝不终止用户浏览器
7. 不读取 kubeconfig，不执行 kubectl、Helm install、Argo sync/rollback 或 cluster smoke。
8. 写操作前先向用户简短陈述：active tuple、最后可信完成边界、当前 WIP 派生状态、真实 blocker、唯一下一原子动作和第一条验证命令。

五份 authority 的锁定 SHA-256：

- final redesign：`59104F2C275207401C7A70E0539CB15C7FF305F92348BE695C73F854FF1AD617`
- life domain：`ADF4BCD234D43035B1115864FE3579CAE7CC61C341E1142F6B3203C0A3E9CC24`
- execution completeness：`43ECB091350925A90620E3D88E778F8F6AD6E547B11CDB5D806248E92D07B112`
- image delivery boundary：`63F3D2903D6BDC98A2C04C2DDC111D69AA9D8A8A97766B98899918A1D49800B6`
- master plan：`1B89E19803B1C588228EBD3BFEFC64DE84DA3AAC797AF6C272EE3FAA16664716`

任何无法由已批准变更解释的哈希差异都是停线条件。

## 2. 当前权威执行状态

- authority revision：ADR-029
- status：`implementation-active`
- active tuple：P6 / P6-T6 / Step 7
- 最后可信完成边界：30/44，即 30 `verified-local` + 10 `partial` + 4 `pending`
- 当前 WIP 已由新鲜完整本地门禁和合法哈希收敛重新派生为 30 `verified-local` + 10 `partial` + 4 `pending`
- registry-bound P6-T6 原子仍未满足；本地收敛不提升 30/10/4，也不声称发布完成
- matrix：44 parents / 52 surfaces / 1,427 atoms
- evidence manifest：462 条既有 evidence rows

最新本地完整门禁 checkpoint：

`outputs/evidence/source-checkpoints/2026-08-26-p6-t6-local-full-gates-uncommitted-local-checkpoint.json`

- root：`F670579E213E5E53C2F149C69A94C8E7CA0670C5A79B6C45DBE173767A46C912`
- 602 sorted inputs
- 保存值与 fresh rebuild 一致；manifest checkpoint 相同
- 462 条 source/artifact hash 只在完整 frontend/server/MySQL/Helm/security/image/browser/visual 门禁真实通过后收敛

## 3. Git、CI 与远端事实

- 私有仓库：`Chen0125-a/lifeops-web`
- 分支：`main`
- 当前 HEAD 与 origin/main：`c387e7ce6d8497ba494b08dd348375995639517e`
- 仓库级 deploy key 私钥只在 `.git` 内且未提交；不得读取或输出内容
- 临时 bootstrap refs 已清理
- 当前 WIP 未提交、未推送；本地完整门禁 checkpoint 不是 Git revision

当前已知 WIP 至少包括：

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `docs/superpowers/plans/2026-08-09-execution-control.md`
- `docs/traceability/evidence-manifest.json`
- `docs/traceability/requirements.md`
- `docs/traceability/task-execution.json`
- `outputs/evidence/browser/p5-t5/quick-create-1440x900.png`
- `playwright.config.ts`
- `scripts/validate-workflows.test.ps1`
- `src/playwrightConfig.test.ts`
- `src/components/private/QuickCreate.test.tsx`
- `src/components/private/QuickCreate.tsx`
- `src/pages/PublicHomePage.test.tsx`
- `src/pages/PublicHomePage.tsx`
- `src/styles/public.css`
- `tests/motion-continuity.spec.ts`
- `tests/public-login.spec.ts`
- 最新 local-full-gates checkpoint 与本接班/账本更新

不得擅自还原被测试重生成的 `outputs/evidence/browser/p5-t5/quick-create-1440x900.png`；先打开复核，再按合法证据流程处理。

普通 CI run `32800641280`（revision `c387e7c...`）耗时 50m54s：MySQL、unit、typecheck、production build 通过；浏览器步骤 279 passed / 56 failed。

- 52 项：workflow 只安装 Chromium，却执行 Firefox/WebKit，属于真实环境覆盖缺口。
- 4 项 Chromium 真问题：登录淡出标题对比度、149.9ms 主题帧超过未改变的 133.4ms 门、runner 时区导致计划稿缺失、Quick Create 原 opener 被替换后焦点未恢复。

当前未提交 TDD 修订已经覆盖三浏览器安装、`Asia/Shanghai`、detached opener 焦点、登录期间 hero copy `aria-hidden`、主题层 compositor 准备和 WebKit 前台稳定采样。没有放宽 worker、retry、阈值、采样时间、视觉几何或动效速率。

新鲜完整 GREEN：frontend typecheck、85/85 files 与 401/401 Vitest、production build；server 361 passed +50 exact-integration skips、typecheck/build；官方 MySQL 8.4.10 50/50；Helm/workflow/security/audit/local-image/data-rehearsal；remote browser 12/12；Lighthouse 1.00/1.00/0.96/0.91；官方 Linux Playwright 335/335（workers=1、retries=0）。最终 diff 审计发现旧 `public-detail-*` 截图只捕获了 route gate；新增证据完整性 behavioral RED 后，`public-final` 必须等待真实 `public-detail-shell` 且 route gate 消失。官方 Linux修正复核为 5/5，20 张详情图全部重生成，1440/390 样本已逐张打开确认真实详情内容。

## 4. 当前边界与第一条命令

已解决：Playwright 配置合同测试保留，且已从 frontend application TypeScript graph 正确隔离；frontend typecheck exit 0。

已解决：full frontend Vitest 单独串行最终复核为 85/85 files、401/401 tests，exit 0；此前资源争用假设不再作为 blocker。

唯一下一原子动作：保持 P6 / P6-T6 / Step 7，完成最终 diff/凭据安全/checkpoint identity 审查，随后 commit/push 并观察新的普通 CI。

第一条验证命令严格为：

```powershell
git diff --check
```

之后严格按顺序：

1. 运行 `git diff --check` 并完整审查 source/test/workflow/evidence/ledger diff。
2. 执行凭据安全检查，但不得读取 `.git` 私钥或回显任何 secret 值。
3. fresh rebuild checkpoint，并确认 saved/fresh/manifest identity 一致。
4. 保持 30/10/4 和 P6-T6 Step 7，commit/push 当前 WIP 到 `main`。
5. 观察新的普通 CI 至真实终态，完整读取所有步骤与 exit/result。
6. 新普通 CI 全绿后仍不得自动 dispatch release；先只读验证 GitHub 身份，再取得新的明确授权。

当前待复核 checkpoint root 为 `F670579E213E5E53C2F149C69A94C8E7CA0670C5A79B6C45DBE173767A46C912`，真实派生边界仍为 30/10/4。必须在账本同步后再次 fresh rebuild，并重跑 `test:execution`、startup 与 handoff；任何后续 source/traceability 修改都必须重算，不得沿用本 root 冒充新鲜。

## 5. 已批准视觉方向

用户已批准当前方向并明确要求：手机端不过度拥挤；登录出现时圆环自然左移；左侧标题自然淡化、后退让位并有层次；保持高帧率；四圈持续自然转动；删除中心发光光球；中心只保留 `05 / 此刻正在发生`。

已真实打开复核 1440×900 与 390×844 rest/login、day/night 稳定帧。390 最外轨完整入窗且底部约 16px，无 overflow；night 登录为深色；登录标题后退；650ms 间隔 transform 不同，证明轨道继续转动。

禁止恢复中心光球、ADR-028 offset ellipse/right crop、白色 night 登录框、右下 pause pill、47/59/68/79/87 MotionPath、旧静态轨道或被拒候选。Impeccable detector 历史上已经且仅运行一次，绝不重跑。

## 6. 发布与外部授权边界

- GitHub Actions 中只确认 `UHUB_USERNAME`、`UHUB_PASSWORD` secret 名存在；不得读取、输出或记录值。
- 用户此前仅授权一次 `1.0.0` dispatch，已被失败 run `32796276478` 消耗。第二次 release 尚未获授权。
- 只有本地完整门禁、合法 checkpoint/evidence、commit/push、新普通 CI 全绿和 GitHub 身份只读验证都通过后，才请求“且仅一次额外 `1.0.0` dispatch”的最小授权。
- 授权前不得运行 release；授权后只运行一个串行实例并等待真实结果。
- 正式发布主线仍是 GitHub Actions → UHub。华为 SWR 只作为已知私有仓库，不得在没有新批准/ADR 时替换正式主线。
- production hostname 为 `lifeops.chenspace.com`；用户拥有 `chenspace.com`/`www.chenspace.com`。DNS/TLS 外部状态未验证时不得声称生产可访问。
- production values 的 Web/API digest 在真实 release 前必须保持明确待填，不能用 tag、本地 image ID 或伪造 digest 代替。

## 7. 镜像、数据库、网关与默认部署架构真相

项目自建镜像严格为两个：

1. `lifeops-web`：React 静态产物，镜像内由 `nginx:1.30.4-alpine3.24` 提供静态页面。
2. `lifeops-api`：Fastify API；同一个镜像复用于 PreSync migration Job（`node dist/migrate-main.js`），不额外制作 migration 镜像。

MySQL 不属于项目自建镜像：chart 内置时使用官方 `mysql:8.4.10`；也支持 `mysql.enabled: false` + `externalDatabase`。当前应用没有 Redis 依赖、Redis chart 或 Redis 镜像；会话、幂等和核心状态由 MySQL 持久化。

Gateway API 是 Kubernetes 路由规范。Envoy Gateway 或 NGINX Gateway Fabric 是用户集群中单独安装的 controller。Web 镜像内的 Nginx 只服务静态文件，绝不包含 Gateway controller。当前 HTTPRoute 以 `/api` 指向 API Service、`/` 指向 Web Service；更换 controller 修改 parentRef/namespace/NetworkPolicy/values，不重做应用镜像。

默认 chart 拓扑：Web Deployment 2 pods + ClusterIP；API Deployment + HPA min 2/max 6 + ClusterIP；PreSync migration Job 复用 API image；可选内置 MySQL 单副本 StatefulSet + headless Service + 10Gi RWO PVC；媒体使用 RWX filesystem 或 S3；并包含适用的 NetworkPolicy、PDB、监控资产。

内置 MySQL 是单实例、非 HA，只适合本地 VM、演示、小规模或明确接受风险的场景。真正生产应根据现有平台选择外部托管 RDS、独立 VM 上的二进制 MySQL，或用户自管 HA/Operator MySQL。不要把 MySQL 二进制直接装在 K8s worker 节点上充当 LifeOps 生产数据库。

## 8. 已批准的最终部署手册验收合同

用户已明确批准本节，不要再次请求设计批准。手册在 P6-T7/P6-T8 的既定顺序内实现，不得提前跳过 P6-T6。开始写手册前，先把本节正式同步到 P6 工作包、source registry、acceptance matrix 与 traceability，使其成为可执行的原子验收合同，而不是只存在于交接文字。

目标：交付一份思路清晰、通俗、完整、可操作，并能适配陌生本地 VM、裸金属或云上 Kubernetes 集群的部署手册。它不是一份只对当前测试集群有效的命令清单。

### 8.1 先解释“是什么”和“为什么这样选”

- 解释为什么只制作 Web/API 两个自有镜像，为什么 migration 复用 API image。
- 区分 Web 静态 Nginx、Gateway API 规范、Envoy Gateway/NGINX Gateway Fabric controller。
- 解释内置单实例 MySQL 与外部生产 MySQL 的取舍、适用边界、风险和迁移路线。
- 解释当前为什么没有 Redis；只有出现有证据的缓存、跨副本短期状态、队列或分布式限流需求，并完成 ADR、一致性/故障/回退设计后才允许引入。

### 8.2 陌生集群必须 capability-first

让用户在自己的终端执行只读预检，并解释预期结果和分支：Kubernetes 版本/CPU 架构、节点、Gateway API/Ingress、LoadBalancer/MetalLB/外部 LB、DNS/TLS、StorageClass 动态供给、RWO/RWX、Secret/ExternalSecret、监控、镜像仓库访问。

Codex 不读取 kubeconfig，也不替用户执行 kubectl、Helm install、Argo sync/rollback 或 cluster smoke。手册必须明确分开“平台前置条件”和“LifeOps 应用交付”。

### 8.3 数据库分支

- 内置官方 MySQL 8.4.10 单副本 StatefulSet + RWO：用于本地/小规模/风险接受环境。
- 外部托管 RDS：用于已有云数据库能力的生产环境。
- 独立 VM 二进制 MySQL：适合本地虚拟化或传统基础设施，但数据库运行在独立主机，不装在 worker 节点。
- 用户自管 HA/Operator MySQL：适合有成熟数据库运维能力的环境。

每个分支都说明 Secret/TLS、网络、备份恢复、升级、连接限制、故障边界和从内置实例迁出的步骤。不要把单副本 StatefulSet 写成“高可用 MySQL 集群”。

### 8.4 媒体存储分支

- 多副本 API + filesystem 必须使用 RWX（如 NFS/CephFS 等）。
- 陌生集群没有 RWX 时优先使用 S3/兼容对象存储。
- 只有本地/小规模且明确接受限制时，才提供单副本 API + RWO 的有界方案。
- 不得绕过 chart 对“多副本 API + 非 RWX filesystem”的安全拒绝。

### 8.5 入口和控制器分支

- 推荐 Gateway API + Envoy Gateway。
- 说明如何适配 NGINX Gateway Fabric：修改 controller、parentRef、namespace、策略和 values，不重做 Web/API 镜像。
- Gateway API 不可用时提供与真实 chart 资产一致的 Ingress 兼容方案；不能只写概念而没有资源/values 映射。
- 解释 LoadBalancer、MetalLB、外部 LB、DNS 和 TLS 各自负责什么。

### 8.6 扩展性与扩容方法

必须说明 Web/API 水平和垂直扩容、API HPA 当前 min 2/max 6、requests/limits、PDB、反亲和/拓扑分布、Gateway 容量、数据库连接数、数据库性能和媒体吞吐之间的约束。

不要编造统一硬件规格或固定 QPS。给出基于实际指标的判断和公式，例如：

`API 最大数据库连接需求 = API 最大副本数 × 每副本连接上限 + migration/admin 余量`

说明何时增加 pod、何时提高单 pod 资源、何时扩数据库、何时从 filesystem 迁移 S3、何时从内置 MySQL 迁移外部 HA 服务，以及如何验证扩容没有破坏会话、幂等、媒体和迁移安全。

### 8.7 手册结构和可操作性

最终手册至少按以下顺序组织：

1. 术语、镜像和架构图
2. 集群能力矩阵与选择决策树
3. 平台前置条件
4. imagePullSecret、应用/数据库 Secret 或 ExternalSecret
5. MySQL、媒体存储、入口 controller 三组选择分支
6. 填入真实 Web/API immutable digest
7. Helm lint/render/schema 预检
8. 用户通过 Argo CD（推荐）或 Helm 部署
9. migration Job、Web/API/MySQL 工作负载顺序
10. HTTPRoute/Ingress、DNS、TLS
11. 健康、登录、写入、重启、exact-digest smoke
12. 监控、日志、告警、备份恢复
13. 升级、回滚、故障排查
14. 水平/垂直扩容与组件迁移

每条命令都必须：使用占位符；说明在哪台机器/哪个目录执行；给出预期输出、失败含义和安全回退。不得让用户把凭据粘贴到聊天，也不得把明文 Secret 写入 Git。

每个分支必须映射到仓库真实 Helm values、templates 和资源（Deployment、Service、HTTPRoute/Ingress、StatefulSet、Job、PVC、NetworkPolicy、PDB、HPA、ExternalSecret 等），并通过文档链接检查、Helm lint/render/schema、示例配置和用户可执行 smoke 清单验证。正式 digest 未产生前只能保留清晰占位符。

## 9. P6-T6 之后的连续执行顺序

P6-T6 合法通过后，连续执行 P6-T6 task-close → deterministic checkpoint → handoff/startup → P6-T7 → P6-T8 → P6 phase-close → project-close。始终只保持一个 task in progress，按 checkbox 顺序严格 TDD；环境、语法、依赖或连接失败不算 behavioral RED。

每个 task 都要同步 task-execution、evidence-manifest、requirements、work-package checkbox、execution-control、CURRENT、S022/后续 session 与本接班文件；重算 deterministic checkpoint；完整读取 focused/full/MySQL/image/Helm/security/browser/visual gate 的输出和 exit code。

## 10. Web-owned 边界与 project-close 真值

本项目只负责 Web/API/MySQL 应用 schema、双 immutable images、UHub 发布证据、digest-bound SBOM/provenance、exact-digest image smoke，以及应用级 Helm/GitOps/Argo 示例和部署手册。

不读取 kubeconfig，不执行 kubectl、Helm install、Argo sync/rollback、cluster smoke，不搭建或修改用户 Kubernetes 集群，也不调用已退役的 `build-ha-k8s-platform`。Argo `Synced/Healthy` 和 cluster smoke 是用户部署证据，不阻塞 Web-owned 完成。

只有以下全部真实满足，才允许 project-close：

- 所有适用 atomic rows 合法 roll up 到 44/44
- Web/API 两个 immutable UHub digest 真实存在
- digest-bound SBOM/provenance 可验证
- exact-digest image smoke 通过
- Helm/GitOps/部署手册与用户 handoff 已验证
- 没有伪造 Git、Docker、GitHub Actions、UHub、digest、attestation、DNS/TLS 或网络状态

最终只给用户短、证据化的完成结论和精确的用户侧部署下一动作；在真实视觉决定或外部授权边界之外，不要中途交还。
