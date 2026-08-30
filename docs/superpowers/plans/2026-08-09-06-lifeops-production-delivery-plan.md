# LifeOps Production Image and Deployment Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the verified LifeOps Web/API into immutable, observable, least-privilege production images, release them through GitHub Actions and UHub, and deliver a validated package the user can deploy and verify on their Kubernetes cluster.

**Architecture:** Schema migration is packaged as a dedicated pre-sync job before API rollout. Media storage is selected through one storage port and supports an RWX filesystem PVC or an S3-compatible object store selected by the user. Helm renders explicit security, RBAC, network and monitoring resources. GitHub Actions tests, builds, attests and pushes both images, writes immutable digests to GitOps values, and produces a release manifest. Cluster application deployment remains user-operated; the project supplies tested checks and runbooks without accessing the cluster.

**Tech Stack:** Node 24.17.0, React 19.2.8, Fastify 5.11.3, MySQL 8.4.10, `@aws-sdk/client-s3` 3.1097.0, Playwright 1.62.1, `@axe-core/playwright` 4.12.1, Lighthouse 13.4.1, Docker Buildx, OCI provenance/SBOM attestations, Helm 3.19.0, GitHub Actions, UHub, Argo CD, Prometheus Operator, Grafana and Elasticsearch/Kibana.

## Global Constraints

- Do not push an image or change release/GitOps digests until the release preflight names the exact Git repository, release revision and Web/API UHub repositories. This plan never syncs Argo CD, mutates a namespace or performs a cluster rollback.
- Never print, persist, screenshot or add to Git any password, token, kubeconfig, cookie, private key, UHub credential or integration secret. Evidence records secret names and health only.
- API startup does not mutate schema. The migration job must finish successfully before the new API revision becomes eligible to roll out.
- Migrations are forward-only and compatible with the currently running application. Rollback changes application/image revision; it never applies a destructive down migration.
- The migration gate applies through `014_settings_audit.sql`; life catalog, inventory, recipe, planning and commerce migrations `006`–`010` must be present exactly once and checksum verified before rollout.
- Filesystem media values may request multiple API replicas only when the user selects an RWX StorageClass; the production renderer rejects an unsafe combination and documents S3-compatible storage as the alternative.
- Production images run as non-root, use read-only root filesystems, drop all Linux capabilities, contain no development dependency tree, and are referenced by digest in production values.
- Kubernetes integration receives only the read verbs/resources enumerated in P6-T2. It never receives Secret read, pod logs, exec, impersonate or any mutation verb.
- `/metrics` remains cluster-internal. The public HTTPRoute/Ingress exposes `/api` and the Web application, never the API metrics endpoint.
- Monitoring resources report LifeOps application behavior; they do not claim that Prometheus, Grafana, Alertmanager or ELK is installed when the preflight cannot find it.
- If examples discuss the user's Phase-1 environment, they keep the truthful `2 LB + 1 control-plane + 2 worker` wording and do not claim control-plane HA.
- A successful source build, image build or Helm render alone is insufficient. The completion gate requires both UHub digests, exact-digest Web/API/MySQL smoke, SBOM/provenance evidence and a complete validated user deployment package.
- Goal mode, Skills, generated screenshots and historical green output are process aids, never acceptance evidence. Visual proof is valid only with a current reproducibility manifest and opened-artifact review against the approved golden slices and five veto axes.
- Follow the master plan's Git-or-SHA checkpoint rule after every task.

---

### P6-T1: Dedicated migrations and production media storage

**Files:**
- Modify: `server/package.json`
- Modify: `server/package-lock.json`
- Create: `server/src/migrate-main.ts`
- Create: `server/src/migrate-main.test.ts`
- Modify: `server/src/runtime.ts`
- Create: `server/src/runtime.test.ts`
- Modify: `server/src/main.ts`
- Create: `server/src/media/s3Storage.ts`
- Create: `server/src/media/s3Storage.test.ts`
- Create: `server/src/media/storageFactory.ts`
- Create: `server/src/media/storageFactory.test.ts`
- Modify: `server/src/config.ts`
- Modify: `server/Dockerfile`
- Create: `deploy/helm/lifeops-web/templates/migration-job.yaml`
- Create: `deploy/helm/lifeops-web/templates/media-pvc.yaml`
- Modify: `deploy/helm/lifeops-web/templates/api-deployment.yaml`
- Modify: `deploy/helm/lifeops-web/values.yaml`
- Modify: `deploy/gitops/environments/production/values.yaml`
- Create: `scripts/validate-media-topology.ps1`
- Create: `scripts/validate-media-topology.test.ps1`

**Interfaces:**
- `npm --prefix server run migrate` executes only ordered schema migrations and exits non-zero on checksum drift or database failure.
- `createRuntime` opens stores/integrations and never calls `runMigrations`.
- `MediaStorageConfig` is the discriminated union `{ backend: 'filesystem', root } | { backend: 's3', endpoint, region, bucket, forcePathStyle }`; credentials are read separately from environment/Secret refs.
- `S3Storage` implements the P1 `MediaStorage` port with private objects, random keys, bounded reads and delete-after-database confirmation.
- The Argo pre-sync Job uses the same API image digest as the Deployment and has a finite deadline/backoff.

- [x] **Step 1: Install and lock the S3-compatible client.**

```powershell
npm.cmd --prefix server install --save-exact @aws-sdk/client-s3@3.1097.0
```

Verify the exact version in both server package files.

