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
   - `D:\笔记\项目\LifeOps-高可用K8s平台\DECISIONS.md` 中 ADR-016 至最新 ADR-030
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

- final redesign：`C00CFBE41E670CD7D1F9018D1ADA6D289B60285740A0F4034C3666AF9C35ED09`
- life domain：`ADF4BCD234D43035B1115864FE3579CAE7CC61C341E1142F6B3203C0A3E9CC24`
- execution completeness：`43ECB091350925A90620E3D88E778F8F6AD6E547B11CDB5D806248E92D07B112`
- image delivery boundary：`63F3D2903D6BDC98A2C04C2DDC111D69AA9D8A8A97766B98899918A1D49800B6`
- master plan：`C30EB0BD774F8B40B570EB74564FD57111126E9E6CCDBBE77865F8414F5554FC`

任何无法由已批准变更解释的哈希差异都是停线条件。

## 2. 当前权威执行状态

- authority revision：ADR-030
- status：`implementation-active`
- active tuple：P6 / P6-T6 / Step 7
- 最后可信完成边界：30/44，即 30 `verified-local` + 10 `partial` + 4 `pending`
- 当前 WIP 已由新鲜完整本地门禁和合法哈希收敛重新派生为 30 `verified-local` + 10 `partial` + 4 `pending`
- registry-bound P6-T6 原子仍未满足；本地收敛不提升 30/10/4，也不声称发布完成
- matrix：44 parents / 52 surfaces / 1,427 atoms
- evidence manifest：462 条既有 evidence rows

最新本地完整门禁 checkpoint：

`outputs/evidence/source-checkpoints/2026-08-27-p6-t6-ci7-motion-owner-push-authorization-soft-pause-uncommitted-local-checkpoint.json`

- root：`193D84A3CEDFA5C1B4DE2C0D68034EB721D4BA328991460D74C23AA2D723DDD7`
- 607 sorted inputs，其中三份 `public/*.svg` 均被纳入生产源 checkpoint
- 保存值与 fresh rebuild 一致；manifest checkpoint 相同
- 462 条 source/artifact hash 只在完整 frontend/server/MySQL/Helm/security/image/browser/visual 门禁真实通过后收敛

## 3. Git、CI 与远端事实

- 私有仓库：`Chen0125-a/lifeops-web`
- 分支：`main`
- 最新产品实现提交：`39c99cd81b2274badc54e6a9d867e70ab3ae55a2`；包含本文件的最终窄账本提交创建后将成为本地 `HEAD`；origin/main 在获批 push 前保持 `bf1ad3b9d05ba2d315526b460be3423b44e6648d`
- 仓库级 deploy key 私钥只在 `.git` 内且未提交；不得读取或输出内容
- 临时 bootstrap refs 已清理
- 用户明确授权后，实现/证据提交 `d6f2c73...` 与窄账本提交 `bf1ad3b...` 已通过一次 `git push origin main` 成功推送；当次远端只读回读精确匹配 `bf1ad3b...`。该 push 授权已消耗；没有 dispatch release。
- GitHub CLI 已保存 token 仍无效；内置浏览器已由用户自行登录，只读身份核对为 `Chen0125-a`。Codex 未读取或填写凭据、OTP、Cookie、token 或私钥。

包含本文件的最终窄账本/checkpoint 提交精确包含：

- `docs/handoff/NEW_TASK_CONTINUATION_PROMPT.md`
- `docs/superpowers/plans/2026-08-09-execution-control.md`
- `docs/traceability/evidence-manifest.json`
- `docs/traceability/requirements.md`
- `docs/traceability/task-execution.json`
- `outputs/evidence/source-checkpoints/2026-08-27-p6-t6-ci7-motion-owner-local-full-gates-uncommitted-local-checkpoint.json`
- `outputs/evidence/source-checkpoints/2026-08-27-p6-t6-ci7-motion-owner-push-authorization-soft-pause-uncommitted-local-checkpoint.json`
- `outputs/final/visual-evidence-manifest.json`

历史 `outputs/evidence/browser/p6-t6-ci6-full-browser-failures/` 与 `outputs/evidence/source-checkpoints/2026-08-27-p6-t6-ci7-webkit-motion-engine-change-control-soft-pause-uncommitted-local-checkpoint.json` 保持本地 untracked，不属于上述提交。

不得擅自还原被测试重生成的 `outputs/evidence/browser/p5-t5/quick-create-1440x900.png`；先打开复核，再按合法证据流程处理。

普通 CI run `32800641280`（revision `c387e7c...`）耗时 50m54s：MySQL、unit、typecheck、production build 通过；浏览器步骤 279 passed / 56 failed。

- 52 项：workflow 只安装 Chromium，却执行 Firefox/WebKit，属于真实环境覆盖缺口。
- 4 项 Chromium 真问题：登录淡出标题对比度、149.9ms 主题帧超过未改变的 133.4ms 门、runner 时区导致计划稿缺失、Quick Create 原 opener 被替换后焦点未恢复。

本地提交 `ebd163c...` 已覆盖三浏览器安装、`Asia/Shanghai`、detached opener 焦点、登录期间 hero copy `aria-hidden`、主题层 compositor 准备和 WebKit 前台稳定采样。没有放宽 worker、retry、阈值、采样时间、视觉几何或动效速率。

