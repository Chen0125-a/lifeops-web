# LifeOps Web Execution Contract

This file applies to the entire LifeOps Web workspace. It exists to prevent a future session or agent from drifting away from the user-approved final redesign.

## Authority order

1. The user's latest explicit correction or approval.
2. `D:\笔记\项目\LifeOps-高可用K8s平台\DECISIONS.md`, especially ADR-016 through ADR-026 and still-valid earlier ADRs.
3. `docs/superpowers/specs/2026-08-09-lifeops-web-final-redesign-design.md` plus `docs/superpowers/specs/2026-08-10-lifeops-life-domain-design.md` for the life domain.
4. `docs/superpowers/specs/2026-08-10-lifeops-execution-completeness-design.md` for atomic acceptance, evidence and cross-session enforcement.
5. `docs/superpowers/specs/2026-08-10-lifeops-web-image-delivery-boundary-design.md` for the Web/UHub completion boundary and user-owned deployment boundary.
6. `docs/superpowers/plans/2026-08-09-00-lifeops-final-master-plan.md`.
7. The current ordered work-package plan, `01` through `06`.
8. S012 only for public orbit/night details not superseded by ADR-016.

The following files are historical and must not be executed: `2026-08-09-01-private-universe-motion.md`, `2026-08-09-02-api-mysql.md`, `2026-08-09-03-kubernetes-cicd.md`, and `2026-08-09-lifeops-daylight-workbench.md`.

## Mandatory startup sequence

Before changing source, tests, Helm, workflows or deployment state:

1. Read this file completely.
2. Read project `CURRENT.md`, `DECISIONS.md`/ADR-016 through ADR-026 and the latest LifeOps session.
3. Read the final design spec, life-domain design, execution-completeness design, image-delivery-boundary design, master plan and `docs/superpowers/plans/2026-08-09-execution-control.md`.
4. Read the entire currently active work-package task, including its files, interfaces, steps and exit gate.
5. Inspect Git/worktree status and existing user changes. The workspace was not a Git repository when the plan was written; do not initialize Git without explicit user authority.
6. Verify the spec/master hashes recorded in the execution-control file. If they differ, stop and determine whether an approved plan change occurred.
7. State the active plan/task/step and the exact first verification command before editing.

## Non-negotiable execution rules

- Execute P1 → P2 → P3 → P4 → P5 → P6. Do not start a later work package because it looks easier or more visible.
- Do not start P1-T1 until the execution-completeness specification is reviewed, its implementation plan is approved, the atomic acceptance/evidence validator passes startup and handoff modes, and the fresh-context read-only drill is recorded.
- Keep exactly one task in progress. Within that task, follow checkbox steps in order.
- Use test-driven development for every feature or bugfix: write the named failing test, run it and confirm the expected behavioral failure before implementation.
- An infrastructure or syntax failure is not a valid red test. Fix the test environment first.
- Implement only the active task. Do not silently omit its error, empty, conflict, permission, offline, responsive, accessibility or visual requirements.
- Run the focused verification and the task/plan regression gate before advancing. Read the complete output and exit code.
- Never mark a task, requirement, plan or project complete from code inspection, an old run, a skipped suite or a subagent report. The primary agent must independently inspect changes and rerun current evidence.
- The 44 requirement rows are rollups. Once the atomic matrix exists, a parent requirement cannot advance beyond the least-complete applicable child atom, and hand-edited parent status never overrides missing child evidence.
- If a planned command cannot run, record the exact blocker; do not replace it with a weaker check and call the gate passed.
- When UI changes, inspect the real page in a browser at the required breakpoints. Screenshot generation without opening and reviewing the images is incomplete.
- Preserve user changes and unrelated dirty files. Do not reset, discard, overwrite or initialize repository state without authority.
- Any material plan/design change requires: explain the discovered fact, stop before divergence, obtain user confirmation, update the spec/ADR/plan/traceability and only then resume. Local implementation detail changes that preserve behavior must still be recorded in the active session.

## Design prohibitions

- Never restore private planets, a private galaxy/orbit shell, left-sidebar-plus-card-wall layout, right-angle paper sheets, equal rounded-card walls or whole-page flash navigation.
- Never restore three tidy public orbit paths, detached orbit objects, wheel-based navigation, technology logos as primary public objects or dim/invisible night tracks.
- Public primary objects remain sundial, navigation flag, open book, viewfinder and tree/archive ring on shared authored ellipse geometry.
- Private UI remains the bright Daylight Command Center with continuous canvas, soft-volume hierarchy and the exact approved top navigation.

## Data, platform and delivery truth

- Production data is Fastify/MySQL; preview fixtures never ship as production data.
- Life future/uncompleted forecasts use current effective catalog and recipe facts; completed history stores actual snapshots and changes only through an explicit audited recalculation.
- Life inventory changes only through idempotent purchase/consume/return/waste/adjustment/reversal events. Cash expenditure and consumption cost remain separate.
- Medicine features store user-authored facts, stock, expiry, schedules and history only; never generate diagnosis, dosage, stop-medication or unverified interaction advice.
- Platform integrations are server-side, read-only, allowlisted and honest about connected/degraded/disabled state. Never fabricate Prometheus, Grafana, Alertmanager, Kubernetes or ELK values.
- Current release mainline is GitHub Actions → UHub → GitOps delivery assets. Argo CD remains the recommended user-operated deployment consumer; Jenkins is a later learning track and Harbor is optional.
- Current Phase-1 is `2 LB + 1 control-plane + 2 worker`; never describe it as control-plane HA.
- This workspace owns only the LifeOps Web product, API, MySQL application schema, tests, immutable Web/API images, UHub release evidence and application-delivery assets. It must not build, reconfigure or administer the Kubernetes cluster or deploy/reconcile/rollback LifeOps in that cluster. Cluster construction, platform installation, Helm/Argo application deployment and cluster smoke are user-owned and never block Web delivery completion.
- `build-ha-k8s-platform` is retired from LifeOps Web routing and execution. Keep any installed files as historical tooling unless the user explicitly requests deletion, but never invoke the Skill for this workspace or list it as a Web portability requirement.
- Never place credentials, tokens, cookies, kubeconfig contents, private keys or raw private data in Git, Obsidian, screenshots or evidence.
- No overall completion claim is allowed until all applicable atomic acceptance rows roll up to all 44 master requirement IDs with fresh evidence, both immutable images are genuinely available from UHub by digest, exact-digest image smoke passes, and the validated Helm/GitOps/deployment handoff package is complete. Argo status and cluster smoke are user deployment evidence, not Web completion gates.
- Before P1 begins, the source-clause registry must cover all five hash-locked authority files and all six P1-P6 work packages. Without Git, evidence uses a sorted allowlisted file/SHA-256 manifest plus a root SHA-256; scattered hashes and timestamps do not establish freshness.
- Web/API final digests require actual digest-bound, verifiable SBOM and provenance artifacts. Missing or unknown attestations cannot close DELIVERY-01. Formal release remains GitHub Actions → UHub unless the user explicitly approves a new release path.

## Required pause/handoff

At every user pause, context boundary or task completion, update all of the following before stopping:

1. `docs/superpowers/plans/2026-08-09-execution-control.md`.
2. The active work-package checkboxes, `docs/traceability/requirements.md`, and the atomic acceptance/evidence artifacts once they exist.
3. Project `CURRENT.md`.
4. The current S014+ implementation session.

Record active plan/task/step, changed paths, commit or SHA-256 checkpoint, fresh commands/exit codes, visual evidence, unverified external facts and one exact next atomic action.