- [x] **Step 2: Write failing runtime/migration tests** proving `createRuntime` does not call `runMigrations`, the migration entry calls it exactly once, closes the pool on success/failure, emits no password-bearing error and exits non-zero on checksum drift.

```powershell
npm.cmd run test:server -- server/src/runtime.test.ts server/src/migrate-main.test.ts
```

Expected: FAIL because migrations currently execute inside `createRuntime` and no dedicated entry exists.

- [x] **Step 3: Write failing S3 adapter/factory tests** using a fake `S3Client` for private `PutObject`, ranged/bounded `GetObject`, `HeadObject`, `DeleteObject`, endpoint/region/bucket validation, random storage keys, size/MIME reuse from P1, missing object mapping and credential-free errors.

```ts
expect(sentPut.input).toMatchObject({
  Bucket: 'lifeops-media',
  Key: expect.stringMatching(/^[a-f0-9]{2}\/[a-f0-9-]+\.png$/),
  ContentType: 'image/png',
})
expect(sentPut.input).not.toHaveProperty('ACL', 'public-read')
```

- [x] **Step 4: Run focused storage tests and verify missing-module failures.**

```powershell
npm.cmd run test:server -- server/src/media/s3Storage.test.ts server/src/media/storageFactory.test.ts
```

- [x] **Step 5: Implement the migration entry and remove schema mutation from API startup.** Add `"migrate": "node dist/migrate-main.js"` to the server scripts, build both entries in the same image, handle SIGTERM, close the pool in `finally`, and keep bootstrap-user creation idempotent in application startup after the schema gate.

- [x] **Step 6: Implement S3 storage and the strict storage factory.** Do not fall back from a misconfigured S3 backend to local disk. Filesystem keys remain under the configured root; S3 objects remain private and are streamed with the same maximum response limit enforced by media routes.

- [x] **Step 7: Write failing Helm/media topology tests.** Render filesystem/RWX, S3 and invalid multi-replica/RWO combinations. Require:
  - a pre-sync migration Job with `activeDeadlineSeconds: 600`, `backoffLimit: 1`, no ServiceAccount token and API digest parity;
  - PVC mount only for filesystem mode;
  - no S3 secret values in rendered YAML;
  - topology validator rejection when `api.replicaCount > 1` and filesystem access mode lacks `ReadWriteMany`.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-media-topology.test.ps1
helm lint deploy/helm/lifeops-web
```

- [x] **Step 8: Implement Helm migration/media resources.** Annotate the migration Job as Argo `PreSync` with sync wave `-10` and `BeforeHookCreation,HookSucceeded` deletion policy; wait for MySQL readiness through retrying application code rather than embedding database credentials in shell text. Configure S3 keys through Secret refs and filesystem bytes through a named PVC.

- [x] **Step 9: Run server, MySQL, image-build and Helm gates.**

```powershell
npm.cmd run test:server -- server/src/runtime.test.ts server/src/migrate-main.test.ts server/src/media
npm.cmd run test:mysql
npm.cmd run typecheck:server
npm.cmd run build:server
docker build --file server/Dockerfile --tag lifeops-api:plan6-media .
helm lint deploy/helm/lifeops-web
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-media-topology.ps1 -ValuesFile deploy/gitops/environments/production/values.yaml
```

- [x] **Step 10: Commit or hash P6-T1** with message `feat(delivery): separate migrations and production media`.

### P6-T2: Least-privilege RBAC, pod security, networking and secret boundaries

**Files:**
- Create: `deploy/helm/lifeops-web/values.schema.json`
- Create: `deploy/helm/lifeops-web/templates/platform-serviceaccount.yaml`
- Create: `deploy/helm/lifeops-web/templates/platform-clusterrole.yaml`
- Create: `deploy/helm/lifeops-web/templates/platform-clusterrolebinding.yaml`
- Create: `deploy/helm/lifeops-web/templates/configmap.yaml`
- Create: `deploy/helm/lifeops-web/templates/networkpolicy.yaml`
- Modify: `deploy/helm/lifeops-web/templates/api-deployment.yaml`
- Modify: `deploy/helm/lifeops-web/templates/deployment.yaml`
- Modify: `deploy/helm/lifeops-web/templates/mysql-statefulset.yaml`
- Modify: `deploy/helm/lifeops-web/templates/secret.yaml`
- Modify: `deploy/helm/lifeops-web/templates/external-secret.yaml`
- Modify: `deploy/helm/lifeops-web/values.yaml`
- Modify: `deploy/gitops/environments/production/values.yaml`
- Create: `scripts/validate-rendered-helm.ps1`
- Create: `scripts/validate-rendered-helm.test.ps1`

**Interfaces:**
- `platform.kubernetes.enabled` controls an explicitly projected ServiceAccount token; disabled mode has no Kubernetes token volume or binding.
- Cluster permissions are exactly `get,list` on core `nodes`; `get,list` on core `pods,services,namespaces`; `get,list` on apps `deployments,statefulsets,daemonsets,replicasets`; and `get,list` on Gateway API `httproutes,gateways`.
- Non-secret application and integration coordinates are stored in a ConfigMap; workloads reference it and carry a checksum annotation so reviewed configuration changes trigger a rollout.
- Network policy permits named ingress/egress peers and required ports only; enabled configuration must include DNS, MySQL, Gateway/monitoring scrape and configured integration endpoints.
- Helm schema rejects inline secret data in production and mutually enabled Ingress/HTTPRoute.

- [x] **Step 1: Write failing rendered-manifest tests** for enabled/disabled Kubernetes integration, exact RBAC verbs/resources, absence of wildcard/non-resource URLs and rejection of Secret/log/exec/mutation access.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-rendered-helm.test.ps1
```