新鲜完整 GREEN：frontend typecheck、86/86 files 与 411/411 Vitest、884-module production build；server 361 passed +50 exact-integration skips、typecheck/build；官方 MySQL 8.4.10 50/50；Helm/workflow/security/audit/current-source images/data rehearsal；官方 Linux remote browser 12/12；Lighthouse 1.00/1.00/0.96/0.91；官方 Linux Playwright 335/335（WebKit theme 1/1 + Firefox theme 1/1 + full matrix 333/333，26.1m，workers=1、retries=0）。Web 最终镜像内三份 public SVG 均存在且非空。8 张当前 CI7 1440×900/390×844 day/night rest/login 图和 4 张 regenerated contact sheets 已逐张按原分辨率打开确认。

## 4. 当前边界与第一条命令

已解决：Playwright 配置合同测试保留并从 frontend application TypeScript graph 正确隔离；frontend typecheck exit 0，full frontend 为 86/86 files、411/411 tests。

已解决：CI #7 WebKit cadence 失败已按 ADR-030 的九节点窄所有权例外关闭；detached opener、64ms reduced-motion entry carry、lazy record preview、WebKit settled-opacity sampling、Web `public/` 镜像复制与 checkpoint `public/` 覆盖均已按原强度 TDD 复核。

唯一下一原子动作：保持 P6 / P6-T6 / Step 7。若包含本文件的窄账本提交尚未创建，先运行最终 execution/startup/handoff、saved/fresh/manifest、五份 authority、diff/JSON/凭据安全 staged 审计并提交精确八路径；该提交一旦存在，下一动作就是取得新的明确授权后才可 push 两个本地提交。不得 dispatch release。

第一条验证命令严格为：

```powershell
npm.cmd run test:execution
```

## 24. 2026-08-28 最新接班增量：普通 CI #9 单点失败与完整本地收敛

- 本节是当前最新覆盖，优先于上文 CI #8/#7 的旧下一动作。此前授权的 CI #8 两笔提交已经推送且授权已消耗；当前 `HEAD` 与 `origin/main` 均为 `10a86adb271f849dcf91bf46d7b09265aa829127`。普通 CI run `33137867114` / job `98741846244` 在 unit、frontend typecheck、production build、精确 MySQL 通过后，仅 dedicated WebKit theme-performance 失败：baseline P95 19ms、transition P95 88ms、未改变预算 36ms、max 88ms 低于未改变 ceiling 100ms。后续 Helm/workflow/image tail 被跳过；没有 release。
- 当前 WIP 保持所有原强度门禁，完成原子主题表面、缓存星空解码边界、受控路由预加载/入场、单次 motion 采样、trace observer 边界和原子 browser artifact 写入。Lighthouse 在直接页面健康与 raw A/B 证明 Docker 64MiB `/dev/shm` target crash 后，仅增加标准 `--disable-dev-shm-usage` fallback；JavaScript、图片、web security 与四项预算均未关闭。
- 新鲜完整本地证据：frontend 88/88 files、425/425 tests、typecheck、884-module build；server 361 ordinary +50 exact-only skips、typecheck/build；官方 MySQL 8.4.10 exact 50/50；官方 Linux Playwright 335/335（WebKit theme 1 + Firefox theme 1 + matrix 333，workers=1/retries=0）；real-Fastify 12/12；Helm/media/security/observability/workflow/release contracts；root/server production audit；current-source 双镜像与 `image-smoke: ok`；16-migration rehearsal；Lighthouse 1.00/1.00/0.96/0.91。8 张当前 1440×900/390×844 day/night rest/login 图已逐张原分辨率打开通过。
- 462 evidence rows 保持逻辑 ID 与顺序并按磁盘当前 source/artifact 合法重绑。checkpoint 为 `outputs/evidence/source-checkpoints/2026-08-28-p6-t6-ci9-browser-local-full-gates-uncommitted-local-checkpoint.json`，root `DC411F68A7D1A11140E97FA228C4B3509CD1AFD977AD0F604A2619DAA0F34B72`，609 sorted inputs。父边界仍为 30/10/4，P6-T6 Step 7 因正式 UHub digest、digest-bound SBOM/provenance、exact-digest smoke 与 release success 不存在而开放。
- 当前唯一下一动作：完成 execution/startup/handoff、saved/fresh/manifest、五份 authority、JSON/diff/credential-safe 审计；只清理明确 owned CI9 Docker 资源；创建本地实现/证据提交，再按 post-commit source root 重绑并创建窄账本提交。任何新 push 与额外 `1.0.0` dispatch 分别需要新的明确授权；不得进入 P6-T7。

```powershell
npm.cmd run test:execution
```

之后严格按顺序：

1. 运行最终 `test:execution`、独立 startup 与 handoff，并读取完整输出和 exit code。
2. 重建 fresh checkpoint，核对 saved/fresh/manifest identity 与 462 ID 顺序。
3. 重算五份 authority SHA-256，运行 `git diff --check`、JSON 与 credential-safe WIP audit。
4. 若最终窄账本提交尚未存在，只暂存上述八个精确路径，复核 cached path/diff/凭据后创建该提交。
5. 停在新的 `MAIN_PUSH_AUTHORIZATION_REQUIRED` 外部边界；没有新授权不得 push。新普通 CI 全绿后仍需独立 release 授权。

当前 CI7 push-authorization checkpoint root 为 `193D84A3CEDFA5C1B4DE2C0D68034EB721D4BA328991460D74C23AA2D723DDD7`，607 inputs；462 evidence rows 已合法收敛，真实派生边界仍为 30/10/4。实现/当前证据提交为 `39c99cd81b2274badc54e6a9d867e70ab3ae55a2`，包含本文件的精确八路径提交是最终窄账本原子；`origin/main` 在新 push 授权前仍为 `bf1ad3b...`。任何后续 source/traceability 修改都必须重算。

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

