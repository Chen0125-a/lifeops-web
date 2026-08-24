# LifeOps Web 镜像交付边界设计

**状态：** 用户已确认方案 A，并于 2026-08-11 完成书面规范复核；2026-08-14 视觉实施质量边界已批准  
**日期：** 2026-08-10；质量边界增量 2026-08-14  
**上位决策：** ADR-019、ADR-020、ADR-022  
**适用范围：** LifeOps Web 产品实现、测试、镜像发布和用户部署交接

## 1. 目标

LifeOps Web 项目的最终成果不是一组页面草图，也不是只能在开发机启动的源码，而是一套已经完整实现、可验证、可由用户部署到其 Kubernetes 集群的 Web 产品交付物：

- 完整的 React Web、Fastify API 和 MySQL 应用数据模型、迁移与事务逻辑；
- 覆盖全部 44 个主需求及其原子条款的新鲜自动化、浏览器、视觉和人工验收证据；
- 推送到 UHub、可按不可变 digest 拉取的 `lifeops-web` 与 `lifeops-api` 双镜像；
- 通过静态与渲染校验的 Helm Chart、GitOps values、Argo CD Application 示例和安全配置合同；
- 用户可以独立完成部署、验证和回滚的操作手册、检查脚本与发布清单。

项目不负责搭建或管理 Kubernetes 集群，也不代替用户执行 LifeOps 在集群中的安装、同步、升级、回滚或集群 smoke。

## 2. 责任边界

### 2.1 Codex / LifeOps Web 项目负责

1. 按批准的规格和 P1 → P6 顺序完整实现 Web、API、MySQL 应用层以及所有用户可见状态。
2. 维护数据联动、事务、幂等、历史快照、权限、安全、响应式、无障碍和连续动效合同。
3. 在本地或 CI 的真实 MySQL 8.4 环境中完成单元、API、集成、迁移、恢复、E2E 和远程入口等验证。
4. 构建生产 Web/API 镜像，验证非 root、只读根文件系统、健康检查、优雅退出、深链和真实 API/数据库流程。
5. 通过批准主线 GitHub Actions 把双镜像推送到 UHub，并记录版本、Git/SHA 检查点、不可变 digest、构建来源、SBOM 和 provenance。只有用户另行批准发布主线变更后，才能采用其他受控入口。
6. 交付不含凭据的 Helm/GitOps/Argo 配置、values 示例、部署前检查、部署后检查、备份恢复和回滚手册。
7. 对交付包执行 Helm lint/template、生产 values 校验、Secret 边界检查、镜像 digest 检查和无集群交付演练。该演练只覆盖精确 digest 容器网络 smoke、静态/渲染校验、脚本预检和文档步骤，不读取 kubeconfig，不执行 Helm install/upgrade、Argo sync 或任何 Kubernetes API 操作。

### 2.2 用户负责

1. 搭建和维护 Kubernetes 集群、节点、负载均衡、CNI、存储、Gateway/Ingress、DNS/TLS。
2. 安装和配置 Argo CD、Prometheus、Grafana、Alertmanager、ELK 以及其他集群平台组件。
3. 在目标环境安全创建 UHub 拉取凭据、数据库和平台集成 Secret；凭据不提供给文档或证据文件。
4. 选择实际 namespace、hostname、StorageClass、媒体后端和外部平台地址。
5. 使用交付包把 LifeOps 部署到集群，并执行交付的部署后 smoke、持久化、可观测性和回滚检查。

### 2.3 明确禁止的范围漂移

- Web 项目不得因为缺少 kubeconfig、Argo CD、StorageClass、Gateway、监控或日志平台而转去搭建集群。
- 未经用户另行明确授权，不执行 `kubectl apply`、Helm install/upgrade、Argo sync、Pod 删除、数据库集群备份或任何集群变更。
- 用户后续自愿提供部署结果时，可以追加“用户环境部署证据”，但它不是 Web 交付完成的前置条件，也不得反向改写已完成的镜像交付证据。

## 3. 发布制品合同