- [x] **Step 2: Add failing pod-security tests** for every workload and Job: non-root UID/GID, RuntimeDefault seccomp, read-only root filesystem, no privilege escalation, `ALL` capabilities dropped, finite resources, probes, graceful shutdown and no implicit ServiceAccount token.

- [x] **Step 3: Add failing secret-boundary tests** proving production rendering uses existing Secret/ExternalSecret references, values files contain no non-empty secret values, environment variables use `secretKeyRef`, and rendered output contains no known fixture secret.

- [x] **Step 4: Add failing network-policy tests** for default isolation, Web ingress from the configured Gateway namespace, API ingress from Gateway and Prometheus, MySQL ingress from API/migration, DNS egress, MySQL egress and allowlisted integration CIDRs/ports. Reject `0.0.0.0/0` integration egress unless an explicit reviewed override is set.

- [x] **Step 5: Implement schema, ConfigMap, RBAC, projected token/CA mount and network policies.** Keep `automountServiceAccountToken: false`; mount a short-lived projected token only when Kubernetes integration is enabled. The server reads its configured token/CA paths from that volume. Store only non-secret normalized settings in the ConfigMap and use Secret refs for every credential.

- [x] **Step 6: Harden all workload templates.** Preserve writable `emptyDir` mounts only for `/tmp` and Nginx runtime directories; set checksum annotations for non-secret config, topology spread, anti-affinity where schedulable, rollout strategy and PodDisruptionBudget without presenting Phase-1 as control-plane HA.

- [x] **Step 7: Run the complete render matrix.**

```powershell
helm lint deploy/helm/lifeops-web
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-rendered-helm.ps1 -ValuesFile deploy/helm/lifeops-web/values.yaml
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-rendered-helm.ps1 -ValuesFile deploy/gitops/environments/production/values.yaml -Production
```

Expected: all documents parse; production output contains two digest-pinned application images, no inline credential and only the approved RBAC surface.

- [x] **Step 8: Commit or hash P6-T2** with message `feat(helm): enforce least-privilege production boundaries`.

### P6-T3: Application observability and platform monitoring assets

**Files:**
- Create: `deploy/helm/lifeops-web/templates/servicemonitor.yaml`
- Create: `deploy/helm/lifeops-web/templates/prometheusrule.yaml`
- Create: `deploy/helm/lifeops-web/templates/grafana-dashboard.yaml`
- Modify: `deploy/helm/lifeops-web/templates/api-service.yaml`
- Modify: `deploy/helm/lifeops-web/templates/networkpolicy.yaml`
- Modify: `deploy/helm/lifeops-web/values.yaml`
- Modify: `deploy/gitops/environments/production/values.yaml`
- Modify: `server/src/observability/metrics.ts`
- Create: `server/src/observability/structuredLogger.ts`
- Create: `server/src/observability/structuredLogger.test.ts`
- Modify: `server/src/app.ts`
- Create: `docs/runbooks/observability.md`
- Create: `scripts/validate-observability.ps1`
- Create: `scripts/validate-observability.test.ps1`

**Interfaces:**
- Metrics are named `lifeops_http_requests_total`, `lifeops_http_request_duration_seconds`, `lifeops_http_active_requests`, `lifeops_build_info` and process-default metrics; labels are limited to method, normalized route, status class and service.
- Alerts: `LifeOpsUnavailable`, `LifeOpsHigh5xxRate`, `LifeOpsHighP95Latency`, `LifeOpsPodRestarting`, `LifeOpsReadinessFailing`.
- Grafana dashboard sections: availability/request rate, 5xx rate, p50/p95 duration, active requests, pod CPU/memory/restarts and deployment revision.
- Structured log fields: timestamp, level, service, requestId, method, normalized route, statusCode, durationMs, errorCode; never bodies, authorization, cookies or secret values.

- [x] **Step 1: Write failing structured-log tests** for success/error requests, stable request IDs, normalized routes, multiline/control-character sanitization and recursive redaction of credential-like fields.

```powershell
npm.cmd run test:server -- server/src/observability/structuredLogger.test.ts server/src/observability/metrics.test.ts
```

