# LifeOps Web 新对话完整接班提示词

继续 LifeOps Web，高质量、按顺序持续执行。固定工作区：

`C:\Users\Administrator\Documents\Codex\2026-08-08\bug\lifeops-web`

本次不是重新规划项目，而是从 P4 完整本地关闭后的新鲜检查点停在 P5-T1 Step 1 实施前。不得重新讨论已批准设计，不得重复安装依赖，不得初始化 Git，也不得把旧对话结果直接当作当前证据。

## 开始时严格只读

在完成全部启动核验和接班报告前，不得修改源码、测试、计划、追踪、证据、依赖、数据库或部署状态。

1. 完整读取工作区 `AGENTS.md`。
2. 完整读取本文件；不得只看摘要。本文件是正式、完整的新对话接班入口。
3. 完整读取：
   - `D:\笔记\项目\LifeOps-高可用K8s平台\CURRENT.md`
   - `D:\笔记\项目\LifeOps-高可用K8s平台\DECISIONS.md` 中 ADR-016 至 ADR-027
   - 最新 session：`D:\笔记\项目\LifeOps-高可用K8s平台\sessions\2026-08-15_S021_ADR-025目标层级恢复与P3-T2执行.md`
   - `docs/superpowers/specs/2026-08-09-lifeops-web-final-redesign-design.md`
   - `docs/superpowers/specs/2026-08-10-lifeops-life-domain-design.md`
   - `docs/superpowers/specs/2026-08-10-lifeops-execution-completeness-design.md`
   - `docs/superpowers/specs/2026-08-10-lifeops-web-image-delivery-boundary-design.md`
   - `docs/superpowers/plans/2026-08-09-00-lifeops-final-master-plan.md`
   - `docs/superpowers/plans/2026-08-09-execution-control.md`
   - `docs/traceability/requirements.md`
   - `docs/traceability/source-clauses.json`
   - `docs/traceability/acceptance-matrix.json`
   - `docs/traceability/evidence-manifest.json`
   - `docs/superpowers/plans/2026-08-09-04-lifeops-knowledge-publishing-obsidian-plan.md` 的 P4-T3 全文，包括 Files、Interfaces、checkbox、命令和退出门禁。
4. 检查目录、package manifests、源码和已有用户修改。当前不是 Git 仓库；未经用户明确授权不得 `git init`、reset、checkout、clean、覆盖、清理或丢弃文件。
5. 使用 `obsidian-user-memory` 运行 `memory-health` 和 `runtime-context`，只读加载 LifeOps Web 相关长期事实；不记录凭据，不执行 Git 或远程记忆同步。
6. 只读核对下面的 authority 哈希、checkpoint 和执行状态。无法由已批准变更解释的不一致是停线条件。

## 当前 authority 与锁定哈希

Authority 是 ADR-027。五份 authority SHA-256 必须新鲜复算并全部匹配：

- final redesign：`7CFD778463BA871D283BD0B3E89BD458C45303905F6025E3BDD05225B8CC8B23`
- life domain：`ADF4BCD234D43035B1115864FE3579CAE7CC61C341E1142F6B3203C0A3E9CC24`
- execution completeness：`43ECB091350925A90620E3D88E778F8F6AD6E547B11CDB5D806248E92D07B112`
- image boundary：`63F3D2903D6BDC98A2C04C2DDC111D69AA9D8A8A97766B98899918A1D49800B6`
- master plan：`11DFDF44A2344594BFE2135DFA81743BD1CDBB30236C35FF546DFC87AA2CEFF7`

任一不一致都先判断是否发生用户批准的设计/计划变更；完成变更控制前不得继续产品实现。

## 当前正式状态

- Status：`implementation-active`
- Active plan/task/step：P4 / P4-T4 / Step 1
- Requirements：24/44
- Parent rollup：24 `verified-local` + 10 `partial` + 10 `pending`
- Atom rollup：515 `verified-local` + 434 `partial` + 471 `pending`
- Catalog：44 parents、52 surfaces、1,420 atoms（776 original + 644 life）
- Evidence manifest：330 rows
- Execution guard Task 1–10、P1-T1 至 P1-T13、P2-T1 至 P2-T6、P3-T1 至 P3-T14、P4-T1 至 P4-T3 已本地完成并 checkpoint。
- GOAL-01、SCHEDULE-01、HABIT-01、REVIEW-01、KNOW-01、OBS-01、LIFE-02 至 LIFE-18、LIFE-22 为 atom-derived `verified-local`。
- APP-01、RECORD-01、LIFE-01、LIFE-19、LIFE-21、LIFE-23、LIFE-24 为 `partial`。不得冒充 P4-T4 及以后任务、P5/P6、immutable-image、registry 或最终交付完成。
- P3-T14 的最终反向审计在 `outputs/final/private-core-verification.md`。

## 当前非 Git 完成 checkpoint

`outputs/evidence/source-checkpoints/2026-08-22-p4-t3-obsidian-manual-sync-uncommitted-local-checkpoint.json`