## 11. 2026-08-26 最新接班增量：认证 CI 失败与本地修订

- GitHub 可见浏览器登录已完成，只读身份验证为 `Chen0125-a`。普通 CI run `32964834996` / job `98164958219` 对应 `97f68ff3af81b2675229f95c4b367e806472a7d4`，36m26s 后失败：MySQL、unit、typecheck、build 通过，Playwright 329 passed / 6 failed；后续 Helm/workflow/image 步骤跳过。没有 dispatch release。
- 六项为：Chromium 登录标题淡出采样、Chromium-768 登录中间态 Axe 对比度、Firefox 主题帧、WebKit 两条路由帧数及 WebKit 主题帧。官方容器 focused 诊断证明产品在原门槛下可达，问题是独立过渡完成条件和 Firefox/WebKit 前台 rAF 稳定窗口不足；WebKit 曾在 600ms 内只有两帧原始样本，warm-up 切片后为空。
- 当前未提交修订只改测试：登录 depth/Axe 在批准的最终 opacity 后采样；共享 `waitForStableFrameCadence` 要求两个连续、时长不变的前台稳定窗口并从 driver 重申 `bringToFront()`；主题采样拒绝空数组；WebKit 私有路由使用相同前置条件。未改变产品源码、worker、retry、浏览器项目、阈值、采样时长、几何或动效速率。
- 新鲜完整本地通过：frontend typecheck；85/85 Vitest files、401/401 tests；production build 883 modules；server 361 ordinary + 50 exact-only skips、server typecheck/build；官方 MySQL 8.4.10 50/50、16 migrations、关闭后无进程/监听；Helm/media/security/observability/workflow/P6-T6 release contracts；root/server audit 0 vulnerabilities；current-source Web/API image smoke；dump/restore rehearsal；Firefox theme 3/3；WebKit critical 25/25；官方 Linux full Playwright 335/335、24.2m、workers=1/retries=0；real-Fastify 12/12；Lighthouse 1.00/1.00/0.96/0.91。七张 ADR-029 最终图已按原分辨率重新打开并通过。
- 当前仍是 P6 / P6-T6 / Step 7，30 verified-local / 10 partial / 4 pending。`main`/`origin/main` 仍为 `97f68ff...`；本次修订尚未 commit/push。旧 CI-auth soft-pause checkpoint 保留作历史，新权威 checkpoint 将写入 `outputs/evidence/source-checkpoints/2026-08-26-p6-t6-ci-browser-remediation-local-full-gates-uncommitted-local-checkpoint.json`。
- 唯一下一动作：合法重绑 462 evidence rows，构建并复核 saved/fresh/manifest checkpoint identity，运行 execution/startup/handoff、diff 和凭据安全审计后本地提交。再次推送精确 GitHub `main` 必须取得新的明确授权；推送后观察新普通 CI 全绿。此前 release 授权已被失败 run `32796276478` 消耗，不得 dispatch 或提前进入 P6-T7。

## 12. 2026-08-26 最新接班增量：本地 remediation checkpoint 已收口

- 462 条 evidence rows 已合法重绑；saved、两次 fresh rebuild 与 manifest checkpoint 四方一致，root 为 `C4C31E4AB631259D86F5D1C83A7C04352E77DC342031686488C018531576D982`，602 个 ordinal-sorted inputs。旧 CI-auth pause checkpoint 作为历史保留。
- `test:execution` 95/95、独立 startup、独立 handoff 均 exit 0；两种模式一致报告 ADR-029、P6 / P6-T6 / Step 7、30/10/4 和 `C4C31E4...D982`，无 issue。五份 authority 哈希仍逐项精确匹配。
- `git diff --check` exit 0，仅有 Windows 行尾提示；凭据安全审计覆盖 15 个变化路径、0 findings。结构化核对确认 462 evidence IDs 无增删或重排、artifact hash 无变化。
- 唯一下一动作：只暂存这 15 个已审路径，复核 cached path/diff/凭据后创建本地 remediation commit。新的 `main` push 必须取得新的明确授权；不得 dispatch release 或提前进入 P6-T7。

## 13. 2026-08-26 最新接班增量：本地提交与新 push 授权暂停

- 15 个已审路径已在 `main` 提交为 `0b445f9dad262b9355e91655a8f32e1e592ed1bb`（`test(e2e): stabilize CI browser sampling`）。提交前 staged 15/15 精确匹配、0 unstaged/untracked、cached diff exit 0、credential audit 0 findings；产品源码未改变。
- 本地 `main` 领先 `origin/main` `97f68ff3af81b2675229f95c4b367e806472a7d4` 一个提交。traceability blocker 已切换为 `MAIN_PUSH_AUTHORIZATION_REQUIRED`。
- 新 pause checkpoint 为 `outputs/evidence/source-checkpoints/2026-08-26-p6-t6-ci-browser-remediation-push-authorization-soft-pause-uncommitted-local-checkpoint.json`，root `5617FA459934DC3AB50E7DBAEFE5360C60C232D050F8574F44A8C60A4D8B8ED8`，602 inputs、462 evidence rows、247 cumulative task paths；边界仍为 30/10/4。
- 唯一下一动作：验证 saved/fresh/manifest、execution/startup/handoff、diff/凭据审计后提交窄账本；随后取得新的明确授权，才可把两个本地提交推送到精确 GitHub `main`。不得 dispatch release 或提前进入 P6-T7。