- [x] **Step 2: Write failing observability-render tests** for conditional CRD resources, cluster-internal metrics port, 30-second scrape, all five alert rules, `for` durations, severity/runbook labels, Grafana sidecar label and dashboard query references that match exported metric names.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-observability.test.ps1
```

- [x] **Step 3: Implement sanitized logging and metric registration.** Exclude health/readiness from error-rate SLO calculations while retaining availability probes. Ensure repeated test/app construction does not double-register metrics.

- [x] **Step 4: Implement the ServiceMonitor and NetworkPolicy scrape path.** The API Service exposes a named `metrics` target port to cluster clients; Gateway/Ingress rules still omit `/metrics`.

- [x] **Step 5: Implement exact alert expressions and dashboard JSON.** Rules use release/namespace labels and ratios guarded against zero traffic. Every alert links to `docs/runbooks/observability.md`, which contains inspect, confirm, mitigate and recover steps without destructive automation.

- [x] **Step 6: Validate assets locally.**

```powershell
npm.cmd run test:server -- server/src/observability
npm.cmd run typecheck:server
helm template lifeops deploy/helm/lifeops-web -f deploy/gitops/environments/production/values.yaml | powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-observability.ps1 -FromStdin
```

- [x] **Step 7: Commit or hash P6-T3** with message `feat(observability): ship metrics alerts and dashboard`.

### P6-T4: Reproducible CI, image hardening and software-supply-chain evidence

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `Dockerfile`
- Modify: `server/Dockerfile`
- Modify: `.dockerignore`
- Create: `scripts/resolve-action-shas.ps1`
- Create: `scripts/validate-workflows.ps1`
- Create: `scripts/validate-workflows.test.ps1`
- Create: `scripts/smoke-images.ps1`
- Create: `scripts/smoke-images.test.ps1`
- Modify: `scripts/update-gitops-values.mjs`
- Create: `scripts/update-gitops-values.test.mjs`

**Interfaces:**
- Every `uses:` entry is pinned to a full 40-character commit SHA with its human-readable release tag in a trailing comment.
- CI gates root/server `npm ci`, unit, MySQL, typecheck, build, complete Playwright, accessibility, Helm lint/render and workflow validators.
- Release emits Web/API OCI images for `linux/amd64`, provenance and SBOM attestations, resolves registry digests, smoke-tests those exact digests, then updates only the two production digest fields.
- Image smoke proves non-root identity, read-only root, health/readiness, static deep-link fallback, API login/CRUD and clean SIGTERM against MySQL 8.4.

- [x] **Step 1: Write failing workflow tests** for mutable action tags, missing minimum `permissions`, unbounded timeouts, missing concurrency, skipped test jobs, floating image bases, unpinned digests, secret interpolation in command arguments and GitOps modification outside the two digest keys.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-workflows.test.ps1
```

- [x] **Step 2: Resolve action commit SHAs from official repositories at execution time.** For each existing action (`actions/checkout`, `actions/setup-node`, `azure/setup-helm`, `docker/setup-buildx-action`, and any newly selected official Docker action), query the release tag with `git ls-remote`, require one 40-character commit and write it through `scripts/resolve-action-shas.ps1`. Record tag-to-SHA evidence; do not invent or retain a mutable tag in `uses:`.

- [x] **Step 3: Write failing image-smoke tests** with a disposable Docker network and MySQL 8.4 container. Assert the script always stops/removes containers it created, never removes pre-existing resources, and redacts database/admin credentials from output.

- [x] **Step 4: Harden Docker contexts and images.** Keep exact base tags, copy only lockfile-controlled inputs, run Web as Nginx UID and API as UID 10001, add OCI revision/source labels at build time, preserve SPA fallback/security headers and add no shell package to runtime images solely for health checks.

- [x] **Step 5: Implement CI/release gates and attestations.** Build with Buildx provenance and SBOM enabled. Use UHub login via `--password-stdin`. Resolve digests from the registry, run `scripts/smoke-images.ps1` against those digests, and call `update-gitops-values.mjs` only after both smokes pass.

- [x] **Step 6: Make GitOps update deterministic.** The updater must reject non-`sha256:` digests, missing image sections, anchors/duplicate keys and unrelated file changes; tests compare the full YAML before/after except the two allowed scalar values.

- [x] **Step 7: Run the complete local supply-chain gate.**

```powershell
npm.cmd ci --ignore-scripts
npm.cmd --prefix server ci --ignore-scripts
npm.cmd audit --omit=dev --audit-level=high
npm.cmd --prefix server audit --omit=dev --audit-level=high
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-workflows.ps1
docker build --file Dockerfile --tag lifeops-web:plan6 .
docker build --file server/Dockerfile --tag lifeops-api:plan6 .
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-images.ps1 -WebImage lifeops-web:plan6 -ApiImage lifeops-api:plan6
```

Network-dependent audit failure must be recorded as infrastructure failure, not converted into a pass.

- [x] **Step 8: Commit or hash P6-T4** with message `ci(release): attest and smoke immutable images`.

### P6-T5: Whole-product visual, accessibility, motion and performance acceptance

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `playwright.config.ts`
- Modify: `playwright.remote.config.ts`
- Create: `tests/accessibility-full.spec.ts`
- Create: `tests/motion-continuity.spec.ts`
- Create: `tests/orbit-geometry.spec.ts`
- Create: `tests/complete-product.spec.ts`
- Create: `tests/performance-budget.spec.ts`
- Create: `tests/helpers/axe.ts`
- Create: `tests/helpers/motionProbe.ts`
- Create: `scripts/run-lighthouse.mjs`
- Create: `lighthouse.config.cjs`
- Modify: `tests/visual-capture.spec.ts`
- Modify: `tests/responsive-accessibility.spec.ts`
- Modify: `src/theme/theme.ts`
- Modify: `src/theme/theme.test.ts`
- Modify: `src/pages/PublicHomePage.tsx`
- Modify: `src/pages/PublicHomePage.test.tsx`
- Modify: `src/components/public/orbitGeometry.ts`
- Modify: `src/components/public/orbitGeometry.test.ts`
- Modify: `src/components/public/PublicOrbit.tsx`
- Modify: `src/components/public/PublicOrbitFallback.tsx`
- Modify: `src/components/public/PublicOrbit.test.tsx`
- Modify: `src/components/public/OrbitGlyph.tsx`
- Modify: `src/styles/public.css`
- Modify: `tests/public-login.spec.ts`
- Create: `outputs/final/README.md`
- Create: `outputs/final/visual-evidence-manifest.json`