预期：

- root：`74ABFE2B4E8974FA474298C37EA83A10D4AA81243B94A5733C1CBF0812D36DAC`
- 447 个排序输入
- `docs/traceability/evidence-manifest.json` 为 330 行 evidence
- saved checkpoint、新鲜重建 checkpoint 和 manifest root 必须一致。

本接班文件、execution-control、工作包、CURRENT 和 session 不在 allowlisted source inputs 内；只更新这些控制文件不应改变上述 root。不得运行历史 task 的 evidence helper 覆盖当前停点。

## 启动执行门禁

完成只读回读、五份哈希和 checkpoint 核对后，第一条执行门禁命令必须是：

```powershell
npm.cmd run verify:execution -- --mode startup
```

必须阅读完整输出和退出码。预期 exit 0，并报告：

- ADR-027、`implementation-active`
- P4 / P4-T4 / Step 1
- 24/44
- 24 verified-local + 10 partial + 10 pending parents
- checkpoint root `74ABFE2B4E8974FA474298C37EA83A10D4AA81243B94A5733C1CBF0812D36DAC`
- blockers `[]`
- next action `P4-T4 Step 1`
- first verification command `npm.cmd run test:server -- server/src/domain/publishing.test.ts server/src/services/publicationScheduler.test.ts server/src/routes/publishing.test.ts server/src/routes/publicContent.test.ts`

P3 关闭前的产品证据仅供比对；新对话仍须新鲜运行 execution-contract、startup 和后续任务门禁。

## P3-T14 已完成边界

- `outputs/final/private-core-verification.md` 已记录精确自动化计数、环境/字体/DPR/视口/动效/lock 元数据、失败状态和 30 个 P3 parent 的反向证据链。
- Fresh gates：Web 64 files/288；server 220 pass +45 exact-only skip；official MySQL 8.4.10/34034 45/45 zero skip；双 typecheck/build exit 0；Life comprehensive 20/20；canonical Life 19/19；ordinary 57/57；real Fastify 3/3。
- 主执行者重新生成并打开 8 张 contact sheet；306-row manifest 派生 488 verified-local +434 partial +498 pending atoms、22 verified-local +10 partial +12 pending parents。
- P3 phase-close 只承认 P3 责任边界；P4/P5/P6、immutable image/UHub/registry/final delivery 仍未完成。

## P4-T3 已完成边界与 P4-T4 精确起点

1. P4-T1/P4-T2 已完成 knowledge domain/workspace；P4-T3 已完成 exact `fflate@0.8.3`、stable frontmatter、pure no-delete sync plan、permission-gated read-only-first folder scan、backup-before-write atomic batch、deterministic ZIP preview/apply、fallback 与 standalone settings behavior。
2. Fresh gates：focused 24/24、full Web 72 files/326、typecheck/build、shared Chromium 60/60、standalone P4-T3 Chromium 1/1；P4-T3 无 MySQL schema/persistence，exact MySQL 不适用。
3. 主执行者已打开 1440/1024/768/390、320 CSS px/200%、preview 与 reduced-motion 成品图；OBS-01 的四 atoms 和 parent 均为 `verified-local`。P4-T6 仍负责真实 route integration。
4. P4-T4 Step 1 只写 publishing domain RED，覆盖 five categories、slug、copied-source whitelist、immutable revision、schedule timestamp 与 revision diff；不得先写实现。
5. 第一条命令为：

```powershell
npm.cmd run test:server -- server/src/domain/publishing.test.ts server/src/services/publicationScheduler.test.ts server/src/routes/publishing.test.ts server/src/routes/publicContent.test.ts
```

6. GREEN 只能实现 P4-T4 声明的 revisioned publishing domain/store/routes/scheduler/RSS/client contract；不得提前实现 P4-T5 publishing workbench 或改变 public/private page design。

## P3-T13 已完成边界

- 五份综合规格复用 canonical P3-T8 至 P3-T12 stateful fixtures，并新增 pending/duplicate/offline calendar-copy 行为。有效 RED 为 19/20；ordinary 配置污染又以原 goals/habits 前五条失败暴露，最终受影响组 7/7、综合 20/20、ordinary 57/57。
- Fresh gates：calendar 6/6；comprehensive Life 20/20；canonical Life 19/19；full Web 64 files/288 tests；full server 220 pass +45 exact-only skip；official isolated MySQL 8.4.10/34034 45/45 zero skip；双 typecheck/双 build exit 0；ordinary browser 57/57；real Fastify 3/3。
- 主执行者重新生成并打开 8 张 contact sheet，索引 89 份命名截图/filmstrip；覆盖 desktop/mobile、planning tablet、320/200%、normal/reduced 与交互状态，五轴验收通过。
- task-only MySQL 34034 已正常 shutdown，post-run ping exit 1，listener/PID absent。

## P3-T14 精确执行顺序

1. Step 1 在 `outputs/final/private-core-verification.md` 记录准确测试计数、浏览器/OS/font/DPR/viewport/color-scheme/reduced-motion、依赖锁哈希与截图/filmstrip/trace 路径。
2. 第一条验证命令：