### 3.1 双镜像

- Web 镜像：`uhub.service.ucloud.cn/chenucloud/lifeops-web@sha256:<digest>`。
- API 镜像：`uhub.service.ucloud.cn/chenucloud/lifeops-api@sha256:<digest>`。
- 上述仓库名是当前计划目标；发布前必须通过真实 UHub 访问发现确认。若实际仓库不同，先按变更控制更新配置，不得静默推送到替代仓库。
- 版本标签用于识别，digest 才是部署事实；生产 values 禁止只写 `latest` 或可变标签。
- MySQL 使用已锁定的官方 `mysql:8.4.10` 或经批准的外部 MySQL，不为了凑齐“应用镜像”自制第三个 MySQL 镜像。

### 3.2 镜像证据

每个镜像必须记录：

- 完整 repository、版本标签和 `sha256` digest；
- 构建时间、源码 Git revision；若尚无批准的 Git 仓库则使用所有交付输入的 SHA-256 检查点，且在推送前必须解决正式仓库边界；
- 目标平台至少为 `linux/amd64`；新增架构必须显式验证；
- 针对最终 Web/API digest 实际生成的 SPDX 或 CycloneDX SBOM，以及可验证的 in-toto/SLSA provenance；二者必须明确绑定各自镜像 digest；
- 优先把 SBOM/provenance 作为 OCI referrer/attestation 随镜像发布。若 UHub 经真实发现不支持相应 referrer，允许把 digest 绑定的原始制品保存为 GitHub Actions/Release 与 `outputs/final/` 的脱敏发布制品，并记录制品 SHA-256、subject digest 和验证命令；缺失或不可验证不能通过；
- 对该精确 digest 的 registry inspect 和镜像 smoke 结果；
- 不包含 token、密码、Cookie、kubeconfig、私钥、真实个人数据或 Secret 值。

### 3.3 应用交付包

交付包至少包含：

- `deploy/helm/lifeops-web/` 生产 Chart；
- `deploy/gitops/environments/production/values.yaml` 的无凭据、digest 固定版本；
- `deploy/argocd/application.example.yaml`，只提供用户需替换的非敏感环境坐标；
- `DEPLOYMENT.md`；
- 数据库迁移、备份恢复、媒体存储、平台集成、可观测性、部署回滚和故障排查 runbook；
- 部署前静态检查、部署后 smoke 与结果记录模板；
- `outputs/final/release-manifest.json`、双镜像引用文件和最终验证索引。

示例文件可以保留显式占位符；被声明为可直接部署的 production values、release manifest 和镜像引用不允许存在 `REPLACE_ME`、空 digest、明文凭据或示例主机名。

## 4. Web 交付完成定义

只有以下条件全部满足，才可报告“LifeOps Web 交付完成”：

1. 44 个主需求的全部适用原子条目在各自边界达到通过，没有被跳过、陈旧或模拟证据冒充。
2. Web/API、真实 MySQL、E2E、视觉、无障碍、安全、类型、生产构建和 Helm 门禁来自同一最终源码检查点。
3. 主执行者在要求的四个断点实际打开并检查全部页面、详情、返回、快速打断、减少动态、空/错/冲突/离线状态和反模式禁令。
4. Web/API 两个生产镜像已真实推送到确认后的 UHub 仓库，能按精确 digest inspect，并通过精确 digest 的镜像 smoke。
5. 发布记录包含不可变引用、实际生成且可验证的 SBOM/provenance、校验和、测试摘要和已知限制，不含敏感信息；`missing`、`unknown` 或仅记录工具配置不能视为通过。
6. Helm Chart、production values、Argo 示例和所有部署 runbook 通过约定的静态/渲染/安全校验。
7. 用户部署清单明确说明环境输入、Secret 名称、迁移顺序、健康判断、smoke、备份恢复和 GitOps 回滚路径。
8. execution-control、追踪表、项目 CURRENT、最新 session 和最终验证索引一致回写。