## 14. 2026-08-26 最新接班增量：remediation 已推送，普通 CI #6 五项失败软暂停

- 用户明确授权的精确 push 已执行并消耗：`0b445f9dad262b9355e91655a8f32e1e592ed1bb` 与 `12f8899429070bbf21cf981142dd596c46213fae` 已推送到 `https://github.com/Chen0125-a/lifeops-web.git` `main`；独立 `git ls-remote`、本地 HEAD 与 `origin/main` 在本次暂停写入前一致为 `12f8899...`。没有运行 release。
- 内置浏览器身份只读验证为 `Chen0125-a`。普通 CI run `32981072818` / job `98217589919` 运行 38m43s 后失败：unit/typecheck/build/MySQL/browser install 通过，Playwright 330 passed / 5 failed，后续 Helm/workflow/image build 跳过。
- 五项失败：Chromium 1024/390 登录对话框 accessibility；Firefox critical 主题帧；WebKit critical 私有路由连续性；WebKit critical 主题帧。WebKit 路由仅 7/10 帧。WebKit 主题的最终失败路径又因 `tests/helpers/motionProbe.ts` 使用不存在的 `minimum` 而不是 `minimumFrames` 抛出 `ReferenceError`，掩盖完整 cadence 诊断；不得标为 flaky/green。
- 当前仅暂停账本/checkpoint 是 WIP，尚未修改产品或测试代码。新 checkpoint：`outputs/evidence/source-checkpoints/2026-08-26-p6-t6-ci-run-32981072818-five-failures-soft-pause-uncommitted-local-checkpoint.json`，root `070852E43BFC990D89376C9B42E172457439F0A1E27A8D39FAC6E2731CAFC108`，602 inputs、462 evidence rows、248 cumulative task paths。边界保持 30/10/4。
- 唯一下一原子动作：新建 `src/motionProbeContract.test.ts`，强制 helper 的最终超时分支并首先运行 `npm.cmd test -- src/motionProbeContract.test.ts` 获取预期 RED；随后只做 `minimum` → `minimumFrames` 最小修正，再继续原强度失败诊断。任何新 push 与 release dispatch 都分别需要新的明确授权。
- 暂停门禁已完成：saved/fresh/fresh/manifest 均为 `070852E4...FC108`；最终 execution 95/95，startup/handoff exit 0；五份 authority 哈希、JSON、diff check 与 8 文件高置信凭据扫描通过，0 findings；462 evidence IDs/artifact hashes 未变化。当前仅 5 个 tracked ledger 文件与 1 个新 checkpoint 为未提交 WIP，另有 CURRENT/S022 两个 Obsidian 项目账本更新；没有产品/测试代码修改、commit、push 或 release。

## 15. 2026-08-27 最新接班增量：CI #6 remediation 完整本地复核

- 五项 CI #6 失败已在不改变 worker、retry、阈值、采样时长、视觉几何或动效速率的前提下修复；detached opener 焦点、Node/前端 TypeScript 工程边界、Web `public/` 镜像复制和 checkpoint `public/` 覆盖也以行为合同关闭。
- 新鲜门禁为 frontend 86/86、408/408、typecheck/build；server 361 +50 skips、typecheck/build；官方 MySQL 50/50；官方 Linux Playwright 335/335（1+1+333，23.8m）；real-Fastify 12/12；Helm/security/workflow/audit/images/data/Lighthouse 全绿。8 张最终图已逐张打开。
- 462 evidence IDs 与 HEAD 完全同序，manifest validator 0 issue。saved/fresh/manifest 为 `ECB7E65BA5C00AD9E9C635029105046C4D337F546F8E1DB244BC0A43740522A9`，606 inputs，明确包含三份 `public/*.svg`；边界保持 30/10/4，P6-T6 Step 7 checkbox 仍未勾选。
- `test:execution` 95/95。唯一下一动作是完成独立 startup/handoff、authority/diff/JSON/credential audit 后创建本地实现/证据与窄账本提交。任何新 push 和任何 release dispatch 都分别需要新的明确授权。

## 16. 2026-08-27 最新接班增量：本地实现提交与 push 授权 checkpoint

- 30 个已审实现/当前证据路径提交为 `d6f2c73764d7a9ef1122f1c968a348510cbe169f`（`fix(ci): close browser and image evidence gaps`）。cached diff 通过；7 个未引用的自动失败诊断制品仅从 index 撤下，文件仍在本地 untracked，不删除、不进入 462 行 manifest。
- `origin/main` 仍为 `12f8899429070bbf21cf981142dd596c46213fae`。新的窄账本 checkpoint 为 `outputs/evidence/source-checkpoints/2026-08-27-p6-t6-ci6-remediation-push-authorization-soft-pause-uncommitted-local-checkpoint.json`，root `BF75B8BCAE61911192F496A8CBB76A0B0EB17E9A9222B52CCF87E840782FA99E`，606 inputs、462 同序 evidence rows；边界仍为 30/10/4。
- 唯一下一动作是最终 execution/startup/handoff、identity/authority/diff/JSON/credential staged 审计后创建窄账本提交。随后必须停在新的 push 授权边界；不得 push 或 release。

## 17. 2026-08-27 最新接班增量：CI #7 WebKit 合成诊断与动效所有权批准边界