```powershell
npm.cmd run test:execution
```

3. Step 2 从每个 original private 与 LIFE ID 反向核对 API、page、state、E2E 和 screenshot，缺链即重开，父状态只取原子最小值。
4. Step 3 同步 requirements、CURRENT、session、execution-control 与本文件，唯一下一动作为 `P4-T1 knowledge data/version API failing test`。
5. Step 4 生成 P3-T14 非 Git checkpoint，并运行 execution-contract、startup、handoff；然后完整读取 P4 计划再开始 P4-T1。

## 持续执行终点与顺序

- Exactly one task in progress。
- P3 与 P4-T1 至 P4-T3 已完整关闭；严格 P4-T4 → P4-T5 → P4-T6 → P4-T7 → P4-T8。
- P4 完整关闭并完成 fresh handoff 后，将状态推进到 P5 / P5-T1 / Step 1，停在实施 P5 前。
- 普通 task 完成、checkpoint、阶段报告、上下文压缩或自动续接都不是停止理由；完成当前门禁后直接继续下一个顺序任务。
- 完成 P4 不等于完成 LifeOps Web；P5、P6、immutable-image/UHub 和最终交付边界仍未完成。

## 每个任务的执行与验收边界

- 每个 feature/bugfix 必须 TDD：测试先行，运行并确认有效行为 RED，再做最小 GREEN。
- 遇到异常先系统排错，不猜修；语法、依赖、fixture、浏览器启动或 DB 连接失败不算有效 RED。
- focused gate、相关完整回归、双 typecheck/build、真实浏览器和 atomic evidence 缺一不可。
- UI 变更必须覆盖 1440×900、1024×768、768×1024、390×844、200% zoom/320 CSS px、键盘、焦点、Back、loading/empty/error/offline/403/409、reduced motion 和五轴整页复核；截图/filmstrip 必须实际打开。
- 改共享 App、styles、routes 或 providers，必须重跑受影响的 P2/P3/P4 浏览器回归。
- 需要 exact MySQL 时使用 task-only官方 MySQL 8.4.10，零 skip；结束后正常 shutdown 并验证 ping 失败。
- 关闭 task 或跨上下文时同步 execution-control、工作包 checkbox、requirements/atomic evidence、project CURRENT、最新 session、正式接班文件和 non-Git checkpoint，并运行 execution-contract、startup、handoff。

## 已批准 UI 与责任边界

- 私人产品保持 ADR-022 Daylight Command Center：明亮连续画布、soft-volume hierarchy、批准的顶部导航和 page-native composition。
- 不得恢复 private planets、private galaxy/orbit shell、左侧栏加卡墙、直角纸页、等大圆角卡墙或整页白闪导航。
- 私人产品用 Motion；GSAP 仅属于公开首页/登录批准边界。不得引入 ScrollTrigger、ScrollSmoother、滚轮导航或通用 scroll reveal。
- Medicine 只保存用户事实、库存、有效期、日程和历史，不提供诊断或用药建议。生产数据来自 Fastify/MySQL，fixtures 不得作为生产事实。
- workspace 不是 Git repository。Docker/Buildx、GitHub、UHub、release digests 未刷新，不得声称可用或完成。
- 本项目只负责 Web/API/MySQL、测试、双镜像、UHub release evidence 和 application-delivery assets。Kubernetes/Helm/Argo 部署、同步、回滚、cluster smoke 由用户负责，不是 Web 完成门禁。
- 不请求 kubeconfig，不调用已退役的 `build-ha-k8s-platform`，不执行集群操作，不记录密码、token、Cookie、API key、私钥或认证文件。

完成接班报告后，从 P4 / P4-T4 / Step 1 的 publishing domain RED 开始；不得越过 P4-T4 提前实现 P4-T5。

## 2026-08-22 P4-T4 已关闭后的最新正式接班覆盖

本节覆盖本文件更早的 P4-T4 起点；历史内容仅保留审计。ADR-027、`implementation-active`、24/44 不变。P4-T4 Steps 1–10 已按 TDD 完整关闭：13/13 server behavior RED、3/3 client RED、scheduler secret-free log RED 和 official MySQL missing-schema/method RED 均有效；最终 focused server 15/15、client 3/3、full server 239 pass +48 exact-only skip、exclusive full Web 73 files/329、dual typecheck/build、real Fastify Chromium 4/4、official MySQL Community Server 8.4.10/34036 48/48 zero skip。任务 MySQL normal shutdown exit 0，post-run ping exit 1，PID/listener absent。

当前 manifest 为 334 rows，派生 515 verified-local +455 partial +450 pending atoms 与 24 verified-local +10 partial +10 pending parents。PUBLISH-01 仍 pending，因为 P4-T5/P4-T6 的 workbench、dynamic public pages、state/responsive/a11y/motion/browser/image 子项没有被提前冒充。Saved/fresh/manifest checkpoint 应一致为：