**Interfaces:**
- Browser matrix: Chromium `1440x900`, `1024x768`, `768x1024` and `390x844`, plus 200% zoom and 320 CSS px reflow; Firefox/WebKit run critical public/login/private navigation journeys.
- Axe scans every public detail and private top-level route in loading/data/empty/error states, with zero serious or critical violations.
- Motion probes assert no full-document replacement/white frame, focus restoration, reverse return, interruption continuity, reduced-motion duration and preserved scroll/filter/selection state.
- Lighthouse public-page budgets: performance >= 0.85, accessibility >= 0.95, best-practices >= 0.95, SEO >= 0.90; compressed initial JavaScript <= 350 KiB and initial CSS <= 120 KiB.
- `visual-evidence-manifest.json` records source/checkpoint root, dependency-lock hash, browser/OS/font/DPR/viewport, locale/timezone, color scheme, reduced-motion state, fixture/seed ID, screenshot/filmstrip/trace paths and reviewer result for each required state.
- ADR-029 correction keeps the public home default/common state at night without changing explicit day override or private daylight; uses the reference-locked `1132×750` four-ring stage at center `(792,371)`, scale `.85`, base diameters `353/501/649/797`, exact `CCW30/CW40/CW50/CCW60` rotation and one uncompensated 1px masked gradient while carrying the same five semantic objects; layers the approved 0.72-second `0.3R / A-180°` spiral arrival, `05 / 此刻正在发生` center, header motion control, theme-scoped login surface and whole-viewport safe-inset contract without replaying on login.
- ADR-030 changes only the scheduler owner for nine continuous transforms: native Web Animations exclusively owns the four ring rotations and five upright counter transforms; GSAP exclusively retains title, whole-group arrival, object spiral arrival, login, public-detail continuity, scene and aperture motion. Existing directions, periods, live phases, pause/focus/hidden/offscreen/reduced behavior, login one-third speed, geometry and performance gates remain unchanged, and no node may receive transform writes from both engines or CSS/Motion.

- [x] **Step 1: Install and lock browser acceptance dependencies.**

```powershell
npm.cmd install --save-dev --save-exact @axe-core/playwright@4.12.1 lighthouse@13.4.1
```

- [x] **Step 2: Write failing accessibility coverage** for public home/five details/login and all private top-level routes, including every life route, corner calendar, cooking mode, relationship graph/list, week planner, charts/tables, import preview and purchase confirmation; cover keyboard-only open/return/save/close, landmarks, headings, form errors, dialogs, live save status and color-independent state.

- [x] **Step 3: Write failing orbit/motion tests.** Assert the exact four-ring geometry, masked gradient, `CCW30/CW40/CW50/CCW60` periods, five-to-four mapping, approved arrival samples at 0/100/200/300ms, independent counter layers, `05 / 此刻正在发生`, header pause control and no replay on login. Measure the outer-ring bounding box at `1440×900`, `1024×768`, `768×1024`, `390×844` and 320 CSS px in rest/login/day/night/reduced states and require every edge to remain within the viewport safe inset without overflow clipping. Record normal/reduced public login, aperture entry, detail return, private route and inspector sequences; assert pause/hidden suspension, interruption continuity, fixed exits and no white frame. Reduced motion must preserve task semantics in at most 80ms for aperture entry.

- [x] **Step 4: Write the complete-product journey** that logs in, creates/edits/links/completes/archives/restores each original domain; creates a life item/unit/price/recipe/template/day plan, completes and undoes a meal, retains prepared portions, creates a shopping purchase/refund, verifies cash-versus-consumption analysis and trash restore; generates a review action, sync-previews knowledge and life Obsidian fallback, publishes/revokes content, searches it, uses quick record and an explicit alternate type, visits every platform tab and changes/reloads a preference.

- [x] **Step 5: Add failing performance budgets** using a production server and deterministic seed. Measure the public home and authenticated overview; authentication setup occurs before the timed private navigation and credentials never appear in report JSON.

- [x] **Step 6: Fix only evidence-backed failures.** Do not lower thresholds, disable animations globally, hide content from Axe, skip a browser or delete assertions to make the gate green. Optimize route splitting, stable shell, image sizing, query caching and animation composition while preserving the approved design.

- [x] **Step 7: Run the full acceptance matrix, build the reproducibility manifest and open every artifact.** Compare public home/login to the accepted P2 golden slice and private overview/complex workspaces to the accepted P3 slices before judging local polish. Reject the whole page for failure on identity, page-native structure, data/state truth, accessibility or performance/motion; a component-level pass cannot override a page-level veto.

  Ordinary CI remediation under this still-open step must preserve the ADR-030 engine boundary. Before product implementation, formalize the approved exception in ADR/spec/master/source registry/acceptance traceability, prove the unit/DOM owner contract and unchanged official Linux WebKit cadence/theme gate RED, then require both to pass without lowering workers, retries, browser coverage, sample durations, thresholds, geometry, periods or motion rates.

  Before this full matrix, the approved ADR-029 visual-correction atom must complete its own RED/GREEN and focused gate: default night/manual day/private daylight; exact reference-locked four-ring geometry and full-viewport safe inset; five-to-four mapping; approved spiral-arrival samples and counter layers; unified semantic glyphs and always-visible labels; `05 / 此刻正在发生`; complete accessible title, typing/complete/once/reduced states; night dark/day light login surfaces; unchanged form/auth/focus/return state; header pause control; fallback/enhanced parity; Chromium plus Windows headed Firefox/WebKit critical. Its visual evidence must include night at 1440/1024/768/390/320, night login, manual day, reduced motion, title initial/mid/final filmstrip, arrival filmstrip and multi-frame full-orbit geometry with numeric viewport-edge measurements. Completion of that atom does not itself run this Step 7 full matrix, rerun the already-consumed Impeccable detector, close P6-T5 or enter P6-T6.