- 用户授权的 `main` push 已执行并消耗。`HEAD`、`origin/main` 与远端 `main` 均为 `bf1ad3b9d05ba2d315526b460be3423b44e6648d`。普通 CI `33046420164` 仅在 dedicated Linux WebKit theme-performance 失败：600ms 前台稳定窗观察到 6 帧；MySQL、unit、typecheck、production build 已通过。未 dispatch release。
- 当前 tracked 产品 WIP 仅为 `src/components/public/PublicOrbit.tsx` 与 `src/pages/PublicHomePage.tsx`：增强星盘 memo 化、父 theme 不再触发重渲染、返回状态读取实时 DOM theme。focused 33/33、frontend typecheck exit 0。`outputs/evidence/browser/p6-t6-ci6-full-browser-failures/` 仍为保留的 untracked 用户制品，不得删除、移动或暂存。
- owned 官方 Playwright 容器已证伪 GSAP-only 的多 timeline、单 ticker/quickSetter、继承变量、2D、will-change、headed Xvfb、round-robin、Canvas 与普通坐标候选，均约 3–8 帧/600ms；失败候选均已从产品源码撤销。原生 Web Animations 能跨过 cadence 前置条件，但主题预算仍需继续 TDD，而且会修改 ADR-022/029 的 GSAP 独占合同。
- 最新 soft-pause checkpoint 为 `outputs/evidence/source-checkpoints/2026-08-27-p6-t6-ci7-webkit-motion-engine-change-control-soft-pause-uncommitted-local-checkpoint.json`，root `EF1B87367692F0F8BA22CB858BB046E2F0198FC75EFCEE08D6C3811241E9C324`，606 inputs，saved/fresh byte-identical。evidence manifest 仍绑定最后可信 `BF75B8B...FA99E`，不得洗绿；30/10/4 是最后可信边界。
- 唯一下一动作是取得用户明确窄批准：仅四个持续 ring rotation 与五个 upright counter transform 改由原生 Web Animations；GSAP 继续独占标题、入轨、登录、场景与孔径，且任何节点不得双引擎争抢。批准后先同步 ADR/spec/plan/source registry/acceptance matrix/requirements，再重跑同一正式 WebKit RED 后实现。批准前不得继续该实现、push、release 或进入 P6-T7。
- 软暂停门禁保持诚实非绿：saved/fresh checkpoint 在 606 inputs 上 byte-identical，root `EF1B87367692F0F8BA22CB858BB046E2F0198FC75EFCEE08D6C3811241E9C324`；`test:execution` 93/95、exit 1；startup exit 1，blockers 为 `MANIFEST_CHECKPOINT_STALE`、`EVIDENCE_CHECKPOINT_STALE`、`EVIDENCE_SOURCE_HASH_MISMATCH`；handoff exit 1，另含 `HANDOFF_REQUIREMENT_STATUS_MISMATCH`。临时 44 `invalidated` 只是当前 WIP 的 validator 派生状态，不覆盖最后可信 30/10/4。不得通过重写旧 evidence hash、parent status、push 或 release 状态越过上述动效所有权授权边界。

## 18. 2026-08-27 最新接班增量：ADR-030 窄动效所有权例外已批准并正式化

- 用户明确批准：原生 Web Animations 仅独占四个持续 ring rotation 与五个 upright counter transform；GSAP 继续独占标题、分组/对象入场、登录、公开详情连续性、场景与孔径，任何节点或 transform 属性不得存在引擎/CSS 竞争所有者。该批准不授权 push 或 release。
- ADR-030、final redesign、master plan、P6-T6 工作包、source review/registry、acceptance matrix 与 requirements 已同步。锁定 authority hash 现在为 final redesign `C00CFBE41E670CD7D1F9018D1ADA6D289B60285740A0F4034C3666AF9C35ED09`、master plan `C30EB0BD774F8B40B570EB74564FD57111126E9E6CCDBBE77865F8414F5554FC`，其余三份不变。
- 生成器回归先真实暴露七个 ADR-029 dedicated atoms 会在 rebuild 中被删除，修复后 7/7 由生成器稳定产生；第二个 RED/GREEN 锁定 ADR-030 authority/execution clauses 与 `MOTION-01.PUBLIC_HOME.MOTION.04` 的双向映射。当前为 2,876 clauses、44 parents、52 surfaces、1,427 atoms（783 original + 644 life），零覆盖缺口。
- evidence manifest 仍故意绑定最后可信 checkpoint；authority/product WIP 在完成正式 WebKit RED、九节点 owner 合同 RED/GREEN、完整回归与新 checkpoint 前继续派生为 invalidated，不得机械恢复 30/10/4。
- 唯一下一原子动作：新增 `PublicOrbit` 动效 owner 合同测试并获取预期 RED，同时在 owned 官方 Linux WebKit 环境复跑未改变的主题 cadence 门禁取得性能 RED；之后才实施最小 WAAPI owner 迁移。任何新的 `main` push 与任何 `1.0.0` dispatch 都分别需要新的明确授权；不得进入 P6-T7。

## 19. 2026-08-27 最新接班增量：ADR-030 实现、完整本地门禁与证据收敛