- path：`outputs/evidence/source-checkpoints/2026-08-22-p4-t4-revisioned-publishing-uncommitted-local-checkpoint.json`
- root：`3F740062B9B34A83A555376AEEF61A1734662F70311307697EAAC91436840A65`
- inputs：459

当前唯一 tuple 是 P4 / P4-T5 / Step 1。下一原子动作是先写 source library/status tabs/editor/live preview/privacy checklist/immediate-scheduled publish/revoke/revision diff 与 five public route 的失败测试；第一条验证命令为：

```powershell
npm.cmd test -- src/features/publishing src/pages/PublicDestinationPage.test.tsx src/pages/PublicSnapshotPage.test.tsx
```

不得在 RED 前实现 P4-T5，不得越过 P4-T5 开始 P4-T6。完成 P4-T5 后继续既定 P4-T6→P4-T8；P4 完整关闭后停在 P5-T1 实施前。

## 2026-08-22 P4-T5 已关闭后的最新正式接班覆盖

本节覆盖本文件更早的 P4-T4/P4-T5 起点；历史内容仅保留审计。ADR-027、`implementation-active`、24/44 不变。P4-T5 Steps 1–10 已按 TDD 完整关闭：首个可加载三文件门禁为 15 pass +11 behavior fail；最终 focused Web 26/26、publishing/public route 6/6、full Web 74 files/341、full server 239 pass +48 exact-only skip、dual typecheck/build 与 real Fastify/Chromium 22 checks 全部通过。P4-T5 无 server schema/persistence 改动，exact MySQL 不适用；P4-T4 official 8.4.10/34036 48/48 保持当前存储证据。

当前实现包括 3/5/4 source/editor/preview、mobile source→edit→preview、四来源/四状态、完整 public fields、shared day/night + desktop/mobile renderer、exact-version privacy confirmation、immediate/scheduled/revoke、immutable revision/diff、unsaved-leave、network/403/409/offline、stable `/p/:slug`、featured ordering、legacy redirect 和 RSS。真实浏览器确认 private source sentinel/ID 不进入公开 DOM，冲突/离线保留本地文本，Back/focus/reduced-motion/320 CSS px/200% zoom 均通过。主执行者已打开六张最终图；初轮 1024/768 压缩和 mobile layer disclosure 修复后全部重新生成并通过五轴复核。

当前 registry 为 2,819 clauses，manifest 为 349 rows，派生 515 verified-local +470 partial +435 pending atoms 与 24 verified-local +11 partial +9 pending parents。PUBLISH-01 只到 partial；P4-T6 formal cross-domain E2E/visual 和后续 exact-image public read 未完成。Saved/fresh/manifest checkpoint 必须一致为：

- path：`outputs/evidence/source-checkpoints/2026-08-22-p4-t5-publishing-workbench-uncommitted-local-checkpoint.json`
- root：`604997074DD463A3989F036EF0A098996BC4E4F96EB9F43354332CF90DC19115`
- inputs：468

当前唯一 tuple 是 P4 / P4-T6 / Step 1。先写 knowledge create/derive/edit/search/relation/review-date/resurface/archive/restore 与 Markdown XSS journeys，再按工作包顺序补 Obsidian/publishing journeys；第一条验证命令为：

```powershell
npm.cmd run test:e2e -- tests/knowledge-obsidian.spec.ts tests/publishing-public.spec.ts
```

不得跳过 P4-T6 的 formal E2E/visual gate，不得越过 P4-T6 开始 P4-T7。完成 P4-T6 后继续 P4-T7→P4-T8；P4 完整关闭并同步新鲜 handoff 后，停在 P5/P5-T1/Step 1 实施前。

## 2026-08-22 P4-T6 已关闭后的最新正式接班覆盖

本节覆盖本文件更早的 P4-T4/P4-T5/P4-T6 起点；历史内容仅保留审计。ADR-027、`implementation-active`、24/44 不变。P4-T6 Steps 1–8 已按 TDD 完整关闭。正式 knowledge/Obsidian/publishing RED 在 selector-only 修正后暴露四个真实缺口：settings route placeholder、未要求逐项 conflict choice、draft 未实时驱动 public preview，以及 query invalidation 可能重复新建 draft。当前真实 `/app/settings`、permission-gated preview/apply、keep-Web/keep-Obsidian/keep-both、backup-before-write、live preview 与 stable dedupe 均已完成，未新增 migration 或改变数据语义。

Fresh gates：exclusive Web 74 files/341 tests；full server 239 pass +48 exact-only skip；dual typecheck/build；focused cross-domain Chromium 13/13；real Fastify Chromium 4/4；complete ordinary Chromium 69/69；official task-only MySQL Community Server 8.4.10/34037 48/48 zero skip、14 migrations。任务数据库 normal shutdown exit 0，post-run ping exit 1，PID/listener absent。完整普通 Chromium 首轮 68/69 只暴露静态 CSS manifest 缺少已批准 publishing/settings layers；同步后 focused 与整套 69/69 均通过。

