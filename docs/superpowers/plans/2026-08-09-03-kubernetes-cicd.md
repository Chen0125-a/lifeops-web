# Kubernetes 与 CI/CD 实施计划

> **状态：已被最终实施计划取代，仅保留历史审计，禁止单独执行。** 当前唯一实施入口是 `2026-08-09-00-lifeops-final-master-plan.md`，生产交付以 `2026-08-09-06-lifeops-production-delivery-plan.md` 为准。

1. 先写静态断言测试：双镜像、非 root、健康检查、Secret 引用、digest 可配置。
2. 增加 API 多阶段 Dockerfile 和 Web Nginx 同域代理配置。
3. 扩展 Helm 为 web/api 双工作负载、migration Job、可选 MySQL StatefulSet/PVC、HTTPRoute/Ingress。
4. 增加 GitHub Actions CI 与 UHub release；release 读取 digest 并更新 GitOps values。
5. 运行 helm lint/template、镜像 build（环境允许时）和部署 smoke 合同检查。
6. 更新运维文档：首装、Secret、回滚、外部 MySQL、后续 Jenkins/Argo 接管。