- ADR-030 九节点 owner 合同和正式 Linux WebKit cadence RED/GREEN 已完成。原生 Web Animations 仅写四个 ring rotation 与五个 upright counter transform；GSAP 继续独占其余 public motion。附带收口包括 RouteStage 进入/退出分离、64ms reduced-motion entry carry、Markdown preview 懒加载及 WebKit settled-opacity 零剩余 animation 采样边界；worker、retry、阈值、采样时间、几何、周期和动效速率均未放宽。
- 新鲜完整门禁：frontend 86/86 files、411/411 tests、typecheck、884-module build；server 361 ordinary +50 exact-only skips、typecheck/build；官方 MySQL 8.4.10 50/50；官方 Linux Playwright WebKit theme 1/1 + Firefox theme 1/1 + full matrix 333/333（26.1m，workers=1/retries=0）；官方 Linux real-Fastify remote 12/12；Helm/media/security/observability/workflow/release contracts、root/server production audit、current-source 双镜像 smoke、16-migration data rehearsal 与 Lighthouse 1.00/1.00/0.96/0.91 全部 exit 0。Windows-host remote 仅因 restricted non-GUI sandbox 无法启动 headed Firefox，未冒充 behavioral RED 或 GREEN。
- 8 张 CI7 1440×900/390×844 day/night rest/login 图与 4 张 regenerated contact sheets 已由 primary executor 逐张按原分辨率打开；自动 metrics 为 8/8、overflow 0、中心仅 `05 / 此刻正在发生`、登录标题支持全部 hidden、手机 dialog 390×844 全屏。视觉合同通过。
- 462 evidence rows 已按当前 source/artifact 合法重绑并保持 ID 顺序哈希 `19DFAE...FD32`。保存 checkpoint、fresh rebuild 与 manifest 同为 `43AEF6D605FFBF2B5D2CA082B08555EBBC04D4432CC457F1AD1A2BD9B0C5C38D`，607 sorted inputs。`test:execution` 97/97；独立 startup/handoff 都 `ok:true`，一致报告 ADR-030、P6/P6-T6/Step 7、30/10/4、零 issue。
- P6-T6 Step 7 仍未勾选，registry-bound release atoms 仍开放；没有 UHub digest、digest-bound SBOM/provenance、exact-digest smoke、release success、DNS/TLS 或 cluster 声明。`HEAD`/`origin/main` 仍为 `bf1ad3b...`，当前 WIP 未提交未推送；历史 browser failure 目录和 soft-pause checkpoint 原样保留。
- 唯一下一原子动作：完成 authority/saved-fresh-manifest/diff/JSON/credential-safe WIP 审计，创建本地实现/证据提交；随后重绑 checkpoint/evidence 并创建窄账本提交。任何新的 `main` push 与任何额外 `1.0.0` dispatch 均需各自新的明确授权；不得进入 P6-T7。

## 20. 2026-08-27 最新接班增量：ADR-030 本地实现提交与 push 授权 checkpoint

- 47 个已审 ADR-030 实现/当前证据路径已提交为 `39c99cd81b2274badc54e6a9d867e70ab3ae55a2`（`fix(motion): stabilize ADR-030 transitions`）。cached path set 为 47，cached diff check exit 0；历史 CI failure 目录与旧 motion-owner soft-pause checkpoint 保持本地 untracked，未删除、未移动、未暂存。
- `origin/main` 仍为 `bf1ad3b9d05ba2d315526b460be3423b44e6648d`。post-commit 窄账本 checkpoint 为 `outputs/evidence/source-checkpoints/2026-08-27-p6-t6-ci7-motion-owner-push-authorization-soft-pause-uncommitted-local-checkpoint.json`，root `193D84A3CEDFA5C1B4DE2C0D68034EB721D4BA328991460D74C23AA2D723DDD7`，607 inputs、462 同序 evidence rows、304 cumulative task paths；边界仍为 30/10/4。
- 包含本段的精确八路径提交是最终窄账本/checkpoint 原子；该提交创建后，本地 `main` 由 ADR-030 实现提交与窄账本提交组成。唯一下一动作切换为取得新的明确授权后才可 push 两个本地提交；该 push 不包含第二次 release dispatch。

## 21. 2026-08-28 最新接班增量：普通 CI #8 单点失败与原子主题切换本地收敛

- 用户明确授权的 `39c99cd...` 与 `5585f0a...` push 已执行并消耗；当前本地 `HEAD` 与 `origin/main` 均为 `5585f0aabaebbbf05a76a8a12aa017445716a009`。普通 CI run `33131639326` / job `98722279599` 通过 unit、typecheck、production build 与 exact MySQL，随后仅 `tests/public-home.spec.ts:121` WebKit theme-performance 失败：baseline P95 25ms、transition P95 89ms、预算 42ms、max 89ms 不超过 100ms。未 dispatch release。
- TDD 最小修订新增 `src/publicThemeCompositor.test.ts`，拒绝 root/day-sky/star 全屏过渡；产品 CSS 改为 day/night 全屏表面原子切换，只在既有 44px theme-control mark 上保留 420ms transform 反馈，并保留 reduced-motion override。未修改 worker、retry、浏览器覆盖、阈值、采样时长、圆环几何、周期或动效速率。
- 新鲜门禁通过 frontend 87/87 files、412/412 tests、typecheck 与 884-module build；server 361 ordinary +50 exact-only skips、typecheck/build；官方 MySQL 8.4.10 50/50；官方 Linux Playwright WebKit theme 1/1 + Firefox theme 1/1 + full matrix 333/333（合计 335/335，workers=1/retries=0）；real-Fastify 12/12；Helm/media/security/observability/workflow/release contracts、root/server audit、current-source Web/API image smoke、16-migration data rehearsal与 Lighthouse 1.00/1.00/0.96/0.91。
- 8 张 CI8 1440×900/390×844 day/night rest/login 图已由 primary executor 逐张按原分辨率打开；当前浏览器 manifest 在四断点均 overflow 0/labels 5，71 帧 P95/最大 16.8ms。直接复核保持 orbit-left/title-recede、深色 night login、手机全屏任务层、完整安全内缩与无中心光球。
- 462 evidence rows 保持逻辑 ID 数与顺序，按磁盘当前 source/artifact 重绑。保存 checkpoint 为 `outputs/evidence/source-checkpoints/2026-08-28-p6-t6-ci8-theme-transition-local-full-gates-uncommitted-local-checkpoint.json`，root `6F846F3DBA3BE53238B6F7ACF0B85D83BD1FC89A2C7E02607620B96D0C682D9C`，608 sorted inputs。边界仍为 30/10/4，Step 7 checkbox 仍未勾选。
- 唯一下一动作：运行 execution/startup/handoff、saved/fresh/manifest、五 authority、diff/JSON/credential-safe 审计后创建本地实现/证据提交；随后重绑 post-commit checkpoint 并创建窄账本提交。任何新 push 与任何额外 `1.0.0` dispatch 分别需要新的明确授权；不得进入 P6-T7。