主执行者打开全部 36 张 knowledge/settings/publishing/public category/public article 最终 PNG。首轮 reduced filmstrip crop、200% public detail 双栏和 fixed mobile return 遮挡均被拒收；修复并重新生成后，五轴与执行合同 manual checklist 均通过。

当前 registry 为 2,832 clauses，manifest 为 367 rows，派生 515 verified-local +470 partial +435 pending atoms 与 24 verified-local +11 partial +9 pending parents。PUBLISH-01 只因 later exact-image public read 保持 partial。Saved/fresh/manifest checkpoint 必须一致为：

- path：`outputs/evidence/source-checkpoints/2026-08-22-p4-t6-content-acceptance-uncommitted-local-checkpoint.json`
- root：`E3AE8B1FEA01DBA18E6ECFB52F7402117CB421CBDC66A2C09AC286979EC96B44`
- inputs：472

当前唯一 tuple 是 P4 / P4-T7 / Step 1。先写 projection/import-plan/panel RED，覆盖 stable paths/frontmatter、recipe/cooking/fitness/review Markdown、raw inventory/idempotency/credentials exclusion、first-connect preview、selected-type export、conflict/backup/version-draft/no-delete、ZIP fallback 与 permission-loss degradation；第一条验证命令为：

```powershell
npm.cmd test -- src/integrations/obsidian/lifeProjection.test.ts src/integrations/obsidian/lifeImportPlan.test.ts src/features/life/data/LifeObsidianPanel.test.tsx
```

不得越过 P4-T7 开始 P4-T8。完成 P4-T7 后按工作包执行 P4-T8 reverse audit/phase close；P4 完整关闭并同步 fresh handoff 后，只推进到 P5/P5-T1/Step 1 并停在实施 P5 前。

## 2026-08-22 P4-T7 已关闭后的最新正式接班覆盖

本节覆盖本文件更早的 P4-T7 起点；历史内容仅保留审计。ADR-027、`implementation-active`、24/44 不变。P4-T7 Steps 1–7 已按 TDD 完整关闭：projection/import-plan/panel 首轮三文件正常加载并产生 10 个行为 RED；最终 strict deterministic recipe/cooking-note/fitness/review/selected shopping-budget Markdown/ZIP、稳定 allowlisted path/frontmatter、敏感/运营字段排除、read-only first scan、explicit conflict/version intent、backup-first/no-delete、preview-only P1 import draft 和 truthful ZIP/permission/write/offline degradation 均已完成。

Fresh gates：focused Web 43/43；exclusive full Web 77 files/352 tests；full server 239 pass +48 exact-only skip；dual typecheck/build；focused P4 Chromium 19/19；affected P3 Life Chromium 20/20；complete ordinary Chromium 75/75；real Fastify Chromium 4/4；official task-only MySQL Community Server 8.4.10/34039 48/48 zero skip、14 migrations。任务数据库 normal shutdown exit 0，post-run ping exit 1，PID/listener absent。一次 34038 name-resolution 环境错误发生在数据库创建和测试前；其 exact task PID 已移除并验证 ping/PID/listener absent，未触碰无关 MySQL。

主执行者打开全部 8 张 final PNG。capture origin、mobile data tabs、active Life route visibility 与 Back focus 的首轮拒收均已用单元/真实浏览器 RED 修复；最终 1440/1024/768/390/320、200%、reduced-motion 与 offline 五轴通过。

当前 registry 为 2,836 clauses，manifest 为 378 rows，派生 515 verified-local +474 partial +431 pending atoms 与 24 verified-local +12 partial +8 pending parents。LIFE-20 只到 partial，因为其 `image` requirement 是后续 immutable-container-image boundary，不是截图。Saved/fresh/manifest checkpoint 必须一致为：

- path：`outputs/evidence/source-checkpoints/2026-08-22-p4-t7-life-obsidian-complete-uncommitted-local-checkpoint.json`
- root：`A631623F17C8D90A2DC433A279FA1463BE2E236B584D4F8F76607C33A9484F9D`
- inputs：479

当前唯一 tuple 是 P4 / P4-T8 / Step 1。记录 automated/visual metadata、dependency-lock hash、artifact paths、ZIP checksum、conflict/backup results、publication revision IDs、revoked 404 与 RSS validation，不记录 private note bodies；第一条验证命令为：

```powershell
npm.cmd run test:execution
```

完成 P4-T8 reverse audit、final content verification、phase close 和 fresh handoff 后，推进到 P5/P5-T1/Step 1 并停在实施 P5 前。不得把 P4 local close 冒充整个 LifeOps Web 完成，不得提前实施 P5。

## 2026-08-22 P4-T8 与 P4 phase close 后的最新正式接班覆盖

本节覆盖本文件更早的 P4 起点；历史内容仅保留审计。P4-T1 至 P4-T8 已全部本地关闭。`outputs/final/content-verification.md` 记录环境、dependency-lock、36 张 P4-T6 图/filmstrip、8 张 P4-T7 图、4 个 P4-T8 trace、deterministic ZIP checksum、conflict/backup order、publication revision IDs、revoked 404 与 private-safe RSS，且不含 actual private note body。