以下内容不再是 Web 交付完成门禁：Kubernetes context 可用、Argo CD `Synced/Healthy`、真实 hostname、集群入口 smoke、Pod 重建、集群平台已安装或平台连接成功。它们属于用户部署阶段；界面仍必须诚实展示 `connected | degraded | disabled | unverified`，不得制造数据。

## 5. DELIVERY-01 的最终边界

`DELIVERY-01` 在以下证据齐全时达到 `verified-registry`：

- 双镜像构建、推送、registry digest 解析和精确 digest smoke；
- 与双镜像精确 digest 绑定、实际生成并通过验证的 SBOM/provenance；
- production values 固定相同 digest；
- Helm lint/template、生产渲染、安全和占位符检查；
- 用户部署、验证、备份恢复和回滚包；
- 发布清单与最终索引的哈希一致。

其他产品需求通常以 `verified-local` 或 `verified-image` 结束；仅有实际镜像边界的条目才需要 `verified-image`，只有 DELIVERY-01 需要 `verified-registry`。不再使用 `verified-cluster` 作为 Web 项目状态。

## 6. 失败与阻塞处理

- 没有可用的正式 Git 仓库时，可以继续完成不依赖仓库的实现和本地验证，但不能关闭正式发布任务。
- 没有 Docker/Buildx 时，镜像构建与 smoke 保持阻塞；不能用源码 build 代替。
- 没有 GitHub/UHub 写权限或 UHub 不可用时，发布保持阻塞；不能把本地 tar 包冒充已推送镜像。
- 只有用户明确改变交付边界后，才可以讨论离线镜像包作为替代；否则方案 A 的 UHub 双 digest 是硬门禁。
- 用户集群未完成或未部署不会阻塞 Web 交付，也不会授权项目操作集群。

## 7. 项目 Skill 退役

`build-ha-k8s-platform` 不再是 LifeOps Web 的启动、执行、接班或恢复依赖，也不再因“继续 LifeOps Web”被调用。其本地文件可以作为已安装的历史工具保留，不删除、不打包进 Web 制品、不列入跨设备恢复必需项。

LifeOps Web 的唯一承接入口是当前工作区的 `AGENTS.md`、项目 Obsidian 事实源、批准规格、主计划、execution-control、活动任务和最新 session。

## 8. 书面复核后的下一步

本规范与执行完整性规范都获得用户书面复核后，先用 writing-plans 流程编写执行保障层的 TDD 实施计划；完成来源条款、原子矩阵、证据清单、校验器和真实新对话接班演练后，才从 P1-T1 Step 1 开始业务实现。

## 9. 视觉质量与交付边界

- ADR-022 的黄金切片、四视口、关键状态、键盘/焦点、normal/reduced/paused 动效、性能和人工整体观感验收属于 Web 项目本地/镜像责任，不能因 Kubernetes 由用户负责而省略。
- 视觉证据和精确 digest 镜像 smoke 必须分别成立：本地漂亮截图不能证明最终镜像包含同一产物，最终镜像能启动也不能证明批准视觉、状态和动效完整。P6 必须对精确 Web/API digest 重跑适用浏览器路径，并把结果绑定到 digest、source revision 或非 Git 根检查点。
- 视觉 evidence package 记录浏览器版本、viewport/DPR/缩放、字体、主题、fixture/API 场景哈希和动效偏好；fixture 仅为测试场景，不得进入生产数据或被描述为平台已连接。动态路径用 filmstrip、trace 或视频，生成但未打开的截图不构成发布证据。
- GSAP、Motion、设计/测试 Skill 和目标模式是实现工具，不是交付制品或完成证明；最终 Web 镜像只包含经批准、可复现和经过许可证/依赖审查的运行时依赖，不打包 Codex Skill、Obsidian 记忆、凭据或本机工具缓存。
- 本增量不增加任何 Kubernetes、Helm install/upgrade、Argo sync、回滚或集群 smoke 操作。用户部署结果仍是外部记录，不反向替代或阻塞 Web 的本地、镜像和 registry 质量门禁。