```powershell
npm.cmd test
npm.cmd run test:server
npm.cmd run test:mysql
npm.cmd run typecheck
npm.cmd run typecheck:server
npm.cmd run build
npm.cmd run build:server
npm.cmd run test:e2e
npm.cmd run test:e2e:remote
node scripts/run-lighthouse.mjs
```

Inspect rather than merely generate public day/night, five details, login open/success, overview, every original and life private module, corner calendar, cooking, planning, purchase/import overlays, platform states and all four breakpoints. Include loading, empty, partial, 403, 409, 500, offline, reduced-motion, keyboard/focus and reverse-return states where applicable. Store only approved final captures under `outputs/final/`.

**ADR-029 focused atom status (2026-08-24, production and visual acceptance complete):** the user approved the final composition and requested removal of only the visible center light orb. The regenerated production result keeps the plain `05 / 此刻正在发生` semantic center, normalized `1132×750` four-ring stage, exact `CCW30/CW40/CW50/CCW60` rotation, safe-inset outer ring, 0.72-second layered arrival, header pause control and theme-coordinated login surfaces. Focused production RED/GREEN, Chromium and serialized Windows headed Firefox/WebKit critical gates passed; the primary executor opened the seven corrected artifacts and four full-product contact sheets. The detector remained consumed exactly once and was not rerun. Full Step 7 Web/API/exact-MySQL/browser/remote/Lighthouse gates are fresh and bound by the P6-T5 reproducibility manifest.

- [x] **Step 8: Commit or hash P6-T5** with message `test(product): lock final quality acceptance`.

### P6-T6: Release preflight and immutable UHub publication

**Files:**
- Modify under ADR-030 change control: `docs/superpowers/specs/2026-08-09-lifeops-web-final-redesign-design.md`
- Modify under ADR-030 change control: `docs/superpowers/plans/2026-08-09-00-lifeops-final-master-plan.md`
- Modify under ADR-030 change control: `docs/traceability/source-clause-review-rules.json`
- Modify under ADR-030 change control: `docs/traceability/source-clauses.json`
- Modify under ADR-030 change control: `docs/traceability/acceptance-matrix.json`
- Modify under ADR-030 change control: `scripts/execution-contract/original-atoms.mjs`
- Modify under ADR-030 change control: `scripts/verify-execution-contract.test.mjs`
- Modify under ADR-030 change control: `src/components/public/PublicOrbit.tsx`
- Modify under ADR-030 change control: `src/components/public/PublicOrbit.test.tsx`
- Modify under ADR-030 change control: `src/pages/PublicHomePage.tsx`
- Modify under ADR-030 change control: `src/pages/PublicHomePage.test.tsx`
- Modify under ADR-030 change control: `tests/public-home.spec.ts`
- Modify: `.gitignore`
- Create: `scripts/release-preflight.ps1`
- Create: `scripts/release-preflight.test.ps1`
- Create: `scripts/pre-release-data-rehearsal.ps1`
- Create: `scripts/pre-release-data-rehearsal.test.ps1`
- Create: `scripts/release-production.ps1`
- Create: `scripts/release-production.test.ps1`
- Create: `scripts/verify-release-manifest.ps1`
- Create: `scripts/verify-release-manifest.test.ps1`
- Modify: `deploy/argocd/application.example.yaml`
- Modify after repository discovery: `deploy/gitops/environments/production/values.yaml`
- Create: `outputs/final/release-preflight-summary.md`
- Create: `outputs/final/data-rehearsal-summary.md`
- Create: `outputs/final/release-summary.md`
- Create: `outputs/final/release-manifest.json`

**Interfaces:**
- Release preflight input is repository root, Web/API UHub repositories and production values path; it never accepts Kubernetes context or cluster credentials.
- Result groups are `pass | fail | warning | not-applicable`; any failed release prerequisite exits non-zero.
- Data rehearsal migrates a script-owned disposable MySQL 8.4 database, creates a non-private sentinel, takes a logical dump, restores it into a second disposable MySQL 8.4 instance and verifies schema/checksums/data before cleaning up only its own resources.
- Release accepts an explicit SemVer, dispatches the pinned workflow, waits for completion, resolves both registry digests and the production-values revision, and never calls `kubectl`, Helm upgrade/install or Argo sync.
- Release manifest records immutable references, source revision, test checkpoint, SBOM/provenance status and artifact hashes without credentials.

- [x] **Step 1: Write failing release-preflight, data-rehearsal and manifest tests** for missing/non-Git repository, dirty unrelated changes, unavailable GitHub/UHub/Docker/Buildx/Helm, unknown repositories, credential-like output, migration/checksum/dump/restore failure, partial cleanup, mutable image references, digest mismatch, missing SBOM/provenance and release-manifest hash drift.

- [x] **Step 2: Implement the read-only release preflight.** Verify Git root/branch/origin/default branch, authenticated GitHub write/dispatch capability, Docker/Buildx, UHub login/repository read without echoing credentials, Helm availability, production values schema and absence of deployable placeholders. Do not inspect kubeconfig or any cluster.