Fresh closure gates：trace-focused Chromium 11/11；exclusive Web 77 files/352 tests；server 239 pass +48 exact-only skip；dual typecheck/build；ordinary Chromium 75/75；real Fastify 4/4；P4-T7 official MySQL 8.4.10/34039 48/48 zero skip、normal shutdown、post-shutdown ping exit 1、PID/listener absent。44 个最终 P4-T6/P4-T7 视觉文件在最后完整浏览器复跑后与已打开复核集合 byte-identical。

Reverse audit：KNOW-01 23/23 与 OBS-01 4/4 为 `verified-local`；PUBLISH-01 32/32 与 LIFE-20 4/4 仅因后续 immutable-container-image 证据为 `partial`。P4-T8 的旧 interface 句已按 execution-completeness/image-boundary 高阶 authority 修正，未手工抬升 parent。Registry 2,836 clauses；manifest 381 rows；atoms 515 verified-local +474 partial +431 pending；parents 24 verified-local +12 partial +8 pending。

Saved/fresh/manifest checkpoint 必须一致为：

- path：`outputs/evidence/source-checkpoints/2026-08-22-p4-t8-content-closure-uncommitted-local-checkpoint.json`
- root：`E28D8257C5813CEFD9F94E786624B5969E7746BF0035DB9AB7E39194B7EC8759`
- inputs：479

当前唯一 tuple 是 P5 / P5-T1 / Step 1。下一原子动作是 `P5-T1 platform adapter security contract test`；第一条验证命令为 `npm.cmd run test:server -- server/src/config.test.ts server/src/integrations/safeFetch.test.ts server/src/integrations/redact.test.ts`，但本接班点明确停在 P5 实施前。P5、P6、immutable-image/UHub、SBOM/provenance 与最终交付仍未完成；不得把 P4 local close 冒充 LifeOps Web project completion。

## 2026-08-22 P5-T1 关闭后的最新正式接班覆盖

本节覆盖本文件更早的 P5-T1 实施前起点；历史内容只保留审计。P5-T1 Steps 1–7 已按严格 TDD 完成：首个 focused 命令中 config 11/11 行为失败，safeFetch/redact 因计划模块尚不存在而加载失败；最小实现完成六源 disabled-default integration config、enabled URL/protocol/range、credential-free serialization、typed source status、exact-origin SSRF bounds、raw-query/redirect/deadline/byte/content-type/JSON enforcement 与 recursive secret/body/header/Kubernetes annotation redaction。

Fresh gates：focused security 25/25；server typecheck exit 0；complete server 264 ordinary pass +48 exact-only skip；task-close exit 0、0 blocker/issue。任务未改 schema/persistence/UI/deployment，MySQL 与 visual N/A。Registry 2,836 clauses；matrix 44 parents / 52 surfaces / 1,420 atoms；manifest 382 rows；atoms 515 verified-local +501 partial +404 pending；parents 24 verified-local +12 partial +8 pending。27 required task atoms 为 partial；PLATFORM-01 与 SEC-01 继续按 least child 为 pending。

Saved/fresh/manifest checkpoint 必须一致为：

- path：`outputs/evidence/source-checkpoints/2026-08-22-p5-t1-integration-security-uncommitted-local-checkpoint.json`
- root：`FB21D786FBD5446BB836505E3A3A33BCEE26AE1FE6F15761482E4472D977A18B`
- inputs：485

Git 仍不存在；Docker/Buildx、GitHub、UHub、immutable digests、SBOM/provenance 均未刷新或宣称；没有 MySQL、Kubernetes、Helm、Argo、kubeconfig、cluster smoke 或退役 Skill 操作。

当前唯一 tuple 是 P5 / P5-T2 / Step 1。只读接班时必须完整读取 P5 工作包的 P5-T2 Files、Interfaces、Steps 和 exit gate；下一动作是先写 15 秒 hit、visibility-independent server cache、concurrent coalescing、三秒 failure cache 与 key-isolation 行为 RED。第一条验证命令为：

```powershell
npm.cmd run test:server -- server/src/integrations
```

不得越过 P5-T2 开始 P5-T3，也不得把 P5-T1 的 local security foundation 冒充 PLATFORM-01、P5 或整个 LifeOps Web 完成。

## 2026-08-22 P5-T2 关闭后的最新正式接班覆盖

本节覆盖本文件更早的 P5-T2 实施前起点；历史内容只保留审计。P5-T2 Steps 1–9 已按严格 TDD 完成。首个 adapter 命令保留 P5-T1 14/14 green，并因六个计划 cache/adapter 模块缺失而失败；独立 service-account RED 随后证明初版 transport 未读取配置的 bearer-token/CA 文件。最小实现现包含 visibility-independent 15-second success cache、coalescing、three-second failure containment、key isolation，allowlisted Kubernetes/Prometheus/Alertmanager/Elasticsearch/GitHub/Argo reads，固定 server-owned queries/templates，source-local failures，file-backed service-account TLS，以及 immutable Web/API digest parsing。