## 22. 2026-08-28 最新接班增量：CI #8 本地实现提交与 push-authorization checkpoint

- 当前 CI #8 实现/证据修订已提交为 `a2dd3375b382e41e332a9205253605b9e085e9ae`（`fix(theme): make public theme surfaces atomic`）。提交包含 24 个已审当前任务路径；历史 CI6 failure 目录与旧 CI7 WebKit soft-pause checkpoint 保持本地 untracked，未移动、未删除、未暂存。本轮 owned Playwright 容器已停止并自动移除，未触碰用户浏览器。
- `origin/main` 仍为 `5585f0aabaebbbf05a76a8a12aa017445716a009`。post-commit checkpoint 为 `outputs/evidence/source-checkpoints/2026-08-28-p6-t6-ci8-theme-transition-push-authorization-soft-pause-uncommitted-local-checkpoint.json`，root `BC1A9D79B9D82BB8A96822EEDD7714623C28D3F450FA77B2C842B434CDB8EA51`，608 inputs、462 同序 evidence rows；边界仍为 30/10/4，Step 7 仍开放。
- 包含本段的仓库提交是最终窄账本/checkpoint 原子。其创建后，唯一下一动作是取得新的明确授权，才能把 `a2dd337...` 与该精确 narrow HEAD 推送到 GitHub `main`；该授权不包含第二次 `1.0.0` dispatch，不得进入 P6-T7。

## 24. 2026-08-28 当前尾部覆盖：普通 CI #9 单点失败与完整本地收敛

- 本节位于文件尾并构成最新接班事实。当前本地实现/证据提交为 `0718cb2815d170da59595b9c401ad36e2fddd834`，`origin/main` 仍为 `10a86adb271f849dcf91bf46d7b09265aa829127`，对应旧 push 授权已经消耗。普通 CI run `33137867114` / job `98741846244` 在 unit、frontend typecheck、production build 与 exact MySQL 通过后，仅 dedicated WebKit theme-performance 失败；未运行 release。
- 当前 WIP 在不放宽任何 worker、retry、浏览器、阈值、采样时长、几何、周期或动效速率的前提下，本地通过 frontend 88/88 files、425/425 tests、typecheck/build；server/MySQL/Helm/security/workflow/image/data；官方 Linux Playwright 335/335；real-Fastify 12/12；Lighthouse 1.00/1.00/0.96/0.91。8 张当前 canonical 图已逐张原分辨率复核。
- owned CI9 validation container、两个专用卷和两个本地测试镜像已在所有门禁后精确清理；未触碰用户浏览器或其他 Docker 资源。post-implementation checkpoint 为 `outputs/evidence/source-checkpoints/2026-08-28-p6-t6-ci9-browser-push-authorization-soft-pause-uncommitted-local-checkpoint.json`，root `392830696452098E2959CA5871A6951F6AAE8E3F4A57A48482A0665BCC8F8225`，609 sorted inputs、462 同序 evidence rows；父级边界仍为 30/10/4，P6-T6 Step 7 仍开放。
- 下一原子动作是完成最终 execution/startup/handoff、identity/authority、JSON/diff/credential-safe staged 审计并创建窄账本提交。新的 push 与额外 `1.0.0` dispatch 分别需要新的明确授权；不得进入 P6-T7。

```powershell
npm.cmd run test:execution
```

## 27. 2026-08-28 最新接班增量：CI #11 完整本地门禁、实现提交与持续授权边界