- [x] **Step 3: Run release preflight against the real release environment and stop on failed prerequisites.**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/release-preflight.ps1 -RepositoryRoot (Get-Location).Path -WebRepository uhub.service.ucloud.cn/chenucloud/lifeops-web -ApiRepository uhub.service.ucloud.cn/chenucloud/lifeops-api -ValuesFile deploy/gitops/environments/production/values.yaml
```

Repository names must be confirmed by the real UHub result. Credentials are supplied only through approved environment/secret mechanisms and never copied to evidence.

- [x] **Step 4: Run the disposable MySQL migration, backup and restore rehearsal.** It proves forward migrations, checksum identity, dump readability and restoration safety without accessing a user or cluster database.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/pre-release-data-rehearsal.ps1 -MySqlImage mysql:8.4.10
```

- [x] **Step 5: Materialize the production release configuration.** Derive repository URL/revision from verified Git state, set the confirmed UHub repositories and retain explicit user-owned fields for namespace/hostname/StorageClass/platform endpoints in examples. The production digest values are populated only by the verified release. No Secret value may be embedded.

- [x] **Step 6: Determine SemVer from real repository tags.** Use `1.0.0` only when no valid release exists; otherwise apply the documented patch/minor/major decision and record it before dispatch.

- [x] **Step 7: Dispatch and wait for the pinned GitHub Actions release.** Require successful tests/builds, pushed Web/API artifacts, UHub-resolved `sha256:` digests, exact-digest image smoke, SBOM/provenance status and a digest-only production-values update.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/release-production.ps1 -Version $selectedVersion -Workflow .github/workflows/release.yml -Wait
```

- [x] **Step 8: Re-run registry, render and release-manifest verification.** Inspect both immutable references from UHub, verify production values contain the same digests, run production Helm validation and validate all recorded artifact hashes.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-release-manifest.ps1 -Manifest outputs/final/release-manifest.json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-rendered-helm.ps1 -ValuesFile deploy/gitops/environments/production/values.yaml -Production
```

- [x] **Step 9: Commit or hash P6-T6** with message `chore(release): publish immutable LifeOps images`. A non-Git directory, unpushed image or unverifiable digest cannot pass this task.

### P6-T7: User-operated deployment package and acceptance drill

**Files:**
- Create: `scripts/validate-deployment-package.ps1`
- Create: `scripts/validate-deployment-package.test.ps1`
- Create: `scripts/post-deploy-smoke.ps1`
- Create: `scripts/post-deploy-smoke.test.ps1`
- Create: `tests/deployment-smoke.spec.ts`
- Create: `tests/deployment-persistence.spec.ts`
- Create: `docs/runbooks/user-deployment-checklist.md`
- Create: `docs/runbooks/deploy-rollback.md`
- Create: `outputs/final/deployment-package-summary.md`
- Create: `outputs/final/user-deployment-verification-template.md`

**Interfaces:**
- Package validation is offline/read-only: it verifies chart/render/schema/digest/document contracts and never connects to a cluster.
- `post-deploy-smoke.ps1` is a user-run tool. It accepts an explicit HTTPS base URL plus expected Web/API digests/revision, invokes application HTTP/browser checks, writes a sanitized report and never mutates Kubernetes resources.
- Deployment and rollback docs give Helm and Argo alternatives, require user confirmation of namespace/hostname/StorageClass/Secret names, use forward-only migrations and prohibit destructive down migration.
- Platform integrations are optional. The deployment checklist requires every enabled service to be configured and every unavailable service to appear as `disabled`, `degraded` or `unverified`, never fabricated.

- [ ] **Step 1: Write failing package and user-smoke tests** for missing files/digests/checksums, deployable placeholders, Secret values, unsafe filesystem replica/storage combinations, public `/metrics`, overbroad RBAC, wrong expected revision/digest, failed health/auth/persistence/life sentinel and cleanup outside smoke-created application records.

- [ ] **Step 2: Implement the offline deployment-package validator.** Check Helm lint/template, values schema, immutable images, migration order, health probes, resource/security contexts, Secret refs, RBAC/network policies, monitoring resources, runbook anchors and release-manifest hashes.

- [ ] **Step 3: Implement the user-run application smoke.** Reuse remote Playwright journeys for public/auth/private, CRUD, media, publishing and the exact-once life transaction sentinel. Cleanup uses documented application APIs and a unique test prefix; it does not delete Pods, PVCs, namespaces or user data.

- [ ] **Step 4: Write the deployment checklist.** Cover UHub pull Secret creation by the user, database Secret, namespace, storage/media choice, Gateway/Ingress, DNS/TLS, Helm render/install or Argo Application adoption, migration completion, readiness, expected digest checks and smoke invocation without embedding real credentials.

- [ ] **Step 5: Write safe backup/restore and rollback procedures.** Require a user-owned verified database backup before upgrades, digest-only GitOps revision changes, forward-compatible migrations and a maintenance decision for disruptive rollback. Do not automate access to the user's cluster or database.

- [ ] **Step 6: Document platform verification.** Provide Prometheus target/query, Grafana dashboard, PrometheusRule, Elasticsearch/Kibana request-ID and Platform Center deep-link checks the user can perform after installing those components. Disabled integrations remain truthful and do not block Web delivery.

- [ ] **Step 7: Perform an offline acceptance drill.** Starting only from the release manifest and docs, follow every non-cluster step, render both Helm/Argo paths, resolve all links/commands, confirm every user input is named and verify no step depends on an undocumented local path or credential.