Fresh gates：focused integration 40/40；server typecheck exit 0；complete server 290 ordinary pass +48 exact-only skip；task-close exit 0、0 blocker/issue。无 schema 或 UI 变化，MySQL 与 visual N/A。Matrix 仍为 44 parents / 52 surfaces / 1,420 atoms；manifest 385 rows；atoms 515 verified-local +516 partial +389 pending；parents 24 verified-local +12 partial +8 pending。42 required P5-T2 atoms 均为 partial；PLATFORM-01/SEC-01 仍按 least child 为 pending。

Saved/fresh/manifest checkpoint 必须一致为：

- path：`outputs/evidence/source-checkpoints/2026-08-22-p5-t2-read-only-adapters-uncommitted-local-checkpoint.json`
- root：`10B1CD33A241A432B1D013EA72048835F0D307075B824A58FFDABB05020A5F1F`
- inputs：497

Git 仍不存在；Docker/Buildx、GitHub、UHub、immutable digests、SBOM/provenance 均未刷新或宣称；没有 MySQL、Kubernetes cluster、Helm、Argo deployment、kubeconfig、cluster smoke 或退役 Skill 操作。

当前唯一 tuple 是 P5 / P5-T3 / Step 1。第一动作是在 server package 精确安装并锁定 `prom-client@15.1.3`；第一条命令为：

```powershell
npm.cmd --prefix server install --save-exact prom-client@15.1.3
```

安装后必须先写 metrics、platform routes、platform UI 与 accessible chart 的行为 RED，再实施 P5-T3；不得越过 P5-T3 开始 P5-T4，也不得把 adapters local close 冒充 PLATFORM-01、P5 或项目完成。

## 2026-08-23 P5-T3 关闭后的最新正式接班覆盖

本节覆盖本文件更早的 P5-T3 实施前起点；历史内容只保留审计。P5-T3 Steps 1–11 已按严格 TDD 完成。Exact `prom-client@15.1.3`、public bounded metrics、seven authenticated platform routes、truthful source-local degradation、bright continuous operations UI、accessible trends、technology delivery truth 和 visibility-only polling/abort 均已有当前证据。真实 390×844 浏览器验收曾拒收 off-screen 当前一级 `平台`；route/resize-aware centering 现使 390/320 当前项可见且不隐藏批准的十项 IA。

Fresh gates：focused server 8/8；focused platform/navigation Web 11/11；complete server 298 ordinary pass +48 exact-only skip；complete Web 79 files/359 tests；dual typecheck/build；focused Chromium 2/2。Primary executor inspected the authenticated page、monitoring/technology tabs、1440/1024/768/390/320 geometry and opened the final standard/reduced-motion artifacts。P5-T3 无 migration/persistence 语义，MySQL N/A。

Matrix 仍为 44 parents / 52 surfaces / 1,420 atoms；manifest 395 rows；atoms 572 verified-local +564 partial +284 pending；parents 24 verified-local +13 partial +7 pending。PLATFORM-01 只到 atom-derived partial；SEC-01 仍因 later rendered-RBAC least child 为 pending。

Saved/fresh/manifest checkpoint 必须一致为：

- path：`outputs/evidence/source-checkpoints/2026-08-23-p5-t3-truthful-operations-center-uncommitted-local-checkpoint.json`
- root：`C4FD4B2547D398DE7199CA580A62101E251EDFD85BCF9B38E9E3339E4B236A73`
- inputs：512

Git 仍不存在；Docker/Buildx、GitHub、UHub、immutable digests、SBOM/provenance 均未刷新或宣称；没有 MySQL、Kubernetes cluster、Helm、Argo deployment、kubeconfig、cluster smoke 或退役 Skill 操作。

当前唯一 tuple 是 P5 / P5-T4 / Step 1。只读接班时必须完整读取 P5 工作包的 P5-T4 Files、Interfaces、Steps 和 exit gate；下一动作是写 personal-search ranking behavioral RED。第一条验证命令为：

```powershell
npm.cmd run test:server -- server/src/domain/search.test.ts server/src/routes/search.test.ts
```

不得越过 P5-T4 开始 P5-T5，也不得把 platform-center local close 冒充 PLATFORM-01、SEC-01、P5 或整个 LifeOps Web 完成。

## 2026-08-23 P5-T4 关闭后的最新正式接班覆盖

本节覆盖本文件更早的 P5-T4 实施前起点；历史内容只保留审计。P5-T4 Steps 1–8 已按严格 TDD 完成。Migration 015 search index/backfill/transaction-local triggers、owner/type/deleted bounds、literal LIKE escaping、deterministic title/tag/body/recency ranking、Chinese substring、recipe/day-plan context、plain-text excerpts 与十五种 approved types 均有当前 server/API/MySQL/security evidence。Command overlay 已具备 180ms debounce、stale abort、分组、private recent、keyboard/Enter/Escape/focus restore、route navigation 和 honest loading/empty/error states。

