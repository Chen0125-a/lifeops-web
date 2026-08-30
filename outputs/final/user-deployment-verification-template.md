# LifeOps user deployment verification record

> Copy this template outside the repository for each environment. Do not paste credentials, kubeconfig content, private endpoints, cookies, tokens, Secret values, database dumps, or raw user data into this record.

## 1. Environment and reviewer

- Environment name: `<ENVIRONMENT_NAME>`
- Review date/time and timezone: `<ISO_8601_TIME>`
- Reviewer role: `<ROLE>`
- Kubernetes version and CPU architecture: `<OBSERVED_VERSION_AND_ARCH>`
- Deployment method: `<ARGO_CD_OR_HELM>`
- Namespace: `<NAMESPACE>`
- Public hostname: `<HOSTNAME_WITHOUT_CREDENTIALS>`
- Evidence location with restricted access: `<SANITIZED_EVIDENCE_LOCATION>`

## 2. Expected immutable release

- Source revision: `64cb76932def9eed94cb43aea104c97eb19f1382`
- GitOps digest commit: `03d812339cb42bfb3633ad613b4dd55509fd0084`
- Web digest: `sha256:31d13ed140d0f3343bbef40355e736ce8d63298ffa3c3efb97f27659fb9fa4af`
- API digest: `sha256:c70d0b33612e36c171c4085639e8cf7d558abdbd37b780fb0bd651a4e7c9c5e3`
- Release manifest: `outputs/final/release-manifest.json`
- Deployment values: `deploy/gitops/environments/production/values.yaml`

Record the actually observed revision and image IDs below. A tag, local image ID, or expected value copied without observing the workload is not evidence.

- Observed source revision: `<OBSERVED_40_CHARACTER_REVISION>`
- Observed Web image ID/digest: `<OBSERVED_WEB_SHA256_DIGEST>`
- Observed API image ID/digest: `<OBSERVED_API_SHA256_DIGEST>`
- Exact match result: `<PASS_FAIL_UNVERIFIED>`

## 3. Capability decisions

| Decision | Selected branch | Read-only evidence reference | Result |
| --- | --- | --- | --- |
| Kubernetes version/architecture and nodes | `<VALUE>` | `<REFERENCE>` | `<PASS_FAIL_UNVERIFIED>` |
| Gateway API or Ingress | `<VALUE>` | `<REFERENCE>` | `<PASS_FAIL_UNVERIFIED>` |
| LoadBalancer/MetalLB/external LB | `<VALUE>` | `<REFERENCE>` | `<PASS_FAIL_UNVERIFIED>` |
| DNS and TLS | `<VALUE>` | `<REFERENCE>` | `<PASS_FAIL_UNVERIFIED>` |
| Dynamic StorageClass and RWO/RWX | `<VALUE>` | `<REFERENCE>` | `<PASS_FAIL_UNVERIFIED>` |
| Secret or ExternalSecret | `<VALUE>` | `<REFERENCE_WITHOUT_SECRET_VALUES>` | `<PASS_FAIL_UNVERIFIED>` |
| Registry pull access | `<VALUE>` | `<REFERENCE>` | `<PASS_FAIL_UNVERIFIED>` |
| Monitoring assets/CRDs | `<ENABLED_DISABLED_UNVERIFIED>` | `<REFERENCE>` | `<PASS_FAIL_UNVERIFIED>` |
| Database | `<EMBEDDED_RDS_VM_OR_OPERATOR>` | `<REFERENCE>` | `<PASS_FAIL_UNVERIFIED>` |
| Media | `<RWX_S3_OR_BOUNDED_SINGLE_REPLICA_RWO>` | `<REFERENCE>` | `<PASS_FAIL_UNVERIFIED>` |

## 4. Offline package preflight

- `scripts/validate-deployment-package.ps1`: `<PASS_FAIL>`
- Helm lint/default render: `<PASS_FAIL>`
- Helm production render/schema: `<PASS_FAIL>`
- Argo Application/values path resolution: `<PASS_FAIL>`
- Secret/plaintext scan: `<PASS_FAIL>`
- Unsafe media topology rejection: `<PASS_FAIL>`
- Sanitized summary path/hash: `<PATH_AND_SHA256>`

## 5. User-owned deployment observations

These are user-run observations. The LifeOps Web delivery project does not pre-claim them.

- Secret/ExternalSecret readiness: `<PASS_FAIL_UNVERIFIED>`
- Optional MySQL readiness or external database connectivity: `<PASS_FAIL_UNVERIFIED>`
- Migration Job completed once for the target revision: `<PASS_FAIL_UNVERIFIED>`
- Web Deployment ready: `<PASS_FAIL_UNVERIFIED>`
- API Deployment/HPA ready: `<PASS_FAIL_UNVERIFIED>`
- HTTPRoute or Ingress accepted: `<PASS_FAIL_UNVERIFIED>`
- DNS resolves to the intended entry point: `<PASS_FAIL_UNVERIFIED>`
- TLS certificate and hostname verification: `<PASS_FAIL_UNVERIFIED>`
- Optional integrations report only `connected`, `disabled`, `degraded`, or `unverified` as observed: `<RESULT>`

## 6. Application-only smoke

- Smoke command date/time: `<ISO_8601_TIME>`
- Sanitized report path/hash: `<PATH_AND_SHA256>`
- HTTPS enforced: `<PASS_FAIL>`
- Web health and API reachability: `<PASS_FAIL>`
- Login: `<PASS_FAIL>`
- Authenticated create/read/cleanup: `<PASS_FAIL>`
- Restart/reload persistence: `<PASS_FAIL>`
- Life exactly-once sentinel: `<PASS_FAIL>`
- Media/publishing checks when enabled: `<PASS_FAIL_NOT_APPLICABLE>`
- Cleanup limited to unique `lifeops-smoke-*` application records: `<PASS_FAIL>`
- No Pod/PVC/Namespace deletion by the smoke: `<PASS_FAIL>`

## 7. Operations and recovery

- Prometheus target/query: `<PASS_FAIL_DISABLED_UNVERIFIED>`
- Grafana dashboard: `<PASS_FAIL_DISABLED_UNVERIFIED>`
- PrometheusRule alerts: `<PASS_FAIL_DISABLED_UNVERIFIED>`
- Request-ID log correlation: `<PASS_FAIL_DISABLED_UNVERIFIED>`
- Database backup location/reference, without contents: `<REFERENCE>`
- Database restore drill result: `<PASS_FAIL_UNVERIFIED>`
- Media backup/restore drill result: `<PASS_FAIL_UNVERIFIED>`
- RTO/RPO and rollback decision owner recorded: `<PASS_FAIL>`
- Database connection budget checked: `<PASS_FAIL>`
- Scaling/restart validation repeated after topology changes: `<PASS_FAIL_NOT_APPLICABLE>`

## 8. Final disposition

- Deployment verification status: `<ACCEPTED_BLOCKED_OR_UNVERIFIED>`
- Blocking facts: `<SANITIZED_FACTS_OR_NONE>`
- Known limitations: `<SANITIZED_LIMITATIONS>`
- Rollback or safe-stop action taken: `<ACTION_OR_NONE>`
- Reviewer sign-off/reference: `<REFERENCE>`

An `ACCEPTED` status requires all applicable checks above to contain observed evidence. Blank fields, copied expected values, skipped checks, or unavailable external state remain `UNVERIFIED`.