- 本节位于文件尾并覆盖早先 next-action。CI #11 实现与当前证据集已提交为 `5c7a16f53d116ac177861c526b5f6cd4d7c29b39`（`fix(entry): stabilize cross-browser login transition`）；授权推送前 `origin/main` 仍为 `52aeecc23dc5468a36e20caacfbc43aaff268dc5`。8 个受保护历史 untracked 文件保持原样，未暂存、移动或删除。
- 冻结源码的新鲜门禁通过 frontend typecheck、88/88 files、425/425 tests、885-module build；server 361 ordinary +50 exact-only skips、typecheck/build；官方 MySQL 8.4.10 50/50；官方 Linux Playwright 338/338（WebKit theme 1/1、Firefox theme 1/1、matrix 336/336，workers=1/retries=0）；real-Fastify 12/12；Helm/media/security/observability/workflow/release、audit、current-source images、16 migrations 与 Lighthouse 1.00/1.00/0.96/0.91。9 张当前视觉证据已由 primary executor 逐张原分辨率打开并通过。
- saved/fresh/evidence/visual checkpoint 一致为 root `1BCAFA4C8BCD579BB00677FD43623E8ED0A4A47CA1DBB328F50E871D3388557B`、610 inputs、462 同序 evidence rows；visual manifest 累计 43 states，其中 9 张为本次 CI #11 逐张复核图。execution-contract 为 97/97。父边界仍为 30/10/4，P6-T6 Step 7 仍开放。
- 用户已经明确持续授权项目范围内全部剩余操作：创建窄账本提交、把实现与账本提交推送到精确 GitHub `main`，并且仅在新普通 CI 全绿后额外 dispatch 恰好一次 `1.0.0`。不得读取凭据值、kubeconfig，不得执行 kubectl、Helm install/upgrade、Argo sync/rollback 或 cluster smoke。
- 唯一下一动作：提交窄账本，推送两个提交，等待普通 CI 终态；若全绿则执行唯一一次已授权 release，并以真实 UHub digest、digest-bound SBOM/provenance 与 exact-digest smoke 证据继续完成 P6-T6 -> P6-T7 -> P6-T8 -> phase-close -> project-close。

## 29. 2026-08-28 最新接班增量：CI #11 冷 MySQL 失败与 CI #12 harness 修复

- 已授权 push 完成后，本地 `HEAD`、`origin/main` 与远端 `main` 均为 `a668e001b6dec8fffeb33ce07046134fe87f7ca2`。普通 CI run `33173546102` 通过 unit/type/build 后，仅因官方 MySQL 冷启动并发 migration 的 `beforeAll` 超过 Vitest 默认 10 秒而失败；50 个 exact tests 全部未运行，browser/Helm/image tail 未执行，没有 release。
- 该失败是测试环境边界，不是产品 behavioral RED。focused delivery-harness 合同先 1/5 RED，要求仅该 cold setup hook 为 60 秒并禁止全局 `hookTimeout`；实现只把 `beforeAll` 改为 `beforeAll(..., 60_000)`，随后 5/5 GREEN。新官方 MySQL 8.4.10 容器用 SQL readiness 探针通过 50/50 exact tests（26.39 秒）并精确清理。
- CI-equivalent front half 新鲜通过 frontend 425/425、server 362 ordinary +50 exact-only skips、双 typecheck/双 build、885 modules；workflow contract/validator 与 execution 97/97 通过。产品/browser/image/visual source 未改变，既有 Playwright 338/338、real-Fastify 12/12、Helm/security/image/data/Lighthouse 与 9 张逐图复核证据保持 source-current。
- CI #12 checkpoint 为 `3E852927E0496CC31A7F7D677F0DAEBE887EE3333562D7974FBE0E9F7CDD4D85`、610 inputs、462 evidence rows、43 visual states；边界仍为 30/10/4，P6-T6 Step 7 仍开放。
- 唯一下一动作：startup/handoff 与最终审计后，在持续授权下 commit/push 本次窄修复并观察下一普通 CI；只有它真实全绿才执行唯一一次已授权 `1.0.0` release。

## 31. 2026-08-28 最新接班增量：CI #12 trace observer 失败与 CI #13 精确隔离

- CI12 commit `0ec4832df07f9189232e4e9939c1cd951e8d7c5b` 已在三个 `main` ref 上一致。普通 CI run `33175188848` / job `98861853310` 通过 unit/type/build、官方 MySQL 与 browser install 后，只在 WebKit theme-performance 失败：baseline P95/max 18/18ms；transition 先 72/70ms，后 22 帧均为 9–19ms；P95 70ms 超过未改变的 35ms 门，max 72ms 仍低于未改变的 100ms 门。tail 未运行，没有 release。
- 根因是专用 timing project 继承 `trace: retain-on-failure`，点击后的 trace snapshot/screencast 与紧随其后的 rAF 采样竞争。focused contract 先 1/14 RED；最小实现只给 Firefox/WebKit 两个 theme-performance 项目设 `trace: 'off'`，全局失败 trace 与 critical projects 不变，worker/retry/browser/test/sample/threshold/geometry/motion 均未放宽，随后 14/14 GREEN。
- 官方 `mcr.microsoft.com/playwright:v1.62.1-noble` 通过 WebKit theme 1/1、Firefox theme 1/1，并新鲜完成完整六项目 matrix 336/336（24.0 分钟、workers=1、retries=0），当前浏览器合计 338/338；完整 frontend 88/88、425/425、typecheck、885-module build、workflow contract/validator 均通过。本轮 owned 容器和两个专属卷已精确清理，并确认无残留 `lifeops-ci13-` 资源。产品/CSS/image/visual/browser test source 未变化；real-Fastify 12/12 与其他冻结门禁保持 source-current。
- CI13 saved checkpoint 已生成于 `outputs/evidence/source-checkpoints/2026-08-28-p6-t6-ci13-trace-isolation-uncommitted-local-checkpoint.json`，root `82D6C92069A051A2D09C74766B01E0BCEF74AE04674C6960A9F6B17B09E62519`、610 sorted inputs、462 同序 evidence rows、43 visual states。父边界仍为 30/10/4，P6-T6 Step 7 开放。唯一下一动作：完成 execution/startup/handoff 与最终审计，commit/push 后观察新普通 CI；全绿才 dispatch 唯一一次已授权 `1.0.0` release。