Fresh gates：focused server 14/14；focused Web/layout 12/12；complete server 312 ordinary pass +49 exact-only skip；official isolated MySQL Community Server 8.4.10 49/49 zero-skip；complete Web 81 files/366 tests；dual typecheck/build；focused Chromium 1/1；complete Chromium 78/78。Primary executor inspected the authenticated overlay and opened final 1440/1024/768/390/320/reduced-motion artifacts。The isolated MySQL task instance was cleanly shut down and verified absent by ping/process/listener/pidfile。

Matrix remains 44 parents / 52 surfaces / 1,420 atoms；manifest 407 rows；atoms 601 verified-local +553 partial +266 pending；parents 24 verified-local +13 partial +7 pending。All 44 search-surface atoms are verified-local；GLOBAL-01 remains pending on P5-T5/P5-T6 and LIFE-21 remains partial on P5-T5。

Saved/fresh/manifest checkpoint 必须一致为：

- path：`outputs/evidence/source-checkpoints/2026-08-23-p5-t4-unified-personal-search-uncommitted-local-checkpoint.json`
- root：`FEE7B3FAA84C7CBF4E469B34721C6F95FB7B9920CC006105FAA25D8B0EE484A4`
- inputs：522

Git 仍不存在；Docker/Buildx、GitHub、UHub、immutable digests、SBOM/provenance 均未刷新或宣称；没有 Kubernetes cluster、Helm、Argo deployment、kubeconfig、cluster smoke 或退役 Skill 操作。

当前唯一 tuple 是 P5 / P5-T5 / Step 1。只读接班时必须完整读取 P5 工作包的 P5-T5 Files、Interfaces、Steps 和 exit gate；下一动作是写 context-aware quick-create behavioral RED。第一条验证命令为：

```powershell
npm.cmd test -- src/components/private/QuickCreate.test.tsx src/components/private/quickCreateContext.test.ts
```

不得越过 P5-T5 开始 P5-T6，也不得把 personal-search local close 冒充 GLOBAL-01、LIFE-21、P5 或整个 LifeOps Web 完成。

## 2026-08-23 P5-T5 关闭后的最新正式接班覆盖

本节覆盖本文件更早的 P5-T5 实施前起点；历史内容只保留审计。P5-T5 Steps 1–8 已按严格 TDD 完成。Loaded-user-ID-only context、十五种 approved create adapters、one-key retry/fresh create-another、pending duplicate suppression、server-confirmed success、expiry-safe undo、focus trap/restore、responsive task layering 与 reduced motion 均有当前证据。真实 390px browser RED 曾证明 record editor 位于全局 dialog 上方；最终全局层级修正后，标题输入在所有 viewport 都由 elementFromPoint 验证为 topmost interactive。

Fresh gates：focused Quick Create/context/shell 19/19；all 15 adapter types；complete Web 83 files/381 tests；dual client/server typecheck/build；complete server 312 ordinary pass +49 unchanged exact-only skip；focused Chromium 1/1；reviews 4/4；complete Chromium 79/79。Primary executor opened the final 1440/1024/768/390/320/reduced-motion artifacts after the z-index correction。P5-T5 changes no server/schema；no fresh MySQL run is claimed，and only the unchanged official P5-T4 49/49 baseline is reused for existing domain endpoints。

Matrix remains 44 parents / 52 surfaces / 1,420 atoms；manifest 418 rows；atoms 635 verified-local +542 partial +243 pending；parents 25 verified-local +12 partial +7 pending。All 54 scoped Quick Create/Life relation atoms are verified-local；generic cross-surface state atoms remain P5-T7。LIFE-21 is verified-local；GLOBAL-01 remains pending on P5-T6 settings least children。

Saved/fresh/manifest checkpoint 必须一致为：

- path：`outputs/evidence/source-checkpoints/2026-08-23-p5-t5-context-aware-quick-create-uncommitted-local-checkpoint.json`
- root：`38B5AD311D49DC44DEFF572BB80E1638608417C653161604212E24C2A332CB47`
- inputs：526

Git 仍不存在；Docker/Buildx、GitHub、UHub、immutable digests、SBOM/provenance 均未刷新或宣称；没有新的 MySQL、Kubernetes cluster、Helm、Argo deployment、kubeconfig、cluster smoke 或退役 Skill 操作。

当前唯一 tuple 是 P5 / P5-T6 / Step 1。只读接班时必须完整读取 P5 工作包的 P5-T6 Files、Interfaces、Steps 和 exit gate；下一动作是写 settings/account behavioral RED。第一条验证命令为：

```powershell
npm.cmd run test:server -- server/src/services/dataTransfer.test.ts server/src/routes/settings.test.ts
```

不得越过 P5-T6 开始 P5-T7，也不得把 Quick Create local close 冒充 GLOBAL-01、P5 或整个 LifeOps Web 完成。