- [ ] **Step 8: Run the final package validator and record the sanitized summary.** Any skipped required package check keeps DELIVERY-01 open.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-deployment-package.ps1 -ReleaseManifest outputs/final/release-manifest.json -ValuesFile deploy/gitops/environments/production/values.yaml
```

- [ ] **Step 9: Commit or hash P6-T7** with message `docs(deploy): deliver user-operated Kubernetes handoff`. Do not include kubeconfig, credentials, private endpoints or user data.

### P6-T8: Final traceability, release handoff and honest completion audit

**Files:**
- Modify: `docs/traceability/requirements.md`
- Modify: `README.md`
- Modify: `DESIGN.md`
- Modify: `PRODUCT.md`
- Create: `DEPLOYMENT.md`
- Create: `docs/runbooks/backup-restore.md`
- Create: `docs/runbooks/media-storage.md`
- Modify: `docs/runbooks/observability.md`
- Modify: `docs/runbooks/deploy-rollback.md`
- Modify: project `CURRENT.md`
- Modify: project `DECISIONS.md` only if implementation created a durable new decision
- Modify: the active implementation session selected at P6 entry under ADR-020; scan the highest occupied `SNNN` and never reuse S015–S018.
- Create: `outputs/final/final-verification-index.md`

**Interfaces:**
- Every master requirement row ends as `verified-local`, `verified-image`, `verified-registry`, or remains explicitly open with a blocking fact. `verified-cluster` is not a Web-project state.
- Final index maps requirement -> source/tests -> local command evidence -> visual evidence -> image/registry/package evidence -> known limitation.
- Operations docs cover release, migration, backup/restore, media, observability, incident triage and GitOps rollback with exact safe commands and prerequisites for the user.

- [ ] **Step 1: Reverse-audit every requirement from the approved specs and ADR-016 through ADR-022.** Inspect implementation and fresh evidence for the original 20 IDs plus LIFE-01 through LIFE-24. Reopen any row whose evidence is missing, stale, skipped, mock-only, lacks its reproducibility manifest, fails a whole-page visual veto or falls below its required local/image/registry boundary.

- [ ] **Step 2: Search for unfinished/fake implementation artifacts.**

```powershell
rg -n "TODO|TBD|FIXME|REPLACE_ME|coming soon|not implemented|mock data|sample data|placeholder" src server deploy .github scripts docs
```

Classify every match. Remove implementation placeholders and fake production data; retain only truthful documentation, explicit user-input placeholders in examples or isolated local-preview fixtures.

- [ ] **Step 3: Run one fresh final gate from a clean dependency install** and record exact exit codes/versions.

```powershell
npm.cmd ci
npm.cmd --prefix server ci
npm.cmd test
npm.cmd run test:server
npm.cmd run test:mysql
npm.cmd run typecheck
npm.cmd run typecheck:server
npm.cmd run build
npm.cmd run build:server
npm.cmd run test:e2e
npm.cmd run test:e2e:remote
node scripts/run-lighthouse.mjs
helm lint deploy/helm/lifeops-web
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-images.ps1 -WebImage $webImageReference -ApiImage $apiImageReference
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-release-manifest.ps1 -Manifest outputs/final/release-manifest.json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-deployment-package.ps1 -ReleaseManifest outputs/final/release-manifest.json -ValuesFile deploy/gitops/environments/production/values.yaml
```

- [ ] **Step 4: Complete product and operations documentation.** State the real release revision/UHub digests, supported modules, browser/motion/accessibility behavior, API/data model, Obsidian limits, platform integration configuration, user deployment/recovery procedures and application/runtime limitations. Never place credentials in examples.

- [ ] **Step 5: Build the final verification index.** Link each requirement to named test/report/screenshot/filmstrip/trace, the visual-evidence manifest entry, golden-slice comparison and state freshness/boundary. Do not paste raw logs when a sanitized summary plus artifact path is sufficient.

- [ ] **Step 6: Update the selected session and project CURRENT.** Record final Git/SHA revision, UHub digests, image smoke and registry status, test totals, visual-evidence-manifest hash, deployment-package version/hash, known limitations and the user's next deployment action. Do not record unobserved Argo, Kubernetes, hostname or integration states as passed. If any Web completion condition remains open, CURRENT must say `implementation-active`.

- [ ] **Step 7: Request final code/design verification** using `superpowers:requesting-code-review`, fix all accepted findings, then rerun every affected gate.

- [ ] **Step 8: Use `superpowers:verification-before-completion` before the final claim.** Compare evidence timestamps, image digests, release manifest and package hashes to the current release. Only then commit the handoff with message `docs(release): complete LifeOps Web image handoff` and report Web delivery completion.

## Plan 6 Self-Review

- Spec coverage: migration safety, complete life transactions/persistence, media persistence, security/RBAC, network boundaries, application monitoring assets, logs/dashboard contracts, action pinning, SBOM/provenance, accessibility, motion, performance, UHub and user-operated GitOps delivery all have named tests and gates.
- Placeholder scan: unknown user cluster coordinates remain only in clearly marked examples; no deployable production values, release manifest or image reference can contain an example marker, empty digest or credential.
- Type consistency: storage, platform status, metric names, release digests, values revision and requirement states remain exact across server, Helm, scripts and evidence.
- Safety: secrets are excluded, migrations are forward-only, release rehearsal touches only disposable local resources, and all cluster/database deployment operations remain explicit user actions.
- Completion truth: local source evidence cannot close image/registry requirements; image existence cannot replace exact-digest smoke; optional disabled integrations remain disabled rather than fabricated; Argo/cluster results are user deployment evidence and do not block Web delivery.
